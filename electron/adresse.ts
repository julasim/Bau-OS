// ============================================================
// PATIO Arbeitsplatz — Serveradresse und Fehlertexte
// ============================================================
// Bewusst eine eigene Datei **ohne Electron-Import**. `main.ts` und
// `server-store.ts` hängen beide an `electron`, und ein Modul, das `app` oder
// `net` importiert, lässt sich in Vitest nicht laden — `require("electron")`
// liefert im normalen Node-Prozess nur den Pfad zur Binärdatei, kein Modul.
//
// Damit sind die beiden Entscheidungen, an denen im Betrieb wirklich etwas
// hängt, ganz normal prüfbar: was als Adresse durchgeht, und was der Benutzer
// bei einem Netzwerkfehler zu lesen bekommt.
// ============================================================

/** Bringt eine Eingabe auf die Form, mit der gearbeitet wird: Schema ergänzt,
 *  Pfad und Abfrage abgeschnitten, kein abschließender Schrägstrich.
 *
 *  Warum so streng: die Hülle hängt an diese Adresse später `/api/health` und
 *  den Fensteraufruf an. Bliebe ein Pfad stehen (jemand kopiert
 *  `https://patio.sima.intern/projekte/villa` aus der Adresszeile), zeigte die
 *  Prüfung auf `…/projekte/villa/api/health` und schlüge fehl — mit einer
 *  Meldung, die nach einem Serverproblem aussieht.
 *
 *  **https ist die Vorgabe**, nicht http: der Firmenserver hat ein Zertifikat
 *  aus der eigenen CA, und wer versehentlich unverschlüsselt landet, merkt es
 *  nicht. Ausdrückliches `http://` bleibt erlaubt — für eine Erprobung gegen
 *  einen Entwicklungsserver ohne TLS.
 *
 *  Liefert `null`, wenn daraus keine brauchbare Adresse wird. */
export function normalisiereAdresse(eingabe: string): string | null {
  const roh = (eingabe ?? "").trim();
  if (!roh) return null;

  // Ein FREMDES Schema wird abgewiesen, nicht überschrieben. Ohne diese
  // Prüfung wanderte `file:///C:/Windows` durch das Voranstellen von
  // `https://` zu `https://file:///C:/Windows` — und `new URL()` liest daraus
  // klaglos den Rechnernamen `file`. Heraus käme `https://file`: eine Adresse,
  // die niemand eingegeben hat, mit einer Fehlermeldung, die niemand versteht.
  //
  // Die Erkennung besteht auf `://`. Nur auf den Doppelpunkt zu prüfen wäre
  // falsch: `patio.sima.intern:8443` ist eine gültige Eingabe mit Port, kein
  // Schema.
  const schema = /^([a-z][a-z0-9+.-]*):\/\//i.exec(roh);
  if (schema && !/^https?$/i.test(schema[1])) return null;

  const mitSchema = /^https?:\/\//i.test(roh) ? roh : `https://${roh}`;
  let u: URL;
  try {
    u = new URL(mitSchema);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!u.hostname) return null;
  return u.port ? `${u.protocol}//${u.hostname}:${u.port}` : `${u.protocol}//${u.hostname}`;
}

/** Übersetzt Chromiums Netzwerk-Fehlerkennungen in einen Satz, mit dem jemand
 *  im Büro etwas anfangen kann. Der nackte Text („net::ERR_CERT_AUTHORITY_
 *  INVALID") hilft dort niemandem weiter.
 *
 *  Unbekanntes wird durchgereicht statt verschluckt — eine Meldung, die
 *  niemand vorhergesehen hat, ist immer noch besser als „unbekannter Fehler". */
export function erklaereFehler(roh: string): string {
  const t = (roh ?? "").toUpperCase();
  if (t.includes("ERR_CERT") || t.includes("CERT_AUTHORITY")) {
    return (
      "Dem Zertifikat des Servers wird nicht vertraut. Auf diesem Rechner fehlt " +
      "das Wurzelzertifikat der PATIO-Zertifizierungsstelle. Anleitung: " +
      "Dokumentation → Betrieb → Zertifikat."
    );
  }
  if (t.includes("ERR_NAME_NOT_RESOLVED")) {
    return "Der Rechnername ist im Netz nicht bekannt. Tippfehler in der Adresse — oder die Namensauflösung fehlt.";
  }
  if (t.includes("ERR_CONNECTION_REFUSED")) {
    return "Der Rechner ist erreichbar, nimmt aber keine Verbindung an. Läuft PATIO auf dem Server?";
  }
  if (t.includes("ERR_CONNECTION_TIMED_OUT") || t.includes("ERR_TIMED_OUT")) {
    return "Keine Antwort vom Server. Netzwerkverbindung oder Firewall prüfen.";
  }
  if (t.includes("ERR_INTERNET_DISCONNECTED") || t.includes("ERR_NETWORK_CHANGED")) {
    return "Dieser Rechner hat gerade keine Netzwerkverbindung.";
  }
  if (t.includes("ERR_ABORTED")) {
    return "Die Verbindung wurde abgebrochen.";
  }
  return roh;
}
