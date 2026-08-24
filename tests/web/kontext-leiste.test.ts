// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { PROJEKT_REITER, VALID_TABS, sichtbareReiter } from "../../web/src/views/projekt-tabs";
import { SETTINGS_NAV, bereichNachRechten } from "../../web/src/views/settings-nav";

// Die Kontext-Leiste (Fokus-Modus) — und die beiden Listen dahinter.
//
// ── Warum das geprüft wird ─────────────────────────────────────────────────
//
// Die Leiste ist aus PATIO Desktop übernommen. Dort gibt es keine Rechte:
// jeder sitzt an seiner eigenen Ablage. Hier gibt es drei Rollen und ein
// eigenes Geld-Recht — und eine ungefiltert übernommene Leiste böte jedem
// Konto „Rechnungen" und „Zugriff" an, die der Server dann mit 403 abweist.
//
// Der zweite Punkt ist die Kopplung: ein Eintrag ohne Gegenstück in der
// Ansicht setzt `?tab=`, fällt intern auf „uebersicht" zurück — und bleibt in
// der Leiste trotzdem aktiv markiert. Der Nutzer klickt auf „Stunden" und
// liest die Übersicht, ohne dass irgendetwas einen Fehler meldet.

// Rechte je Test umschaltbar. Der echte Composable würde `/auth/me` rufen.
let rechte = { isAdmin: false, darfGeld: false };
vi.mock("../../web/src/composables/useCurrentUser", () => ({
  useCurrentUser: () => ({
    isAdmin: { value: rechte.isAdmin },
    darfGeld: { value: rechte.darfGeld },
  }),
}));

const { default: ContextSidebar } = await import("../../web/src/components/shell/ContextSidebar.vue");

function baueRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/projects/:name", name: "project-detail", component: { template: "<div/>" } },
      { path: "/projects", name: "projects", component: { template: "<div/>" } },
      { path: "/settings", name: "settings", component: { template: "<div/>" } },
    ],
  });
}

async function leiste(pfad: string) {
  const router = baueRouter();
  await router.push(pfad);
  await router.isReady();
  const w = mount(ContextSidebar, { global: { plugins: [router] } });
  return { w, router };
}

describe("ContextSidebar — Rechtefilter", () => {
  beforeEach(() => {
    rechte = { isAdmin: false, darfGeld: false };
  });

  it("ein einfaches Konto sieht weder Rechnungen noch Zugriff", async () => {
    const { w } = await leiste("/projects/Villa");
    expect(w.text()).not.toContain("Rechnungen");
    expect(w.text()).not.toContain("Zugriff");
    // Was bleiben MUSS — sonst prüft der Test nur, dass gar nichts rendert.
    expect(w.text()).toContain("Aufgaben");
    expect(w.text()).toContain("Bautagebuch");
  });

  it("mit Geld-Recht kommen die Rechnungen dazu, der Zugriff nicht", async () => {
    rechte = { isAdmin: false, darfGeld: true };
    const { w } = await leiste("/projects/Villa");
    expect(w.text()).toContain("Rechnungen");
    expect(w.text()).not.toContain("Zugriff");
  });

  it("die Verwaltung sieht alle dreizehn Reiter", async () => {
    rechte = { isAdmin: true, darfGeld: true };
    const { w } = await leiste("/projects/Villa");
    for (const r of PROJEKT_REITER) expect(w.text(), r.key).toContain(r.label);
    expect(w.findAll("button.ctx-item")).toHaveLength(PROJEKT_REITER.length);
  });

  it("eine durch den Filter leer gewordene Gruppe verschwindet mitsamt Überschrift", () => {
    // „Kaufmännisch" enthält heute auch die Stunden und bleibt deshalb stehen.
    // Geprüft wird die Regel, nicht der Tagesstand: eine Überschrift ohne
    // Einträge darunter sieht aus wie ein Ladefehler.
    const nurGeld = PROJEKT_REITER.filter((r) => r.gruppe === "Kaufmännisch").every((r) => r.geldOnly);
    const ohneGeld = sichtbareReiter(false, false).filter((r) => r.gruppe === "Kaufmännisch");
    expect(nurGeld ? ohneGeld.length : 0).toBe(0);
  });
});

describe("ContextSidebar — Navigation", () => {
  beforeEach(() => {
    rechte = { isAdmin: true, darfGeld: true };
  });

  it("zeigt den Projektnamen entschlüsselt an", async () => {
    const { w } = await leiste("/projects/" + encodeURIComponent("Wohnhaus Müller & Partner"));
    expect(w.text()).toContain("Wohnhaus Müller & Partner");
  });

  it("ein Klick setzt `?tab=`, die Übersicht räumt es wieder weg", async () => {
    const { w, router } = await leiste("/projects/Villa");
    const stunden = w.findAll("button.ctx-item").find((b) => b.text().includes("Stunden"))!;
    await stunden.trigger("click");
    // `goTab` startet die Navigation ohne sie zurueckzugeben (`void push`);
    // `router.isReady()` wartet nur auf die ERSTE Navigation und ist hier
    // laengst erfuellt. Es braucht den Microtask-Durchlauf.
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBe("stunden");

    const uebersicht = w.findAll("button.ctx-item").find((b) => b.text().includes("Übersicht"))!;
    await uebersicht.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBeUndefined();
  });

  it("markiert genau den Reiter aus der Adresse als aktiv", async () => {
    const { w } = await leiste("/projects/Villa?tab=meetings");
    const aktiv = w.findAll("button.ctx-item.is-active");
    expect(aktiv).toHaveLength(1);
    expect(aktiv[0].text()).toContain("Meetings");
  });

  it("ohne `?tab=` ist die Übersicht aktiv", async () => {
    const { w } = await leiste("/projects/Villa");
    expect(w.find("button.ctx-item.is-active").text()).toContain("Übersicht");
  });

  it("im Einstellungs-Kontext stehen die Bereiche, nicht die Projektreiter", async () => {
    const { w } = await leiste("/settings?sektion=word-export");
    expect(w.text()).toContain("Einstellungen");
    expect(w.text()).not.toContain("Bautagebuch");
    expect(w.find("button.ctx-item.is-active").text()).toContain("Word-Export");
  });

  it("ohne Verwaltungsrecht fehlen die bürointernen Bereiche", async () => {
    rechte = { isAdmin: false, darfGeld: false };
    const { w } = await leiste("/settings");
    expect(w.text()).toContain("Profil & Sicherheit");
    expect(w.text()).not.toContain("Word-Export");
    expect(w.text()).not.toContain("KI-Zugriff");
    expect(w.text()).not.toContain("Positionskatalog");
  });
});

// ── Kopplung an die Ansichten ──────────────────────────────────────────────
//
// Die Listen sind jetzt die einzige Quelle. Das schützt davor, dass Leiste und
// Ansicht verschiedene Reiter kennen — aber nicht davor, dass ein Reiter in
// der Liste steht, für den die Ansicht keinen Zweig hat. Genau das prüfen die
// beiden folgenden Tests, und zwar am Dateitext: eine `.vue` lässt sich hier
// nicht sinnvoll mounten (sie zieht ein Dutzend Datenabfragen nach sich).

describe("Kopplung Liste ↔ Ansicht", () => {
  it("jeder Projektreiter hat in der Projektakte einen Zweig", () => {
    const quelle = readFileSync("web/src/views/ProjectDetailView.vue", "utf8");
    const ohne = VALID_TABS.filter((t) => !quelle.includes(`tab === '${t}'`) && !quelle.includes(`tab === "${t}"`));
    expect(ohne).toEqual([]);
  });

  it("jeder Einstellungs-Bereich hat in den Einstellungen einen Zweig", () => {
    const quelle = readFileSync("web/src/views/SettingsView.vue", "utf8");
    const ohne = SETTINGS_NAV.map((n) => n.id).filter(
      (id) => !quelle.includes(`activeSection === '${id}'`) && !quelle.includes(`activeSection === "${id}"`),
    );
    expect(ohne).toEqual([]);
  });
});

// ── Der Bereichs-Waechter ──────────────────────────────────────────────────
//
// Die Regel steht als reine Funktion in `settings-nav.ts`, weil sie sich sonst
// nur ueber die 2600-Zeilen-Ansicht pruefen liesse. Der Fall, der hier
// festgehalten wird, ist im Browser wirklich passiert.
describe("bereichNachRechten", () => {
  it("solange /auth/me noch laeuft, wird NICHTS umgestellt", () => {
    // Der Kern: `istAdmin=false` heisst zu diesem Zeitpunkt „unbekannt",
    // nicht „darf nicht". Ohne diese Zeile verliert ein Verwalter sein
    // Lesezeichen auf `?sektion=branding` beim Oeffnen.
    expect(bereichNachRechten("branding", false, false, false)).toBeNull();
  });

  it("nach dem Laden bleibt der Verwalter, wo er ist", () => {
    expect(bereichNachRechten("branding", true, true, true)).toBeNull();
  });

  it("ein herabgestuftes Konto landet auf dem Profil", () => {
    expect(bereichNachRechten("branding", true, false, false)).toBe("profil");
  });

  it("der Positionskatalog haengt am Geld-Recht, nicht an der Rolle", () => {
    expect(bereichNachRechten("positionskatalog", true, false, true)).toBeNull();
    expect(bereichNachRechten("positionskatalog", true, false, false)).toBe("profil");
  });

  it("ein erfundener Bereich aus der Adresszeile faellt zurueck", () => {
    expect(bereichNachRechten("gibtsnicht", true, true, true)).toBe("profil");
  });
});
