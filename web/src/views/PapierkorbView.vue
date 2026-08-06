<script setup lang="ts">
// ============================================================
// PATIO — Papierkorb (Migrationen 044 und 049)
// ============================================================
// Gelöschtes liegt hier, bis es zurückgeholt oder endgültig entfernt wird.
//
// Die Ansicht ist bewusst für ALLE da, nicht nur für die Verwaltung: gelöscht
// wird im Alltag eine Notiz oder eine Aufgabe, und wer sie versehentlich
// weggeklickt hat, soll sie selbst zurückholen können. Nur der Abschnitt mit
// den Projekten ist der Verwaltung vorbehalten — ein gelöschtes Projekt ist
// für seinen Ersteller nicht mehr sichtbar, er könnte es also gar nicht
// auswählen.
// ============================================================
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";
import { useConfirm } from "../composables/useConfirm";
import { useCurrentUser } from "../composables/useCurrentUser";
import { formatDate } from "../utils/format";

type Art = "notiz" | "aufgabe" | "termin";

interface Eintrag {
  typ: Art;
  id: string;
  titel: string;
  projectName: string | null;
  geloeschtAm: string;
}

interface GeloeschtesProjekt {
  id: string;
  name: string;
  deletedAt: string;
}

const { confirm } = useConfirm();
const { isAdmin } = useCurrentUser();

const eintraege = ref<Eintrag[]>([]);
const projekte = ref<GeloeschtesProjekt[]>([]);
const geladen = ref(false);
const fehler = ref<string | null>(null);

const ART: Record<Art, { label: string; icon: string }> = {
  notiz: { label: "Notiz", icon: "pencil" },
  aufgabe: { label: "Aufgabe", icon: "check" },
  termin: { label: "Termin", icon: "calendar" },
};

const leer = computed(() => eintraege.value.length === 0 && projekte.value.length === 0);

async function laden() {
  fehler.value = null;
  try {
    const daten = await api.get<{ eintraege: Eintrag[]; projekte: GeloeschtesProjekt[] }>("/papierkorb");
    eintraege.value = daten.eintraege ?? [];
    projekte.value = daten.projekte ?? [];
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Papierkorb konnte nicht geladen werden";
  } finally {
    geladen.value = true;
  }
}

async function zurueckholen(e: Eintrag) {
  try {
    await api.post(`/papierkorb/${e.typ}/${e.id}/zurueckholen`, {});
    await laden();
  } catch (err) {
    fehler.value = err instanceof Error ? err.message : "Zurückholen fehlgeschlagen";
  }
}

async function endgueltig(e: Eintrag) {
  const bestaetigt = await confirm({
    message: `${ART[e.typ].label} „${e.titel}" endgültig entfernen? Das lässt sich nicht rückgängig machen.`,
    confirmDanger: true,
  });
  if (!bestaetigt) return;
  try {
    await api.delete(`/papierkorb/${e.typ}/${e.id}`);
    await laden();
  } catch (err) {
    fehler.value = err instanceof Error ? err.message : "Löschen fehlgeschlagen";
  }
}

async function projektZurueckholen(p: GeloeschtesProjekt) {
  if (!(await confirm(`Projekt „${p.name}" wieder in Verwendung nehmen?`))) return;
  try {
    await api.post(`/projects/${encodeURIComponent(p.name)}/wiederherstellen`, {});
    await laden();
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Wiederherstellen fehlgeschlagen";
  }
}

async function projektEndgueltig(p: GeloeschtesProjekt) {
  // Der einzige Schritt im Programm, bei dem wirklich Daten verloren gehen —
  // deshalb steht in der Rückfrage, was mitgeht.
  const bestaetigt = await confirm({
    message:
      `Projekt „${p.name}" endgültig entfernen? Damit gehen Bautagebuch, Besprechungen, erfasste Stunden, ` +
      `Leistungsphasen und Rechnungen dieses Projekts unwiderruflich verloren. Notizen, Aufgaben, Termine ` +
      `und Dateien bleiben erhalten, verlieren aber ihren Projektbezug.`,
    confirmDanger: true,
  });
  if (!bestaetigt) return;
  try {
    await api.delete(`/projects/${encodeURIComponent(p.name)}/endgueltig`);
    await laden();
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
  }
}

onMounted(laden);
</script>

<template>
  <div class="pk-wrap">
    <header class="pk-head">
      <div class="eyebrow">Übersicht</div>
      <h1 class="pk-title">Papierkorb</h1>
      <p class="pk-lead">
        Gelöschte Notizen, Aufgaben und Termine liegen hier, bis sie zurückgeholt oder endgültig entfernt werden.
        Solange sie hier stehen, geht nichts verloren.
      </p>
    </header>

    <div v-if="fehler" class="pk-error">{{ fehler }}</div>
    <div v-if="!geladen" class="empty-hint">Lade…</div>
    <div v-else-if="leer" class="empty-hint">Der Papierkorb ist leer.</div>

    <template v-else>
      <template v-if="eintraege.length > 0">
        <h2 class="pk-h2">Datensätze</h2>
        <ul class="pk-list">
          <li v-for="e in eintraege" :key="e.typ + e.id" class="pk-item">
            <span class="pk-art">
              <BIcon :name="ART[e.typ].icon" :size="11" />
              {{ ART[e.typ].label }}
            </span>
            <span class="pk-titel">{{ e.titel }}</span>
            <span v-if="e.projectName" class="pk-projekt">{{ e.projectName }}</span>
            <span v-else class="pk-projekt pk-privat">persönlich</span>
            <span class="pk-datum font-mono">{{ formatDate(e.geloeschtAm) }}</span>
            <div class="pk-actions">
              <button class="row-action" title="Zurückholen" @click="zurueckholen(e)">Zurückholen</button>
              <button
                class="row-action row-action-danger"
                title="Endgültig entfernen — nicht umkehrbar"
                @click="endgueltig(e)"
              >
                <BIcon name="x" :size="11" />
              </button>
            </div>
          </li>
        </ul>
      </template>

      <template v-if="isAdmin && projekte.length > 0">
        <h2 class="pk-h2" style="margin-top: 24px">Projekte</h2>
        <p class="pk-hinweis">
          Ein Projekt im Papierkorb ist für niemanden mehr sichtbar — seine Datensätze sind aber unangetastet und kommen
          beim Zurückholen vollständig mit.
        </p>
        <ul class="pk-list">
          <li v-for="p in projekte" :key="p.id" class="pk-item">
            <span class="pk-art"><BIcon name="folder" :size="11" /> Projekt</span>
            <span class="pk-titel">{{ p.name }}</span>
            <span class="pk-projekt"></span>
            <span class="pk-datum font-mono">{{ formatDate(p.deletedAt) }}</span>
            <div class="pk-actions">
              <button class="row-action" @click="projektZurueckholen(p)">Zurückholen</button>
              <button class="row-action row-action-danger" @click="projektEndgueltig(p)">
                <BIcon name="x" :size="11" />
              </button>
            </div>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>

<style scoped>
.pk-wrap {
  padding: 24px;
  max-width: 900px;
}
.pk-head {
  margin-bottom: 20px;
}
.pk-title {
  font-size: 18px;
  font-weight: 600;
  margin: 6px 0 8px;
  letter-spacing: -0.01em;
}
.pk-lead,
.pk-hinweis {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin: 0;
  max-width: 66ch;
}
.pk-hinweis {
  margin-bottom: 8px;
}
.pk-error {
  border: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
  padding: 8px 12px;
  font-size: 12px;
  margin-bottom: 16px;
}
.pk-h2 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  margin: 0 0 6px;
  font-weight: 500;
}
.pk-list {
  list-style: none;
  padding: 0;
  margin: 0;
  border-top: 1px solid var(--color-border);
}
.pk-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
}
.pk-art {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: 92px;
  color: var(--color-text-muted);
  font-size: 11px;
  flex-shrink: 0;
}
.pk-titel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pk-projekt {
  width: 160px;
  color: var(--color-text-muted);
  font-size: 11px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pk-privat {
  font-style: italic;
  color: var(--color-text-tertiary);
}
.pk-datum {
  width: 92px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  flex-shrink: 0;
}
.pk-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .pk-projekt,
  .pk-datum {
    display: none;
  }
}
</style>
