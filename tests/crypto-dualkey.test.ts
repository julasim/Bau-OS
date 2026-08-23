import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// ============================================================
// SEC-4 Schluesseltrennung (Feld-Verschluesselung) — Beweis-Test
// ------------------------------------------------------------
// Der Fallback-Zweig in crypto.ts (decryptString probiert nach dem
// Primaerschluessel zusaetzlich JWT_SECRET; needsReencrypt meldet einen
// "nur-ueber-den-Fallback-lesbar"-Wert als true) ist im normalen Testlauf
// toter Code: dort ist ENCRYPTION_KEY leer -> PRIMARY_SECRET === JWT_SECRET
// -> HAS_FALLBACK === false. Diese Suite deckt genau diese Migrations-Logik.
//
// Knackpunkt: crypto.ts liest PRIMARY_SECRET/HAS_FALLBACK EINMALIG zur
// Modul-Ladezeit — aus config.ts, das process.env ebenfalls nur zur Ladezeit
// liest. Um beide Key-Zustaende zu pruefen, muss das Modul mit
// UNTERSCHIEDLICHEN Env-Staenden je frisch geladen werden:
//   vi.stubEnv (Env setzen) + vi.resetModules (Registry leeren) + await import.
// resetModules invalidiert auch config.ts (crypto.ts importiert es), sodass
// die Secrets tatsaechlich neu evaluiert werden. Jede so geladene
// Modul-Instanz haelt ihre EIGENEN, zur Ladezeit berechneten Konstanten
// (PRIMARY_SECRET/HAS_FALLBACK/JWT_SECRET) fest — die exportierten Funktionen
// schliessen darueber. Deshalb verschluesseln/entschluesseln cryptoOld und
// cryptoNew unabhaengig voneinander mit verschiedenen Schluesseln.
//
// Env-Verifikation gegen den Code (crypto.ts):
//   PRIMARY_SECRET = ENCRYPTION_KEY || JWT_SECRET
//   HAS_FALLBACK   = PRIMARY_SECRET !== JWT_SECRET && JWT_SECRET.length > 0
// -> HAS_FALLBACK ist genau dann true, wenn ENCRYPTION_KEY gesetzt (!= "")
//    UND != JWT_SECRET ist. Die Werte unten (ENC != JWT, beide nicht leer)
//    treffen das.
// ============================================================

// Zwei klar verschiedene, hinreichend lange Secrets.
const JWT = "test-jwt-secret-fuer-dualkey-mind-32-zeichen";
const ENC = "anderer-encryption-key-fuer-dualkey-mind-32-zeichen";

// Vollstaendiger Modul-Typ ueber den import-typeof — haelt den Test tsc-sauber
// (encryptString/decryptString/needsReencrypt sind typisiert).
type CryptoModule = typeof import("../src/api/crypto.js");

// Laedt crypto.ts (und transitiv config.ts) frisch mit dem aktuell gesetzten
// Env-Stand. resetModules VOR dem import, damit die Modul-Level-Konstanten neu
// aus process.env berechnet werden.
async function loadCryptoFresh(): Promise<CryptoModule> {
  vi.resetModules();
  return import("../src/api/crypto.js");
}

describe("crypto SEC-4 dual-key-Fallback", () => {
  let cryptoOld: CryptoModule; // Phase 1: nur JWT_SECRET       -> PRIMARY === JWT, kein Fallback
  let cryptoNew: CryptoModule; // Phase 2: ENCRYPTION_KEY != JWT -> PRIMARY === ENC, HAS_FALLBACK
  let cryptoOldAgain: CryptoModule; // Phase 3: wieder nur JWT_SECRET

  let altEnc: string; // mit JWT_SECRET (Alt-Key) verschluesselt (Bestandsdaten)
  let neuEnc: string; // mit ENCRYPTION_KEY (Neu-/Primaerschluessel) verschluesselt

  beforeAll(async () => {
    // ── Phase 1: JWT_SECRET gesetzt, ENCRYPTION_KEY "leer" ───────────────
    // "" statt undefined/delete: markiert den Key als in process.env
    // VORHANDEN, sodass dotenv/config (Top-Level-Import in config.ts) ihn nicht
    // aus einer echten .env nachbefuellt. config.ts wertet "" wie ungesetzt
    // (process.env.ENCRYPTION_KEY || "") -> crypto.ts nimmt JWT_SECRET.
    vi.stubEnv("JWT_SECRET", JWT);
    vi.stubEnv("ENCRYPTION_KEY", "");
    cryptoOld = await loadCryptoFresh();
    altEnc = cryptoOld.encryptString("geheim")!; // PRIMARY === JWT -> mit JWT verschluesselt

    // ── Phase 2: JWT_SECRET unveraendert, ENCRYPTION_KEY gesetzt (!= JWT) ─
    // Jetzt PRIMARY === ENC, HAS_FALLBACK === true.
    vi.stubEnv("JWT_SECRET", JWT);
    vi.stubEnv("ENCRYPTION_KEY", ENC);
    cryptoNew = await loadCryptoFresh();
    neuEnc = cryptoNew.encryptString("neu")!; // PRIMARY === ENC -> mit ENC verschluesselt

    // ── Phase 3: wieder nur JWT_SECRET (kein ENCRYPTION_KEY) ─────────────
    // Fuer den Key-Trennungs-Beweis: ohne ENC darf ein mit ENC verschluesselter
    // Wert NICHT mehr lesbar sein (der Fallback zeigt auf JWT, nicht auf ENC).
    vi.stubEnv("JWT_SECRET", JWT);
    vi.stubEnv("ENCRYPTION_KEY", "");
    cryptoOldAgain = await loadCryptoFresh();
  });

  afterAll(() => {
    // Env-Stubs zuruecknehmen und Modul-Registry saeubern, damit nachfolgende
    // Test-Files wieder den normalen (ENCRYPTION_KEY-losen) Zustand sehen und
    // ihre eigenen Modul-Instanzen frisch laden.
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("Kern nach Stufe 2: ein mit dem Alt-Key verschluesselter Wert ist NICHT mehr lesbar", () => {
    // Bis Stufe 2 fiel `decryptString` hier auf JWT_SECRET zurueck und lieferte
    // den Klartext — das war der Migrationszweig, damit Bestandsdaten waehrend
    // der Umstellung lesbar blieben.
    //
    // Stufe 2 ist am 23.08.2026 abgeschlossen: es gab nichts umzuschluesseln
    // (nachgemessen: 73 Konten, 0 verschluesselte Felder), und ein zweiter
    // Entschluesselungsweg, den niemand braucht, ist ein zweiter Weg, auf dem
    // ein Geheimnis mit einem ROTIERTEN Schluessel doch noch aufgeht.
    //
    // Der Wert ist damit nicht verloren, sondern unlesbar — und
    // `needsReencrypt` sagt das auch (naechster Test).
    expect(cryptoNew.decryptString(altEnc)).toBeNull();
  });

  it("needsReencrypt meldet ihn weiterhin (true) — er ist nicht still verschwunden", () => {
    // Wichtig nach Stufe 2: ohne diese Meldung waere ein unlesbarer Wert von
    // einem leeren Feld nicht zu unterscheiden.
    expect(cryptoNew.needsReencrypt(altEnc)).toBe(true);
  });

  it("frisch mit dem Primaerschluessel verschluesselt: needsReencrypt false + decrypt round-trip", () => {
    // neuEnc wurde mit ENC (== PRIMARY in cryptoNew) verschluesselt.
    expect(cryptoNew.needsReencrypt(neuEnc)).toBe(false);
    expect(cryptoNew.decryptString(neuEnc)).toBe("neu");
  });

  it("Key-Trennung: ohne ENCRYPTION_KEY ist ein mit ENC verschluesselter Wert NICHT lesbar (null)", () => {
    // cryptoOldAgain: PRIMARY === JWT, HAS_FALLBACK === false. neuEnc wurde mit
    // ENC verschluesselt -> weder Primaer- noch (nicht existenter) Fallback-Key
    // oeffnen ihn. Beweist echte Schluessel-Trennung ENC != JWT.
    expect(cryptoOldAgain.decryptString(neuEnc)).toBeNull();
  });

  it("Gegenprobe: das reine JWT-Modul liest altEnc (JWT), aber nicht neuEnc (ENC)", () => {
    // Selbstpruefung der Env-/resetModules-Mechanik: die beiden Ciphertexts sind
    // tatsaechlich mit verschiedenen Keys erzeugt. cryptoOldAgain (nur JWT)
    // entschluesselt altEnc korrekt und neuEnc gar nicht.
    expect(cryptoOldAgain.decryptString(altEnc)).toBe("geheim");
    expect(cryptoOldAgain.decryptString(neuEnc)).toBeNull();
  });
});
