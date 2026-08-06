import { describe, it, expect } from "vitest";
import { normalisiereAdresse, erklaereFehler } from "../electron/adresse.js";

// Das Arbeitsplatz-Programm (AP12) hat genau zwei Entscheidungen, an denen im
// Betrieb wirklich etwas hängt — und beide treffen jemanden, der gerade nicht
// weiterarbeiten kann:
//
//   1. Was als Serveradresse durchgeht. Eine Eingabe, die halb akzeptiert
//      wird, erzeugt eine Prüfung gegen eine falsche URL — und eine Meldung,
//      die nach einem Serverproblem aussieht, obwohl es ein Tippfehler war.
//   2. Was bei einem Netzwerkfehler auf dem Bildschirm steht. „net::ERR_CERT_
//      AUTHORITY_INVALID" hilft im Büro niemandem.
//
// Beides ist reine Logik und deshalb hier geprüft. Der Rest der Hülle —
// Fenster, Tray, Menü — braucht einen laufenden Electron-Prozess und ist von
// Hand verifiziert (siehe Commit-Text).

describe("Arbeitsplatz — Serveradresse normalisieren", () => {
  it("ergänzt https, wenn kein Schema angegeben ist", () => {
    // Der Normalfall: jemand tippt den Rechnernamen ab, wie er im Handbuch
    // steht. Verschlüsselt ist die Vorgabe — wer versehentlich unverschlüsselt
    // landet, merkt es nicht.
    expect(normalisiereAdresse("patio.sima.intern")).toBe("https://patio.sima.intern");
  });

  it("lässt ausdrückliches http stehen", () => {
    // Für die Erprobung gegen einen Entwicklungsserver ohne TLS. Ausdrücklich
    // heißt ausdrücklich — hier wird nichts stillschweigend hochgestuft.
    expect(normalisiereAdresse("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });

  it("behält den Port", () => {
    expect(normalisiereAdresse("patio.sima.intern:8443")).toBe("https://patio.sima.intern:8443");
  });

  it("schneidet Pfad und Abfrage ab", () => {
    // Der wichtigste Fall. Wer die Adresse aus der Adresszeile kopiert,
    // bringt einen Pfad mit — und die Prüfung liefe dann gegen
    // `…/projekte/villa/api/health` statt gegen `…/api/health`.
    expect(normalisiereAdresse("https://patio.sima.intern/projekte/villa?tab=notizen")).toBe(
      "https://patio.sima.intern",
    );
  });

  it("entfernt den abschließenden Schrägstrich", () => {
    // Sonst entstünde beim Anhängen `https://patio.sima.intern//api/health`.
    expect(normalisiereAdresse("https://patio.sima.intern/")).toBe("https://patio.sima.intern");
  });

  it("verträgt Leerzeichen aus der Zwischenablage", () => {
    expect(normalisiereAdresse("  patio.sima.intern  ")).toBe("https://patio.sima.intern");
  });

  it("weist Leereingaben ab", () => {
    expect(normalisiereAdresse("")).toBeNull();
    expect(normalisiereAdresse("   ")).toBeNull();
  });

  it("weist fremde Schemata ab", () => {
    // `file:` wäre der gefährliche Fall — die Hülle lädt damit sonst eine
    // beliebige lokale Datei ins Programmfenster.
    expect(normalisiereAdresse("file:///C:/Windows")).toBeNull();
    expect(normalisiereAdresse("ftp://patio.sima.intern")).toBeNull();
  });

  it("weist Eingaben ohne Rechnernamen ab", () => {
    expect(normalisiereAdresse("https://")).toBeNull();
    expect(normalisiereAdresse("://kaputt")).toBeNull();
  });
});

describe("Arbeitsplatz — Netzwerkfehler erklären", () => {
  it("erklärt ein nicht vertrautes Zertifikat und nennt die Anleitung", () => {
    // Der wahrscheinlichste Fehler beim ersten Start an einem neuen Platz:
    // das Wurzelzertifikat der internen CA ist noch nicht eingespielt.
    const text = erklaereFehler("net::ERR_CERT_AUTHORITY_INVALID");
    expect(text).toContain("Wurzelzertifikat");
    expect(text).toContain("Zertifikat");
    expect(text).not.toContain("ERR_");
  });

  it("erklärt einen unbekannten Rechnernamen", () => {
    expect(erklaereFehler("net::ERR_NAME_NOT_RESOLVED")).toContain("nicht bekannt");
  });

  it("unterscheidet abgelehnte Verbindung von Zeitüberschreitung", () => {
    // Zwei verschiedene Ursachen, zwei verschiedene nächste Schritte: einmal
    // „läuft PATIO?", einmal „Netz/Firewall".
    expect(erklaereFehler("net::ERR_CONNECTION_REFUSED")).toContain("Läuft PATIO");
    expect(erklaereFehler("net::ERR_CONNECTION_TIMED_OUT")).toContain("Firewall");
  });

  it("reicht Unbekanntes unverändert durch", () => {
    // Bewusst so: eine Meldung, die niemand vorhergesehen hat, ist immer noch
    // besser als ein pauschales „unbekannter Fehler", das nichts hergibt.
    expect(erklaereFehler("net::ERR_SSL_PROTOCOL_ERROR")).toBe("net::ERR_SSL_PROTOCOL_ERROR");
  });
});
