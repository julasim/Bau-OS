// ============================================================
// PATIO — Data Layer Factory
// Alle Consumer importieren von hier — nie direkt aus db-*.
//
// Die frueheren Filesystem-Repos (fs-*) sind mit dem Umbau zum
// Firmenserver entfallen: der Dienst laeuft genau einmal und immer gegen
// PostgreSQL. Damit sind auch die nullable Repos Geschichte — jedes Repo
// ist da, kein Aufrufer muss mehr auf null pruefen.
// ============================================================

import type {
  TaskRepository,
  TerminRepository,
  NoteRepository,
  ProjectRepository,
  TeamRepository,
  FileRepository,
  BautagebuchRepository,
  MeetingRepository,
  EntscheidungRepository,
  TimeEntryRepository,
  PhaseRepository,
  InvoiceRepository,
  PositionskatalogRepository,
  PortfolioRepository,
} from "./types.js";

// Statische Imports — die DB-Module verbinden sich erst beim ersten Aufruf.
import { dbTasks } from "./db-tasks.js";
import { dbTermine } from "./db-termine.js";
import { dbNotes } from "./db-notes.js";
import { dbProjects } from "./db-projects.js";
import { dbFiles } from "./db-files.js";
import { dbTeam } from "./db-team.js";
import { dbBautagebuch } from "./db-bautagebuch.js";
import { dbMeetings } from "./db-meetings.js";
import { dbEntscheidungen } from "./db-entscheidungen.js";
import { dbTimeEntries } from "./db-time-entries.js";
import { dbPhases } from "./db-phases.js";
import { dbInvoices } from "./db-invoices.js";
import { dbPositionskatalog } from "./db-positionskatalog.js";
import { dbAktivitaet } from "./db-aktivitaet.js";
import { dbAufgabensystem } from "./db-aufgabensystem.js";
import { dbBenachrichtigungen } from "./db-benachrichtigungen.js";
import { dbPortfolio } from "./db-portfolio.js";
import { dbSearch } from "./db-search.js";

export const taskRepo: TaskRepository = dbTasks;
export const terminRepo: TerminRepository = dbTermine;
export const noteRepo: NoteRepository = dbNotes;
export const projectRepo: ProjectRepository = dbProjects;
export const teamRepo: TeamRepository = dbTeam;
export const fileRepo: FileRepository = dbFiles;
export const bautagebuchRepo: BautagebuchRepository = dbBautagebuch;
export const meetingRepo: MeetingRepository = dbMeetings;
export const entscheidungRepo: EntscheidungRepository = dbEntscheidungen;
export const timeEntryRepo: TimeEntryRepository = dbTimeEntries;
export const phaseRepo: PhaseRepository = dbPhases;
export const invoiceRepo: InvoiceRepository = dbInvoices;
export const positionskatalogRepo: PositionskatalogRepository = dbPositionskatalog;
export const aktivitaetRepo = dbAktivitaet;
export type { AktivitaetsEintrag } from "./db-aktivitaet.js";
/** Aufgabensystem (Migration 050): die rechnende Schicht ueber den
 *  Aufgaben — Matrix, Tagesbudget, Tageswechsel. */
export const aufgabensystemRepo = dbAufgabensystem;
export const benachrichtigungenRepo = dbBenachrichtigungen;
export type { Benachrichtigung, NeueBenachrichtigung, Anlass } from "./db-benachrichtigungen.js";
export type { Matrix, MatrixSpalte, TagesplanBudget, Sichtbarkeit } from "./db-aufgabensystem.js";
export const portfolioRepo: PortfolioRepository = dbPortfolio;
export const searchRepo = dbSearch;
export type { SearchHit } from "./db-search.js";

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
  BautagebuchEntry,
  BautagebuchPersonnel,
  BautagebuchUpsertInput,
  WeatherType,
  Meeting,
  MeetingActionItem,
  MeetingInput,
  MeetingType,
  Entscheidung,
  EntscheidungAlternative,
  EntscheidungInput,
  EntscheidungStatus,
  InvoicePosition,
  PapierkorbEintrag,
  PositionskatalogItem,
  PositionskatalogInput,
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
  BautagebuchRepository,
  MeetingRepository,
  TimeEntryRepository,
  PhaseRepository,
  InvoiceRepository,
  PortfolioRepository,
} from "./types.js";
