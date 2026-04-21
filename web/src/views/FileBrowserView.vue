<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";

// ── Typen ────────────────────────────────────────────────────────────────────
interface FileEntry {
  id: string;
  name: string;
  type: "file";
  size: number;
  modified: string;
  extension: string;
  project?: string | null;
  analyzed?: boolean;
}

interface ProjectEntry {
  name: string;
}

// ── State ────────────────────────────────────────────────────────────────────
const files = ref<FileEntry[]>([]);
const projects = ref<ProjectEntry[]>([]);
const selectedFilter = ref<string | "">(""); // "" = alle, "__none__" = ohne Projekt, sonst Projektname
const uploadProject = ref<string>(""); // Projekt fuer neuen Upload ("" = ohne)
const loading = ref(false);

// Preview
const fileContent = ref<string | null>(null);
const fileName = ref("");

// Upload / Drag&Drop
const dragging = ref(false);
const uploading = ref(false);
const uploadMsg = ref("");

// Sortierung
const sortBy = ref<"name" | "modified" | "size">("modified");
const sortAsc = ref(false);

const isMarkdown = computed(() => fileName.value.endsWith(".md"));

// ── Liste laden ──────────────────────────────────────────────────────────────
async function loadFiles() {
  loading.value = true;
  try {
    // Backend-Filter nur bei echter Projektwahl; "__none__" filtern wir client-seitig
    const qs = selectedFilter.value && selectedFilter.value !== "__none__"
      ? `?project=${encodeURIComponent(selectedFilter.value)}`
      : "";
    type ApiFile = {
      id?: string;
      name: string;
      type: "file" | "folder";
      size: number;
      modified: string;
      extension: string;
      project?: string | null;
      analyzed?: boolean;
    };
    const raw = await api.get<ApiFile[]>(`/files${qs}`);
    // Nur echte DB-Dateien mit id — Folder aus Filesystem werden ignoriert
    let list = raw
      .filter((f) => f.type === "file" && !!f.id)
      .map((f) => ({
        id: String(f.id),
        name: f.name,
        type: "file" as const,
        size: f.size,
        modified: f.modified,
        extension: f.extension,
        project: f.project ?? null,
        analyzed: f.analyzed,
      }));
    if (selectedFilter.value === "__none__") {
      list = list.filter((f) => !f.project);
    }
    files.value = list;
  } catch {
    files.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadProjects() {
  try {
    projects.value = await api.get<ProjectEntry[]>("/projects");
  } catch {
    projects.value = [];
  }
}

// ── Gruppierung (wenn kein Projekt-Filter aktiv) ────────────────────────────
const sortedFiles = computed(() => {
  const list = [...files.value];
  list.sort((a, b) => {
    let cmp = 0;
    if (sortBy.value === "name") cmp = a.name.localeCompare(b.name);
    else if (sortBy.value === "modified") cmp = a.modified.localeCompare(b.modified);
    else if (sortBy.value === "size") cmp = a.size - b.size;
    return sortAsc.value ? cmp : -cmp;
  });
  return list;
});

const groupedFiles = computed<{ project: string | null; items: FileEntry[] }[]>(() => {
  // Bei aktivem Filter: nur eine Gruppe, kein Projekt-Header noetig
  if (selectedFilter.value) {
    return [{ project: selectedFilter.value === "__none__" ? null : selectedFilter.value, items: sortedFiles.value }];
  }
  // Ohne Filter: nach Projekt gruppieren
  const map = new Map<string | null, FileEntry[]>();
  for (const f of sortedFiles.value) {
    const key = f.project ?? null;
    const arr = map.get(key) || [];
    arr.push(f);
    map.set(key, arr);
  }
  // Projekte zuerst (alphabetisch), dann "ohne Projekt"
  const withProject = Array.from(map.entries())
    .filter(([k]) => k !== null)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const withoutProject = map.get(null);
  const result = withProject.map(([project, items]) => ({ project, items }));
  if (withoutProject && withoutProject.length) result.push({ project: null, items: withoutProject });
  return result;
});

// ── Sortierung ───────────────────────────────────────────────────────────────
function toggleSort(col: "name" | "modified" | "size") {
  if (sortBy.value === col) sortAsc.value = !sortAsc.value;
  else {
    sortBy.value = col;
    sortAsc.value = col === "name"; // Name default aufsteigend, Datum/Size absteigend
  }
}

function sortIcon(col: string) {
  if (sortBy.value !== col) return "";
  return sortAsc.value ? "\u25B2" : "\u25BC";
}

// ── Datei oeffnen / loeschen / downloaden ───────────────────────────────────
async function openFile(entry: FileEntry) {
  try {
    const file = await api.get<{ path: string; content: string; filename: string }>(
      `/files/read?id=${encodeURIComponent(entry.id)}`,
    );
    fileContent.value = file.content;
    fileName.value = file.filename || entry.name;
  } catch {
    fileContent.value = "[Inhalt konnte nicht gelesen werden]";
    fileName.value = entry.name;
  }
}

async function deleteFile(entry: FileEntry) {
  if (!confirm(`Datei "${entry.name}" wirklich loeschen?`)) return;
  try {
    await api.delete("/files", { id: entry.id });
    await loadFiles();
  } catch {
    uploadMsg.value = "Loeschen fehlgeschlagen";
    setTimeout(() => (uploadMsg.value = ""), 3000);
  }
}

function downloadUrl(entry: FileEntry): string {
  // Auth-Token als Query-Param anhaengen — Browser-Download kann keinen
  // Authorization-Header setzen. Die Bau-OS-API akzeptiert beides.
  const token = localStorage.getItem("bau-os-token");
  const base = `/api/files/download?id=${encodeURIComponent(entry.id)}`;
  return token ? `${base}&token=${encodeURIComponent(token)}` : base;
}

// ── Drag & Drop / Upload ─────────────────────────────────────────────────────
function onDragOver(e: DragEvent) { e.preventDefault(); dragging.value = true; }
function onDragLeave() { dragging.value = false; }

async function onDrop(e: DragEvent) {
  e.preventDefault();
  dragging.value = false;
  if (e.dataTransfer?.files?.length) await uploadFiles(e.dataTransfer.files);
}

function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) {
    uploadFiles(input.files);
    input.value = "";
  }
}

async function uploadFiles(fileList: FileList) {
  uploading.value = true;
  uploadMsg.value = "";
  const formData = new FormData();
  if (uploadProject.value) formData.append("project", uploadProject.value);
  for (const file of fileList) formData.append("files", file);

  try {
    const token = localStorage.getItem("bau-os-token");
    const res = await fetch("/api/files/upload", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = await res.json();
    if (data.success) {
      const count = data.uploaded?.length ?? 0;
      uploadMsg.value = `${count} Datei(en) hochgeladen${uploadProject.value ? ` → ${uploadProject.value}` : ""}`;
      await loadFiles();
    } else {
      uploadMsg.value = data.error || "Upload fehlgeschlagen";
    }
  } catch {
    uploadMsg.value = "Upload fehlgeschlagen";
  } finally {
    uploading.value = false;
    setTimeout(() => (uploadMsg.value = ""), 3000);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatSize(bytes: number) {
  if (!bytes) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function fileIcon(ext: string) {
  const map: Record<string, string> = {
    md: "text-blue-500",
    txt: "text-gray-500",
    json: "text-amber-500",
    ts: "text-blue-600",
    js: "text-yellow-500",
    pdf: "text-red-500",
    docx: "text-blue-700",
    doc: "text-blue-700",
    xlsx: "text-green-600",
    xls: "text-green-600",
    csv: "text-green-500",
    png: "text-purple-500",
    jpg: "text-purple-500",
    jpeg: "text-purple-500",
    gif: "text-purple-500",
    svg: "text-purple-400",
    html: "text-orange-500",
    css: "text-blue-400",
    sh: "text-gray-600",
    yml: "text-pink-500",
    yaml: "text-pink-500",
  };
  return map[ext] || "text-gray-400";
}

function projectLabel(name: string | null) {
  return name ?? "Ohne Projekt";
}

// ── Filter wechseln ──────────────────────────────────────────────────────────
async function setFilter(value: string) {
  selectedFilter.value = value;
  fileContent.value = null;
  await loadFiles();
}

// ── Init ─────────────────────────────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([loadFiles(), loadProjects()]);
});
</script>

<template>
  <div
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    style="max-width: 1120px; margin: 0 auto; padding: 28px 32px 48px; position: relative; min-height: 500px; color: var(--color-text)"
  >
    <!-- Header -->
    <div class="flex items-end justify-between flex-wrap" style="gap: 12px; margin-bottom: 20px">
      <div class="min-w-0">
        <div class="eyebrow" style="margin-bottom: 6px">Inhalte</div>
        <h1 style="font-size: 24px; font-weight: 600; margin: 0; letter-spacing: -0.01em">
          Dateien
        </h1>
        <p style="font-size: 13px; color: var(--color-text-muted); margin-top: 4px">
          {{ files.length }} Datei<span v-if="files.length !== 1">en</span>
        </p>
      </div>

      <div class="flex items-center flex-wrap" style="gap: 8px">
        <span
          v-if="uploadMsg"
          style="font-size: 11px; color: var(--color-success-text)"
          >{{ uploadMsg }}</span
        >
        <div class="flex items-center" style="gap: 6px">
          <label class="eyebrow">Anzeigen</label>
          <select
            :value="selectedFilter"
            @change="setFilter(($event.target as HTMLSelectElement).value)"
            style="
              border: 1px solid var(--color-border);
              border-radius: 6px;
              padding: 4px 8px;
              font-size: 12px;
              background: var(--color-bg);
              color: var(--color-text);
              outline: none;
            "
          >
            <option value="">Alle Projekte</option>
            <option v-for="p in projects" :key="p.name" :value="p.name">{{ p.name }}</option>
            <option value="__none__">— Ohne Projekt —</option>
          </select>
        </div>
        <div class="flex items-center" style="gap: 6px">
          <label class="eyebrow">Upload zu</label>
          <select
            v-model="uploadProject"
            style="
              border: 1px solid var(--color-border);
              border-radius: 6px;
              padding: 4px 8px;
              font-size: 12px;
              background: var(--color-bg);
              color: var(--color-text);
              outline: none;
            "
          >
            <option value="">Ohne Projekt</option>
            <option v-for="p in projects" :key="p.name" :value="p.name">{{ p.name }}</option>
          </select>
        </div>
        <label
          style="
            display: inline-flex;
            align-items: center;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            background: var(--color-primary);
            color: var(--color-bg);
            cursor: pointer;
            transition: opacity 180ms ease;
          "
        >
          Hochladen
          <input type="file" multiple style="display: none" @change="onFileInput" />
        </label>
      </div>
    </div>

    <!-- File Preview -->
    <div v-if="fileContent !== null">
      <div class="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          <span class="text-sm font-medium text-gray-700">{{ fileName }}</span>
        </div>
        <button
          @click="fileContent = null"
          class="px-3 py-1 text-sm text-gray-400 hover:text-gray-600 border border-gray-200 rounded transition"
        >
          Schliessen
        </button>
      </div>
      <div v-if="isMarkdown" class="border border-gray-100 rounded-lg p-6 overflow-auto max-h-[600px]">
        <MarkdownRenderer :content="fileContent" />
      </div>
      <pre
        v-else
        class="p-5 border border-gray-100 rounded-lg text-sm font-mono whitespace-pre-wrap overflow-auto max-h-[600px] text-gray-700 bg-gray-50"
        >{{ fileContent }}</pre>
    </div>

    <!-- Explorer View -->
    <div v-else>
      <!-- Spalten-Header -->
      <div
        v-if="files.length > 0"
        class="flex items-center gap-3 px-2 py-1.5 text-[11px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100"
      >
        <span class="w-5"></span>
        <button @click="toggleSort('name')" class="flex-1 text-left hover:text-gray-600 transition">
          Name {{ sortIcon("name") }}
        </button>
        <button @click="toggleSort('size')" class="w-20 text-right hover:text-gray-600 transition">
          Groesse {{ sortIcon("size") }}
        </button>
        <button @click="toggleSort('modified')" class="w-32 text-right hover:text-gray-600 transition">
          Geaendert {{ sortIcon("modified") }}
        </button>
        <span class="w-16"></span>
      </div>

      <!-- Gruppierte Dateiliste -->
      <div v-for="group in groupedFiles" :key="group.project ?? '__none__'" class="mb-4">
        <!-- Projekt-Header nur anzeigen, wenn KEIN Filter aktiv ist
             (sonst redundant mit dem Select oben) -->
        <p
          v-if="!selectedFilter"
          class="mt-4 mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400"
        >
          {{ projectLabel(group.project) }}
          <span class="text-gray-300 font-normal normal-case">· {{ group.items.length }}</span>
        </p>

        <div
          v-for="file in group.items"
          :key="file.id"
          class="flex items-center gap-3 px-2 py-2 rounded hover:bg-gray-50 cursor-pointer transition group"
          @click="openFile(file)"
        >
          <svg
            :class="fileIcon(file.extension)"
            class="w-5 h-5 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          <div class="flex-1 min-w-0">
            <span class="text-sm text-gray-700 truncate block">{{ file.name }}</span>
          </div>
          <span class="text-[11px] text-gray-400 w-20 text-right font-mono">{{ formatSize(file.size) }}</span>
          <span class="text-[11px] text-gray-400 w-32 text-right">{{ formatDate(file.modified) }}</span>

          <!-- Aktionen -->
          <div class="flex items-center gap-2 w-16 justify-end">
            <a
              :href="downloadUrl(file)"
              @click.stop
              class="text-gray-300 hover:text-gray-900 opacity-0 group-hover:opacity-100 transition"
              title="Download"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
            </a>
            <button
              @click.stop="deleteFile(file)"
              class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
              title="Loeschen"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <p v-if="files.length === 0 && !loading && !uploading" class="text-gray-400 text-sm py-12 text-center">
        <span v-if="selectedFilter === '__none__'">Keine Dateien ohne Projekt-Zuordnung.</span>
        <span v-else-if="selectedFilter">Keine Dateien im Projekt „{{ selectedFilter }}".</span>
        <span v-else>Noch keine Dateien. Drag &amp; Drop oder „Hochladen" nutzen.</span>
      </p>

      <!-- Loading -->
      <p v-if="loading" class="text-gray-400 text-sm py-8 text-center">Laedt...</p>
    </div>

    <!-- Drop Overlay -->
    <div
      v-if="dragging"
      class="absolute inset-0 bg-blue-50/80 border-2 border-dashed border-blue-300 rounded-lg flex flex-col items-center justify-center z-10 pointer-events-none"
    >
      <svg
        class="w-10 h-10 text-blue-400 mb-2"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M16 7l-4-4-4 4M12 3v12" />
      </svg>
      <p class="text-blue-500 font-medium">
        Dateien hier ablegen<span v-if="uploadProject"> &rarr; {{ uploadProject }}</span>
      </p>
    </div>

    <!-- Upload Spinner -->
    <div v-if="uploading" class="flex items-center gap-2 mt-4 text-sm text-gray-500">
      <span class="animate-spin inline-block w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full"></span>
      Wird hochgeladen...
    </div>
  </div>
</template>
