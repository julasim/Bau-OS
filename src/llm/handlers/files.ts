import type OpenAI from "openai";
import path from "path";
import {
  readFile,
  createFile,
  listFolder,
  editFile,
  globFiles,
  grepFiles,
  searchWorkspace,
} from "../../workspace/index.js";
import { safePath } from "../../workspace/helpers.js";
import { fileRepo } from "../../data/index.js";
import { HTTP_RESPONSE_MAX_CHARS, DB_ENABLED, TOOL_OUTPUT_MAX_CHARS, WORKSPACE_PATH } from "../../config.js";
import { sendFile } from "../context.js";
import type { HandlerMap } from "./types.js";

const DOCUMENT_EXTS = new Set(["pdf", "docx", "doc"]);

export const fileSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "datei_lesen",
      description:
        "Liest den Inhalt einer Datei im Workspace. Unterstuetzt Textdateien (.md, .txt, .json etc.) UND Dokumente (.pdf, .docx). PDF- und Word-Dateien werden automatisch extrahiert. Pfad relativ zum Workspace-Root. Nutze dateien_suchen oder ordner_auflisten um den Pfad zu finden.",
      parameters: {
        type: "object",
        properties: {
          pfad: { type: "string", description: "Relativer Pfad im Vault, z.B. 'Projekte/Alpha/README.md'" },
        },
        required: ["pfad"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "datei_erstellen",
      description:
        "Erstellt eine neue Datei im Vault oder ueberschreibt eine bestehende. Pfad ist relativ zum Vault-Root. Fehlende Ordner werden automatisch erstellt. Fuer Aenderungen an bestehenden Dateien besser datei_bearbeiten nutzen.",
      parameters: {
        type: "object",
        properties: {
          pfad: { type: "string", description: "Relativer Pfad im Vault" },
          inhalt: { type: "string", description: "Dateiinhalt" },
        },
        required: ["pfad", "inhalt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ordner_auflisten",
      description:
        "Listet den Inhalt eines Ordners im Vault auf (Dateien und Unterordner). Zeigt nur eine Ebene — nicht rekursiv. Fuer rekursive Suche dateien_suchen verwenden.",
      parameters: {
        type: "object",
        properties: { pfad: { type: "string", description: "Relativer Pfad (leer = Vault-Wurzel)" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vault_suchen",
      description:
        "Schnelle Freitextsuche in allen .md-Dateien des Vaults. Gibt Dateiname und erste Trefferzeile zurueck (max 10 Ergebnisse). Fuer Regex oder alle Dateitypen regex_suchen verwenden.",
      parameters: {
        type: "object",
        properties: {
          suchbegriff: { type: "string", description: "Der Suchbegriff" },
          projekt: { type: "string", description: "Optional: Suche auf ein Projekt begrenzen" },
        },
        required: ["suchbegriff"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "semantisch_suchen",
      description:
        "Semantische Suche im Vault: findet Notizen und Dateien nach Bedeutung, nicht nur nach exaktem Text. Nutzt KI-Embeddings fuer bessere Ergebnisse bei komplexen Fragen. Nur verfuegbar wenn Datenbank aktiv ist — sonst vault_suchen verwenden.",
      parameters: {
        type: "object",
        properties: {
          frage: { type: "string", description: "Die Suchanfrage in natuerlicher Sprache" },
          typ: {
            type: "string",
            enum: ["all", "note", "file"],
            description: "Suchbereich: 'all' (Standard), 'note' (nur Notizen), 'file' (nur Dateien)",
          },
          limit: { type: "number", description: "Max. Ergebnisse (Standard: 5)" },
          projekt: { type: "string", description: "Optional: Suche auf ein Projekt (Projektname) beschraenken" },
        },
        required: ["frage"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "datei_bearbeiten",
      description:
        "Sucht Text in einer Vault-Datei und ersetzt ihn (Find-and-Replace). Fuer praezise Aenderungen an bestehenden Dateien. Unterstuetzt exakte Textsuche und Regex-Muster. Nicht fuer Notiz-Nachtraege — dafuer notiz_bearbeiten nutzen.",
      parameters: {
        type: "object",
        properties: {
          pfad: { type: "string", description: "Relativer Pfad im Vault (z.B. 'Projekte/Alpha/README.md')" },
          suchen: { type: "string", description: "Text der gesucht wird (exakt oder Regex)" },
          ersetzen: { type: "string", description: "Ersetzungstext" },
          regex: { type: "boolean", description: "true = suchen ist ein Regex-Muster (Standard: false)" },
          alle: { type: "boolean", description: "true = alle Vorkommen ersetzen (Standard: false, nur erstes)" },
        },
        required: ["pfad", "suchen", "ersetzen"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dateien_suchen",
      description:
        "Sucht Dateien nach Name oder Muster. Bei aktiver Datenbank werden alle hochgeladenen Dateien (PDF, DOCX, Bilder etc.) durchsucht — auch nach Inhalt. Unterstuetzt Glob-Platzhalter: '**/*.pdf', '*deutsch*'. Gibt Dateinamen und Pfade zurueck.",
      parameters: {
        type: "object",
        properties: {
          muster: { type: "string", description: "Glob-Muster (z.B. '**/*.md', 'Projekte/*/*.md')" },
          ordner: { type: "string", description: "Optional: Startordner (Standard: Vault-Wurzel)" },
          limit: { type: "number", description: "Max. Ergebnisse (Standard: 50)" },
        },
        required: ["muster"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "regex_suchen",
      description:
        "Durchsucht Dateiinhalte im Vault mit Regex-Mustern (wie grep). Gibt Treffer mit Zeilennummern zurueck. Durchsucht alle Dateitypen, nicht nur .md. Fuer einfache Textsuche in Notizen ist vault_suchen schneller.",
      parameters: {
        type: "object",
        properties: {
          muster: { type: "string", description: "Regex-Suchmuster (z.B. 'OENORM.*B\\\\s?1801', 'TODO|FIXME')" },
          ordner: { type: "string", description: "Optional: Unterordner (Standard: gesamter Vault)" },
          kontext: { type: "number", description: "Zeilen Kontext vor/nach Treffer (Standard: 0)" },
          dateifilter: { type: "string", description: "Optional: Datei-Glob (z.B. '*.md', '*.json')" },
          limit: { type: "number", description: "Max. Treffer gesamt (Standard: 20)" },
        },
        required: ["muster"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pdf_erstellen",
      description:
        "Erstellt eine PDF-Datei mit Titel und Textinhalt. Ideal fuer Berichte, Protokolle, Kostenaufstellungen, Zusammenfassungen. Speichert die PDF im Workspace unter Exports/. Danach datei_senden aufrufen um sie an den Nutzer zu schicken.",
      parameters: {
        type: "object",
        properties: {
          titel: { type: "string", description: "Titel der PDF (erscheint als Ueberschrift)" },
          inhalt: { type: "string", description: "Textinhalt der PDF (Zeilenumbrueche erlaubt)" },
          dateiname: { type: "string", description: "Dateiname, z.B. 'Bericht_April.pdf' (ohne Pfad)" },
        },
        required: ["titel", "inhalt", "dateiname"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "datei_senden",
      description:
        "Sendet eine Datei aus dem Workspace als Telegram-Dokument an den Nutzer. Relativer Pfad zum Workspace-Root, z.B. 'Exports/Bericht.pdf'. Nach pdf_erstellen oder docx_erstellen verwenden um die generierte Datei zuzustellen.",
      parameters: {
        type: "object",
        properties: {
          pfad: { type: "string", description: "Relativer Pfad im Workspace (z.B. 'Exports/Bericht.pdf')" },
        },
        required: ["pfad"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "docx_erstellen",
      description:
        "Erstellt eine Word-Datei (.docx) mit Titel und Textinhalt. Ideal wenn der Nutzer ein bearbeitbares Dokument braucht (Angebot, Vertrag, Protokoll, Bericht). Speichert die Datei im Workspace unter Exports/. Danach datei_senden aufrufen um sie an den Nutzer zu schicken.",
      parameters: {
        type: "object",
        properties: {
          titel: { type: "string", description: "Titel des Dokuments (erscheint als Ueberschrift)" },
          inhalt: { type: "string", description: "Textinhalt des Dokuments (Zeilenumbrueche erlaubt)" },
          dateiname: { type: "string", description: "Dateiname, z.B. 'Angebot_Muster.docx' (ohne Pfad)" },
        },
        required: ["titel", "inhalt", "dateiname"],
      },
    },
  },
];

export const fileHandlers: HandlerMap = {
  datei_lesen: async (args) => {
    const pfad = String(args.pfad);

    // 1. DB: Datei ueber Name/Pfad/ID suchen
    if (DB_ENABLED && fileRepo) {
      const file = await fileRepo.get(pfad);
      if (file) {
        // Extrahierter Text vorhanden → direkt zurueckgeben
        if (file.contentText) {
          return file.contentText.slice(0, TOOL_OUTPUT_MAX_CHARS);
        }
        // Kein Text → vom Filesystem lesen/extrahieren
        const ext = path.extname(file.filepath).slice(1).toLowerCase();
        if (DOCUMENT_EXTS.has(ext)) {
          try {
            const resolved = safePath(file.filepath);
            if (!resolved) return `Datei ${file.filename} gefunden aber Pfad ungueltig.`;
            const { extractDocument } = await import("../../workspace/extractor.js");
            const result = await extractDocument(resolved, "");
            if (result.text) {
              // Text in DB speichern fuer naechstes Mal
              await fileRepo.updateContent(file.id, result.text);
              return result.text.slice(0, TOOL_OUTPUT_MAX_CHARS);
            }
          } catch (err) {
            return `Fehler beim Lesen von ${file.filename}: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
        // Textdatei vom Filesystem
        const content = readFile(file.filepath);
        return content ?? `Datei ${file.filename} in DB aber nicht auf Dateisystem gefunden.`;
      }
    }

    // 2. Filesystem-Fallback (Agent-Dateien, nicht-DB-Dateien)
    const ext = path.extname(pfad).slice(1).toLowerCase();
    if (DOCUMENT_EXTS.has(ext)) {
      const resolved = safePath(pfad);
      if (!resolved) return `Datei nicht gefunden: ${pfad}. Nutze dateien_suchen um den richtigen Pfad zu finden.`;
      try {
        const { extractDocument } = await import("../../workspace/extractor.js");
        const result = await extractDocument(resolved, "");
        if (result.format === "unsupported") return `Dateiformat .${ext} wird nicht unterstuetzt.`;
        return result.text.slice(0, TOOL_OUTPUT_MAX_CHARS) || `Datei ${pfad} konnte nicht gelesen werden.`;
      } catch (err) {
        return `Fehler beim Lesen von ${pfad}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    const content = readFile(pfad);
    return content ?? `Datei nicht gefunden: ${pfad}. Nutze dateien_suchen um den richtigen Pfad zu finden.`;
  },

  datei_erstellen: async (args) => {
    const fp = createFile(String(args.pfad), String(args.inhalt));
    return `Datei erstellt: ${fp.split(/[\\/]/).pop()}`;
  },

  ordner_auflisten: async (args) => {
    const entries = listFolder(args.pfad ? String(args.pfad) : "");
    return entries.length
      ? entries.map((e) => (e.type === "folder" ? `\u{1F4C1} ${e.name}` : `\u{1F4C4} ${e.name}`)).join("\n")
      : `Ordner "${args.pfad || "/"}" leer oder nicht gefunden. Nutze ordner_auflisten ohne Pfad fuer die Vault-Wurzel.`;
  },

  vault_suchen: async (args) => {
    const results = searchWorkspace(String(args.suchbegriff), args.projekt ? String(args.projekt) : undefined);
    if (!results.length) return `Keine Treffer fuer "${args.suchbegriff}".`;
    return results.map((r) => `\u{1F4C4} ${r.file}\n   ${r.line}`).join("\n\n");
  },

  semantisch_suchen: async (args) => {
    if (!DB_ENABLED) {
      // Fallback: vault_suchen ausfuehren statt Fehler zurueckgeben
      const results = searchWorkspace(String(args.frage));
      if (!results.length) return `Keine Treffer fuer "${args.frage}" (Textsuche, DB nicht aktiv).`;
      return results.map((r) => `\u{1F4C4} ${r.file}\n   ${r.line}`).join("\n\n") + "\n\n[Textsuche — DB nicht aktiv]";
    }
    const { semanticSearch, embeddingStats } = await import("../../db/index.js");
    const type = (args.typ as "all" | "note" | "file") || "all";
    // Default 8 statt 5: bei breiten Fragen ("Was haben wir zu X?") waren 5
    // Ergebnisse zu wenig, Agent rief direkt notizen_auflisten hinterher.
    const limit = Number(args.limit) || 8;
    const project = args.projekt ? String(args.projekt) : null;
    const results = await semanticSearch(String(args.frage), { limit, type, project });

    if (!results.length) {
      // Coverage-Check: liegt es evtl. daran, dass viele Notizen ueberhaupt
      // kein Embedding haben? Wenn ja, ehrlich sagen — sonst denkt der Agent,
      // es gibt einfach nichts, und halluziniert eine leere Antwort.
      try {
        const stats = await embeddingStats();
        const noteGap = stats.notes.total - stats.notes.embedded;
        const fileGap = stats.files.total - stats.files.embedded;
        if (noteGap > 0 || fileGap > 0) {
          return (
            `Keine semantischen Treffer fuer "${args.frage}". ` +
            `ACHTUNG: ${noteGap} Notiz(en) und ${fileGap} Datei(en) haben kein Embedding ` +
            `(${stats.notes.embedded}/${stats.notes.total} Notizen, ${stats.files.embedded}/${stats.files.total} Dateien indexiert). ` +
            `Admin muss /api/search/reindex triggern. Als Fallback jetzt vault_suchen verwenden.`
          );
        }
      } catch {
        // Stats-Abruf egal, normal fortfahren
      }
      return `Keine semantischen Treffer fuer "${args.frage}". Versuche vault_suchen fuer exakte Textsuche.`;
    }

    // Output-Format mit mehr Kontext:
    // - Snippet bis 400 Zeichen (vorher 120) — dadurch kann der Agent die
    //   Frage direkt beantworten ohne jede Notiz einzeln nachzulesen.
    // - Nach den Treffern expliziter Antwort-Hint, damit der Agent nicht
    //   in eine Such-Schleife faellt (semantisch_suchen -> vault_suchen ->
    //   notizen_auflisten -> projekt_info).
    const formatted = results
      .map((r, i) => {
        const icon = r.type === "note" ? "\u{1F4DD}" : "\u{1F4C4}";
        const proj = r.project ? ` [${r.project}]` : "";
        const scorePct = (r.score * 100).toFixed(0);
        const snippet = r.snippet.replace(/\s+/g, " ").trim().slice(0, 400);
        return `${i + 1}. ${icon} ${r.title}${proj} — ${scorePct}%\n   ${snippet}`;
      })
      .join("\n\n");
    return (
      `${results.length} Treffer fuer "${args.frage}":\n\n${formatted}\n\n` +
      `Beantworte die Frage des Nutzers anhand dieser Treffer. Wenn der Nutzer einen ` +
      `einzelnen Eintrag komplett lesen moechte, rufe notiz_lesen mit dem Titel auf — ` +
      `sonst direkt 'antworten' aufrufen.`
    );
  },

  datei_bearbeiten: async (args) => {
    const result = editFile(String(args.pfad), String(args.suchen), String(args.ersetzen), {
      regex: String(args.regex) === "true",
      all: String(args.alle) === "true",
    });
    if (!result)
      return `Datei nicht gefunden oder Pfad ungueltig: ${args.pfad}. Nutze dateien_suchen um den richtigen Pfad zu finden.`;
    if (result.count === 0)
      return `Kein Treffer fuer "${args.suchen}" in ${args.pfad}. Nutze datei_lesen um den aktuellen Inhalt zu pruefen, oder regex_suchen um den Text im Vault zu finden.`;
    return `${result.count} Ersetzung(en) in ${args.pfad}.\n${result.preview}`;
  },

  dateien_suchen: async (args) => {
    const muster = String(args.muster);
    const limit = Number(args.limit) || 50;

    // DB: hochgeladene Dateien durchsuchen (Name, Pfad, Inhalt)
    if (DB_ENABLED && fileRepo) {
      // Suchbegriff aus Glob-Muster extrahieren (Wildcards entfernen, laengstes Segment nehmen)
      const terms = muster
        .replace(/\*+/g, "")
        .split(/[/\\]/)
        .filter((s) => s.length > 0);
      const searchTerm = terms.reduce((best, t) => (t.length > best.length ? t : best), "");

      const dbFiles = searchTerm
        ? await fileRepo.search(searchTerm, limit)
        : await fileRepo.list(args.ordner ? String(args.ordner) : undefined, limit);

      if (dbFiles.length) {
        return dbFiles.map((f) => f.filepath).join("\n") + `\n\n[${dbFiles.length} Datei(en)]`;
      }
    }

    // Filesystem-Fallback (Agent-Dateien, kein DB-Modus)
    const files = globFiles(muster, {
      limit,
      subdir: args.ordner ? String(args.ordner) : undefined,
    });
    if (!files.length) return `Keine Dateien gefunden fuer "${muster}".`;
    return files.join("\n") + `\n\n[${files.length} Datei(en)]`;
  },

  regex_suchen: async (args) => {
    const result = grepFiles(String(args.muster), {
      subdir: args.ordner ? String(args.ordner) : undefined,
      context: Number(args.kontext) || 0,
      maxMatches: Number(args.limit) || 20,
      fileGlob: args.dateifilter ? String(args.dateifilter) : undefined,
    });
    if (!result.matches.length) return `Keine Treffer fuer "${args.muster}".`;

    const grouped = new Map<string, Array<{ line: number; text: string }>>();
    for (const m of result.matches) {
      const arr = grouped.get(m.file) || [];
      arr.push({ line: m.line, text: m.text });
      grouped.set(m.file, arr);
    }

    const parts: string[] = [];
    for (const [file, matches] of grouped) {
      const lines = matches.map((m) => `${m.line}: ${m.text}`).join("\n");
      parts.push(`=== ${file} ===\n${lines}`);
    }

    let output = parts.join("\n\n");
    const summary = `[${result.matches.length} Treffer in ${result.totalFiles} Datei(en)]`;
    output += result.truncated ? `\n\n${summary} (gekuerzt)` : `\n\n${summary}`;

    return output.length > HTTP_RESPONSE_MAX_CHARS
      ? output.slice(0, HTTP_RESPONSE_MAX_CHARS) + "\n[... gekuerzt]"
      : output;
  },

  pdf_erstellen: async (args) => {
    try {
      const { createPdf } = await import("../../workspace/pdf.js");
      const relativePath = await createPdf({
        titel: String(args.titel),
        inhalt: String(args.inhalt),
        dateiname: String(args.dateiname),
      });

      // In DB speichern → automatisches Embedding
      if (DB_ENABLED && fileRepo) {
        const safeName = path.basename(relativePath);
        fileRepo
          .save({
            filename: safeName,
            filepath: relativePath,
            filesize: 0,
            mimeType: "application/pdf",
            contentText: `${String(args.titel)}\n\n${String(args.inhalt)}`,
          })
          .catch(() => {});
      }

      return `PDF erstellt: ${relativePath}\n\nJetzt datei_senden aufrufen um sie an den Nutzer zu schicken.`;
    } catch (err) {
      return `Fehler beim PDF-Erstellen: ${err instanceof Error ? err.message : String(err)}`;
    }
  },

  datei_senden: async (args) => {
    const pfad = String(args.pfad);
    const absPath = path.resolve(WORKSPACE_PATH, pfad);
    // Path-Traversal-Schutz
    if (!absPath.startsWith(WORKSPACE_PATH)) {
      return "Zugriff verweigert: Pfad liegt ausserhalb des Workspace.";
    }
    try {
      await sendFile(absPath);
      return `Datei gesendet: ${path.basename(pfad)}`;
    } catch (err) {
      return `Fehler beim Senden: ${err instanceof Error ? err.message : String(err)}`;
    }
  },

  docx_erstellen: async (args) => {
    try {
      const { createDocx } = await import("../../workspace/docx.js");
      const relativePath = await createDocx({
        titel: String(args.titel),
        inhalt: String(args.inhalt),
        dateiname: String(args.dateiname),
      });

      // In DB speichern → automatisches Embedding
      if (DB_ENABLED && fileRepo) {
        const safeName = path.basename(relativePath);
        fileRepo
          .save({
            filename: safeName,
            filepath: relativePath,
            filesize: 0,
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            contentText: `${String(args.titel)}\n\n${String(args.inhalt)}`,
          })
          .catch(() => {});
      }

      return `Word-Dokument erstellt: ${relativePath}\n\nJetzt datei_senden aufrufen um es an den Nutzer zu schicken.`;
    } catch (err) {
      return `Fehler beim DOCX-Erstellen: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
