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
import { useConfirm } from "../composables/useConfirm";

const { confirm } = useConfirm();

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
  if (!(await confirm({ message: `Datei "${node.name}" wirklich löschen?`, confirmDanger: true }))) return;
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
  <div class="fb-root" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <!-- ─── Page-Head ──────────────────────────────────────────── -->
    <header class="ap-pagehead fb-pagehead">
      <div class="fb-pagehead-left">
        <h1>Dateien</h1>
        <p>Projektübergreifende Ablage — Pläne, Dokumente und Schriftverkehr.</p>
      </div>
      <div class="fb-pagehead-actions">
        <button class="pt-btn pt-btn--secondary" :disabled="uploading" @click="triggerUpload">
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
          <span>{{ uploading ? "Hochladen…" : "Hochladen" }}</span>
        </button>
        <input ref="fileInputRef" type="file" multiple style="display: none" @change="onFileInput" />
      </div>
    </header>

    <!-- Upload-Feedback -->
    <div v-if="uploadMsg" class="fb-upload-msg">{{ uploadMsg }}</div>

    <!-- ─── Toolbar ────────────────────────────────────────────── -->
    <div class="ap-toolbar fb-toolbar">
      <!-- Sidebar-Toggle -->
      <button
        class="pt-btn pt-btn--ghost fb-icon-btn"
        :class="{ 'fb-icon-btn--active': sidebarOpen }"
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
      <div class="fb-nav-btns">
        <button class="pt-btn pt-btn--ghost fb-icon-btn" :disabled="path.length === 0" @click="onBack" title="Zurück">
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
        <button
          class="pt-btn pt-btn--ghost fb-icon-btn"
          :disabled="historyForward.length === 0"
          @click="onForward"
          title="Weiter"
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
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <!-- Breadcrumb -->
      <div class="fb-breadcrumb">
        <template v-for="(seg, i) in breadcrumb" :key="i">
          <span v-if="i > 0" class="fb-breadcrumb-sep">/</span>
          <button
            class="fb-breadcrumb-seg"
            :class="{ 'fb-breadcrumb-seg--active': i === breadcrumb.length - 1 }"
            @click="onBreadcrumbClick(i)"
          >
            {{ seg }}
          </button>
        </template>
      </div>

      <div class="fb-toolbar-gap"></div>

      <!-- View-Segmented-Control -->
      <div class="pt-tabs fb-view-tabs">
        <button
          v-for="opt in [
            { v: 'column', label: 'Spalten' },
            { v: 'list', label: 'Liste' },
            { v: 'icons', label: 'Symbole' },
          ]"
          :key="opt.v"
          class="pt-tab"
          :class="{ 'pt-tab--active': view === opt.v }"
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
      <div class="ap-search fb-search">
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
        <input v-model="searchTerm" class="pt-input" placeholder="Im Vault suchen…" />
      </div>
    </div>

    <!-- ─── Body: Sidebar + Browser ───────────────────────────── -->
    <div class="fb-body">
      <!-- Sidebar -->
      <aside v-if="sidebarOpen" class="fb-sidebar">
        <div class="fb-sidebar-scroll">
          <!-- Section: Vault -->
          <div class="fb-sidebar-section">
            <div class="fb-sidebar-label">Vault</div>
            <div
              class="fb-sidebar-item"
              :class="{ 'fb-sidebar-item--active': mode === 'all' && path.length === 0 && !searchTerm }"
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
              class="fb-sidebar-item"
              :class="{ 'fb-sidebar-item--active': mode === 'recent' }"
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
            <div
              class="fb-sidebar-item"
              :class="{ 'fb-sidebar-item--active': mode === 'starred' }"
              @click="setMode('starred')"
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
                <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2" />
              </svg>
              <span>Markiert</span>
            </div>
            <div
              class="fb-sidebar-item"
              :class="{ 'fb-sidebar-item--active': mode === 'shared' }"
              @click="setMode('shared')"
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
                <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
                <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
              </svg>
              <span>Geteilt</span>
            </div>
          </div>

          <!-- Section: Hierarchie -->
          <div class="fb-sidebar-section">
            <div class="fb-sidebar-label">Hierarchie</div>
            <div
              class="fb-sidebar-item"
              :class="{ 'fb-sidebar-item--active': mode === 'all' && path[0] === 'Projekte' }"
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
              class="fb-sidebar-item"
              :class="{ 'fb-sidebar-item--active': mode === 'all' && path[0] === 'Privat' }"
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
          <div class="fb-sidebar-section">
            <div class="fb-sidebar-label">Speicher</div>
            <div class="fb-sidebar-item fb-sidebar-item--disabled">
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
              <span class="pt-badge pt-badge--neutral fb-sidebar-badge">self-hosted</span>
            </div>
            <div class="fb-sidebar-item fb-sidebar-item--disabled">
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
              <span class="pt-badge pt-badge--neutral fb-sidebar-badge">{{ totalSizeLabel }}</span>
            </div>
          </div>
        </div>

        <!-- Storage-Footer -->
        <div class="fb-sidebar-footer">
          <div class="fb-storage-row">
            <span>Speicher</span>
            <span class="fb-mono">{{ totalSizeLabel }} / 50 GB</span>
          </div>
          <div class="fb-storage-bar">
            <div
              class="fb-storage-bar-fill"
              :style="{ width: Math.min(100, (totalSizeBytes / (50 * 1024 * 1024 * 1024)) * 100) + '%' }"
            ></div>
          </div>
          <div class="fb-storage-sub fb-mono">
            {{ totalFileCount }} Datei<span v-if="totalFileCount !== 1">en</span> · DSGVO-konform
          </div>
        </div>
      </aside>

      <!-- Browser-Wrapper (Browser + Statusleiste) -->
      <div class="fb-browser-wrap" :class="{ 'fb-browser-wrap--with-sidebar': sidebarOpen }">
        <!-- Loading-Empty-State -->
        <div v-if="loading && allFiles.length === 0" class="ap-empty">Laedt…</div>

        <!-- ══ Vollbild-Vorschau (ersetzt Browser wenn Datei geöffnet) ══ -->
        <div v-else-if="selected?.node && selected.node.kind !== 'folder'" class="fb-detail-full">
          <!-- Topbar -->
          <div class="fb-detail-topbar">
            <button class="pt-btn pt-btn--ghost fb-detail-back" @click="selected = null">
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
            <span class="fb-detail-breadcrumb">{{ selected.node.name }}</span>
            <button
              class="fb-preview-star"
              :class="{ 'fb-preview-star--on': selected.node.starred }"
              @click="toggleStar(selected.node)"
              :title="selected.node.starred ? 'Markierung entfernen' : 'Markieren'"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                :fill="selected.node.starred ? 'currentColor' : 'none'"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2" />
              </svg>
            </button>
          </div>

          <!-- Body: Info-Spalte links + Inhalt rechts -->
          <div class="fb-detail-body">
            <!-- Info-Panel -->
            <div class="fb-detail-info ap-panel">
              <div class="fb-preview-hero">
                <img
                  v-if="selected.node.kind === 'image' && selected.node.id"
                  :src="downloadUrl(selected.node)"
                  :alt="selected.node.name"
                  class="fb-preview-image"
                />
                <FileGlyph v-else :kind="selected.node.kind" size="hero" />
              </div>
              <div>
                <div class="fb-preview-name" :class="{ 'fb-mono': isMonoKind(selected.node.kind) }">
                  {{ selected.node.name }}
                </div>
                <div class="fb-preview-sub">{{ kindLabel(selected.node.kind) }}</div>
              </div>
              <div class="fb-preview-meta">
                <div class="fb-preview-row">
                  <span class="fb-preview-key">Größe</span>
                  <span class="fb-preview-val fb-mono">{{ selected.node.size ?? "—" }}</span>
                </div>
                <div class="fb-preview-row">
                  <span class="fb-preview-key">Geändert</span>
                  <span class="fb-preview-val fb-mono">{{ selected.node.updated ?? "—" }}</span>
                </div>
                <div class="fb-preview-row">
                  <span class="fb-preview-key">Projekt</span>
                  <span class="fb-preview-val">{{ selected.node.project ?? "—" }}</span>
                </div>
                <div class="fb-preview-row">
                  <span class="fb-preview-key">Speicher</span>
                  <span class="fb-preview-val fb-mono">bau-os.local</span>
                </div>
              </div>
              <div class="fb-preview-actions">
                <a class="pt-btn pt-btn--primary fb-preview-btn-open" :href="downloadUrl(selected.node)" target="_blank"
                  >Öffnen</a
                >
                <button class="pt-btn pt-btn--secondary" @click="openShareModal(selected.node)">Teilen</button>
                <div class="files-preview-actions-menu-wrap fb-action-menu-wrap">
                  <button
                    class="pt-btn pt-btn--secondary fb-action-menu-trigger"
                    @click="actionMenuOpen = !actionMenuOpen"
                    :class="{ 'fb-action-menu-trigger--open': actionMenuOpen }"
                    title="Mehr"
                  >
                    ···
                  </button>
                  <div v-if="actionMenuOpen" class="fb-action-menu" @click.stop>
                    <button
                      class="fb-action-item"
                      @click="
                        actionMenuOpen = false;
                        toggleStar(selected.node);
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
                        <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2" />
                      </svg>
                      {{ selected.node.starred ? "Markierung entfernen" : "Markieren" }}
                    </button>
                    <a
                      class="fb-action-item"
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
                    <button
                      class="fb-action-item"
                      @click="
                        actionMenuOpen = false;
                        openShareModal(selected.node);
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
                        <circle cx="18" cy="5" r="3" />
                        <circle cx="6" cy="12" r="3" />
                        <circle cx="18" cy="19" r="3" />
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                      </svg>
                      Teilen…
                    </button>
                    <div class="fb-action-divider"></div>
                    <button
                      class="fb-action-item fb-action-item--danger"
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
            <div class="fb-detail-content">
              <iframe
                v-if="selected.node.kind === 'pdf' && selected.node.id"
                :src="downloadUrl(selected.node)"
                class="fb-detail-pdf"
                :title="selected.node.name"
              />
              <img
                v-else-if="selected.node.kind === 'image' && selected.node.id"
                :src="downloadUrl(selected.node)"
                :alt="selected.node.name"
                class="fb-detail-img"
              />
              <div v-else-if="previewIsMarkdown && previewContent" class="fb-detail-md">
                <MarkdownRenderer :content="previewContent" />
              </div>
              <pre v-else-if="previewContent" class="fb-detail-code">{{ previewContent }}</pre>
              <div v-else-if="previewLoading" class="fb-preview-loading">Lädt…</div>
              <div v-else class="fb-detail-empty">
                <FileGlyph :kind="selected.node.kind" size="hero" />
                <p>Keine Vorschau verfügbar.</p>
                <a class="pt-btn pt-btn--secondary" :href="downloadUrl(selected.node)" target="_blank">Datei öffnen</a>
              </div>
            </div>
          </div>
        </div>

        <!-- ══ Spalten-View ══ -->
        <div v-else-if="view === 'column'" class="fb-columns">
          <div v-for="(col, idx) in columns" :key="idx" class="fb-column">
            <div class="fb-column-header">
              <span>{{ col.parent.kind === "root" ? "Vault" : col.parent.name }}</span>
              <span class="fb-mono fb-column-count">{{ col.items.length }}</span>
            </div>
            <div class="fb-column-body">
              <div
                v-for="(it, i) in col.items"
                :key="i"
                class="pt-list-item fb-row"
                :class="{
                  'fb-row--active':
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
                  class="pt-li-title fb-row-name"
                  :class="{ 'fb-mono': isMonoKind(it.kind) }"
                  :style="{ fontSize: isMonoKind(it.kind) ? '12px' : '13px' }"
                  >{{ it.name }}</span
                >
                <button
                  v-if="it.kind !== 'folder' && it.id"
                  class="fb-row-star"
                  :class="{
                    'fb-row-star--on': it.starred,
                    'fb-row-star--active-row': selected?.columnIndex === idx && selected?.node?.name === it.name,
                  }"
                  @click="toggleStar(it, $event)"
                  :title="it.starred ? 'Markierung entfernen' : 'Markieren'"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    :fill="it.starred ? 'currentColor' : 'none'"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2" />
                  </svg>
                </button>
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
                  class="fb-row-chev"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
              <div v-if="col.items.length === 0" class="fb-empty-col">Leer</div>
            </div>
          </div>
        </div>

        <!-- ══ Liste-View ══ -->
        <div v-else-if="view === 'list'" class="fb-list">
          <div class="fb-list-header"><span>Name</span><span>Geändert</span><span>Größe</span><span>Art</span></div>
          <div
            v-for="(it, i) in currentFolder.children ?? []"
            :key="i"
            class="fb-list-row"
            :class="{ 'fb-list-row--active': selected?.node?.name === it.name }"
            @click="onClickItem(it, path.length)"
          >
            <span class="fb-list-name">
              <FileGlyph :kind="it.kind" :active="selected?.node?.name === it.name" />
              <span
                :class="{ 'fb-mono': isMonoKind(it.kind) }"
                :style="{ fontSize: isMonoKind(it.kind) ? '12px' : '13px' }"
                >{{ it.name }}</span
              >
              <button
                v-if="it.kind !== 'folder' && it.id"
                class="fb-row-star fb-row-star--inline"
                :class="{
                  'fb-row-star--on': it.starred,
                  'fb-row-star--active-row': selected?.node?.name === it.name,
                }"
                @click="toggleStar(it, $event)"
                :title="it.starred ? 'Markierung entfernen' : 'Markieren'"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  :fill="it.starred ? 'currentColor' : 'none'"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2" />
                </svg>
              </button>
            </span>
            <span class="fb-mono fb-list-meta">{{ it.updated ?? "—" }}</span>
            <span class="fb-mono fb-list-meta">{{ it.size ?? "—" }}</span>
            <span class="fb-list-kind">{{ kindLabel(it.kind) }}</span>
          </div>
          <div v-if="(currentFolder.children?.length ?? 0) === 0" class="ap-empty">Keine Dateien in diesem Ordner.</div>
        </div>

        <!-- ══ Symbole-View ══ -->
        <div v-else class="fb-icons">
          <div
            v-for="(it, i) in currentFolder.children ?? []"
            :key="i"
            class="fb-icon-cell"
            :class="{ 'fb-icon-cell--active': selected?.node?.name === it.name }"
            @click="onClickItem(it, path.length)"
          >
            <FileGlyph :kind="it.kind" size="large" :active="selected?.node?.name === it.name" />
            <span class="fb-icon-name" :class="{ 'fb-mono': isMonoKind(it.kind) }">{{ it.name }}</span>
          </div>
          <div v-if="(currentFolder.children?.length ?? 0) === 0" class="ap-empty">Keine Dateien in diesem Ordner.</div>
        </div>

        <!-- Status-Bar -->
        <div class="fb-status">
          <span>{{ statusLeft }}</span>
          <span class="fb-status-spacer"></span>
          <span>{{ statusRight }}</span>
        </div>
      </div>
    </div>

    <!-- Drag-Overlay -->
    <div v-if="dragging" class="fb-drag-overlay">
      <div class="fb-drag-card">Dateien hier ablegen</div>
    </div>

    <!-- ─── Teilen-Modal ──────────────────────────────────────── -->
    <div v-if="shareModalOpen" class="fb-modal-backdrop" @click="closeShareModal">
      <div class="fb-modal" @click.stop>
        <div class="fb-modal-header">
          <div>
            <div class="fb-eyebrow">Teilen</div>
            <h3 class="fb-modal-title">{{ shareModalFile?.name ?? "Datei" }}</h3>
          </div>
          <button class="pt-btn pt-btn--ghost fb-modal-close" @click="closeShareModal" title="Schließen">
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
        <div class="fb-modal-section">
          <div class="fb-modal-section-label">Aktuell geteilt mit</div>
          <div v-if="shareModalShares.length === 0" class="ap-empty fb-modal-empty">Noch mit niemandem geteilt.</div>
          <div v-for="s in shareModalShares" :key="s.userId" class="fb-modal-share-row">
            <div class="fb-modal-share-info">
              <span class="fb-modal-share-name">{{ s.displayName ?? s.username }}</span>
              <span v-if="s.displayName" class="fb-modal-share-username fb-mono">@{{ s.username }}</span>
              <span v-if="s.canEdit" class="pt-badge pt-badge--green">Bearbeiten</span>
              <span v-else class="pt-badge pt-badge--neutral">Lesen</span>
            </div>
            <button
              class="pt-btn pt-btn--ghost fb-modal-remove-btn"
              :disabled="shareModalBusy"
              @click="removeShare(s.userId)"
            >
              Entfernen
            </button>
          </div>
        </div>

        <!-- Hinzufuegen -->
        <div class="fb-modal-section">
          <div class="fb-modal-section-label">Hinzufügen</div>
          <div class="fb-modal-add-controls">
            <input
              v-model="shareModalSearchTerm"
              type="text"
              placeholder="Benutzer suchen…"
              class="pt-input fb-modal-input"
            />
            <label class="fb-modal-checkbox">
              <input v-model="shareModalCanEdit" type="checkbox" />
              <span>Bearbeiten erlauben</span>
            </label>
          </div>
          <div class="fb-modal-candidates">
            <div v-if="shareModalCandidates.length === 0" class="ap-empty fb-modal-empty">
              {{ shareModalSearchTerm ? "Keine Treffer." : "Alle verfügbaren User sind bereits hinzugefügt." }}
            </div>
            <button
              v-for="u in shareModalCandidates.slice(0, 50)"
              :key="u.id"
              class="fb-modal-candidate"
              :disabled="shareModalBusy"
              @click="addShare(u.id)"
            >
              <div class="fb-modal-candidate-info">
                <span class="fb-modal-candidate-name">{{ u.displayName ?? u.username }}</span>
                <span v-if="u.displayName" class="fb-modal-candidate-username fb-mono">@{{ u.username }}</span>
              </div>
              <span class="fb-modal-candidate-add">+ Hinzufügen</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Root ──────────────────────────────────────────────────── */
.fb-root {
  height: calc(100vh - 0px);
  display: flex;
  flex-direction: column;
  background: var(--surface-base, var(--color-bg));
  color: var(--fg-body, var(--color-text));
  overflow: hidden;
  position: relative;
}

/* ── Page-Head ─────────────────────────────────────────────── */
.fb-pagehead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-16, 16px);
  padding: var(--space-20, 20px) var(--space-24, 24px) var(--space-16, 16px);
  border-bottom: 1px solid var(--border-subtle, var(--color-border-subtle));
  flex-shrink: 0;
}
.fb-pagehead h1 {
  font-size: var(--fs-20, 20px);
  font-weight: var(--fw-semibold, 600);
  color: var(--fg-title, var(--color-text));
  margin: 0;
  letter-spacing: -0.01em;
}
.fb-pagehead p {
  font-size: var(--fs-13, 13px);
  color: var(--fg-muted, var(--color-text-muted));
  margin: var(--space-4, 4px) 0 0;
}
.fb-pagehead-left {
  flex: 1;
  min-width: 0;
}
.fb-pagehead-actions {
  display: flex;
  align-items: center;
  gap: var(--space-8, 8px);
  flex-shrink: 0;
}

/* ── Upload message ────────────────────────────────────────── */
.fb-upload-msg {
  background: var(--surface-muted, var(--color-bg-subtle));
  border-bottom: 1px solid var(--border-subtle, var(--color-border-subtle));
  padding: var(--space-8, 8px) var(--space-24, 24px);
  font-size: var(--fs-12, 12px);
  color: var(--fg-muted, var(--color-text-muted));
}

/* ── Toolbar ───────────────────────────────────────────────── */
.fb-toolbar {
  height: 48px;
  padding: 0 var(--space-16, 16px);
  display: flex;
  align-items: center;
  gap: var(--space-8, 8px);
  border-bottom: 1px solid var(--border-subtle, var(--color-border-subtle));
  flex-shrink: 0;
  background: var(--surface-base, var(--color-bg));
}
.fb-toolbar-gap {
  flex: 1;
}

.fb-icon-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.fb-icon-btn--active {
  background: var(--surface-muted, var(--color-border-subtle));
}
.fb-nav-btns {
  display: flex;
  gap: 2px;
}

/* Breadcrumb */
.fb-breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--space-4, 4px);
  min-width: 0;
  overflow: hidden;
}
.fb-breadcrumb-sep {
  color: var(--fg-faint, var(--color-text-faint));
  font-size: var(--fs-12, 12px);
}
.fb-breadcrumb-seg {
  background: transparent;
  border: 0;
  font-size: var(--fs-13, 13px);
  color: var(--fg-muted, var(--color-text-muted));
  font-weight: 400;
  padding: 3px 6px;
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: background 80ms ease;
}
.fb-breadcrumb-seg:hover {
  background: var(--surface-muted, var(--color-bg-subtle));
}
.fb-breadcrumb-seg--active {
  color: var(--fg-title, var(--color-text));
  font-weight: 500;
}

/* View tabs */
.fb-view-tabs {
  display: flex;
  border: 1px solid var(--border-default, var(--color-border));
  border-radius: var(--radius-sm, 6px);
  overflow: hidden;
  flex-shrink: 0;
}
.fb-view-tabs .pt-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  font-size: var(--fs-12, 12px);
  border-radius: 0;
  border: 0;
}
.fb-view-tabs .pt-tab + .pt-tab {
  border-left: 1px solid var(--border-subtle, var(--color-border-subtle));
}

/* Search */
.fb-search {
  display: flex;
  align-items: center;
  gap: var(--space-8, 8px);
  padding: 5px 10px;
  border: 1px solid var(--border-default, var(--color-border));
  border-radius: var(--radius-sm, 6px);
  width: 200px;
  background: var(--surface-base, var(--color-bg));
  color: var(--fg-muted, var(--color-text-muted));
  flex-shrink: 0;
}
.fb-search .pt-input {
  border: 0;
  outline: 0;
  background: transparent;
  font-size: var(--fs-12, 12px);
  flex: 1;
  min-width: 0;
  padding: 0;
  box-shadow: none;
}

/* ── Body ──────────────────────────────────────────────────── */
.fb-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* ── Sidebar ───────────────────────────────────────────────── */
.fb-sidebar {
  width: 220px;
  background: var(--surface-muted, var(--color-bg-subtle));
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle, var(--color-border-subtle));
}
.fb-sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-12, 12px) 0;
}
.fb-sidebar-section {
  margin-bottom: var(--space-16, 16px);
}
.fb-sidebar-label {
  padding: 0 var(--space-16, 16px) var(--space-6, 6px);
  font-size: var(--fs-10, 10px);
  font-weight: var(--fw-semibold, 600);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-faint, var(--color-text-tertiary));
}
.fb-sidebar-item {
  display: flex;
  align-items: center;
  gap: var(--space-10, 10px);
  padding: 5px var(--space-16, 16px);
  font-size: var(--fs-13, 13px);
  color: var(--fg-secondary, var(--color-text-secondary));
  background: transparent;
  border-left: 2px solid transparent;
  cursor: pointer;
  user-select: none;
}
.fb-sidebar-item:hover:not(.fb-sidebar-item--disabled):not(.fb-sidebar-item--active) {
  background: var(--border-subtle, var(--color-border-subtle));
}
.fb-sidebar-item--active {
  color: var(--fg-title, var(--color-text));
  background: var(--surface-base, var(--color-bg));
  border-left-color: var(--fg-title, var(--color-text));
  padding-left: 14px;
  font-weight: 500;
}
.fb-sidebar-item--disabled {
  color: var(--fg-faint, var(--color-text-tertiary));
  cursor: default;
}
.fb-sidebar-item > span:first-of-type {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fb-sidebar-badge {
  font-size: 9px;
  flex-shrink: 0;
}
.fb-sidebar-footer {
  padding: var(--space-12, 12px) var(--space-16, 16px);
  border-top: 1px solid var(--border-subtle, var(--color-border-subtle));
  font-size: var(--fs-11, 11px);
  color: var(--fg-muted, var(--color-text-muted));
}
.fb-storage-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--space-6, 6px);
}
.fb-storage-row .fb-mono {
  color: var(--fg-title, var(--color-text));
}
.fb-storage-bar {
  height: 3px;
  background: var(--border-default, var(--color-border));
  border-radius: 2px;
  overflow: hidden;
}
.fb-storage-bar-fill {
  height: 100%;
  background: var(--fg-title, var(--color-text));
  transition: width 300ms ease;
}
.fb-storage-sub {
  margin-top: var(--space-8, 8px);
  font-size: 10px;
  color: var(--fg-faint, var(--color-text-tertiary));
}

/* ── Browser-Wrap ──────────────────────────────────────────── */
.fb-browser-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--surface-base, var(--color-bg));
}
.fb-browser-wrap--with-sidebar {
  /* border already on sidebar right side */
}

/* ── Vollbild-Detail ───────────────────────────────────────── */
.fb-detail-full {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.fb-detail-topbar {
  height: 48px;
  border-bottom: 1px solid var(--border-subtle, var(--color-border-subtle));
  display: flex;
  align-items: center;
  gap: var(--space-12, 12px);
  padding: 0 var(--space-20, 20px);
  flex-shrink: 0;
}
.fb-detail-back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-13, 13px);
  flex-shrink: 0;
}
.fb-detail-breadcrumb {
  flex: 1;
  font-size: var(--fs-14, 14px);
  font-weight: var(--fw-semibold, 600);
  color: var(--fg-title, var(--color-text));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fb-detail-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}
.fb-detail-info {
  width: 280px;
  min-width: 280px;
  border-right: 1px solid var(--border-subtle, var(--color-border-subtle));
  padding: var(--space-20, 20px);
  display: flex;
  flex-direction: column;
  gap: var(--space-16, 16px);
  overflow-y: auto;
  background: var(--surface-muted, var(--color-bg-subtle));
  border-radius: 0;
}
.fb-detail-content {
  flex: 1;
  overflow: auto;
  padding: var(--space-24, 24px) var(--space-32, 32px);
  background: var(--surface-base, var(--color-bg));
  display: flex;
  flex-direction: column;
}
.fb-detail-pdf {
  flex: 1;
  width: 100%;
  min-height: 600px;
  border: 1px solid var(--border-subtle, var(--color-border-subtle));
  border-radius: var(--radius-sm, 6px);
}
.fb-detail-img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  display: block;
  margin: 0 auto;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--border-subtle, var(--color-border-subtle));
}
.fb-detail-md {
  max-width: 800px;
  width: 100%;
}
.fb-detail-code {
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: var(--fs-12, 12px);
  line-height: 1.6;
  color: var(--fg-body, var(--color-text));
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--surface-muted, var(--color-bg-subtle));
  border: 1px solid var(--border-subtle, var(--color-border-subtle));
  border-radius: var(--radius-sm, 6px);
  padding: var(--space-20, 20px) var(--space-24, 24px);
  margin: 0;
}
.fb-detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-12, 12px);
  height: 100%;
  color: var(--fg-faint, var(--color-text-tertiary));
  font-size: var(--fs-13, 13px);
}

/* Preview info panel */
.fb-preview-hero {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 16px;
  background: var(--surface-base, var(--color-bg));
  border: 1px solid var(--border-subtle, var(--color-border-subtle));
  border-radius: var(--radius-sm, 6px);
}
.fb-preview-image {
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
  display: block;
}
.fb-preview-name {
  font-size: var(--fs-14, 14px);
  font-weight: var(--fw-semibold, 600);
  word-break: break-word;
  color: var(--fg-title, var(--color-text));
}
.fb-preview-sub {
  font-size: var(--fs-11, 11px);
  color: var(--fg-faint, var(--color-text-tertiary));
  margin-top: 3px;
}
.fb-preview-meta {
  display: flex;
  flex-direction: column;
  gap: var(--space-8, 8px);
  font-size: var(--fs-12, 12px);
  padding-top: var(--space-12, 12px);
  border-top: 1px solid var(--border-subtle, var(--color-border-subtle));
}
.fb-preview-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-12, 12px);
}
.fb-preview-key {
  color: var(--fg-faint, var(--color-text-tertiary));
}
.fb-preview-val {
  text-align: right;
  color: var(--fg-body, var(--color-text));
  font-size: var(--fs-11, 11px);
}
.fb-preview-actions {
  display: flex;
  gap: var(--space-6, 6px);
  flex-wrap: wrap;
}
.fb-preview-btn-open {
  flex: 2;
  text-align: center;
  text-decoration: none;
  justify-content: center;
}
.fb-preview-star {
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm, 4px);
  color: var(--fg-faint, var(--color-text-faint));
  display: inline-flex;
  align-items: center;
}
.fb-preview-star:hover {
  background: var(--surface-muted, var(--color-bg-subtle));
}
.fb-preview-star--on {
  color: #f59e0b;
}
.fb-preview-loading {
  font-size: var(--fs-12, 12px);
  color: var(--fg-faint, var(--color-text-tertiary));
  text-align: center;
  padding: var(--space-12, 12px) 0;
}

/* Action-Menu */
.fb-action-menu-wrap {
  position: relative;
  flex: 1;
}
.fb-action-menu-wrap .pt-btn {
  width: 100%;
}
.fb-action-menu-trigger--open {
  background: var(--surface-muted, var(--color-border-subtle));
}
.fb-action-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  min-width: 200px;
  background: var(--surface-base, var(--color-bg));
  border: 1px solid var(--border-default, var(--color-border));
  border-radius: var(--radius-sm, 6px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
  padding: 4px;
  z-index: 20;
}
.fb-action-item {
  display: flex;
  align-items: center;
  gap: var(--space-8, 8px);
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs, 4px);
  font-size: var(--fs-12, 12px);
  font-family: inherit;
  color: var(--fg-body, var(--color-text));
  cursor: pointer;
  text-align: left;
  text-decoration: none;
}
.fb-action-item:hover {
  background: var(--surface-muted, var(--color-bg-subtle));
}
.fb-action-item svg {
  color: var(--fg-muted, var(--color-text-muted));
  flex-shrink: 0;
}
.fb-action-divider {
  height: 1px;
  background: var(--border-subtle, var(--color-border-subtle));
  margin: 4px 0;
}
.fb-action-item--danger {
  color: var(--red-600, #dc2626);
}
.fb-action-item--danger svg {
  color: var(--red-600, #dc2626);
}
.fb-action-item--danger:hover {
  background: #fef2f2;
}

/* ── Spalten-View ──────────────────────────────────────────── */
.fb-columns {
  flex: 1;
  display: flex;
  overflow-x: auto;
  min-height: 0;
}
.fb-column {
  width: 240px;
  min-width: 240px;
  border-right: 1px solid var(--border-subtle, var(--color-border-subtle));
  display: flex;
  flex-direction: column;
  background: var(--surface-base, var(--color-bg));
}
.fb-column-header {
  padding: 10px 14px 8px;
  border-bottom: 1px solid var(--border-subtle, var(--color-border-subtle));
  font-size: 10px;
  font-weight: var(--fw-semibold, 600);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-faint, var(--color-text-tertiary));
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.fb-column-count {
  color: var(--fg-faint, var(--color-text-faint));
}
.fb-column-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.fb-row {
  display: flex;
  align-items: center;
  gap: var(--space-8, 8px);
  padding: 6px 14px;
  cursor: pointer;
  background: transparent;
  color: var(--fg-body, var(--color-text));
  border-bottom: none;
  border-radius: 0;
}
.fb-row:hover:not(.fb-row--active) {
  background: var(--surface-muted, var(--color-bg-subtle));
}
.fb-row--active {
  background: var(--fg-title, var(--color-text));
  color: var(--surface-base, var(--color-bg));
  font-weight: 500;
}
.fb-row-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--fs-13, 13px);
}
.fb-row-chev {
  color: var(--fg-faint, var(--color-text-faint));
}
.fb-row--active .fb-row-chev {
  color: var(--surface-base, var(--color-bg));
}
.fb-empty-col {
  padding: var(--space-16, 16px) 14px;
  font-size: var(--fs-12, 12px);
  color: var(--fg-faint, var(--color-text-tertiary));
}

/* ── Liste-View ────────────────────────────────────────────── */
.fb-list {
  flex: 1;
  overflow-y: auto;
  background: var(--surface-base, var(--color-bg));
}
.fb-list-header {
  display: grid;
  grid-template-columns: 1fr 150px 90px 120px;
  padding: 8px var(--space-20, 20px);
  font-size: 10px;
  font-weight: var(--fw-semibold, 600);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-faint, var(--color-text-tertiary));
  background: var(--surface-muted, var(--color-bg-subtle));
  border-bottom: 1px solid var(--border-subtle, var(--color-border-subtle));
  position: sticky;
  top: 0;
  z-index: 1;
}
.fb-list-row {
  display: grid;
  grid-template-columns: 1fr 150px 90px 120px;
  padding: 9px var(--space-20, 20px);
  font-size: var(--fs-13, 13px);
  align-items: center;
  cursor: pointer;
  border-bottom: 1px solid var(--border-subtle, var(--color-border-subtle));
  background: var(--surface-base, var(--color-bg));
  color: var(--fg-body, var(--color-text));
  transition: background 60ms ease;
}
.fb-list-row:hover:not(.fb-list-row--active) {
  background: var(--surface-muted, var(--color-bg-subtle));
}
.fb-list-row--active {
  background: var(--fg-title, var(--color-text));
  color: var(--surface-base, var(--color-bg));
}
.fb-list-name {
  display: flex;
  align-items: center;
  gap: var(--space-8, 8px);
  min-width: 0;
}
.fb-list-name > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fb-list-meta {
  font-size: var(--fs-11, 11px);
  color: var(--fg-muted, var(--color-text-muted));
}
.fb-list-row--active .fb-list-meta {
  color: rgba(255, 255, 255, 0.65);
}
.fb-list-kind {
  font-size: var(--fs-11, 11px);
  color: var(--fg-faint, var(--color-text-tertiary));
}
.fb-list-row--active .fb-list-kind {
  color: rgba(255, 255, 255, 0.55);
}

/* ── Symbole-View ──────────────────────────────────────────── */
.fb-icons {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-20, 20px);
  background: var(--surface-base, var(--color-bg));
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--space-8, 8px);
  align-content: start;
}
.fb-icon-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-8, 8px);
  padding: 14px 8px;
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  background: transparent;
  color: var(--fg-body, var(--color-text));
  transition: background 60ms ease;
}
.fb-icon-cell:hover:not(.fb-icon-cell--active) {
  background: var(--surface-muted, var(--color-bg-subtle));
}
.fb-icon-cell--active {
  background: var(--fg-title, var(--color-text));
  color: var(--surface-base, var(--color-bg));
}
.fb-icon-name {
  font-size: var(--fs-12, 12px);
  text-align: center;
  line-height: 1.3;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Status-Bar ────────────────────────────────────────────── */
.fb-status {
  height: 26px;
  border-top: 1px solid var(--border-subtle, var(--color-border-subtle));
  background: var(--surface-muted, var(--color-bg-subtle));
  display: flex;
  align-items: center;
  padding: 0 14px;
  font-size: var(--fs-11, 11px);
  color: var(--fg-muted, var(--color-text-muted));
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.fb-status-spacer {
  flex: 1;
}

/* ── Star buttons ──────────────────────────────────────────── */
.fb-row-star {
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-faint, var(--color-text-faint));
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 80ms ease;
}
.fb-row:hover .fb-row-star,
.fb-row--active .fb-row-star,
.fb-row-star.fb-row-star--on,
.fb-list-row:hover .fb-row-star,
.fb-list-row--active .fb-row-star,
.fb-icon-cell:hover .fb-row-star,
.fb-icon-cell--active .fb-row-star {
  opacity: 1;
}
.fb-row-star:hover {
  background: rgba(0, 0, 0, 0.06);
}
.fb-row-star--on {
  color: #f59e0b;
}
.fb-row-star--active-row {
  color: rgba(255, 255, 255, 0.85) !important;
}
.fb-row-star--active-row.fb-row-star--on {
  color: #fbbf24 !important;
}
.fb-row-star--inline {
  margin-left: 4px;
}
.fb-list-row--active .fb-row-star {
  color: rgba(255, 255, 255, 0.7);
}
.fb-list-row--active .fb-row-star--on {
  color: #fbbf24;
}

/* ── Drag-Overlay ──────────────────────────────────────────── */
.fb-drag-overlay {
  position: absolute;
  inset: 0;
  background: rgba(17, 24, 39, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  pointer-events: none;
}
.fb-drag-card {
  background: var(--surface-base, var(--color-bg));
  color: var(--fg-title, var(--color-text));
  padding: 20px 28px;
  border-radius: var(--radius-md, 8px);
  font-size: var(--fs-14, 14px);
  font-weight: 500;
  border: 2px dashed var(--fg-title, var(--color-text));
}

/* ── Teilen-Modal ──────────────────────────────────────────── */
.fb-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 20px;
}
.fb-modal {
  background: var(--surface-base, var(--color-bg));
  border-radius: var(--radius-md, 10px);
  width: 100%;
  max-width: 520px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default, var(--color-border));
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}
.fb-modal-header {
  padding: var(--space-16, 16px) var(--space-20, 20px);
  border-bottom: 1px solid var(--border-subtle, var(--color-border-subtle));
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-12, 12px);
}
.fb-eyebrow {
  font-size: var(--fs-10, 10px);
  font-weight: var(--fw-semibold, 600);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-faint, var(--color-text-tertiary));
}
.fb-modal-title {
  font-size: var(--fs-15, 15px);
  font-weight: var(--fw-semibold, 600);
  margin: 4px 0 0 0;
  letter-spacing: -0.01em;
  word-break: break-word;
  color: var(--fg-title, var(--color-text));
}
.fb-modal-close {
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.fb-modal-section {
  padding: var(--space-16, 16px) var(--space-20, 20px);
  border-top: 1px solid var(--border-subtle, var(--color-border-subtle));
  overflow-y: auto;
}
.fb-modal-section:first-of-type {
  border-top: 0;
}
.fb-modal-section-label {
  font-size: 10px;
  font-weight: var(--fw-semibold, 600);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-faint, var(--color-text-tertiary));
  margin-bottom: var(--space-8, 8px);
}
.fb-modal-empty {
  font-size: var(--fs-12, 12px);
  color: var(--fg-faint, var(--color-text-tertiary));
  padding: 6px 0;
  text-align: left;
}
.fb-modal-share-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12, 12px);
  padding: var(--space-8, 8px) 0;
}
.fb-modal-share-info {
  display: flex;
  align-items: center;
  gap: var(--space-8, 8px);
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}
.fb-modal-share-name {
  font-size: var(--fs-13, 13px);
  font-weight: 500;
}
.fb-modal-share-username {
  font-size: var(--fs-11, 11px);
  color: var(--fg-faint, var(--color-text-tertiary));
}
.fb-modal-remove-btn {
  font-size: var(--fs-12, 12px);
}
.fb-modal-add-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-8, 8px);
  margin-bottom: var(--space-8, 8px);
}
.fb-modal-input {
  flex: 1;
  min-width: 180px;
}
.fb-modal-checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--space-6, 6px);
  font-size: var(--fs-12, 12px);
  color: var(--fg-muted, var(--color-text-muted));
  cursor: pointer;
}
.fb-modal-candidates {
  max-height: 240px;
  overflow-y: auto;
  margin: 0 -8px;
}
.fb-modal-candidate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--space-8, 8px) 12px;
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs, 4px);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background 60ms ease;
}
.fb-modal-candidate:hover:not(:disabled) {
  background: var(--surface-muted, var(--color-bg-subtle));
}
.fb-modal-candidate:disabled {
  opacity: 0.6;
  cursor: default;
}
.fb-modal-candidate-info {
  display: flex;
  align-items: baseline;
  gap: var(--space-8, 8px);
  min-width: 0;
}
.fb-modal-candidate-name {
  font-size: var(--fs-13, 13px);
  font-weight: 500;
}
.fb-modal-candidate-username {
  font-size: var(--fs-11, 11px);
  color: var(--fg-faint, var(--color-text-tertiary));
}
.fb-modal-candidate-add {
  font-size: var(--fs-11, 11px);
  color: var(--fg-muted, var(--color-text-muted));
  font-weight: 500;
}

/* ── Mono helper ───────────────────────────────────────────── */
.fb-mono {
  font-family: var(--font-mono, "JetBrains Mono", monospace);
}

/* ── Mobile ────────────────────────────────────────────────── */
@media (max-width: 767.98px) {
  .fb-toolbar {
    height: auto;
    padding: var(--space-8, 8px) var(--space-12, 12px);
    flex-wrap: wrap;
    gap: var(--space-8, 8px);
  }
  .fb-breadcrumb {
    width: 100%;
    order: 10;
  }
  .fb-search {
    width: 100%;
    order: 11;
  }
  .fb-view-tabs {
    order: 12;
  }
  .fb-sidebar {
    width: 200px;
  }
  .fb-detail-info {
    width: 220px;
    min-width: 220px;
  }
  .fb-detail-content {
    padding: var(--space-16, 16px);
  }
  .fb-columns {
    flex-direction: column;
  }
  .fb-column {
    width: 100%;
    min-width: unset;
    border-right: 0;
    border-bottom: 1px solid var(--border-subtle, var(--color-border-subtle));
  }
  .fb-list-header,
  .fb-list-row {
    grid-template-columns: 1fr 90px;
  }
  .fb-list-header span:nth-child(2),
  .fb-list-row > span:nth-child(2),
  .fb-list-header span:nth-child(4),
  .fb-list-row > span:nth-child(4) {
    display: none;
  }
}
</style>
