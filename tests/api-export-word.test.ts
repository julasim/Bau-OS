import { describe, it, expect, beforeAll, afterAll } from "vitest";
import PizZip from "pizzip";
import { HAS_DB, setupAclFixture, authHeader, type AclFixture, namensraum } from "./helpers/acl-fixture.js";

// Der Word-Weg des Exports — die Lücke, durch die ein Totalausfall gerutscht ist.
//
// ── Warum es diese Datei gibt ──────────────────────────────────────────────
//
// `src/api/routes/export-templates.ts` lieferte Word-Dokumente über eine
// Funktion aus, die sich ohne `?format=pdf` selbst aufrief — eine
// Endlosrekursion. Betroffen waren alle sechs Export-Wege im Normalfall: Wer
// ein Word-Dokument wollte, bekam keines. Der Fehler steckte seit `275ee77`
// drin, dem Commit, der den PDF-Schalter einbaute.
//
// Gefunden hat ihn niemand, weil KEIN Test bis zur Auslieferung kam. In der
// Testdatenbank liegt keine Word-Vorlage, deshalb enden alle vorhandenen
// Export-Tests vorher:
//
//   400  keine Vorlage hinterlegt
//   403  fremdes Projekt / fehlendes Geld-Recht
//   404  unbekannte Rechnung
//
// Vier Tests über den Rechnungs-Export, und keiner erreichte die eine Zeile,
// in der der Fehler stand. Diese Datei lädt deshalb eine echte Vorlage hoch
// und geht den Weg zu Ende.
//
// ── Warum die Vorlage hier gebaut wird ─────────────────────────────────────
//
// Eine `.docx` ist ein ZIP mit XML darin. Eine Binärdatei ins Repo zu legen
// hiesse, etwas mitzuschleppen, das niemand lesen und niemand prüfen kann.
// `pizzip` ist ohnehin Abhängigkeit (docxtemplater baut darauf), also entsteht
// die Vorlage hier aus drei sichtbaren XML-Schnipseln — dem Minimum, das Word
// und docxtemplater als gültiges Dokument akzeptieren.

/** Kleinstmögliche gültige .docx mit einem docxtemplater-Platzhalter. */
function baueVorlage(inhalt = "Projekt: {Projekt.Name}"): Buffer {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels")!.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word")!.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>${inhalt}</w:t></w:r></w:p></w:body>
</w:document>`,
  );
  return zip.generate({ type: "nodebuffer" });
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe.skipIf(!HAS_DB)("Export: der Word-Weg kommt bis zum Dokument", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;
  let vorlagenId = "";
  const P = `word-${namensraum()}`;

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("wordexp", { geldRecht: true });
    ({ getDb } = await import("../src/db/client.js"));

    // Vorlage hochladen — ohne sie endet jeder Export vorher mit 400.
    const form = new FormData();
    form.append("kind", "project-summary");
    form.append("name", `${P}-Vorlage`);
    // Ohne diesen Schalter findet der Export keine Standardvorlage und endet
    // mit 400 — genau der Grund, warum die vorhandenen Tests nie bis zur
    // Auslieferung kamen.
    form.append("isDefault", "true");
    form.append("file", new Blob([new Uint8Array(baueVorlage())]), `${P}.docx`);

    const res = await fx.app.request("/api/export-templates", {
      method: "POST",
      headers: authHeader(fx.admin.token),
      body: form,
    });
    expect(res.status, "Vorlage hochladen").toBe(201);
    vorlagenId = ((await res.json()) as { id: string }).id;
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    if (vorlagenId) await getDb()`DELETE FROM export_templates WHERE id = ${vorlagenId}::uuid`;
    await fx.cleanup();
  });

  it("liefert ein Word-Dokument, keine Endlosrekursion", async () => {
    // DER Test. Vor der Behebung lief die Auslieferung hier in eine
    // Endlosrekursion: die Funktion rief sich mit denselben Argumenten selbst.
    const n = encodeURIComponent(fx.projectName);
    const res = await fx.app.request(`/api/exports/project/${n}/summary`, {
      headers: authHeader(fx.admin.token),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(DOCX_MIME);

    // Wirklich ein Dokument und nicht bloss ein leerer Rumpf: eine .docx ist
    // ein ZIP, beginnt also mit "PK".
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(300);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("der Dateiname steht im Content-Disposition und traegt .docx", async () => {
    const n = encodeURIComponent(fx.projectName);
    const res = await fx.app.request(`/api/exports/project/${n}/summary`, {
      headers: authHeader(fx.admin.token),
    });
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain("attachment");
    expect(cd).toMatch(/\.docx/);
  });

  it("die Test-Vorschau der Vorlage liefert ebenfalls Word", async () => {
    // Zweiter Aufrufer derselben Funktion — er lief in dieselbe Rekursion.
    const res = await fx.app.request(`/api/export-templates/${vorlagenId}/test`, {
      headers: authHeader(fx.admin.token),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(DOCX_MIME);
  });

  it("mit ?format=pdf geht der andere Zweig — je nach Server 200 oder 503", async () => {
    // LibreOffice ist optional. Beide Antworten sind richtig; falsch waere ein
    // 500er oder ein Hänger.
    const n = encodeURIComponent(fx.projectName);
    const res = await fx.app.request(`/api/exports/project/${n}/summary?format=pdf`, {
      headers: authHeader(fx.admin.token),
    });
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers.get("content-type")).toBe("application/pdf");
    }
  });
});
