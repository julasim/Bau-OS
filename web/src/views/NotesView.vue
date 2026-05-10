<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import { useEvents } from "../composables/useEvents";
import BIcon from "../components/BIcon.vue";

interface NoteSummary {
  title: string;
  project: string | null;
  createdAt: string;
  updatedAt: string;
  size: number;
}

const router = useRouter();
const notes = ref<NoteSummary[]>([]);
const newContent = ref("");
const searchQuery = ref("");
const showCreate = ref(false);
const viewMode = ref<"list" | "grid">("list");
const sortBy = ref<"updatedAt" | "title" | "size">("updatedAt");
const sortAsc = ref(false);

// ── Vorlagen (Phase 6c) ────────────────────────────────────────────────────
// User waehlt eine Vorlage → Backend rendert sie mit Live-Daten
// (Datum, Branding, Projekt) → Body wird vorbefuellt.
interface NoteTemplateSummary {
  id: string;
  kind: string;
  name: string;
  isDefault: boolean;
}
const noteTemplates = ref<NoteTemplateSummary[]>([]);
const selectedTemplateId = ref<string>("");

async function loadNoteTemplates() {
  try {
    noteTemplates.value = await api.get<NoteTemplateSummary[]>("/templates?kind=note");
  } catch {
    noteTemplates.value = [];
  }
}

async function applyNoteTemplate() {
  if (!selectedTemplateId.value) return;
  try {
    const res = await api.get<{ rendered: string }>(`/templates/${selectedTemplateId.value}/render`);
    newContent.value = res.rendered;
  } catch {
    /* fail silently */
  }
}

const filtered = computed(() => {
  let result = notes.value;
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter((n) => n.title.toLowerCase().includes(q) || n.project?.toLowerCase().includes(q));
  }
  return result.sort((a, b) => {
    let cmp = 0;
    if (sortBy.value === "title") cmp = a.title.localeCompare(b.title);
    else if (sortBy.value === "updatedAt") cmp = a.updatedAt.localeCompare(b.updatedAt);
    else if (sortBy.value === "size") cmp = a.size - b.size;
    return sortAsc.value ? cmp : -cmp;
  });
});

async function load() {
  try {
    notes.value = await api.get<NoteSummary[]>("/notes?detailed=1");
  } catch {
    // Fallback: alte API gibt nur strings zurueck
    const names = await api.get<string[]>("/notes");
    notes.value = names.map((n) => ({ title: n, project: null, createdAt: "", updatedAt: "", size: 0 }));
  }
}

async function create() {
  if (!newContent.value.trim()) return;
  await api.post("/notes", { content: newContent.value });
  newContent.value = "";
  showCreate.value = false;
  await load();
}

async function remove(name: string) {
  if (!confirm(`Notiz "${name}" wirklich loeschen?`)) return;
  await api.delete(`/notes/${encodeURIComponent(name)}`);
  await load();
}

function formatDate(iso: string) {
  if (!iso) return "–";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })
  );
}

function formatSize(bytes: number) {
  if (!bytes) return "–";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function relativeTime(iso: string) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins} Min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `vor ${hrs} Std`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `vor ${days} Tagen`;
  return formatDate(iso);
}

function toggleSort(col: typeof sortBy.value) {
  if (sortBy.value === col) sortAsc.value = !sortAsc.value;
  else {
    sortBy.value = col;
    sortAsc.value = col === "title";
  }
}

function sortIcon(col: string) {
  if (sortBy.value !== col) return "";
  return sortAsc.value ? "\u25B2" : "\u25BC";
}

onMounted(() => {
  void load();
  void loadNoteTemplates();
});
useEvents(["note"], () => load());
</script>

<template>
  <div style="padding: 24px 32px 32px; color: var(--color-text)">
    <!-- Header -->
    <div class="flex items-end justify-between gap-4" style="margin-bottom: 20px">
      <div class="min-w-0">
        <div class="eyebrow" style="margin-bottom: 6px">Inhalte</div>
        <h1 style="font-size: 24px; font-weight: 600; margin: 0; letter-spacing: -0.01em">Notizen</h1>
        <p style="font-size: 13px; color: var(--color-text-muted); margin-top: 4px">
          {{ notes.length }} Notizen im Workspace
        </p>
      </div>
      <div class="flex items-center" style="gap: 8px">
        <button @click="viewMode = viewMode === 'list' ? 'grid' : 'list'" class="bauos-btn ghost">
          <BIcon :name="viewMode === 'list' ? 'grid' : 'list'" :size="14" />
          {{ viewMode === "list" ? "Kacheln" : "Liste" }}
        </button>
        <button @click="showCreate = !showCreate" class="bauos-btn solid">
          <BIcon name="plus" :size="14" :stroke-width="2" />
          {{ showCreate ? "Abbrechen" : "Neue Notiz" }}
        </button>
      </div>
    </div>

    <!-- Create -->
    <div v-if="showCreate" class="form-card">
      <!-- Vorlage waehlen (optional) — Backend rendert mit Live-Daten -->
      <div v-if="noteTemplates.length > 0" class="flex items-center" style="gap: 8px; margin-bottom: 10px">
        <span class="text-xs" style="color: var(--color-text-muted); flex-shrink: 0"> Vorlage: </span>
        <select
          v-model="selectedTemplateId"
          @change="applyNoteTemplate"
          class="form-input"
          style="flex: 1; padding: 4px 8px; font-size: 12px"
        >
          <option value="">— keine —</option>
          <option v-for="t in noteTemplates" :key="t.id" :value="t.id">
            {{ t.name }}{{ t.isDefault ? " (Standard)" : "" }}
          </option>
        </select>
      </div>
      <textarea
        v-model="newContent"
        placeholder="Markdown-Inhalt…"
        rows="10"
        class="form-input font-mono"
        style="resize: vertical; margin-bottom: 12px"
      />
      <button @click="create" class="bauos-btn solid">Speichern</button>
    </div>

    <!-- Search + Count -->
    <div class="flex items-center" style="gap: 12px; margin-bottom: 16px">
      <div
        class="flex items-center"
        style="
          flex: 1;
          gap: 8px;
          padding: 6px 12px;
          border: 1px solid var(--color-border);
          border-radius: 6px;
          background: var(--color-bg);
        "
      >
        <BIcon name="search" :size="14" style="color: var(--color-text-muted)" />
        <input
          v-model="searchQuery"
          placeholder="Notizen filtern…"
          style="
            flex: 1;
            border: none;
            outline: none;
            background: transparent;
            font-size: 13px;
            color: var(--color-text);
          "
        />
      </div>
      <span style="font-size: 11px; color: var(--color-text-tertiary); flex-shrink: 0">
        {{ filtered.length }} von {{ notes.length }}
      </span>
    </div>

    <!-- Grid View -->
    <div v-if="viewMode === 'grid'" class="grid" style="grid-template-columns: repeat(3, 1fr); gap: 12px">
      <div
        v-for="note in filtered"
        :key="note.title"
        @click="router.push(`/notes/${encodeURIComponent(note.title)}`)"
        class="note-card"
      >
        <div class="flex items-start justify-between" style="margin-bottom: 10px">
          <BIcon name="file" :size="18" style="color: var(--color-text-muted)" />
          <button @click.stop="remove(note.title)" class="note-del-btn" aria-label="Löschen">
            <BIcon name="x" :size="12" />
          </button>
        </div>
        <div style="font-size: 13px; font-weight: 500; color: var(--color-text); margin-bottom: 4px" class="truncate">
          {{ note.title }}
        </div>
        <div class="flex items-center flex-wrap" style="gap: 6px; font-size: 11px; color: var(--color-text-tertiary)">
          <span
            v-if="note.project"
            style="
              background: var(--color-border-subtle);
              padding: 1px 6px;
              border-radius: 3px;
              color: var(--color-text-muted);
            "
            >{{ note.project }}</span
          >
          <span>{{ relativeTime(note.updatedAt) }}</span>
          <span class="font-mono">{{ formatSize(note.size) }}</span>
        </div>
      </div>
      <div v-if="filtered.length === 0" class="empty-state" style="grid-column: 1 / -1">
        <div class="empty-state-icon">📝</div>
        <div class="empty-state-text">
          {{ searchQuery ? "Keine Treffer." : "Noch keine Notizen." }}
        </div>
        <button v-if="!searchQuery" class="bauos-btn solid sm" @click="showCreate = true">
          <BIcon name="plus" :size="11" :stroke-width="2" />
          Erste Notiz anlegen
        </button>
      </div>
    </div>

    <!-- List View -->
    <div v-else style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
      <!-- Header -->
      <div
        class="flex items-center"
        style="
          gap: 12px;
          padding: 10px 16px;
          background: var(--color-bg-subtle);
          border-bottom: 1px solid var(--color-border);
        "
      >
        <span style="width: 14px" />
        <button
          @click="toggleSort('title')"
          class="eyebrow flex-1"
          style="text-align: left; background: transparent; border: none; cursor: pointer"
        >
          Name {{ sortIcon("title") }}
        </button>
        <span class="eyebrow" style="width: 120px">Projekt</span>
        <button
          @click="toggleSort('size')"
          class="eyebrow"
          style="width: 70px; text-align: right; background: transparent; border: none; cursor: pointer"
        >
          Größe {{ sortIcon("size") }}
        </button>
        <button
          @click="toggleSort('updatedAt')"
          class="eyebrow"
          style="width: 130px; text-align: right; background: transparent; border: none; cursor: pointer"
        >
          Geändert {{ sortIcon("updatedAt") }}
        </button>
        <span style="width: 20px" />
      </div>
      <div
        v-for="note in filtered"
        :key="note.title"
        class="note-row flex items-center"
        style="gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle)"
        @click="router.push(`/notes/${encodeURIComponent(note.title)}`)"
      >
        <BIcon name="file" :size="14" style="color: var(--color-text-muted); flex-shrink: 0" />
        <span style="flex: 1; font-size: 13px; color: var(--color-text-secondary)" class="truncate">
          {{ note.title }}
        </span>
        <span style="width: 120px" class="truncate">
          <span
            v-if="note.project"
            style="
              background: var(--color-border-subtle);
              padding: 2px 8px;
              border-radius: 4px;
              font-size: 11px;
              color: var(--color-text-muted);
            "
            >{{ note.project }}</span
          >
          <span v-else style="font-size: 11px; color: var(--color-text-faint)">—</span>
        </span>
        <span class="font-mono" style="width: 70px; font-size: 11px; color: var(--color-text-muted); text-align: right">
          {{ formatSize(note.size) }}
        </span>
        <span style="width: 130px; font-size: 11px; color: var(--color-text-tertiary); text-align: right">
          {{ formatDate(note.updatedAt) }}
        </span>
        <button @click.stop="remove(note.title)" class="note-del-btn" style="width: 20px" aria-label="Löschen">
          <BIcon name="x" :size="12" />
        </button>
      </div>
      <div v-if="filtered.length === 0" class="empty-state">
        <div class="empty-state-icon">📝</div>
        <div class="empty-state-text">
          {{ searchQuery ? "Keine Treffer." : "Noch keine Notizen." }}
        </div>
        <button v-if="!searchQuery" class="bauos-btn solid sm" @click="showCreate = true">
          <BIcon name="plus" :size="11" :stroke-width="2" />
          Erste Notiz anlegen
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
  background: var(--color-bg);
}
.form-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: var(--color-bg);
  color: var(--color-text);
}

.note-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--color-bg);
  cursor: pointer;
  transition: all 180ms ease;
}
.note-card:hover {
  border-color: var(--color-text-faint);
  background: var(--color-bg-subtle);
}
.note-card .note-del-btn {
  opacity: 0;
}
.note-card:hover .note-del-btn {
  opacity: 1;
}

.note-row {
  cursor: pointer;
  transition: background 180ms ease;
}
.note-row:hover {
  background: var(--color-bg-subtle);
}
.note-row .note-del-btn {
  opacity: 0;
}
.note-row:hover .note-del-btn {
  opacity: 1;
}

.note-del-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-text-faint);
  transition:
    opacity 180ms ease,
    color 180ms ease,
    background 180ms ease;
}
.note-del-btn:hover {
  color: var(--color-danger-text);
  background: var(--color-border-subtle);
}
</style>
