import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Aufgabensystem, Baustufe 1 — die rechnende Schicht über den Aufgaben.
//
// Geprüft wird hier NICHT, ob man Aufgaben anlegen kann (das kann PATIO
// längst), sondern ob die **Zahlen stimmen**, an denen die Auswahl hängt:
// Matrix-Summen, Tagesbudget, die Grenzen — und ob der Tagesplan wirklich
// persönlich ist.
//
// Der Grundsatz aus der Spezifikation, den fast jeder dieser Tests festhält:
// **sichtbar machen, nie blockieren.** Keine Route darf etwas ablehnen, weil
// eine Grenze überschritten ist. Eine harte Sperre wird nach der zweiten
// Umgehung zur Gewohnheit — und dann ist das ganze System entwertet.
describe.skipIf(!HAS_DB)("Aufgabensystem — die rechnende Schicht", () => {
  let fx: AclFixture;
  const P = `aufg-${Date.now()}`;

  /** Legt eine Aufgabe an und setzt Rang/Aufwand. Liefert die ID. */
  async function aufgabe(titel: string, rang: number, aufwandMin: number | null): Promise<string> {
    const angelegt = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: `${P}-${titel}`, project: fx.projectName }),
    });
    expect(angelegt.status).toBe(201);
    const { id } = (await angelegt.json()) as { id: string };

    const geaendert = await fx.app.request(`/api/tasks/${id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ rang, aufwandMin }),
    });
    expect(geaendert.status).toBe(200);
    return id;
  }

  const matrix = async (token: string) => {
    const res = await fx.app.request("/api/aufgabensystem/matrix", { headers: authHeader(token) });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      spalten: { rang: number; anzahl: number; summeMin: number; ohneSchaetzung: number; ueberGrenze?: boolean }[];
      grenzen: { maxRang1: number; tagesbudgetMin: number; maxRang3Min: number };
    };
  };

  const budget = async (token: string) => {
    const res = await fx.app.request("/api/aufgabensystem/tagesplan", { headers: authHeader(token) });
    expect(res.status).toBe(200);
    return ((await res.json()) as { tagesbudget: Record<string, number | boolean> }).tagesbudget;
  };

  const inDenPlan = (token: string, id: string, drin: boolean) =>
    fx.app.request(`/api/aufgabensystem/tagesplan/${id}`, {
      method: "PUT",
      headers: jsonHeader(token),
      body: JSON.stringify({ drin }),
    });

  beforeAll(async () => {
    fx = await setupAclFixture("aufg");
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM tasks WHERE text LIKE ${P + "%"}`;
    await fx.cleanup();
  });

  // ── Der Standard ──────────────────────────────────────────────────────────

  it("eine neue Aufgabe bekommt Rang 3 und keine Schätzung", async () => {
    // Grundsatz 02: der Normalfall wird nicht markiert. Wäre der Standard 1,
    // müsste beim Erfassen jedes Mal etwas entschieden werden — und genau
    // daran stirbt die Abendroutine.
    const res = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: `${P}-standard`, project: fx.projectName }),
    });
    expect(res.status).toBe(201);
    const t = (await res.json()) as { rang: number; aufwandMin: number | null; imTagesplan: boolean };
    expect(t.rang).toBe(3);
    expect(t.aufwandMin).toBeNull();
    expect(t.imTagesplan).toBe(false);
  });

  // ── Die Matrix rechnet ────────────────────────────────────────────────────

  it("die Matrix liefert immer alle vier Spalten, auch leere", async () => {
    // Eine fehlende Spalte wäre in der Oberfläche eine Lücke statt einer Null.
    const m = await matrix(fx.admin.token);
    expect(m.spalten.map((s) => s.rang)).toEqual([1, 2, 3, 4]);
  });

  it("sie summiert die Aufwände je Rang", async () => {
    await aufgabe("m-a", 1, 60);
    await aufgabe("m-b", 1, 30);
    await aufgabe("m-c", 2, 120);

    const m = await matrix(fx.admin.token);
    const r1 = m.spalten.find((s) => s.rang === 1)!;
    const r2 = m.spalten.find((s) => s.rang === 2)!;
    // Andere Testdateien schreiben in dieselbe Datenbank — deshalb auf
    // „mindestens" geprüft, nicht auf Gleichheit. Ein Test, der von fremden
    // Läufen abhängt, ist wertlos, egal wie oft er zufällig grün ist.
    expect(r1.summeMin).toBeGreaterThanOrEqual(90);
    expect(r2.summeMin).toBeGreaterThanOrEqual(120);
  });

  it("Aufgaben ohne Schätzung werden gezählt, nicht verschwiegen", async () => {
    // Sonst liest sich eine zu niedrige Summe wie „da ist noch Platz".
    await aufgabe("m-ohne", 1, null);
    const m = await matrix(fx.admin.token);
    expect(m.spalten.find((s) => s.rang === 1)!.ohneSchaetzung).toBeGreaterThanOrEqual(1);
  });

  it("die Grenzen kommen mit — eine Quelle für Server und Oberfläche", async () => {
    const m = await matrix(fx.admin.token);
    expect(m.grenzen).toEqual({ maxRang1: 5, tagesbudgetMin: 300, maxRang3Min: 60 });
  });

  // ── Das Tagesbudget ───────────────────────────────────────────────────────

  it("das Budget summiert nur, was im Tagesplan liegt", async () => {
    const vorher = await budget(fx.admin.token);
    const id = await aufgabe("b-eins", 1, 120);
    const nachher = await budget(fx.admin.token);
    // Anlegen allein ändert nichts — erst die Übernahme.
    expect(nachher.belegtMin).toBe(vorher.belegtMin);

    const res = await inDenPlan(fx.admin.token, id, true);
    expect(res.status).toBe(200);
    const drin = await budget(fx.admin.token);
    expect(drin.belegtMin).toBe(Number(vorher.belegtMin) + 120);
  });

  it("die Auslastung darf über 100 Prozent gehen — das ist der Zweck", async () => {
    // Ein Balken, der bei 100 stehenbleibt, verschweigt genau die Zahl, auf
    // die es ankommt: um wie viel man sich vertan hat.
    for (const n of ["u-1", "u-2", "u-3"]) {
      const id = await aufgabe(n, 1, 240);
      expect((await inDenPlan(fx.admin.token, id, true)).status).toBe(200);
    }
    const b = await budget(fx.admin.token);
    expect(b.belegtMin).toBeGreaterThan(300);
    expect(b.auslastung).toBeGreaterThan(100);
  });

  it("Rang 3 hat einen eigenen Abschnitt und eine eigene Grenze", async () => {
    const id = await aufgabe("r3", 3, 120); // über den erlaubten 60 min
    expect((await inDenPlan(fx.admin.token, id, true)).status).toBe(200);
    const b = await budget(fx.admin.token);
    expect(b.rang3Min).toBeGreaterThanOrEqual(120);
    expect(b.rang3UeberGrenze).toBe(true);
  });

  it("das Budget sagt, ob eine Rang-2-Aufgabe dabei ist", async () => {
    // Die Spezifikation macht mindestens eine pro Tag zur Pflicht — sonst
    // wird nur noch Dringendes abgearbeitet und nie etwas Wichtiges.
    const vorher = await budget(fx.admin.token);
    expect(vorher.hatRang2).toBe(false);

    const id = await aufgabe("r2", 2, 60);
    expect((await inDenPlan(fx.admin.token, id, true)).status).toBe(200);
    expect((await budget(fx.admin.token)).hatRang2).toBe(true);
  });

  // ── Nie blockieren ────────────────────────────────────────────────────────

  it("eine sechste Rang-1-Aufgabe wird NICHT abgelehnt", async () => {
    // Der Kern von Grundsatz 04. Die Grenze wird gezeigt, nicht erzwungen —
    // eine harte Sperre würde umgangen und entwertete das System.
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await aufgabe(`grenze-${i}`, 1, 15));

    const m = await matrix(fx.admin.token);
    const r1 = m.spalten.find((s) => s.rang === 1)!;
    expect(r1.anzahl).toBeGreaterThan(m.grenzen.maxRang1);
    // …und die Matrix sagt es auch:
    expect(r1.ueberGrenze).toBe(true);
  });

  it("auch das volle Budget lehnt keine weitere Übernahme ab", async () => {
    const id = await aufgabe("trotzdem", 1, 240);
    const res = await inDenPlan(fx.admin.token, id, true);
    expect(res.status).toBe(200); // kein 409, kein 422
  });

  // ── Der Tagesplan ist persönlich ──────────────────────────────────────────

  it("der Tagesplan des einen ist nicht der des anderen", async () => {
    // Die Spezifikation ist für eine Person geschrieben. Auf einem Server mit
    // acht Arbeitsplätzen wäre ein GEMEINSAMER Tagesplan unbrauchbar: der eine
    // räumte dem anderen den Tag ab.
    const b = await budget(fx.b.token);
    expect(b.belegtMin).toBe(0);
    // …obwohl der Admin längst etwas drin hat:
    expect(Number((await budget(fx.admin.token)).belegtMin)).toBeGreaterThan(0);
  });

  it("wer die Aufgabe nicht sehen darf, kann sie auch nicht einplanen", async () => {
    const id = await aufgabe("fremd", 1, 30);
    const res = await inDenPlan(fx.b.token, id, true);
    expect(res.status).toBe(403);
  });

  it("eine Aufgabe, die es nicht gibt, ergibt 404 — nicht 403", async () => {
    const res = await inDenPlan(fx.admin.token, "00000000-0000-0000-0000-000000000000", true);
    expect(res.status).toBe(404);
  });

  it("ein fehlendes Feld `drin` ist ein 400, kein stilles Nichts", async () => {
    const id = await aufgabe("ohne-feld", 1, 30);
    const res = await fx.app.request(`/api/aufgabensystem/tagesplan/${id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  // ── Der Tageswechsel ──────────────────────────────────────────────────────

  it("der Tageswechsel leert den Plan und lässt die Aufgaben unberührt", async () => {
    const id = await aufgabe("wechsel", 1, 60);
    expect((await inDenPlan(fx.admin.token, id, true)).status).toBe(200);
    expect(Number((await budget(fx.admin.token)).belegtMin)).toBeGreaterThan(0);

    const { aufgabensystemRepo } = await import("../src/data/index.js");
    await aufgabensystemRepo.tagesplanZuruecksetzen();

    expect((await budget(fx.admin.token)).belegtMin).toBe(0);

    // Die Aufgabe selbst muss unverändert dastehen — kein Rückstand, keine
    // Übertragung, nur die Auswahl ist weg.
    const gelesen = await fx.app.request(`/api/tasks`, { headers: authHeader(fx.admin.token) });
    const liste = (await gelesen.json()) as { id: string; text: string; rang: number; status: string }[];
    const t = liste.find((x) => x.id === id)!;
    expect(t.text).toBe(`${P}-wechsel`);
    expect(t.rang).toBe(1);
    expect(t.status).not.toBe("done");
  });

  // ── Rechte ────────────────────────────────────────────────────────────────

  it("die Matrix zeigt keine Aufgaben aus fremden Projekten", async () => {
    // B sieht nur sein eigenes Projekt. Alles, was hier in A's Projekt
    // angelegt wurde, darf bei B nicht mitgezählt werden.
    const alsAdmin = await matrix(fx.admin.token);
    const alsB = await matrix(fx.b.token);
    const summeAdmin = alsAdmin.spalten.reduce((n, s) => n + s.anzahl, 0);
    const summeB = alsB.spalten.reduce((n, s) => n + s.anzahl, 0);
    expect(summeB).toBeLessThan(summeAdmin);
  });
});
