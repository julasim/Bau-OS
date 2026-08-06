// ============================================================
// PATIO — Konfliktschutz beim gleichzeitigen Bearbeiten
// ============================================================
// Auf dem Firmenserver arbeiten mehrere Leute gleichzeitig am selben
// Bestand. Ohne Schutz gilt „wer zuletzt speichert, gewinnt" — und der
// andere merkt nichts: seine Aenderung ist weg, ohne Meldung, ohne Spur.
//
// Das Verfahren ist bewusst das einfachste, das traegt: jeder Datensatz
// traegt einen Zaehler `rev`. Wer bearbeitet, bekommt ihn mitgeliefert und
// schickt ihn beim Speichern zurueck. Die Datenbank aktualisiert dann nur,
// wenn der Zaehler noch stimmt:
//
//     UPDATE … SET …, rev = rev + 1 WHERE id = $1 AND rev = $2
//
// Keine betroffene Zeile heisst: in der Zwischenzeit hat jemand anderes
// gespeichert. Dann wird NICHT ueberschrieben, sondern abgelehnt.
//
// Warum ein Zaehler und kein Zeitstempel: Zeitstempel haengen an der Uhr des
// Servers, kollidieren bei schnellen Folgeaenderungen innerhalb derselben
// Millisekunde und laden dazu ein, „ungefaehr gleich" zu vergleichen. Ein
// Zaehler ist exakt oder nicht.
// ============================================================

/** Wird geworfen, wenn zwischen Laden und Speichern jemand anderes
 *  gespeichert hat.
 *
 *  `app.onError` (src/api/server.ts) macht daraus einen **409** samt dem
 *  aktuellen Stand — der Aufrufer kann dem Benutzer dann zeigen, was sich
 *  geaendert hat, statt ihn ins Leere laufen zu lassen.
 *
 *  Bewusst eine eigene Klasse und kein Rueckgabewert: sonst muesste jede der
 *  neun `update()`-Signaturen und jeder Aufrufer einen dritten Fall
 *  behandeln. Der Wurf geht durch bis zur zentralen Fehlerbehandlung, die es
 *  an genau einer Stelle in HTTP uebersetzt. */
export class KonfliktFehler extends Error {
  /** Der Stand, wie er jetzt in der Datenbank liegt. */
  readonly aktuell: unknown;
  /** Zaehler, den der Aufrufer erwartet hat. */
  readonly erwartet: number;
  /** Zaehler, der tatsaechlich in der Datenbank steht. */
  readonly tatsaechlich: number;

  constructor(aktuell: unknown, erwartet: number, tatsaechlich: number) {
    super(
      "Der Datensatz wurde zwischenzeitlich von jemand anderem geaendert. " +
        "Bitte neu laden und die Aenderung erneut eintragen.",
    );
    this.name = "KonfliktFehler";
    this.aktuell = aktuell;
    this.erwartet = erwartet;
    this.tatsaechlich = tatsaechlich;
  }
}

/** Prueft den mitgelieferten Zaehler gegen den Stand in der Datenbank.
 *
 *  `expectedRev` ist absichtlich optional: Aufrufer, die keinen Zaehler
 *  mitschicken (interne Jobs, Migrationen, aeltere Clients), sollen weiter
 *  funktionieren — dort gilt weiterhin „wer zuletzt speichert, gewinnt".
 *  Sobald ein Zaehler kommt, wird er ernst genommen.
 *
 *  @throws KonfliktFehler wenn der Zaehler nicht mehr stimmt. */
export function pruefeRev(aktuellerDatensatz: unknown, dbRev: unknown, expectedRev?: number | null): void {
  if (expectedRev === undefined || expectedRev === null) return;
  const ist = Number(dbRev ?? 1);
  if (Number(expectedRev) !== ist) {
    throw new KonfliktFehler(aktuellerDatensatz, Number(expectedRev), ist);
  }
}
