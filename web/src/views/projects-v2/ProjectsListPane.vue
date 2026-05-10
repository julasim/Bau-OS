<script setup lang="ts">
// ============================================================
// Bau-OS Workspace v2 — ProjectsListPane
// ============================================================
// ListPane fuer Projekte. Tabs Aktiv/Alle, Filter+Search.
// Klick → /projects/:name (Detail).
// ============================================================

import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../../api";
import ListPane from "../../components/shell/ListPane.vue";

interface Project {
  name: string;
  status?: string;
  phase?: string | null;
  bauherr?: string | null;
  bauherrName?: string | null;
  openTasks?: number;
  termine?: number;
  files?: number;
}

type Tab = "active" | "all";

const route = useRoute();
const router = useRouter();
const projects = ref<Project[]>([]);
const search = ref("");
const tab = ref<Tab>("active");

const filtered = computed(() => {
  let r = projects.value;
  if (tab.value === "active") {
    r = r.filter((p) => !p.status || p.status === "aktiv");
  }
  if (search.value) {
    const q = search.value.toLowerCase();
    r = r.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.bauherrName ?? p.bauherr ?? "").toLowerCase().includes(q) ||
        (p.phase ?? "").toLowerCase().includes(q),
    );
  }
  return [...r].sort((a, b) => a.name.localeCompare(b.name, "de"));
});

const counts = computed(() => ({
  active: projects.value.filter((p) => !p.status || p.status === "aktiv").length,
  all: projects.value.length,
}));

const activeName = computed(() => decodeURIComponent((route.params.name as string) ?? ""));

async function load() {
  try {
    // /projects liefert nur Namen — wir holen Details via /projects/info
    // wenn die API das hat. Sonst zeigen wir Name-Only.
    const list = await api.get<Project[] | string[]>("/projects?detailed=1").catch(async () => {
      const names = await api.get<string[]>("/projects");
      return names.map((n) => ({ name: n })) as Project[];
    });
    projects.value = (list as Project[]).map((p) => (typeof p === "string" ? { name: p } : p)) as Project[];
  } catch {
    projects.value = [];
  }
}

function openProject(name: string) {
  router.push(`/projects/${encodeURIComponent(name)}`);
}

// ── Create-Dialog ─────────────────────────────────────────────────────
const showCreate = ref(false);
const createSaving = ref(false);
const createError = ref<string | null>(null);
const createForm = ref({
  name: "",
  description: "",
  projektnummer: "",
  bauherr: "",
  standort: "",
  projektart: "",
  nutzung: "",
  phase: "",
  startDate: "",
  endDate: "",
});
const PROJEKTART_OPTIONS = ["", "Neubau", "Umbau", "Sanierung", "Zubau"] as const;

function openCreate() {
  showCreate.value = true;
  createError.value = null;
  createForm.value = {
    name: "",
    description: "",
    projektnummer: "",
    bauherr: "",
    standort: "",
    projektart: "",
    nutzung: "",
    phase: "",
    startDate: "",
    endDate: "",
  };
}

async function submitCreate() {
  const name = createForm.value.name.trim();
  if (!name || createSaving.value) return;
  if (projects.value.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    createError.value = "Ein Projekt mit diesem Namen existiert bereits.";
    return;
  }
  createSaving.value = true;
  createError.value = null;
  try {
    const payload = { ...createForm.value, name };
    const created = await api.post<{ name: string }>("/projects", payload);
    showCreate.value = false;
    await load();
    router.push(`/projects/${encodeURIComponent(created.name)}`);
  } catch (e) {
    createError.value = e instanceof Error ? e.message : "Anlegen fehlgeschlagen";
  } finally {
    createSaving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <ListPane
    title="Projekte"
    :count="counts.all"
    searchable
    search-placeholder="Projekte filtern…"
    :model-value="search"
    @update:model-value="search = $event"
    :tabs="[
      { id: 'active', label: `Aktiv ${counts.active}` },
      { id: 'all', label: `Alle ${counts.all}` },
    ]"
    :active-tab="tab"
    @tab-change="tab = $event as Tab"
  >
    <template #action>
      <button class="v2-icon-btn" title="Neues Projekt" @click="openCreate">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </template>

    <button
      v-for="p in filtered"
      :key="p.name"
      class="list-item"
      :data-active="p.name === activeName"
      @click="openProject(p.name)"
    >
      <div class="li-top">
        <span class="li-title">{{ p.name }}</span>
        <span v-if="p.openTasks !== undefined" class="li-time">{{ p.openTasks }} ◇</span>
      </div>
      <div v-if="p.phase || p.bauherrName || p.bauherr" class="li-meta">
        <span v-if="p.phase">{{ p.phase }}</span>
        <span v-if="p.phase && (p.bauherrName || p.bauherr)">·</span>
        <span v-if="p.bauherrName || p.bauherr">{{ p.bauherrName ?? p.bauherr }}</span>
      </div>
    </button>

    <div
      v-if="filtered.length === 0"
      style="padding: 32px 16px; text-align: center; font-size: 12px; color: var(--fg-muted)"
    >
      <span v-if="search">Keine Treffer für „{{ search }}"</span>
      <span v-else-if="tab === 'active'">Keine aktiven Projekte.</span>
      <span v-else>Noch keine Projekte angelegt.</span>
    </div>
  </ListPane>

  <!-- Create-Modal -->
  <div v-if="showCreate" class="create-overlay" @click.self="showCreate = false">
    <div class="create-card">
      <h3 style="margin: 0 0 12px; font-size: 15px; font-weight: 600">Neues Projekt</h3>
      <div style="display: flex; flex-direction: column; gap: 10px">
        <input
          v-model="createForm.name"
          placeholder="Name * (z.B. Wohnhaus Huber)"
          class="create-input"
          @keyup.enter="submitCreate"
        />
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
          <input v-model="createForm.projektnummer" placeholder="Projektnr." class="create-input" />
          <select v-model="createForm.projektart" class="create-input">
            <option v-for="opt in PROJEKTART_OPTIONS" :key="opt" :value="opt">
              {{ opt || "— Projektart —" }}
            </option>
          </select>
        </div>
        <input v-model="createForm.bauherr" placeholder="Bauherr" class="create-input" />
        <input v-model="createForm.standort" placeholder="Standort / Adresse" class="create-input" />
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
          <input v-model="createForm.nutzung" placeholder="Nutzung" class="create-input" />
          <input v-model="createForm.phase" placeholder="Phase" class="create-input" />
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
          <input v-model="createForm.startDate" type="date" class="create-input" />
          <input v-model="createForm.endDate" type="date" class="create-input" />
        </div>
        <textarea
          v-model="createForm.description"
          placeholder="Beschreibung (optional)"
          rows="2"
          class="create-input"
          style="resize: vertical; font-family: inherit; line-height: 1.5"
        ></textarea>
      </div>
      <div v-if="createError" style="margin-top: 8px; color: var(--status-error); font-size: 12px">
        {{ createError }}
      </div>
      <div style="margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end">
        <button class="v2-btn" :disabled="createSaving" @click="showCreate = false">Abbrechen</button>
        <button
          class="v2-btn v2-btn-primary"
          :disabled="!createForm.name.trim() || createSaving"
          :style="{ opacity: !createForm.name.trim() || createSaving ? 0.5 : 1 }"
          @click="submitCreate"
        >
          {{ createSaving ? "Lege an…" : "Anlegen" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.create-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.create-card {
  background: var(--bg-app);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  padding: 20px;
  width: 100%;
  max-width: 480px;
  margin: 16px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
}
.create-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-app);
  color: var(--fg-primary);
  font-size: 13px;
  outline: none;
}
.create-input:focus {
  border-color: var(--accent);
}
</style>
