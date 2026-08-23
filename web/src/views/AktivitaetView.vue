<script setup lang="ts">
// ============================================================
// PATIO — Aktivität: „was hat sich zuletzt getan"
// ============================================================
// Auf einem Firmenserver arbeiten mehrere Leute am selben Bestand. Die Frage
// „was ist seit gestern passiert?" war bis hierher nur zu beantworten, indem
// man jeden Reiter einzeln durchging.
//
// Der Feed ist abgeleitet, nicht protokolliert (siehe
// src/data/db-aktivitaet.ts) — er zeigt den LETZTEN Stand je Datensatz, nicht
// jede einzelne Änderung. Das steht auch so auf der Seite, damit niemand ihn
// für einen Verlauf hält.
// ============================================================
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";
import { useEvents } from "../composables/useEvents";
import { formatDate } from "../utils/format";
import ProjektBezug from "../components/ProjektBezug.vue";

interface Eintrag {
  typ: "note" | "task" | "termin" | "meeting" | "bautagebuch" | "phase" | "invoice" | "entscheidung" | "file";
  id: string;
  titel: string;
  projectId: string | null;
  projectName: string | null;
  projektnummer?: string | null;
  geaendertAm: string;
  angelegtVon: string | null;
}

const router = useRouter();
const eintraege = ref<Eintrag[]>([]);
const geladen = ref(false);
const fehler = ref<string | null>(null);

/** Bezeichnung, Symbol und Projekt-Reiter je Datenart. `tab` steuert, wohin
 *  ein Klick führt — ohne ihn wäre die Liste eine Sackgasse. */
const ART: Record<Eintrag["typ"], { label: string; icon: string; tab: string }> = {
  note: { label: "Notiz", icon: "pencil", tab: "notes" },
  task: { label: "Aufgabe", icon: "check", tab: "tasks" },
  termin: { label: "Termin", icon: "calendar", tab: "termine" },
  meeting: { label: "Besprechung", icon: "kanban", tab: "meetings" },
  bautagebuch: { label: "Bautagebuch", icon: "book", tab: "bautagebuch" },
  phase: { label: "Leistungsphase", icon: "timeline", tab: "phasen" },
  invoice: { label: "Rechnung", icon: "archive", tab: "rechnungen" },
  entscheidung: { label: "Entscheidung", icon: "check", tab: "entscheidungen" },
  file: { label: "Datei", icon: "file", tab: "files" },
};

/** Nach Tagen gruppiert — „heute", „gestern", dann das Datum. So liest sich
 *  die Liste wie ein Journal statt wie ein Zeitstempel-Protokoll. */
const gruppen = computed(() => {
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const map = new Map<string, Eintrag[]>();
  for (const e of eintraege.value) {
    const d = new Date(e.geaendertAm);
    d.setHours(0, 0, 0, 0);
    const tageHer = Math.round((heute.getTime() - d.getTime()) / 86_400_000);
    const titel = tageHer === 0 ? "Heute" : tageHer === 1 ? "Gestern" : formatDate(e.geaendertAm);
    if (!map.has(titel)) map.set(titel, []);
    map.get(titel)!.push(e);
  }
  return Array.from(map.entries()).map(([titel, items]) => ({ titel, items }));
});

function uhrzeit(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}

function oeffnen(e: Eintrag) {
  // Ohne Projekt gibt es kein sinnvolles Ziel — solche Datensätze sieht
  // ohnehin nur die Verwaltung.
  if (!e.projectName) return;
  router.push({
    name: "project-detail",
    params: { name: e.projectName },
    query: { tab: ART[e.typ]?.tab ?? "uebersicht" },
  });
}

async function laden() {
  fehler.value = null;
  try {
    eintraege.value = await api.get<Eintrag[]>("/aktivitaet?limit=100");
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Aktivität konnte nicht geladen werden";
  } finally {
    geladen.value = true;
  }
}

// Der Feed soll mitlaufen, während jemand anderes arbeitet — sonst müsste man
// die Seite neu laden, um zu sehen, was sich getan hat.
useEvents(["note", "task", "termin", "meeting", "bautagebuch", "phase", "invoice", "entscheidung", "file"], () => {
  void laden();
});

onMounted(laden);
</script>

<template>
  <div class="akt-wrap">
    <header class="akt-head">
      <div class="eyebrow">Übersicht</div>
      <h1 class="akt-title">Aktivität</h1>
      <p class="akt-lead">
        Zuletzt geänderte Datensätze aus den Projekten, die du sehen darfst. Die Liste zeigt den
        <strong>letzten Stand</strong> je Datensatz, nicht jede einzelne Änderung — wer eine Notiz dreimal bearbeitet,
        erscheint einmal.
      </p>
    </header>

    <div v-if="fehler" class="akt-error">{{ fehler }}</div>

    <div v-if="!geladen" class="empty-hint">Lade…</div>
    <div v-else-if="eintraege.length === 0" class="empty-hint">
      Es gibt noch nichts zu berichten — sobald jemand etwas anlegt oder ändert, steht es hier.
    </div>

    <section v-for="g in gruppen" :key="g.titel" class="akt-gruppe">
      <h2 class="akt-gruppe-titel">{{ g.titel }}</h2>
      <ul class="akt-list">
        <li
          v-for="e in g.items"
          :key="e.typ + e.id"
          class="akt-item"
          :class="{ 'akt-item-klickbar': !!e.projectName }"
          @click="oeffnen(e)"
        >
          <span class="akt-zeit font-mono">{{ uhrzeit(e.geaendertAm) }}</span>
          <span class="akt-art">
            <BIcon :name="ART[e.typ]?.icon ?? 'file'" :size="11" />
            {{ ART[e.typ]?.label ?? e.typ }}
          </span>
          <span class="akt-titel">{{ e.titel }}</span>
          <ProjektBezug v-if="e.projectName" class="akt-projekt" :name="e.projectName" :nummer="e.projektnummer" />
          <span v-if="e.angelegtVon" class="akt-wer" :title="'Angelegt von ' + e.angelegtVon">
            {{ e.angelegtVon }}
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.akt-wrap {
  padding: 24px;
  max-width: 960px;
}
.akt-head {
  margin-bottom: 20px;
}
.akt-title {
  font-size: 18px;
  font-weight: 600;
  margin: 6px 0 8px;
  letter-spacing: -0.01em;
}
.akt-lead {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin: 0;
  max-width: 68ch;
}
.akt-error {
  border: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
  padding: 8px 12px;
  font-size: 12px;
  margin-bottom: 16px;
}
.akt-gruppe {
  margin-bottom: 20px;
}
.akt-gruppe-titel {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  margin: 0 0 6px;
  font-weight: 500;
}
.akt-list {
  list-style: none;
  padding: 0;
  margin: 0;
  border-top: 1px solid var(--color-border);
}
.akt-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 4px;
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
}
.akt-item-klickbar {
  cursor: pointer;
}
.akt-item-klickbar:hover {
  background: var(--color-bg-subtle);
}
.akt-zeit {
  width: 44px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  flex-shrink: 0;
}
.akt-art {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: 132px;
  color: var(--color-text-muted);
  font-size: 11px;
  flex-shrink: 0;
}
.akt-titel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.akt-projekt {
  color: var(--color-text-muted);
  font-size: 11px;
  flex-shrink: 0;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.akt-wer {
  color: var(--color-text-tertiary);
  font-size: 11px;
  flex-shrink: 0;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .akt-projekt,
  .akt-wer {
    display: none;
  }
  .akt-art {
    width: auto;
  }
}
</style>
