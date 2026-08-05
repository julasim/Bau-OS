// Dateizugriff auf den Workspace. Alles Uebrige (Notizen, Aufgaben, Termine,
// Projekte, Team, Vault-Suche) liegt seit dem Umbau zum Firmenserver in der
// Datenbank — siehe src/data/. Was hier bleibt, betrifft echte Dateien:
// Dokumente werden weiterhin im Dateisystem abgelegt und im Explorer geoeffnet.
export { readFile, createFile, listFolder } from "./files.js";
export type { FolderEntry } from "./files.js";
