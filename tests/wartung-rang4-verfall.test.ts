import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, jsonHeader, type AclFixture, namensraum } from "./helpers/acl-fixture.js";

// Verfall von Rang 4 — die einzige Regel des Aufgabensystems, die von selbst
// zuschlägt.
//
// ── Warum das geprüft werden muss ──────────────────────────────────────────
//
// Weil hier ein Cron um drei Uhr nachts fremde Datensätze anfasst, ohne dass
// jemand zusieht. Ein Fehler in der Bedingung fällt dann nicht als Fehlermeldung
// auf, sondern als fehlende Aufgabe — Wochen später, ohne Spur.
//
// Deshalb prüft diese Datei nicht nur, DASS Rang 4 verfällt, sondern vor allem,
// was ausdrücklich NICHT verfallen darf: die anderen drei Ränge, Erledigtes,
// frisch Angefasstes und was schon im Papierkorb liegt.
describe.skipIf(!HAS_DB)("Wartung — Verfall von Rang 4", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;
  let aufgabensystemRepo: typeof import("../src/data/index.js").aufgabensystemRepo;

  const P = `verfall-${namensraum()}`;

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture();
    ({ getDb } = await import("../src/db/client.js"));
    ({ aufgabensystemRepo } = await import("../src/data/index.js"));
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await getDb()`DELETE FROM tasks WHERE text LIKE ${P + "%"}`;
    await fx.cleanup();
  });

  /** Legt eine Aufgabe an, setzt den Rang und schiebt `updated_at` in die
   *  Vergangenheit.
   *
   *  ── Warum das eine Transaktion mit `session_replication_role` braucht ──
   *
   *  Auf `tasks` liegt `trg_tasks_updated_at`, ein BEFORE-UPDATE-Trigger, der
   *  `updated_at` **bedingungslos** auf `now()` setzt. Ein gewöhnliches
   *  `UPDATE … SET updated_at = …` wird davon still überschrieben — der erste
   *  Anlauf dieser Datei ist genau daran gescheitert: der Verfall meldete 0,
   *  obwohl er richtig gebaut war.
   *
   *  Für die Anwendung ist der Trigger ein Gewinn: `updated_at` lässt sich
   *  nicht fälschen, und genau darauf beruht die Frist. Nur der Test muss
   *  Alter simulieren können.
   *
   *  `SET LOCAL session_replication_role = replica` schaltet Benutzer-Trigger
   *  ab — **transaktionslokal**. Damit sind parallel laufende Testdateien auf
   *  ihren eigenen Verbindungen nicht betroffen; ein
   *  `ALTER TABLE … DISABLE TRIGGER` wäre datenbankweit und würde ihnen mitten
   *  im Lauf den Zeitstempel abdrehen. */
  async function aufgabe(titel: string, rang: number, tageAlt: number): Promise<string> {
    const res = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: `${P}-${titel}`, project: fx.projectName }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    await altern(id, { rang, tageAlt });
    return id;
  }

  /** Setzt Felder unter Umgehung des `updated_at`-Triggers. */
  async function altern(
    id: string,
    f: { rang?: number; tageAlt?: number; status?: string; geloeschtVorTagen?: number },
  ) {
    await getDb().begin(async (sql) => {
      await sql`SET LOCAL session_replication_role = 'replica'`;
      if (f.rang !== undefined) await sql`UPDATE tasks SET rang = ${f.rang} WHERE id = ${id}::uuid`;
      if (f.status !== undefined) await sql`UPDATE tasks SET status = ${f.status} WHERE id = ${id}::uuid`;
      if (f.geloeschtVorTagen !== undefined) {
        await sql`UPDATE tasks SET deleted_at = now() - make_interval(days => ${f.geloeschtVorTagen}) WHERE id = ${id}::uuid`;
      }
      if (f.tageAlt !== undefined) {
        // In STUNDEN gerechnet, nicht in Tagen: nur so lässt sich die Grenze
        // von der einen wie von der anderen Seite anfahren (siehe den Test
        // „eine Stunde vor der Frist“).
        const stunden = Math.round(f.tageAlt * 24);
        await sql`UPDATE tasks SET updated_at = now() - make_interval(hours => ${stunden}) WHERE id = ${id}::uuid`;
      }
    });
  }

  const imPapierkorb = async (id: string): Promise<boolean> => {
    const [z] = await getDb()`SELECT deleted_at FROM tasks WHERE id = ${id}::uuid`;
    return z?.deleted_at != null;
  };

  it("was seit 30 Tagen niemand angefasst hat, wandert in den Papierkorb", async () => {
    const alt = await aufgabe("alt", 4, 40);
    expect(await aufgabensystemRepo.rang4Verfall(30)).toBeGreaterThanOrEqual(1);
    expect(await imPapierkorb(alt)).toBe(true);
  });

  it("„Papierkorb“ heisst wiederherstellbar — die Zeile bleibt stehen", async () => {
    // Der Unterschied zwischen Verfall und Datenverlust. Ein DELETE hier wäre
    // dasselbe Verhalten mit einem anderen Ausgang.
    const alt = await aufgabe("wiederherstellbar", 4, 40);
    await aufgabensystemRepo.rang4Verfall(30);
    const [z] = await getDb()`SELECT text FROM tasks WHERE id = ${alt}::uuid`;
    expect(z?.text).toBe(`${P}-wiederherstellbar`);

    const zurueck = await fx.app.request(`/api/papierkorb/aufgabe/${alt}/zurueckholen`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
    });
    expect(zurueck.status).toBe(200);
    expect(await imPapierkorb(alt)).toBe(false);
  });

  it("frisch Angefasstes bleibt — jede Berührung setzt die Frist zurück", async () => {
    const frisch = await aufgabe("frisch", 4, 3);
    await aufgabensystemRepo.rang4Verfall(30);
    expect(await imPapierkorb(frisch)).toBe(false);
  });

  it("eine Stunde vor der Frist bleibt es stehen, eine Stunde danach nicht", async () => {
    // Die Grenze von beiden Seiten angefahren. Ein Vorzeichenfehler oder ein
    // vertauschtes `<`/`>` in der Bedingung fällt hier auf, und zwar an einer
    // Aufgabe, die noch keinen Tag zu alt ist — nicht erst an einer, die
    // niemand vermisst.
    const knappDavor = await aufgabe("knapp-davor", 4, 30 - 1 / 24);
    const knappDanach = await aufgabe("knapp-danach", 4, 30 + 1 / 24);
    await aufgabensystemRepo.rang4Verfall(30);
    expect(await imPapierkorb(knappDavor), "knapp davor").toBe(false);
    expect(await imPapierkorb(knappDanach), "knapp danach").toBe(true);
  });

  it("die anderen drei Ränge verfallen nicht", async () => {
    const ids = [await aufgabe("r1", 1, 400), await aufgabe("r2", 2, 400), await aufgabe("r3", 3, 400)];
    await aufgabensystemRepo.rang4Verfall(30);
    for (const id of ids) expect(await imPapierkorb(id), id).toBe(false);
  });

  it("Erledigtes verfällt nicht", async () => {
    // Rang 4 und erledigt heisst: die Einordnung war richtig, und es wurde
    // trotzdem getan. Der Nachweis dafür gehört nicht in den Papierkorb.
    const id = await aufgabe("erledigt", 4, 400);
    await altern(id, { status: "done", tageAlt: 400 });
    await aufgabensystemRepo.rang4Verfall(30);
    expect(await imPapierkorb(id)).toBe(false);
  });

  it("was schon im Papierkorb liegt, wird nicht erneut angefasst", async () => {
    // Sonst würde `deleted_at` bei jedem nächtlichen Lauf neu gesetzt, und die
    // Aufbewahrungsfrist des Papierkorbs liefe nie ab.
    const id = await aufgabe("schon-weg", 4, 400);
    await altern(id, { geloeschtVorTagen: 10, tageAlt: 400 });
    const [vorher] = await getDb()`SELECT deleted_at FROM tasks WHERE id = ${id}::uuid`;
    await aufgabensystemRepo.rang4Verfall(30);
    const [nachher] = await getDb()`SELECT deleted_at FROM tasks WHERE id = ${id}::uuid`;
    expect(String(nachher.deleted_at)).toBe(String(vorher.deleted_at));
  });

  it("0 oder negativ schaltet den Verfall ab, statt alles zu löschen", async () => {
    // Der gefährlichste denkbare Fehler: `RANG4_VERFALL_TAGE=0` als „sofort“
    // gelesen. `now() - 0 Tage` ist jetzt — damit wäre JEDE Rang-4-Aufgabe weg.
    const id = await aufgabe("null-tage", 4, 400);
    expect(await aufgabensystemRepo.rang4Verfall(0)).toBe(0);
    expect(await aufgabensystemRepo.rang4Verfall(-5)).toBe(0);
    expect(await aufgabensystemRepo.rang4Verfall(Number.NaN)).toBe(0);
    expect(await imPapierkorb(id)).toBe(false);
  });
});
