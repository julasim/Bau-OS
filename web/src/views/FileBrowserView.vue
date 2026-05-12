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

import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
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
  /** Markiert (vom aktuellen User) */
  starred?: boolean;
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
  starred?: boolean;
}

interface ProjectEntry {
  name: string;
}

interface AdminUserMini {
  id: string;
  username: string;
  displayName: string | null;
  role: "admin" | "user";
}

interface FileShare {
  fileId: string;
  userId: string;
  username: string;
  displayName: string | null;
  canEdit: boolean;
  addedAt: string;
}

// ── State ────────────────────────────────────────────────────────────────────
type ViewMode = "all" | "recent" | "starred" | "shared";
const mode = ref<ViewMode>("all");
const path = ref<string[]>([]);
const selected = ref<{ node: FileNode; columnIndex: number } | null>(null);
const view = ref<"column" | "list" | "icons">("column");
const sidebarOpen = ref(true);
const searchTerm = ref("");

// Forward/Back-Navigation: kleiner Stack, im Stil von Browsern.
// Wir merken uns die letzten Pfade — Back schiebt rein, Forward wieder raus.
const historyForward = ref<string[][]>([]);

// Auf Mobile: Sidebar startet zugeklappt — Platz fuer den Browser.
if (typeof window !== "undefined" && window.matchMedia("(max-width: 767.98px)").matches) {
  sidebarOpen.value = false;
}

const allFiles = ref<ApiFile[]>([]);
const allProjects = ref<ProjectEntry[]>([]);
const allUsers = ref<AdminUserMini[]>([]);
const loading = ref(false);

// File-Preview (rechts in der Spalten-Ansicht)
const previewContent = ref<string | null>(null);
const previewFileName = ref<string>("");
const previewLoading = ref(false);

// Upload
const uploading = ref(false);
const uploadMsg = ref("");
const dragging = ref(false);

// Action-Menu (··· Dropdown im Preview-Pane)
const actionMenuOpen = ref(false);

// Teilen-Modal
const shareModalOpen = ref(false);
const shareModalFile = ref<FileNode | null>(null);
const shareModalShares = ref<FileShare[]>([]);
const shareModalSearchTerm = ref("");
const shareModalCanEdit = ref(false);
const shareModalBusy = ref(false);

// ── Daten laden ──────────────────────────────────────────────────────────────
async function loadFiles() {
  loading.value = true;
  try {
    let endpoint = "/files";
    if (mode.value === "recent") endpoint = "/files/recent";
    else if (mode.value === "starred") endpoint = "/files/starred";
    else if (mode.value === "shared") endpoint = "/files/shared";

    const raw = await api.get<ApiFile[]>(endpoint);
    allFiles.value = raw.filter((f) => f.type === "file" && !!f.id);
  } catch {
    allFiles.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadUsers() {
  // Nur einmalig fuer Teilen-Modal. /users/mini ist kein Admin-Endpoint —
  // alle eingeloggten User koennen die Mini-Liste lesen (nur id/username/
  // displayName, ohne Hashes oder Telegram-Daten).
  if (allUsers.value.length > 0) return;
  try {
    allUsers.value = await api.get<AdminUserMini[]>("/users/mini");
  } catch {
    allUsers.value = [];
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

function fileToNode(f: ApiFile): FileNode {
  return {
    name: f.name,
    kind: extToKind(f.extension),
    id: f.id,
    updated: humanDate(f.modified),
    sizeBytes: f.size,
    size: formatSize(f.size),
    project: f.project ?? null,
    starred: f.starred === true,
  };
}

const tree = computed<FileNode>(() => {
  // Filter: wenn ein Such-Term aktiv ist, fallen alle Files raus die nicht
  // matchen — das macht die Tree-Sicht zur Such-Sicht. Folder werden nur
  // angezeigt wenn sie min. ein Match enthalten.
  const term = searchTerm.value.trim().toLowerCase();
  const match = (f: ApiFile) =>
    !term || f.name.toLowerCase().includes(term) || (f.project ?? "").toLowerCase().includes(term);

  const filtered = allFiles.value.filter(match);

  // ── Spezial-Modes: flache Liste in einem virtuellen Folder ───────────
  // Recent/Starred/Shared sind keine Hierarchie — wir zeigen die Files
  // direkt im Root, ohne Projekt-Gruppierung.
  if (mode.value !== "all") {
    const label = mode.value === "recent" ? "Zuletzt bearbeitet" : mode.value === "starred" ? "Markiert" : "Geteilt";
    return {
      name: "Vault",
      kind: "root",
      children: [
        {
          name: label,
          kind: "folder",
          children: filtered.map(fileToNode), // KEINE Sortierung — Reihenfolge kommt vom Backend
        },
      ],
    };
  }

  // ── Mode "all": Projekte + Privat ────────────────────────────────────
  const byProject = new Map<string, ApiFile[]>();
  const orphan: ApiFile[] = [];
  for (const f of filtered) {
    if (f.project) {
      const arr = byProject.get(f.project) ?? [];
      arr.push(f);
      byProject.set(f.project, arr);
    } else {
      orphan.push(f);
    }
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
  // Wenn der User in einem Pfad navigiert hat (z.B. ["Privat"]), zeigen
  // wir die Vault-Root-Spalte NICHT mehr — sie waere redundant mit der
  // Sidebar (HIERARCHIE). Erst ab der Pfad-Tiefe 1 werden Spalten gerendert.
  // Path leer → eine Spalte (die Root mit Projekte/Privat als Einstieg).
  const cols: Column[] = [];
  if (path.value.length === 0) {
    cols.push({ parent: root, items: root.children ?? [] });
    return cols;
  }
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
// Mapping zwischen Spalten-Index und Pfad-Tiefe:
// - Wenn path leer ist, zeigt cols[0] die Root (Projekte/Privat). Ein Klick
//   auf einen Folder dort setzt path[0].
// - Wenn path.length > 0, zeigen wir die Root-Spalte NICHT mehr (Sidebar
//   uebernimmt das). cols[idx] zeigt dann children von path[idx]. Ein Klick
//   in cols[idx] setzt path[idx + 1]. Daher das +1 unten.
function onClickItem(node: FileNode, columnIndex: number) {
  // Effektive Pfad-Tiefe, ab der dieser Klick aufbaut.
  const baseDepth = path.value.length === 0 ? 0 : columnIndex + 1;
  if (node.kind === "folder") {
    path.value = [...path.value.slice(0, baseDepth), node.name];
    selected.value = { node, columnIndex };
    previewContent.value = null;
  } else {
    // Files schliessen Pfad ab — selected bleibt fuer Preview
    path.value = path.value.slice(0, baseDepth);
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
    const resp = await api.get<{ content: string; filename: string }>(`/files/read?id=${encodeURIComponent(node.id)}`);
    previewContent.value = resp.content ?? "";
  } catch {
    previewContent.value = null;
  } finally {
    previewLoading.value = false;
  }
}

// ── Navigation mit Forward/Back-History ─────────────────────────────────────
// path-Aenderungen ueber navigateTo() pushen den vorherigen Pfad in den
// Forward-Stack — Forward-Click macht den Schritt rueckgaengig (klassisches
// Browser-Pattern). Direkte Manipulation von path.value (Sidebar/Breadcrumb)
// koennte das umgehen, deswegen alle Pfad-Wechsel ueber navigateTo().
function navigateTo(newPath: string[]) {
  // Wenn der Forward-Stack einen Eintrag hat der genau dem newPath entspricht,
  // pop'en wir ihn statt zu clearen — das ist das Forward-Klick-Szenario.
  const top = historyForward.value[historyForward.value.length - 1];
  if (top && JSON.stringify(top) === JSON.stringify(newPath)) {
    historyForward.value.pop();
  } else {
    // Normaler Pfadwechsel: Forward-Stack invalidiert (wir verzweigen).
    historyForward.value = [];
  }
  path.value = newPath;
  selected.value = null;
  previewContent.value = null;
  actionMenuOpen.value = false;
}

function setSidebarTarget(target: string[] | null) {
  if (!target) return;
  navigateTo(target);
}

function setMode(newMode: ViewMode) {
  if (mode.value === newMode) return;
  mode.value = newMode; // watcher triggert loadFiles()
  navigateTo([]);
}

function onBreadcrumbClick(i: number) {
  if (i === 0) {
    navigateTo([]);
  } else {
    navigateTo(path.value.slice(0, i));
  }
}

function onBack() {
  if (path.value.length === 0) return;
  // Aktuellen Pfad in Forward-Stack pushen, dann eine Stufe hoch.
  historyForward.value.push([...path.value]);
  path.value = path.value.slice(0, -1);
  selected.value = null;
  previewContent.value = null;
  actionMenuOpen.value = false;
}

function onForward() {
  const next = historyForward.value.pop();
  if (!next) return;
  path.value = next;
  selected.value = null;
  previewContent.value = null;
  actionMenuOpen.value = false;
}

// Reset preview wenn search aktiv wird (sonst bleibt es bei alten files
// hängen, die durch Filter weggefallen sind).
watch(searchTerm, () => {
  selected.value = null;
  previewContent.value = null;
});

// Bei Mode-Wechsel die Files vom passenden Endpoint nachladen.
watch(mode, () => {
  void loadFiles();
});

// ── Aktionen auf Files ───────────────────────────────────────────────────────
function downloadUrl(node: FileNode): string {
  if (!node.id) return "#";
  const token = localStorage.getItem("bau-os-token");
  const base = `/api/files/download?id=${encodeURIComponent(node.id)}`;
  return token ? `${base}&token=${encodeURIComponent(token)}` : base;
}

// Star-Toggle. Optimistic-Update fuer Frontend-Snappiness — bei Fehler
// wird der lokale State zurueckgerollt.
async function toggleStar(node: FileNode, event?: Event) {
  if (event) event.stopPropagation();
  if (!node.id) return;
  const wasStarred = node.starred === true;
  // Update lokal (in allFiles)
  const f = allFiles.value.find((x) => x.id === node.id);
  if (f) f.starred = !wasStarred;
  // Selected-Node mit dranziehen, damit Preview-Star-Indikator stimmt.
  if (selected.value?.node?.id === node.id) {
    selected.value = { ...selected.value, node: { ...selected.value.node, starred: !wasStarred } };
  }
  try {
    if (wasStarred) {
      await api.delete(`/files/${encodeURIComponent(node.id)}/star`);
    } else {
      await api.post(`/files/${encodeURIComponent(node.id)}/star`, {});
    }
  } catch {
    // Rollback
    if (f) f.starred = wasStarred;
    if (selected.value?.node?.id === node.id) {
      selected.value = { ...selected.value, node: { ...selected.value.node, starred: wasStarred } };
    }
  }
  // Wenn wir gerade in Mode "starred" sind und ein Stern entfernt wurde,
  // soll die Liste das reflektieren — neu laden.
  if (mode.value === "starred" && wasStarred) {
    await loadFiles();
  }
}

// ── Teilen-Modal ────────────────────────────────────────────────────────────
async function openShareModal(node: FileNode) {
  if (!node.id) return;
  shareModalFile.value = node;
  shareModalOpen.value = true;
  shareModalSearchTerm.value = "";
  shareModalCanEdit.value = false;
  shareModalShares.value = [];
  await Promise.all([loadUsers(), loadShares(node.id)]);
}

function closeShareModal() {
  shareModalOpen.value = false;
  shareModalFile.value = null;
  shareModalShares.value = [];
}

async function loadShares(fileId: string) {
  try {
    shareModalShares.value = await api.get<FileShare[]>(`/files/${encodeURIComponent(fileId)}/shares`);
  } catch {
    shareModalShares.value = [];
  }
}

async function addShare(userId: string) {
  if (!shareModalFile.value?.id) return;
  shareModalBusy.value = true;
  try {
    await api.post(`/files/${encodeURIComponent(shareModalFile.value.id)}/shares`, {
      userId,
      canEdit: shareModalCanEdit.value,
    });
    await loadShares(shareModalFile.value.id);
  } finally {
    shareModalBusy.value = false;
  }
}

async function removeShare(userId: string) {
  if (!shareModalFile.value?.id) return;
  shareModalBusy.value = true;
  try {
    await api.delete(`/files/${encodeURIComponent(shareModalFile.value.id)}/shares/${encodeURIComponent(userId)}`);
    await loadShares(shareModalFile.value.id);
  } finally {
    shareModalBusy.value = false;
  }
}

// User-Picker im Modal: filtert nicht-gestartete Liste, schliesst bereits-
// geshared User aus.
const shareModalCandidates = computed<AdminUserMini[]>(() => {
  const term = shareModalSearchTerm.value.trim().toLowerCase();
  const sharedIds = new Set(shareModalShares.value.map((s) => s.userId));
  return allUsers.value.filter((u) => {
    if (sharedIds.has(u.id)) return false;
    if (!term) return true;
    return u.username.toLowerCase().includes(term) || (u.displayName ?? "").toLowerCase().includes(term);
  });
});

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
    const data = (await res.json()) as {
      success?: boolean;
      uploaded?: unknown[];
      error?: string;
      partial?: boolean;
      failures?: Array<{ filename: string; error: string }>;
    };
    if (!res.ok || !data.success) {
      const detail = data.failures?.[0]?.error ?? data.error ?? `HTTP ${res.status}`;
      uploadMsg.value = `Upload fehlgeschlagen: ${detail}`;
      return;
    }
    const count = data.uploaded?.length ?? 0;
    if (count === 0) {
      uploadMsg.value = "Datei wurde nicht gespeichert (Backend hat kein File angenommen)";
      return;
    }
    let msg = `${count} Datei(en) hochgeladen${targetProject ? ` → ${targetProject}` : ""}`;
    if (data.partial && data.failures?.length) {
      msg += ` — ${data.failures.length} Fehler: ${data.failures[0]!.error}`;
    }
    uploadMsg.value = msg;
    await loadFiles();
  } catch (e) {
    uploadMsg.value = `Upload fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    uploading.value = false;
    setTimeout(() => (uploadMsg.value = ""), 6000);
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
    (
      {
        pdf: "pdf",
        dwg: "dwg",
        image: "img",
        doc: "doc",
        csv: "csv",
        archive: "gz",
        code: "md",
        other: "file",
      } as Record<FileKind, string>
    )[kind] ?? "file"
  );
}

const previewIsMarkdown = computed(() => previewFileName.value.toLowerCase().endsWith(".md"));

// Click-Outside fuer das ··· Action-Menu — global Listener auf document.
function onDocClick(e: MouseEvent) {
  if (!actionMenuOpen.value) return;
  // Wenn der Klick nicht in einem Action-Menu-Wrap war, schliessen.
  const target = e.target as HTMLElement | null;
  if (!target?.closest(".files-preview-actions-menu-wrap")) {
    actionMenuOpen.value = false;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([loadFiles(), loadProjects()]);
  if (typeof document !== "undefined") {
    document.addEventListener("click", onDocClick);
  }
});

// Listener-Cleanup beim Unmount — sonst leakt das ueber Page-Wechsel hinaus.
onBeforeUnmount(() => {
  if (typeof document !== "undefined") {
    document.removeEventListener("click", onDocClick);
  }
});
</script>

<template>
  <div class="files-root" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <!-- ─── Toolbar ─────────────────────────────────────────────── -->
    <header class="files-toolbar">
      <!-- Sidebar-Toggle -->
      <button
        class="files-icon-btn"
        :class="{ 'files-icon-btn-active': sidebarOpen }"
        @click="sidebarOpen = !sidebarOpen"
        title="Seitenleiste"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <line x1="9" y1="4" x2="9" y2="20" />
        </svg>
      </button>

      <!-- Back / Forward -->
      <div class="files-nav-btns">
        <button class="files-icon-btn" :disabled="path.length === 0" @click="onBack" title="Zurück">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button class="files-icon-btn" :disabled="historyForward.length === 0" @click="onForward" title="Weiter">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
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
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" />
        </svg>
        <input v-model="searchTerm" placeholder="Im Vault suchen…" />
      </div>

      <!-- Upload -->
      <button class="files-upload-btn" :disabled="uploading" @click="triggerUpload">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
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
              :class="{ 'files-sidebar-item-active': mode === 'all' && path.length === 0 && !searchTerm }"
              @click="setMode('all')"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2v-9z" />
              </svg>
              <span>Alle Dateien</span>
            </div>
            <div
              class="files-sidebar-item"
              :class="{ 'files-sidebar-item-active': mode === 'recent' }"
              @click="setMode('recent')"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
              <span>Zuletzt bearbeitet</span>
            </div>
            <!-- Markiert + Geteilt: Backend noch nicht implementiert — kommt in späterer Version -->
            <!-- <div class="files-sidebar-item" @click="setMode('starred')"><span>Markiert</span></div> -->
            <!-- <div class="files-sidebar-item" @click="setMode('shared')"><span>Geteilt</span></div> -->
          </div>

          <!-- Section: Hierarchie -->
          <div class="files-sidebar-section">
            <div class="files-sidebar-label">Hierarchie</div>
            <div
              class="files-sidebar-item"
              :class="{ 'files-sidebar-item-active': mode === 'all' && path[0] === 'Projekte' }"
              @click="
                mode = 'all';
                setSidebarTarget(['Projekte']);
              "
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
              </svg>
              <span>Projekte</span>
            </div>
            <div
              class="files-sidebar-item"
              :class="{ 'files-sidebar-item-active': mode === 'all' && path[0] === 'Privat' }"
              @click="
                mode = 'all';
                setSidebarTarget(['Privat']);
              "
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
              </svg>
              <span>Privat</span>
            </div>
          </div>

          <!-- Section: Speicher -->
          <div class="files-sidebar-section">
            <div class="files-sidebar-label">Speicher</div>
            <div class="files-sidebar-item files-sidebar-item-disabled">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="2" y="4" width="20" height="7" rx="1" />
                <rect x="2" y="13" width="20" height="7" rx="1" />
                <line x1="6" y1="7.5" x2="6.01" y2="7.5" />
                <line x1="6" y1="16.5" x2="6.01" y2="16.5" />
              </svg>
              <span>bau-os.local</span>
              <span class="files-sidebar-badge">self-hosted</span>
            </div>
            <div class="files-sidebar-item files-sidebar-item-disabled">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
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

        <!-- ══ Vollbild-Vorschau (ersetzt Browser wenn Datei geöffnet) ══ -->
        <div v-else-if="selected?.node && selected.node.kind !== 'folder'" class="files-detail-full">
          <!-- Topbar -->
          <div class="files-detail-topbar">
            <button class="files-detail-back" @click="selected = null">
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
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Zurück
            </button>
            <span class="files-detail-breadcrumb">{{ selected.node.name }}</span>
            <!-- Star-Button: Backend noch nicht implementiert -->
          </div>

          <!-- Body: Info-Spalte links + Inhalt rechts -->
          <div class="files-detail-body">
            <!-- Info-Panel -->
            <div class="files-detail-info">
              <div class="files-preview-hero">
                <img
                  v-if="selected.node.kind === 'image' && selected.node.id"
                  :src="downloadUrl(selected.node)"
                  :alt="selected.node.name"
                  class="files-preview-image"
                />
                <FileGlyph v-else :kind="selected.node.kind" size="hero" />
              </div>
              <div>
                <div class="files-preview-name" :class="{ mono: isMonoKind(selected.node.kind) }">
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
                  <span class="files-preview-key">Projekt</span>
                  <span class="files-preview-val">{{ selected.node.project ?? "—" }}</span>
                </div>
                <div class="files-preview-row">
                  <span class="files-preview-key">Speicher</span>
                  <span class="files-preview-val mono">bau-os.local</span>
                </div>
              </div>
              <div class="files-preview-actions">
                <a class="files-preview-btn-primary" :href="downloadUrl(selected.node)" target="_blank">Öffnen</a>
                <!-- Teilen-Button: Backend noch nicht implementiert -->
                <div class="files-preview-actions-menu-wrap">
                  <button
                    class="files-preview-btn-secondary"
                    @click="actionMenuOpen = !actionMenuOpen"
                    :class="{ 'files-preview-btn-active': actionMenuOpen }"
                    title="Mehr"
                  >
                    ···
                  </button>
                  <div v-if="actionMenuOpen" class="files-action-menu" @click.stop>
                    <!-- Markieren: Backend noch nicht implementiert -->
                    <a
                      class="files-action-item"
                      :href="downloadUrl(selected.node)"
                      download
                      @click="actionMenuOpen = false"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Herunterladen
                    </a>
                    <!-- Teilen: Backend noch nicht implementiert -->
                    <div class="files-action-divider"></div>
                    <button
                      class="files-action-item files-action-danger"
                      @click="
                        actionMenuOpen = false;
                        deleteSelected();
                      "
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                      </svg>
                      Löschen
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Inhalts-Panel -->
            <div class="files-detail-content">
              <iframe
                v-if="selected.node.kind === 'pdf' && selected.node.id"
                :src="downloadUrl(selected.node)"
                class="files-detail-pdf"
                :title="selected.node.name"
              />
              <img
                v-else-if="selected.node.kind === 'image' && selected.node.id"
                :src="downloadUrl(selected.node)"
                :alt="selected.node.name"
                class="files-detail-img"
              />
              <div v-else-if="previewIsMarkdown && previewContent" class="files-detail-md">
                <MarkdownRenderer :content="previewContent" />
              </div>
              <pre v-else-if="previewContent" class="files-detail-code">{{ previewContent }}</pre>
              <div v-else-if="previewLoading" class="files-preview-loading">Lädt…</div>
              <div v-else class="files-detail-empty">
                <FileGlyph :kind="selected.node.kind" size="hero" />
                <p>Keine Vorschau verfügbar.</p>
                <a class="files-preview-btn-primary" :href="downloadUrl(selected.node)" target="_blank">Datei öffnen</a>
              </div>
            </div>
          </div>
        </div>

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
                    (path.length > 0 && path[idx + 1] === it.name) ||
                    (path.length === 0 && path[idx] === it.name) ||
                    (selected?.columnIndex === idx && selected?.node?.name === it.name && it.kind !== 'folder'),
                }"
                @click="onClickItem(it, idx)"
              >
                <FileGlyph
                  :kind="it.kind"
                  :active="
                    (path.length > 0 && path[idx + 1] === it.name) ||
                    (path.length === 0 && path[idx] === it.name) ||
                    (selected?.columnIndex === idx && selected?.node?.name === it.name && it.kind !== 'folder')
                  "
                />
                <span
                  class="files-row-name"
                  :class="{ mono: isMonoKind(it.kind) }"
                  :style="{ fontSize: isMonoKind(it.kind) ? '12px' : '13px' }"
                >
                  {{ it.name }}
                </span>
                <!-- Star-Button: Backend noch nicht implementiert -->
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
        </div>

        <!-- Liste-View -->
        <div v-else-if="view === 'list'" class="files-list">
          <div class="files-list-header"><span>Name</span><span>Geändert</span><span>Größe</span><span>Art</span></div>
          <div
            v-for="(it, i) in currentFolder.children ?? []"
            :key="i"
            class="files-list-row"
            :class="{ 'files-list-row-active': selected?.node?.name === it.name }"
            @click="onClickItem(it, path.length)"
          >
            <span class="files-list-name">
              <FileGlyph :kind="it.kind" :active="selected?.node?.name === it.name" />
              <span
                :class="{ mono: isMonoKind(it.kind) }"
                :style="{ fontSize: isMonoKind(it.kind) ? '12px' : '13px' }"
                >{{ it.name }}</span
              >
              <!-- Star-Button: Backend noch nicht implementiert -->
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

    <!-- ─── Teilen-Modal ───────────────────────────────────── -->
    <div v-if="shareModalOpen" class="files-modal-backdrop" @click="closeShareModal">
      <div class="files-modal" @click.stop>
        <div class="files-modal-header">
          <div>
            <div class="eyebrow">Teilen</div>
            <h3 class="files-modal-title">{{ shareModalFile?.name ?? "Datei" }}</h3>
          </div>
          <button class="files-modal-close" @click="closeShareModal" title="Schließen">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- Aktuelle Shares -->
        <div class="files-modal-section">
          <div class="files-modal-section-label">Aktuell geteilt mit</div>
          <div v-if="shareModalShares.length === 0" class="files-modal-empty">Noch mit niemandem geteilt.</div>
          <div v-for="s in shareModalShares" :key="s.userId" class="files-modal-share-row">
            <div class="files-modal-share-info">
              <span class="files-modal-share-name">{{ s.displayName ?? s.username }}</span>
              <span v-if="s.displayName" class="files-modal-share-username">@{{ s.username }}</span>
              <span v-if="s.canEdit" class="files-modal-pill">Bearbeiten</span>
              <span v-else class="files-modal-pill files-modal-pill-muted">Lesen</span>
            </div>
            <button class="files-modal-share-remove" :disabled="shareModalBusy" @click="removeShare(s.userId)">
              Entfernen
            </button>
          </div>
        </div>

        <!-- Hinzufuegen -->
        <div class="files-modal-section">
          <div class="files-modal-section-label">Hinzufügen</div>
          <div class="files-modal-add-controls">
            <input
              v-model="shareModalSearchTerm"
              type="text"
              placeholder="Benutzer suchen…"
              class="files-modal-input"
            />
            <label class="files-modal-checkbox">
              <input v-model="shareModalCanEdit" type="checkbox" />
              <span>Bearbeiten erlauben</span>
            </label>
          </div>
          <div class="files-modal-candidates">
            <div v-if="shareModalCandidates.length === 0" class="files-modal-empty">
              {{ shareModalSearchTerm ? "Keine Treffer." : "Alle verfügbaren User sind bereits hinzugefügt." }}
            </div>
            <button
              v-for="u in shareModalCandidates.slice(0, 50)"
              :key="u.id"
              class="files-modal-candidate"
              :disabled="shareModalBusy"
              @click="addShare(u.id)"
            >
              <div class="files-modal-candidate-info">
                <span class="files-modal-candidate-name">{{ u.displayName ?? u.username }}</span>
                <span v-if="u.displayName" class="files-modal-candidate-username">@{{ u.username }}</span>
              </div>
              <span class="files-modal-candidate-add">+ Hinzufügen</span>
            </button>
          </div>
        </div>
      </div>
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

/* ── Vollbild-Detail-Ansicht ──────────────────────────────────────────────── */
.files-detail-full {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.files-detail-topbar {
  height: 48px;
  border-bottom: 1px solid var(--color-border-subtle);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  flex-shrink: 0;
  background: var(--color-bg);
}
.files-detail-back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-family: inherit;
  color: var(--color-text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 5px;
  flex-shrink: 0;
  transition: background 80ms ease;
}
.files-detail-back:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}
.files-detail-breadcrumb {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.files-detail-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}
.files-detail-info {
  width: 280px;
  min-width: 280px;
  border-right: 1px solid var(--color-border-subtle);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow-y: auto;
  background: var(--color-bg-subtle);
}
.files-detail-content {
  flex: 1;
  overflow: auto;
  padding: 32px;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
}
.files-detail-pdf {
  flex: 1;
  width: 100%;
  min-height: 600px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
}
.files-detail-img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  display: block;
  margin: 0 auto;
  border-radius: 6px;
  border: 1px solid var(--color-border-subtle);
}
.files-detail-md {
  max-width: 800px;
  width: 100%;
}
.files-detail-code {
  font-family: "Geist Mono", "JetBrains Mono", ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  padding: 20px 24px;
  margin: 0;
}
.files-detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  height: 100%;
  color: var(--color-text-tertiary);
  font-size: 13px;
}

/* Preview-Pane (legacy, für responsive-Fallback) */
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
  .files-detail-info {
    width: 220px;
    min-width: 220px;
  }
  .files-detail-content {
    padding: 16px;
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

/* ─── Star-Buttons in Rows ──────────────────────────────────────────────── */
.files-row-star {
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-faint);
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 80ms ease;
}
.files-row:hover .files-row-star,
.files-row-active .files-row-star,
.files-row-star.files-row-star-on,
.files-list-row:hover .files-row-star,
.files-list-row-active .files-row-star,
.files-icon-cell:hover .files-row-star,
.files-icon-cell-active .files-row-star {
  opacity: 1;
}
.files-row-star:hover {
  background: rgba(0, 0, 0, 0.06);
}
.files-row-star-on {
  color: #f59e0b; /* amber-500 */
}
.files-row-star-active-row {
  color: rgba(255, 255, 255, 0.85) !important;
}
.files-row-star-active-row.files-row-star-on {
  color: #fbbf24 !important; /* amber-400 — gut sichtbar auf schwarz */
}
.files-row-star-inline {
  margin-left: 6px;
}

/* ─── Preview-Header (Eyebrow + Star) ──────────────────────────────────── */
.files-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.files-preview-star {
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: var(--color-text-faint);
}
.files-preview-star:hover {
  background: var(--color-border-subtle);
}
.files-preview-star-on {
  color: #f59e0b;
}

/* ─── Bild-Vorschau ─────────────────────────────────────────────────────── */
.files-preview-image {
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
  display: block;
}

/* ─── PDF-Vorschau ──────────────────────────────────────────────────────── */
.files-preview-pdf {
  width: 100%;
  height: 480px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  background: var(--color-bg);
}

/* ─── Action-Menu (··· Dropdown) ────────────────────────────────────────── */
.files-preview-actions-menu-wrap {
  position: relative;
  flex: 1;
}
.files-preview-actions-menu-wrap .files-preview-btn-secondary {
  width: 100%;
}
.files-preview-btn-active {
  background: var(--color-border-subtle);
}
.files-action-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  min-width: 200px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  padding: 4px;
  z-index: 20;
}
.files-action-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  background: transparent;
  border: 0;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
  text-decoration: none;
}
.files-action-item:hover {
  background: var(--color-bg-subtle);
}
.files-action-item svg {
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.files-action-divider {
  height: 1px;
  background: var(--color-border-subtle);
  margin: 4px 0;
}
.files-action-danger {
  color: #dc2626;
}
.files-action-danger svg {
  color: #dc2626;
}
.files-action-danger:hover {
  background: #fef2f2;
}

/* ─── Teilen-Modal ──────────────────────────────────────────────────────── */
.files-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 20px;
}
.files-modal {
  background: var(--color-bg);
  border-radius: 10px;
  width: 100%;
  max-width: 520px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}
.files-modal-header {
  padding: 18px 20px;
  border-bottom: 1px solid var(--color-border-subtle);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.files-modal-title {
  font-size: 15px;
  font-weight: 600;
  margin: 4px 0 0 0;
  letter-spacing: -0.01em;
  word-break: break-word;
}
.files-modal-close {
  background: transparent;
  border: 0;
  cursor: pointer;
  width: 28px;
  height: 28px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.files-modal-close:hover {
  background: var(--color-bg-subtle);
}
.files-modal-section {
  padding: 16px 20px;
  border-top: 1px solid var(--color-border-subtle);
}
.files-modal-section:first-of-type {
  border-top: 0;
}
.files-modal-section-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  margin-bottom: 10px;
}
.files-modal-empty {
  font-size: 12px;
  color: var(--color-text-tertiary);
  padding: 8px 0;
}
.files-modal-share-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
}
.files-modal-share-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}
.files-modal-share-name {
  font-size: 13px;
  font-weight: 500;
}
.files-modal-share-username {
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-family: "JetBrains Mono", monospace;
}
.files-modal-pill {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #dcfce7;
  color: #166534;
  font-weight: 500;
}
.files-modal-pill-muted {
  background: var(--color-border-subtle);
  color: var(--color-text-muted);
}
.files-modal-share-remove {
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 4px 10px;
  color: var(--color-text-muted);
  cursor: pointer;
}
.files-modal-share-remove:hover:not(:disabled) {
  background: #fef2f2;
  color: #dc2626;
  border-color: #fecaca;
}
.files-modal-add-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.files-modal-input {
  flex: 1;
  min-width: 180px;
  padding: 7px 10px;
  font-size: 13px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
  outline: 0;
}
.files-modal-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-muted);
  cursor: pointer;
}
.files-modal-candidates {
  max-height: 240px;
  overflow-y: auto;
  margin: 0 -8px;
}
.files-modal-candidate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.files-modal-candidate:hover:not(:disabled) {
  background: var(--color-bg-subtle);
}
.files-modal-candidate:disabled {
  opacity: 0.6;
  cursor: default;
}
.files-modal-candidate-info {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.files-modal-candidate-name {
  font-size: 13px;
  font-weight: 500;
}
.files-modal-candidate-username {
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-family: "JetBrains Mono", monospace;
}
.files-modal-candidate-add {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 500;
}

/* Star nicht im Active-State (selected file in dunkel) ueberdecken */
.files-list-row-active .files-row-star {
  color: rgba(255, 255, 255, 0.7);
}
.files-list-row-active .files-row-star-on {
  color: #fbbf24;
}
</style>
