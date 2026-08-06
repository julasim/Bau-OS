#!/usr/bin/env node
// ============================================================
// Prüfstand für das Arbeitsplatz-Programm (AP12)
// ============================================================
// Die Electron-Hülle lässt sich nicht mit Vitest prüfen: sie braucht einen
// laufenden Electron-Prozess, ein Fenster und einen Server. Die reine Logik
// (Adressen, Fehlertexte) liegt deshalb in `electron/adresse.ts` und wird von
// `tests/electron-adresse.test.ts` abgedeckt — alles andere hier.
//
// Gemessen wird über das Chrome-DevTools-Protokoll: das Programm läuft
// wirklich, und ausgelesen wird, was im Fenster TATSÄCHLICH steht. Kein
// Bildschirm nötig.
//
//   node scripts/pruefe-arbeitsplatz.mjs erststart  <server>
//   node scripts/pruefe-arbeitsplatz.mjs server     <server>
//   node scripts/pruefe-arbeitsplatz.mjs abriss
//   node scripts/pruefe-arbeitsplatz.mjs alle       <server>
//
// `<server>` ist ein laufender PATIO-Dienst, z.B. http://127.0.0.1:3399.
// Mit `PATIO_EXE=release/PATIO-Arbeitsplatz-<version>-portable.exe` läuft
// derselbe Prüfstand gegen das GEPACKTE Programm statt gegen den Bauzustand.
//
// ── Zwei Fallen, die hier schon zugeschlagen haben ──────────────────────────
//
// 1. **Isoliert wird über `--user-data-dir`, nicht über `APPDATA`.** Electron
//    löst `appData` unter Windows über die Shell-API auf und ignoriert die
//    Umgebungsvariable — ein Lauf, der sie setzt, schreibt trotzdem in die
//    echten Benutzerdaten und beweist nichts.
//
// 2. **Prozesse nie über den NAMEN aufräumen.** PATIO Desktop heißt im
//    Prozessbaum ebenfalls „PATIO" (gleicher `productName`); ein
//    `Get-Process PATIO | Stop-Process` beendet das andere Programm mit. Und
//    Reste eines früheren Laufs halten die Einzelinstanz-Sperre, wodurch die
//    nächste Messung stillschweigend falsch wird. Deshalb: vor der Messung
//    auf einen leeren Ausgangszustand bestehen, danach nur eigene IDs beenden.
// ============================================================

import { spawn, execSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ELECTRON = "node_modules/electron/dist/electron.exe";
const PROGRAMM = process.env.PATIO_EXE ? [process.env.PATIO_EXE, []] : [ELECTRON, ["dist-electron/main.js"]];

// ── Testinstanzen von PATIO Desktop unterscheiden ───────────────────────────
// Beide Programme heissen im Prozessbaum "PATIO" (gleicher productName). Der
// Unterschied ist der PFAD: PATIO Desktop liegt unter %LOCALAPPDATA%\Programs\
// PATIO, die portable Testinstanz entpackt sich nach %TEMP%. Alles, was hier
// gezaehlt oder beendet wird, ist ausschliesslich Letzteres.
const ps = (cmd) => execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: "utf-8" }).trim();
// Die Backslashes MUESSEN verdoppelt sein: in einem JS-String frisst der Parser
// den einfachen Backslash, der Filter hiesse dann `*ProgramsPATIO*` und traefe
// nie — womit testPids() alle PATIO-Prozesse liefern wuerde, PATIO Desktop
// eingeschlossen. Genau das ist hier passiert und hat die Messung verfaelscht.
const NUR_TEST = "Get-Process PATIO -EA SilentlyContinue | Where-Object { $_.Path -notlike '*\\Programs\\PATIO\\*' }";
const testPids = () => {
  const r = ps(`(${NUR_TEST} | Select-Object -ExpandProperty Id) -join ','`);
  return new Set(r ? r.split(",").map(Number) : []);
};
const testFenster = () => +ps(`@(${NUR_TEST} | Where-Object { $_.MainWindowTitle -ne '' }).Count`);

const ergebnisse = [];
function pruefe(name, bedingung, gesehen) {
  ergebnisse.push({ name, ok: !!bedingung });
  console.log(`${bedingung ? "  OK  " : " FEHL "} ${name}${bedingung ? "" : `\n         gesehen: ${gesehen}`}`);
}

// ── CDP-Anbindung ───────────────────────────────────────────────────────────
// `fetch()` ist in dieser Umgebung unbrauchbar → node:http. WebSocket ist seit
// Node 22 global vorhanden, es braucht keine Fremdbibliothek.

function ziele(port) {
  return new Promise((res, rej) => {
    http
      .get({ host: "127.0.0.1", port, path: "/json/list" }, (r) => {
        let s = "";
        r.on("data", (c) => (s += c));
        r.on("end", () => {
          try {
            res(JSON.parse(s));
          } catch (e) {
            rej(e);
          }
        });
      })
      .on("error", rej);
  });
}

async function warteAufSeite(port, versuche = 60) {
  for (let i = 0; i < versuche; i++) {
    try {
      const s = (await ziele(port)).find((z) => z.type === "page" && z.webSocketDebuggerUrl);
      if (s) return s;
    } catch {
      /* noch nicht oben */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("DevTools-Endpunkt kam nicht hoch");
}

async function verbinde(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  let id = 0;
  const offen = new Map();
  ws.addEventListener("message", (ev) => {
    const n = JSON.parse(ev.data);
    if (n.id && offen.has(n.id)) {
      offen.get(n.id)(n);
      offen.delete(n.id);
    }
  });
  return {
    async evaluate(ausdruck) {
      const antwort = await new Promise((res) => {
        const meins = ++id;
        offen.set(meins, res);
        ws.send(
          JSON.stringify({
            id: meins,
            method: "Runtime.evaluate",
            params: { expression: ausdruck, returnByValue: true, awaitPromise: true },
          }),
        );
      });
      return antwort?.result?.result?.value;
    },
  };
}

/** Startet das Programm mit eigenem Wegwerf-Profil. */
function starte(profil, port, env = {}) {
  const args = [...PROGRAMM[1], `--user-data-dir=${profil}`];
  if (port) args.push(`--remote-debugging-port=${port}`);
  return spawn(PROGRAMM[0], args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
}

function wegwerfProfil() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patio-pruef-"));
}

function raeumeAuf(kind, profil) {
  // `kill()` beendet bei der portablen .exe nur den ENTPACKER, nicht das
  // entpackte Programm darunter — die Reste sammeln sich und halten dann die
  // Einzelinstanz-Sperre, wodurch die naechste Messung still falsch wird.
  // `taskkill /T` nimmt den ganzen Baum unter der EIGENEN PID mit; ueber den
  // Prozessnamen aufzuraeumen waere falsch, weil PATIO Desktop genauso heisst.
  try {
    if (kind?.pid) execSync(`taskkill /F /T /PID ${kind.pid}`, { stdio: "ignore" });
  } catch {
    /* schon weg */
  }
  try {
    kind?.kill();
  } catch {
    /* schon weg */
  }
  setTimeout(() => {
    try {
      fs.rmSync(profil, { recursive: true, force: true });
    } catch {
      /* Electron haelt evtl. noch Handles */
    }
  }, 800);
}

// ── Modus „erststart": ohne gemerkte Adresse ────────────────────────────────

async function erststart(server) {
  console.log("\n══ Erststart, Fehlerfälle, Eingabe von Hand ══\n");
  const profil = wegwerfProfil();
  const kind = starte(profil, 9333, { PATIO_SERVER: "" });
  try {
    const s = await verbinde((await warteAufSeite(9333)).webSocketDebuggerUrl);
    await new Promise((r) => setTimeout(r, 2500));

    const url = await s.evaluate("location.href");
    pruefe("Erststart zeigt die Einrichtungsseite", url.startsWith("file://"), url);
    pruefe(
      "Sie fragt nach der Serveradresse",
      /Serveradresse/i.test(await s.evaluate("document.body.innerText")),
      null,
    );
    pruefe("Der Rückkanal ist da", (await s.evaluate("typeof window.patioEinrichtung")) === "object", null);

    // Unsinnige Adresse → verständlicher Klartext statt net::ERR_*
    await s.evaluate(`document.getElementById("adresse").value = "gibt-es-garantiert-nicht.invalid";
      document.getElementById("formular").dispatchEvent(new Event("submit", { cancelable: true }));`);
    await new Promise((r) => setTimeout(r, 10000));
    const meldung = await s.evaluate("document.getElementById('meldung').textContent");
    pruefe("Fehleingabe erzeugt eine Meldung", !!meldung && meldung.length > 10, meldung);
    pruefe("Die Meldung ist kein Chromium-Rohtext", !/net::|ERR_[A-Z_]+/.test(meldung ?? ""), meldung);
    pruefe(
      "Das Fenster bleibt auf der Einrichtungsseite",
      (await s.evaluate("location.href")).startsWith("file://"),
      null,
    );
    pruefe(
      "Der Verbinden-Knopf ist wieder bedienbar",
      await s.evaluate("!document.getElementById('verbinden').disabled"),
      null,
    );

    // Fremdes Schema wird gar nicht erst geprüft
    const abgewiesen = await s.evaluate(
      "window.patioEinrichtung.pruefen('file:///C:/Windows').then(r => JSON.stringify(r))",
    );
    pruefe("Fremdes Schema wird abgewiesen", /"ok":false/.test(abgewiesen ?? ""), abgewiesen);

    // Der Weg, auf den es ankommt
    const antwort = await s.evaluate(
      `window.patioEinrichtung.pruefen(${JSON.stringify(server)}).then(r => JSON.stringify(r))`,
    );
    // `undefined` ist hier ERWARTET: bei Erfolg lädt der Behandler die
    // Oberfläche, der aufrufende Renderer ist also weg, bevor die Antwort
    // ankommt. Der Beweis sind die Prüfungen darunter.
    pruefe("Gültige Adresse wird angenommen", antwort === undefined || /"ok":true/.test(antwort ?? ""), antwort);
    await new Promise((r) => setTimeout(r, 3000));
    pruefe("Das Fenster wechselt auf die Oberfläche", (await s.evaluate("location.href")).startsWith(server), null);

    const datei = path.join(profil, "patio-server.json");
    pruefe("Die eingetragene Adresse wird gemerkt", fs.existsSync(datei), datei);
    if (fs.existsSync(datei)) {
      const inhalt = JSON.parse(fs.readFileSync(datei, "utf-8"));
      pruefe("… als zuletzt genutzte", inhalt.lastServer === server, inhalt.lastServer);
      pruefe("… und in der Liste fürs Menü", (inhalt.recent ?? []).includes(server), JSON.stringify(inhalt.recent));
    }
  } finally {
    raeumeAuf(kind, profil);
  }
}

// ── Modus „server": Adresse aus PATIO_SERVER ────────────────────────────────

async function gegenServer(server) {
  console.log("\n══ Adresse aus PATIO_SERVER ══\n");
  const profil = wegwerfProfil();
  const kind = starte(profil, 9333, { PATIO_SERVER: server });
  try {
    const s = await verbinde((await warteAufSeite(9333)).webSocketDebuggerUrl);
    await new Promise((r) => setTimeout(r, 2500));

    const url = await s.evaluate("location.href");
    pruefe("Die Oberfläche kommt vom Server", url.startsWith(server), url);
    pruefe(
      "Die Anmeldung ist da",
      /Anmelden|Passwort|Benutzer/i.test(await s.evaluate("document.body.innerText")),
      null,
    );
    pruefe(
      "Der Server-Seite wird NICHTS exponiert",
      (await s.evaluate("typeof window.patioEinrichtung")) === "undefined",
      null,
    );
    pruefe(
      "Kein Node im Renderer",
      (await s.evaluate("typeof window.require")) === "undefined" &&
        (await s.evaluate("typeof window.process")) === "undefined",
      null,
    );
    // Bewusst NICHT gemerkt — sonst gewänne die gespeicherte Adresse ab dem
    // nächsten Start gegen die Umgebungsvariable.
    pruefe("Die env-Adresse wird NICHT gemerkt", !fs.existsSync(path.join(profil, "patio-server.json")), null);
    // Der eigentliche Nachweis der Isolierung: die echten Benutzerdaten
    // bleiben unberuehrt. (Ob im Wegwerf-Profil schon Preferences liegen,
    // haengt am Zeitpunkt — das gepackte Programm schreibt sie spaeter.)
    const echt = path.join(process.env.APPDATA ?? "", "PATIO-Arbeitsplatz");
    pruefe("Die echten Benutzerdaten bleiben unberührt", !fs.existsSync(echt), echt);
  } finally {
    raeumeAuf(kind, profil);
  }
}

// ── Modus „abriss": der Server bricht während der Arbeit weg ────────────────

async function abriss() {
  console.log("\n══ Der Server bricht während der Arbeit weg ══\n");
  const PORT = 3401;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"status":"ok"}');
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Ersatz</title><h1>OBERFLAECHE-LAEUFT</h1>");
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

  const profil = wegwerfProfil();
  const kind = starte(profil, 9334, { PATIO_SERVER: `http://127.0.0.1:${PORT}` });
  try {
    let s = await verbinde((await warteAufSeite(9334)).webSocketDebuggerUrl);
    await new Promise((r) => setTimeout(r, 2500));
    pruefe(
      "Die Oberfläche ist geladen",
      /OBERFLAECHE-LAEUFT/.test((await s.evaluate("document.body.innerText")) ?? ""),
      null,
    );

    await new Promise((r) => server.close(r));
    server.closeAllConnections?.();

    // Genau die Navigation, die die Oberfläche bei einem 401 auslöst
    // (web/src/api.ts:50). Ohne Behandlung käme hier Chromiums Fehlerseite.
    await s.evaluate('window.location.href = "/login"');
    await new Promise((r) => setTimeout(r, 6000));

    s = await verbinde((await warteAufSeite(9334)).webSocketDebuggerUrl);
    const url = await s.evaluate("location.href");
    const meldung = await s.evaluate(
      "document.getElementById('meldung') && document.getElementById('meldung').textContent",
    );
    pruefe("Die gescheiterte Navigation landet auf der eigenen Seite", (url ?? "").startsWith("file://"), url);
    pruefe("Kein Chromium-Fehlertext", !/ERR_/.test((await s.evaluate("document.body.innerText")) ?? ""), null);
    pruefe("Es steht eine Erklärung da", !!meldung && meldung.length > 10, meldung);
    pruefe(
      "Die bisherige Adresse ist vorbelegt",
      (await s.evaluate("document.getElementById('adresse').value")) === `http://127.0.0.1:${PORT}`,
      null,
    );
    pruefe('„Erneut versuchen" wird angeboten', await s.evaluate("!document.getElementById('erneut').hidden"), null);

    const nochmal = await s.evaluate("window.patioEinrichtung.erneut().then(r => JSON.stringify(r))");
    pruefe("Erneut versuchen scheitert sauber statt zu hängen", /"ok":false/.test(nochmal ?? ""), nochmal);
  } finally {
    try {
      server.close();
    } catch {
      /* schon zu */
    }
    raeumeAuf(kind, profil);
  }
}

// ── Modus „einzelinstanz": nur für das gepackte Programm sinnvoll ───────────

async function einzelinstanz(server) {
  console.log("\n══ Einzelinstanz-Sperre ══\n");
  if (!process.env.PATIO_EXE) {
    console.log("  (übersprungen — nur mit PATIO_EXE aussagekräftig)");
    return;
  }
  if (testPids().size) {
    // Reste eines früheren Laufs halten die Sperre und machen die Messung
    // still falsch. Lieber abbrechen als ein wertloses „OK".
    pruefe("Ausgangszustand ist leer", false, `${testPids().size} Testinstanzen laufen bereits`);
    return;
  }

  const profil = wegwerfProfil();
  const env = { ...process.env, PATIO_SERVER: server };
  spawn(PROGRAMM[0], [`--user-data-dir=${profil}`], { env, stdio: "ignore", detached: true }).unref();
  await new Promise((r) => setTimeout(r, 22000));
  const f1 = testFenster();
  const a = testPids();

  spawn(PROGRAMM[0], [`--user-data-dir=${profil}`], { env, stdio: "ignore", detached: true }).unref();
  await new Promise((r) => setTimeout(r, 25000));
  const f2 = testFenster();
  const b = testPids();

  pruefe("Der erste Start öffnet ein Fenster", f1 === 1, `${f1}`);
  pruefe("Der zweite Start öffnet KEIN zweites", f2 === f1, `${f1} → ${f2}`);

  // Nur eigene IDs — niemals über den Namen (PATIO Desktop heisst genauso).
  const meine = [...new Set([...a, ...b])];
  if (meine.length) {
    try {
      ps(`Stop-Process -Id ${meine.join(",")} -Force -EA SilentlyContinue`);
    } catch {
      /* schon weg */
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  try {
    fs.rmSync(profil, { recursive: true, force: true });
  } catch {
    /* Handles */
  }
}

// ── Ablauf ──────────────────────────────────────────────────────────────────

const [, , modus = "alle", server = "http://127.0.0.1:3399"] = process.argv;

if (!fs.existsSync(PROGRAMM[0])) {
  console.error(`Programm nicht gefunden: ${PROGRAMM[0]}`);
  console.error(
    process.env.PATIO_EXE
      ? "PATIO_EXE zeigt ins Leere — erst `npm run dist`."
      : "Erst `npm run build:electron` (und `npm install`).",
  );
  process.exit(2);
}
console.log(`Programm: ${PROGRAMM[0]}\nServer:   ${server}`);

// Reste eines frueheren Laufs halten Port und Einzelinstanz-Sperre. Der
// Pruefstand laese dann die ALTE Instanz aus und meldete Unsinn — genau das ist
// hier schon passiert. Lieber abbrechen als ein wertloses Ergebnis.
if (process.platform === "win32" && testPids().size) {
  console.error(`\nABBRUCH: ${testPids().size} Testinstanzen laufen noch. Beenden mit:`);
  // Der Pfadfilter ist Pflicht — ohne ihn beendet der Befehl PATIO Desktop mit,
  // weil beide Programme im Prozessbaum "PATIO" heissen.
  console.error(`  powershell -NoProfile -Command "${NUR_TEST} | Stop-Process -Force"`);
  process.exit(2);
}

if (modus === "erststart" || modus === "alle") await erststart(server);
if (modus === "server" || modus === "alle") await gegenServer(server);
if (modus === "abriss" || modus === "alle") await abriss();
if (modus === "einzelinstanz" || modus === "alle") await einzelinstanz(server);

const fehl = ergebnisse.filter((e) => !e.ok).length;
console.log(`\n═══ ${ergebnisse.length - fehl}/${ergebnisse.length} Prüfungen bestanden ═══`);
process.exit(fehl ? 1 : 0);
