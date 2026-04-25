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
  /** Migration 007: FK auf team_members. Wenn gesetzt, ist assigneeName aus
   *  dem Join verfuegbar; assignee (Text) bleibt als Legacy-Fallback. */
  assigneeId?: string | null;
  assigneeName?: string | null;
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
  /** Migration 007: UUID-Array der Team-Mitglieder. Entkoppelt von assignees
   *  (Freitext), damit sowohl Mitglieder als auch externe Namen dabei sein
   *  koennen. UI zeigt Namen aus assigneesResolved-Join, fallt auf assignees
   *  zurueck wenn keine Member-ID vorhanden. */
  assigneeIds?: string[];
  assigneesResolved?: { id: string; name: string }[];
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
  // Stammdaten (Migration 004) — strukturiert statt als Textblock in description.
  projektnummer?: string | null;
  bauherr?: string | null;
  standort?: string | null;
  projektart?: string | null;
  nutzung?: string | null;
  phase?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  // Verknuepfungen (Migration 005)
  /** FK auf team_members.id — wenn gesetzt, ist bauherrName verfuegbar. */
  bauherrId?: string | null;
  /** Nur read-only im Response, ausgejoined aus team_members.name. */
  bauherrName?: string | null;
  /** FK auf projects.id — uebergeordnetes Projekt (Sub-Projekt/Bauteil). */
  parentId?: string | null;
  /** Nur read-only im Response, ausgejoined aus projects.name. */
  parentName?: string | null;
  notes: number;
  openTasks: number;
  /** Erledigte Aufgaben — zusammen mit openTasks ergibt sich der Fortschritt.
   *  Optional fuer Rueckwaertskompatibilitaet mit aelteren Clients. */
  doneTasks?: number;
  termine: number;
  files?: number;
  /** Anzahl direkter Sub-Projekte (keine rekursive Summe). */
  childrenCount?: number;
  // ── Phase-3-ACL ────────────────────────────────────────
  /** UUID des Users, der das Projekt angelegt hat. NULL bei Legacy-
   *  Daten oder wenn der Ersteller geloescht wurde (ON DELETE SET NULL). */
  createdById?: string | null;
  /** Username des Erstellers (read-only, Join). */
  createdByUsername?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Eintrag aus user_projects-Junction — wer hat Zugriff auf welches
 *  Projekt. addedAt nur informativ. */
export interface ProjectAccessEntry {
  userId: string;
  username: string;
  displayName: string | null;
  role: "admin" | "user";
  addedAt: string;
}

/** Eintrag aus file_shares — wer darf eine Datei sehen / editieren. */
export interface FileShareEntry {
  fileId: string;
  userId: string;
  username: string;
  displayName: string | null;
  canEdit: boolean;
  addedAt: string;
}

/** Patchable Felder fuer projectRepo.update(). undefined = unveraendert,
 *  null = explizites Leeren einer Spalte. Der Projektname selbst ist
 *  NICHT patchable — Namensaenderungen erfordern einen separaten Flow
 *  (wegen FK-Konsistenz und URL-Stabilitaet im Frontend). */
export interface ProjectUpdate {
  description?: string | null;
  status?: string | null;
  color?: string | null;
  projektnummer?: string | null;
  bauherr?: string | null;
  standort?: string | null;
  projektart?: string | null;
  nutzung?: string | null;
  phase?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  bauherrId?: string | null;
  parentId?: string | null;
}

/** Stammdaten, die optional bei der Projekt-Erstellung mit uebergeben werden
 *  koennen. Ab Phase 1 werden sie strukturiert in Spalten persistiert; vorher
 *  landeten sie als Textblock in description. */
export interface ProjectCreateOptions {
  description?: string | null;
  projektnummer?: string | null;
  bauherr?: string | null;
  standort?: string | null;
  projektart?: string | null;
  nutzung?: string | null;
  phase?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/** Erlaubte Kategorien — konsistent mit dem CHECK-Constraint in Migration 006.
 *  NULL = unkategorisiert (erlaubt, fuer Legacy-Eintraege). */
export type MemberType = "Intern" | "Planer" | "Ausführende" | "Behörde" | "Lieferant" | "Bauherr";

/** Eintrag im Kontakt-Log (Phase 4). Wird in team_members.contact_log JSONB
 *  als Array gehalten; Schreibzugriffe haengen neue Eintraege ans Ende. */
export interface ContactLogEntry {
  ts: string;
  text: string;
  author?: string;
}

/** Kurzform der Projekt-Zuordnung eines Mitglieds, wie sie vom Repo-Join
 *  als Array geliefert wird. `projectRole` ist die projektspezifische Rolle,
 *  orthogonal zur generischen `role` des Mitglieds. */
export interface TeamMemberProject {
  id: string;
  name: string;
  projectRole: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  /** Legacy-Textfeld — seit Migration 006 ist companyId/companyName die
   *  Source-of-Truth. Bleibt als Fallback bis vollstaendig migriert. */
  company: string | null;
  /** Legacy-Einzelprojekt — ab Migration 006 M:N ueber project_team_members. */
  projectId: string | null;
  // Migration 006: neue Felder
  companyId: string | null;
  companyName: string | null;
  memberType: MemberType | null;
  /** Direkt zugeordnete Projekte (Junction-Array). Leer, wenn noch nichts
   *  zugeordnet oder Repo die Info nicht laedt. */
  projects: TeamMemberProject[];
  contactLog: ContactLogEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  id: string;
  name: string;
  address: string | null;
  website: string | null;
  notes: string | null;
  /** Anzahl zugeordneter Mitglieder — Repo berechnet via Subselect. */
  memberCount?: number;
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
  /** Liste der Projekt-Namen. Optional: visibleProjectIds als Filter
   *  ("all" = kein Filter, Array = nur diese IDs). Phase-4-Scoping. */
  list(visibleIds?: string[] | "all"): Promise<string[]>;
  getInfo(name: string): Promise<Project | null>;
  listNotes(name: string): Promise<string[]>;
  readNote(project: string, noteName: string): Promise<string | null>;
  /** Direkte Unter-Projekte (nicht rekursiv). Optional — fs-projects gibt
   *  einfach ein leeres Array zurueck, weil im FS-Mode keine Parent-Links
   *  gespeichert werden. */
  listChildren?(parentName: string): Promise<Array<{ id: string; name: string; status: string | null }>>;

  // ── Phase-3-ACL (DB-only) ──────────────────────────────
  /** Liefert alle User mit Zugriff auf ein Projekt. */
  listAccess?(projectId: string): Promise<Array<import("./types.js").ProjectAccessEntry>>;
  /** Gibt einem User Zugriff auf ein Projekt. Idempotent. */
  grantAccess?(projectId: string, userId: string): Promise<boolean>;
  /** Entzieht den Zugriff. Liefert false wenn kein Eintrag existierte. */
  revokeAccess?(projectId: string, userId: string): Promise<boolean>;
  /** Liste der Projekt-IDs, auf die ein User Zugriff hat (Phase-4-Helper). */
  listVisibleProjectIds?(userId: string): Promise<string[]>;
  /** Legt ein neues Projekt an. Gibt false zurueck, wenn der Name ungueltig ist
   *  oder das Projekt bereits existiert. Rueckwaertskompatibilitaet: wenn nur
   *  ein String als zweites Argument kommt, landet dieser in description.
   *  createdById (Phase 3) wird als users.id-FK gespeichert; im FS-Mode
   *  ignoriert. Wenn gesetzt, wird der User auch automatisch zur user_projects-
   *  Junction hinzugefuegt (im DB-Mode), damit der Ersteller sofortigen Zugriff
   *  hat. */
  create(name: string, options?: string | null | ProjectCreateOptions, createdById?: string | null): Promise<boolean>;
  /** Aktualisiert Stammdaten eines bestehenden Projekts. Nur Felder die im
   *  Patch gesetzt sind werden geaendert; undefined laesst unveraendert, null
   *  leert die Spalte explizit. Gibt false zurueck wenn Projekt nicht
   *  existiert oder Patch leer ist. */
  update(name: string, patch: ProjectUpdate): Promise<boolean>;
  /** Benennt ein Projekt um. Return-Codes:
   *   - "ok": umbenannt
   *   - "invalid": ungueltiger Name (Unicode/Slashes)
   *   - "not-found": altes Projekt existiert nicht
   *   - "conflict": neues Name-Projekt existiert schon
   *  Sicher bezueglich FKs: child-Eintraege haengen an projects.id (UUID),
   *  nicht am Namen — Umbenennung aendert nur die name-Spalte. */
  rename(oldName: string, newName: string): Promise<"ok" | "invalid" | "not-found" | "conflict">;
  /** Loescht ein Projekt komplett (DB-Eintrag + Vault-Ordner inkl. Inhalt).
   *  Idempotent: gibt true zurueck, wenn das Projekt am Ende wirklich weg
   *  ist (auch wenn es vorher schon nicht existierte). false nur bei echten
   *  Fehlern (z.B. ungueltiger Name, FS-Problem). */
  delete(name: string): Promise<boolean>;
}

/** Input-Shape fuers Anlegen — erlaubt companyName statt companyId, weil
 *  Caller oft nur den Namen haben. Das Repo erledigt den Lookup/Insert. */
export interface TeamMemberCreateInput {
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  memberType?: MemberType | null;
  projectId?: string | null;
}

export interface TeamMemberUpdateInput {
  name?: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  memberType?: MemberType | null;
  projectId?: string | null;
}

export interface TeamRepository {
  list(): Promise<TeamMember[]>;
  get(id: string): Promise<TeamMember | null>;
  add(member: TeamMemberCreateInput): Promise<TeamMember>;
  update(id: string, updates: TeamMemberUpdateInput): Promise<TeamMember | null>;
  remove(nameOrId: string): Promise<boolean>;

  // Migration 006: Junction-Management + Companies + Log.
  // Optional weil fs-team.ts das im FS-Mode nicht unterstuetzen muss;
  // Caller pruefen Verfuegbarkeit ueber ?.()-Operator.
  assignToProject?(memberId: string, projectId: string, projectRole?: string | null): Promise<boolean>;
  unassignFromProject?(memberId: string, projectId: string): Promise<boolean>;
  updateProjectRole?(memberId: string, projectId: string, projectRole: string | null): Promise<boolean>;
  appendLog?(memberId: string, entry: ContactLogEntry): Promise<boolean>;

  listCompanies?(): Promise<Company[]>;
  getCompany?(id: string): Promise<Company | null>;
  addCompany?(input: Omit<Company, "id" | "createdAt" | "updatedAt" | "memberCount">): Promise<Company>;
  updateCompany?(
    id: string,
    updates: Partial<Omit<Company, "id" | "createdAt" | "updatedAt" | "memberCount">>,
  ): Promise<Company | null>;
  deleteCompany?(id: string): Promise<boolean>;
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
    /** Binaerinhalt — wird in files.blob (bytea) gespeichert. Wenn gesetzt,
     *  liegt die Datei ausschliesslich in der DB (kein Vault-Pfad noetig). */
    blob?: Buffer;
    /** UUID des Uploaders (Phase 3). Wird in files.uploaded_by-Spalte
     *  gespeichert; ohne ist's eine "anonyme" Upload (sichtbar fuer alle
     *  Admins, aber nicht im persoenlichen Workspace eines Users). */
    uploadedById?: string | null;
  }): Promise<FileEntry>;
  list(project?: string, limit?: number): Promise<FileEntry[]>;
  get(id: string): Promise<FileEntry | null>;
  /** Liefert den Blob einer Datei (oder null, wenn kein Blob hinterlegt ist,
   *  z.B. bei Legacy-Eintraegen die noch auf filepath zeigen). */
  readBlob(id: string): Promise<{ blob: Buffer; mimeType: string | null; filename: string } | null>;
  search(query: string, limit?: number): Promise<FileEntry[]>;
  delete(id: string): Promise<boolean>;
  updateContent(id: string, contentText: string): Promise<boolean>;

  // ── File-Sharing (Phase 3) ──────────────────────────
  listShares?(fileId: string): Promise<FileShareEntry[]>;
  addShare?(fileId: string, userId: string, canEdit: boolean): Promise<boolean>;
  removeShare?(fileId: string, userId: string): Promise<boolean>;
}

// ── Chat ────────────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  agent: string;
  title: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastMessage?: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  tools: string[];
  source: string;
  createdAt: string;
}

export interface ChatRepository {
  createSession(agent?: string, title?: string, source?: string): Promise<ChatSession>;
  listSessions(agent?: string, limit?: number): Promise<ChatSession[]>;
  deleteSession(id: string): Promise<boolean>;
  addMessage(sessionId: string, role: string, content: string, tools?: string[], source?: string): Promise<ChatMessage>;
  getMessages(sessionId: string, limit?: number): Promise<ChatMessage[]>;
  getRecentHistory(agent?: string, limit?: number): Promise<{ user: string; assistant: string }[]>;
  getOrCreateTodaySession(agent: string, source?: string): Promise<string>;
  /** Durchsucht alle Chat-Nachrichten (ueber alle Sessions + Agents) nach
   *  einem Keyword. Liefert die Treffer mit Datum, Rolle und Content — sortiert
   *  nach Relevanz (Neuheit). Nuetzlich fuer Cross-Session-Referenzen wie
   *  "der Termin aus gestern" oder "das Projekt ueber das wir geredet haben". */
  searchMessages(query: string, limit?: number): Promise<ChatMessage[]>;
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
