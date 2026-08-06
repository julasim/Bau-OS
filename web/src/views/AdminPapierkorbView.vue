<script setup lang="ts">
// ============================================================
// PATIO — Papierkorb (Migration 044)
// ============================================================
// Gelöschte Projekte liegen hier, bis jemand sie zurückholt oder endgültig
// entfernt. Das ist keine Bequemlichkeit, sondern der Ersatz für einen
// Rückweg, den es vorher gar nicht gab: ein gelöschtes Projekt riss
// Bautagebuch, Protokolle, Stunden, Phasen und Rechnungen mit, und die
// einzige Rettung war die nächtliche Sicherung.
//
// Nur für Admins — ein gelöschtes Projekt ist für seinen Ersteller nicht mehr
// sichtbar, er könnte es also gar nicht auswählen.
// ============================================================
import { ref, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";
import { useConfirm } from "../composables/useConfirm";
import { useCurrentUser } from "../composables/useCurrentUser";
import { formatDate } from "../utils/format";

interface PapierkorbEintrag {
  id: string;
  name: string;
  deletedAt: string;
}

const router = useRouter();
const { confirm } = useConfirm();
const { user: currentUser, isAdmin } = useCurrentUser();

const eintraege = ref<PapierkorbEintrag[]>([]);
const geladen = ref(false);
const fehler = ref<string | null>(null);

function ensureAdmin() {
  if (currentUser.value && !isAdmin.value) router.replace("/");
}
watch(currentUser, ensureAdmin, { immediate: true });

async function laden() {
  fehler.value = null;
  try {
    eintraege.value = await api.get<PapierkorbEintrag[]>("/projects/_papierkorb");
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Papierkorb konnte nicht geladen werden";
  } finally {
    geladen.value = true;
  }
}

async function zurueckholen(e: PapierkorbEintrag) {
  if (!(await confirm(`„${e.name}" wieder in Verwendung nehmen?`))) return;
  try {
    await api.post(`/projects/${encodeURIComponent(e.name)}/wiederherstellen`, {});
    await laden();
  } catch (err) {
    fehler.value = err instanceof Error ? err.message : "Wiederherstellen fehlgeschlagen";
  }
}

async function endgueltigLoeschen(e: PapierkorbEintrag) {
  // Der einzige unumkehrbare Schritt im ganzen Programm — deshalb steht in der
  // Rückfrage, was dabei mitgeht, statt eines allgemeinen „wirklich löschen?".
  const bestaetigt = await confirm({
    message:
      `„${e.name}" endgültig entfernen? Damit gehen Bautagebuch, Besprechungen, ` +
      `erfasste Stunden, Leistungsphasen und Rechnungen dieses Projekts unwiderruflich verloren. ` +
      `Notizen, Aufgaben, Termine und Dateien bleiben erhalten, verlieren aber ihren Projektbezug.`,
    confirmDanger: true,
  });
  if (!bestaetigt) return;
  try {
    await api.delete(`/projects/${encodeURIComponent(e.name)}/endgueltig`);
    await laden();
  } catch (err) {
    fehler.value = err instanceof Error ? err.message : "Löschen fehlgeschlagen";
  }
}

onMounted(laden);
</script>

<template>
  <div class="pk-wrap">
    <header class="pk-head">
      <div class="eyebrow">Verwaltung</div>
      <h1 class="pk-title">Papierkorb</h1>
      <p class="pk-lead">
        Gelöschte Projekte liegen hier, bis sie zurückgeholt oder endgültig entfernt werden. Ihre Datensätze sind
        unangetastet — solange sie hier stehen, geht nichts verloren.
      </p>
    </header>

    <div v-if="fehler" class="pk-error">{{ fehler }}</div>

    <div v-if="!geladen" class="empty-hint">Lade…</div>
    <div v-else-if="eintraege.length === 0" class="empty-hint">
      Der Papierkorb ist leer — es wurde kein Projekt gelöscht.
    </div>

    <ul v-else class="pk-list">
      <li v-for="e in eintraege" :key="e.id" class="pk-item">
        <div class="pk-item-main">
          <span class="pk-name">{{ e.name }}</span>
          <span class="pk-meta font-mono">
            <BIcon name="calendar" :size="10" />
            gelöscht am {{ formatDate(e.deletedAt) }}
          </span>
        </div>
        <div class="pk-actions">
          <button class="row-action" title="Wieder in Verwendung nehmen" @click="zurueckholen(e)">Zurückholen</button>
          <button
            class="row-action row-action-danger"
            title="Endgültig entfernen — nicht umkehrbar"
            @click="endgueltigLoeschen(e)"
          >
            Endgültig löschen
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.pk-wrap {
  padding: 24px;
  max-width: 820px;
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
.pk-lead {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin: 0;
  max-width: 62ch;
}
.pk-error {
  border: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
  padding: 8px 12px;
  font-size: 12px;
  margin-bottom: 16px;
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
  justify-content: space-between;
  gap: 16px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--color-border);
}
.pk-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.pk-name {
  font-size: 13px;
  font-weight: 500;
}
.pk-meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}
.pk-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
</style>
