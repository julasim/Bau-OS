// ============================================================
// PATIO — Event Bus
// Typisierter In-Memory Event-Emitter fuer Live-Updates.
// SSE-Clients registrieren sich hier, die Routes emittieren hier.
// ============================================================
//
// Der Kanal war bis zuletzt die einzige Stelle im System OHNE Rechtefilter:
// `emit()` schrieb jedes Ereignis an jeden verbundenen Client, und das
// Ereignis trug ein freies `data`-Feld. Wer angemeldet war, sah damit den
// Datenstrom aller Projekte — auch derer, fuer die ihm jede andere Route
// ein 403 gibt. Dagegen stehen jetzt zwei Stufen:
//
//   Stufe 1 — kein Inhalt mehr im Ereignis. Ein DataEvent sagt nur noch WAS
//     sich geaendert hat (`type`/`action`/`id`/`projectId`), nicht wie es
//     aussieht. Der Client laedt ueber die regulaere Route nach, und die
//     filtert bereits. Ueber den Kanal kann damit grundsaetzlich nichts
//     entweichen, was die Route nicht ohnehin ausliefern wuerde.
//   Stufe 2 — jeder Abonnent bringt einen Sichtbarkeits-Kontext mit
//     (`EventScope`), und `emit()` stellt nur zu, was dieser Kontext sehen
//     darf. Massstab ist derselbe wie ueberall sonst: die sichtbaren
//     Projekte aus `getVisibleProjectIds()`.
//
// ============================================================

export type EventType =
  | "task"
  | "termin"
  | "note"
  | "project"
  | "file"
  | "team"
  | "bautagebuch"
  | "meeting"
  | "time"
  | "phase"
  | "invoice";

export type EventAction = "created" | "updated" | "deleted" | "completed" | "saved" | "synced";

/** Was tatsaechlich ueber die Leitung geht.
 *
 *  Bewusst OHNE Nutzdaten: kein `data`-Feld, kein Text, keine Betraege. Das
 *  fruehere `data?: Record<string, unknown>` war ein offenes Scheunentor —
 *  jede Route konnte beliebigen Inhalt anhaengen, und der ging an jeden
 *  verbundenen Client. `id` ist die Referenz auf den Datensatz, mit der der
 *  Client ueber die regulaere (gefilterte) Route nachlaedt. */
export interface DataEvent {
  type: EventType;
  action: EventAction;
  /** Referenz auf den geaenderten Datensatz (UUID, bei Projekten/Notizen der
   *  Name). Nur als Nachlade-Schluessel gedacht. */
  id?: string;
  /** UUID des Projekts, an dem der Datensatz haengt. `null`/fehlend =
   *  projektlos (persoenliche Aufgabe, Team-Eintrag, Firma, Benutzerkonto). */
  projectId?: string | null;
  timestamp: string;
}

/** Zustell-Angaben, die NICHT ausgeliefert werden — sie helfen nur beim
 *  Verteilen und tauchen im SSE-Payload nicht auf. */
export interface EmitMeta {
  /** `users.id` des Ausloesers. Siehe Ausloeser-Regel in `mayReceive()`. */
  actorId?: string | null;
}

/** Sichtbarkeits-Kontext eines Abonnenten.
 *
 *  Das Objekt wird von der SSE-Route angelegt und dort periodisch AN ORT UND
 *  STELLE aufgefrischt (siehe `routes/events.ts`). Deshalb haelt der Event-Bus
 *  die Referenz und liest bei jedem Ereignis den aktuellen Stand — eine einmal
 *  kopierte Liste waere nach der ersten Rechteaenderung falsch. */
export interface EventScope {
  /** `users.id` des Abonnenten. `null` bei Legacy-Konten ohne UUID. */
  userId: string | null;
  /** true = kein Filter (Admin, oder ein Repo ohne ACL-Unterstuetzung).
   *  Wird bei jeder Auffrischung neu bestimmt, damit ein herabgestufter Admin
   *  den Kanal nicht bis zum Verbindungsabbruch weiter voll bekommt. */
  unrestricted: boolean;
  /** Momentaufnahme der sichtbaren Projekt-UUIDs. */
  projectIds: Set<string>;
}

type EventListener = (event: DataEvent) => void;

interface Subscription {
  listener: EventListener;
  scope: EventScope;
}

const subscriptions = new Set<Subscription>();

/** Entscheidet, ob ein Abonnent dieses Ereignis bekommen darf.
 *
 *  Reine Funktion, absichtlich exportiert: so laesst sich die Verteil-Regel
 *  ohne HTTP und ohne offenen Stream pruefen (tests/api-events-acl.test.ts).
 *
 *  Die beiden Sonderfaelle, bewusst so entschieden:
 *
 *  1. **Projektlose Ereignisse** (`projectId` fehlt oder ist null) gehen nur
 *     an Admins und an den Ausloeser. Begruendung: der Rest des Systems
 *     behandelt projektlose Datensaetze als „nur fuer Ersteller/Zugewiesene
 *     sichtbar" (siehe `src/data/access.ts` und die Filter in tasks/termine/
 *     search). Wer Ersteller oder Zugewiesener ist, steht aber nicht im
 *     Ereignis — das festzustellen hiesse, pro Ereignis und pro verbundenem
 *     Client den Datensatz nachzuladen. Deshalb wird hier bewusst zu wenig
 *     statt zu viel zugestellt. Der Ausloeser ist die eine sichere Ausnahme:
 *     er hat die Aenderung gerade selbst durch die ACL geschrieben, ihm sagt
 *     das Ereignis nichts Neues. Praktische Folge: die Team-/Firmen-Listen
 *     und persoenliche Aufgaben aktualisieren sich bei FREMDEN Aenderungen
 *     nicht live, sondern erst beim naechsten Laden.
 *
 *  2. **Der Ausloeser** bekommt sein eigenes Ereignis immer. Das ist auch bei
 *     Projekt-Ereignissen unbedenklich: die ausloesende Route hat den Zugriff
 *     vorher geprueft, und der Client kennt die IDs aus seinem eigenen
 *     Request bereits. */
export function mayReceive(scope: EventScope, event: DataEvent, actorId: string | null = null): boolean {
  if (scope.unrestricted) return true;
  if (actorId && scope.userId && actorId === scope.userId) return true;
  if (!event.projectId) return false;
  return scope.projectIds.has(event.projectId);
}

/** Registriert einen Listener samt Sichtbarkeits-Kontext. Gibt die
 *  unsubscribe-Funktion zurueck.
 *
 *  Der Kontext ist Pflicht — ohne ihn gaebe es wieder einen ungefilterten
 *  Abonnenten, und genau das war der Befund. Wer wirklich alles sehen soll,
 *  uebergibt `{ userId, unrestricted: true, projectIds: new Set() }`. */
export function subscribe(listener: EventListener, scope: EventScope): () => void {
  const sub: Subscription = { listener, scope };
  subscriptions.add(sub);
  return () => {
    subscriptions.delete(sub);
  };
}

/** Emittiert ein Data-Event an alle Abonnenten, die es sehen duerfen. */
export function emit(event: Omit<DataEvent, "timestamp">, meta: EmitMeta = {}): void {
  const full: DataEvent = { ...event, timestamp: new Date().toISOString() };
  const actorId = meta.actorId ?? null;
  for (const sub of subscriptions) {
    if (!mayReceive(sub.scope, full, actorId)) continue;
    try {
      sub.listener(full);
    } catch {
      // Listener-Fehler ignorieren (z.B. geschlossene SSE-Verbindung)
    }
  }
}

/** Wie `emit()`, loest aber vorher den Projekt-NAMEN zur Projekt-UUID auf.
 *
 *  Warum ueberhaupt: die meisten Routes haben nur den Namen zur Hand (Tasks,
 *  Termine und Notizen speichern kein `project_id` im DTO). Die Aufloesung
 *  gehoert deshalb hierher und nicht in jede einzelne Route — sonst stuenden
 *  60 Aufrufstellen mit derselben `getInfo()`-Zeile davor.
 *
 *  Zwei Eigenheiten, die man kennen muss:
 *  - **Fire-and-forget.** Die Aufloesung ist ein DB-Zugriff, der Aufrufer
 *    wartet nicht. Das Ereignis geht also einen Tick spaeter raus als die
 *    HTTP-Antwort. Fuer Live-Updates ist das ohne Belang.
 *  - **Fail-closed.** Laesst sich der Name nicht aufloesen (unbekannt,
 *    inzwischen geloescht, DB-Fehler), geht das Ereignis mit
 *    `projectId: null` raus und erreicht damit nur Admins und den Ausloeser —
 *    nie versehentlich alle. */
export function emitForProjectName(
  event: Omit<DataEvent, "timestamp" | "projectId">,
  projectName: string | null | undefined,
  meta: EmitMeta = {},
): void {
  if (!projectName) {
    emit({ ...event, projectId: null }, meta);
    return;
  }
  void (async () => {
    let projectId: string | null = null;
    try {
      const { projectRepo } = await import("../data/index.js");
      projectId = (await projectRepo.getInfo(projectName))?.id ?? null;
    } catch {
      projectId = null;
    }
    emit({ ...event, projectId }, meta);
  })();
}

/** Anzahl aktiver Abonnenten (fuer Monitoring). */
export function listenerCount(): number {
  return subscriptions.size;
}
