import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Das Geld-Recht (Migration 043).
//
// Bis zur Rechte-Runde konnte jeder angemeldete Nutzer jeden Betrag lesen:
// Stundensätze der Kolleginnen und Kollegen, Rechnungsbeträge, Budgets,
// Deckungsbeiträge. In einem Büro, in dem Zeichensaal und Geschäftsführung
// dieselbe Anwendung benutzen, ist das die heikelste Offenlegung überhaupt —
// sie betrifft Gehaltsniveaus.
//
// Der Nachweis ist bewusst ein **Rundum-Lauf**, keine Einzelprüfung: ein
// eingeschränktes Konto ruft jeden Endpunkt ab, an dem Geld herauskommen kann,
// und die Antworten werden vollständig — rekursiv, bis in jedes verschachtelte
// Objekt — nach Geldfeldern durchsucht. Das ist die Form, in der der Plan das
// Abnahmekriterium formuliert: „keinen einzigen Geldbetrag sehen".
//
// Warum rekursiv und nicht per Feldvergleich: Beträge stecken auch in
// Unterobjekten (Phasen in der Projektantwort, Summen je Mitglied in der
// Stundenauswertung). Ein flacher Blick auf die oberste Ebene übersähe genau
// die Stellen, an denen es teuer wird.
describe.skipIf(!HAS_DB)("Geld-Recht — Beträge nur für Berechtigte", () => {
  let fx: AclFixture;

  /** Alle Feldnamen, die einen Betrag tragen. Muss mit `GELD_FELDER` in
   *  `src/api/geld.ts` übereinstimmen — der Test ist die Gegenprobe zur
   *  Liste dort, nicht ihre Kopie mit anderem Zweck. */
  const GELD_FELDER = [
    "hourlyRate",
    "hourly_rate",
    "betrag",
    "invoiced",
    "invoicedTotal",
    "unassignedInvoiced",
    "budget",
    "budgetUsed",
    "budget_used",
    "sollHonorar",
    "honorar",
    "offen",
    "deckung",
    "deckungsbeitrag",
    "kostenIst",
    "kostenIstTotal",
    "kosten",
    "cost",
    "costs",
  ];

  /** Sucht rekursiv nach Geldfeldern und liefert deren Pfade. Leeres Ergebnis
   *  heißt: in dieser Antwort steht kein Betrag. */
  function geldfelderIn(wert: unknown, pfad = "$"): string[] {
    if (Array.isArray(wert)) return wert.flatMap((v, i) => geldfelderIn(v, `${pfad}[${i}]`));
    if (wert === null || typeof wert !== "object") return [];
    const treffer: string[] = [];
    for (const [k, v] of Object.entries(wert as Record<string, unknown>)) {
      if (GELD_FELDER.includes(k)) treffer.push(`${pfad}.${k}`);
      treffer.push(...geldfelderIn(v, `${pfad}.${k}`));
    }
    return treffer;
  }

  beforeAll(async () => {
    fx = await setupAclFixture("geld");

    // A bekommt einen Stundensatz, eine Rechnung, eine Phase und Stunden —
    // damit an jeder geprüften Stelle wirklich ein Betrag entstehen KANN.
    // Ein Test, der nur leere Listen abfragt, beweist nichts.
    const mitglied = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: `geld-mitglied-${Date.now()}`, role: "Planung", hourlyRate: 95 }),
    });
    expect(mitglied.status).toBe(201);
    const m = (await mitglied.json()) as { id: string };

    const phase = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/phases`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: "LPH 3", honorarProzent: 20 }),
    });
    // 200 statt 201: Phasen- und Rechnungs-POST antworten anders als die
    // uebrigen Anlege-Routen. Bestand, hier nicht Gegenstand.
    expect([200, 201]).toContain(phase.status);

    const rechnung = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/invoices`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ nummer: "2026-001", betrag: 12500, datum: "2026-09-01" }),
    });
    expect([200, 201]).toContain(rechnung.status);

    const stunden = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/time-entries`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ memberId: m.id, date: "2026-09-01", hours: 8, description: "Einreichplanung" }),
    });
    expect(stunden.status).toBe(201);

    // Damit A überhaupt an die Daten kommt, muss A das Projekt sehen — das tut
    // er als Ersteller. Das Geld-Recht hat er trotzdem nicht.
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  /** Die Endpunkte, an denen Geld herauskommen kann. Wird die Liste länger,
   *  gehört der neue Endpunkt hier dazu — nicht in eine zweite Prüfung. */
  function pfade(): { name: string; url: string }[] {
    const p = encodeURIComponent(fx.projectName);
    return [
      { name: "Team-Liste", url: "/api/team" },
      { name: "Portfolio-Cockpit", url: "/api/portfolio" },
      { name: "Projekt-Detail", url: `/api/projects/${p}` },
      { name: "Projekt-Liste", url: "/api/projects" },
      { name: "Rechnungen", url: `/api/projects/${p}/invoices` },
      { name: "Leistungsphasen", url: `/api/projects/${p}/phases` },
      { name: "Stunden", url: `/api/projects/${p}/time-entries` },
      { name: "Stunden-Auswertung", url: `/api/projects/${p}/time-entries/summary` },
      { name: "Honorar und Marge", url: `/api/projects/${p}/finance` },
      { name: "Dashboard", url: "/api/dashboard" },
    ];
  }

  it("ein Konto ohne Geld-Recht sieht auf KEINEM Weg einen Betrag", async () => {
    const funde: string[] = [];
    for (const { name, url } of pfade()) {
      const res = await fx.app.request(url, { headers: authHeader(fx.a.token) });
      if (res.status !== 200) continue; // nicht vorhandene Route zählt nicht als Beweis
      const treffer = geldfelderIn(await res.json());
      if (treffer.length > 0) funde.push(`${name} (${url}): ${treffer.join(", ")}`);
    }
    expect(funde).toEqual([]);
  });

  it("derselbe Rundlauf zeigt dem Admin sehr wohl Beträge", async () => {
    // Die Gegenrichtung ist der eigentliche Beweis, dass der Filter greift und
    // nicht bloß überall leere Listen zurückkommen.
    const funde: string[] = [];
    for (const { name, url } of pfade()) {
      const res = await fx.app.request(url, { headers: authHeader(fx.admin.token) });
      if (res.status !== 200) continue;
      const treffer = geldfelderIn(await res.json());
      if (treffer.length > 0) funde.push(name);
    }
    expect(funde.length).toBeGreaterThan(0);
  });

  it("mit vergebenem Geld-Recht sieht auch ein normales Konto die Beträge", async () => {
    const gesetzt = await fx.app.request(`/api/admin/users/${fx.a.id}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ canSeeMoney: true }),
    });
    expect(gesetzt.status).toBe(200);

    const res = await fx.app.request("/api/team", { headers: authHeader(fx.a.token) });
    expect(res.status).toBe(200);
    expect(geldfelderIn(await res.json()).length).toBeGreaterThan(0);

    // Wieder wegnehmen — der Fixture-Nutzer wird von den anderen Prüfungen
    // in dieser Datei weiterverwendet.
    await fx.app.request(`/api/admin/users/${fx.a.id}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ canSeeMoney: false }),
    });
  });

  it("neue Konten haben das Recht nicht", async () => {
    // Voreinstellung geschlossen: ein Recht, das man aktiv wegnehmen muss,
    // wird vergessen — eines, das man aktiv geben muss, nicht.
    const angelegt = await fx.app.request("/api/admin/users", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ username: `geld-neu-${Date.now()}`, password: "test-passwort-123", role: "user" }),
    });
    expect(angelegt.status).toBe(201);
    const neu = (await angelegt.json()) as { id: string; canSeeMoney?: boolean };
    expect(neu.canSeeMoney ?? false).toBe(false);

    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM users WHERE id = ${neu.id}`;
  });

  it("der Stundenexport bleibt ohne Geld-Recht nutzbar — er enthält keine Beträge", async () => {
    // Wichtige Abgrenzung: der Filter greift nur auf JSON, eine Word-Datei
    // geht ungefiltert hinaus. Der Stundenzettel trägt aber nachgesehen
    // keinen Satz und keinen Betrag, sondern Datum, Stunden, Mitarbeiter und
    // Tätigkeit (`buildTimeEntryData`). Ihn ans Geld-Recht zu binden würde die
    // Projektleitung daran hindern, dem Bauherrn einen Stundennachweis zu
    // geben — ohne irgendeinen Betrag zu schützen.
    //
    // Die Projekt-Rechte gelten hier trotzdem: A darf sein Projekt, B nicht.
    const alsBerechtigter = await fx.app.request(
      `/api/exports/time-entries?project=${encodeURIComponent(fx.projectName)}`,
      { headers: authHeader(fx.a.token) },
    );
    expect(alsBerechtigter.status).not.toBe(403);

    const alsFremder = await fx.app.request(`/api/exports/time-entries?project=${encodeURIComponent(fx.projectName)}`, {
      headers: authHeader(fx.b.token),
    });
    expect(alsFremder.status).toBe(403);
  });
});
