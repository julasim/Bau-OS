<script setup lang="ts">
import { formatDayMonth } from "../../utils/format";
// ============================================================
// PATIO Workspace v2 — NotesListPane
// ============================================================
// Mittlere Spalte (320px) der Notizen-Section. Liste aller Notizen
// mit Search + Sort. Klick auf Item → router.push("/notes/:name").
// Aktive Notiz-ID ergibt sich aus route.params.name.
// ============================================================

import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../../api";
import { useEvents } from "../../composables/useEvents";
import ListPane from "../../components/shell/ListPane.vue";
import BIcon from "../../components/BIcon.vue";
import ProjektBezug from "../../components/ProjektBezug.vue";

interface NoteSummary {
  title: string;
  project: string | null;
  projektnummer?: string | null;
  createdAt: string;
  updatedAt: string;
  size: number;
}

const router = useRouter();
const route = useRoute();
const notes = ref<NoteSummary[]>([]);
const search = ref("");
const sortBy = ref<"updatedAt" | "title">("updatedAt");

const filtered = computed(() => {
  let r = notes.value;
  if (search.value) {
    const q = search.value.toLowerCase();
    r = r.filter((n) => n.title.toLowerCase().includes(q) || n.project?.toLowerCase().includes(q));
  }
  return [...r].sort((a, b) => {
    if (sortBy.value === "title") return a.title.localeCompare(b.title);
    return b.updatedAt.localeCompare(a.updatedAt);
  });
});

const activeName = computed(() => (route.params.name as string) ?? "");

async function load() {
  try {
    notes.value = await api.get<NoteSummary[]>("/notes?detailed=1");
  } catch {
    const names = await api.get<string[]>("/notes").catch(() => []);
    notes.value = names.map((n) => ({
      title: n,
      project: null,
      createdAt: "",
      updatedAt: "",
      size: 0,
    }));
  }
}

function openNote(title: string) {
  router.push(`/notes/${encodeURIComponent(title)}`);
}

async function createNote() {
  const title = prompt("Name der neuen Notiz:");
  if (!title || !title.trim()) return;
  const safe = title.trim();
  await api.post("/notes", { content: `# ${safe}\n\n` });
  await load();
  router.push(`/notes/${encodeURIComponent(safe)}`);
}

function relativeTime(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "jetzt";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return formatDayMonth(iso);
}

onMounted(load);
useEvents(["note"], () => load());
</script>

<template>
  <ListPane
    title="Notizen"
    :count="filtered.length"
    searchable
    search-placeholder="Notizen filtern…"
    :model-value="search"
    @update:model-value="search = $event"
  >
    <template #action>
      <button class="v2-icon-btn" title="Neue Notiz" @click="createNote">
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
      v-for="note in filtered"
      :key="note.title"
      class="list-item"
      :data-active="note.title === activeName"
      @click="openNote(note.title)"
    >
      <div class="li-top">
        <span class="li-title">{{ note.title }}</span>
        <span class="li-time">{{ relativeTime(note.updatedAt) }}</span>
      </div>
      <div v-if="note.project" class="li-meta">
        <ProjektBezug :name="note.project" :nummer="note.projektnummer" />
      </div>
    </button>

    <div v-if="filtered.length === 0" class="empty-state">
      <template v-if="search">
        <div class="empty-icon"><BIcon name="search" :size="24" /></div>
        <p class="empty-title">Keine Treffer</p>
        <p class="empty-sub">Keine Notizen für „{{ search }}"</p>
      </template>
      <template v-else>
        <div class="empty-icon"><BIcon name="pencil" :size="24" /></div>
        <p class="empty-title">Noch keine Notizen</p>
        <p class="empty-sub">Lege deine erste Notiz an um loszulegen.</p>
        <button class="empty-cta" @click="createNote">+ Erste Notiz</button>
      </template>
    </div>
  </ListPane>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  text-align: center;
  color: var(--fg-muted);
}
</style>
