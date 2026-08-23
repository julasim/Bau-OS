import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Jede in einem Template benutzte Komponente muss auch importiert sein.
//
// ── Warum das ein Test sein muss ────────────────────────────────────────────
//
// Weil es hier sonst niemand merkt. Vue rendert eine unbekannte Komponente
// als unbekanntes HTML-Element — ohne Fehler, ohne Warnung im Produktionsbau.
// Im Browser steht dann wörtlich
//
//     <projektbezug name="Wohnhaus Huber" nummer="SAZTG-2026-014"></projektbezug>
//
// und die Stelle bleibt schlicht leer. Und die vorhandenen Prüfungen greifen
// nicht: `vue-tsc` beanstandet es nicht, und `eslint-plugin-vue` ist in diesem
// Projekt bewusst nicht installiert (siehe CLAUDE.md, „Prüfbereiche").
//
// Gemessen am 2026-08-23: genau so sind vier Ansichten (Aktivität, Suche,
// Papierkorb, Dateibrowser) mit einer stillen Lücke in den Bau gegangen. Die
// ganze Kette — tsc, vue-tsc, ESLint, Build, 503 Tests — war grün.
//
// ── Was der Test bewusst NICHT kann ─────────────────────────────────────────
//
// Er kennt nur lokal importierte Komponenten. Global registrierte gibt es in
// diesem Projekt nicht (`main.ts` registriert keine); käme eine dazu, gehört
// sie in `GLOBAL_BEKANNT` unten.
describe("Vue: benutzte Komponenten sind importiert", () => {
  /** Global registrierte oder eingebaute Komponenten, die keinen Import
   *  brauchen. Vue-eigene Sonderformen sind bereits ausgeschlossen. */
  const GLOBAL_BEKANNT = new Set<string>([
    "RouterView",
    "RouterLink",
    "Transition",
    "TransitionGroup",
    "KeepAlive",
    "Teleport",
    "Suspense",
    "Component",
  ]);

  function vueDateien(ordner: string): string[] {
    const gefunden: string[] = [];
    for (const eintrag of readdirSync(ordner)) {
      const pfad = join(ordner, eintrag);
      if (statSync(pfad).isDirectory()) gefunden.push(...vueDateien(pfad));
      else if (eintrag.endsWith(".vue")) gefunden.push(pfad);
    }
    return gefunden;
  }

  it("keine Ansicht benutzt eine Komponente, die sie nicht importiert", () => {
    const wurzel = join(process.cwd(), "web", "src");
    const befunde: string[] = [];

    for (const datei of vueDateien(wurzel)) {
      const text = readFileSync(datei, "utf-8");

      // Nur der Template-Teil. Im Script stehen Typnamen in Großschreibung,
      // die keine Komponenten sind.
      //
      // HTML-Kommentare fliegen raus: `<!-- v2-Ansichten rendern ihr
      // <DetailPane> selbst. -->` ist eine Erklärung, keine Benutzung — und
      // genau daran hat dieser Test beim ersten Lauf falsch angeschlagen.
      const template = text.slice(text.indexOf("<template>")).replace(/<!--[\s\S]*?-->/g, "");
      if (!template) continue;

      // Groß geschriebene Tags = Komponenten (PascalCase-Konvention dieses
      // Projekts). Kebab-Case-Schreibweisen kommen hier nicht vor.
      const benutzt = new Set([...template.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((m) => m[1]));

      // Importiert oder per `defineAsyncComponent`/`const X = ...` definiert.
      const kopf = text.slice(0, text.indexOf("</script>") + 1);
      for (const name of benutzt) {
        if (GLOBAL_BEKANNT.has(name)) continue;
        const importiert =
          new RegExp(`\\b${name}\\b`).test(kopf.match(/^import[\s\S]*?;$/gm)?.join("\n") ?? "") ||
          new RegExp(`(const|let|var)\\s+${name}\\b`).test(kopf);
        if (!importiert) {
          befunde.push(`${datei.slice(wurzel.length + 1).replace(/\\/g, "/")}: <${name}>`);
        }
      }
    }

    // Die Meldung nennt jede Fundstelle. Eine Zahl allein hilft beim Suchen
    // nicht, und genau dieser Test soll das Suchen ersparen.
    expect(befunde, `Nicht importierte Komponenten:\n  ${befunde.join("\n  ")}`).toEqual([]);
  });
});
