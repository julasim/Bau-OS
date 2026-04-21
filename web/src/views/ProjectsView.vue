<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";

interface ProjectInfo {
  name: string;
  description?: string | null;
  status?: string;
  color?: string | null;
  notes: number;
  openTasks: number;
  termine: number;
  createdAt?: string;
  updatedAt?: string;
}

const router = useRouter();
const projects = ref<ProjectInfo[]>([]);
const searchQuery = ref("");
const viewMode = ref<"grid" | "list">("grid");

const filtered = computed(() => {
  if (!searchQuery.value) return projects.value;
  const q = searchQuery.value.toLowerCase();
  return projects.value.filter((p) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q));
});

function formatDate(iso?: string) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function relativeTime(iso?: string) {
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

function statusLabel(s?: string) {
  if (!s) return "";
  const map: Record<string, string> = { aktiv: "Aktiv", archiviert: "Archiviert", pausiert: "Pausiert" };
  return map[s] || s;
}

function statusColor(s?: string) {
  const map: Record<string, string> = { aktiv: "bg-green-50 text-green-700", archiviert: "bg-gray-100 text-gray-500", pausiert: "bg-amber-50 text-amber-700" };
  return map[s || ""] || "bg-gray-100 text-gray-500";
}

function totalItems(p: ProjectInfo) {
  return p.notes + p.openTasks + p.termine;
}

onMounted(async () => {
  projects.value = await api.get<ProjectInfo[]>("/projects");
});
</script>

<template>
  <div style="max-width: 1120px; margin: 0 auto; padding: 28px 32px 48px; color: var(--color-text)">
    <!-- Header -->
    <div class="flex items-end justify-between gap-4" style="margin-bottom: 20px">
      <div class="min-w-0">
        <div class="eyebrow" style="margin-bottom: 6px">Arbeit</div>
        <h1 style="font-size: 24px; font-weight: 600; margin: 0; letter-spacing: -0.01em">Projekte</h1>
        <p style="font-size: 13px; color: var(--color-text-muted); margin-top: 4px">
          {{ projects.length }} Projekte
        </p>
      </div>
      <button @click="viewMode = viewMode === 'grid' ? 'list' : 'grid'" class="bauos-btn ghost">
        <BIcon :name="viewMode === 'grid' ? 'list' : 'grid'" :size="14" />
        {{ viewMode === "grid" ? "Liste" : "Kacheln" }}
      </button>
    </div>

    <!-- Search -->
    <div v-if="projects.length > 3" style="margin-bottom: 16px">
      <div
        class="flex items-center"
        style="
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
          placeholder="Projekte filtern…"
          style="
            flex: 1;
            border: none;
            outline: none;
            background: transparent;
            font-size: 13px;
            color: var(--color-text);
          "
        />
        <span style="font-size: 11px; color: var(--color-text-tertiary)">
          {{ filtered.length }} / {{ projects.length }}
        </span>
      </div>
    </div>

    <!-- Grid -->
    <div v-if="viewMode === 'grid'" class="grid" style="grid-template-columns: repeat(3, 1fr); gap: 12px">
      <div
        v-for="p in filtered"
        :key="p.name"
        @click="router.push(`/projects/${encodeURIComponent(p.name)}`)"
        class="proj-card"
      >
        <div class="flex items-center justify-between" style="margin-bottom: 10px">
          <span
            v-if="p.status"
            :class="['pill', `pill-${p.status}`]"
            style="font-size: 10px"
            >{{ statusLabel(p.status) }}</span
          >
          <span
            v-if="p.updatedAt"
            class="font-mono"
            style="font-size: 10px; color: var(--color-text-tertiary)"
            >{{ relativeTime(p.updatedAt) }}</span
          >
        </div>
        <div style="font-size: 15px; font-weight: 600; color: var(--color-text); margin-bottom: 4px">
          {{ p.name }}
        </div>
        <p
          v-if="p.description"
          style="
            font-size: 12px;
            color: var(--color-text-muted);
            line-height: 1.5;
            margin: 0 0 12px 0;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            min-height: 36px;
          "
        >
          {{ p.description }}
        </p>
        <div v-else style="min-height: 36px; margin-bottom: 12px"></div>
        <div
          class="flex items-center"
          style="gap: 12px; font-size: 11px; color: var(--color-text-muted)"
        >
          <span>{{ p.notes }} Notizen</span>
          <span :style="{ color: p.openTasks > 0 ? 'var(--color-warning-text)' : 'inherit' }">
            {{ p.openTasks }} Aufgaben
          </span>
          <span>{{ p.termine }} Termine</span>
        </div>
      </div>
      <p
        v-if="filtered.length === 0"
        style="
          grid-column: 1 / -1;
          font-size: 13px;
          color: var(--color-text-tertiary);
          text-align: center;
          padding: 32px 0;
        "
      >
        {{ searchQuery ? "Keine Treffer." : "Keine Projekte vorhanden." }}
      </p>
    </div>

    <!-- List -->
    <div v-else style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
      <div
        class="flex items-center"
        style="
          gap: 12px;
          padding: 10px 16px;
          background: var(--color-bg-subtle);
          border-bottom: 1px solid var(--color-border);
        "
      >
        <span class="eyebrow flex-1">Projekt</span>
        <span class="eyebrow" style="width: 80px">Status</span>
        <span class="eyebrow" style="width: 60px; text-align: center">Notizen</span>
        <span class="eyebrow" style="width: 60px; text-align: center">Aufgaben</span>
        <span class="eyebrow" style="width: 60px; text-align: center">Termine</span>
        <span class="eyebrow" style="width: 90px; text-align: right">Geändert</span>
      </div>
      <div
        v-for="p in filtered"
        :key="p.name"
        class="proj-row flex items-center"
        style="gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle)"
        @click="router.push(`/projects/${encodeURIComponent(p.name)}`)"
      >
        <div class="flex-1 min-w-0 flex items-center" style="gap: 8px">
          <BIcon name="folder" :size="14" style="color: var(--color-text-muted); flex-shrink: 0" />
          <span style="font-size: 13px; color: var(--color-text)" class="truncate">{{ p.name }}</span>
        </div>
        <div style="width: 80px">
          <span
            v-if="p.status"
            :class="['pill', `pill-${p.status}`]"
            style="font-size: 10px"
            >{{ statusLabel(p.status) }}</span
          >
        </div>
        <span style="width: 60px; text-align: center; font-size: 11px; color: var(--color-text-muted)">
          {{ p.notes }}
        </span>
        <span
          style="width: 60px; text-align: center; font-size: 11px"
          :style="{ color: p.openTasks > 0 ? 'var(--color-warning-text)' : 'var(--color-text-muted)' }"
        >
          {{ p.openTasks }}
        </span>
        <span style="width: 60px; text-align: center; font-size: 11px; color: var(--color-text-muted)">
          {{ p.termine }}
        </span>
        <span
          class="font-mono"
          style="width: 90px; text-align: right; font-size: 11px; color: var(--color-text-tertiary)"
        >
          {{ formatDate(p.updatedAt) }}
        </span>
      </div>
      <p
        v-if="filtered.length === 0"
        style="font-size: 13px; color: var(--color-text-tertiary); text-align: center; padding: 32px 0"
      >
        {{ searchQuery ? "Keine Treffer." : "Keine Projekte vorhanden." }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.bauos-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-secondary);
  transition: all 180ms ease;
}
.bauos-btn.ghost:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.proj-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  background: var(--color-bg);
  cursor: pointer;
  transition: all 180ms ease;
}
.proj-card:hover {
  border-color: var(--color-text-faint);
  background: var(--color-bg-subtle);
}
.proj-row {
  cursor: pointer;
  transition: background 180ms ease;
}
.proj-row:hover {
  background: var(--color-bg-subtle);
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border: 1px solid transparent;
}
.pill-aktiv {
  background: var(--color-success-bg);
  color: var(--color-success-text);
  border-color: var(--color-success-border);
}
.pill-pausiert {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
  border-color: var(--color-warning-border);
}
.pill-archiviert {
  background: var(--color-border-subtle);
  color: var(--color-text-muted);
  border-color: var(--color-border);
}
</style>
