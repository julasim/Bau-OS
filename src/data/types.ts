// ============================================================
// PATIO — Data Layer: Entity-Typen & Repository-Interfaces
// Gemeinsame Typen fuer Filesystem- und DB-Implementierungen.
// ============================================================

// ── Entity Types ─────────────────────────────────────────────

export interface Task {
  /** Zaehler fuer den Konfliktschutz (Migration 042). Wird beim Speichern
   *  mitgeschickt; stimmt er nicht mehr, hat in der Zwischenzeit jemand
   *  anderes gespeichert und die Aenderung wird abgelehnt statt still zu
   *  ueberschreiben. Siehe src/data/konflikt.ts. */
  rev?: number;
  id: string;
  text: string;
  status: "open" | "in_progress" | "done";
  priority?: string;
  assignee: string | null;
  /** Migration 007: FK auf team_members. Wenn gesetzt, ist assigneeName aus
   *  dem Join verfuegbar; assignee (Text) bleibt als Legacy-Fallback. */
  assigneeId?: string | null;
  assigneeName?: string | null;
  /** users.id des Erstellers. Die Spalte gibt es seit Migration 001, sie wurde
   *  aber nie geschrieben — dadurch war eine projektlose Aufgabe OHNE
   *  Zuweisung fuer ihren eigenen Ersteller nicht mehr aenderbar, sobald die
   *  Schreibrouten eine Rechtepruefung bekamen. Nicht mit `assigneeId`
   *  verwechseln: das ist eine team_members.id, das hier eine users.id. */
  createdById?: string | null;
  date: string | null;
  dueDate?: string | null;
  location: string | null;
  project: string | null;
  sortOrder?: number;
  completedAt?: string | null;
  /** Migration 035: FK auf project_phases. Verknuepft die Aufgabe mit einer
   *  Leistungsphase — daraus leitet sich der Phasen-Fortschritt ab. */
  phaseId?: string | null;

  // ── Aufgabensystem, Stufe 1 (Migration 050) ───────────────────────────────
  /** Der Quadrant, nicht die Wichtigkeit. Zwei Fragen in vier Werten:
   *  1 = dringend UND wichtig (sofort, hoechstens 5 offen)
   *  2 = wichtig (terminieren, mindestens eine pro Tag)
   *  3 = dringend (sammeln, hoechstens 60 min/Tag) — **Standard**
   *  4 = keins von beidem (streichen, Verfall nach 30 Tagen)
   *
   *  Der Standard ist 3, weil der Normalfall nicht markiert werden soll:
   *  aktiv gesetzt wird nur 1, 2 oder 4. Nicht mit `priority` verwechseln —
   *  das ist eine aeltere, unabhaengige Achse. */
  rang?: 1 | 2 | 3 | 4;
  /** Geschaetzte Dauer in Minuten, grob gerastert (15/30/60/120/180/240),
   *  damit die Summe im Kopf nachvollziehbar bleibt. `null` heisst: liegt
   *  noch im Eingang und ist nicht eingeschaetzt. */
  aufwandMin?: number | null;
  /** Fuer heute ausgewaehlt. Wird beim Tageswechsel zurueckgesetzt. */
  imTagesplan?: boolean;
  /** Wessen Tagesplan (users.id). Auf einem Mehrbenutzer-Server ist der
   *  Tagesplan persoenlich — ohne diese Spalte raeumte der eine dem anderen
   *  den Tag ab. */
  tagesplanVon?: string | null;

  createdAt: string;
  updatedAt: string;
}

/** Die vier Raenge mit ihren Grenzen. Eine einzige Quelle, damit Server und
 *  Oberflaeche nicht auseinanderlaufen — die Zahlen sind das Kernstueck des
 *  Systems, nicht Beiwerk. */
export const RANG_GRENZEN = {
  /** Hoechstens so viele offene Rang-1-Aufgaben, ueber ALLE Projekte. */
  maxRang1: 5,
  /** Fokusstunden pro Tag in Minuten. Nicht acht: der Rest sind Termine,
   *  Baustelle, Wege, Unterbrechungen. */
  tagesbudgetMin: 300,
  /** Hoechstens so viele Minuten Rang 3 pro Tag. */
  maxRang3Min: 60,
} as const;

/** Erlaubte Aufwandsstufen. Bewusst grob. */
export const AUFWAND_STUFEN = [15, 30, 60, 120, 180, 240] as const;

export interface Termin {
  /** Zaehler fuer den Konfliktschutz (Migration 042). Wird beim Speichern
   *  mitgeschickt; stimmt er nicht mehr, hat in der Zwischenzeit jemand
   *  anderes gespeichert und die Aenderung wird abgelehnt statt still zu
   *  ueberschreiben. Siehe src/data/konflikt.ts. */
  rev?: number;
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
  /** Migration 035: FK auf project_phases (optional). */
  phaseId?: string | null;
  /** Migration 035: markiert den Termin als Meilenstein (Gantt-Raute). */
  isMilestone?: boolean;
  /** users.id des Erstellers — gleiche Begruendung wie bei Task.createdById:
   *  ohne dieses Feld hat ein projektloser Termin keinen erkennbaren
   *  Eigentuemer, und die Rechtepruefung muesste ihn allen verweigern.
   *  Nicht mit `assigneeIds` verwechseln: das sind team_members-IDs. */
  createdById?: string | null;
  createdAt: string;
}

export interface Note {
  /** Zaehler fuer den Konfliktschutz (Migration 042). Wird beim Speichern
   *  mitgeschickt; stimmt er nicht mehr, hat in der Zwischenzeit jemand
   *  anderes gespeichert und die Aenderung wird abgelehnt statt still zu
   *  ueberschreiben. Siehe src/data/konflikt.ts. */
  rev?: number;
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
  /** Zaehler fuer den Konfliktschutz (Migration 042). Wird beim Speichern
   *  mitgeschickt; stimmt er nicht mehr, hat in der Zwischenzeit jemand
   *  anderes gespeichert und die Aenderung wird abgelehnt statt still zu
   *  ueberschreiben. Siehe src/data/konflikt.ts. */
  rev?: number;
  id?: string;
  name: string;
  folderPath?: string;
  description?: string | null;
  status?: string;
  color?: string | null;
  tags?: string[];
  // Stammdaten (Migration 004) — strukturiert statt als Textblock in description.
  /** Die Kennung, unter der das Projekt im Haus gefuehrt wird (Migration 052).
   *  Pflicht und eindeutig; sie loest die UUID nach aussen ab. Optional im Typ
   *  bleibt sie nur, weil aeltere Antworten aus dem Papierkorb und aus
   *  Teil-DTOs sie nicht mitfuehren — wer ein volles Projekt in der Hand hat,
   *  darf sich auf sie verlassen. Regeln: src/data/projektnummer.ts */
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
  /** Geplantes Projektbudget in EUR (NULL = nicht gesetzt). */
  budget?: number | null;
  /** Bereits verwendetes / fakturiertes Budget in EUR. */
  budgetUsed?: number | null;
  /** Anzahl offener Aufgaben mit Priorität "hoch". */
  highPriorityCount?: number;
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
  budget?: number | null;
  budgetUsed?: number | null;
}

/** Stammdaten, die optional bei der Projekt-Erstellung mit uebergeben werden
 *  koennen. Ab Phase 1 werden sie strukturiert in Spalten persistiert; vorher
 *  landeten sie als Textblock in description. */
/**
 * Wie `create()` ausgegangen ist.
 *
 * Bewusst Woerter statt `boolean` — genau wie bei `rename()` im selben
 * Repository. Ein `false` kann hier vier verschiedene Dinge heissen, und die
 * Route muss sie unterscheiden koennen: ein ungueltiger Name ist ein 400,
 * eine vergebene Projektnummer ein 409, und die beiden Meldungen sagen dem
 * Nutzer voellig Verschiedenes.
 */
/** Wie `update()` ausgegangen ist. `false` heisst weiterhin „nicht gefunden
 *  oder nichts zu tun"; die beiden Woerter kamen mit der Projektnummer dazu
 *  (Migration 052) und muessen von der Route unterschieden werden — das eine
 *  ist ein 400, das andere ein 409. */
export type ProjectUpdateErgebnis = boolean | "nummer-fehlt" | "nummer-vergeben";

export type ProjectCreateErgebnis = "ok" | "ungueltiger-name" | "nummer-fehlt" | "nummer-vergeben";

export interface ProjectCreateOptions {
  description?: string | null;
  /** Pflicht ab Migration 052. Der Typ laesst sie weiterhin fehlen, weil
   *  `create()` auch mit einem blossen Beschreibungstext aufgerufen werden
   *  kann (Altform); fehlt sie dann, antwortet `create()` mit
   *  `"nummer-fehlt"` statt still ein Projekt ohne Kennung anzulegen. */
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
  /** Zaehler fuer den Konfliktschutz (Migration 042). Wird beim Speichern
   *  mitgeschickt; stimmt er nicht mehr, hat in der Zwischenzeit jemand
   *  anderes gespeichert und die Aenderung wird abgelehnt statt still zu
   *  ueberschreiben. Siehe src/data/konflikt.ts. */
  rev?: number;
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  /** Standard-Stundensatz EUR/h (Migration 037). NULL = nicht gesetzt. */
  hourlyRate?: number | null;
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
  /** Migration 013: Verknuepfung zum User-Account. Wenn gesetzt, kann
   *  das Mitglied per Telegram benachrichtigt werden. NULL = externes
   *  Mitglied ohne Login (Subunternehmer, externer Planer). */
  userId: string | null;
  /** Read-only Join. */
  username?: string | null;
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

/** Bautagebuch (Migration 011): Tageseintrag pro Projekt mit Wetter,
 *  Personal, Maschinen, Taetigkeiten und Vorkommnissen. UNIQUE(project_id,
 *  entry_date) → genau ein Eintrag pro Projekt pro Tag. */
export type WeatherType = "sonnig" | "bewoelkt" | "regen" | "schnee" | "sturm" | "nebel" | "frost" | "hagel";

/** Personal-Eintrag im Bautagebuch. Entweder mit `memberId`-Verknuepfung
 *  zu team_members (bevorzugt) oder rein als Freitext-Name. `removed`
 *  wird vom DB-Trigger gesetzt, wenn das referenzierte team_members
 *  geloescht wurde — Eintrag bleibt dokumentarisch sichtbar. */
export interface BautagebuchPersonnel {
  memberId?: string | null;
  name: string;
  hours?: number | null;
  role?: string | null;
  removed?: boolean;
}

export interface BautagebuchEntry {
  id: string;
  projectId: string;
  projectName?: string | null;
  date: string; // YYYY-MM-DD
  weather: WeatherType | null;
  temperatureMin: number | null;
  temperatureMax: number | null;
  personnel: BautagebuchPersonnel[];
  machines: string | null;
  activities: string | null;
  incidents: string | null;
  createdById: string | null;
  createdByUsername?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Patch-Shape fuer upsert(). project + date identifizieren den Eintrag,
 *  alle anderen Felder sind optional und werden nur ueberschrieben wenn
 *  im Patch enthalten. */
export interface BautagebuchUpsertInput {
  weather?: WeatherType | null;
  temperatureMin?: number | null;
  temperatureMax?: number | null;
  personnel?: BautagebuchPersonnel[];
  machines?: string | null;
  activities?: string | null;
  incidents?: string | null;
}

export interface BautagebuchRepository {
  /** Liste aller Eintraege fuer ein Projekt, neueste zuerst.
   *  limit default = 30 (rund ein Monat). */
  list(projectId: string, limit?: number): Promise<BautagebuchEntry[]>;
  /** Einzelner Eintrag per Projekt+Datum (YYYY-MM-DD). */
  get(projectId: string, date: string): Promise<BautagebuchEntry | null>;
  /** Einzelner Eintrag per ID — samt `projectName` aus dem Join.
   *  Gebraucht vom Word-Export, der den Eintrag nur ueber seine ID kennt und
   *  vor dem Rendern pruefen muss, ob der Aufrufer das Projekt sehen darf. */
  getById(id: string): Promise<BautagebuchEntry | null>;
  /** UPSERT: legt neuen Eintrag an oder aktualisiert vorhandenen. Aus dem
   *  CHECK-Constraint resultierende Validation-Fehler kommen als String
   *  zurueck (genauso wie save() bei termine). */
  upsert(
    projectId: string,
    date: string,
    patch: BautagebuchUpsertInput,
    createdById?: string | null,
  ): Promise<BautagebuchEntry | string>;
  /** Loescht einen Eintrag. */
  delete(projectId: string, date: string): Promise<boolean>;
  /** Cross-Projekt-Liste fuer Dashboard / "letzte Aktivitaeten". Optional
   *  auf eine Menge sichtbarer Projekt-IDs gefiltert. */
  listRecent(visibleProjectIds: string[] | "all", limit?: number): Promise<BautagebuchEntry[]>;
}

/** Meeting (Migration 012): Bauherrenmeetings, Baubesprechungen,
 *  Subunternehmer-Abstimmungen etc. Eigene Tabelle, NICHT Teil des
 *  Bautagebuchs — mehrere Meetings pro Tag moeglich, eigener Lifecycle. */
export type MeetingType =
  | "Bauherrenmeeting"
  | "Baubesprechung"
  | "Subunternehmer"
  | "Planung"
  | "Behoerde"
  | "Abnahme"
  | "Sonstiges";

/** Action-Item / To-Do aus einem Meeting. assigneeId optional → wird
 *  vom Trigger geleert wenn das referenzierte team_members geloescht
 *  wird. Action-Items ohne assigneeId zeigen nur den Text. */
export interface MeetingActionItem {
  text: string;
  assigneeId?: string | null;
  dueDate?: string | null; // YYYY-MM-DD
  done?: boolean;
  /** Wenn das Action-Item per Web-UI in eine echte Aufgabe (tasks-Tabelle)
   *  uebernommen wurde, zeigt taskId auf diese. UI rendert dann "→ Aufgabe
   *  angelegt" statt einen weiteren "Anlegen"-Button. Optional: vor diesem
   *  Feature-Add waren alle bestehenden Items ohne taskId. */
  taskId?: string | null;
}

export interface Meeting {
  /** Zaehler fuer den Konfliktschutz (Migration 042). Wird beim Speichern
   *  mitgeschickt; stimmt er nicht mehr, hat in der Zwischenzeit jemand
   *  anderes gespeichert und die Aenderung wird abgelehnt statt still zu
   *  ueberschreiben. Siehe src/data/konflikt.ts. */
  rev?: number;
  id: string;
  projectId: string;
  projectName?: string | null;
  date: string; // YYYY-MM-DD
  startTime: string | null; // HH:MM
  endTime: string | null;
  title: string;
  meetingType: MeetingType | null;
  location: string | null;
  attendeeIds: string[];
  /** Read-only Join — Namen der referenzierten team_members. */
  attendeesResolved?: { id: string; name: string }[];
  /** Externe Teilnehmer ohne Team-Eintrag (Freitext, parallel zu termine). */
  attendeesExternal: string[];
  agenda: string | null;
  minutes: string | null;
  decisions: string | null;
  actionItems: MeetingActionItem[];
  nextMeetingDate: string | null;
  createdById: string | null;
  createdByUsername?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Patch-Shape fuer create/update. id wird beim create vergeben, beim
 *  update separat als Pfad-Param uebergeben. project_id ebenfalls
 *  separat (URL bestimmt das Projekt, nicht der Body). */
export interface MeetingInput {
  date: string; // YYYY-MM-DD, required
  title: string; // required
  startTime?: string | null;
  endTime?: string | null;
  meetingType?: MeetingType | null;
  location?: string | null;
  attendeeIds?: string[];
  attendeesExternal?: string[];
  agenda?: string | null;
  minutes?: string | null;
  decisions?: string | null;
  actionItems?: MeetingActionItem[];
  nextMeetingDate?: string | null;
}

export interface MeetingRepository {
  /** Liste fuer ein Projekt, neueste zuerst. */
  list(projectId: string, limit?: number): Promise<Meeting[]>;
  get(id: string): Promise<Meeting | null>;
  /** Legt ein neues Meeting an. Validation-Fehler kommen als String
   *  zurueck (analog zu terminRepo.save). */
  create(projectId: string, input: MeetingInput, createdById?: string | null): Promise<Meeting | string>;
  /** Aktualisiert ein bestehendes Meeting. project_id ist nicht aenderbar. */
  update(id: string, input: Partial<MeetingInput>): Promise<Meeting | null | string>;
  delete(id: string): Promise<boolean>;
  /** Cross-Projekt-Liste fuer Dashboard / "naechste Meetings". */
  listRecent(visibleProjectIds: string[] | "all", limit?: number): Promise<Meeting[]>;
}

/** Stundenerfassung (Migration 014): pro Mitarbeiter, pro Tag, pro
 *  Projekt. memberId optional → externer Trupp moeglich, dann nur
 *  memberName. start/end/break optional fuer rechtskonforme Variante. */
export interface TimeEntry {
  /** Zaehler fuer den Konfliktschutz (Migration 042). Wird beim Speichern
   *  mitgeschickt; stimmt er nicht mehr, hat in der Zwischenzeit jemand
   *  anderes gespeichert und die Aenderung wird abgelehnt statt still zu
   *  ueberschreiben. Siehe src/data/konflikt.ts. */
  rev?: number;
  id: string;
  projectId: string;
  projectName?: string | null;
  /** Optionale Zuordnung zu einer Leistungsphase (Migration 036). */
  phaseId?: string | null;
  memberId: string | null;
  memberName: string | null;
  date: string; // YYYY-MM-DD
  hours: number; // dezimal, z.B. 8.5
  /** Stundensatz-Override EUR/h (Migration 037). NULL = Mitarbeiter-Standard. */
  hourlyRate?: number | null;
  startTime: string | null; // HH:MM
  endTime: string | null;
  breakMinutes: number;
  activity: string | null;
  notes: string | null;
  createdById: string | null;
  createdByUsername?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimeEntryInput {
  date: string; // YYYY-MM-DD, required
  hours: number; // required, > 0
  phaseId?: string | null;
  hourlyRate?: number | null;
  memberId?: string | null;
  memberName?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  breakMinutes?: number;
  activity?: string | null;
  notes?: string | null;
}

/** Aggregierte Summe ueber eine Filter-Dimension (z.B. pro Mitglied,
 *  pro Tag, oder Projekt-Total). UI nutzt das fuer Header-Stats und
 *  Wochen-Reports. */
export interface TimeSummary {
  /** Gruppen-Schluessel (Member-ID, Datum, oder leer fuer Total). */
  key: string;
  /** Lesbares Label (Member-Name, "2026-04-28", etc.). */
  label: string;
  hours: number;
  entries: number;
}

export interface TimeEntryRepository {
  list(projectId: string, opts?: { from?: string; to?: string; limit?: number }): Promise<TimeEntry[]>;
  get(id: string): Promise<TimeEntry | null>;
  create(projectId: string, input: TimeEntryInput, createdById?: string | null): Promise<TimeEntry | string>;
  update(id: string, input: Partial<TimeEntryInput>): Promise<TimeEntry | null | string>;
  delete(id: string): Promise<boolean>;
  /** Cross-Projekt-Liste fuer Dashboard / Member-Detail. */
  listForMember(memberId: string, opts?: { from?: string; to?: string; limit?: number }): Promise<TimeEntry[]>;
  /** Summen pro Mitglied fuer ein Projekt im Zeitraum. */
  summaryByMember(projectId: string, from?: string, to?: string): Promise<TimeSummary[]>;
  /** Summen pro Tag fuer ein Projekt im Zeitraum. */
  summaryByDate(projectId: string, from?: string, to?: string): Promise<TimeSummary[]>;
  /** Ist-Kosten (Stunden * effektiver Satz) je Phase fuer ein Projekt.
   *  Effektiver Satz = time_entry.hourly_rate ?? team_member.hourly_rate ?? 0. */
  costsByPhase(projectId: string): Promise<{ byPhase: Record<string, number>; unassigned: number; total: number }>;
}

export interface EntscheidungAlternative {
  text: string;
  /** Warum diese Moeglichkeit NICHT gewaehlt wurde. Der eigentliche Wert des
   *  Logs: ein halbes Jahr spaeter fragt jemand „warum eigentlich nicht …?" */
  verworfenWeil?: string | null;
}

/** „entwurf" = vorlaeufig festgehalten (z.B. in der Besprechung notiert),
 *  „bestaetigt" = final und verbindlich. */
export type EntscheidungStatus = "entwurf" | "bestaetigt";

/** Entscheidungslog (Migration 045): strukturiertes Protokoll
 *  projektbezogener Entscheidungen mit Begruendung, erwogenen Alternativen
 *  und Beteiligten.
 *
 *  Loest das Freitextfeld `Meeting.decisions` ab — nicht weil Freitext
 *  schlecht waere, sondern weil er nicht auffindbar ist und die Begruendung
 *  verliert. Und weil Entscheidungen auch am Telefon fallen, nicht nur in
 *  Besprechungen. */
export interface Entscheidung {
  id: string;
  projectId: string;
  projectName?: string | null;
  /** YYYY-MM-DD */
  datum: string;
  titel: string;
  begruendung: string | null;
  alternativen: EntscheidungAlternative[];
  beteiligteIds: string[];
  /** Nur gelesen — Namen der referenzierten Teammitglieder aus dem Join. */
  beteiligteResolved?: { id: string; name: string }[];
  /** Beteiligte ohne Team-Eintrag (Bauherr, Behoerde, externer Fachplaner). */
  beteiligteExtern: string[];
  status: EntscheidungStatus;
  relatedMeetingId: string | null;
  /** Nur gelesen — und nur aufgeloest, wenn die Besprechung im SELBEN Projekt
   *  liegt. Ein Bezug ueber Projektgrenzen waere ein stiller Datenabfluss. */
  relatedMeetingResolved?: { id: string; title: string; date: string } | null;
  createdById: string | null;
  createdByUsername?: string | null;
  createdAt: string;
  updatedAt: string;
  rev?: number;
}

/** Eingabe fuer Anlegen und Aendern. Das Projekt kommt aus der Adresse, nicht
 *  aus dem Body — sonst liesse sich ein Datensatz in ein fremdes Projekt
 *  schieben. */
export interface EntscheidungInput {
  /** YYYY-MM-DD, Pflicht */
  datum: string;
  titel: string;
  begruendung?: string | null;
  alternativen?: EntscheidungAlternative[];
  beteiligteIds?: string[];
  beteiligteExtern?: string[];
  status?: EntscheidungStatus;
  relatedMeetingId?: string | null;
  /** Konflikt-Zaehler der geladenen Fassung (Migration 042). */
  rev?: number | null;
}

export interface EntscheidungRepository {
  /** Liste fuer ein Projekt, neueste zuerst. */
  list(projectId: string, limit?: number): Promise<Entscheidung[]>;
  get(id: string): Promise<Entscheidung | null>;
  /** Validierungsfehler kommen als String zurueck — wie bei `meetingRepo`. */
  create(projectId: string, input: EntscheidungInput, createdById?: string | null): Promise<Entscheidung | string>;
  /** Das Projekt ist nicht aenderbar. Wirft `KonfliktFehler`, wenn der
   *  mitgeschickte `rev` nicht mehr stimmt. */
  update(id: string, input: Partial<EntscheidungInput>): Promise<Entscheidung | null | string>;
  delete(id: string): Promise<boolean>;
  /** Projektuebergreifend fuers Dashboard, auf sichtbare Projekte begrenzt. */
  listRecent(visibleProjectIds: string[] | "all", limit?: number): Promise<Entscheidung[]>;
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

/** Ein Eintrag im Papierkorb (Migration 049). Bewusst schmal: die Liste soll
 *  zeigen, WAS geloescht wurde und wann — der Inhalt kommt beim
 *  Zurueckholen von selbst wieder. */
export interface PapierkorbEintrag {
  id: string;
  titel: string;
  projectName: string | null;
  geloeschtAm: string;
  /** Wer den Datensatz angelegt hat — entscheidet bei Eintraegen ohne Projekt
   *  darueber, wer sie im Papierkorb sieht. */
  createdById: string | null;
}

/** Papierkorb-Faehigkeiten, die sich Aufgaben, Termine und Notizen teilen.
 *
 *  `sichtbareProjekte` ist derselbe Massstab wie ueberall: `"all"` fuer
 *  Admins, sonst die Liste der sichtbaren Projekt-IDs. */
export interface PapierkorbFaehig {
  listDeleted?(sichtbareProjekte: string[] | "all"): Promise<PapierkorbEintrag[]>;
  restore?(id: string): Promise<boolean>;
  /** Endgueltig entfernen — greift NUR bei Datensaetzen, die im Papierkorb
   *  liegen. Endgueltiges Loeschen soll nie ein Einzelschritt sein. */
  purge?(id: string): Promise<boolean>;
}

export interface TaskRepository extends PapierkorbFaehig {
  /** @param createdById users.id des Erstellers — noetig, damit er seine
   *  eigene Aufgabe spaeter auch ohne Projekt und ohne Zuweisung noch
   *  bearbeiten darf. */
  save(text: string, project?: string, createdById?: string | null): Promise<Task>;
  list(project?: string): Promise<Task[]>;
  listOpen(project?: string): Promise<Task[]>;
  get(id: string, project?: string): Promise<Task | null>;
  update(id: string, updates: Partial<Task>, project?: string): Promise<Task | null>;
  complete(textOrId: string, project?: string): Promise<boolean>;
  delete(id: string, project?: string): Promise<boolean>;
}

export interface TerminRepository extends PapierkorbFaehig {
  save(
    datum: string,
    text: string,
    uhrzeit?: string,
    project?: string,
    createdById?: string | null,
  ): Promise<Termin | string>;
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
  /** Wer die Notiz angelegt hat. Ohne diese Angabe waren Notizen OHNE Projekt
   *  fuer ihren eigenen Verfasser unsichtbar — Aufgaben und Termine behandeln
   *  denselben Fall laengst als „persoenlich". */
  createdById: string | null;
}

/** Was eine Notiz-Angabe eindeutig aufloest — samt allem, was die
 *  Rechtepruefung braucht.
 *
 *  Der Grund fuer diesen Typ ist ein nachgewiesener Fehler: Rechtepruefung und
 *  Lesen loesten den Namen frueher GETRENNT auf, mit unterschiedlicher
 *  Sortierung. Bei zwei Notizen desselben Titels entschieden sie ueber
 *  verschiedene Zeilen — freigegeben wurde die eine, ausgeliefert die andere,
 *  auch aus einem fremden Projekt. Wer einmal aufloest und danach ueber die
 *  `id` arbeitet, kann diesen Fehler nicht mehr machen. */
export interface NoteMeta {
  id: string;
  title: string;
  project: string | null;
  createdById: string | null;
  rev: number;
}

export interface NoteRepository extends PapierkorbFaehig {
  /** `createdById` haelt fest, wer die Notiz angelegt hat. Ohne ihn blieb
   *  `notes.created_by` leer — im Aktivitaets-Feed stand dann „—", und bei
   *  jeder Rueckfrage „von wem ist das?" half nur Raten. */
  save(content: string, project?: string, createdById?: string | null): Promise<string>;
  list(limit?: number): Promise<string[]>;
  listDetailed?(limit?: number): Promise<NoteSummary[]>;
  /** Loest eine Angabe (ID, exakter Titel, eindeutiger Titelanfang) auf GENAU
   *  EINE Notiz auf — dieselbe, die `read`/`update`/`delete` treffen wuerden.
   *  Grundlage jeder Rechtepruefung; siehe `NoteMeta`. */
  resolve?(nameOrPath: string): Promise<NoteMeta | null>;
  read(nameOrPath: string): Promise<string | null>;
  /** Lesen ueber die aufgeloeste ID. Kein Raten mehr noetig. */
  readById?(id: string): Promise<{ content: string; rev: number } | null>;
  /** Aendern ueber die aufgeloeste ID. Wirft `KonfliktFehler`, wenn `rev`
   *  nicht mehr stimmt. */
  updateById?(id: string, content: string, expectedRev?: number | null): Promise<boolean>;
  /** Loeschen ueber die aufgeloeste ID. Liefert den Titel der geloeschten
   *  Notiz oder `null`. */
  deleteById?(id: string): Promise<string | null>;
  /** Wie `read`, liefert aber zusaetzlich den Konflikt-Zaehler — die
   *  Oberflaeche braucht ihn, um ihn beim Speichern zurueckzuschicken. */
  readWithRev?(nameOrPath: string): Promise<{ content: string; rev: number } | null>;
  append(nameOrPath: string, content: string): Promise<boolean>;
  /** `expectedRev` ist der beim Laden mitgelieferte Zaehler. Stimmt er nicht
   *  mehr, wird ein KonfliktFehler geworfen statt still zu ueberschreiben. */
  update(nameOrPath: string, content: string, expectedRev?: number | null): Promise<boolean>;
  delete(nameOrPath: string): Promise<string | null>;
}

export interface ProjectRepository {
  /** Liste der Projekt-Namen. Optional: visibleProjectIds als Filter
   *  ("all" = kein Filter, Array = nur diese IDs). Phase-4-Scoping. */
  list(visibleIds?: string[] | "all"): Promise<string[]>;
  getInfo(name: string): Promise<Project | null>;
  /** Wie getInfo, aber fuer alle sichtbaren Projekte in EINER Query (PERF-1:
   *  ersetzt das N+1 aus list()+getInfo() je Name in GET /projects). Ergebnis
   *  ist identisch zu list(visibleIds).map(getInfo), sortiert nach Name.
   *  Optional — der FS-Mode faellt auf den alten Pfad zurueck. */
  listInfos?(visibleIds?: string[] | "all"): Promise<Project[]>;
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
  create(
    name: string,
    options?: string | null | ProjectCreateOptions,
    createdById?: string | null,
  ): Promise<ProjectCreateErgebnis>;
  /** Aktualisiert Stammdaten eines bestehenden Projekts. Nur Felder die im
   *  Patch gesetzt sind werden geaendert; undefined laesst unveraendert, null
   *  leert die Spalte explizit. Gibt false zurueck wenn Projekt nicht
   *  existiert oder Patch leer ist. */
  /** `expectedRev` ist der beim Laden mitgelieferte Konflikt-Zaehler
   *  (Migration 042). Bewusst ein eigener Parameter statt eines Feldes in
   *  `ProjectUpdate`: dessen Schluessel sind ueber `UPDATE_COLUMNS` fest auf
   *  Spalten abgebildet, `rev` ist aber keine patchbare Spalte. */
  update(name: string, patch: ProjectUpdate, expectedRev?: number | null): Promise<ProjectUpdateErgebnis>;
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
  /** Legt das Projekt in den Papierkorb (Migration 044) — es verschwindet aus
   *  allen Listen und aus der Sichtbarkeit, seine Datensaetze bleiben aber
   *  unangetastet liegen. Endgueltig entfernt wird es erst mit `purge()`.
   *
   *  Der Unterschied ist nicht kosmetisch: bei einem echten DELETE feuern die
   *  Kaskaden und zerstoeren Bautagebuch, Besprechungen, Stunden, Phasen und
   *  Rechnungen; Notizen, Aufgaben, Termine und Dateien verlieren ihren Bezug. */
  delete(name: string): Promise<boolean>;
  /** Loest eine Projekt-ID auf den Namen auf. Gebraucht fuer `?projectId=`:
   *  die Repos adressieren Projekte ueber den NAMEN, Clients sollen sich aber
   *  auf die unveraenderliche ID stuetzen koennen. Liefert `null`, wenn es das
   *  Projekt nicht gibt oder es im Papierkorb liegt. */
  nameById?(id: string): Promise<string | null>;
  /** Loest eine Projektnummer auf den Projektnamen auf (Migration 052).
   *  Unempfindlich gegen Gross-/Kleinschreibung, passend zum eindeutigen
   *  Index. Projekte im Papierkorb liefern `null` — wer eine Nummer angibt,
   *  meint ein Projekt, mit dem er arbeiten will. */
  nameByNummer?(nummer: string): Promise<string | null>;
  /** Projekte im Papierkorb, zuletzt geloeschte zuerst. */
  listDeleted?(): Promise<Array<{ id: string; name: string; deletedAt: string }>>;
  /** Holt ein Projekt aus dem Papierkorb zurueck. `false`, wenn es dort nicht
   *  liegt. */
  restore?(name: string): Promise<boolean>;
  /** Entfernt ein Projekt im Papierkorb ENDGUELTIG — hier feuern die Kaskaden
   *  wie frueher, und das ist an dieser Stelle richtig. Verweigert die Arbeit
   *  bei Projekten, die nicht im Papierkorb liegen: endgueltiges Loeschen soll
   *  nie ein Einzelschritt sein. */
  purge?(name: string): Promise<boolean>;
}

/** Input-Shape fuers Anlegen — erlaubt companyName statt companyId, weil
 *  Caller oft nur den Namen haben. Das Repo erledigt den Lookup/Insert. */
export interface TeamMemberCreateInput {
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  hourlyRate?: number | null;
  company?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  memberType?: MemberType | null;
  projectId?: string | null;
  userId?: string | null;
}

export interface TeamMemberUpdateInput {
  name?: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  hourlyRate?: number | null;
  company?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  memberType?: MemberType | null;
  projectId?: string | null;
  userId?: string | null;
}

export interface TeamRepository {
  /** `sichtbareProjekte` begrenzt die mitgelieferten Projektzuordnungen auf
   *  das, was der Fragende sehen darf — `"all"` fuer Admins, sonst die Liste
   *  der sichtbaren Projekt-IDs.
   *
   *  Die Stammdaten selbst (Name, Rolle, Firma, Kontakt) bleiben fuer alle
   *  lesbar: die Team-Liste ist der interne Kollegenkatalog und fuettert jeden
   *  Zuweisungs-Dialog. Nur die ANGEHAENGTEN Projektnamen sind eine Auskunft
   *  ueber fremde Projekte und werden gefiltert. */
  list(sichtbareProjekte?: string[] | "all"): Promise<TeamMember[]>;
  get(id: string, sichtbareProjekte?: string[] | "all"): Promise<TeamMember | null>;
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
  /** Fuehrt zwei Firmen zusammen: alle Mitglieder von `vonId` wechseln zu
   *  `nachId`, danach faellt `vonId` weg.
   *
   *  Der Grund ist der Alltag: Firmen entstehen beim Anlegen eines
   *  Teammitglieds automatisch aus einem Freitextfeld. „Müller GmbH",
   *  „Mueller GmbH" und „Müller Gmbh" sind dann drei Firmen, und ohne
   *  Zusammenfuehren bleiben sie das fuer immer. Umbenennen allein hilft
   *  nicht — es macht aus drei Eintraegen drei gleichnamige.
   *
   *  Liefert die Zahl der umgehaengten Mitglieder, oder `null`, wenn eine der
   *  beiden Firmen nicht existiert. */
  mergeCompany?(vonId: string, nachId: string): Promise<number | null>;
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
  /** project → filtert auf ein Projekt. visibleProjectIds → zeigt nur Dateien
   *  dieser Projekte (Non-Admin-Scoping). Beide undefined → alle Dateien. */
  list(project?: string, limit?: number, visibleProjectIds?: string[]): Promise<FileEntry[]>;
  get(id: string): Promise<FileEntry | null>;
  /** Liefert den Blob einer Datei (oder null, wenn kein Blob hinterlegt ist,
   *  z.B. bei Legacy-Eintraegen die noch auf filepath zeigen). */
  readBlob(id: string): Promise<{ blob: Buffer; mimeType: string | null; filename: string } | null>;
  /** visibleProjectIds → zeigt nur Treffer aus diesen Projekten (Non-Admin-
   *  Scoping, gleiche Semantik wie list()). undefined → kein Filter (Admin). */
  search(query: string, limit?: number, visibleProjectIds?: string[]): Promise<FileEntry[]>;
  delete(id: string): Promise<boolean>;
  updateContent(id: string, contentText: string): Promise<boolean>;
  /** Ordnet eine bereits gespeicherte Datei einem Projekt zu (per Projektname).
   *  Gibt false zurueck, wenn Projekt oder Datei nicht gefunden wurden. */
  linkProject?(fileIdOrName: string, projectName: string): Promise<boolean>;

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
  /** UUID des Benutzers, der die Session erzeugt hat. NULL bei Legacy-Sessions
   *  (vor Multi-User-Support) oder Bot/Heartbeat-Sessions. */
  userId?: string | null;
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
  createSession(agent?: string, title?: string, source?: string, userId?: string | null): Promise<ChatSession>;
  /** userId=undefined → alle Sessions (Admin-Ansicht). userId=string → nur eigene. */
  listSessions(agent?: string, limit?: number, userId?: string | null): Promise<ChatSession[]>;
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
  // ── Session-Sharing (optional — nur DB-Mode) ────────────────
  /** Gibt einem User Leserecht auf eine Session. Idempotent. */
  shareSession?(sessionId: string, userId: string): Promise<boolean>;
  /** Entzieht den Zugriff. false wenn kein Eintrag vorhanden war. */
  unshareSession?(sessionId: string, userId: string): Promise<boolean>;
  /** Liste aller Personen, mit denen eine Session geteilt wurde. */
  listSessionShares?(
    sessionId: string,
  ): Promise<{ userId: string; username: string; displayName: string | null; addedAt: string }[]>;
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

// ============================================================
// Projektmanagement (Migration 035) — DB-only
// ============================================================

export type PhaseStatus = "offen" | "aktiv" | "fertig";

/** Eine Leistungsphase eines Projekts. progress ist abgeleitet (aus den
 *  verknuepften Aufgaben) bzw. progressManual, wenn gesetzt. */
export interface ProjectPhase {
  /** Zaehler fuer den Konfliktschutz (Migration 042). Wird beim Speichern
   *  mitgeschickt; stimmt er nicht mehr, hat in der Zwischenzeit jemand
   *  anderes gespeichert und die Aenderung wird abgelehnt statt still zu
   *  ueberschreiben. Siehe src/data/konflikt.ts. */
  rev?: number;
  id: string;
  projectId: string;
  projectName?: string | null;
  name: string;
  sortOrder: number;
  status: PhaseStatus;
  /** Manuelles Fortschritts-Override (0..100) oder null. */
  progressManual: number | null;
  /** Honoraranteil in Prozent (0..100). */
  feeShare: number;
  sollStart: string | null;
  sollEnde: string | null;
  istStart: string | null;
  istEnde: string | null;
  /** Optionaler Vorgaenger (Migration 038) — fuer Gantt/kritischen Pfad. */
  dependsOnPhaseId: string | null;
  // ── Abgeleitete Felder (read-only, aus Aufgaben berechnet) ──
  /** Effektiver Fortschritt 0..100: progressManual ?? (taskDone/taskTotal). */
  progress: number;
  taskTotal: number;
  taskDone: number;
  createdAt: string;
  updatedAt: string;
}

/** Patchable Felder beim Anlegen/Aktualisieren einer Phase. */
export interface ProjectPhaseUpsert {
  name?: string;
  status?: PhaseStatus;
  progressManual?: number | null;
  feeShare?: number;
  sollStart?: string | null;
  sollEnde?: string | null;
  istStart?: string | null;
  istEnde?: string | null;
  sortOrder?: number;
  dependsOnPhaseId?: string | null;
}

export type InvoiceStatus = "entwurf" | "gestellt" | "bezahlt";

/** Teilrechnung eines Projekts (optional einer Phase zugeordnet). */
/** Eine Zeile auf der Rechnung (Migration 046).
 *
 *  `ustSatz` ist ein Prozentwert (20 = 20 %), kein Betrag — deshalb faellt er
 *  nicht unter das Geld-Recht. `einzelpreis` sehr wohl. */
export interface InvoicePosition {
  text: string;
  menge: number;
  einheit: string | null;
  einzelpreis: number;
  ustSatz: number;
}

/** Wiederverwendbare Leistung aus dem Positionskatalog (Migration 046).
 *
 *  Der Katalog gilt fuers ganze Buero und enthaelt Preise — er haengt deshalb
 *  am Geld-Recht (Migration 043), nicht an der Rolle. */
export interface PositionskatalogItem {
  id: string;
  text: string;
  einheit: string | null;
  einzelpreis: number;
  ustSatz: number;
  sortOrder: number;
  rev?: number;
}

export interface PositionskatalogInput {
  text?: string;
  einheit?: string | null;
  einzelpreis?: number;
  ustSatz?: number;
  sortOrder?: number;
  rev?: number | null;
}

export interface PositionskatalogRepository {
  list(): Promise<PositionskatalogItem[]>;
  get(id: string): Promise<PositionskatalogItem | null>;
  create(input: PositionskatalogInput): Promise<PositionskatalogItem | string>;
  update(id: string, input: PositionskatalogInput): Promise<PositionskatalogItem | null | string>;
  delete(id: string): Promise<boolean>;
}

export interface ProjectInvoice {
  /** Zaehler fuer den Konfliktschutz (Migration 042). Wird beim Speichern
   *  mitgeschickt; stimmt er nicht mehr, hat in der Zwischenzeit jemand
   *  anderes gespeichert und die Aenderung wird abgelehnt statt still zu
   *  ueberschreiben. Siehe src/data/konflikt.ts. */
  rev?: number;
  id: string;
  projectId: string;
  phaseId: string | null;
  phaseName?: string | null;
  nummer: string | null;
  /** Netto-Gesamtbetrag. **Abgeleitet** aus `positionen` (Summe
   *  Menge x Einzelpreis), sobald welche vorhanden sind — sonst gilt der
   *  eingetragene Wert. Bestandsrechnungen haben keine Positionen und
   *  behalten ihren Betrag. */
  betrag: number;
  /** Rechnungszeilen (Migration 046). Leer bei Bestandsrechnungen. */
  positionen: InvoicePosition[];
  datum: string | null;
  status: InvoiceStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInvoiceInput {
  phaseId?: string | null;
  nummer?: string | null;
  /** Nur wirksam, solange keine Positionen uebergeben werden — mit Positionen
   *  ergibt sich der Betrag aus ihnen. Anders herum liessen sich Summe und
   *  Zeilen auseinanderdividieren, und die Rechnung wuerde etwas anderes
   *  behaupten als sie auflistet. */
  betrag?: number;
  positionen?: InvoicePosition[];
  datum?: string | null;
  status?: InvoiceStatus;
  note?: string | null;
  rev?: number | null;
}

/** Eine Zeile im Portfolio-Cockpit — projektuebergreifend aggregiert. */
export interface PortfolioEntry {
  projectId: string;
  name: string;
  projektnummer: string | null;
  status: string | null;
  /** Name der aktuellen Phase (status='aktiv') bzw. letzte fertige. */
  currentPhase: string | null;
  /** Honorargewichteter Gesamtfortschritt 0..100. */
  progress: number;
  budget: number | null;
  /** Summe fakturierter Teilrechnungen. */
  invoiced: number;
  /** Naechste Frist (frühestes Soll-Ende einer offenen Phase ODER Termin). */
  nextDeadline: string | null;
  nextDeadlineLabel: string | null;
  openHighPrio: number;
  /** Ampel: gruen / gelb / rot — serverseitig berechnete Heuristik. */
  health: "green" | "amber" | "red";
}

export interface PhaseRepository {
  list(projectId: string): Promise<ProjectPhase[]>;
  get(id: string): Promise<ProjectPhase | null>;
  create(projectId: string, input: ProjectPhaseUpsert): Promise<ProjectPhase | string>;
  update(id: string, input: ProjectPhaseUpsert): Promise<ProjectPhase | null | string>;
  delete(id: string): Promise<boolean>;
  /** Setzt die Reihenfolge anhand einer ID-Liste. */
  reorder(projectId: string, orderedIds: string[]): Promise<boolean>;
  /** Honorargewichteter Gesamtfortschritt eines Projekts (0..100). */
  projectProgress(projectId: string): Promise<number>;
}

export interface InvoiceRepository {
  list(projectId: string): Promise<ProjectInvoice[]>;
  /** Einzelne Rechnung — fuer ACL-Pruefung vor Mutationen. */
  get(id: string): Promise<ProjectInvoice | null>;
  create(projectId: string, input: ProjectInvoiceInput): Promise<ProjectInvoice | string>;
  update(id: string, input: ProjectInvoiceInput): Promise<ProjectInvoice | null | string>;
  delete(id: string): Promise<boolean>;
}

export interface PortfolioRepository {
  /** Aggregierte Cockpit-Zeilen fuer die sichtbaren Projekte. */
  list(visibleProjectIds: string[] | "all"): Promise<PortfolioEntry[]>;
}
