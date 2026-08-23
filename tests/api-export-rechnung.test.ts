import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Der Rechnungs-Export — die fünfte Export-Art.
//
// ── Warum sie fehlte, und warum das die spürbarste Lücke war ───────────────
//
// Es gab vier Export-Arten (Besprechung, Bautagebuch, Stundenzettel,
// Projektübersicht) und keine davon war die Rechnung. Dabei stehen alle Daten
// im System: Positionen, Menge, Einzelpreis, Umsatzsteuersatz, Phase,
// Projektnummer. Für ein Büro, das Honorare abrechnet, ist die Rechnung die
// einzige Datenart, die das Haus wirklich verlässt.
//
// ── Warum hier zusätzlich das Geld-Recht geprüft wird ──────────────────────
//
// Der Antwort-Filter (`src/api/geld.ts`) räumt Geldfelder aus JSON-Antworten.
// Eine `.docx` ist kein JSON: der Filter sieht sie nicht, und die Beträge
// stehen darin ausgeschrieben. Ohne die zusätzliche Prüfung wäre der
// Rechnungsexport der Weg, auf dem ein Konto ohne Geld-Recht doch an Honorare
// kommt — genau die Klasse Lücke, die der Word-Export schon einmal war.
describe.skipIf(!HAS_DB)("Rechnungs-Export", () => {
  let fx: AclFixture;
  let rechnungId = "";
  let getDb: typeof import("../src/db/client.js").getDb;

  beforeAll(async () => {
    if (!HAS_DB) return;
    // A und B bekommen das Geld-Recht; der Fall „ohne Recht" wird unten
    // gezielt hergestellt.
    fx = await setupAclFixture("exprech", { geldRecht: true });
    ({ getDb } = await import("../src/db/client.js"));

    const res = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/invoices`, {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({
        nummer: "EXPRECH-2026-R01",
        datum: "2026-08-01",
        status: "gestellt",
        positionen: [
          { text: "LPH 4 Einreichplanung", menge: 1, einheit: "pauschal", einzelpreis: 12000, ustSatz: 20 },
          { text: "Nebenkosten", menge: 3, einheit: "Std", einzelpreis: 100, ustSatz: 20 },
        ],
      }),
    });
    expect([200, 201]).toContain(res.status);
    rechnungId = ((await res.json()) as { id: string }).id;
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await fx.cleanup();
  });

  it("ohne Vorlage kommt eine verständliche Absage, kein 500er", async () => {
    // In der Testdatenbank liegt keine Word-Vorlage für Rechnungen. Genau das
    // ist der häufigste Fall im echten Betrieb — jemand exportiert, bevor die
    // Vorlage hochgeladen ist.
    const res = await fx.app.request(`/api/exports/invoice/${rechnungId}`, { headers: authHeader(fx.a.token) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Standard");
  });

  it("ein Fremder bekommt die Rechnung nicht", async () => {
    const res = await fx.app.request(`/api/exports/invoice/${rechnungId}`, { headers: authHeader(fx.b.token) });
    expect(res.status).toBe(403);
  });

  it("eine unbekannte Rechnung gibt 404, nicht 403", async () => {
    // Sonst verrät der Statuscode, welche IDs es gibt.
    const res = await fx.app.request("/api/exports/invoice/00000000-0000-0000-0000-000000000000", {
      headers: authHeader(fx.b.token),
    });
    expect(res.status).toBe(404);
  });

  it("ohne Geld-Recht gibt es keine Rechnung — auch nicht im eigenen Projekt", async () => {
    // Der eigentliche Punkt: A darf das Projekt sehen. Nur das Geld-Recht
    // fehlt, und eine Rechnung ist nichts als Geld.
    await getDb()`UPDATE users SET can_see_money = false WHERE id = ${fx.a.id}::uuid`;
    try {
      const res = await fx.app.request(`/api/exports/invoice/${rechnungId}`, { headers: authHeader(fx.a.token) });
      expect(res.status).toBe(403);
    } finally {
      await getDb()`UPDATE users SET can_see_money = true WHERE id = ${fx.a.id}::uuid`;
    }
  });

  it("die Vorlagen-Variablen kennen die Rechnung", async () => {
    const res = await fx.app.request("/api/export-templates/_variables?kind=invoice", {
      headers: authHeader(fx.admin.token),
    });
    expect(res.status).toBe(200);
    const tags = ((await res.json()) as { tag: string }[]).map((v) => v.tag);
    expect(tags).toContain("{Rechnung.Netto}");
    expect(tags).toContain("{Rechnung.Ust}");
    expect(tags).toContain("{Rechnung.Brutto}");
    expect(tags.some((t) => t.includes("{#Positionen}"))).toBe(true);
    expect(tags.some((t) => t.includes("{#UstZeilen}"))).toBe(true);
  });

  it("„invoice“ ist eine gültige Vorlagen-Art", async () => {
    // Ohne diesen Eintrag ließe sich gar keine Rechnungsvorlage hochladen —
    // die Art wird beim Upload gegen die Liste geprüft.
    const res = await fx.app.request("/api/export-templates?kind=invoice", { headers: authHeader(fx.admin.token) });
    expect(res.status).toBe(200);
  });
});
