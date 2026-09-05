import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture, namensraum } from "./helpers/acl-fixture.js";

// Das Board für den Besprechungsraum — und die dritte Rolle dahinter.
//
// ── Was hier wirklich geprüft wird ─────────────────────────────────────────
//
// Nicht, ob die Kacheln hübsch sind. Sondern die drei Zusicherungen, die die
// Rolle überhaupt erst rechtfertigen:
//
//   1. SCHREIBSCHUTZ. Ein Gerät, an dem niemand sitzt und das den ganzen Tag
//      läuft, darf nichts ändern können. Es gibt 94 schreibende Endpunkte —
//      geprüft wird deshalb die MIDDLEWARE, nicht jede Route einzeln.
//   2. KEINE BETRÄGE. In dem Raum sitzen auch Bauherren.
//   3. KEINE KONTAKTDATEN. `GET /api/team` liefert sonst jedem angemeldeten
//      Konto E-Mail und Telefonnummer aller Mitglieder.
describe.skipIf(!HAS_DB)("Board und Präsentationsrolle", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;
  const P = `board-${namensraum()}`;
  let boardToken = "";

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("board", { geldRecht: true });
    ({ getDb } = await import("../src/db/client.js"));

    // Ein Präsentationskonto anlegen — über die reguläre Verwaltungsroute,
    // nicht per SQL: nur so wird auch geprüft, dass die Rolle dort überhaupt
    // durchkommt.
    const angelegt = await fx.app.request("/api/admin/users", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ username: `${P}-anzeige`, password: "AnzeigeKonto2026!x", role: "praesentation" }),
    });
    expect([200, 201]).toContain(angelegt.status);

    const anmeldung = await fx.app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: `${P}-anzeige`, password: "AnzeigeKonto2026!x" }),
    });
    expect(anmeldung.status).toBe(200);
    boardToken = ((await anmeldung.json()) as { token: string }).token;

    // Ein Team-Mitglied mit Kontaktdaten, an dem der Filter sichtbar wird.
    await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({
        name: `${P}-kontakt`,
        memberType: "Intern",
        email: "geheim@example.at",
        phone: "+43 316 999",
      }),
    });
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await getDb()`DELETE FROM team_members WHERE name LIKE ${P + "%"}`;
    await getDb()`DELETE FROM users WHERE username LIKE ${P + "%"}`;
    await fx.cleanup();
  });

  // ── 1. Die Rolle kommt überhaupt durch ───────────────────────────────────

  it("ein unbekanntes Rollenwort wird abgelehnt statt still zu Benutzer", async () => {
    // Vorher: `body.role === "admin" ? "admin" : "user"` — ein Vertipper ergab
    // wortlos ein Benutzerkonto. Mit einer dritten Rolle ist das kein
    // Schönheitsfehler mehr: ein Präsentationskonto, das sich stillschweigend
    // in ein normales verwandelt, darf danach schreiben.
    const res = await fx.app.request("/api/admin/users", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ username: `${P}-tippfehler`, password: "IrgendeinPasswort2026!", role: "praesentaton" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Unbekannte Rolle");
  });

  it("die Rolle bleibt nach dem Anmelden erhalten", async () => {
    const res = await fx.app.request("/api/auth/me", { headers: authHeader(boardToken) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { role: string }).role).toBe("praesentation");
  });

  // ── 2. Schreibschutz ─────────────────────────────────────────────────────

  it.each([
    ["POST", "/api/tasks", { text: "Board darf das nicht" }],
    ["POST", "/api/notes", { content: "Board darf das nicht" }],
    ["POST", "/api/team", { name: "Board darf das nicht" }],
    ["PATCH", "/api/me/preferences", { theme: "dark" }],
  ])("%s %s wird abgewiesen", async (methode, pfad, koerper) => {
    const res = await fx.app.request(pfad, {
      method: methode,
      headers: jsonHeader(boardToken),
      body: JSON.stringify(koerper),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("Anzeige");
  });

  it("lesen darf es dagegen", async () => {
    const res = await fx.app.request("/api/board/heute", { headers: authHeader(boardToken) });
    expect(res.status).toBe(200);
  });

  // ── 3. Keine Beträge ─────────────────────────────────────────────────────

  it("das Board sieht keine Beträge — auch wenn jemand das Recht setzt", async () => {
    // Der gefährliche Fall: ein versehentlich gesetzter Schalter im
    // Benutzerdialog. Die Rolle muss ihn überstimmen.
    await getDb()`UPDATE users SET can_see_money = true WHERE username = ${P + "-anzeige"}`;
    const res = await fx.app.request("/api/portfolio", { headers: authHeader(boardToken) });
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const feld of ["budget", "betrag", "hourlyRate", "honorar"]) {
      expect(text.toLowerCase(), feld).not.toContain(`"${feld.toLowerCase()}"`);
    }
  });

  // ── 4. Keine Kontaktdaten ────────────────────────────────────────────────

  it("das Board sieht weder E-Mail noch Telefonnummer", async () => {
    const res = await fx.app.request("/api/team", { headers: authHeader(boardToken) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(`${P}-kontakt`); // der NAME bleibt — ohne ihn wäre das Board leer
    expect(text).not.toContain("geheim@example.at");
    expect(text).not.toContain("+43 316 999");
  });

  it("ein normales Konto sieht die Kontaktdaten weiterhin", async () => {
    // Die Gegenrichtung: der Filter darf nicht „funktionieren", indem er für
    // alle greift. Das Büro braucht den Kollegenkatalog.
    const res = await fx.app.request("/api/team", { headers: authHeader(fx.a.token) });
    const text = await res.text();
    expect(text).toContain("geheim@example.at");
  });

  // ── 5. Die Board-Endpunkte selbst ────────────────────────────────────────

  it.each(["/api/board/heute", "/api/board/aufgaben", "/api/board/projekte", "/api/board/woche"])(
    "%s antwortet",
    async (pfad) => {
      const res = await fx.app.request(pfad, { headers: authHeader(boardToken) });
      expect(res.status).toBe(200);
    },
  );

  it("das Board sieht alle Projekte, ein normales Konto nur seine", async () => {
    // Der Grund für die Rolle: ein Board, das nur einen Ausschnitt zeigt, wäre
    // irreführend — es hängt im Raum und beantwortet „was ist heute los".
    const alsBoard = (await (
      await fx.app.request("/api/board/projekte", { headers: authHeader(boardToken) })
    ).json()) as { name: string }[];
    const alsB = (await (await fx.app.request("/api/board/projekte", { headers: authHeader(fx.b.token) })).json()) as {
      name: string;
    }[];

    const namenBoard = alsBoard.map((p) => p.name);
    expect(namenBoard).toContain(fx.projectName);
    expect(namenBoard).toContain(fx.projectBName);
    // B ist teil-berechtigt und sieht nur sein eigenes.
    expect(alsB.map((p) => p.name)).not.toContain(fx.projectName);
  });

  it("die Projektliste des Boards führt gar keine Geldfelder", async () => {
    // Bewusst nicht abgefragt statt nachträglich gefiltert: sich auf einen
    // Filter zu verlassen ist schwächer, als die Spalte nie zu lesen.
    const res = await fx.app.request("/api/board/projekte", { headers: authHeader(fx.admin.token) });
    const text = await res.text();
    expect(text).not.toContain("budget");
  });

  // ── 6. Die Reichweite der Rolle, festgehalten ────────────────────────────
  //
  // ⚠ Dieser Block ist ein WÄCHTER, keine Funktionsprüfung.
  //
  // Seit `canSeeProject` die Ausnahme für diese Rolle trägt (src/data/access.ts),
  // erreicht das Board die Detailrouten — also auch Notizinhalte, Bautagebuch
  // und Besprechungsprotokolle. Das ist gewollt und war die Entscheidung; es
  // ist zugleich eine spürbare Ausweitung, und ausgerechnet bei den
  // vertraulichsten Freitexten.
  //
  // Was das Konto erreicht und was nicht, steht deshalb hier als Liste. Wer
  // die Rolle später erweitert, sieht in der Diff genau, was er aufmacht —
  // ohne diesen Block wüchse die Reichweite beim nächsten Umbau lautlos mit.

  it.each([
    ["die Projektakte", "/api/projects/:p"],
    ["die Notiztitel des Projekts", "/api/projects/:p/notes"],
    ["die Aufgaben des Projekts", "/api/projects/:p/tasks"],
    ["die Termine des Projekts", "/api/projects/:p/termine"],
    ["die Besprechungen des Projekts", "/api/projects/:p/meetings"],
    ["das Projekt-Dossier", "/api/projects/:p/export.md"],
  ])("das Board darf %s lesen", async (_was, muster) => {
    const pfad = muster.replace(":p", encodeURIComponent(fx.projectName));
    const res = await fx.app.request(pfad, { headers: authHeader(boardToken) });
    expect(res.status).toBe(200);
  });

  it.each([
    ["den Volldump", "/api/exports/volldump"],
    ["den Word-Bericht", "/api/exports/project/:p/summary"],
    ["die Auskunft über PDF-Fähigkeit", "/api/exports/faehigkeiten"],
    ["die KI-Akten", "/api/ki/dossier"],
    ["den Freigabestand der KI", "/api/ki/freigabe"],
  ])("das Board bekommt %s NICHT", async (_was, muster) => {
    const pfad = muster.replace(":p", encodeURIComponent(fx.projectName));
    const res = await fx.app.request(pfad, { headers: authHeader(boardToken) });
    expect(res.status).toBe(403);
  });

  it("das Board kann keine Datei herunterladen", async () => {
    // Der Dateizugriff wird über einen ANDEREN Weg geprüft als alles übrige:
    // `canAccessFile` (routes/files.ts) fragt `listVisibleProjectIds(userId)`
    // direkt statt über `canSeeProject`. Ein Anzeigekonto hat keine
    // `user_projects`-Zeilen, also bleibt der Weg zu. Das ist eine
    // Unstimmigkeit — sie zeigt in die sichere Richtung, und ein Board
    // braucht keine Pläne. Sollte jemand `canAccessFile` später
    // vereinheitlichen, fällt diese Prüfung um und die Entscheidung wird
    // wieder bewusst getroffen.
    const [datei] = await getDb()`
      INSERT INTO files (project_id, filename, filepath, mime_type, blob)
      VALUES (${fx.projectId}, ${P + "-plan.txt"}, ${P + "-plan.txt"}, 'text/plain', ${Buffer.from("GEHEIMER-PLAN")})
      RETURNING id`;
    try {
      const res = await fx.app.request(`/api/files/download?id=${String(datei.id)}`, {
        headers: authHeader(boardToken),
      });
      expect(res.status).toBe(403);
    } finally {
      await getDb()`DELETE FROM files WHERE id = ${String(datei.id)}`;
    }
  });

  // ── 6b. Zwei Wege, die am Datei-Verbot vorbeiführten ─────────────────────
  //
  // ⚠ Beide waren dem Wächter oben nicht bekannt. Er hielt fest, dass das
  // Board keine Datei HERUNTERLADEN kann — nicht, dass es auch nichts über
  // sie erfährt.

  it("die Suche liefert dem Board keine Datei-Treffer", async () => {
    // `GET /api/search` ist 48 Zeilen lang und prüfte keine Rolle. Über
    // `getVisibleProjectIds` bekam die Anzeige „all" und damit Dateinamen UND
    // die ersten 200 Zeichen des extrahierten Dokumenttextes — aus jedem
    // Projekt des Hauses. Weder der Geld- noch der Personendaten-Filter
    // greifen: beide entfernen Felder nach NAMEN, der Inhalt steckt im
    // Freitextfeld `snippet`.
    const [datei] = await getDb()`
      INSERT INTO files (project_id, filename, filepath, mime_type, content_text, blob)
      VALUES (${fx.projectId}, ${P + "-Honorarvereinbarung.pdf"}, ${P + "-Honorarvereinbarung.pdf"},
              'application/pdf', ${P + " GEHEIMER-VERTRAGSTEXT"}, ${Buffer.from("x")})
      RETURNING id`;
    try {
      const suche = async (token: string) => {
        const res = await fx.app.request(`/api/search?q=${encodeURIComponent(P)}`, { headers: authHeader(token) });
        expect(res.status).toBe(200);
        return ((await res.json()) as { results: { type: string; title: string; snippet: string }[] }).results;
      };

      // Gegenrichtung zuerst: ein normales Konto findet die Datei sehr wohl.
      // Ohne diese Zeile wäre die Prüfung darunter auch dann grün, wenn die
      // Suche für alle kaputt ist.
      const alsA = await suche(fx.a.token);
      expect(
        alsA.filter((t) => t.type === "file").length,
        "die Suche findet für ein normales Konto gar keine Dateien",
      ).toBeGreaterThan(0);

      const alsBoard = await suche(boardToken);
      expect(
        alsBoard.filter((t) => t.type === "file"),
        "das Board bekommt Datei-Treffer",
      ).toHaveLength(0);
      const text = JSON.stringify(alsBoard);
      expect(text).not.toContain("Honorarvereinbarung");
      expect(text).not.toContain("GEHEIMER-VERTRAGSTEXT");
    } finally {
      await getDb()`DELETE FROM files WHERE id = ${String(datei.id)}`;
    }
  });

  it("ein Datei-Ereignis trägt die ID, nicht den Dateinamen", async () => {
    // Über den Live-Kanal bekam die Anzeige die Dateinamen aller Projekte —
    // beim Hochladen sogar eine kommagetrennte Liste. Die Begründung in
    // `geld.ts` („die Ereignisse tragen keine Nutzdaten, nur Typ und ID")
    // stimmte für Dateien nicht: die ID WAR der Dateiname.
    //
    // Geprüft am Quelltext, weil sich ein SSE-Strom in dieser Suite nicht
    // aufmachen lässt — und weil genau die beiden `emit`-Zeilen der Punkt
    // sind, nicht der Kanal.
    const { readFileSync } = await import("node:fs");
    const quelle = readFileSync("src/api/routes/files.ts", "utf8");
    expect(quelle, "der Dateiname geht wieder über den Live-Kanal").not.toMatch(
      /type:\s*"file"[^}]*id:\s*(file\.filename|saved\.join)/,
    );
  });

  // ── 7. Kontaktdaten in Antworten, die kein JSON sind ─────────────────────
  //
  // Der Personendaten-Filter fasst NUR `application/json` an. Solange die
  // Rolle keine Detailrouten lesen durfte, fiel das nicht auf — seit sie es
  // darf, ist `export.md` (text/markdown) der Weg neben der Tür.

  it("das Dossier führt für das Board keine Kontaktdaten", async () => {
    // Das Team-Mitglied dem Projekt zuordnen, sonst steht es gar nicht im
    // Dossier und die Prüfung wäre trivial grün.
    await getDb()`
      UPDATE team_members SET project_id = ${fx.projectId} WHERE name = ${P + "-kontakt"}`;

    const alsBoard = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/export.md`, {
      headers: authHeader(boardToken),
    });
    expect(alsBoard.status).toBe(200);
    const textBoard = await alsBoard.text();
    expect(textBoard).toContain(`${P}-kontakt`); // der Name bleibt
    expect(textBoard).not.toContain("geheim@example.at");
    expect(textBoard).not.toContain("+43 316 999");

    // Gegenrichtung: das Büro braucht die Kontaktdaten weiterhin. Ein Filter,
    // der für alle greift, wäre kein Filter, sondern ein Ausbau.
    const alsAdmin = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/export.md`, {
      headers: authHeader(fx.admin.token),
    });
    expect(await alsAdmin.text()).toContain("geheim@example.at");
  });

  // ── 8. Datenabflüsse stehen im Prüfprotokoll ─────────────────────────────

  it("ein gezogenes Dossier hinterlässt einen Protokolleintrag", async () => {
    // Bei einer Datenschutz-Frage über Bauherrendaten ist das die Zeile, die
    // man lesen will: wer hat wann welchen Bestand mitgenommen. Bis hierher
    // stand im Protokoll ausschließlich, wer sich anmeldet.
    await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/export.md`, {
      headers: authHeader(fx.admin.token),
    });
    // `logEvent` wird bewusst nicht abgewartet (der Export darf an einem
    // Protokolleintrag nicht hängen) — deshalb hier kurz nachfassen statt
    // einmal zu fragen und bei einem Zeitproblem einen Fehler zu behaupten.
    let details: { projekt?: string } | null = null;
    for (let versuch = 0; versuch < 20 && details === null; versuch++) {
      const zeilen = await getDb()`
        SELECT details FROM audit_log
         WHERE event = 'export.dossier' AND actor_user_id = ${fx.admin.id}
         ORDER BY ts DESC LIMIT 1`;
      if (zeilen.length > 0) details = zeilen[0].details as { projekt?: string };
      else await new Promise((f) => setTimeout(f, 50));
    }
    expect(details, "kein audit_log-Eintrag fuer export.dossier").not.toBeNull();
    expect(details?.projekt).toBe(fx.projectName);
  });
});
