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
</template>
