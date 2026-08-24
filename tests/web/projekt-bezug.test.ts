// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ProjektBezug from "../../web/src/components/ProjektBezug.vue";
import { PLATZHALTER_PRAEFIX } from "../../web/src/utils/projektnummer";

// Der erste Test, der eine echte Vue-Komponente MOUNTET.
//
// ── Was das kann, was `vue-tsc` nicht kann ─────────────────────────────────
//
// `vue-tsc` prüft Typen. Es sagt nicht, ob ein `v-if` das Richtige trifft, ob
// eine Bedingung invertiert ist oder ob ein Feld im Template den falschen
// Namen trägt. Genau diese Klasse Fehler ist in diesem Projekt mehrfach durch
// alle Prüfungen gekommen — zuletzt vier Ansichten, die eine Komponente
// benutzten, ohne sie zu importieren, und eine Spalte „Tätigkeit", die
// durchgehend einen Strich zeigte, weil das Feld anders heisst.
//
// `ProjektBezug` ist der richtige Anfang: die Komponente steht in vierzehn
// Ansichten, und ihre eine Regel — der Platzhalter darf nie wie eine
// Aktennummer aussehen — ist eine Datenschutz- und Ordnungsfrage, keine
// Kosmetik.
describe("ProjektBezug", () => {
  it("zeigt Nummer und Namen", () => {
    const w = mount(ProjektBezug, { props: { name: "Villa Müller", nummer: "SAZTG-2026-014" } });
    expect(w.text()).toContain("SAZTG-2026-014");
    expect(w.text()).toContain("Villa Müller");
  });

  it("zeigt den Platzhalter NICHT als Nummer", () => {
    const w = mount(ProjektBezug, { props: { name: "Villa Müller", nummer: `${PLATZHALTER_PRAEFIX}49911aa9` } });
    expect(w.text()).not.toContain("OHNE-NUMMER");
    expect(w.text()).toContain("Villa Müller");
  });

  it("mit hinweis steht dort der Text `ohne Nummer` statt nichts", () => {
    // Dort, wo man sie nachtragen kann, ist ein sichtbares Loch besser als
    // eine leere Stelle.
    const w = mount(ProjektBezug, { props: { name: "Villa Müller", nummer: null, hinweis: true } });
    expect(w.text()).toContain("ohne Nummer");
  });

  it("ohne `hinweis` bleibt die Stelle leer", () => {
    const w = mount(ProjektBezug, { props: { name: "Villa Müller", nummer: null } });
    expect(w.text()).not.toContain("ohne Nummer");
    expect(w.text()).toContain("Villa Müller");
  });

  it("`nurNummer` lässt den Namen weg", () => {
    const w = mount(ProjektBezug, { props: { name: "Villa Müller", nummer: "SAZTG-2026-014", nurNummer: true } });
    expect(w.text()).toContain("SAZTG-2026-014");
    expect(w.text()).not.toContain("Villa Müller");
  });

  it("ganz ohne Angaben rendert nichts Sichtbares", () => {
    const w = mount(ProjektBezug, { props: {} });
    expect(w.text().trim()).toBe("");
  });
});
