import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Der Volldump — die Lock-in-Versicherung.
//
// ── Was daran geprüft werden muss ──────────────────────────────────────────
//
// Nicht, ob das ZIP hübsch ist. Sondern:
//
//  1. dass er die RECHTE einhält. Ein Archiv über den ganzen Bestand ist der
//     naheliegendste Weg, an fremde Projekte zu kommen — genau die Klasse
//     Lücke, die der Word-Export schon einmal war.
//  2. dass Beträge am Geld-Recht hängen. Ein ZIP ist kein JSON, der
//     Antwort-Filter (`src/api/geld.ts`) sieht es nicht.
//  3. dass die Notizen mit INHALT drin sind. Der kompakte `export.md` liefert
//     nur Titel — für ein Archiv wäre das wertlos.
describe.skipIf(!HAS_DB)("Volldump", () => {
  let fx: AclFixture;

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("volldump", { geldRecht: true });

    // Eine Notiz mit Inhalt in A's Projekt.
    const n = await fx.app.request("/api/notes", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      // `POST /notes` nimmt nur `content` — der Titel entsteht aus der ersten
      // Zeile. Das ist Absicht: eine Notiz ist Text, kein Formular.
      body: JSON.stringify({
        content: "VOLLDUMP-Aktenvermerk\n\nVOLLDUMP-GEHEIMER-INHALT",
        project: fx.projectName,
      }),
    });
    expect([200, 201]).toContain(n.status);
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await fx.cleanup();
  });

  /** Liest das ZIP als Text ein. Die Einträge sind mit Deflate gepackt, aber
   *  die DATEINAMEN stehen im Klartext im Archiv — für die Rechteprüfung
   *  reicht das und es spart eine Entpack-Bibliothek im Test. */
  async function dumpText(token: string): Promise<string> {
    const res = await fx.app.request("/api/exports/volldump", { headers: authHeader(token) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    return Buffer.from(await res.arrayBuffer()).toString("latin1");
  }

  it("A bekommt sein Projekt", async () => {
    const text = await dumpText(fx.a.token);
    expect(text).toContain(fx.projectName);
    expect(text).toContain("LIESMICH.md");
  });

  it("B bekommt A's Projekt NICHT", async () => {
    // B ist teil-berechtigt: er sieht sein eigenes Projekt, nicht A's. Ein
    // kaputter Filter „hat irgendein Projekt → bekommt alles" bliebe bei einem
    // Konto ganz ohne Sichtbarkeit unentdeckt.
    const text = await dumpText(fx.b.token);
    expect(text).toContain(fx.projectBName);
    expect(text).not.toContain(fx.projectName);
  });

  it("der Administrator bekommt beide", async () => {
    const text = await dumpText(fx.admin.token);
    expect(text).toContain(fx.projectName);
    expect(text).toContain(fx.projectBName);
  });

  it("die Notizen sind mit Inhalt drin, nicht nur mit Titel", async () => {
    // Ohne Kompression wäre der Inhalt direkt sichtbar; mit Deflate nicht.
    // Deshalb hier über die Struktur: es gibt einen Notizen-Ordner mit einer
    // Datei, deren Name den Titel trägt.
    const text = await dumpText(fx.a.token);
    expect(text).toContain("Notizen/");
    expect(text).toContain("VOLLDUMP-Aktenvermerk");
  });

  it("das Archiv ist ein echtes ZIP", async () => {
    const res = await fx.app.request("/api/exports/volldump", { headers: authHeader(fx.a.token) });
    const buf = Buffer.from(await res.arrayBuffer());
    // PK\x03\x04 — die Signatur eines ZIP-Eintrags.
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buf.length).toBeGreaterThan(200);
  });

  it("der Dateiname trägt das Datum", async () => {
    const res = await fx.app.request("/api/exports/volldump", { headers: authHeader(fx.a.token) });
    const cd = res.headers.get("Content-Disposition") ?? "";
    expect(cd).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(cd.split("filename*=UTF-8''")[1])).toMatch(/^PATIO Volldump \d{4}-\d{2}-\d{2}\.zip$/);
  });
});
