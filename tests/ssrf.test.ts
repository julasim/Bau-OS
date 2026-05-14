import { describe, it, expect } from "vitest";
import { isBlockedHostname } from "../src/web.js";

describe("isBlockedHostname — localhost Varianten", () => {
  it("blockiert 'localhost'", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
  });

  it("blockiert 'LOCALHOST' (case-insensitive)", () => {
    expect(isBlockedHostname("LOCALHOST")).toBe(true);
  });

  it("blockiert 127.0.0.1", () => {
    expect(isBlockedHostname("127.0.0.1")).toBe(true);
  });

  it("blockiert 127.0.0.2 (ganzes /8)", () => {
    expect(isBlockedHostname("127.0.0.2")).toBe(true);
  });

  it("blockiert 127.1.2.3", () => {
    expect(isBlockedHostname("127.1.2.3")).toBe(true);
  });

  it("blockiert ::1", () => {
    expect(isBlockedHostname("::1")).toBe(true);
  });

  it("blockiert [::1] (mit Klammern)", () => {
    expect(isBlockedHostname("[::1]")).toBe(true);
  });

  it("blockiert 0.0.0.0", () => {
    expect(isBlockedHostname("0.0.0.0")).toBe(true);
  });
});

describe("isBlockedHostname — Private Ranges", () => {
  it("blockiert 10.0.0.1", () => {
    expect(isBlockedHostname("10.0.0.1")).toBe(true);
  });

  it("blockiert 10.255.255.255", () => {
    expect(isBlockedHostname("10.255.255.255")).toBe(true);
  });

  it("blockiert 172.16.0.1", () => {
    expect(isBlockedHostname("172.16.0.1")).toBe(true);
  });

  it("blockiert 172.31.255.255", () => {
    expect(isBlockedHostname("172.31.255.255")).toBe(true);
  });

  it("blockiert 192.168.0.1", () => {
    expect(isBlockedHostname("192.168.0.1")).toBe(true);
  });

  it("blockiert 192.168.255.255", () => {
    expect(isBlockedHostname("192.168.255.255")).toBe(true);
  });

  it("blockiert 169.254.1.1 (link-local)", () => {
    expect(isBlockedHostname("169.254.1.1")).toBe(true);
  });
});

describe("isBlockedHostname — IPv6 private", () => {
  it("blockiert fc00::1 (ULA)", () => {
    expect(isBlockedHostname("fc00::1")).toBe(true);
  });

  it("blockiert fd00::1 (ULA)", () => {
    expect(isBlockedHostname("fd00::1")).toBe(true);
  });

  it("blockiert fe80::1 (link-local)", () => {
    expect(isBlockedHostname("fe80::1")).toBe(true);
  });

  it("blockiert ::ffff:127.0.0.1 (IPv6-mapped IPv4)", () => {
    expect(isBlockedHostname("::ffff:127.0.0.1")).toBe(true);
  });
});

describe("isBlockedHostname — Decimal/Octal/Hex Encoding", () => {
  it("blockiert 2130706433 (127.0.0.1 als decimal int)", () => {
    expect(isBlockedHostname("2130706433")).toBe(true);
  });

  it("blockiert 0x7f000001 (127.0.0.1 als hex)", () => {
    expect(isBlockedHostname("0x7f000001")).toBe(true);
  });

  it("blockiert 0177.0.0.1 (127 als octal)", () => {
    expect(isBlockedHostname("0177.0.0.1")).toBe(true);
  });

  // Hinweis: 0x7f.0.0.1 wird von der aktuellen rein syntaktischen Impl
  // NICHT erkannt — es matcht weder das reine Hex-Regex (Punkte) noch das
  // Oktal-Regex (kein Ziffer nach der 0). Bekanntes Restrisiko.
  it("erkennt 0x7f.0.0.1 NICHT (dokumentierte Impl-Luecke)", () => {
    expect(isBlockedHostname("0x7f.0.0.1")).toBe(false);
  });
});

describe("isBlockedHostname — Hostname Patterns", () => {
  it("blockiert metadata.google.internal", () => {
    expect(isBlockedHostname("metadata.google.internal")).toBe(true);
  });

  it("blockiert anything.local", () => {
    expect(isBlockedHostname("anything.local")).toBe(true);
  });

  it("blockiert anything.internal", () => {
    expect(isBlockedHostname("anything.internal")).toBe(true);
  });
});

describe("isBlockedHostname — Erlaubte Hosts", () => {
  it("erlaubt example.com", () => {
    expect(isBlockedHostname("example.com")).toBe(false);
  });

  it("erlaubt google.com", () => {
    expect(isBlockedHostname("google.com")).toBe(false);
  });

  it("erlaubt 192.169.0.1 (ausserhalb private range)", () => {
    expect(isBlockedHostname("192.169.0.1")).toBe(false);
  });

  it("erlaubt 172.15.0.1 (ausserhalb 172.16-31)", () => {
    expect(isBlockedHostname("172.15.0.1")).toBe(false);
  });

  it("erlaubt 172.32.0.1 (ausserhalb 172.16-31)", () => {
    expect(isBlockedHostname("172.32.0.1")).toBe(false);
  });

  it("erlaubt 8.8.8.8", () => {
    expect(isBlockedHostname("8.8.8.8")).toBe(false);
  });

  it("erlaubt github.com", () => {
    expect(isBlockedHostname("github.com")).toBe(false);
  });
});

describe("isBlockedHostname — Edge Cases", () => {
  it("blockiert leeren String (fail-closed)", () => {
    // Impl: `if (!hostname) return true;` — leerer Hostname wird geblockt
    expect(isBlockedHostname("")).toBe(true);
  });

  it("blockiert reine Zahl '0' (decodiert zu 0.0.0.0)", () => {
    // Impl: matcht /^\d+$/, decimalToIpv4("0") = "0.0.0.0" → isPrivateIpv4 true
    expect(isBlockedHostname("0")).toBe(true);
  });

  it("blockiert '::' (unspecified address)", () => {
    expect(isBlockedHostname("::")).toBe(true);
  });

  it("blockiert ungueltige Riesen-Zahl (fail-closed)", () => {
    // decimalToIpv4 gibt "" zurueck bei > 0xffffffff → Impl blockt
    expect(isBlockedHostname("99999999999")).toBe(true);
  });
});
