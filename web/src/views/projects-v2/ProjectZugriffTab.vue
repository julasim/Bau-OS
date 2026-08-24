<script setup lang="ts">
// ============================================================
// PATIO — Projektakte, Reiter „Zugriff" (Phase 3)
// ============================================================
// Wer darf dieses Projekt sehen? Nur die Verwaltung öffnet diesen Reiter — für
// andere Konten steht er gar nicht erst in der Kontext-Leiste, und die Akte
// rendert ihn zusätzlich nur bei `isAdmin`.
//
// Verwalter erscheinen NICHT in der Auswahlliste: sie sehen ohnehin alle
// Projekte (die Sichtbarkeitsregel im Server lässt sie durch). Ein Eintrag für
// sie sähe aus, als bräuchten sie einen — und sein Fehlen später aus, als
// hätten sie keinen Zugriff.
// ============================================================

import { ref, computed, onMounted, watch } from "vue";
import { api } from "../../api";
import BIcon from "../../components/BIcon.vue";
import { useConfirm } from "../../composables/useConfirm";

const props = defineProps<{ projectName: string }>();
const { confirm } = useConfirm();
const n = () => encodeURIComponent(props.projectName);

interface AdminUserMini {
  id: string;
  username: string;
  displayName: string | null;
  role: "admin" | "user";
}

interface ProjectAccessEntry {
  userId: string;
  username: string;
  displayName: string | null;
  role: "admin" | "user";
  addedAt: string;
}

// ── Zugriff (Phase 3) ────────────────────────────────────
const accessList = ref<ProjectAccessEntry[]>([]);
const accessLoaded = ref(false);
const allUsers = ref<AdminUserMini[]>([]);
const allUsersLoaded = ref(false);
const accessAddUserId = ref(""); // ausgewaehlter User im Dropdown
const accessSaving = ref(false);
const accessError = ref<string | null>(null);

// ── Zugriff (Phase 3) ────────────────────────────────────
async function loadAccess() {
  try {
    accessList.value = await api.get<ProjectAccessEntry[]>(`/projects/${n()}/access`);
    accessLoaded.value = true;
  } catch {
    accessList.value = [];
    accessLoaded.value = true;
  }
}

async function loadAllUsers() {
  try {
    allUsers.value = await api.get<AdminUserMini[]>("/admin/users");
    allUsersLoaded.value = true;
  } catch {
    allUsers.value = [];
    allUsersLoaded.value = true;
  }
}

// Kandidaten zum Hinzufuegen: alle, die noch nicht im accessList sind.
// Admins kriegen automatisch Zugriff via Query-Scoping (Phase 4) — wir
// blenden sie hier aus, damit man nicht denkt sie braeuchten einen Eintrag.
const accessCandidates = computed<AdminUserMini[]>(() => {
  const granted = new Set(accessList.value.map((a) => a.userId));
  return allUsers.value.filter((u) => u.role !== "admin" && !granted.has(u.id));
});

async function grantAccess() {
  if (!accessAddUserId.value || accessSaving.value) return;
  accessSaving.value = true;
  accessError.value = null;
  try {
    await api.post(`/projects/${n()}/access`, { userId: accessAddUserId.value });
    accessAddUserId.value = "";
    await loadAccess();
  } catch (e) {
    accessError.value = e instanceof Error ? e.message : "Freigabe fehlgeschlagen";
  } finally {
    accessSaving.value = false;
  }
}

async function revokeAccess(userId: string) {
  if (!(await confirm({ message: "Freigabe wirklich entfernen?", confirmDanger: true }))) return;
  try {
    await api.delete(`/projects/${n()}/access/${encodeURIComponent(userId)}`);
    await loadAccess();
  } catch (e) {
    accessError.value = e instanceof Error ? e.message : "Entfernen fehlgeschlagen";
  }
}

/** Initialen für das Kürzel-Feld — dieselbe Regel wie in der Team-Liste. */
function initial(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

onMounted(() => {
  void loadAccess();
  void loadAllUsers();
});

watch(
  () => props.projectName,
  () => {
    accessLoaded.value = false;
    void loadAccess();
  },
);
</script>

<template>
  <div class="zugriff-tab">
    <div
      style="
        font-size: 12px;
        color: var(--color-text-muted);
        background: var(--color-bg-subtle);
        padding: 10px 14px;
        border: 1px solid var(--color-border-subtle);
        border-radius: 8px;
        margin-bottom: 14px;
        line-height: 1.5;
      "
    >
      <BIcon name="info" :size="11" />
      <span style="margin-left: 4px">
        Admins haben automatisch Zugriff auf alle Projekte. Hier nur Nutzer freigeben.
      </span>
    </div>

    <div class="flex items-center" style="gap: 8px; margin-bottom: 14px; flex-wrap: wrap">
      <select
        v-model="accessAddUserId"
        class="form-input"
        style="max-width: 280px; flex: 0 1 280px"
        :disabled="accessCandidates.length === 0 || accessSaving"
      >
        <option value="">
          {{ accessCandidates.length === 0 ? "Keine weiteren Nutzer" : "Nutzer freigeben…" }}
        </option>
        <option v-for="u in accessCandidates" :key="u.id" :value="u.id">
          {{ u.displayName ?? u.username }}
          <template v-if="u.displayName"> ({{ u.username }})</template>
        </option>
      </select>
      <button class="patio-btn solid sm" :disabled="!accessAddUserId || accessSaving" @click="grantAccess">
        {{ accessSaving ? "…" : "Freigeben" }}
      </button>
      <span v-if="accessError" style="font-size: 11px; color: var(--color-danger-text)">
        {{ accessError }}
      </span>
    </div>

    <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
      <div v-for="entry in accessList" :key="entry.userId" class="access-row">
        <div
          class="member-avatar member-avatar-sm"
          style="
            background: var(--color-bg-subtle);
            color: var(--color-text-secondary);
            border: 1px solid var(--color-border);
          "
        >
          {{ initial(entry.displayName ?? entry.username) }}
        </div>
        <div style="flex: 1; min-width: 0">
          <div style="font-size: 13px; color: var(--color-text)">{{ entry.displayName ?? entry.username }}</div>
          <div v-if="entry.displayName" style="font-size: 11px; color: var(--color-text-muted)">
            {{ entry.username }}
          </div>
        </div>
        <span style="font-size: 11px; color: var(--color-text-muted)">Nutzer</span>
        <button class="access-remove" @click="revokeAccess(entry.userId)" :title="'Zugriff entziehen'">
          <BIcon name="x" :size="12" />
        </button>
      </div>
      <p v-if="accessLoaded && accessList.length === 0" class="empty-hint">Noch keine Nutzer freigegeben.</p>
      <p v-else-if="!accessLoaded" class="empty-hint">Lade…</p>
    </div>
  </div>
</template>

<style scoped>
/* ── Zugriff-Tab (Phase 3) ────────────────────────────── */
.access-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--color-border-subtle);
  transition: background 180ms ease;
}
.access-row:first-child {
  border-top: 0;
}
.access-row:hover {
  background: var(--color-bg-subtle);
}
.access-remove {
  background: transparent;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0;
  transition: all 180ms ease;
}
.access-row:hover .access-remove {
  opacity: 1;
}
.access-remove:hover {
  color: var(--color-danger-text);
  background: var(--color-bg);
}
</style>
