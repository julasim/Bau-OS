import { describe, it, expect } from "vitest";
import { contentDisposition, asciiName } from "../src/api/dateiname.js";

// Der Dateiname im Content-Disposition-Header.
//
// „Content-Disposition" kam in dieser Testsuite vorher **null Mal** vor, bei
// zehn Stellen im Server, die den Header setzen — mit drei verschiedenen und
// drei falschen Antworten auf dieselbe Frage.
describe("Content-Disposition: Dateiname", () => {
  it("der echte Name steht prozentkodiert in filename*", () => {
    const cd = contentDisposition("Angebot Müller & Söhne.pdf");
    expect(cd).toContain("filename*=UTF-8''");
    const wert = cd.split("filename*=UTF-8''")[1];
    expect(decodeURIComponent(wert)).toBe("Angebot Müller & Söhne.pdf");
  });

  it("daneben steht ein ASCII-Name für alte Clients", () => {
    const cd = contentDisposition("Angebot Müller & Söhne.pdf");
    expect(cd).toContain('filename="Angebot Muller & Sohne.pdf"');
  });

  it("der alte Weg lieferte dem Nutzer Prozentzeichen auf die Platte", () => {
    // Das ist der eigentliche Befund. `filename="${encodeURIComponent(name)}"`
    // stand an drei Stellen — ein Browser dekodiert innerhalb der
    // Anführungszeichen NICHTS. Ein einziges Leerzeichen genügt.
    const alt = `attachment; filename="${encodeURIComponent("Angebot Müller.pdf")}"`;
    expect(alt).toContain("Angebot%20M%C3%BCller.pdf");
    expect(contentDisposition("Angebot Müller.pdf")).not.toContain('filename="Angebot%20');
  });

  it("ß wird zu ss, nicht zu einem Unterstrich", () => {
    expect(asciiName("Straße 7.pdf")).toBe("Strasse 7.pdf");
  });

  it("Zeilenumbrüche kommen nicht in den Header", () => {
    // Node wirft bei CR/LF im Header ERR_INVALID_CHAR — aus dem Download wird
    // ein 500er. Dateinamen entstehen bei Exporten aus Freitext
    // (Projektname, Besprechungstitel), das ist keine theoretische Sorge.
    const cd = contentDisposition("Protokoll\r\nX: böse\r\n.docx");
    expect(cd).not.toMatch(/[\r\n]/);
  });

  it("Anführungszeichen brechen den Wert nicht auf", () => {
    const cd = contentDisposition('Angebot "final".pdf');
    const einfach = cd.match(/filename="([^"]*)"/)![1];
    expect(einfach).toBe("Angebot final.pdf");
  });

  it("ein leerer Name ergibt trotzdem einen brauchbaren Header", () => {
    expect(contentDisposition("")).toContain('filename="datei"');
    expect(contentDisposition("   ")).toContain('filename="datei"');
  });

  it("inline bleibt inline", () => {
    expect(contentDisposition("logo.png", "inline")).toMatch(/^inline; /);
    expect(contentDisposition("logo.png")).toMatch(/^attachment; /);
  });

  it("Klammern und Apostroph werden kodiert, wie RFC 5987 es verlangt", () => {
    // encodeURIComponent lässt !'()* stehen — im erweiterten Wert sind sie
    // aber nicht erlaubt und würden den Header mehrdeutig machen.
    const cd = contentDisposition("Plan (Stand 3)'alt.pdf");
    const wert = cd.split("filename*=UTF-8''")[1];
    expect(wert).not.toMatch(/[()']/);
    expect(decodeURIComponent(wert)).toBe("Plan (Stand 3)'alt.pdf");
  });
});

// ── Die Leseseite ───────────────────────────────────────────────────────────
//
// Die Oberfläche muss `filename*` bevorzugen, sonst gewinnt weiterhin der
// ASCII-Ersatzname und aus „Müller" wird „Mueller" auf der Platte des Nutzers.
// Der Test importiert bewusst die Frontend-Datei — sie ist reine Logik ohne
// Vue-Abhängigkeit.
describe("Content-Disposition: die Oberfläche liest ihn zurück", async () => {
  const { dateinameAusHeader } = await import("../web/src/utils/dateiname.js");

  it("liest den echten Namen und nicht den ASCII-Ersatz", () => {
    const cd = contentDisposition("Angebot Müller & Söhne.pdf");
    expect(dateinameAusHeader(cd, "fallback.pdf")).toBe("Angebot Müller & Söhne.pdf");
  });

  it("kommt mit einem Header ohne filename* zurecht", () => {
    expect(dateinameAusHeader('attachment; filename="alt.docx"', "fallback.pdf")).toBe("alt.docx");
  });

  it("fällt bei kaputter Kodierung auf die einfache Angabe zurück", () => {
    const kaputt = `attachment; filename="ersatz.pdf"; filename*=UTF-8''%E0%A4%A`;
    expect(dateinameAusHeader(kaputt, "fallback.pdf")).toBe("ersatz.pdf");
  });

  it("ohne Header bleibt der Rückfall", () => {
    expect(dateinameAusHeader(null, "fallback.pdf")).toBe("fallback.pdf");
    expect(dateinameAusHeader("attachment", "fallback.pdf")).toBe("fallback.pdf");
  });
});
