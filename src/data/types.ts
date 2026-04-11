// ============================================================
// Bau-OS — Data Layer: Entity-Typen & Repository-Interfaces
// Gemeinsame Typen fuer Filesystem- und DB-Implementierungen.
// ============================================================

// ── Entity Types ─────────────────────────────────────────────

export interface Task {
  id: string;
  text: string;
  status: "open" | "in_progress" | "done";
  priority?: string;
  assignee: string | null;
  date: string | null;
  dueDate?: string | null;
  location: string | null;
  project: string | null;
  sortOrder?: number;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Termin {
  id: string;
  text: string;
  datum: string;
  uhrzeit: string | null;
  endzeit: string | null;
  location: string | null;
  assignees: string[];
  project: string | null;
  recurring?: string | null;
  color?: string | null;
  createdAt: string;
}

export interface Note {
  id?: string;
  title?: string;
  content: string;
  project?: string | null;
  tags?: string[];
  source?: string;
  pinned?: boolean;
  filepath?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Project {
  id?: string;
  name: string;
  folderPath?: string;
  description?: string | null;
  status?: string;
  color?: string | null;
  tags?: string[];
  notes: number;
  openTasks: number;
  termine: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileEntry {
  id: string;
  filename: string;
  filepath: string;
  filetype: string | null;
  filesize: number;
  mimeType: string | null;
  contentText: string | null;
  summary: string | null;
  project: string | null;
  tags: string[];
  analyzed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentLog {
  id?: string;
  sessionId: string;
  agentName: string;
  eventType: string;
  toolName?: string;
  parameters?: Record<string, unknown>;
  resultSummary?: string;
  thought?: string;
  error?: string;
  projectId?: string;
  durationMs?: number;
  createdAt?: string;
}

// ── Repository Interfaces ────────────────────────────────────

export interface TaskRepository {
  save(text: string, project?: string): Promise<Task>;
  list(project?: string): Promise<Task[]>;
  listOpen(project?: string): Promise<Task[]>;
  get(id: string, project?: string): Promise<Task | null>;
  update(id: string, updates: Partial<Task>, project?: string): Promise<Task | null>;
  complete(textOrId: string, project?: string): Promise<boolean>;
  delete(id: string, project?: string): Promise<boolean>;
}

export interface TerminRepository {
  save(datum: string, text: string, uhrzeit?: string, project?: string): Promise<Termin | string>;
  list(project?: string): Promise<Termin[]>;
  get(id: string, project?: string): Promise<Termin | null>;
  update(id: string, updates: Partial<Termin>, project?: string): Promise<Termin | null>;
  delete(textOrId: string, project?: string): Promise<boolean>;
}

export interface NoteSummary {
  title: string;
  project: string | null;
  createdAt: string;
  updatedAt: string;
  size: number;
}

export interface NoteRepository {
  save(content: string, project?: string): Promise<string>;
  list(limit?: number): Promise<string[]>;
  listDetailed?(limit?: number): Promise<NoteSummary[]>;
  read(nameOrPath: string): Promise<string | null>;
  append(nameOrPath: string, content: string): Promise<boolean>;
  update(nameOrPath: string, content: string): Promise<boolean>;
  delete(nameOrPath: string): Promise<string | null>;
}

export interface ProjectRepository {
  list(): Promise<string[]>;
  getInfo(name: string): Promise<Project | null>;
  listNotes(name: string): Promise<string[]>;
  readNote(project: string, noteName: string): Promise<string | null>;
}

export interface TeamRepository {
  list(): Promise<TeamMember[]>;
  get(id: string): Promise<TeamMember | null>;
  add(member: Omit<TeamMember, "id" | "createdAt" | "updatedAt">): Promise<TeamMember>;
  update(id: string, updates: Partial<TeamMember>): Promise<TeamMember | null>;
  remove(nameOrId: string): Promise<boolean>;
}

export interface FileRepository {
  save(file: {
    filename: string;
    filepath: string;
    filetype?: string;
    filesize: number;
    mimeType?: string;
    contentText?: string;
    project?: string;
  }): Promise<FileEntry>;
  list(project?: string, limit?: number): Promise<FileEntry[]>;
  get(id: string): Promise<FileEntry | null>;
  search(query: string, limit?: number): Promise<FileEntry[]>;
  delete(id: string): Promise<boolean>;
  updateContent(id: string, contentText: string): Promise<boolean>;
}

export interface AgentLogRepository {
  create(log: Omit<AgentLog, "id" | "createdAt">): Promise<AgentLog>;
  listBySession(sessionId: string, limit?: number): Promise<AgentLog[]>;
  listRecent(limit?: number, offset?: number): Promise<AgentLog[]>;
  query(filters: {
    sessionId?: string;
    agentName?: string;
    toolName?: string;
    projectId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<AgentLog[]>;
}
