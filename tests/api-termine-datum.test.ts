import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// `termine.datum` ist ISO — und was daran hing.
//
// ── Der Fehler, der ein Jahr lang unbemerkt blieb ──────────────────────────
//
// `termine.datum` war eine TEXT-Spalte, gefüllt mit `TT.MM.JJJJ`. Das Board im
// Besprechungsraum vergleicht `t.datum = <heute als ISO>`. Gegen `15.09.2026`
// trifft das nie zu — **kein von Hand angelegter Termin ist je auf dem Board
// erschienen**. Es warf dabei nie einen Fehler; es sah aus wie ein ruhiger Tag.
//
// (Die Auto-Meilensteine aus `db-phases.ts` erschienen sehr wohl: die stehen
// seit jeher in ISO in derselben Spalte. Hier stand zwischenzeitlich „keinen
// einzigen Termin" — das war zu absolut.)
//
// `tests/api-board.test.ts` prüfte nur, DASS die Route mit 200 antwortet, nicht
// WAS sie liefert. Genau diese Lücke schließt diese Datei.
//
// ── Warum alle Daten relativ zu „heute“ gebildet werden ────────────────────
//
// Ein fest verdrahtetes `2026-04-15` ist nächstes Jahr tot, und die Prüfung
// wäre dann grün, weil nichts mehr in den Zeitraum fällt. „Heute" kommt aus
// derselben Quelle wie beim Server (Datenbank + Zeitzone des Büros), sonst
// scheitert der Vergleich um Mitternacht an der Zeitzone statt am geprüften Code.
describe.skipIf(!HAS_DB)("Termine: das Datum ist ISO", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;
  let heute = "";
  const angelegt: string[] = [];
  const angelegtAufgaben: string[] = [];

  /** Ein Tag relativ zu heute, als `YYYY-MM-DD`. */
  function tag(versatz: number): string {
    const d = new Date(`${heute}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + versatz);
    return d.toISOString().slice(0, 10);
  }

  /** Dasselbe als `TT.MM.JJJJ` — die Schreibweise, die ältere Aufrufer schicken. */
  function tagDe(versatz: number): string {
    const [j, m, t] = tag(versatz).split("-");
    return `${t}.${m}.${j}`;
  }

  async function anlegen(datum: string, text: string, projekt?: string): Promise<Response> {
    const res = await fx.app.request("/api/termine", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ datum, text, ...(projekt ? { project: projekt } : {}) }),
    });
    if (res.status === 201) angelegt.push(((await res.clone().json()) as { id: string }).id);
    return res;
  }

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("termdatum");
    ({ getDb } = await import("../src/db/client.js"));
    const { heuteIso } = await import("../src/data/heute.js");
    heute = await heuteIso();
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    for (const id of angelegt) await getDb()`DELETE FROM termine WHERE id = ${id}`;
    for (const id of angelegtAufgaben) await getDb()`DELETE FROM tasks WHERE id = ${id}`;
    await fx.cleanup();
  });

  // ── 1. Der Kern: ein Termin von heute steht auf dem Board ────────────────

  it("ein Termin für heute erscheint auf /board/heute", async () => {
    const res = await anlegen(tagDe(0), `termdatum-heute-${heute}`, fx.projectName);
    expect(res.status).toBe(201);

    const board = await fx.app.request("/api/board/heute", { headers: authHeader(fx.a.token) });
    expect(board.status).toBe(200);
    const daten = (await board.json()) as { datum: string; termine: { text: string }[] };
    expect(daten.datum).toBe(heute);
    expect(daten.termine.map((t) => t.text)).toContain(`termdatum-heute-${heute}`);
  });

  it("derselbe Termin erscheint in /dashboard", async () => {
    // `todayTermine` war bis hierher völlig ungetestet — und benutzte
    // `includes` auf einer Zeichenkette plus die Zeitzone des Prozesses.
    const res = await fx.app.request("/api/dashboard", { headers: authHeader(fx.a.token) });
    expect(res.status).toBe(200);
    const daten = (await res.json()) as { todayTermine: string[] };
    expect(daten.todayTermine.join(" ")).toContain(`termdatum-heute-${heute}`);
  });

  it("Dashboard und Board sind sich über „heute“ einig", async () => {
    // ⚠ Diese Prüfung ersetzt eine, die nichts festgehalten hat.
    //
    // Zuerst stand hier ein Termin, dessen TEXT das heutige Datum trug — mit
    // der Annahme, `t.datum.includes(today)` habe ihn mitgezählt. Das war
    // falsch gelesen: das `includes` lief auf `t.datum`, nicht auf `t.text`,
    // und bei zwei zehn Zeichen langen Zeichenketten fällt es mit der
    // Gleichheit zusammen. Die Gegenprobe blieb entsprechend grün.
    //
    // Der echte Fehler war die ZEITZONE: `new Date()` im Container liest UTC,
    // und zwischen Mitternacht und zwei Uhr früh zeigte die Kachel den
    // Vortag. Prüfbar ist das über die Übereinstimmung mit dem Board, das
    // „heute“ schon immer aus der Datenbank geholt hat — nimmt jemand
    // `new Date()` zurück, laufen die beiden Antworten auseinander.
    const board = (await (await fx.app.request("/api/board/heute", { headers: authHeader(fx.a.token) })).json()) as {
      datum: string;
      termine: { text: string }[];
    };
    const dash = (await (await fx.app.request("/api/dashboard", { headers: authHeader(fx.a.token) })).json()) as {
      todayTermine: string[];
    };

    expect(board.datum).toBe(heute);
    // Derselbe Termin von heute muss in beiden auftauchen — oder in keinem.
    const imBoard = board.termine.some((t) => t.text === `termdatum-heute-${heute}`);
    const imDashboard = dash.todayTermine.join(" ").includes(`termdatum-heute-${heute}`);
    expect(imDashboard, "Dashboard und Board sind sich über „heute“ nicht einig").toBe(imBoard);
  });

  it("ein Termin in 40 Tagen steht weder auf dem Board noch im Dashboard", async () => {
    const res = await anlegen(tagDe(40), "termdatum-weit-weg", fx.projectName);
    expect(res.status).toBe(201);

    const board = await fx.app.request("/api/board/heute", { headers: authHeader(fx.a.token) });
    expect(((await board.json()) as { termine: { text: string }[] }).termine.map((t) => t.text)).not.toContain(
      "termdatum-weit-weg",
    );

    const dash = await fx.app.request("/api/dashboard", { headers: authHeader(fx.a.token) });
    expect(((await dash.json()) as { todayTermine: string[] }).todayTermine.join(" ")).not.toContain(
      "termdatum-weit-weg",
    );
  });

  // ── 2. Die Wochenansicht ─────────────────────────────────────────────────

  it("/board/woche enthält heute+3, aber nicht heute+10", async () => {
    // Fängt zugleich den 42883-Fehler: bliebe das `::text` im Vergleich
    // stehen, antwortete die Route mit 500 („operator does not exist:
    // date < text") statt mit einer Liste.
    expect((await anlegen(tagDe(3), "termdatum-in-drei-tagen", fx.projectName)).status).toBe(201);
    expect((await anlegen(tagDe(10), "termdatum-in-zehn-tagen", fx.projectName)).status).toBe(201);

    const res = await fx.app.request("/api/board/woche", { headers: authHeader(fx.a.token) });
    expect(res.status).toBe(200);
    const daten = (await res.json()) as { tage: { datum: string; termine: { text: string }[] }[] };
    const alle = daten.tage.flatMap((t) => t.termine.map((x) => x.text));
    expect(alle).toContain("termdatum-in-drei-tagen");
    expect(alle).not.toContain("termdatum-in-zehn-tagen");
  });

  it("die Tages-Überschriften der Woche sind ISO, kein Wochentag", async () => {
    // Der Map-Schlüssel kam aus `String(r.datum)`. Seit die Spalte `date` ist,
    // ergäbe das „Sat Jun 20 2026 …" — sieben Spalten mit Unsinn.
    const res = await fx.app.request("/api/board/woche", { headers: authHeader(fx.a.token) });
    const daten = (await res.json()) as { tage: { datum: string }[] };
    for (const t of daten.tage) {
      expect(t.datum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.datum).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
    }
  });

  // ── 3. Der 500er für Konten mit eingeschränkter Sichtbarkeit ─────────────

  it("/board/heute antwortet auch einem Nicht-Admin, statt mit 500 zu sterben", async () => {
    // ⚠ Der Grund, warum dieser Fehler nie auffiel: für Admins ist die
    // Projektbedingung die Zeichenkette `TRUE`, und der fehlerhafte
    // `replace("project_id", "b.project_id")` findet darin nichts. Er traf
    // ausschließlich Konten mit eingeschränkter Sichtbarkeit — und die
    // bestehende Board-Suite fuhr diese Route nur mit dem Board- und dem
    // Admin-Konto.
    for (const [wer, token] of [
      ["A", fx.a.token],
      ["B", fx.b.token],
    ] as const) {
      const res = await fx.app.request("/api/board/heute", { headers: authHeader(token) });
      expect(res.status, `als ${wer}`).toBe(200);
    }
  });

  it("ein Bautagebuch-Eintrag von heute erscheint auf dem Board", async () => {
    // Die zweite Hälfte derselben Abfrage — bis hierher nie ausgeführt.
    // Ein Bautagebuch-Eintrag wird über das Datum adressiert (ein Eintrag je
    // Projekt und Tag, `UNIQUE (project_id, entry_date)`) — deshalb PUT.
    const res = await fx.app.request(
      `/api/projects/${encodeURIComponent(fx.projectName)}/bautagebuch/${encodeURIComponent(heute)}`,
      {
        method: "PUT",
        headers: jsonHeader(fx.a.token),
        body: JSON.stringify({ activities: "termdatum-bautagebuch" }),
      },
    );
    expect([200, 201]).toContain(res.status);

    const board = await fx.app.request("/api/board/heute", { headers: authHeader(fx.a.token) });
    expect(board.status).toBe(200);
    const daten = (await board.json()) as { bautagebuch: { taetigkeiten: string | null }[] };
    expect(daten.bautagebuch.map((b) => b.taetigkeiten ?? "").join(" ")).toContain("termdatum-bautagebuch");
  });

  // ── 4. Sortierung ────────────────────────────────────────────────────────

  it("Termine sortieren nach Datum, nicht nach Tag-im-Monat", async () => {
    // Mit `TT.MM.JJJJ` als Text sortierte `ORDER BY datum` nach dem TAG:
    // 03.12. kam vor 15.01., und das sah nach einer eigenwilligen Reihenfolge
    // aus statt nach einem Fehler.
    const p = fx.projectName;
    expect((await anlegen(tagDe(300), "termdatum-c-spaet", p)).status).toBe(201);
    expect((await anlegen(tagDe(100), "termdatum-a-frueh", p)).status).toBe(201);
    expect((await anlegen(tagDe(200), "termdatum-b-mitte", p)).status).toBe(201);

    const res = await fx.app.request(`/api/projects/${encodeURIComponent(p)}/termine`, {
      headers: authHeader(fx.a.token),
    });
    const reihe = ((await res.json()) as { text: string }[])
      .map((t) => t.text)
      .filter((t) => t.startsWith("termdatum-a-") || t.startsWith("termdatum-b-") || t.startsWith("termdatum-c-"));
    expect(reihe).toEqual(["termdatum-a-frueh", "termdatum-b-mitte", "termdatum-c-spaet"]);
  });

  // ── 5. Regressionsschutz gegen die Wochentags-Falle ──────────────────────

  it("jede datum-Antwort ist ISO und beginnt nie mit einem Wochentag", async () => {
    const res = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/termine`, {
      headers: authHeader(fx.a.token),
    });
    const termine = (await res.json()) as { datum: string }[];
    expect(termine.length).toBeGreaterThan(0);
    for (const t of termine) {
      expect(t.datum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.datum).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
    }
  });

  it("das Portfolio liefert die nächste Frist als ISO", async () => {
    const res = await fx.app.request("/api/portfolio", { headers: authHeader(fx.a.token) });
    expect(res.status).toBe(200);
    const zeilen = (await res.json()) as { name: string; nextDeadline: string | null }[];
    const meins = zeilen.find((z) => z.name === fx.projectName);
    expect(meins?.nextDeadline, "keine Frist gefunden").toBeTruthy();
    expect(meins!.nextDeadline!).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meins!.nextDeadline!).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
  });

  // ── 6. Ein Tag, den es nicht gibt ────────────────────────────────────────

  it("ein LEERES Datum wird abgewiesen, statt einen Serverfehler zu erzeugen", async () => {
    // ⚠ Diese Prüfung deckt eine Regression ab, die Migration 060 selbst
    // erzeugt hätte. `db-termine.update()` prüfte mit `if (updates.datum)`,
    // und ein leerer String ist falsy — die Prüfung lief nicht. Solange die
    // Spalte TEXT war, landete dort einfach `""`: falsch, aber lautlos.
    // Danach wirft der Treiber `RangeError: Invalid time value`, also einen
    // unbehandelten 500er.
    //
    // Aus der Oberfläche erreichbar: Das Datumsfeld im Kalender lässt sich
    // leeren, und `save()` schickt den Wert ungeprüft mit.
    const angelegt = await anlegen(tagDe(2), "termdatum-leeres-datum", fx.projectName);
    const t = (await angelegt.json()) as { id: string; rev: number };

    const res = await fx.app.request(`/api/termine/${t.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: "termdatum-leeres-datum", datum: "", rev: t.rev }),
    });
    expect(res.status, "leeres Datum ergibt einen Serverfehler statt einer Absage").toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Datumsformat");

    // Und der Termin steht unverändert da — nicht halb geschrieben.
    const danach = await fx.app.request(`/api/termine/${t.id}`, { headers: authHeader(fx.a.token) });
    if (danach.status === 200) {
      expect(((await danach.json()) as { datum: string }).datum).toBe(tag(2));
    }
  });

  it("der 31. Februar wird abgewiesen", async () => {
    // Kam bis zum 01.09.2026 durch: `validateDatum` prüfte nur Bereiche.
    const res = await fx.app.request("/api/termine", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ datum: "31.02.2026", text: "termdatum-gibt-es-nicht" }),
    });
    expect(res.status).toBe(400);
  });

  // ── 7. Rückwärtskompatibilität und der Altwert beim PUT ──────────────────

  it("TT.MM.JJJJ geht hinein, ISO kommt heraus", async () => {
    // Nagelt die Entscheidung fest: die Route nimmt weiterhin beide Formate
    // an — es gibt Aufrufer außerhalb der eigenen Oberfläche. Geliefert wird
    // ausschließlich ISO.
    const res = await anlegen(tagDe(5), "termdatum-rueckwaerts", fx.projectName);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { datum: string }).datum).toBe(tag(5));
  });

  it("ein PUT ohne datum lässt das Datum unverändert", async () => {
    // ⚠ Die heikelste Stelle des Umbaus: `update()` liest den Altwert aus
    // `SELECT * FROM termine`, und der ist seit Migration 060 ein `Date`.
    // Ungeprüft durchgereicht ginge daraus ein Objekt in den `UPDATE` zurück.
    const angelegt2 = await anlegen(tagDe(7), "termdatum-put-ohne-datum", fx.projectName);
    const t = (await angelegt2.json()) as { id: string; datum: string; rev: number };
    expect(t.datum).toBe(tag(7));

    const put = await fx.app.request(`/api/termine/${t.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: "termdatum-put-ohne-datum (umbenannt)", rev: t.rev }),
    });
    expect(put.status).toBe(200);
    const danach = (await put.json()) as { datum: string; text: string };
    expect(danach.text).toBe("termdatum-put-ohne-datum (umbenannt)");
    expect(danach.datum, "das Datum hat sich beim Umbenennen verändert").toBe(tag(7));
  });

  it("ein Date-Objekt in einen date-Parameter verschiebt den Tag — die Zeichenkette nicht", async () => {
    // ⚠ Diese Prüfung belegt, WARUM die Zeile darüber `dateStrPflicht(...)`
    // heißt und nicht `current.datum`.
    //
    // Der Unterschied ist auf dieser Maschine nicht sichtbar: Die
    // Testdatenbank läuft auf UTC, und dort ergeben beide Wege denselben Tag.
    // Die Gegenprobe („Fix zurücknehmen, Prüfung muss rot werden") blieb
    // deshalb grün — der Test hätte nichts festgehalten.
    //
    // Am Treiber nachgemessen (01.09.2026, postgres 3.4.9): ein `Date` mit
    // UTC-Mitternacht, gebunden an eine `date`-Spalte, ergibt in
    // `America/New_York` und `Pacific/Honolulu` den VORTAG. Genau das prüft
    // diese Zeile nach — mit `SET LOCAL`, das mit der Transaktion endet und
    // die übrigen Verbindungen des Pools nicht anfasst.
    //
    // ⚠ **Ehrlich gesagt, was das NICHT leistet:** Diese Prüfung belegt die
    // Treiber-Eigenschaft, nicht den Repository-Pfad. Nimmt jemand in
    // `db-termine.update()` das `dateStrPflicht(...)` heraus, bleibt die
    // ganze Suite grün — weil die Verbindungen der Anwendung auf UTC laufen
    // und dort beide Wege denselben Tag ergeben. Rot würde sie erst, wenn der
    // Server selbst in einer westlichen Zeitzone liefe; das dafür nötige
    // `ALTER DATABASE … SET TimeZone` gälte für alle Verbindungen und machte
    // die übrige Suite unzuverlässig. Der Schutz an dieser einen Zeile ist
    // also diese Messung plus der Kommentar dort — nicht mehr.
    await getDb().begin(async (tx) => {
      await tx.unsafe("SET LOCAL TIME ZONE 'America/New_York'");
      await tx`CREATE TEMP TABLE datumsprobe (d date) ON COMMIT DROP`;

      const alsObjekt = new Date("2026-09-08T00:00:00.000Z");
      await tx`INSERT INTO datumsprobe (d) VALUES (${alsObjekt})`;
      const [objekt] = await tx`SELECT to_char(d, 'YYYY-MM-DD') AS s FROM datumsprobe`;
      expect(objekt.s, "der Treiber verschiebt nicht mehr — dann darf die Regel gelockert werden").toBe("2026-09-07");

      await tx`DELETE FROM datumsprobe`;
      await tx`INSERT INTO datumsprobe (d) VALUES (${"2026-09-08"})`;
      const [text] = await tx`SELECT to_char(d, 'YYYY-MM-DD') AS s FROM datumsprobe`;
      expect(text.s, "so soll es sein: die Zeichenkette ist zeitzonenfest").toBe("2026-09-08");
    });
  });

  // ── 7b. Die anderen Datumsspalten ────────────────────────────────────────

  it("die Stammdaten eines Projekts liefern ISO, keinen Wochentag", async () => {
    // ⚠ `projects.start_date` und `end_date` sind seit Migration 004 echte
    // `date`-Spalten, wurden im DTO aber mit `String(...)` behandelt. Das
    // ergibt „Sun Mar 01 2026 01:00:00 GMT+0100 (…)" — dieselbe
    // Wochentags-Falle wie bei `termine.datum`, eine Tabelle weiter.
    //
    // Sichtbar wurde sie in den Stammdaten der Projektakte, im Dossier und in
    // der KI-Akte; das Datumsfeld zum Bearbeiten blieb leer, weil ein
    // `<input type="date">` nur ISO annimmt.
    const gesetzt = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ startDate: "2026-03-01", endDate: "2027-11-30" }),
    });
    expect(gesetzt.status).toBe(200);

    const res = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      headers: authHeader(fx.admin.token),
    });
    const info = (await res.json()) as { startDate: string | null; endDate: string | null };
    expect(info.startDate).toBe("2026-03-01");
    expect(info.endDate).toBe("2027-11-30");
    expect(info.startDate).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);

    // Und im Dossier steht dasselbe, nicht der Rohwert.
    const dossier = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/export.md`, {
      headers: authHeader(fx.admin.token),
    });
    const md = await dossier.text();
    expect(md).toContain("2026-03-01");
    expect(md, "der Wochentag steht im Dossier").not.toMatch(/\| Start \| (Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
  });

  it("eine Aufgabe nimmt kein unmögliches Fälligkeitsdatum an", async () => {
    // `tasks.date` ist die letzte TEXT-Datumsspalte und hatte NIRGENDS eine
    // Formatprüfung. Der Wartungslauf vergleicht sie mit ISO — bei einem
    // deutschen Datum bleibt die Fälligkeitsmeldung für immer aus, ohne
    // Fehler; und das Board sortiert sie als Zeichenkette immer nach oben.
    const res = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: "termdatum-faellig-kaputt", date: "31.02.2026", project: fx.projectName }),
    });
    expect(res.status).toBe(400);
  });

  it("ein deutsches Fälligkeitsdatum wird als ISO gespeichert", async () => {
    const res = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: "termdatum-faellig-de", date: tagDe(9), project: fx.projectName }),
    });
    expect([200, 201]).toContain(res.status);
    const t = (await res.json()) as { id: string; date: string | null };
    angelegtAufgaben.push(t.id);
    expect(t.date, "das deutsche Datum steht unverändert in der TEXT-Spalte").toBe(tag(9));
  });

  // ── 8. Das Schema selbst ─────────────────────────────────────────────────

  it("termine.datum ist eine date-Spalte und bleibt NOT NULL", async () => {
    // Verhindert, dass eine spätere Migration die Spalte je wieder auf Text
    // setzt — und dass jemand `NOT NULL` fallen lässt, was `string | null`
    // durch API, Export und Oberfläche zöge.
    const [spalte] = await getDb()`
      SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'termine' AND column_name = 'datum'`;
    expect(spalte?.data_type).toBe("date");
    expect(spalte?.is_nullable).toBe("NO");
  });

  it("der Index auf termine.datum hat den Typwechsel überlebt", async () => {
    const zeilen = await getDb()`
      SELECT indexname FROM pg_indexes WHERE tablename = 'termine' AND indexname = 'idx_termine_datum'`;
    expect(zeilen.length, "idx_termine_datum fehlt").toBe(1);
  });
});
