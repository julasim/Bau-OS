// ============================================================
// PATIO — Preload
// ============================================================
// PATIO Desktop reichte hier das Shared-Secret an die Oberfläche durch. Am
// Firmenserver entfällt das: der Ausweis ist das JWT aus der Anmeldung, und
// das verwaltet die Oberfläche selbst.
//
// **Der Server-Seite wird nichts exponiert.** Damit gibt es keinen Vertrag
// zwischen Hülle und Oberfläche, der aus dem Takt geraten könnte — und die
// Versionsprüfung, die in der ersten Fassung dieses Pakets stand, erübrigt
// sich ersatzlos.
//
// Was bleibt, ist ein einziger Rückkanal für die EINRICHTUNGSSEITE. Sie muss
// dem Hauptprozess eine eingetippte Adresse geben können; ohne irgendeinen
// Kanal ginge das nicht.
//
// Die Abgrenzung läuft über das Protokoll: `file:` ist ausschließlich die
// mitgelieferte `einrichtung.html`. Eine Seite vom Server kann sich das nicht
// erschleichen — Chromium lässt eine http(s)-Seite nicht nach `file:`
// navigieren.
// ============================================================

const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("patioEinrichtung", {
    /** Adresse prüfen und bei Erfolg übernehmen. */
    pruefen: (adresse) => ipcRenderer.invoke("patio:server-pruefen", adresse),
    /** Dieselbe Adresse noch einmal versuchen. */
    erneut: () => ipcRenderer.invoke("patio:erneut-versuchen"),
  });
}
