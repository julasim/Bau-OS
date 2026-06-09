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
  AgentLogRepository,
  BautagebuchRepository,
  MeetingRepository,
  TimeEntryRepository,
  PhaseRepository,
  InvoiceRepository,
  PortfolioRepository,
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
import { fsTeam } from "./fs-team.js";
import { dbTeam } from "./db-team.js";
import { dbBautagebuch } from "./db-bautagebuch.js";
import { dbMeetings } from "./db-meetings.js";
import { dbTimeEntries } from "./db-time-entries.js";
import { dbPhases } from "./db-phases.js";
import { dbInvoices } from "./db-invoices.js";
import { dbPortfolio } from "./db-portfolio.js";
import { fsChat } from "./fs-chat.js";
import { dbChat } from "./db-chat.js";
import { fsAgentLogs } from "./fs-agent-logs.js";

// ── Repos basierend auf Config wählen ────────────────────────
// User-Daten: DB wenn verfuegbar, sonst FS-Fallback.
// Chat + Agent-Logs: immer FS (bewusste Design-Entscheidung —
// haengt nicht an der DB-Verfuegbarkeit, einfache Wartung via
// tail/grep auf JSONL-Dateien).

export const taskRepo: TaskRepository = DB_ENABLED ? dbTasks : fsTasks;
export const terminRepo: TerminRepository = DB_ENABLED ? dbTermine : fsTermine;
export const noteRepo: NoteRepository = DB_ENABLED ? dbNotes : fsNotes;
export const projectRepo: ProjectRepository = DB_ENABLED ? dbProjects : fsProjects;
export const teamRepo: TeamRepository = DB_ENABLED ? dbTeam : fsTeam;
export const fileRepo: FileRepository | null = DB_ENABLED ? dbFiles : null;
// Bautagebuch nur im DB-Modus — kein FS-Fallback. UI/LLM pruefen
// ?-Operator und blenden das Feature im FS-Mode aus.
export const bautagebuchRepo: BautagebuchRepository | null = DB_ENABLED ? dbBautagebuch : null;
export const meetingRepo: MeetingRepository | null = DB_ENABLED ? dbMeetings : null;
export const timeEntryRepo: TimeEntryRepository | null = DB_ENABLED ? dbTimeEntries : null;
// Projektmanagement (Migration 035) — nur DB-Modus.
export const phaseRepo: PhaseRepository | null = DB_ENABLED ? dbPhases : null;
export const invoiceRepo: InvoiceRepository | null = DB_ENABLED ? dbInvoices : null;
export const portfolioRepo: PortfolioRepository | null = DB_ENABLED ? dbPortfolio : null;
export const chatRepo: ChatRepository = DB_ENABLED ? dbChat : fsChat;
export const agentLogRepo: AgentLogRepository = fsAgentLogs;

/** Gibt den aktuellen Modus zurueck */
export function dataMode(): "database" | "filesystem" {
  return DB_ENABLED ? "database" : "filesystem";
}

// Re-export types
export type {
  Task,
  Termin,
  Note,
  Project,
  TeamMember,
  TeamMemberProject,
  TeamMemberCreateInput,
  TeamMemberUpdateInput,
  Company,
  MemberType,
  ContactLogEntry,
  ChatSession,
  ChatMessage,
  AgentLog,
  BautagebuchEntry,
  BautagebuchPersonnel,
  BautagebuchUpsertInput,
  WeatherType,
  Meeting,
  MeetingActionItem,
  MeetingInput,
  MeetingType,
  TimeEntry,
  TimeEntryInput,
  TimeSummary,
  ProjectPhase,
  ProjectPhaseUpsert,
  PhaseStatus,
  ProjectInvoice,
  ProjectInvoiceInput,
  InvoiceStatus,
  PortfolioEntry,
} from "./types.js";
export type {
  TaskRepository,
  TerminRepository,
  NoteRepository,
  ProjectRepository,
  TeamRepository,
  FileRepository,
  ChatRepository,
  AgentLogRepository,
  BautagebuchRepository,
  MeetingRepository,
  TimeEntryRepository,
  PhaseRepository,
  InvoiceRepository,
  PortfolioRepository,
} from "./types.js";
