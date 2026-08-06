// ============================================================
// PATIO — Arbeitsplatz-Programm (Electron-Hülle)
// ============================================================
// Am Arbeitsplatz läuft kein Browser, sondern ein Programm. Diese Hülle tut
// genau eine Sache: sie findet den Firmenserver und zeigt seine Oberfläche in
// einem eigenen Fenster.
//
// ── Die Umkehrung gegenüber PATIO Desktop ───────────────────────────────────
//
// Die Vorlage (`apps/patio-app-lokal/electron/main.ts`, 557 Zeilen) STARTET
// die Anwendung: sie lädt drei kompilierte Module aus `dist/`, hängt einen
// Vault-Ordner ein, fährt eine lokale Hono-API auf Port 0 hoch und lädt dann
// `http://127.0.0.1:<port>/`.
//
// Hier ist der Server schon da. Aus „Programm startet Server" wird „Programm
// findet Server", und der größte Teil der Arbeit war deshalb Streichung:
//
//   boot() mit den drei dynamischen import()  ·  serverMod.startApi()
//   bindVault / switchVault / pickVault       ·  richteDossierOrdnerEin()
//   API_SECRET + additionalArguments          ·  process.chdir(userData)
//
// ── Warum die Oberfläche nicht angefasst werden muss ────────────────────────
//
// `web/src/api.ts` setzt `BASE = "/api"`, der Live-Kanal öffnet
// `new EventSource("/api/events?ticket=…")`, der Datei-Download baut
// `/api/files/download?id=…&token=…`. Alles relativ. Ob die Seite von
// `127.0.0.1:3000` oder von `https://patio.sima.intern` kommt, ist ihr gleich
// — die Hülle muss nur die richtige Herkunft laden.
//
// ── Was hier bewusst NICHT steht ────────────────────────────────────────────
//
// **Keine Behandlung von `certificate-error`.** Chromium entscheidet allein,
// ob es dem Zertifikat der internen CA traut. Eine freundliche Meldung ja
// (siehe `zeigeEinrichtung`), ein `event.preventDefault()` nein — das wäre
// genau die Gewöhnung an weggeklickte Warnungen, die schlimmer ist als gar
// keine Warnung.
//
// **Kein Vertrag mit der Oberfläche.** Die Hülle exponiert der Server-Seite
// nichts (siehe `preload.cjs`). Damit kann zwischen Hülle und Oberfläche
// nichts aus dem Takt geraten, und eine Versionsprüfung erübrigt sich.
//
// **Keine Erinnerungen.** Die Vorlage holt dafür minütlich `/api/tasks` und
// `/api/termine` aus dem Hauptprozess. Am Server braucht die API ein JWT, und
// das liegt im `localStorage` des Renderers — der Hauptprozess kommt nicht
// heran. Der richtige Ort ist der Server (AP14): er kennt die Fälligkeiten
// ohnehin und erreicht damit alle Arbeitsplätze gleich. Bis dahin gibt es
// hier keine Erinnerungen, statt einer halben Lösung mit zweitem Token.
// ============================================================

import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  net,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ICON_DATA_URL, TRAY_ICON_DATA_URL } from "./app-icon.js";
import { loadConfig, getRecent, rememberServer } from "./server-store.js";
import { normalisiereAdresse, erklaereFehler } from "./adresse.js";

// Das Paket ist ESM (`"type": "module"`), dort gibt es kein `__dirname`.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Kennung: dauerhaft getrennt von PATIO Desktop ────────────────────────────
//
// Beide Programme bleiben nebeneinander bestehen. Electron leitet den
// Konfigurationsordner aus `app.getName()` ab, NICHT aus der `appId` — gleicher
// Name hieße also derselbe Ordner `%APPDATA%/PATIO`, samt Sitzung,
// `localStorage` und Zwischenspeicher. Dieser Ordner existiert auf Julius'
// Rechner und enthält Live-Daten.
//
// Der sichtbare Name bleibt „PATIO" (so ist es gewollt), der Ordner weicht ab.
// Beides muss VOR dem ersten `getPath("userData")` stehen — auch vor dem ersten
// Aufruf in `server-store.ts`.
//
// Die Ausnahme: ein ausdrücklich übergebenes `--user-data-dir` gewinnt. Ohne
// diese Zeile wäre das gepackte Programm nicht gegen ein Wegwerf-Profil
// prüfbar — der Override zöge die Prüfung immer in die echten Benutzerdaten.
// Genau so ist in diesem Projekt schon einmal ein Verifikationslauf gelaufen,
// der nichts bewies. Im Normalbetrieb wird der Schalter nie gesetzt.
app.setName("PATIO");
const eigenesDatenverzeichnis = process.argv.some((a) => a.startsWith("--user-data-dir"));
if (!eigenesDatenverzeichnis) {
  app.setPath("userData", path.join(app.getPath("appData"), "PATIO-Arbeitsplatz"));
}

let mainWindow: BrowserWindow | null = null;
let docsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayAvailable = false;
let isQuitting = false;

/** Die Adresse, gegen die gerade gearbeitet wird (normalisiert, ohne Pfad). */
let serverAdresse: string | null = null;

/** Wie lange auf `/api/health` gewartet wird, bevor der Server als nicht
 *  erreichbar gilt. Großzügig, weil ein Bürorechner morgens auch mal aus dem
 *  Standby kommt — aber kurz genug, dass niemand vor einem toten Fenster
 *  sitzt und rät. */
const HEALTH_TIMEOUT_MS = 8000;

// ── Erreichbarkeitsprüfung ───────────────────────────────────────────────────

export interface PruefErgebnis {
  ok: boolean;
  /** Klartext für die Einrichtungsseite; nur gesetzt, wenn `ok === false`. */
  grund?: string;
}

/** Prüft, ob unter `basis` ein PATIO-Server antwortet.
 *
 *  **Hier ist `net` Pflicht, kein `fetch`.** Node bringt seinen eigenen
 *  CA-Vorrat mit und kennt den Windows-Zertifikatspeicher nicht. Ein `fetch()`
 *  im Hauptprozess scheitert deshalb am Zertifikat der internen CA — und zwar
 *  *während das Fenster daneben problemlos lädt*. Ein Fehlerbild, das ohne
 *  diesen Hinweis Stunden kostet. Electrons `net` geht über Chromiums
 *  Netzwerkschicht und damit über den System-Speicher, also über dieselbe
 *  Vertrauenskette wie das Fenster.
 *
 *  `/api/health` liegt in `src/api/server.ts:111` und damit **vor**
 *  `app.use("/api/*", authMiddleware)` (Z. 419). Hono trifft Routen in
 *  Registrierungsreihenfolge — die Prüfung braucht also keine Anmeldung. */
export function pruefeServer(basis: string): Promise<PruefErgebnis> {
  return new Promise((resolve) => {
    let erledigt = false;
    const fertig = (e: PruefErgebnis): void => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(uhr);
      resolve(e);
    };

    const anfrage = net.request({ method: "GET", url: `${basis}/api/health` });

    // `net.request` bringt keinen eigenen Zeitablauf mit. Ohne diesen Timer
    // hinge die Einrichtungsseite bei einer Adresse, die zwar auflöst, aber
    // nicht antwortet (Firewall verwirft die Pakete stumm), bis Chromium
    // irgendwann selbst aufgibt.
    const uhr = setTimeout(() => {
      anfrage.abort();
      fertig({ ok: false, grund: "Der Server hat nicht geantwortet (Zeitüberschreitung)." });
    }, HEALTH_TIMEOUT_MS);

    anfrage.on("response", (antwort) => {
      // Der Rumpf muss gelesen werden, sonst gilt die Anfrage als offen.
      antwort.on("data", () => {});
      antwort.on("end", () => {
        if (antwort.statusCode >= 200 && antwort.statusCode < 300) {
          fertig({ ok: true });
        } else {
          fertig({
            ok: false,
            grund: `Unter dieser Adresse antwortet etwas, aber kein PATIO-Server (HTTP ${antwort.statusCode}).`,
          });
        }
      });
      antwort.on("error", () => fertig({ ok: false, grund: "Die Antwort des Servers brach ab." }));
    });

    anfrage.on("error", (err) => fertig({ ok: false, grund: erklaereFehler(String(err?.message ?? err)) }));

    anfrage.end();
  });
}

// ── Fenster ──────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: "#14161b",
    title: "PATIO",
    icon: nativeImage.createFromDataURL(APP_ICON_DATA_URL),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Seit Electron 20 die Vorgabe — ausdrücklich hingeschrieben überlebt es
      // ein Versionsupdate.
      sandbox: true,
      // Der Preload gibt NUR der Einrichtungsseite einen Rückkanal, der
      // Server-Oberfläche nichts. Begründung dort.
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // Erst zeigen, wenn etwas darzustellen ist — sonst blitzt ein leeres Fenster
  // auf, während die Verbindung zum Server aufgebaut wird.
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Schließen = in den Tray minimieren, solange ein Tray da ist und nicht
  // wirklich beendet wird. Echtes Beenden läuft über before-quit.
  mainWindow.on("close", (e) => {
    if (!isQuitting && trayAvailable) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Fremde Herkunft nie im Programmfenster öffnen. Ein Link aus der Oberfläche
  // auf eine externe Seite gehört in den System-Browser; das Fenster bleibt
  // beim Server.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!serverAdresse) return;
    if (url.startsWith(serverAdresse) || url.startsWith("file://")) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  // ── Wenn der Server nicht antwortet ────────────────────────────────────────
  //
  // Der Aufhänger ist bewusst `did-fail-load` und nicht nur der Erstaufruf:
  // die Oberfläche schickt bei einem 401 `window.location.href = "/login"`
  // (`web/src/api.ts:50`). Ist der Server in dem Moment weg, scheitert GENAU
  // DIESE Navigation — und ohne Behandlung sähe der Benutzer Chromiums
  // Fehlerseite statt einer Erklärung.
  mainWindow.webContents.on("did-fail-load", (_e, code, beschreibung, url, istHauptrahmen) => {
    if (!istHauptrahmen) return;
    // -3 = ERR_ABORTED. Entsteht bei jeder abgelösten Navigation (Reload,
    // Weiterleitung) und ist kein Fehler.
    if (code === -3) return;
    // Die Einrichtungsseite selbst darf nicht in eine Schleife laufen.
    if (url.startsWith("file://")) return;
    void zeigeEinrichtung(erklaereFehler(`${beschreibung} ${url}`));
  });

  // Downloads: Der Download-Link trägt das JWT im Abfrageteil
  // (`FileBrowserView.vue:496`). Electron führt keinen dauerhaften
  // Download-Verlauf — das Token landet also nirgends auf der Platte. Was hier
  // dennoch gebraucht wird, ist eine Rückmeldung: ohne sie verschwindet eine
  // fehlgeschlagene Datei kommentarlos.
  mainWindow.webContents.session.on("will-download", (_e, item) => {
    item.once("done", (_ev, zustand) => {
      if (zustand === "completed") {
        shell.showItemInFolder(item.getSavePath());
      } else if (zustand === "interrupted") {
        void dialog.showMessageBox({
          type: "warning",
          title: "Download abgebrochen",
          message: `„${item.getFilename()}" konnte nicht vollständig geladen werden.`,
          detail: "Verbindung zum Server prüfen und erneut versuchen.",
        });
      }
    });
  });
}

/** Fenster zeigen/fokussieren (aus Tray oder zweitem Start); ggf. neu erzeugen. */
function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    void oeffneServerOderEinrichtung();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Offline-Dokumentation in einem eigenen Fenster (vom Server unter `/docs/`).
 *  Reines statisches HTML → kein Preload nötig. */
function openDocs(): void {
  if (!serverAdresse) return;
  if (docsWindow && !docsWindow.isDestroyed()) {
    docsWindow.show();
    docsWindow.focus();
    return;
  }
  docsWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#ffffff",
    title: "PATIO — Dokumentation",
    icon: nativeImage.createFromDataURL(APP_ICON_DATA_URL),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  docsWindow.setMenuBarVisibility(false);
  void docsWindow.loadURL(`${serverAdresse}/docs/`);
  docsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  docsWindow.on("closed", () => {
    docsWindow = null;
  });
}

// ── Einrichtung und Fehleranzeige (dieselbe Seite) ───────────────────────────

/** Lädt die Einrichtungsseite ins Hauptfenster. Sie hat zwei Aufgaben in
 *  einem: Ersteinrichtung und Fehleranzeige. Bewusst kein zweites Fenster und
 *  kein IPC-Gerüst — eine lokale HTML-Datei plus ein einziger Rückkanal. */
async function zeigeEinrichtung(fehler?: string): Promise<void> {
  if (!mainWindow) createWindow();
  const abfrage = new URLSearchParams();
  if (serverAdresse) abfrage.set("adresse", serverAdresse);
  if (fehler) abfrage.set("fehler", fehler);
  await mainWindow?.loadFile(path.join(__dirname, "einrichtung.html"), {
    search: abfrage.toString(),
  });
  mainWindow?.show();
}

/** Öffnet die gemerkte Adresse — oder die Einrichtungsseite, wenn es keine
 *  gibt bzw. der Server nicht antwortet.
 *
 *  Auflösungsreihenfolge: gemerkte Adresse → `PATIO_SERVER` → Einrichtung. */
async function oeffneServerOderEinrichtung(): Promise<void> {
  const cfg = loadConfig();
  const kandidat = cfg.lastServer ?? normalisiereAdresse(process.env.PATIO_SERVER ?? "");
  if (!kandidat) {
    await zeigeEinrichtung();
    return;
  }
  serverAdresse = kandidat;
  buildMenu();

  // **Hier wird bewusst NICHT gemerkt.** Kommt die Adresse aus `PATIO_SERVER`,
  // soll sie das auch bleiben: würde sie einmal gespeichert, gewänne sie ab dem
  // nächsten Start gegen die Umgebungsvariable (Auflösung ist gemerkt > env) —
  // und eine spätere Änderung durch die Verwaltung liefe ins Leere, ohne dass
  // das irgendwo sichtbar wäre. Genau diese Falle ist in PATIO Desktop schon
  // zugeschlagen: ein zweiter Start mit abweichendem `VAULT_PATH` band weiter
  // den gemerkten Vault, und die Prüfung „bewies" eine Trennung, die es nicht
  // gab. Gemerkt wird nur, was jemand von Hand einträgt (siehe den
  // ipcMain-Behandler unten).
  const ergebnis = await pruefeServer(kandidat);
  if (!ergebnis.ok) {
    await zeigeEinrichtung(ergebnis.grund);
    return;
  }
  await mainWindow?.loadURL(`${kandidat}/`);
  mainWindow?.show();
}

/** Der einzige Rückkanal aus der Einrichtungsseite. Nimmt eine Eingabe
 *  entgegen, prüft sie und übernimmt sie bei Erfolg. */
ipcMain.handle("patio:server-pruefen", async (_e, eingabe: unknown): Promise<PruefErgebnis> => {
  const adresse = normalisiereAdresse(typeof eingabe === "string" ? eingabe : "");
  if (!adresse) {
    return { ok: false, grund: "Das ist keine gültige Adresse. Beispiel: patio.sima.intern" };
  }
  const ergebnis = await pruefeServer(adresse);
  if (!ergebnis.ok) return ergebnis;

  rememberServer(adresse);
  serverAdresse = adresse;
  buildMenu();
  await mainWindow?.loadURL(`${adresse}/`);
  return { ok: true };
});

/** „Erneut versuchen" auf der Fehlerseite: dieselbe Adresse noch einmal. */
ipcMain.handle("patio:erneut-versuchen", async (): Promise<PruefErgebnis> => {
  if (!serverAdresse) return { ok: false, grund: "Es ist keine Adresse hinterlegt." };
  const ergebnis = await pruefeServer(serverAdresse);
  if (!ergebnis.ok) return ergebnis;
  await mainWindow?.loadURL(`${serverAdresse}/`);
  return { ok: true };
});

// ── Tray ─────────────────────────────────────────────────────────────────────

/** Tray-Icon + Kontextmenü. Best effort: scheitert die Erzeugung (z.B. kein
 *  Infobereich), läuft die App ohne Tray weiter und beendet sich dann beim
 *  Schließen des Fensters. */
function createTray(): void {
  if (tray) return;
  try {
    tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON_DATA_URL));
    tray.setToolTip("PATIO");
    tray.on("double-click", () => showWindow());
    updateTrayMenu();
    trayAvailable = true;
  } catch (err) {
    console.error("[Tray] konnte nicht erstellt werden — App läuft ohne Tray:", err);
    trayAvailable = false;
  }
}

function updateTrayMenu(): void {
  if (!tray) return;
  const autostart = app.getLoginItemSettings().openAtLogin;
  const items: MenuItemConstructorOptions[] = [
    { label: "PATIO öffnen", click: () => showWindow() },
    { type: "separator" },
    {
      label: "Mit Windows starten",
      type: "checkbox",
      checked: autostart,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        updateTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: "Beenden",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

// ── Menü ─────────────────────────────────────────────────────────────────────

function buildMenu(): void {
  const recent = getRecent();
  const recentItems: MenuItemConstructorOptions[] = recent.length
    ? recent.map((adresse) => ({
        label: adresse === serverAdresse ? `● ${adresse}` : adresse,
        click: () => void wechsleServer(adresse),
      }))
    : [{ label: "(noch keine)", enabled: false }];

  const template: MenuItemConstructorOptions[] = [
    {
      label: "Datei",
      submenu: [
        {
          label: "Server wechseln…",
          accelerator: "CmdOrCtrl+O",
          click: () => void zeigeEinrichtung(),
        },
        { label: "Zuletzt verwendet", submenu: recentItems },
        { type: "separator" },
        {
          label: "Beenden",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: "Ansicht",
      submenu: [
        { role: "reload", label: "Neu laden" },
        { role: "toggleDevTools", label: "Entwicklertools" },
        { type: "separator" },
        { role: "resetZoom", label: "Zoom zurücksetzen" },
        { role: "zoomIn", label: "Vergrößern" },
        { role: "zoomOut", label: "Verkleinern" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Vollbild" },
      ],
    },
    {
      label: "Hilfe",
      submenu: [{ label: "Dokumentation", accelerator: "F1", click: () => openDocs() }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Auf eine andere Serveradresse umschalten (aus „Zuletzt verwendet"). */
async function wechsleServer(adresse: string): Promise<void> {
  serverAdresse = adresse;
  const ergebnis = await pruefeServer(adresse);
  if (!ergebnis.ok) {
    await zeigeEinrichtung(ergebnis.grund);
    return;
  }
  rememberServer(adresse);
  buildMenu();
  await mainWindow?.loadURL(`${adresse}/`);
}

// ── Start ────────────────────────────────────────────────────────────────────

// Einzelinstanz-Sperre. Ohne sie öffnet ein zweiter Klick auf die Verknüpfung
// ein zweites Fenster mit eigener Sitzung. Im Büro passiert das sicher, weil
// das Fenster beim Schließen in den Tray verschwindet und Leute es dann
// „nochmal starten".
const einzelInstanz = app.requestSingleInstanceLock();
if (!einzelInstanz) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  void app.whenReady().then(async () => {
    buildMenu();
    createTray();
    createWindow();
    await oeffneServerOderEinrichtung();
  });

  // macOS: Fenster neu öffnen, wenn keins offen ist.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) showWindow();
  });

  // Mit Tray lebt die App im Hintergrund weiter; ohne Tray das übliche
  // Verhalten.
  app.on("window-all-closed", () => {
    if (trayAvailable) return;
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });
}
