<script setup lang="ts">
// ============================================================
// Bau-OS — Dateien (3-Pane File-Explorer, Bau-OS-Stil)
// ============================================================
// Layout (Spec aus design_handoff_files/README.md):
//   ┌──────────── Toolbar (64px) ─────────────┐
//   │  Sidebar (220px) │ Browser │ Preview    │
//   │                  │         │ (300px)    │
//   │                  │ Status (26px)        │
//   └──────────────────┴──────────────────────┘
//
// Drei View-Modes:
//   - Spalten (Miller): horizontal scrollende Spalten, jede zeigt
//     Inhalte einer Pfad-Tiefe. Click auf Folder = neue Spalte rechts.
//   - Liste: 4-Spalten-Grid (Name/Geändert/Größe/Art).
//   - Symbole: Auto-Fill-Grid mit grossen Icons.
//
// Datenmodell:
//   Backend liefert flache File-Liste mit optionalem `project`-Feld.
//   Wir bauen client-side eine Tree-Struktur:
//     Root
//       ├── Projekte/
//       │     └── <project>/
//       │           └── files...
//       └── Privat/
//             └── files (project IS NULL)
//   Sidebar HIERARCHIE-Eintrag "Projekte"/"Privat" ist ein Shortcut
//   in path[0]. Der Rest der Sidebar (Markiert/Geteilt/...) ist im
//   Design vorgesehen, aktuell aber nicht datengestuetzt → disabled.
// ============================================================

import { ref, computed, onMounted, watch } from "vue";
import { api } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";
import FileGlyph from "../components/FileGlyph.vue";

// ── Typen ────────────────────────────────────────────────────────────────────
type FileKind = "root" | "folder" | "pdf" | "dwg" | "image" | "doc" | "csv" | "archive" | "code" | "other";

interface FileNode {
  name: string;
  kind: FileKind;
  /** Original-Datei-ID (nur fuer kind != folder/root) */
  id?: string;
  /** ISO oder human-readable */
  updated?: string;
  /** Bytes (raw) — formatiert via formatSize() */
  sizeBytes?: number;
  /** Vorformatierte Groesse fuer Anzeige */
  size?: string;
  /** Original-Projekt (fuer Files unter Projekte/) */
  project?: string | null;
  children?: FileNode[];
}

interface ApiFile {
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
const path = ref<string[]>([]);
const selected = ref<{ node: FileNode; columnIndex: number } | null>(null);
const view = ref<"column" | "list" | "icons">("column");
const sidebarOpen = ref(true);
const searchTerm = ref("");

// Auf Mobile: Sidebar startet zugeklappt — Platz fuer den Browser.
if (typeof window !== "undefined" && window.matchMedia("(max-width: 767.98px)").matches) {
  sidebarOpen.value = false;
}

const allFiles = ref<ApiFile[]>([]);
const allProjects = ref<ProjectEntry[]>([]);
const loading = ref(false);

// File-Preview (rechts in der Spalten-Ansicht)
const previewContent = ref<string | null>(null);
const previewFileName = ref<string>("");
const previewLoading = ref(false);

// Upload
const uploading = ref(false);
const uploadMsg = ref("");
const dragging = ref(false);

// ── Daten laden ──────────────────────────────────────────────────────────────
async function loadFiles() {
  loading.value = true;
  try {
    const raw = await api.get<ApiFile[]>("/files");
    allFiles.value = raw.filter((f) => f.type === "file" && !!f.id);
  } catch {
    allFiles.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadProjects() {
  try {
    allProjects.value = await api.get<ProjectEntry[]>("/projects");
  } catch {
    allProjects.value = [];
  }
}

// ── Tree-Aufbau aus flat File-Liste ──────────────────────────────────────────
function extToKind(ext: string): FileKind {
  const e = (ext || "").toLowerCase().replace(/^\./, "");
  if (e === "pdf") return "pdf";
  if (["dwg", "dxf"].includes(e)) return "dwg";
  if (["jpg", "jpeg", "png", "gif", "svg", "webp", "heic"].includes(e)) return "image";
  if (["doc", "docx", "rtf", "odt"].includes(e)) return "doc";
  if (["csv", "xls", "xlsx", "ods"].includes(e)) return "csv";
  if (["zip", "gz", "tar", "7z", "rar"].includes(e)) return "archive";
  if (["md", "json", "yaml", "yml", "ts", "js", "tsx", "jsx", "html", "css", "sh", "txt", "log"].includes(e))
    return "code";
  return "other";
}

function isMonoKind(k: FileKind): boolean {
  return k === "dwg" || k === "csv" || k === "archive" || k === "code";
}

function kindLabel(k: FileKind): string {
  return (
    {
      folder: "Ordner",
      root: "Vault",
      pdf: "PDF",
      dwg: "CAD",
      image: "Bild",
      doc: "Dokument",
      csv: "CSV",
      archive: "Archiv",
      code: "Text",
      other: "Datei",
    } as Record<FileKind, string>
  )[k];
}

const tree = computed<FileNode>(() => {
  // Filter: wenn ein Such-Term aktiv ist, fallen alle Files raus die nicht
  // matchen — das macht die Tree-Sicht zur Such-Sicht. Folder werden nur
  // angezeigt wenn sie min. ein Match enthalten.
  const term = searchTerm.value.trim().toLowerCase();
  const match = (f: ApiFile) =>
    !term || f.name.toLowerCase().includes(term) || (f.project ?? "").toLowerCase().includes(term);

  // Projekte gruppieren
  const byProject = new Map<string, ApiFile[]>();
  const orphan: ApiFile[] = [];
  for (const f of allFiles.value) {
    if (!match(f)) continue;
    if (f.project) {
      const arr = byProject.get(f.project) ?? [];
      arr.push(f);
      byProject.set(f.project, arr);
    } else {
      orphan.push(f);
    }
  }

  function fileToNode(f: ApiFile): FileNode {
    return {
      name: f.name,
      kind: extToKind(f.extension),
      id: f.id,
      updated: humanDate(f.modified),
      sizeBytes: f.size,
      size: formatSize(f.size),
      project: f.project ?? null,
    };
  }

  // Projekt-Folder alphabetisch — auch leere Projekte (kein File aktuell)
  // werden angezeigt, falls `term` leer ist. Mit aktivem Such-Term nur
  // Projekte mit Match.
  const projectNames = new Set<string>();
  for (const p of allProjects.value) projectNames.add(p.name);
  for (const k of byProject.keys()) projectNames.add(k);
  const sortedProjectNames = Array.from(projectNames)
    .filter((name) => (term ? byProject.has(name) : true))
    .sort((a, b) => a.localeCompare(b));

  const projectFolders: FileNode[] = sortedProjectNames.map((name) => ({
    name,
    kind: "folder",
    children: (byProject.get(name) ?? []).map(fileToNode).sort(byNameThenKind),
  }));

  const rootChildren: FileNode[] = [];
  if (projectFolders.length > 0 || !term) {
    rootChildren.push({
      name: "Projekte",
      kind: "folder",
      children: projectFolders,
    });
  }
  if (orphan.length > 0 || !term) {
    rootChildren.push({
      name: "Privat",
      kind: "folder",
      children: orphan.map(fileToNode).sort(byNameThenKind),
    });
  }

  return {
    name: "Vault",
    kind: "root",
    children: rootChildren,
  };
});

function byNameThenKind(a: FileNode, b: FileNode): number {
  // Folder vor File
  if (a.kind === "folder" && b.kind !== "folder") return -1;
  if (a.kind !== "folder" && b.kind === "folder") return 1;
  return a.name.localeCompare(b.name);
}

// ── Browser-Spalten (fuer Spalten-View) ──────────────────────────────────────
interface Column {
  parent: FileNode;
  items: FileNode[];
}

const columns = computed<Column[]>(() => {
  const root = tree.value;
  const cols: Column[] = [{ parent: root, items: root.children ?? [] }];
  let cur: FileNode = root;
  for (const seg of path.value) {
    const next = cur.children?.find((c) => c.name === seg);
    if (!next || !next.children) break;
    cols.push({ parent: next, items: next.children });
    cur = next;
  }
  return cols;
});

const currentFolder = computed<FileNode>(() => {
  let cur: FileNode = tree.value;
  for (const seg of path.value) {
    const next = cur.children?.find((c) => c.name === seg);
    if (!next) break;
    cur = next;
  }
  return cur;
});

const breadcrumb = computed(() => ["Vault", ...path.value]);
const itemCount = computed(() => currentFolder.value.children?.length ?? 0);

// Statusleiste: countObjekte + ggf. Auswahl-Detail
const statusLeft = computed(() => {
  const sel = selected.value?.node;
  if (sel && sel.kind !== "folder") {
    const parts = [sel.name];
    if (sel.size) parts.push(sel.size);
    if (sel.updated) parts.push(sel.updated);
    return parts.join(" · ");
  }
  if (sel && sel.kind === "folder") {
    return `${itemCount.value} Objekte · ${sel.name} ausgewählt`;
  }
  return `${itemCount.value} Objekte`;
});

const statusRight = computed(() => "/" + path.value.join("/"));

// Storage-Anzeige
const totalSizeBytes = computed(() => allFiles.value.reduce((s, f) => s + (f.size || 0), 0));
const totalSizeLabel = computed(() => formatSize(totalSizeBytes.value));
const totalFileCount = computed(() => allFiles.value.length);

// ── Click-Logik ──────────────────────────────────────────────────────────────
function onClickItem(node: FileNode, columnIndex: number) {
  if (node.kind === "folder") {
    path.value = [...path.value.slice(0, columnIndex), node.name];
    selected.value = { node, columnIndex };
    previewContent.value = null;
  } else {
    // Files schliessen Pfad ab — selected bleibt fuer Preview
    path.value = path.value.slice(0, columnIndex);
    selected.value = { node, columnIndex };
    void loadPreview(node);
  }
}

async function loadPreview(node: FileNode) {
  if (!node.id) {
    previewContent.value = null;
    previewFileName.value = node.name;
    return;
  }
  // Nur fuer Text-/Code-/Markdown-Files Inhalte laden — Bilder/PDFs zeigen
  // wir nur als Hero-Glyph. Sonst wuerde ein Klick auf eine 50 MB DWG die
  // ganze UI blockieren.
  const isText = node.kind === "code" || node.kind === "doc" || node.kind === "csv";
  previewFileName.value = node.name;
  if (!isText) {
    previewContent.value = null;
    return;
  }
  previewLoading.value = true;
  try {
    const resp = await api.get<{ content: string; filename: string }>(
      `/files/read?id=${encodeURIComponent(node.id)}`,
    );
    previewContent.value = resp.content ?? "";
  } catch {
    previewContent.value = null;
  } finally {
    previewLoading.value = false;
  }
}

function setSidebarTarget(target: string[] | null) {
  if (!target) return;
  path.value = target;
  selected.value = null;
  previewContent.value = null;
}

function onBreadcrumbClick(i: number) {
  if (i === 0) {
    path.value = [];
  } else {
    path.value = path.value.slice(0, i);
  }
  selected.value = null;
  previewContent.value = null;
}

function onBack() {
  if (path.value.length === 0) return;
  path.value = path.value.slice(0, -1);
  selected.value = null;
  previewContent.value = null;
}

// Reset preview wenn search aktiv wird (sonst bleibt es bei alten files
// hängen, die durch Filter weggefallen sind).
watch(searchTerm, () => {
  selected.value = null;
  previewContent.value = null;
});

// ── Aktionen auf Files ───────────────────────────────────────────────────────
function downloadUrl(node: FileNode): string {
  if (!node.id) return "#";
  const token = localStorage.getItem("bau-os-token");
  const base = `/api/files/download?id=${encodeURIComponent(node.id)}`;
  return token ? `${base}&token=${encodeURIComponent(token)}` : base;
}

async function deleteSelected() {
  const node = selected.value?.node;
  if (!node?.id) return;
  if (!confirm(`Datei "${node.name}" wirklich löschen?`)) return;
  try {
    await api.delete("/files", { id: node.id });
    selected.value = null;
    previewContent.value = null;
    await loadFiles();
  } catch {
    uploadMsg.value = "Löschen fehlgeschlagen";
    setTimeout(() => (uploadMsg.value = ""), 3000);
  }
}

// ── Upload ──────────────────────────────────────────────────────────────────
const fileInputRef = ref<HTMLInputElement | null>(null);

function triggerUpload() {
  fileInputRef.value?.click();
}

function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) {
    void uploadFiles(input.files);
    input.value = "";
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  dragging.value = true;
}

function onDragLeave() {
  dragging.value = false;
}

async function onDrop(e: DragEvent) {
  e.preventDefault();
  dragging.value = false;
  if (e.dataTransfer?.files?.length) await uploadFiles(e.dataTransfer.files);
}

async function uploadFiles(fileList: FileList) {
  uploading.value = true;
  uploadMsg.value = "";
  const formData = new FormData();
  // Wenn der User aktuell in einem Projekt-Folder steht (Projekte/X), Upload
  // automatisch dort einsortieren. Sonst privater Upload.
  const targetProject = path.value[0] === "Projekte" && path.value[1] ? path.value[1] : "";
  if (targetProject) formData.append("project", targetProject);
  for (const file of fileList) formData.append("files", file);

  try {
    const token = localStorage.getItem("bau-os-token");
    const res = await fetch("/api/files/upload", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = (await res.json()) as { success?: boolean; uploaded?: unknown[]; error?: string };
    if (data.success) {
      const count = data.uploaded?.length ?? 0;
      uploadMsg.value = `${count} Datei(en) hochgeladen${targetProject ? ` → ${targetProject}` : ""}`;
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
function formatSize(bytes: number | undefined | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function humanDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `vor ${diffD} Tg`;
  return d.toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function extLabel(kind: FileKind): string {
  return (
    { pdf: "pdf", dwg: "dwg", image: "img", doc: "doc", csv: "csv", archive: "gz", code: "md", other: "file" } as Record<
      FileKind,
      string
    >
  )[kind] ?? "file";
}

const previewIsMarkdown = computed(() => previewFileName.value.toLowerCase().endsWith(".md"));

// ── Init ─────────────────────────────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([loadFiles(), loadProjects()]);
});
</script>

<template>
  <div
    class="files-root"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- ─── Toolbar ─────────────────────────────────────────────── -->
    <header class="files-toolbar">
      <!-- Sidebar-Toggle -->
      <button
        class="files-icon-btn"
        :class="{ 'files-icon-btn-active': sidebarOpen }"
        @click="sidebarOpen = !sidebarOpen"
        title="Seitenleiste"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <line x1="9" y1="4" x2="9" y2="20" />
        </svg>
      </button>

      <!-- Back / Forward -->
      <div class="files-nav-btns">
        <button class="files-icon-btn" :disabled="path.length === 0" @click="onBack" title="Zurück">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button class="files-icon-btn" disabled title="Weiter">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <!-- Breadcrumb -->
      <div class="files-breadcrumb">
        <span class="files-breadcrumb-eyebrow">Pfad</span>
        <template v-for="(seg, i) in breadcrumb" :key="i">
          <span v-if="i > 0" class="files-breadcrumb-sep">/</span>
          <button
            class="files-breadcrumb-seg"
            :class="{ 'files-breadcrumb-seg-active': i === breadcrumb.length - 1 }"
            @click="onBreadcrumbClick(i)"
          >
            {{ seg }}
          </button>
        </template>
      </div>

      <!-- View-Segmented-Control -->
      <div class="files-segmented">
        <button
          v-for="opt in [
            { v: 'column', label: 'Spalten' },
            { v: 'list', label: 'Liste' },
            { v: 'icons', label: 'Symbole' },
          ]"
          :key="opt.v"
          class="files-seg-btn"
          :class="{ 'files-seg-btn-active': view === opt.v }"
          @click="view = opt.v as 'column' | 'list' | 'icons'"
        >
          <svg
            v-if="opt.v === 'column'"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="4" width="5" height="16" rx="0.5" />
            <rect x="10" y="4" width="5" height="16" rx="0.5" />
            <rect x="17" y="4" width="4" height="16" rx="0.5" />
          </svg>
          <svg
            v-else-if="opt.v === 'list'"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <circle cx="4" cy="6" r="1" />
            <circle cx="4" cy="12" r="1" />
            <circle cx="4" cy="18" r="1" />
          </svg>
          <svg
            v-else
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" rx="0.5" />
            <rect x="14" y="3" width="7" height="7" rx="0.5" />
            <rect x="3" y="14" width="7" height="7" rx="0.5" />
            <rect x="14" y="14" width="7" height="7" rx="0.5" />
          </svg>
          <span>{{ opt.label }}</span>
        </button>
      </div>

      <!-- Search -->
      <div class="files-search">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" />
        </svg>
        <input v-model="searchTerm" placeholder="Im Vault suchen…" />
      </div>

      <!-- Upload -->
      <button class="files-upload-btn" :disabled="uploading" @click="triggerUpload">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span>{{ uploading ? "..." : "Hochladen" }}</span>
      </button>

      <input ref="fileInputRef" type="file" multiple style="display: none" @change="onFileInput" />
    </header>

    <!-- Upload-Feedback -->
    <div v-if="uploadMsg" class="files-upload-msg">{{ uploadMsg }}</div>

    <!-- ─── Body: Sidebar + Browser + Status ───────────────────── -->
    <div class="files-body">
      <!-- Sidebar -->
      <aside v-if="sidebarOpen" class="files-sidebar">
        <div class="files-sidebar-scroll">
          <!-- Section: Vault -->
          <div class="files-sidebar-section">
            <div class="files-sidebar-label">Vault</div>
            <div
              class="files-sidebar-item"
              :class="{ 'files-sidebar-item-active': path.length === 0 && !searchTerm }"
              @click="setSidebarTarget([])"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2v-9z" />
              </svg>
              <span>Alle Dateien</span>
            </div>
            <div class="files-sidebar-item files-sidebar-item-disabled">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
              <span>Zuletzt bearbeitet</span>
            </div>
            <div class="files-sidebar-item files-sidebar-item-disabled">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2" />
              </svg>
              <span>Markiert</span>
            </div>
            <div class="files-sidebar-item files-sidebar-item-disabled">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
                <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
              </svg>
              <span>Geteilt</span>
            </div>
          </div>

          <!-- Section: Hierarchie -->
          <div class="files-sidebar-section">
            <div class="files-sidebar-label">Hierarchie</div>
            <div
              class="files-sidebar-item"
              :class="{ 'files-sidebar-item-active': path[0] === 'Projekte' }"
              @click="setSidebarTarget(['Projekte'])"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
              </svg>
              <span>Projekte</span>
            </div>
            <div
              class="files-sidebar-item"
              :class="{ 'files-sidebar-item-active': path[0] === 'Privat' }"
              @click="setSidebarTarget(['Privat'])"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
              </svg>
              <span>Privat</span>
            </div>
          </div>

          <!-- Section: Speicher -->
          <div class="files-sidebar-section">
            <div class="files-sidebar-label">Speicher</div>
            <div class="files-sidebar-item files-sidebar-item-disabled">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="20" height="7" rx="1" />
                <rect x="2" y="13" width="20" height="7" rx="1" />
                <line x1="6" y1="7.5" x2="6.01" y2="7.5" />
                <line x1="6" y1="16.5" x2="6.01" y2="16.5" />
              </svg>
              <span>bau-os.local</span>
              <span class="files-sidebar-badge">self-hosted</span>
            </div>
            <div class="files-sidebar-item files-sidebar-item-disabled">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                <path d="M3 12a9 3 0 0 0 18 0" />
              </svg>
              <span>Postgres</span>
              <span class="files-sidebar-badge">{{ totalSizeLabel }}</span>
            </div>
          </div>
        </div>

        <!-- Storage-Footer -->
        <div class="files-sidebar-footer">
          <div class="files-storage-row">
            <span>Speicher</span>
            <span class="mono">{{ totalSizeLabel }} / 50 GB</span>
          </div>
          <div class="files-storage-bar">
            <div
              class="files-storage-bar-fill"
              :style="{ width: Math.min(100, (totalSizeBytes / (50 * 1024 * 1024 * 1024)) * 100) + '%' }"
            ></div>
          </div>
          <div class="files-storage-sub mono">
            {{ totalFileCount }} Datei<span v-if="totalFileCount !== 1">en</span> · DSGVO-konform
          </div>
        </div>
      </aside>

      <!-- Browser-Wrapper (Browser + Status) -->
      <div class="files-browser-wrap" :class="{ 'files-browser-wrap-with-sidebar': sidebarOpen }">
        <!-- Loading-Empty-State -->
        <div v-if="loading && allFiles.length === 0" class="files-empty">Laedt…</div>

        <!-- Spalten-View -->
        <div v-else-if="view === 'column'" class="files-columns">
          <div v-for="(col, idx) in columns" :key="idx" class="files-column">
            <div class="files-column-header">
              <span>{{ col.parent.kind === "root" ? "Vault" : col.parent.name }}</span>
              <span class="mono files-column-count">{{ col.items.length }}</span>
            </div>
            <div class="files-column-body">
              <div
                v-for="(it, i) in col.items"
                :key="i"
                class="files-row"
                :class="{
                  'files-row-active':
                    (idx < path.length && path[idx] === it.name) ||
                    (selected?.columnIndex === idx && selected?.node?.name === it.name && it.kind !== 'folder'),
                }"
                @click="onClickItem(it, idx)"
              >
                <FileGlyph
                  :kind="it.kind"
                  :active="(idx < path.length && path[idx] === it.name) || (selected?.columnIndex === idx && selected?.node?.name === it.name && it.kind !== 'folder')"
                />
                <span
                  class="files-row-name"
                  :class="{ mono: isMonoKind(it.kind) }"
                  :style="{ fontSize: isMonoKind(it.kind) ? '12px' : '13px' }"
                >
                  {{ it.name }}
                </span>
                <svg
                  v-if="it.kind === 'folder'"
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="files-row-chev"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
              <div v-if="col.items.length === 0" class="files-empty-col">Leer</div>
            </div>
          </div>

          <!-- Preview-Pane (nur wenn Datei selektiert) -->
          <div v-if="selected?.node && selected.node.kind !== 'folder'" class="files-preview">
            <div class="files-preview-eyebrow">Vorschau</div>
            <div class="files-preview-hero">
              <FileGlyph :kind="selected.node.kind" size="hero" />
            </div>
            <div>
              <div
                class="files-preview-name"
                :class="{ mono: isMonoKind(selected.node.kind) }"
              >
                {{ selected.node.name }}
              </div>
              <div class="files-preview-sub">{{ kindLabel(selected.node.kind) }}</div>
            </div>
            <div class="files-preview-meta">
              <div class="files-preview-row">
                <span class="files-preview-key">Größe</span>
                <span class="files-preview-val mono">{{ selected.node.size ?? "—" }}</span>
              </div>
              <div class="files-preview-row">
                <span class="files-preview-key">Geändert</span>
                <span class="files-preview-val mono">{{ selected.node.updated ?? "—" }}</span>
              </div>
              <div class="files-preview-row">
                <span class="files-preview-key">Tags</span>
                <span class="files-preview-val">—</span>
              </div>
              <div class="files-preview-row">
                <span class="files-preview-key">Speicher</span>
                <span class="files-preview-val mono">bau-os.local</span>
              </div>
            </div>
            <div class="files-preview-actions">
              <a class="files-preview-btn-primary" :href="downloadUrl(selected.node)" target="_blank">Öffnen</a>
              <button class="files-preview-btn-secondary" disabled>Teilen</button>
              <button class="files-preview-btn-secondary" @click="deleteSelected" title="Löschen">···</button>
            </div>

            <!-- Inline-Markdown-Vorschau wenn Markdown -->
            <div v-if="previewIsMarkdown && previewContent" class="files-preview-md">
              <MarkdownRenderer :content="previewContent" />
            </div>
            <!-- Sonst Text-Code-Vorschau -->
            <pre v-else-if="previewContent" class="files-preview-code">{{ previewContent }}</pre>
            <div v-else-if="previewLoading" class="files-preview-loading">Laedt…</div>
          </div>
        </div>

        <!-- Liste-View -->
        <div v-else-if="view === 'list'" class="files-list">
          <div class="files-list-header">
            <span>Name</span><span>Geändert</span><span>Größe</span><span>Art</span>
          </div>
          <div
            v-for="(it, i) in currentFolder.children ?? []"
            :key="i"
            class="files-list-row"
            :class="{ 'files-list-row-active': selected?.node?.name === it.name }"
            @click="onClickItem(it, path.length)"
          >
            <span class="files-list-name">
              <FileGlyph :kind="it.kind" :active="selected?.node?.name === it.name" />
              <span :class="{ mono: isMonoKind(it.kind) }" :style="{ fontSize: isMonoKind(it.kind) ? '12px' : '13px' }">{{ it.name }}</span>
            </span>
            <span class="mono files-list-meta">{{ it.updated ?? "—" }}</span>
            <span class="mono files-list-meta">{{ it.size ?? "—" }}</span>
            <span class="files-list-kind">{{ kindLabel(it.kind) }}</span>
          </div>
          <div v-if="(currentFolder.children?.length ?? 0) === 0" class="files-empty">
            Keine Dateien in diesem Ordner.
          </div>
        </div>

        <!-- Symbole-View -->
        <div v-else class="files-icons">
          <div
            v-for="(it, i) in currentFolder.children ?? []"
            :key="i"
            class="files-icon-cell"
            :class="{ 'files-icon-cell-active': selected?.node?.name === it.name }"
            @click="onClickItem(it, path.length)"
          >
            <FileGlyph :kind="it.kind" size="large" :active="selected?.node?.name === it.name" />
            <span class="files-icon-name" :class="{ mono: isMonoKind(it.kind) }">{{ it.name }}</span>
          </div>
          <div v-if="(currentFolder.children?.length ?? 0) === 0" class="files-empty">
            Keine Dateien in diesem Ordner.
          </div>
        </div>

        <!-- Status-Bar -->
        <div class="files-status">
          <span>{{ statusLeft }}</span>
          <span class="files-status-spacer"></span>
          <span>{{ statusRight }}</span>
        </div>
      </div>
    </div>

    <!-- Drag-Overlay -->
    <div v-if="dragging" class="files-drag-overlay">
      <div class="files-drag-card">Dateien hier ablegen</div>
    </div>
  </div>
</template>

<style scoped>
.files-root {
  height: calc(100vh - 0px);
  display: flex;
  flex-direction: column;
  font-family: "Inter", sans-serif;
  background: var(--color-bg);
  color: var(--color-text);
  overflow: hidden;
  position: relative;
}

/* ── Toolbar ─────────────────────────────────────────────── */
.files-toolbar {
  height: 64px;
  padding: 0 24px 0 18px;
  display: flex;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
  background: var(--color-bg);
}

.files-icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.files-icon-btn:hover:not(:disabled) {
  background: var(--color-bg-subtle);
}
.files-icon-btn:disabled {
  color: var(--color-text-faint);
  cursor: default;
}
.files-icon-btn-active {
  background: var(--color-border-subtle);
}

.files-nav-btns {
  display: flex;
  gap: 2px;
}

.files-breadcrumb {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.files-breadcrumb-eyebrow {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  margin-right: 4px;
  flex-shrink: 0;
}
.files-breadcrumb-sep {
  color: var(--color-text-faint);
  font-size: 12px;
}
.files-breadcrumb-seg {
  background: transparent;
  border: 0;
  font-size: 13px;
  color: var(--color-text-muted);
  font-weight: 400;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.files-breadcrumb-seg:hover {
  background: var(--color-border-subtle);
}
.files-breadcrumb-seg-active {
  color: var(--color-text);
  font-weight: 500;
}

.files-segmented {
  display: flex;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
}
.files-seg-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 0;
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
  font-family: inherit;
}
.files-seg-btn + .files-seg-btn {
  border-left: 1px solid var(--color-border);
}
.files-seg-btn-active {
  background: var(--color-text);
  color: var(--color-bg);
  font-weight: 500;
}

.files-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  width: 220px;
  background: var(--color-bg);
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}
.files-search input {
  border: 0;
  outline: 0;
  font-size: 12px;
  flex: 1;
  font-family: inherit;
  background: transparent;
  color: var(--color-text);
  min-width: 0;
}

.files-upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--color-text);
  color: var(--color-bg);
  border: 0;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  flex-shrink: 0;
}
.files-upload-btn:disabled {
  opacity: 0.6;
}

.files-upload-msg {
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border-subtle);
  padding: 8px 24px;
  font-size: 12px;
  color: var(--color-text-muted);
}

/* ── Body ─────────────────────────────────────────────── */
.files-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* ── Sidebar ─────────────────────────────────────────────── */
.files-sidebar {
  width: 220px;
  background: var(--color-bg-subtle);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}
.files-sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 14px 0;
}
.files-sidebar-section {
  margin-bottom: 16px;
}
.files-sidebar-label {
  padding: 0 16px 6px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
}
.files-sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px 6px 16px;
  font-size: 13px;
  color: var(--color-text-secondary);
  background: transparent;
  border-left: 2px solid transparent;
  cursor: pointer;
  font-weight: 400;
}
.files-sidebar-item:hover:not(.files-sidebar-item-disabled):not(.files-sidebar-item-active) {
  background: var(--color-border-subtle);
}
.files-sidebar-item-active {
  color: var(--color-text);
  background: var(--color-bg);
  border-left: 2px solid var(--color-text);
  padding-left: 14px;
  font-weight: 500;
}
.files-sidebar-item-disabled {
  color: var(--color-text-tertiary);
  cursor: default;
}
.files-sidebar-item svg {
  color: var(--color-text-muted);
}
.files-sidebar-item-disabled svg {
  color: var(--color-text-faint);
}
.files-sidebar-item span:first-of-type {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.files-sidebar-badge {
  font-size: 9px;
  padding: 1px 6px;
  background: var(--color-border-subtle);
  color: var(--color-text-muted);
  border-radius: 9999px;
  font-family: "JetBrains Mono", monospace;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.files-sidebar-footer {
  padding: 14px 16px;
  border-top: 1px solid var(--color-border-subtle);
  font-size: 11px;
  color: var(--color-text-muted);
}
.files-storage-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
}
.files-storage-row .mono {
  color: var(--color-text);
}
.files-storage-bar {
  height: 3px;
  background: var(--color-border);
  border-radius: 2px;
  overflow: hidden;
}
.files-storage-bar-fill {
  height: 100%;
  background: var(--color-text);
}
.files-storage-sub {
  margin-top: 8px;
  font-size: 10px;
  color: var(--color-text-tertiary);
}

/* ── Browser-Wrap ─────────────────────────────────────────────── */
.files-browser-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--color-bg);
}
.files-browser-wrap-with-sidebar {
  border-left: 1px solid var(--color-border-subtle);
}

/* Spalten-View */
.files-columns {
  flex: 1;
  display: flex;
  overflow-x: auto;
  min-height: 0;
}
.files-column {
  width: 240px;
  min-width: 240px;
  border-right: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
}
.files-column-header {
  padding: 10px 14px 8px;
  border-bottom: 1px solid var(--color-border-subtle);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.files-column-count {
  color: var(--color-text-faint);
}
.files-column-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.files-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  background: transparent;
  color: var(--color-text);
  font-weight: 400;
}
.files-row:hover:not(.files-row-active) {
  background: var(--color-bg-subtle);
}
.files-row-active {
  background: var(--color-text);
  color: var(--color-bg);
  font-weight: 500;
}
.files-row-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.files-row-chev {
  color: var(--color-text-faint);
}
.files-row-active .files-row-chev {
  color: var(--color-bg);
}
.files-empty-col {
  padding: 16px 14px;
  font-size: 12px;
  color: var(--color-text-tertiary);
}

/* Preview-Pane */
.files-preview {
  width: 300px;
  min-width: 300px;
  padding: 24px;
  background: var(--color-bg-subtle);
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow: auto;
}
.files-preview-eyebrow {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
}
.files-preview-hero {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30px 20px;
  background: var(--color-bg);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
}
.files-preview-name {
  font-size: 14px;
  font-weight: 600;
  word-break: break-word;
  color: var(--color-text);
}
.files-preview-sub {
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-top: 4px;
}
.files-preview-meta {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 12px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border-subtle);
}
.files-preview-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.files-preview-key {
  color: var(--color-text-tertiary);
}
.files-preview-val {
  text-align: right;
  color: var(--color-text);
  font-size: 11px;
}
.files-preview-actions {
  display: flex;
  gap: 6px;
}
.files-preview-btn-primary {
  flex: 2;
  padding: 7px 12px;
  font-size: 12px;
  background: var(--color-text);
  color: var(--color-bg);
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
  text-align: center;
  text-decoration: none;
}
.files-preview-btn-secondary {
  flex: 1;
  padding: 7px 12px;
  font-size: 12px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
}
.files-preview-btn-secondary:disabled {
  opacity: 0.5;
  cursor: default;
}
.files-preview-md {
  border-top: 1px solid var(--color-border-subtle);
  padding-top: 14px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-text);
}
.files-preview-code {
  border-top: 1px solid var(--color-border-subtle);
  padding-top: 14px;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
.files-preview-loading {
  font-size: 12px;
  color: var(--color-text-tertiary);
  text-align: center;
  padding: 12px 0;
}

/* Liste-View */
.files-list {
  flex: 1;
  overflow-y: auto;
  background: var(--color-bg);
}
.files-list-header {
  display: grid;
  grid-template-columns: 1fr 160px 100px 130px;
  padding: 10px 20px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border-subtle);
  position: sticky;
  top: 0;
  z-index: 1;
}
.files-list-row {
  display: grid;
  grid-template-columns: 1fr 160px 100px 130px;
  padding: 10px 20px;
  font-size: 13px;
  align-items: center;
  cursor: pointer;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg);
  color: var(--color-text);
}
.files-list-row:hover:not(.files-list-row-active) {
  background: var(--color-bg-subtle);
}
.files-list-row-active {
  background: var(--color-text);
  color: var(--color-bg);
}
.files-list-name {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.files-list-name > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.files-list-meta {
  font-size: 11px;
  color: var(--color-text-muted);
}
.files-list-row-active .files-list-meta {
  color: var(--color-text-faint);
}
.files-list-kind {
  font-size: 11px;
  color: var(--color-text-tertiary);
}
.files-list-row-active .files-list-kind {
  color: var(--color-text-faint);
}

/* Symbole-View */
.files-icons {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background: var(--color-bg);
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}
.files-icon-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px 8px;
  border-radius: 6px;
  cursor: pointer;
  background: transparent;
  color: var(--color-text);
}
.files-icon-cell:hover:not(.files-icon-cell-active) {
  background: var(--color-bg-subtle);
}
.files-icon-cell-active {
  background: var(--color-text);
  color: var(--color-bg);
}
.files-icon-name {
  font-size: 12px;
  text-align: center;
  line-height: 1.3;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Status-Bar */
.files-status {
  height: 26px;
  border-top: 1px solid var(--color-border-subtle);
  background: var(--color-bg-subtle);
  display: flex;
  align-items: center;
  padding: 0 14px;
  font-size: 11px;
  color: var(--color-text-muted);
  font-family: "JetBrains Mono", monospace;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.files-status-spacer {
  flex: 1;
}

/* Empty-States */
.files-empty {
  padding: 48px 24px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text-tertiary);
}

/* Helpers */
.mono {
  font-family: "JetBrains Mono", monospace;
}

/* Drag-Overlay */
.files-drag-overlay {
  position: absolute;
  inset: 0;
  background: rgba(17, 24, 39, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  pointer-events: none;
}
.files-drag-card {
  background: var(--color-bg);
  color: var(--color-text);
  padding: 20px 28px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  border: 2px dashed var(--color-text);
}

/* ─── Mobile-Anpassung (≤767px) ────────────────────────────── */
@media (max-width: 767.98px) {
  .files-toolbar {
    height: auto;
    padding: 12px 16px;
    flex-wrap: wrap;
    gap: 10px;
  }
  .files-breadcrumb {
    width: 100%;
    order: 10; /* in eigene Zeile */
  }
  .files-search {
    width: 100%;
    order: 11;
  }
  .files-segmented {
    order: 12;
  }
  .files-upload-btn {
    order: 13;
  }
  .files-sidebar {
    width: 200px;
  }
  .files-preview {
    width: 100%;
    min-width: unset;
    border-top: 1px solid var(--color-border-subtle);
  }
  .files-columns {
    flex-direction: column;
  }
  .files-column {
    width: 100%;
    min-width: unset;
    border-right: 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }
  .files-list-header,
  .files-list-row {
    grid-template-columns: 1fr 90px;
  }
  .files-list-header span:nth-child(2),
  .files-list-row > span:nth-child(2),
  .files-list-header span:nth-child(4),
  .files-list-row > span:nth-child(4) {
    display: none;
  }
}
</style>
