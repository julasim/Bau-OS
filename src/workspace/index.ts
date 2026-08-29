// Lesender Zugriff auf den Dokumentenordner — der letzte Rest der Vault-Zeit.
//
// Hochgeladene Dateien liegen seit dem Umbau als `bytea` in der Datenbank;
// `WORKSPACE_PATH` haelt heute nur noch den Altbestand und wird von der
// Anwendung NICHT beschrieben. `readFile` bedient nur noch einen einzigen
// Fall: Alt-Eintraege, deren Datei damals wirklich im Ordner lag und deren
// Datenbankzeile keinen Inhalt hat (siehe den Download-Rueckfall in
// src/api/routes/files.ts). Der Zugriff ist dadurch immer ueber eine
// Datenbankzeile gedeckt und damit von der Rechtepruefung erfasst.
//
// `createFile` und `listFolder` sind mit den pfadbasierten Routen entfallen:
// sie boten einen Weg in den geteilten Ordner, den niemand mehr braucht und
// den keine Rechtepruefung deckte.
export { readFile } from "./files.js";
