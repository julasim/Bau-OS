<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";

interface FolderEntry {
  name: string;
  type: "folder" | "file";
  size: number;
  modified: string;
  extension: string;
  id?: string;
  project?: string;
  analyzed?: boolean;
}

const currentPath = ref("");
const items = ref<FolderEntry[]>([]);
const fileContent = ref<string | null>(null);
const fileName = ref("");
const dragging = ref(false);
const uploading = ref(false);
const uploadMsg = ref("");
const showNewFolder = ref(false);
const newFolderName = ref("");
const sortBy = ref<"name" | "modified" | "size">("name");
const sortAsc = ref(true);
const viewMode = ref<"list" | "grid">("list");

const isMarkdown = computed(() => fileName.value.endsWith(".md"));

const folders = computed(() => items.value.filter((i) => i.type === "folder"));
const files = computed(() => {
  const f = items.value.filter((i) => i.type === "file");
  return f.sort((a, b) => {
    let cmp = 0;
    if (sortBy.value === "name") cmp = a.name.localeCompare(b.name);
    else if (sortBy.value === "modified") cmp = a.modified.localeCompare(b.modified);
    else if (sortBy.value === "size") cmp = a.size - b.size;
    return sortAsc.value ? cmp : -cmp;
  });
});

const breadcrumbs = computed(() => {
  const parts = currentPath.value.split("/").filter(Boolean);
  const crumbs = [{ label: "Dateien", path: "" }];
  let acc = "";
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p;
    crumbs.push({ label: p, path: acc });
  }
  return crumbs;
});

function toggleSort(col: "name" | "modified" | "size") {
  if (sortBy.value === col) sortAsc.value = !sortAsc.value;
  else { sortBy.value = col; sortAsc.value = true; }
}

function sortIcon(col: string) {
  if (sortBy.value !== col) return "";
  return sortAsc.value ? "\u25B2" : "\u25BC";
}

async function loadFolder(p = "") {
  currentPath.value = p;
  fileContent.value = null;
  items.value = await api.get<FolderEntry[]>(`/files?path=${encodeURIComponent(p)}`);
}

async function openItem(entry: FolderEntry) {
  if (entry.type === "folder") {
    const fullPath = currentPath.value ? `${currentPath.value}/${entry.name}` : entry.name;
    await loadFolder(fullPath);
  } else if (entry.id) {
    // DB-Datei: ueber ID lesen
    const file = await api.get<{ path: string; content: string; filename: string }>(`/files/read?id=${entry.id}`);
    fileContent.value = file.content;
    fileName.value = file.filename || entry.name;
  } else {
    const fullPath = currentPath.value ? `${currentPath.value}/${entry.name}` : entry.name;
    const file = await api.get<{ path: string; content: string }>(`/files/read?path=${encodeURIComponent(fullPath)}`);
    fileContent.value = file.content;
    fileName.value = entry.name;
  }
}

async function createFolder() {
  if (!newFolderName.value.trim()) return;
  const folderPath = currentPath.value ? `${currentPath.value}/${newFolderName.value}` : newFolderName.value;
  await api.post("/files/mkdir", { path: folderPath });
  newFolderName.value = "";
  showNewFolder.value = false;
  await loadFolder(currentPath.value);
}

async function deleteItem(entry: FolderEntry) {
  const label = entry.type === "folder" ? `Ordner "${entry.name}" und alle Inhalte` : `"${entry.name}"`;
  if (!confirm(`${label} wirklich loeschen?`)) return;
  if (entry.id) {
    await api.delete("/files", { id: entry.id });
  } else {
    const fullPath = currentPath.value ? `${currentPath.value}/${entry.name}` : entry.name;
    await api.delete("/files", { path: fullPath });
  }
  await loadFolder(currentPath.value);
}

// ── Drag & Drop ─────────────────────────────────────────────────────────────
function onDragOver(e: DragEvent) { e.preventDefault(); dragging.value = true; }
function onDragLeave() { dragging.value = false; }

async function onDrop(e: DragEvent) {
  e.preventDefault();
  dragging.value = false;
  if (e.dataTransfer?.files?.length) await uploadFiles(e.dataTransfer.files);
}

function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) { uploadFiles(input.files); input.value = ""; }
}

async function uploadFiles(fileList: FileList) {
  uploading.value = true;
  uploadMsg.value = "";
  const formData = new FormData();
  formData.append("path", currentPath.value);
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
      uploadMsg.value = `${data.uploaded.length} Datei(en) hochgeladen`;
      await loadFolder(currentPath.value);
    } else {
      uploadMsg.value = data.error || "Upload fehlgeschlagen";
    }
  } catch { uploadMsg.value = "Upload fehlgeschlagen"; }
  finally { uploading.value = false; setTimeout(() => (uploadMsg.value = ""), 3000); }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatSize(bytes: number) {
  if (bytes === 0) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}

function fileIcon(ext: string) {
  const map: Record<string, string> = {
    md: "text-blue-500", txt: "text-gray-500", json: "text-amber-500", ts: "text-blue-600",
    js: "text-yellow-500", pdf: "text-red-500", docx: "text-blue-700", doc: "text-blue-700",
    xlsx: "text-green-600", xls: "text-green-600", csv: "text-green-500",
    png: "text-purple-500", jpg: "text-purple-500", jpeg: "text-purple-500", gif: "text-purple-500", svg: "text-purple-400",
    html: "text-orange-500", css: "text-blue-400", sh: "text-gray-600", yml: "text-pink-500", yaml: "text-pink-500",
  };
  return map[ext] || "text-gray-400";
}

onMounted(() => loadFolder());
</script>

<template>
  <div
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    class="min-h-[500px] relative"
  >
    <!-- Toolbar -->
    <div class="flex items-center justify-between mb-1">
      <h2 class="text-xl font-semibold">Dateien</h2>
      <div class="flex items-center gap-2">
        <span v-if="uploadMsg" class="text-xs text-green-600">{{ uploadMsg }}</span>
        <!-- View Toggle -->
        <button @click="viewMode = viewMode === 'list' ? 'grid' : 'list'" class="p-1.5 rounded hover:bg-gray-100 transition" title="Ansicht wechseln">
          <svg v-if="viewMode === 'list'" class="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          <svg v-else class="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
        </button>
        <button @click="showNewFolder = !showNewFolder" class="px-3 py-1.5 text-sm border border-gray-200 rounded text-gray-600 hover:bg-gray-50 transition">Neuer Ordner</button>
        <label class="px-3 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 cursor-pointer transition">
          Hochladen
          <input type="file" multiple class="hidden" @change="onFileInput" />
        </label>
      </div>
    </div>

    <!-- Breadcrumb -->
    <div class="flex items-center gap-1 mb-4 text-sm py-2 border-b border-gray-100">
      <template v-for="(crumb, i) in breadcrumbs" :key="crumb.path">
        <span v-if="i > 0" class="text-gray-300">/</span>
        <button
          @click="loadFolder(crumb.path)"
          :class="i === breadcrumbs.length - 1 ? 'text-gray-900 font-medium' : 'text-gray-400 hover:text-gray-600'"
          class="transition px-1"
        >{{ crumb.label }}</button>
      </template>
    </div>

    <!-- New Folder Input -->
    <div v-if="showNewFolder" class="flex gap-2 mb-4">
      <input v-model="newFolderName" placeholder="Ordnername..." @keyup.enter="createFolder" class="flex-1 px-3 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400" autofocus />
      <button @click="createFolder" class="px-3 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">Erstellen</button>
      <button @click="showNewFolder = false; newFolderName = ''" class="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600 transition">Abbrechen</button>
    </div>

    <!-- File Preview -->
    <div v-if="fileContent !== null">
      <div class="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
          <span class="text-sm font-medium text-gray-700">{{ fileName }}</span>
        </div>
        <button @click="fileContent = null" class="px-3 py-1 text-sm text-gray-400 hover:text-gray-600 border border-gray-200 rounded transition">Schliessen</button>
      </div>
      <div v-if="isMarkdown" class="border border-gray-100 rounded-lg p-6 overflow-auto max-h-[600px]">
        <MarkdownRenderer :content="fileContent" />
      </div>
      <pre v-else class="p-5 border border-gray-100 rounded-lg text-sm font-mono whitespace-pre-wrap overflow-auto max-h-[600px] text-gray-700 bg-gray-50">{{ fileContent }}</pre>
    </div>

    <!-- Explorer View -->
    <div v-else>
      <!-- Folders Grid -->
      <div v-if="folders.length > 0" class="mb-6">
        <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Ordner</p>
        <div :class="viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2' : 'space-y-0'">
          <!-- Grid view -->
          <template v-if="viewMode === 'grid'">
            <div
              v-for="folder in folders"
              :key="folder.name"
              @click="openItem(folder)"
              class="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-100 hover:border-gray-300 hover:bg-gray-50 cursor-pointer transition group"
            >
              <svg class="w-8 h-8 text-amber-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/></svg>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-gray-700 truncate">{{ folder.name }}</p>
                <p class="text-[11px] text-gray-400">{{ formatDate(folder.modified) }}</p>
              </div>
              <button @click.stop="deleteItem(folder)" class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          </template>
          <!-- List view folders -->
          <template v-else>
            <div
              v-for="folder in folders"
              :key="folder.name"
              @click="openItem(folder)"
              class="flex items-center gap-3 px-2 py-2 rounded hover:bg-gray-50 cursor-pointer transition group"
            >
              <svg class="w-5 h-5 text-amber-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/></svg>
              <span class="text-sm text-gray-700 flex-1 truncate">{{ folder.name }}</span>
              <span class="text-[11px] text-gray-400 w-28 text-right">{{ formatDate(folder.modified) }}</span>
              <button @click.stop="deleteItem(folder)" class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition ml-2">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          </template>
        </div>
      </div>

      <!-- Files Table -->
      <div v-if="files.length > 0">
        <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Dateien</p>
        <!-- Column Headers -->
        <div class="flex items-center gap-3 px-2 py-1.5 text-[11px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
          <button @click="toggleSort('name')" class="flex-1 text-left hover:text-gray-600 transition">Name {{ sortIcon("name") }}</button>
          <button @click="toggleSort('size')" class="w-20 text-right hover:text-gray-600 transition">Groesse {{ sortIcon("size") }}</button>
          <button @click="toggleSort('modified')" class="w-32 text-right hover:text-gray-600 transition">Geaendert {{ sortIcon("modified") }}</button>
          <span class="w-6"></span>
        </div>
        <!-- File Rows -->
        <div
          v-for="file in files"
          :key="file.name"
          @click="openItem(file)"
          class="flex items-center gap-3 px-2 py-2 rounded hover:bg-gray-50 cursor-pointer transition group"
        >
          <!-- File Icon -->
          <svg :class="fileIcon(file.extension)" class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
          <div class="flex-1 min-w-0">
            <span class="text-sm text-gray-700 truncate block">{{ file.name }}</span>
          </div>
          <span class="text-[11px] text-gray-400 w-20 text-right font-mono">{{ formatSize(file.size) }}</span>
          <span class="text-[11px] text-gray-400 w-32 text-right">{{ formatDate(file.modified) }}</span>
          <button @click.stop="deleteItem(file)" class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <!-- Empty state -->
      <p v-if="items.length === 0 && !uploading" class="text-gray-400 text-sm py-8 text-center">
        Ordner ist leer. Dateien per Drag & Drop oder "Hochladen" hinzufuegen.
      </p>
    </div>

    <!-- Drop Overlay -->
    <div
      v-if="dragging"
      class="absolute inset-0 bg-blue-50/80 border-2 border-dashed border-blue-300 rounded-lg flex flex-col items-center justify-center z-10"
    >
      <svg class="w-10 h-10 text-blue-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M16 7l-4-4-4 4M12 3v12"/></svg>
      <p class="text-blue-500 font-medium">Dateien hier ablegen</p>
    </div>

    <!-- Upload Spinner -->
    <div v-if="uploading" class="flex items-center gap-2 mt-4 text-sm text-gray-500">
      <span class="animate-spin inline-block w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full"></span>
      Wird hochgeladen...
    </div>
  </div>
</template>
