// ============================================================
// PATIO — Export-Templates-Routes (Phase 6d)
// ============================================================
// CRUD fuer .docx-Templates (Settings-UI) + die eigentlichen
// Export-Endpoints die ein gerendertes .docx ausliefern.
//
//   GET    /api/export-templates                      → Liste
//   GET    /api/export-templates/:id                   → einzeln
//   POST   /api/export-templates  (multipart .docx)    → Upload
//   POST   /api/export-templates/:id/default           → Default setzen
//   GET    /api/export-templates/:id/file              → Download Original
//   GET    /api/export-templates/:id/test              → Test-Render mit Dummy-Daten
//   DELETE /api/export-templates/:id                   → Loeschen
//   GET    /api/export-templates/_variables?kind=…     → Tag-Doku
//
//   GET    /api/exports/meeting/:id
//   GET    /api/exports/bautagebuch/:id
//   GET    /api/exports/time-entries?...
//   GET    /api/exports/project/:name/summary
//   GET    /api/exports/invoice/:id           (braucht zusaetzlich das Geld-Recht)
//   GET    /api/exports/faehigkeiten           → { pdf: boolean }
//   GET    /api/exports/volldump               → der ganze sichtbare Bestand
//                                                als ZIP (Markdown + Dateien)
//
//   Alle Export-Endpunkte verstehen `?format=pdf` — dieselbe Word-Datei,
//   durch LibreOffice geschickt. Fehlt LibreOffice, kommt ein 503 mit einem
//   Satz in Klartext statt eines 500ers.
//
//   (Die Pfade tragen KEINE .docx-Endung — sie stand hier jahrelang und
//   fuehrte beim Nachbauen des Aufrufs zuverlaessig in einen 404. Die Endung
//   entsteht erst im Content-Disposition-Header.)
//
//   Alle vier lesen `?templateId=` und rendern damit eine andere als die
//   Standardvorlage.
// ============================================================

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../server.js";
import {
  listExportTemplates,
  getExportTemplate,
  createExportTemplate,
  setDefaultExportTemplate,
  deleteExportTemplate,
  loadExportTemplateBlob,
  type ExportKind,
} from "../../data/db-export-templates.js";
import { renderDocxExport, renderDocxTest, listExportVariables, DocxRenderError } from "../../export/docx-render.js";
import { canSeeProjectByName, type UserCtx, type Rolle } from "../../data/access.js";
import { meetingRepo, bautagebuchRepo, invoiceRepo, projectRepo } from "../../data/index.js";
import { darfGeldSehen } from "../geld.js";
import { logError } from "../../logger.js";
import { adminMiddleware } from "../auth.js";
import { contentDisposition } from "../dateiname.js";
import { docxNachPdf, pdfMoeglich, PdfNichtMoeglich } from "../../export/pdf.js";
import { volldumpAlsZip } from "../../export/volldump.js";
import { getVisibleProjectIds } from "../../data/access.js";
import { darfPersonendatenSehen } from "../personendaten.js";
import { protokolliereAbfluss } from "../datenabfluss.js";

export const exportTemplatesRoutes = new Hono<AppEnv>();

// ── Wer darf hier schreiben? ─────────────────────────────────────────────────
//
// Diese Daten gelten fuer das ganze Buero. Wer sie aendert, aendert sie fuer
// alle — bis hin zum Loeschen der einzigen Word-Vorlage, mit der Rechnungen
// erzeugt werden. Bis hierher konnte das JEDER angemeldete Nutzer.
//
// Lesen bleibt offen: ohne diese Daten laesst sich die Oberflaeche nicht
// aufbauen, und ein Rechte-Dialog fuer Textbausteine waere Buerokratie ohne
// Gegenwert. Geschrieben wird nur vom Admin.
//
// Der Guard steht bewusst VOR den Routen — Hono wendet Middleware in
// Registrierungsreihenfolge an; danach eingehaengt wuerde er die darueber
// stehenden Handler nicht mehr erfassen.
exportTemplatesRoutes.on(["POST", "PATCH", "DELETE"], ["/export-templates", "/export-templates/*"], adminMiddleware);

// ── Kein Dokument fuer die Anzeige ──────────────────────────────────────────
//
// Seit die Praesentationsrolle Detailrouten lesen darf (src/data/access.ts),
// kaeme sie auch hierher — und dieser Zweig ist etwas anderes als eine
// Ansicht: er erzeugt DATEIEN. Der Volldump zieht den gesamten sichtbaren
// Bestand samt aller hochgeladenen Plaene in ein ZIP.
//
// An dem Geraet sitzt niemand, es hat weder Drucker noch Dateidialog, und
// niemand meldet sich daran ab. Ein Massenabzug ueber ein unbeaufsichtigtes
// Konto im Besprechungsraum ist genau die Bauform, die man spaeter erklaeren
// muss. Lesen ja, mitnehmen nein.
//
// Der Schutz steht hier als Sperre und nicht im Antwort-Filter, weil kein
// Filter ein ZIP oder eine .docx durchsieht.
exportTemplatesRoutes.use("/exports/*", async (c, next) => {
  if (c.get("userRole") === "praesentation") {
    return c.json({ error: "Dieses Konto ist eine Anzeige und kann keine Dokumente ausgeben." }, 403);
  }
  await next();
});

const VALID_KINDS: ExportKind[] = ["meeting", "bautagebuch", "time-entry", "project-summary", "invoice"];
const MAX_DOCX_BYTES = 10 * 1024 * 1024; // 10 MB
/**
 * Liefert das Ergebnis aus — als Word, oder auf `?format=pdf` als PDF.
 *
 * ── Warum ein Schalter und keine zweite Route je Art ───────────────────────
 *
 * Weil die PDF aus GENAU DERSELBEN Word-Datei entsteht. Eine eigene Route
 * hiesse: zwei Wege, die dasselbe Dokument erzeugen sollen und irgendwann
 * auseinanderlaufen. Der Schalter macht sichtbar, dass es ein Dokument in zwei
 * Formaten ist.
 */
async function ausliefern(
  c: Context<AppEnv>,
  result: { buffer: Buffer; filename: string },
  /** Zaehlt das als Datenabfluss? Beim Test-Render nicht — er enthaelt
   *  nur Attrappendaten und wuerde die Liste verwaessern. */
  protokollieren = true,
) {
  const alsPdf = c.req.query("format") === "pdf";
  // ── Protokolliert wird ERST, wenn wirklich etwas hinausgeht ──────────────
  //
  // ⚠ Der Aufruf stand hier oben, vor der Erzeugung. Das widersprach der
  // Zusage in `src/api/datenabfluss.ts` woertlich: „Protokolliert wird nur,
  // was wirklich hinausging; alles andere verwaesserte die Liste, die man im
  // Ernstfall liest."
  //
  // Zwei Faelle, in denen dabei ein Abfluss im Protokoll stand, den es nie
  // gab: ein `?format=pdf` auf einem Server ohne LibreOffice (503 statt
  // Datei), und JEDER Vorschau-Klick des Verwalters auf
  // `/export-templates/:id/test` — der arbeitet ausschliesslich mit
  // Attrappendaten („Max Mustermann").
  //
  // Der Test-Render wird deshalb gar nicht protokolliert; er uebergibt
  // `protokollieren: false`.
  if (!alsPdf) {
    // ── Der Word-Weg, und warum er hier lange gefehlt hat ──────────────────
    //
    // Hier stand `return ausliefern(c, result)` — die Funktion rief sich mit
    // unveraenderten Argumenten selbst auf. Ohne `?format=pdf` also eine
    // Endlosrekursion, und das betraf alle sechs Export-Wege im Normalfall:
    // Wer ein Word-Dokument wollte (der haeufigere Fall), bekam keines.
    //
    // Der Fehler steckte seit `275ee77` drin, dem Commit, der den PDF-Schalter
    // eingebaut hat — und blieb unbemerkt, weil KEIN Test bis hierher kommt:
    // in der Testdatenbank liegt keine Word-Vorlage, deshalb enden alle
    // Export-Tests vorher mit 400, 403 oder 404. Genau diese Luecke schliesst
    // `tests/api-export-word.test.ts`.
    c.header("Content-Type", DOCX_MIME);
    c.header("Content-Disposition", contentDisposition(result.filename));
    if (protokollieren) protokolliereAbfluss(c, "export.docx", { datei: result.filename, format: "docx" });
    return c.body(new Uint8Array(result.buffer));
  }
  try {
    const pdf = await docxNachPdf(result.buffer, result.filename);
    c.header("Content-Type", "application/pdf");
    c.header("Content-Disposition", contentDisposition(result.filename.replace(/\.docx$/i, ".pdf")));
    if (protokollieren) protokolliereAbfluss(c, "export.docx", { datei: result.filename, format: "pdf" });
    return c.body(new Uint8Array(pdf));
  } catch (err) {
    // 503, nicht 500: die Anfrage war richtig, dem Server fehlt ein Werkzeug.
    if (err instanceof PdfNichtMoeglich) return c.json({ error: err.message }, 503);
    throw err;
  }
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function userName(c: { var: { dbUser?: { displayName?: string | null; username?: string } | null } }): string | null {
  const u = c.var.dbUser;
  return u?.displayName ?? u?.username ?? null;
}

function isDocxFilename(name: string): boolean {
  return /\.docx$/i.test(name);
}

type CtxTraeger = { var: { userId: string | null; userRole: Rolle } };

function userCtx(c: CtxTraeger): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

/** Darf dieser Aufrufer ein Dokument zu diesem Projekt bekommen?
 *
 *  Die Export-Routen hatten bis hierher KEINE Rechtepruefung. Sie erzeugen den
 *  vollen Inhalt als Word-Datei — Protokolle, Bautagebuch, Projektbericht,
 *  Stundenlisten samt Betraegen. Damit war der Export die bequemste Umgehung
 *  der gesamten Zugriffssteuerung: was die Listen-Routen sauber filtern, liess
 *  sich ueber einen einzigen GET trotzdem herunterladen.
 *
 *  Die Pruefung steht bewusst VOR dem Rendern. Sonst verraet allein die Dauer
 *  oder die Fehlermeldung („Kein Default-Template fuer …"), dass es den
 *  Datensatz gibt. */
async function darfProjekt(c: CtxTraeger, projectName: string | null | undefined) {
  const ctx = userCtx(c);
  if (ctx.role === "admin") return true;
  if (!projectName) return false; // ohne Projektbezug bleibt es beim Admin
  return canSeeProjectByName(ctx, projectName);
}

// ── Tag-Doku ─────────────────────────────────────────────────────────────────
exportTemplatesRoutes.get("/export-templates/_variables", (c) => {
  const kind = c.req.query("kind") as ExportKind | undefined;
  if (kind && !VALID_KINDS.includes(kind)) {
    return c.json({ error: "kind ungueltig" }, 400);
  }
  return c.json(listExportVariables(kind ?? "meeting"));
});

// ── List ─────────────────────────────────────────────────────────────────────
exportTemplatesRoutes.get("/export-templates", async (c) => {
  const kind = c.req.query("kind") as ExportKind | undefined;
  if (kind && !VALID_KINDS.includes(kind)) return c.json({ error: "kind ungueltig" }, 400);
  const list = await listExportTemplates(kind);
  return c.json(list);
});

// ── Test-Render — VOR /:id matcher ───────────────────────────────────────────
exportTemplatesRoutes.get("/export-templates/:id/test", async (c) => {
  const id = c.req.param("id");
  try {
    const result = await renderDocxTest(id, userName(c));
    // Kein Protokolleintrag: der Test-Render arbeitet ausschliesslich mit
    // Attrappendaten („Max Mustermann", „(Test-Projekt)"). Jeder Vorschau-
    // Klick des Verwalters als „Datenabfluss" zu fuehren verwaessert genau
    // die Liste, die man nach einem Vorfall liest.
    return ausliefern(c, result, false);
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] Test-Render", err);
    return c.json({ error: "Test-Render fehlgeschlagen" }, 500);
  }
});

// ── Download Original ────────────────────────────────────────────────────────
exportTemplatesRoutes.get("/export-templates/:id/file", async (c) => {
  const blob = await loadExportTemplateBlob(c.req.param("id"));
  if (!blob) return c.json({ error: "Template nicht gefunden" }, 404);
  c.header("Content-Type", DOCX_MIME);
  c.header("Content-Disposition", contentDisposition(blob.filename));
  return c.body(new Uint8Array(blob.buffer));
});

// ── Single ───────────────────────────────────────────────────────────────────
exportTemplatesRoutes.get("/export-templates/:id", async (c) => {
  const t = await getExportTemplate(c.req.param("id"));
  if (!t) return c.json({ error: "Template nicht gefunden" }, 404);
  return c.json(t);
});

// ── Upload ───────────────────────────────────────────────────────────────────
exportTemplatesRoutes.post("/export-templates", async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Multipart-Body erwartet" }, 400);
  }

  const file = formData.get("file") as File | null;
  const kind = (formData.get("kind") as string | null) ?? "";
  const name = ((formData.get("name") as string | null) ?? "").trim();
  const description = ((formData.get("description") as string | null) ?? "").trim() || null;
  const isDefault = formData.get("isDefault") === "true";

  if (!file || !file.name) return c.json({ error: "Feld 'file' fehlt" }, 400);
  if (!VALID_KINDS.includes(kind as ExportKind)) {
    return c.json({ error: `kind muss einer von: ${VALID_KINDS.join(", ")}` }, 400);
  }
  if (!name) return c.json({ error: "name ist Pflicht" }, 400);
  if (file.size > MAX_DOCX_BYTES) {
    return c.json({ error: `Datei zu gross (max ${MAX_DOCX_BYTES / 1024 / 1024} MB)` }, 413);
  }
  if (!isDocxFilename(file.name)) {
    return c.json({ error: "Nur .docx-Dateien erlaubt" }, 415);
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const created = await createExportTemplate({
      kind: kind as ExportKind,
      name,
      description,
      filename: file.name,
      blob: buffer,
      isDefault,
      createdById: c.var.userId,
    });
    return c.json(created, 201);
  } catch (err) {
    logError("[Export] Upload fehlgeschlagen", err);
    return c.json({ error: err instanceof Error ? err.message : "Upload fehlgeschlagen" }, 500);
  }
});

// ── Default setzen ───────────────────────────────────────────────────────────
exportTemplatesRoutes.post("/export-templates/:id/default", async (c) => {
  const updated = await setDefaultExportTemplate(c.req.param("id"));
  if (!updated) return c.json({ error: "Template nicht gefunden" }, 404);
  return c.json(updated);
});

// ── Delete ───────────────────────────────────────────────────────────────────
exportTemplatesRoutes.delete("/export-templates/:id", async (c) => {
  const ok = await deleteExportTemplate(c.req.param("id"));
  return c.json({ ok });
});

// ── Was dieser Server kann ──────────────────────────────────────────────────
//
// Die Oberflaeche muss wissen, ob es PDF gibt: LibreOffice ist optional (rund
// 350 MB, und jedes Offline-Update traegt sie mit). Ein PDF-Knopf, der auf
// jedem zweiten Server einen Fehler liefert, ist schlechter als keiner.
exportTemplatesRoutes.get("/exports/faehigkeiten", async (c) => {
  return c.json({ pdf: await pdfMoeglich() });
});

// ── Volldump: der ganze Bestand als Markdown-Ordnerbaum ─────────────────────
//
// Die Lock-in-Versicherung. Alles, was das Buero eingegeben hat, in einem
// Format, das jeder Texteditor oeffnet — ohne PATIO, ohne PostgreSQL, ohne
// Docker.
//
// Er ersetzt keine Sicherung: eine Sicherung hilft, wenn PATIO wieder
// aufgesetzt wird, dieser Baum hilft, wenn es NICHT mehr aufgesetzt wird.
//
// Kein Weg an den Rechten vorbei: enthalten ist genau das, was der Fragende
// auch einzeln abrufen duerfte. Betraege haengen zusaetzlich am Geld-Recht —
// ein ZIP ist kein JSON, der Antwort-Filter sieht es nicht.
//
// ── Warum er NICHT auf die Verwaltung eingeschraenkt ist ───────────────────
//
// Weil sein Inhalt bereits an den Rechten haengt: enthalten ist genau das,
// was der Fragende auch einzeln abrufen duerfte — fuer ein normales Konto
// also seine eigenen Projekte, nicht das Haus. Ein Verwaltungsvorbehalt
// naehme jedem Mitarbeiter die Moeglichkeit, seinen eigenen Bestand
// mitzunehmen, ohne dass irgendwo weniger Daten flossen.
//
// Das eine Konto, fuer das er wirklich ein Vollabzug des Hauses waere, ist
// die Praesentationsrolle — sie sieht per Definition ALLE Projekte. Genau
// die faengt die Sperre ueber `/exports/*` weiter oben ab, und zwar an der
// Stelle, an der es um die Sache geht (unbeaufsichtigtes Anzeigegeraet),
// statt hier als pauschale Einschraenkung fuer alle.
exportTemplatesRoutes.get("/exports/volldump", async (c) => {
  const sichtbar = await getVisibleProjectIds(userCtx(c));
  const strom = await volldumpAlsZip(sichtbar, darfGeldSehen(c), darfPersonendatenSehen(c));
  protokolliereAbfluss(c, "export.volldump", {
    umfang: sichtbar === "all" ? "alle Projekte" : `${sichtbar.length} Projekt(e)`,
    mitBetraegen: darfGeldSehen(c),
    mitKontaktdaten: darfPersonendatenSehen(c),
  });
  c.header("Content-Type", "application/zip");
  c.header("Content-Disposition", contentDisposition(`PATIO Volldump ${new Date().toISOString().slice(0, 10)}.zip`));
  return c.body(strom as unknown as ReadableStream);
});

// ── Export-Endpoints (das eigentliche Generieren) ────────────────────────────

exportTemplatesRoutes.get("/exports/meeting/:id", async (c) => {
  const id = c.req.param("id");
  const templateId = c.req.query("templateId") ?? undefined;

  // 404 vor 403: sonst verraet der Statuscode, welche IDs es gibt.
  const meeting = await meetingRepo.get(id);
  if (!meeting) return c.json({ error: "Besprechung nicht gefunden" }, 404);
  if (!(await darfProjekt(c, meeting.projectName))) return c.json({ error: "Kein Zugriff" }, 403);

  try {
    const result = await renderDocxExport({
      kind: "meeting",
      meetingId: id,
      // Der Projektbezug geht mit, damit die Projektnummer im Dateinamen
      // stehen kann (Migration 052). Die Route kennt ihn ohnehin — sie hat
      // damit gerade die Rechte geprueft.
      projectName: meeting.projectName ?? undefined,
      templateId,
      currentUserName: userName(c),
    });
    return ausliefern(c, result);
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] Meeting", err);
    return c.json({ error: "Export fehlgeschlagen" }, 500);
  }
});

// ── Rechnung ────────────────────────────────────────────────────────────────
//
// Die fuenfte Export-Art, und die einzige, die das Haus wirklich verlaesst.
// Sie fehlte, obwohl alle Daten im System stehen — Positionen, Menge,
// Einzelpreis, Umsatzsteuersatz, Phase, Projektnummer.
//
// ── Warum hier zusaetzlich das Geld-Recht steht ────────────────────────────
//
// Der Antwort-Filter (`src/api/geld.ts`) raeumt Geldfelder aus JSON-Antworten.
// Eine .docx ist kein JSON: der Filter sieht sie nicht, und die Betraege
// stehen darin ausgeschrieben. Ohne diese Zeile waere der Rechnungsexport der
// Weg, auf dem ein Konto ohne Geld-Recht doch an Honorare kommt.
exportTemplatesRoutes.get("/exports/invoice/:id", async (c) => {
  const id = c.req.param("id");
  const templateId = c.req.query("templateId") ?? undefined;

  // 404 vor 403 — sonst verraet der Statuscode, welche IDs es gibt.
  const rechnung = await invoiceRepo.get(id);
  if (!rechnung) return c.json({ error: "Rechnung nicht gefunden" }, 404);

  const projektName = await projectRepo.nameById?.(rechnung.projectId);
  if (!(await darfProjekt(c, projektName))) return c.json({ error: "Kein Zugriff" }, 403);
  if (!darfGeldSehen(c)) return c.json({ error: "Kein Zugriff auf Geldbetraege" }, 403);

  try {
    const result = await renderDocxExport({
      kind: "invoice",
      invoiceId: id,
      projectName: projektName ?? undefined,
      templateId,
      currentUserName: userName(c),
    });
    return ausliefern(c, result);
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] Rechnung", err);
    return c.json({ error: "Export fehlgeschlagen" }, 500);
  }
});

exportTemplatesRoutes.get("/exports/bautagebuch/:id", async (c) => {
  const id = c.req.param("id");

  const eintrag = await bautagebuchRepo.getById(id);
  if (!eintrag) return c.json({ error: "Bautagebuch-Eintrag nicht gefunden" }, 404);
  if (!(await darfProjekt(c, eintrag.projectName))) return c.json({ error: "Kein Zugriff" }, 403);

  try {
    const result = await renderDocxExport({
      kind: "bautagebuch",
      bautagebuchId: id,
      projectName: eintrag.projectName ?? undefined,
      templateId: c.req.query("templateId") ?? undefined,
      currentUserName: userName(c),
    });
    return ausliefern(c, result);
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] Bautagebuch", err);
    return c.json({ error: "Export fehlgeschlagen" }, 500);
  }
});

exportTemplatesRoutes.get("/exports/time-entries", async (c) => {
  // Ohne `project` umfasst der Export ALLE Projekte — daraus liesse sich die
  // gesamte Auslastung des Bueros samt Stundensaetzen ablesen. Das bleibt dem
  // Admin vorbehalten; mit Projektangabe entscheidet die uebliche Pruefung.
  const projektFilter = c.req.query("project") ?? undefined;
  if (!(await darfProjekt(c, projektFilter ?? null))) return c.json({ error: "Kein Zugriff" }, 403);

  // KEINE Geld-Pruefung hier, nachgesehen statt vermutet: der Stundenzettel
  // enthaelt Datum, Stunden, Mitarbeiter, Taetigkeit — keinen Satz und keinen
  // Betrag (`buildTimeEntryData` in src/export/docx-render.ts baut die Zeilen
  // Feld fuer Feld auf, `SummeStunden` sind Stunden). Ihn ans Geld-Recht zu
  // binden wuerde die Projektleitung daran hindern, dem Bauherrn einen
  // Stundennachweis zu geben — ohne dass dadurch irgendein Betrag geschuetzt
  // waere.

  try {
    const result = await renderDocxExport({
      kind: "time-entry",
      projectName: projektFilter,
      memberId: c.req.query("memberId") ?? undefined,
      from: c.req.query("from") ?? undefined,
      to: c.req.query("to") ?? undefined,
      templateId: c.req.query("templateId") ?? undefined,
      currentUserName: userName(c),
    });
    return ausliefern(c, result);
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] TimeEntries", err);
    return c.json({ error: "Export fehlgeschlagen" }, 500);
  }
});

exportTemplatesRoutes.get("/exports/project/:name/summary", async (c) => {
  const projectName = decodeURIComponent(c.req.param("name"));
  if (!(await darfProjekt(c, projectName))) return c.json({ error: "Kein Zugriff" }, 403);

  try {
    const result = await renderDocxExport({
      kind: "project-summary",
      projectName,
      templateId: c.req.query("templateId") ?? undefined,
      currentUserName: userName(c),
    });
    return ausliefern(c, result);
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] ProjectSummary", err);
    return c.json({ error: "Export fehlgeschlagen" }, 500);
  }
});
