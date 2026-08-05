import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Die Volltextsuche (src/data/db-search.ts) ersetzt die frueheren beiden
// Suchwege — das rekursive grep ueber Vault-Markdown und die pgvector-
// Aehnlichkeitssuche. Beide sind mit der LLM-Laufzeit entfallen.
//
// Warum diese Tests: die ALTE Suche filterte ueberhaupt nicht nach Rechten.
// Wer den Endpunkt kannte, bekam Treffer aus jedem Projekt — inklusive
// Projektnamen und Textausschnitten. Die neue Suche bekommt den Scope aus
// getVisibleProjectIds() und darf das nicht wieder verlieren. Ein Treffer
// aus einem gesperrten Projekt ist hier ein Datenleck, kein Schoenheitsfehler.
describe.skipIf(!HAS_DB)("API — Volltextsuche: Treffer und Rechte", () => {
  let fx: AclFixture;
  // Eindeutig genug, dass kein Altbestand in der Test-DB mitzaehlt.
  const BEGRIFF = `Zwischendecke${Date.now()}`;

  const search = (token: string, q: string, project?: string) =>
    fx.app.request(
      `/api/search?q=${encodeURIComponent(q)}${project ? `&project=${encodeURIComponent(project)}` : ""}`,
      {
        headers: authHeader(token),
      },
    );
  const hits = async (res: Response) => {
    const body = (await res.json()) as { results: Array<{ type: string; title: string; project: string | null }> };
    return body.results;
  };

  beforeAll(async () => {
    fx = await setupAclFixture("such");
    // Notiz und Aufgabe mit dem Begriff in A's Projekt anlegen. Das Projekt
    // selbst traegt ihn nicht — so laesst sich pruefen, dass wirklich die
    // Inhalte durchsucht werden und nicht nur der Projektname.
    await fx.app.request("/api/notes", {
      method: "POST",
      headers: { ...authHeader(fx.a.token), ...jsonHeader },
      body: JSON.stringify({
        content: `Statik der ${BEGRIFF} pruefen`,
        title: "Statikhinweis",
        project: fx.projectName,
      }),
    });
    await fx.app.request("/api/tasks", {
      method: "POST",
      headers: { ...authHeader(fx.a.token), ...jsonHeader },
      body: JSON.stringify({ text: `${BEGRIFF} vermessen`, project: fx.projectName }),
    });
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
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
});
