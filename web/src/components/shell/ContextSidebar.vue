<script setup lang="ts">
// ============================================================
// PATIO — ContextSidebar (238px, zweite Leiste im Fokus-Modus)
// ============================================================
// Mittlere Spalte im Fokus-Modus (Projektakte / Einstellungen). Sie trägt die
// Modul-Navigation des jeweiligen Kontexts; die Navigationsleiste links
// schrumpft dafür auf 60px (nur Symbole).
//
//   - Projekt:       koppelt an die Reiter der Projektakte via `?tab=`
//   - Einstellungen: koppelt an die Bereiche des SettingsView via `?sektion=`
//
// ── Was diese Fassung anders macht als die aus PATIO Desktop ───────────────
//
// Der Desktop kennt KEINE Rechte — dort sitzt jeder an seinem eigenen Vault.
// Hier gibt es drei Rollen und ein eigenes Geld-Recht. Ungefiltert übernommen
// böte die Leiste jedem Konto „Rechnungen" und „Zugriff" an, und der Server
// antwortete beim Klick mit 403. Ein Eintrag, der nur eine Fehlermeldung
// öffnet, gehört nicht in die Navigation.
//
// Die Listen selbst stehen nicht hier, sondern in `views/projekt-tabs.ts` und
// `views/settings-nav.ts` — dieselbe Quelle, aus der die Ansichten rendern.
// ============================================================

import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import BIcon from "../BIcon.vue";
import { useCurrentUser } from "../../composables/useCurrentUser";
import { PROJEKT_GRUPPEN, sichtbareReiter } from "../../views/projekt-tabs";
import { nachGruppen, sichtbareSektionen } from "../../views/settings-nav";

const route = useRoute();
const router = useRouter();
const { isAdmin, darfGeld } = useCurrentUser();

const mode = computed<"project" | "settings">(() => (route.name === "settings" ? "settings" : "project"));

// ── Projekt-Kontext ─────────────────────────────────────────────────
const projectName = computed(() => decodeURIComponent((route.params.name as string) ?? ""));
const currentTab = computed(() => (typeof route.query.tab === "string" ? route.query.tab : "uebersicht"));

const projektGruppen = computed(() => {
  const erlaubt = sichtbareReiter(isAdmin.value, darfGeld.value);
  return PROJEKT_GRUPPEN.map((titel) => ({
    title: titel,
    items: erlaubt.filter((r) => r.gruppe === titel).map((r) => ({ key: r.key, label: r.label, icon: r.icon })),
    // Eine Gruppe kann durch den Rechtefilter leer werden („Kaufmännisch"
    // ohne Geld-Recht). Eine Überschrift ohne Einträge darunter sieht aus
    // wie ein Ladefehler.
  })).filter((g) => g.items.length > 0);
});

function goTab(t: string) {
  void router.push({
    name: "project-detail",
    params: { name: route.params.name },
    query: t === "uebersicht" ? {} : { tab: t },
  });
}
function goProjekte() {
  void router.push("/projects");
}

// ── Einstellungs-Kontext ────────────────────────────────────────────
const currentSektion = computed(() => (typeof route.query.sektion === "string" ? route.query.sektion : "profil"));
const settingsGruppen = computed(() =>
  nachGruppen(sichtbareSektionen(isAdmin.value, darfGeld.value)).map((g) => ({
    title: g.group,
    items: g.items.map((i) => ({ key: i.id as string, label: i.label, icon: i.icon })),
  })),
);

function goSektion(s: string) {
  void router.push({ name: "settings", query: s === "profil" ? {} : { sektion: s } });
}

// ── Gemeinsame Ableitung fuers Template ─────────────────────────────
const groups = computed(() => (mode.value === "settings" ? settingsGruppen.value : projektGruppen.value));
const activeKey = computed(() => (mode.value === "settings" ? currentSektion.value : currentTab.value));
function onItem(key: string) {
  if (mode.value === "settings") goSektion(key);
  else goTab(key);
}
</script>

<template>
  <aside class="pane-list pane-list--context" :aria-label="mode === 'settings' ? 'Einstellungen' : 'Projektakte'">
    <div class="ctx-scroll">
      <!-- Kopf: Projekt = Zurueck-Weg + Projektname · Einstellungen = Titel -->
      <template v-if="mode === 'project'">
        <button type="button" class="ctx-back" title="Alle Projekte" @click="goProjekte">
          <BIcon name="arrowLeft" :size="14" />
          <span>Alle Projekte</span>
        </button>
        <div class="ctx-head">
          <span class="ctx-eyebrow">Projekt</span>
          <span class="ctx-title">{{ projectName }}</span>
        </div>
      </template>
      <template v-else>
        <div class="ctx-head ctx-head--plain">
          <span class="ctx-eyebrow">System</span>
          <span class="ctx-title">Einstellungen</span>
        </div>
      </template>

      <nav class="ctx-nav">
        <div v-for="grp in groups" :key="grp.title" class="ctx-group">
          <div class="ctx-group-title">{{ grp.title }}</div>
          <button
            v-for="it in grp.items"
            :key="it.key"
            type="button"
            class="ctx-item"
            :class="{ 'is-active': activeKey === it.key }"
            :title="it.label"
            @click="onItem(it.key)"
          >
            <BIcon :name="it.icon" :size="15" />
            <span>{{ it.label }}</span>
          </button>
        </div>
      </nav>
    </div>
  </aside>
</template>

<style scoped>
/* Basis `.pane-list` liefert Spalte, Scroll-Mechanik und Rahmen (style.css);
   im Kontext auf dem helleren Untergrund. */
.pane-list--context {
  background: var(--surface-subtle);
}
.ctx-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-4) var(--space-3);
  display: flex;
  flex-direction: column;
}
/* Die Modul-Navigation im Fokus-Modus.
 *
 * Die Klasse stand im Template und war NIRGENDS definiert — das `<nav>`
 * rendert seither ohne eigene Gestaltung. Sie auf `.ctx-scroll` umzubiegen
 * waere falsch gewesen: das ist der Rollbereich der Leiste, nicht die
 * Navigation darin. */
.ctx-nav {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.ctx-back {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  margin-bottom: 8px;
  font-size: var(--fs-12);
  color: var(--muted);
  background: transparent;
  border: 0;
  cursor: pointer;
  border-radius: var(--radius-md);
}
.ctx-back svg {
  flex: none;
}
.ctx-back:hover {
  color: var(--fg);
  background: var(--surface);
}
.ctx-head {
  padding: 4px 8px 12px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 6px;
}
.ctx-head--plain {
  padding-top: 2px;
}
.ctx-eyebrow {
  display: block;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--subtle);
  font-weight: var(--fw-bold);
}
.ctx-title {
  display: block;
  margin-top: 2px;
  font-family: var(--font-display);
  font-size: var(--fs-15);
  font-weight: var(--fw-bold);
  color: var(--fg);
  letter-spacing: -0.01em;
  line-height: 1.3;
  word-break: break-word;
}
.ctx-group {
  margin-top: 10px;
}
.ctx-group-title {
  padding: 0 8px 4px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--subtle);
  font-weight: var(--fw-bold);
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  /* Dichteabhaengig; `--row-h` ist die Zeilenhoehe aus `data-density`.
     Etwas flacher als eine Listenzeile — Navigation, keine Datenzeile. */
  min-height: calc(var(--row-h, 36px) - 4px);
  padding: 0 8px;
  border: 0;
  border-left: 2px solid transparent;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  background: transparent;
  color: var(--muted);
  font-size: var(--fs-13);
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}
.ctx-item svg {
  flex: none;
  opacity: 0.8;
}
.ctx-item:hover {
  color: var(--fg);
  background: var(--surface);
}
.ctx-item.is-active {
  color: var(--fg);
  background: var(--surface);
  border-left-color: var(--fg);
  font-weight: 600;
}
.ctx-item.is-active svg {
  opacity: 1;
}
</style>
