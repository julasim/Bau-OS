import { describe, it, expect } from "vitest";
import { validateUpload, isAllowedExtension, extensionOf } from "../src/api/file-validation.js";

// Echte Magic-Byte-Signaturen als Buffer.
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n", "latin1");
const GIF = Buffer.from("GIF89a", "latin1");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
// RIFF <size> WEBP
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const PLAIN_TEXT = Buffer.from("Hallo Welt, das ist eine Notiz.\n", "utf-8");
const HTML = Buffer.from("<!DOCTYPE html><html><body><script>alert(1)</script></body></html>", "utf-8");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "utf-8");
const JSON_BUF = Buffer.from('{"a":1,"b":[2,3]}', "utf-8");

describe("extensionOf / isAllowedExtension", () => {
  it("extrahiert die Endung case-insensitiv", () => {
    expect(extensionOf("Foto.PNG")).toBe("png");
    expect(extensionOf("archiv.tar.gz")).toBe("gz");
    expect(extensionOf("ohneendung")).toBe("ohneendung");
  });
  it("erlaubt nur Whitelist-Endungen", () => {
    expect(isAllowedExtension("doku.pdf")).toBe(true);
    expect(isAllowedExtension("tabelle.xlsx")).toBe(true);
    expect(isAllowedExtension("boese.exe")).toBe(false);
    expect(isAllowedExtension("skript.sh")).toBe(false);
  });
});

describe("validateUpload — passende Endung + Inhalt", () => {
  it("akzeptiert Binaerformate mit korrekter Signatur", async () => {
    expect(await validateUpload(PNG, "bild.png")).toEqual({ ok: true });
    expect(await validateUpload(PDF, "vertrag.pdf")).toEqual({ ok: true });
    expect(await validateUpload(GIF, "anim.gif")).toEqual({ ok: true });
    expect(await validateUpload(JPEG, "foto.jpg")).toEqual({ ok: true });
    expect(await validateUpload(JPEG, "foto.jpeg")).toEqual({ ok: true });
    expect(await validateUpload(WEBP, "bild.webp")).toEqual({ ok: true });
    expect(await validateUpload(ZIP, "paket.zip")).toEqual({ ok: true });
  });

  it("akzeptiert ZIP-Container als OOXML (.docx/.xlsx)", async () => {
    // OOXML ist ein ZIP-Container; file-type meldet oft nur 'zip'.
    expect(await validateUpload(ZIP, "brief.docx")).toEqual({ ok: true });
    expect(await validateUpload(ZIP, "kalk.xlsx")).toEqual({ ok: true });
  });

  it("akzeptiert Text-Formate ohne Magic Bytes anhand der Endung", async () => {
    expect(await validateUpload(PLAIN_TEXT, "notiz.txt")).toEqual({ ok: true });
    expect(await validateUpload(PLAIN_TEXT, "readme.md")).toEqual({ ok: true });
    expect(await validateUpload(JSON_BUF, "data.json")).toEqual({ ok: true });
    expect(await validateUpload(SVG, "zeichnung.xml")).toEqual({ ok: true });
    expect(await validateUpload(PLAIN_TEXT, "liste.csv")).toEqual({ ok: true });
  });
});

describe("validateUpload — getarnte Uploads (SEC-3b)", () => {
  it("weist HTML/SVG getarnt als Bild ab", async () => {
    expect(await validateUpload(HTML, "bild.png")).toEqual({ ok: false, reason: "content-mismatch" });
    expect(await validateUpload(SVG, "logo.png")).toEqual({ ok: false, reason: "content-mismatch" });
    expect(await validateUpload(HTML, "foto.jpg")).toEqual({ ok: false, reason: "content-mismatch" });
  });

  it("weist echte Binaerdatei mit falscher Bild-Endung ab", async () => {
    // PDF-Inhalt, aber als .png hochgeladen.
    expect(await validateUpload(PDF, "getarnt.png")).toEqual({ ok: false, reason: "content-mismatch" });
    // PNG-Inhalt, aber als .pdf hochgeladen.
    expect(await validateUpload(PNG, "getarnt.pdf")).toEqual({ ok: false, reason: "content-mismatch" });
  });

  it("weist Binaersignatur hinter Text-Endung ab (PDF als .txt)", async () => {
    expect(await validateUpload(PDF, "harmlos.txt")).toEqual({ ok: false, reason: "content-mismatch" });
    expect(await validateUpload(ZIP, "notiz.md")).toEqual({ ok: false, reason: "content-mismatch" });
  });

  it("weist nicht erlaubte Endungen ab", async () => {
    expect(await validateUpload(PLAIN_TEXT, "boese.exe")).toEqual({ ok: false, reason: "extension" });
    expect(await validateUpload(ZIP, "run.bat")).toEqual({ ok: false, reason: "extension" });
  });
});
