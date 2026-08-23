<script setup lang="ts">
import { ref } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";
import ProjektBezug from "../components/ProjektBezug.vue";

// Die Suche vergleicht den Eingabe-String als Ganzes (ILIKE '%…%') — sie
// zerlegt ihn NICHT in einzelne Woerter. Mehrwortige Vorschlaege wie
// "Offene Aufgaben" liefern deshalb praktisch immer 0 Treffer. Als Beispiele
// taugen nur einzelne Begriffe, die so auch im Text stehen koennen.
const EXAMPLE_CHIPS = ["Bautagebuch", "Rechnung", "Abnahme"];

// Eine einheitliche Trefferform ueber alle Bereiche. Die frueheren zwei
// Betriebsarten (Vault-Textsuche vs. Embedding-Suche) sind entfallen — es
// gibt nur noch einen Weg, und der liefert immer dieselbe Struktur.
type HitType = "note" | "task" | "project" | "file";

interface SearchHit {
  type: HitType;
  id: string;
  title: string;
  snippet: string | null;
  project: string | null;
  projektnummer?: string | null;
}

const TYPE_LABEL: Record<HitType, string> = {
  note: "Notiz",
  task: "Aufgabe",
  project: "Projekt",
  file: "Datei",
};

const router = useRouter();

const query = ref("");
const searched = ref(false);
const loading = ref(false);
const error = ref("");
const results = ref<SearchHit[]>([]);

/** Sprungziel je Treffer-Typ, oder null wenn es keines gibt.
 *
 *  Notizen und Projekte werden ueber ihren NAMEN adressiert, nicht ueber die
 *  id — `title` ist bei beiden genau dieser Name. Dateien haben kein Ziel:
 *  der Datei-Browser kennt weder Route-Parameter noch Query, ein einzelner
 *  Treffer laesst sich dort nicht ansteuern. */
function hitTarget(hit: SearchHit): RouteLocationRaw | null {
  switch (hit.type) {
    case "note":
      return { name: "notes", params: { name: hit.title } };
    case "task":
      return { name: "tasks", params: { id: hit.id } };
    case "project":
      return { name: "project-detail", params: { name: hit.title } };
    default:
      return null;
  }
}

function openHit(hit: SearchHit) {
  const target = hitTarget(hit);
  if (target) void router.push(target);
}

function fillAndSearch(term: string) {
  query.value = term;
  search();
}

async function search() {
  if (!query.value.trim()) return;
  loading.value = true;
  searched.value = true;
  error.value = "";
  results.value = [];

  try {
    const res = await api.get<{ query: string; results: SearchHit[] }>(`/search?q=${encodeURIComponent(query.value)}`);
    results.value = res.results ?? [];
  } catch (e) {
    // Frueher wurde der Fehler stillschweigend verschluckt — dann sah der
    // Nutzer "Keine Ergebnisse" statt zu erfahren, dass die Suche scheiterte.
    error.value = e instanceof Error ? e.message : "Suche fehlgeschlagen";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div style="padding: 24px 32px 32px; color: var(--color-text)">
    <div class="eyebrow" style="margin-bottom: 6px; text-align: center">Inhalte</div>
    <h1
      style="
        font-size: 24px;
        font-weight: 600;
        margin: 0;
        letter-spacing: -0.01em;
        text-align: center;
        margin-bottom: 6px;
      "
    >
      Suche
    </h1>
    <p style="font-size: 13px; color: var(--color-text-muted); text-align: center; margin-bottom: 24px">
      Sucht in Titeln und Inhalten von Notizen, Aufgaben, Projekten und Dateien. Der Suchbegriff wird als
      zusammenhängende Zeichenfolge gesucht — mehrere Wörter finden nur, was genau so im Text steht.
    </p>

    <div
      class="flex items-center"
      style="
        gap: 8px;
        padding: 10px 14px;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg);
        margin-bottom: 20px;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
      "
    >
      <BIcon name="search" :size="16" style="color: var(--color-text-muted)" />
      <input
        v-model="query"
        placeholder="Suchbegriff — ein Wort oder Wortteil…"
        @keyup.enter="search"
        style="flex: 1; border: none; outline: none; background: transparent; font-size: 14px; color: var(--color-text)"
      />
      <button @click="search" :disabled="loading" class="patio-btn solid" style="padding: 4px 12px; font-size: 12px">
        {{ loading ? "…" : "Suchen" }}
      </button>
    </div>

    <!-- Startscreen — vor der ersten Suche -->
    <div v-if="!searched" class="search-start">
      <BIcon name="search" :size="36" class="search-start-icon" />
      <p class="search-start-hint">Ein Begriff genügt — auch ein Wortteil. Zum Beispiel:</p>
      <div class="search-start-chips">
        <button v-for="chip in EXAMPLE_CHIPS" :key="chip" class="search-chip" @click="fillAndSearch(chip)">
          {{ chip }}
        </button>
      </div>
    </div>

    <!-- Zaehlzeile erst NACH dem Request. `searched` allein reicht nicht:
         search() setzt es zusammen mit results=[] vor dem Absenden, sonst
         blitzt waehrend des Ladens „0 Treffer" auf. -->
    <p
      v-if="searched && !loading && !error"
      style="font-size: 11px; color: var(--color-text-tertiary); margin-bottom: 12px"
    >
      {{ results.length }} Treffer für „{{ query }}"
    </p>

    <p v-if="error" style="font-size: 13px; color: var(--color-danger-text); text-align: center; padding: 24px 0">
      Suche fehlgeschlagen: {{ error }}
    </p>

    <div v-if="results.length > 0" class="flex flex-col" style="gap: 12px">
      <!-- Treffer mit Sprungziel werden als <button> gerendert (Tastatur +
           Screenreader), Dateien als <div> — sie haben kein Ziel und sollen
           deshalb auch nicht klickbar aussehen. -->
      <component
        :is="hitTarget(r) ? 'button' : 'div'"
        v-for="r in results"
        :key="r.type + r.id"
        :type="hitTarget(r) ? 'button' : undefined"
        class="search-card"
        :class="{ 'search-card-link': hitTarget(r) }"
        @click="openHit(r)"
      >
        <div class="flex items-center" style="gap: 10px; margin-bottom: 6px">
          <span
            style="
              font-size: 10px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              padding: 2px 8px;
              border-radius: 4px;
              background: var(--color-primary);
              color: var(--color-bg);
            "
          >
            {{ TYPE_LABEL[r.type] }}
          </span>
          <span style="font-size: 13px; font-weight: 500; color: var(--color-text)">
            {{ r.title }}
          </span>
          <!-- Bei type=project liefert das Backend title und project identisch
               — sonst stuende der Projektname zweimal in derselben Zeile. -->
          <span
            v-if="r.project && r.type !== 'project'"
            class="font-mono"
            style="font-size: 11px; color: var(--color-text-tertiary)"
          >
            <ProjektBezug :name="r.project" :nummer="r.projektnummer" />
          </span>
        </div>
        <p v-if="r.snippet" style="font-size: 12px; color: var(--color-text-muted); line-height: 1.5; margin: 0">
          {{ r.snippet }}
        </p>
      </component>
    </div>

    <p
      v-if="searched && !loading && !error && results.length === 0"
      style="font-size: 13px; color: var(--color-text-tertiary); text-align: center; padding: 32px 0"
    >
      Keine Ergebnisse.
    </p>
  </div>
</template>

<style scoped>
.search-card {
  display: block;
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--color-bg);
  text-align: left;
  font: inherit;
  color: inherit;
  transition: border-color 180ms ease;
}
/* Hover/Cursor nur dort, wo ein Klick auch wirklich etwas tut. */
.search-card-link {
  cursor: pointer;
}
.search-card-link:hover {
  border-color: var(--color-text-faint);
}
.search-card-link:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* ── Startscreen (vor erster Suche) ────────────────────── */
.search-start {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 24px 32px;
  text-align: center;
}
.search-start-icon {
  color: var(--color-text-tertiary);
  opacity: 0.6;
}
.search-start-hint {
  font-size: 14px;
  color: var(--color-text-muted);
  margin: 0;
  max-width: 360px;
  line-height: 1.5;
}
.search-start-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 4px;
}
.search-chip {
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 180ms ease,
    color 180ms ease,
    background 180ms ease;
}
.search-chip:hover {
  border-color: var(--color-text-faint);
  color: var(--color-text);
  background: var(--color-bg-subtle);
}
</style>
