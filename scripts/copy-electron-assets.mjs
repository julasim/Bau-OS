// Kopiert die Nicht-TS-Bestandteile der Electron-Hülle nach dist-electron/
// (tsc emittiert nur .ts). Läuft im build:electron nach dem tsc-Schritt.
//
// Zwei Dateien, beide unverzichtbar:
//   preload.cjs       der einzige Rückkanal der Einrichtungsseite
//   einrichtung.html  Ersteinrichtung UND Fehleranzeige in einem
import { copyFileSync, mkdirSync } from "node:fs";

const DATEIEN = ["preload.cjs", "einrichtung.html"];

mkdirSync("dist-electron", { recursive: true });
for (const datei of DATEIEN) {
  copyFileSync(`electron/${datei}`, `dist-electron/${datei}`);
  console.log(`dist-electron/${datei} kopiert`);
}
