import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { HAS_DB, setupAclFixture, authHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Sicherungs-Status.
//
// Der Grund für diese Route ist unspektakulär und teuer: die Sicherung läuft
// als systemd-Timer, `OnFailure=` meldet einen Fehlschlag ins Journal — und
// dort schaut niemand hinein. Eine Sicherung, die seit Wochen still
// scheitert, fällt erst auf, wenn man sie braucht.
//
// Der Test baut ein echtes Sicherungsverzeichnis im Temp-Ordner nach, statt
// die Dateizugriffe wegzumocken: geprüft werden soll ja gerade, dass die
// Route den Aufbau richtig liest, den `scripts/backup.sh` erzeugt — samt der
// Unterscheidung zwischen vollständigen und abgebrochenen Ständen.
describe.skipIf(!HAS_DB)("Sicherungs-Status", () => {
  let fx: AclFixture;
  let dir = "";

  /** Legt einen Stand an. `vollstaendig` steuert den Marker, den
   *  `scripts/backup.sh` erst nach dem letzten erfolgreichen Schritt schreibt. */
  function stand(stufe: string, name: string, vollstaendig: boolean, zeitpunkt: string) {
    const p = path.join(dir, stufe, name);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "datenbank.sql.gz"), "x".repeat(100));
    if (vollstaendig) fs.writeFileSync(path.join(p, "VOLLSTAENDIG"), zeitpunkt);
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "patio-sicherung-"));
    process.env.SICHERUNG_DIR = dir;

    const jetzt = new Date();
    const vorEinerStunde = new Date(jetzt.getTime() - 3_600_000).toISOString();
    const vorFuenfTagen = new Date(jetzt.getTime() - 5 * 86_400_000).toISOString();

    stand("taeglich", "2026-08-06_0300", true, vorEinerStunde);
    stand("taeglich", "2026-08-05_0300", true, vorFuenfTagen);
    stand("taeglich", "2026-08-04_0300.UNVOLLSTAENDIG", false, "");
    stand("woechentlich", "2026-W31", true, vorFuenfTagen);

    fx = await setupAclFixture("sich");
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
    delete process.env.SICHERUNG_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("meldet den jüngsten vollständigen Stand als in Ordnung", async () => {
    const res = await fx.app.request("/api/sicherung", { headers: authHeader(fx.admin.token) });
    expect(res.status).toBe(200);
    const s = (await res.json()) as {
      eingerichtet: boolean;
      inOrdnung: boolean;
      stundenHer: number;
      juengste: { name: string; groesse: number };
      anzahl: { taeglich: number; woechentlich: number; abgebrochen: number };
    };
    expect(s.eingerichtet).toBe(true);
    expect(s.inOrdnung).toBe(true);
    expect(s.stundenHer).toBeLessThanOrEqual(2);
    expect(s.juengste.name).toBe("2026-08-06_0300");
    expect(s.juengste.groesse).toBeGreaterThan(0);
  });

  it("zählt abgebrochene Stände getrennt und nicht als Sicherung", async () => {
    // Das ist der eigentliche Punkt: ein abgebrochener Lauf hinterlässt ein
    // Verzeichnis, das aussieht wie eine Sicherung. Zählte man es mit, sähe
    // eine seit Tagen scheiternde Sicherung gesund aus.
    const res = await fx.app.request("/api/sicherung", { headers: authHeader(fx.admin.token) });
    const s = (await res.json()) as { anzahl: { taeglich: number; abgebrochen: number } };
    expect(s.anzahl.taeglich).toBe(2);
    expect(s.anzahl.abgebrochen).toBe(1);
  });

  it("meldet Alarm, wenn der jüngste vollständige Stand zu alt ist", async () => {
    // Der Timer läuft nächtlich; mehr als 48 Stunden heißt, mindestens ein
    // Lauf ist ausgefallen.
    const alt = fs.mkdtempSync(path.join(os.tmpdir(), "patio-sicherung-alt-"));
    const vorher = process.env.SICHERUNG_DIR;
    try {
      const p = path.join(alt, "taeglich", "2026-07-01_0300");
      fs.mkdirSync(p, { recursive: true });
      fs.writeFileSync(path.join(p, "VOLLSTAENDIG"), new Date(Date.now() - 10 * 86_400_000).toISOString());
      // Die Route liest den Pfad bei jedem Aufruf — das Umstellen der
      // Umgebungsvariable genuegt, kein Neu-Import noetig.
      process.env.SICHERUNG_DIR = alt;

      const res = await fx.app.request("/api/sicherung", { headers: authHeader(fx.admin.token) });
      const s = (await res.json()) as { inOrdnung: boolean; stundenHer: number };
      expect(s.inOrdnung).toBe(false);
      expect(s.stundenHer).toBeGreaterThan(48);
    } finally {
      process.env.SICHERUNG_DIR = vorher;
      fs.rmSync(alt, { recursive: true, force: true });
    }
  });

  it("ohne Sicherungsverzeichnis kommt eine Erklärung, kein Fehler", async () => {
    // Auf dem Entwicklungsrechner gibt es das Verzeichnis nicht. Ein 500 wäre
    // dort ein Fehlalarm, der die echte Warnung entwertet.
    const vorher = process.env.SICHERUNG_DIR;
    process.env.SICHERUNG_DIR = path.join(os.tmpdir(), "gibt-es-nicht-" + Date.now());
    try {
      const res = await fx.app.request("/api/sicherung", { headers: authHeader(fx.admin.token) });
      expect(res.status).toBe(200);
      const s = (await res.json()) as { eingerichtet: boolean; hinweis: string };
      expect(s.eingerichtet).toBe(false);
      expect(s.hinweis).toContain("Entwicklungsrechner");
    } finally {
      process.env.SICHERUNG_DIR = vorher;
    }
  });

  it("den Zustand der Sicherung sieht nur die Verwaltung", async () => {
    // Eine Sicherung enthält den GESAMTEN Bestand — auch die Projekte, die
    // für diese Person ausgeblendet sind. Schon ihre Größe ist eine Auskunft.
    const res = await fx.app.request("/api/sicherung", { headers: authHeader(fx.a.token) });
    expect(res.status).toBe(403);
  });
});
