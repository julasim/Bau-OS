# Das Aufgabensystem

> **In einem Satz:** Der Zweck ist nicht, Aufgaben zu verwalten — sondern
> jeden Morgen eine belastbare Auswahl zu treffen und sichtbar zu machen, wo
> diese Auswahl an eine Grenze stößt.

Der Aufgabenreiter hat vier Arbeitsweisen. Umgeschaltet wird über den Streifen
oben in der Leiste:

| | Wofür |
|---|---|
| **Liste** | Die gewohnte Aufgabenliste mit Detailansicht. Unverändert. |
| **Eingang** | Erfassen und einordnen. Ein Feld, Enter, nächster Titel. |
| **Matrix** | Vier Ränge nebeneinander, mit Zahlen statt Bauchgefühl. |
| **Mein Tag** | Was Sie sich für heute vorgenommen haben — und was das kostet. |

## Rang statt Priorität

Aufgaben tragen einen **Rang** von 1 bis 4. Er beantwortet zwei Fragen auf
einmal:

| Rang | | Grenze |
|---|---|---|
| **1** | dringend **und** wichtig — *Sofort* | höchstens 5 offene, über alle Projekte |
| **2** | wichtig, nicht dringend — *Terminieren* | mindestens eine pro Tag |
| **3** | dringend, nicht wichtig — *Sammeln* | höchstens 60 Minuten am Tag |
| **4** | keins von beidem — *Streichen* | verfällt nach 30 Tagen in den Papierkorb |

**Der Standard ist 3, nicht 1.** Der Normalfall wird nicht markiert; aktiv
gesetzt wird nur 1, 2 oder 4. Aus sechzig Entscheidungen pro Abend werden so
fünfzehn — und an dieser Zahl entscheidet sich, ob eine Abendroutine die
dritte Woche überlebt.

::: tip Warum nicht das vorhandene Feld „Priorität"?
Es gibt seit der ersten Fassung eine Spalte `priority` (niedrig/mittel/hoch).
Sie bleibt, weil Portfolio und Projektliste darauf zählen — aber sie misst
etwas anderes: eine Achse statt zweier Fragen. Und sie wurde nie benutzt: am
23.08.2026 standen **alle 946 Aufgaben** auf `mittel`.
:::

## Der geschätzte Aufwand ist grob gerastert

15, 30, 60, 120, 180 oder 240 Minuten — dazwischen gibt es nichts. Das ist
Absicht: eine Summe aus solchen Stufen lässt sich im Kopf nachrechnen, eine
aus krummen Minutenwerten nicht.

**Ohne Schätzung** ist ein gültiger Zustand — er heißt „liegt noch im
Eingang". Genau daran erkennt der Eingang, was noch nicht durchgesehen ist.

## Der Eingang muss abends leer sein

Das ist seine einzige Regel, deshalb steht die Zahl groß oben.

Beim Erfassen fragt PATIO **nichts** ab — kein Projekt, kein Rang, kein
Termin. Jede Zusatzabfrage kostet eine Entscheidung im falschen Moment, und
wer beim Erfassen einordnen muss, erfasst irgendwann nicht mehr, sondern merkt
sich Dinge wieder im Kopf. Eingeordnet wird darunter, in zwei Klicks je Zeile.
Sobald ein Aufwand daransteht, verschwindet die Zeile aus dem Eingang.

## Mein Tag rechnet, statt zu verbieten

Das Tagesbudget sind **300 Minuten** — fünf Fokusstunden, nicht acht. Der Rest
des Tages sind Termine, Wege, Rückfragen, Unterbrechungen.

Die Ansicht zeigt die Auslastung in Prozent, die Summe der ausgewählten
Aufwände und wie viel davon auf Rang 3 entfällt.

::: warning Keine dieser Grenzen sperrt
Die Routen lehnen nichts ab, wenn eine Grenze überschritten ist — sie liefern
die Zahl, und die Oberfläche verlangt eine bewusste Bestätigung.

Das ist kein Versehen. Eine harte Sperre wird nach der zweiten Umgehung zur
Gewohnheit, und dann ist das ganze System entwertet. Eine Grenze, die man mit
einer bewussten Bestätigung überschreiten kann, wirkt dagegen dauerhaft — weil
man sich beim Bestätigen selbst zusieht.
:::

## Der Tag beginnt leer

Um Mitternacht (`TIMEZONE`) leert der Wartungs-Cron den Tagesplan **für
alle**. Die Aufgaben selbst bleiben unverändert: es gibt keine
Rückstandsliste, keine Übertragung, keine roten Zahlen von gestern. Wer eine
Aufgabe heute wieder will, wählt sie heute wieder aus.

## Der Tagesplan gehört Ihnen, nicht dem Büro

Die Auswahl ist **pro Person** gespeichert (`tagesplan_von`). Die
zugrundeliegende Spezifikation ist für eine Einzelperson geschrieben; auf
einem gemeinsamen Server würde sonst der eine dem anderen den Tag abräumen.

Sichtbar sind wie überall nur Aufgaben aus Projekten, die Sie sehen dürfen —
die drei Ansichten holen den Rechtefilter genauso wie jede andere Route.

## Rang 4 verfällt nach 30 Tagen

Was auf Rang 4 steht und **seit 30 Tagen niemand mehr angefasst hat**, wandert
im nächtlichen Wartungslauf (03:15) in den **Papierkorb**. Von dort ist es
wiederherstellbar — verfallen heißt nicht gelöscht.

Sonst wächst genau die Halde, gegen die das ganze System gebaut ist: eine
Liste, in der neben dem Wichtigen dreihundert Dinge stehen, die man vor einem
halben Jahr einmal für erwähnenswert hielt.

| Verfällt | Verfällt nicht |
|---|---|
| Rang 4, offen, seit 30 Tagen unberührt | Rang 1, 2 und 3 — egal wie alt |
| | Erledigtes: die Einordnung war richtig, und es wurde trotzdem getan |
| | Was schon im Papierkorb liegt |

**Jede Berührung setzt die Frist zurück.** Gemessen wird an „zuletzt geändert",
und dieser Zeitstempel wird von der Datenbank selbst gepflegt — die Anwendung
kann ihn nicht umgehen. Wer eine Aufgabe noch anfasst, meint sie noch.

Die Frist steht in `RANG4_VERFALL_TAGE`; `0` schaltet den Verfall ab.

## Grenzen der heutigen Fassung

- **Eingang und Matrix zeigen höchstens 40 Zeilen je Spalte.** Darunter steht,
  wie viele nicht gezeigt werden; die Zahl oben zählt weiterhin alle. Ein
  Deckel ohne diese Zeile wäre eine stille Lüge. „Mein Tag" braucht keinen —
  eine Tagesauswahl, die 40 Zeilen überschreitet, ist keine Auswahl mehr.
- **Aufgaben ohne Schätzung zählen mit 0 Minuten** in die Tagessumme. Die
  Auslastung ist damit eine Untergrenze, nicht die Wahrheit — und genau
  deshalb steht die Zahl der ungeschätzten daneben.
