import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// `<style scoped>` ist nicht global — und genau das geht regelmäßig unter.
//
// ── Der Fehler, den dieser Test fängt ──────────────────────────────────────
//
// Eine Klasse wird im `<style scoped>` einer Ansicht definiert und danach in
// einer ZWEITEN Ansicht benutzt. Dort greift sie nicht: Vue hängt an jede
// scoped-Regel ein `[data-v-…]`, das nur Elemente der eigenen Komponente
// tragen. Es gibt keine Fehlermeldung, kein Build-Problem, keinen Typfehler —
// das Element rendert einfach ohne Gestaltung.
//
// Gefunden am 24.08.2026: `.stamm-input` und `.empty-hint` standen scoped in
// `ProjectDetailView.vue` (und wortgleich in `TeamDetailView.vue`), benutzt
// wurden sie in ZWÖLF Ansichten. Im Browser nachgemessen (Ansicht „Firmen"):
// Eingabefeld ohne Rahmen, ohne Radius, ohne Innenabstand; der Hinweistext
// linksbündig statt zentriert. Beide sind jetzt in `patio-components.css`.
//
// ── Warum die Regel so eng gefasst ist ─────────────────────────────────────
//
// Gemeldet wird nur, was in IRGENDEINER Komponente scoped definiert und in
// einer ANDEREN benutzt wird. Tailwind-Hilfsklassen (`flex`, `items-center`)
// stehen in keiner scoped-Regel und fallen damit von selbst heraus — ohne
// Ausnahmeliste, die man pflegen müsste.

const WEB = "web/src";

function alleDateien(ordner: string, endung: string): string[] {
  const raus: string[] = [];
  for (const e of readdirSync(ordner)) {
    const p = join(ordner, e);
    if (statSync(p).isDirectory()) raus.push(...alleDateien(p, endung));
    else if (e.endsWith(endung)) raus.push(p);
  }
  return raus;
}

/** Klassennamen aus einem CSS-Text (Selektor-Position, nicht in Strings). */
function definierteKlassen(css: string): Set<string> {
  const raus = new Set<string>();
  // Nur der Selektor-Teil vor `{` — sonst zählen Inhalte wie `content: ".x"`.
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    for (const k of m[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) raus.add(k[1]);
  }
  return raus;
}

/** Der `<template>`-Teil einer `.vue` — dort stehen die benutzten Klassen. */
function template(quelle: string): string {
  const i = quelle.indexOf("<template>");
  if (i < 0) return "";
  const j = quelle.lastIndexOf("</template>");
  return j > i ? quelle.slice(i, j) : quelle.slice(i);
}

/** Der scoped-Style-Teil einer `.vue`. Unscoped `<style>` zählt als global. */
function scopedStil(quelle: string): string {
  let raus = "";
  for (const m of quelle.matchAll(/<style[^>]*\sscoped[^>]*>([\s\S]*?)<\/style>/g)) raus += m[1];
  return raus;
}
function globalerStil(quelle: string): string {
  let raus = "";
  for (const m of quelle.matchAll(/<style(?![^>]*\sscoped)[^>]*>([\s\S]*?)<\/style>/g)) raus += m[1];
  return raus;
}

/** Klassen aus `class="…"` und aus `:class`-Ausdrücken (Zeichenketten darin). */
function benutzteKlassen(tpl: string): Set<string> {
  const raus = new Set<string>();
  for (const m of tpl.matchAll(/\sclass="([^"]*)"/g)) {
    for (const k of m[1].split(/\s+/)) if (k && !k.includes("{") && !k.includes("$")) raus.add(k);
  }
  // `:class="['a', b ? 'c' : 'd']"` und `:class="{ 'a-b': x }"`
  for (const m of tpl.matchAll(/\s:class="([^"]*)"/g)) {
    // Vergleichsoperanden zuerst wegwerfen: in
    // `['ph-vt', view === 'gantt' ? 'active' : '']` ist `gantt` ein
    // Ansichtsname, keine Klasse. Ohne diesen Schritt meldet der Test die
    // Zeitleisten-Klasse als geliehen, obwohl sie es nicht ist.
    const ausdruck = m[1].replace(/[!=]==?\s*'[^']*'/g, "");
    for (const k of ausdruck.matchAll(/'([^']+)'/g)) {
      for (const t of k[1].split(/\s+/)) if (t) raus.add(t);
    }
  }
  return raus;
}

// Tailwind erzeugt seine Hilfsklassen zur Bauzeit; in keiner Quelldatei steht
// eine Regel dafür. Sie tauchen hier nur auf, weil sie in zusammengesetzten
// Selektoren mitgeschrieben werden (`.settings-row.flex.items-center.gap-3`) —
// definiert werden sie dort nicht. Kommt eine weitere hinzu, schlägt der Test
// fehl und der Name gehört in diese Liste.
const TAILWIND_HILFSKLASSEN = new Set(["flex", "items-center", "gap-3", "justify-between"]);

describe("Scoped-Klassen bleiben in ihrer Komponente", () => {
  const vueDateien = alleDateien(WEB, ".vue");
  const cssDateien = alleDateien(WEB, ".css");

  // Alles, was global gilt: eigenständige `.css`-Dateien plus unscoped
  // `<style>`-Blöcke in Komponenten.
  const global = new Set<string>();
  for (const f of cssDateien) for (const k of definierteKlassen(readFileSync(f, "utf8"))) global.add(k);
  for (const f of vueDateien) for (const k of definierteKlassen(globalerStil(readFileSync(f, "utf8")))) global.add(k);

  // Wer definiert was scoped, und wer benutzt was?
  const scopedVon = new Map<string, string>(); // Klasse → Datei
  const benutztVon = new Map<string, Set<string>>(); // Klasse → Dateien
  for (const f of vueDateien) {
    const q = readFileSync(f, "utf8");
    for (const k of definierteKlassen(scopedStil(q))) if (!scopedVon.has(k)) scopedVon.set(k, f);
    for (const k of benutzteKlassen(template(q))) {
      if (!benutztVon.has(k)) benutztVon.set(k, new Set());
      benutztVon.get(k)!.add(f);
    }
  }

  it("keine scoped definierte Klasse wird in einer anderen Ansicht benutzt", () => {
    const befunde: string[] = [];
    for (const [klasse, quelldatei] of scopedVon) {
      if (global.has(klasse) || TAILWIND_HILFSKLASSEN.has(klasse)) continue; // greift ohnehin überall
      for (const nutzer of benutztVon.get(klasse) ?? []) {
        if (nutzer !== quelldatei) {
          befunde.push(`.${klasse}: definiert in ${quelldatei}, benutzt in ${nutzer}`);
        }
      }
    }
    expect(befunde.sort()).toEqual([]);
  });
});
