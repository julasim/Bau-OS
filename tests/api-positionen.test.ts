import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Rechnungspositionen und Positionskatalog (Migration 046).
//
// Eine Teilrechnung war bisher genau eine Zahl. Das reicht für die
// Honorarbilanz, aber nicht für die Rechnung selbst — die braucht Zeilen.
// Ohne sie muss der Betrag außerhalb des Programms ausgerechnet werden, und
// PATIO kennt nur die Summe, nicht wie sie zustande kam.
describe.skipIf(!HAS_DB)("Rechnungspositionen und Positionskatalog", () => {
  let fx: AclFixture;

  beforeAll(async () => {
    // Diese Suite arbeitet durchgehend mit Beträgen — ohne das Geld-Recht
    // scheiterte sie am falschen Grund.
    fx = await setupAclFixture("posi", { geldRecht: true });
  });
  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  const rechnungenPfad = () => `/api/projects/${encodeURIComponent(fx.projectName)}/invoices`;

  // ── Positionen an der Rechnung ───────────────────────────────────────────

  it("der Betrag ergibt sich aus den Positionen", async () => {
    const res = await fx.app.request(rechnungenPfad(), {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({
        nummer: "2026-100",
        datum: "2026-09-01",
        positionen: [
          { text: "Einreichplanung", menge: 12, einheit: "h", einzelpreis: 95, ustSatz: 20 },
          { text: "Behördenweg", menge: 1, einheit: "pauschal", einzelpreis: 350, ustSatz: 20 },
        ],
      }),
    });
    expect([200, 201]).toContain(res.status);
    const r = (await res.json()) as { betrag: number; positionen: unknown[] };
    expect(r.betrag).toBe(12 * 95 + 350);
    expect(r.positionen).toHaveLength(2);
  });

  it("ein mitgeschickter Betrag zählt neben Positionen NICHT", async () => {
    // Sonst könnte die Rechnung eine andere Summe behaupten als sie
    // auflistet — und niemand sähe den Widerspruch.
    const res = await fx.app.request(rechnungenPfad(), {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({
        nummer: "2026-101",
        betrag: 99999,
        positionen: [{ text: "Bauaufsicht", menge: 2, einheit: "h", einzelpreis: 100, ustSatz: 20 }],
      }),
    });
    expect(((await res.json()) as { betrag: number }).betrag).toBe(200);
  });

  it("ohne Positionen gilt weiterhin der eingetragene Betrag", async () => {
    // Bestandsrechnungen (Migration 035) haben keine Positionen und müssen
    // ihre Summe behalten.
    const res = await fx.app.request(rechnungenPfad(), {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ nummer: "2026-102", betrag: 4200 }),
    });
    const r = (await res.json()) as { betrag: number; positionen: unknown[] };
    expect(r.betrag).toBe(4200);
    expect(r.positionen).toEqual([]);
  });

  it("Positionen nachträglich ergänzen rechnet den Betrag neu", async () => {
    const angelegt = await fx.app.request(rechnungenPfad(), {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ nummer: "2026-103", betrag: 1000 }),
    });
    const r = (await angelegt.json()) as { id: string; rev: number };

    const geaendert = await fx.app.request(`/api/invoices/${r.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({
        rev: r.rev,
        positionen: [{ text: "Detailplanung", menge: 5, einheit: "h", einzelpreis: 110, ustSatz: 20 }],
      }),
    });
    expect(geaendert.status).toBe(200);
    expect(((await geaendert.json()) as { betrag: number }).betrag).toBe(550);
  });

  it("fehlerhafte Positionen werden konkret abgelehnt", async () => {
    const ohneText = await fx.app.request(rechnungenPfad(), {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ positionen: [{ text: "", menge: 1, einzelpreis: 10, ustSatz: 20 }] }),
    });
    expect(ohneText.status).toBe(400);
    expect(((await ohneText.json()) as { error: string }).error).toContain("Text fehlt");

    const falscherSatz = await fx.app.request(rechnungenPfad(), {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ positionen: [{ text: "X", menge: 1, einzelpreis: 10, ustSatz: 300 }] }),
    });
    expect(falscherSatz.status).toBe(400);
    expect(((await falscherSatz.json()) as { error: string }).error).toContain("Steuersatz");
  });

  // ── Katalog ──────────────────────────────────────────────────────────────

  it("Katalogeinträge lassen sich anlegen, ändern und löschen", async () => {
    const angelegt = await fx.app.request("/api/positionskatalog", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: "Einreichplanung", einheit: "h", einzelpreis: 95, ustSatz: 20 }),
    });
    expect(angelegt.status).toBe(201);
    const item = (await angelegt.json()) as { id: string; einzelpreis: number; rev: number };
    // NUMERIC kommt als String aus der Datenbank — ohne Number() liefe die
    // Summenbildung in der Oberfläche auf Zeichenverkettung hinaus.
    expect(typeof item.einzelpreis).toBe("number");
    expect(item.einzelpreis).toBe(95);

    const geaendert = await fx.app.request(`/api/positionskatalog/${item.id}`, {
      method: "PATCH",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ einzelpreis: 105, rev: item.rev }),
    });
    expect(geaendert.status).toBe(200);
    expect(((await geaendert.json()) as { einzelpreis: number }).einzelpreis).toBe(105);

    const veraltet = await fx.app.request(`/api/positionskatalog/${item.id}`, {
      method: "PATCH",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ einzelpreis: 120, rev: item.rev }),
    });
    expect(veraltet.status).toBe(409);

    const geloescht = await fx.app.request(`/api/positionskatalog/${item.id}`, {
      method: "DELETE",
      headers: authHeader(fx.a.token),
    });
    expect(geloescht.status).toBe(200);
  });

  it("ein gelöschter Katalogeintrag lässt bestehende Rechnungen unberührt", async () => {
    // Katalogeinträge werden beim Übernehmen KOPIERT, nicht referenziert.
    // Andernfalls änderte eine Preisanpassung im Katalog rückwirkend
    // gestellte Rechnungen — das wäre ein Buchhaltungsproblem.
    const eintrag = await fx.app.request("/api/positionskatalog", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: "Wird gelöscht", einheit: "h", einzelpreis: 80, ustSatz: 20 }),
    });
    const k = (await eintrag.json()) as { id: string };

    const rechnung = await fx.app.request(rechnungenPfad(), {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({
        nummer: "2026-104",
        positionen: [{ text: "Wird gelöscht", menge: 3, einheit: "h", einzelpreis: 80, ustSatz: 20 }],
      }),
    });
    const r = (await rechnung.json()) as { id: string };

    await fx.app.request(`/api/positionskatalog/${k.id}`, {
      method: "DELETE",
      headers: authHeader(fx.a.token),
    });

    const liste = await fx.app.request(rechnungenPfad(), { headers: authHeader(fx.a.token) });
    const gefunden = ((await liste.json()) as { id: string; betrag: number; positionen: unknown[] }[]).find(
      (x) => x.id === r.id,
    );
    expect(gefunden?.betrag).toBe(240);
    expect(gefunden?.positionen).toHaveLength(1);
  });

  it("ohne Geld-Recht ist der Katalog gesperrt, nicht nur gefiltert", async () => {
    // Gefiltert bliebe eine Liste von Leistungsbezeichnungen ohne Preise —
    // keine nützliche Teilansicht, sondern eine Hülle.
    const fx2 = await setupAclFixture("posi2");
    try {
      const gelesen = await fx2.app.request("/api/positionskatalog", { headers: authHeader(fx2.a.token) });
      expect(gelesen.status).toBe(403);

      const geschrieben = await fx2.app.request("/api/positionskatalog", {
        method: "POST",
        headers: jsonHeader(fx2.a.token),
        body: JSON.stringify({ text: "Heimlich", einzelpreis: 1 }),
      });
      expect(geschrieben.status).toBe(403);

      // Der Admin kommt durch.
      const alsAdmin = await fx2.app.request("/api/positionskatalog", {
        headers: authHeader(fx2.admin.token),
      });
      expect(alsAdmin.status).toBe(200);
    } finally {
      await fx2.cleanup();
    }
  });

  it("in den Rechnungen selbst verschwindet nur der Einzelpreis", async () => {
    // Die Rechnung bleibt sichtbar — Leistung, Menge und Einheit sind kein
    // Geld. Der Filter arbeitet rekursiv und greift deshalb auch in die
    // Positionen hinein.
    const fx2 = await setupAclFixture("posi3");
    try {
      const rechnung = await fx2.app.request(`/api/projects/${encodeURIComponent(fx2.projectName)}/invoices`, {
        method: "POST",
        headers: jsonHeader(fx2.admin.token),
        body: JSON.stringify({
          nummer: "2026-105",
          positionen: [{ text: "Bauaufsicht", menge: 4, einheit: "h", einzelpreis: 90, ustSatz: 20 }],
        }),
      });
      expect([200, 201]).toContain(rechnung.status);

      const liste = await fx2.app.request(`/api/projects/${encodeURIComponent(fx2.projectName)}/invoices`, {
        headers: authHeader(fx2.a.token),
      });
      const roh = JSON.stringify(await liste.json());
      expect(roh).toContain("Bauaufsicht");
      expect(roh).not.toContain("einzelpreis");
      expect(roh).not.toContain('"betrag"');
    } finally {
      await fx2.cleanup();
    }
  });
});
