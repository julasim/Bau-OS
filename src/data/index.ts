// ============================================================
// Bau-OS — Data Layer Factory
// Wählt automatisch: DB_ENABLED → PostgreSQL, sonst Filesystem.
// Alle Consumer importieren von hier — nie direkt von fs-* oder db-*.
// ============================================================

import { DB_ENABLED } from "../config.js";
import type {
  TaskRepository,
  TerminRepository,
  NoteRepository,
  ProjectRepository,
  TeamRepository,
  FileRepository,
  ChatRepository,
} from "./types.js";

// Statische Imports — DB-Module verbinden sich erst beim ersten Aufruf (lazy)
import { fsTasks } from "./fs-tasks.js";
import { fsTermine } from "./fs-termine.js";
import { fsNotes } from "./fs-notes.js";
import { fsProjects } from "./fs-projects.js";
import { dbTasks } from "./db-tasks.js";
import { dbTermine } from "./db-termine.js";
import { dbNotes } from "./db-notes.js";
import { dbProjects } from "./db-projects.js";
import { dbFiles } from "./db-files.js";
import { dbChat } from "./db-chat.js";
import { fsTeam } from "./fs-team.js";
import { dbTeam } from "./db-team.js";

// ── Repos basierend auf Config wählen ────────────────────────

export const taskRepo: TaskRepository = DB_ENABLED ? dbTasks : fsTasks;
export const terminRepo: TerminRepository = DB_ENABLED ? dbTermine : fsTermine;
export const noteRepo: NoteRepository = DB_ENABLED ? dbNotes : fsNotes;
export const projectRepo: ProjectRepository = DB_ENABLED ? dbProjects : fsProjects;
export const teamRepo: TeamRepository = DB_ENABLED ? dbTeam : fsTeam;
export const fileRepo: FileRepository | null = DB_ENABLED ? dbFiles : null;
export const chatRepo: ChatRepository | null = DB_ENABLED ? dbChat : null;

/** Gibt den aktuellen Modus zurueck */
export function dataMode(): "database" | "filesystem" {
  return DB_ENABLED ? "database" : "filesystem";
}

// Re-export types
export type { Task, Termin, Note, Project, TeamMember, ChatSession, ChatMessage } from "./types.js";
export type {
  TaskRepository,
  TerminRepository,
  NoteRepository,
  ProjectRepository,
  TeamRepository,
  ChatRepository,
} from "./types.js";
