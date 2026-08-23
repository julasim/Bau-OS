import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture, namensraum } from "./helpers/acl-fixture.js";

// Type-Queries fuers entity-spezifische Setup (kein Laufzeit-`any`).
type FileRepo = (typeof import("../src/data/index.js"))["fileRepo"];
type ProjectRepo = (typeof import("../src/data/index.js"))["projectRepo"];
type GetDb = (typeof import("../src/db/client.js"))["getDb"];

// Die Volltextsuche (src/data/db-search.ts) ersetzt die frueheren beiden
// Suchwege — das rekursive grep ueber Vault-Markdown und die pgvector-
// Aehnlichkeitssuche. Beide sind mit der LLM-Laufzeit entfallen.
//
// Warum diese Tests: die ALTE Suche filterte ueberhaupt nicht nach Rechten.
// Wer den Endpunkt kannte, bekam Treffer aus jedem Projekt — inklusive
// Projektnamen und Textausschnitten. Die neue Suche bekommt den Scope aus
// getVisibleProjectIds() und darf das nicht wieder verlieren. Ein Treffer
// aus einem gesperrten Projekt ist hier ein Datenleck, kein Schoenheitsfehler.
//
// Abgedeckt sind alle vier Zweige der Query (Notiz, Aufgabe, Projekt, Datei),
// weil jeder seinen eigenen Rechtefilter mitbringt: Notizen/Aufgaben/Dateien
// ueber `project_id`, Projekte ueber `id` — ein eigener Fehlerpfad.
describe.skipIf(!HAS_DB)("API — Volltextsuche: Treffer und Rechte", () => {
  let fx: AclFixture;
  let fileRepo: FileRepo;
  let projectRepo: ProjectRepo;
  let getDb: GetDb;
  let fileId = "";
  // C hat gar kein Projekt — pruef den Fall "leere Sichtbarkeit".
  let cToken = "";
  let cId = "";

  // Eindeutig genug, dass kein Altbestand in der Test-DB mitzaehlt. Jeder
  // Zweig bekommt seinen eigenen Begriff, damit die Tests sich nicht
  // gegenseitig Treffer in die Ergebnisliste schieben.
  const STAMP = namensraum();
  const BEGRIFF = `Zwischendecke${STAMP}`; // Notiz + Aufgabe
  const PROJEKT_BEGRIFF = `Dachgeschossausbau${STAMP}`; // nur Projektbeschreibung
  const DATEI_BEGRIFF = `Bewehrungsplan${STAMP}`; // nur files.content_text
  const OHNE_PROJEKT = `Privatnotiz${STAMP}`; // Notiz ohne Projektbezug
  const LIMIT_BEGRIFF = `Mengenermittlung${STAMP}`; // 6 Notizen fuer die limit-Tests
  const SORT_BEGRIFF = `Aufschliessung${STAMP}`; // 1 alte Notiz + 1 neue Datei

  const search = (token: string, q: string, project?: string, limit?: string) =>
    fx.app.request(
      `/api/search?q=${encodeURIComponent(q)}` +
        (project ? `&project=${encodeURIComponent(project)}` : "") +
        (limit !== undefined ? `&limit=${encodeURIComponent(limit)}` : ""),
      {
        headers: authHeader(token),
      },
    );
  const hits = async (res: Response) => {
    const body = (await res.json()) as {
      results: Array<{ type: string; title: string; snippet: string | null; project: string | null }>;
    };
    return body.results;
  };

  const notiz = (content: string, project?: string) =>
    fx.app.request("/api/notes", {
      method: "POST",
      // jsonHeader ist eine FUNKTION (tests/helpers/acl-fixture.ts) — ein
      // Spread davon ergibt {} und der Request ginge ohne Content-Type raus.
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify(project ? { content, project } : { content }),
    });

  beforeAll(async () => {
    fx = await setupAclFixture("such");
    ({ fileRepo, projectRepo } = await import("../src/data/index.js"));
    ({ getDb } = await import("../src/db/client.js"));

    // Notiz und Aufgabe mit dem Begriff in A's Projekt anlegen. Das Projekt
    // selbst traegt ihn nicht — so laesst sich pruefen, dass wirklich die
    // Inhalte durchsucht werden und nicht nur der Projektname.
    await notiz(`Statik der ${BEGRIFF} pruefen`, fx.projectName);
    await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: `${BEGRIFF} vermessen`, project: fx.projectName }),
    });

    // Projekt-Zweig: Begriff NUR in der Beschreibung von A's Projekt.
    await projectRepo.update(fx.projectName, { description: `Sanierung, ${PROJEKT_BEGRIFF}, LPH 1-5` });

    // Datei-Zweig: Begriff NUR im extrahierten Dokumenttext, nicht im
    // Dateinamen — das ist die sensibelste Quelle der ganzen Suche.
    const entry = await fileRepo.save({
      filename: "plan.txt",
      filepath: "plan.txt",
      filesize: 42,
      mimeType: "text/plain",
      project: fx.projectName,
      contentText: `Position 3: ${DATEI_BEGRIFF} fuer die Bodenplatte`,
      uploadedById: fx.a.id,
    });
    fileId = entry.id;

    // Notiz OHNE Projekt (von A angelegt): darf fuer Nicht-Admins unsichtbar
    // bleiben — ohne Projekt gibt es keinen Anhaltspunkt fuer die Rechte.
    await notiz(`${OHNE_PROJEKT} — Gedanken zum Wettbewerb`);

    // Sechs Notizen fuer die limit-Tests (eine Kategorie, damit sichtbar wird,
    // ob eine Kategorie das ganze Budget nutzen darf).
    for (let i = 1; i <= 6; i++) {
      await notiz(`${LIMIT_BEGRIFF} Blatt ${i}`, fx.projectName);
    }

    // Sortier-Fall: alte Notiz, neue Datei. Die Zeitstempel werden fest
    // gesetzt, damit der Test nicht von der Ausfuehrungsdauer abhaengt.
    await notiz(`${SORT_BEGRIFF} Bestand`, fx.projectName);
    await fileRepo.save({
      filename: `${SORT_BEGRIFF}.txt`,
      filepath: `${SORT_BEGRIFF}.txt`,
      filesize: 12,
      mimeType: "text/plain",
      project: fx.projectName,
      uploadedById: fx.a.id,
    });
    const db = getDb();
    await db`UPDATE notes SET updated_at = '2020-01-01T00:00:00Z' WHERE content LIKE ${"%" + SORT_BEGRIFF + "%"}`;
    await db`UPDATE files SET updated_at = now() WHERE filename = ${SORT_BEGRIFF + ".txt"}`;

    // Escape-Fall: eine Notiz mit Unterstrich, eine ohne. Ohne Escaping matcht
    // die Suche nach dem Namen MIT Unterstrich auch die Variante ohne.
    await notiz(`Grundriss_EG${STAMP} freigegeben`, fx.projectName);
    await notiz(`GrundrissXEG${STAMP} freigegeben`, fx.projectName);

    // Nutzer C: angelegt, aber keinem Projekt zugewiesen.
    const { createDbUser, createToken } = await import("../src/api/auth.js");
    const c = await createDbUser({ username: `such-c-${STAMP}`, password: "test-pw-123", role: "user" });
    cId = c.id;
    cToken = createToken(c.username, c.role, c.id);
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const db = getDb();
    // Notizen/Aufgaben haengen per ON DELETE SET NULL am Projekt — das
    // Projekt-Cleanup der Fixture raeumt sie NICHT mit weg, sie blieben als
    // projektlose Waisen liegen. Der Zeitstempel im Begriff macht das
    // Aufraeumen eindeutig.
    await db`DELETE FROM notes WHERE content LIKE ${"%" + STAMP + "%"}`;
    await db`DELETE FROM tasks WHERE text LIKE ${"%" + STAMP + "%"}`;
    await db`DELETE FROM files WHERE filename LIKE ${"%" + STAMP + "%"}`;
    if (fileId) await fileRepo.delete(fileId);
    if (cId) await db`DELETE FROM users WHERE id = ${cId}`;
    await fx.cleanup();
  });

  it("findet Notiz und Aufgabe ueber den Inhalt, nicht nur ueber den Titel", async () => {
    const res = await search(fx.a.token, BEGRIFF);
    expect(res.status).toBe(200);
    const typen = (await hits(res)).map((h) => h.type).sort();
    expect(typen).toContain("note");
    expect(typen).toContain("task");
  });

  it("findet Wortfragmente (Teilwortsuche)", async () => {
    const res = await search(fx.a.token, BEGRIFF.slice(4, 12));
    expect((await hits(res)).length).toBeGreaterThan(0);
  });

  // Der Kern: B ist teil-berechtigt (sieht sein eigenes Projekt, nicht A's).
  // Ein kaputter Filter "alle sichtbar" wuerde A's Treffer hier durchlassen.
  it("Confinement: Fremder (B) bekommt KEINEN Treffer aus A's Projekt", async () => {
    const res = await search(fx.b.token, BEGRIFF);
    expect(res.status).toBe(200);
    expect(await hits(res)).toHaveLength(0);
  });

  it("Admin sieht die Treffer (Scope 'all')", async () => {
    expect((await hits(await search(fx.admin.token, BEGRIFF))).length).toBeGreaterThan(0);
  });

  it("Projektfilter grenzt ein; ein unbekannter Projektname liefert leer", async () => {
    expect((await hits(await search(fx.a.token, BEGRIFF, fx.projectName))).length).toBeGreaterThan(0);
    expect(await hits(await search(fx.a.token, BEGRIFF, "GibtsSicherNicht"))).toHaveLength(0);
  });

  // B darf sein eigenes Projekt sehen — der Filter darf ihn nicht generell
  // aussperren, sondern nur fremde Projekte ausblenden.
  it("Projektfilter auf ein fremdes Projekt liefert B nichts", async () => {
    expect(await hits(await search(fx.b.token, BEGRIFF, fx.projectName))).toHaveLength(0);
  });

  it("ohne Suchbegriff → 400, ohne Token → 401", async () => {
    expect((await fx.app.request("/api/search", { headers: authHeader(fx.a.token) })).status).toBe(400);
    expect((await fx.app.request(`/api/search?q=${BEGRIFF}`)).status).toBe(401);
  });

  // ── Projekt-Zweig ────────────────────────────────────────────────────────
  // Eigener Fehlerpfad: dieser Zweig filtert ueber `id = ANY(...)`, alle
  // anderen ueber `project_id`. Ein Vertipper faellt sonst nirgends auf.
  it("findet ein Projekt ueber die Beschreibung", async () => {
    const treffer = await hits(await search(fx.a.token, PROJEKT_BEGRIFF));
    expect(treffer.map((h) => h.type)).toContain("project");
    expect(treffer.find((h) => h.type === "project")?.title).toBe(fx.projectName);
  });

  it("Confinement: B findet A's Projekt nicht ueber dessen Beschreibung", async () => {
    expect(await hits(await search(fx.b.token, PROJEKT_BEGRIFF))).toHaveLength(0);
  });

  // ── Datei-Zweig ──────────────────────────────────────────────────────────
  // content_text ist die sensibelste Quelle: extrahierter Volltext aus
  // Vertraegen, Gutachten, Plaenen.
  it("findet eine Datei ueber den Dokumenttext", async () => {
    const treffer = await hits(await search(fx.a.token, DATEI_BEGRIFF));
    const datei = treffer.find((h) => h.type === "file");
    expect(datei?.title).toBe("plan.txt");
    expect(datei?.project).toBe(fx.projectName);
    // Der Auszug stammt aus der DB-seitigen Kuerzung — er darf nicht leer sein.
    expect(datei?.snippet).toContain(DATEI_BEGRIFF);
  });

  it("Confinement: B findet A's Dokumenttext nicht", async () => {
    expect(await hits(await search(fx.b.token, DATEI_BEGRIFF))).toHaveLength(0);
  });

  // ── Datensaetze ohne Projekt ─────────────────────────────────────────────
  // Der Kommentar im Kopf von db-search.ts sichert das ausdruecklich zu.
  it("projektlose Notiz: fuer Nicht-Admins unsichtbar, fuer Admin sichtbar", async () => {
    expect(await hits(await search(fx.a.token, OHNE_PROJEKT))).toHaveLength(0);
    expect((await hits(await search(fx.admin.token, OHNE_PROJEKT))).length).toBeGreaterThan(0);
  });

  // ── Leere Sichtbarkeit ───────────────────────────────────────────────────
  it("Nutzer ohne jedes Projekt bekommt nichts (Fruehausstieg)", async () => {
    const res = await search(cToken, BEGRIFF);
    expect(res.status).toBe(200);
    expect(await hits(res)).toHaveLength(0);
    // Auch die anderen Zweige duerfen nichts durchlassen.
    expect(await hits(await search(cToken, DATEI_BEGRIFF))).toHaveLength(0);
    expect(await hits(await search(cToken, PROJEKT_BEGRIFF))).toHaveLength(0);
  });

  // ── limit ────────────────────────────────────────────────────────────────
  // Frueher bekam jeder der vier Typen ein festes Viertel (ceil(limit/4)).
  // Bei sechs Notizen und limit=5 kamen dadurch 2 Treffer zurueck statt 5 —
  // ohne jeden Hinweis, dass gekuerzt wurde.
  it("limit wird ausgeschoepft, auch wenn alle Treffer aus einer Kategorie kommen", async () => {
    expect(await hits(await search(fx.a.token, LIMIT_BEGRIFF, undefined, "5"))).toHaveLength(5);
    expect(await hits(await search(fx.a.token, LIMIT_BEGRIFF, undefined, "6"))).toHaveLength(6);
  });

  it("limit begrenzt tatsaechlich nach oben", async () => {
    expect(await hits(await search(fx.a.token, LIMIT_BEGRIFF, undefined, "2"))).toHaveLength(2);
  });

  // Negatives limit lief frueher in `.slice(0, -1)` — der letzte Treffer
  // verschwand still, `limit=-10` lieferte gar nichts.
  it("unsinniges limit verschluckt keine Treffer", async () => {
    const ohne = await hits(await search(fx.a.token, LIMIT_BEGRIFF));
    expect(ohne).toHaveLength(6);
    expect(await hits(await search(fx.a.token, LIMIT_BEGRIFF, undefined, "-1"))).toHaveLength(6);
    expect(await hits(await search(fx.a.token, LIMIT_BEGRIFF, undefined, "-10"))).toHaveLength(6);
    expect(await hits(await search(fx.a.token, LIMIT_BEGRIFF, undefined, "0"))).toHaveLength(6);
    expect(await hits(await search(fx.a.token, LIMIT_BEGRIFF, undefined, "abc"))).toHaveLength(6);
  });

  // ── Reihenfolge ──────────────────────────────────────────────────────────
  //
  // Zwei Fassungen liegen hinter dieser Stelle. Ganz frueher wurde blockweise
  // nach Typ zusammengesetzt (notes → tasks → projects → files): eine Jahre
  // alte Notiz stand immer vor einer gerade geaenderten Datei, und Dateien
  // fielen bei knappem limit als erste weg. Danach galt „global nach Datum".
  //
  // Seit dem Umbau auf `tsvector` (Migration 048) entscheidet die RELEVANZ,
  // und erst bei Gleichstand das Datum. Das ist der Zweck des Umbaus: wer
  // „Bauverhandlung" sucht, will das gleichnamige Protokoll, nicht die
  // zufaellig juengere Notiz, in der das Wort einmal vorkommt.
  it("beide Treffer kommen, unabhaengig vom Typ", async () => {
    // Der urspruengliche Kern dieser Pruefung: kein Typ faellt heraus.
    const treffer = await hits(await search(fx.a.token, SORT_BEGRIFF));
    expect(treffer.length).toBe(2);
    expect(new Set(treffer.map((h) => h.type))).toEqual(new Set(["file", "note"]));
  });

  it("der treffendere Datensatz steht vorne, nicht der juengere", async () => {
    // Die Notiz traegt den Begriff im Titel UND im Text, die Datei nur im
    // Dateinamen — sie ist aber die juengere. Nach Datum sortiert stuende die
    // Datei vorne; nach Relevanz die Notiz. Genau das wird hier festgehalten.
    const treffer = await hits(await search(fx.a.token, SORT_BEGRIFF));
    expect(treffer[0]?.type).toBe("note");
  });

  it("bei knappem limit bleibt der beste Treffer uebrig, nicht der erste UNION-Zweig", async () => {
    // Der Sinn der alten Pruefung bleibt: es darf kein Budget je Typ geben.
    // Nachgewiesen ueber einen Begriff, bei dem die DATEI die bessere
    // Uebereinstimmung hat — kaeme trotzdem die Notiz, waere die Reihenfolge
    // wieder an den Typ gekoppelt.
    const treffer = await hits(await search(fx.a.token, DATEI_BEGRIFF, undefined, "1"));
    expect(treffer.map((h) => h.type)).toEqual(["file"]);
  });

  // ── Wortstämme (Migration 048) ───────────────────────────────────────────
  //
  // Der eigentliche Gewinn des Umbaus. Vorher fand „Einreichung" nur genau
  // dieses Wort — im Büro schreibt aber jeder anders: „Einreichungen",
  // „einreichen", „Einreichplanung".
  it("findet die Wortform, die im Text steht — nicht nur die getippte", async () => {
    // Der Zeitstempel steht als EIGENES Wort daneben. Klebt er am Suchwort,
    // ist das Ergebnis kein deutsches Wort mehr, der Stemmer kann es nicht
    // zurückführen — und der Test prüfte den Zeitstempel statt die Stammform.
    await notiz(`Kennung${STAMP} Die Einreichungen sind beim Magistrat`, fx.projectName);

    // Gesucht wird der Singular, im Text steht der Plural.
    const treffer = await hits(await search(fx.a.token, `Kennung${STAMP} Einreichung`));
    expect(treffer.some((h) => h.title.includes(`Kennung${STAMP}`))).toBe(true);
  });

  it("findet weiterhin Wortteile in kurzen Feldern", async () => {
    // Der Volltext allein wäre ein Rückschritt: er kennt keine Wortmitte.
    // Deshalb bleibt ILIKE auf Titel, Aufgabentext, Projektname und
    // Dateiname — „schmid" muss „Schmidbauer" finden.
    await notiz(`Schmidbauer${STAMP} Angebot geprueft`, fx.projectName);
    const treffer = await hits(await search(fx.a.token, `Schmidbauer${STAMP}`.slice(0, 8)));
    expect(treffer.some((h) => h.title.includes(`Schmidbauer${STAMP}`))).toBe(true);
  });

  it("mehrere Wörter werden UND-verknüpft, nicht ODER", async () => {
    // Sonst liefert jede Suche mit zwei Begriffen mehr statt weniger.
    await notiz(`Abnahme${STAMP} Rohbau fertiggestellt`, fx.projectName);
    await notiz(`Abnahme${STAMP} Fenster offen`, fx.projectName);

    const treffer = await hits(await search(fx.a.token, `Abnahme${STAMP} Fenster`));
    const titel = treffer.map((h) => h.title);
    expect(titel.some((t) => t.includes("Fenster"))).toBe(true);
    expect(titel.some((t) => t.includes("Rohbau"))).toBe(false);
  });

  it("ein Projekt im Papierkorb erscheint nicht mehr in der Suche", async () => {
    // Sonst wäre die Suche der Weg, an dem der Papierkorb vorbeiführt.
    const vorher = await hits(await search(fx.admin.token, fx.projectName));
    expect(vorher.some((h) => h.type === "project")).toBe(true);

    await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      method: "DELETE",
      headers: authHeader(fx.admin.token),
    });
    try {
      const nachher = await hits(await search(fx.admin.token, fx.projectName));
      expect(nachher.some((h) => h.type === "project")).toBe(false);
    } finally {
      await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/wiederherstellen`, {
        method: "POST",
        headers: { ...authHeader(fx.admin.token), "Content-Type": "application/json" },
      });
    }
  });

  // ── ILIKE-Metazeichen ────────────────────────────────────────────────────
  // In einem Planungsbuero heissen Dateien `LP3_Einreichung_01` — der
  // Unterstrich ist Alltag, nicht Randfall.
  it("Unterstrich ist ein Zeichen, kein Platzhalter", async () => {
    const treffer = await hits(await search(fx.a.token, `Grundriss_EG${STAMP}`));
    expect(treffer).toHaveLength(1);
    expect(treffer[0]?.title).toContain(`Grundriss_EG${STAMP}`);
  });

  it("Prozentzeichen liefert nicht den gesamten sichtbaren Bestand", async () => {
    const treffer = await hits(await search(fx.a.token, "%"));
    expect(treffer.filter((h) => h.title.includes(String(STAMP)))).toHaveLength(0);
  });

  it("Backslash bleibt ein Zeichen (Pfadangaben brechen die Suche nicht)", async () => {
    const res = await search(fx.a.token, `C:\\Plan${STAMP}`);
    expect(res.status).toBe(200);
    expect(await hits(res)).toHaveLength(0);
  });

  // ── Zentrale Fehlerbehandlung ────────────────────────────────────────────
  // Gehoert in diese Suite, weil die Suche der Anlass war: faellt eine
  // Postgres-Abfrage um, lieferte Hono einen nackten "Internal Server Error"
  // als text/plain — SearchView.vue macht `await res.json()` daraus und zeigt
  // dem Nutzer einen JSON-Parse-Fehler statt einer Meldung.
  it("unbehandelter Wurf wird JSON, nicht Klartext", async () => {
    const res = await fx.app.request("/api/notes", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: "{kaputt",
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await res.json()) as { error?: string }).toHaveProperty("error");
  });

  it("Routen mit eigener Fehlerantwort bleiben unveraendert", async () => {
    // Der zentrale Handler darf nur bei WUERFEN greifen — eine Route, die
    // ihren Fehler selbst beantwortet, gibt eine Response zurueck.
    const res = await fx.app.request("/api/search", { headers: authHeader(fx.a.token) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Suchbegriff erforderlich");
  });

  // ── Laengenbegrenzung ────────────────────────────────────────────────────
  // Ohne Grenze zwingt ein sehr langer Begriff Postgres ueber saemtliche
  // Dokumenttexte und bindet eine der 20 Pool-Verbindungen.
  it("ueberlanger Suchbegriff → 400 statt teurer Abfrage", async () => {
    const res = await search(fx.a.token, "a".repeat(201));
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toHaveProperty("error");
    // Die Grenze selbst muss noch durchgehen.
    expect((await search(fx.a.token, "a".repeat(200))).status).toBe(200);
  });
});
