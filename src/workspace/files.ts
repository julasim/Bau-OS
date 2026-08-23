import fs from "fs";
import { safePath } from "./helpers.js";

// ── Was hier stand: createFile und listFolder ──────────────────────────────
//
// `createFile` war der letzte SCHREIBENDE Weg der Anwendung ins Dateisystem —
// in `WORKSPACE_PATH`, also die Samba-Freigabe „Dokumente". Keine Route rief
// ihn mehr auf, und gedeckt war er von keiner Rechtepruefung: er nahm einen
// Pfad und schrieb dorthin. `listFolder` war das lesende Gegenstueck samt
// einer Ausblendliste fuer Ordner der Bot-Aera („Agents", „MEMORY_LOGS").
//
// Beide sind mit den pfadbasierten Routen entfallen. Sie standen noch hier,
// und der Traversal-Schutz `safePath()` liess sie wie einen regulaeren Weg
// aussehen, statt wie einen vergessenen.
//
// Uebrig bleibt genau ein Fall (siehe src/workspace/index.ts): Alt-Eintraege,
// deren Datei damals wirklich im Ordner lag und deren Datenbankzeile keinen
// Inhalt hat. Der Zugriff ist dadurch immer ueber eine Datenbankzeile
// gedeckt — und damit von der Rechtepruefung erfasst.

export function readFile(relativePath: string): string | null {
  const filepath = safePath(relativePath);
  if (!filepath || !fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}
