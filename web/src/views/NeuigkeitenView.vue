<script setup lang="ts">
// ============================================================
// PATIO — Neuigkeiten (Benachrichtigungen)
// ============================================================
// Der Unterschied zur Aktivität: die Aktivität sagt „im Büro ist etwas
// passiert", diese Liste sagt „DIR wurde etwas zugewiesen". Das erste ist
// eine Übersicht, das zweite eine Adressierung — und nur die zweite darf man
// verpassen.
//
// Deshalb steht hier ein Lesestatus je Person und dort keiner: die Aktivität
// ist aus den Datensätzen abgeleitet und hat gar keine Zeile, an der ein
// „gesehen" hängen könnte.
// ============================================================

import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import BIcon from "../components/BIcon.vue";
import ProjektBezug from "../components/ProjektBezug.vue";
import { useBenachrichtigungen, type Meldung } from "../composables/useBenachrichtigungen";
import { useEvents } from "../composables/useEvents";
import { formatDate } from "../utils/format";

const router = useRouter();
const { meldungen, ungelesen, ladeAnzahl, ladeListe, alsGelesen, alleGelesen } = useBenachrichtigungen();
const nurUngelesen = ref(false);
const laedt = ref(true);

const ZEICHEN: Record<string, string> = {
  "aufgabe-zugewiesen": "check",
  "aufgabe-faellig": "clock",
  "termin-teilnahme": "calendar",
  "besprechung-teilnahme": "users",
};

const ANLASS_TEXT: Record<string, string> = {
  "aufgabe-zugewiesen": "Aufgabe",
  "aufgabe-faellig": "Fällig",
  "termin-teilnahme": "Termin",
  "besprechung-teilnahme": "Besprechung",
};

const sichtbar = computed(() => (nurUngelesen.value ? meldungen.value.filter((m) => !m.gelesenAm) : meldungen.value));

async function laden() {
  laedt.value = true;
  await Promise.all([ladeListe(), ladeAnzahl()]);
  laedt.value = false;
}

/** Ein Klick öffnet den Datensatz — und markiert die Meldung als gelesen.
 *
 *  Beides zusammen, weil alles andere Bedienlast wäre: wer die Aufgabe
 *  öffnet, hat die Meldung gesehen. */
async function oeffnen(m: Meldung) {
  // ⚠ Hier stand `await alsGelesen(...)` ohne Absicherung — und `alsGelesen`
  // wirft, wenn die Route scheitert. Ein Netzaussetzer beim Markieren
  // verhinderte damit die NAVIGATION: Der Nutzer klickte auf die Meldung, und
  // es passierte nichts. Das Öffnen ist der Zweck, das Markieren die
  // Nebensache — die Reihenfolge im Code hat sie vertauscht.
  if (!m.gelesenAm) {
    try {
      await alsGelesen(m.id);
    } catch {
      // Bleibt ungelesen. Beim nächsten Laden steht sie wieder da, und das
      // ist die harmlosere von beiden Möglichkeiten.
    }
  }
  if (m.zielTyp === "task" && m.zielId) {
    router.push(`/tasks/${m.zielId}`);
  } else if (m.projectName) {
    const tab = m.zielTyp === "meeting" ? "meetings" : m.zielTyp === "termin" ? "termine" : "uebersicht";
    router.push(`/projects/${encodeURIComponent(m.projectName)}?tab=${tab}`);
  } else if (m.zielTyp === "termin") {
    router.push("/calendar");
  }
}

onMounted(laden);
useEvents(["task", "termin", "meeting"], () => void laden());
</script>

<template>
  <div class="nk-wrap">
    <header class="nk-head">
      <div class="eyebrow">Arbeitsbereich</div>
      <h1 class="nk-title">Neuigkeiten</h1>
      <p class="nk-lead">
        Was an Sie gerichtet ist: Zuweisungen, Termine, Besprechungen, fällige Aufgaben. Was im Büro sonst passiert,
        steht unter
        <router-link to="/aktivitaet">Aktivität</router-link>.
      </p>
    </header>

    <div class="nk-leiste">
      <label class="nk-filter">
        <input v-model="nurUngelesen" type="checkbox" />
        Nur ungelesene
      </label>
      <span class="nk-zaehler">{{ ungelesen }} ungelesen</span>
      <button v-if="ungelesen > 0" class="patio-btn sm" @click="alleGelesen">Alle als gelesen</button>
    </div>

    <div v-if="laedt" class="empty-hint">Lade…</div>
    <div v-else-if="sichtbar.length === 0" class="empty-state">
      <div class="empty-state-icon"><BIcon name="bell" :size="26" /></div>
      <div class="empty-state-text">
        {{ nurUngelesen ? "Nichts Ungelesenes." : "Noch keine Neuigkeiten." }}
      </div>
    </div>

    <div v-else class="nk-liste">
      <button
        v-for="m in sichtbar"
        :key="m.id"
        class="nk-zeile"
        :class="{ 'nk-ungelesen': !m.gelesenAm }"
        @click="oeffnen(m)"
      >
        <span class="nk-icon"><BIcon :name="ZEICHEN[m.anlass] ?? 'bell'" :size="14" /></span>
        <span class="nk-inhalt">
          <span class="nk-titel">{{ m.titel }}</span>
          <span class="nk-meta">
            <span class="nk-anlass">{{ ANLASS_TEXT[m.anlass] ?? m.anlass }}</span>
            <span v-if="m.ausloeser">· {{ m.ausloeser }}</span>
            <ProjektBezug v-if="m.projectName" :name="m.projectName" />
            <span class="font-mono">{{ formatDate(m.erstelltAm) }}</span>
          </span>
        </span>
        <span v-if="!m.gelesenAm" class="nk-punkt" title="ungelesen"></span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Der Kopfbereich der Neuigkeiten. Stand im Template, war nirgends definiert —
 * Titel und Untertitel lagen ohne Abstand am Rand. */
.nk-head {
  padding: var(--space-6) var(--space-6) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.nk-wrap {
  padding: 24px 28px;
  max-width: 900px;
}
.nk-title {
  font-size: 20px;
  font-weight: 600;
  margin: 2px 0 4px;
  color: var(--color-text);
}
.nk-lead {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0 0 18px;
  max-width: 62ch;
}
.nk-leiste {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
}
.nk-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-muted);
  cursor: pointer;
}
.nk-zaehler {
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-left: auto;
}
.nk-liste {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}
.nk-zeile {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  text-align: left;
  background: transparent;
  border: none;
  border-top: 1px solid var(--color-border-subtle);
  cursor: pointer;
  color: inherit;
}
.nk-zeile:first-child {
  border-top: none;
}
.nk-zeile:hover {
  background: var(--color-bg-subtle);
}
.nk-ungelesen .nk-titel {
  font-weight: 600;
}
.nk-icon {
  color: var(--color-text-tertiary);
  margin-top: 2px;
}
.nk-inhalt {
  flex: 1;
  min-width: 0;
}
.nk-titel {
  display: block;
  font-size: 13px;
  color: var(--color-text);
  line-height: 1.35;
}
.nk-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
  font-size: 10px;
  color: var(--color-text-tertiary);
}
.nk-anlass {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.nk-punkt {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-accent);
  margin-top: 6px;
  flex-shrink: 0;
}
</style>
