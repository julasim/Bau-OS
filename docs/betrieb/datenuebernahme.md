# Daten aus PATIO Desktop übernehmen

> **In einem Satz:** Ein Kommando liest einen Desktop-Vault und schreibt ihn in
> die Datenbank des Firmenservers — wiederholbar, in einer Transaktion, mit
> einem Bericht, der auch das Unangenehme nennt.

```bash
npm run db:import -- "\\NAS\PATIO-Vault" --trocken
```

Zuerst **immer** mit `--trocken`. Der Trockenlauf liest alles, schreibt nichts
und meldet genau dieselben Probleme, die der echte Lauf hätte.

```bash
npm run db:import -- "\\NAS\PATIO-Vault" --als jsima
```

| Schalter | |
|---|---|
| `--trocken` | Liest alles, schreibt nichts. |
| `--als <benutzername>` | Trägt dieses Konto als Ersteller ein **und gibt ihm Zugriff auf alle übernommenen Projekte.** |

## Ohne `--als` sieht nachher nur die Verwaltung etwas

Die Sichtbarkeit hängt an der Zuordnungstabelle `user_projects`. Wird beim
Import kein Konto genannt, bleibt sie leer: die Projekte sind da, aber für
jedes gewöhnliche Konto unsichtbar, und kein Datensatz hat einen Ersteller.

Das lässt sich später nur von Hand nachziehen. Der Bericht weist am Ende
darauf hin, wenn `--als` gefehlt hat.

## Was übernommen wird

Firmen · Team · Projekte · Leistungsphasen · Aufgaben · Termine · Notizen ·
Besprechungen · Entscheidungen · Bautagebuch · Rechnungen (mit Positionen) ·
Dokumente (mit dem Dateiinhalt).

Verweise zwischen den Datensätzen werden **übersetzt**: eine Aufgabe behält
ihre Zuweisung und ihre Leistungsphase, eine Entscheidung ihre Besprechung,
ein Unterprojekt sein Elternprojekt. Im Vault stehen dort achtstellige
Kennungen, hier UUIDs; die Zuordnung liegt in `import_zuordnung`.

::: warning Was der Vault nicht hergibt
**Konten.** Der Vault kennt keine Benutzer — er kennt Team-Mitglieder. Wer
sich am Server anmelden soll, braucht ein Konto, und die Verknüpfung
Konto ↔ Team-Mitglied setzt ein Administrator danach unter
`Team → Mitglied → Ich bin`.

**Stunden.** PATIO Desktop führt keine Stundenerfassung.
:::

## Der Import ist wiederholbar

Jeder übernommene Datensatz wird in `import_zuordnung` vermerkt (Quelle, Art,
Quell-ID, Ziel-UUID). Ein zweiter Lauf überspringt, was schon da ist, und der
Bericht sagt es in der Spalte „übersprungen".

Das ist kein Komfort, sondern die Voraussetzung dafür, dass man einen
abgebrochenen Import fortsetzen kann. Verglichen wird über die **Quell-ID**,
nicht über Text: die Vorgängerfassung prüfte Notizen über den Titel — von
zwanzig „Aktenvermerk"-Notizen wäre genau eine angekommen.

::: tip Die Quelle wird am Vault erkannt
`_Einstellungen/vault-meta.json` trägt eine Kennung. Zwei Ablagen (etwa zweier
Firmen) lassen sich damit nacheinander übernehmen, ohne sich gegenseitig als
„schon importiert" auszublenden.
:::

## Bricht etwas ab, ist nichts geschrieben

Der ganze Import läuft in **einer** Transaktion. Schlägt irgendetwas fehl,
rollt PostgreSQL alles zurück und die Meldung sagt genau das:

```
❌ Die Übernahme ist abgebrochen. Es wurde NICHTS geschrieben —
   die Transaktion ist vollständig zurückgerollt.

   Ursache: insert or update on table "projects" violates foreign key …
```

Die Alternative wäre ein halb gefüllter Bestand, den danach niemand mehr
auseinandersortieren kann.

## Der Bericht

```
┌───────────────────┬──────────┬──────────────┬────────────────┐
│ Art               │  gelesen │  geschrieben │  übersprungen  │
├───────────────────┼──────────┼──────────────┼────────────────┤
│ Projekte          │        2 │            2 │              0 │
│ Aufgaben          │        3 │            3 │              0 │
…
```

Darunter zwei Abschnitte, die man lesen muss:

**Nicht gelesene Verzeichnisse.** Alles im Vault, dessen Namen das Programm
nicht kennt — etwa ein selbst angelegter Ordner `Fotos`. Liegen dort Daten,
fehlen sie nach der Übernahme. Stillschweigend zu übergehen, was man nicht
kennt, ist die häufigste Art, einen Import für vollständig zu halten.

**Hinweise und Fehler.** Kaputte Dateien, Dokumente ohne Datei auf der Platte,
Werte, die die Datenbank in dieser Schreibweise nicht annimmt.

::: info Was mit unbrauchbaren Werten passiert
Status und Kategorien haben in der Datenbank feste Auswahlen. Ein Wert, der
nur in der Groß-/Kleinschreibung abweicht, wird stillschweigend korrigiert —
ihn zu verwerfen wäre Datenverlust. Ein Wert, den es gar nicht gibt, wird auf
den Standard gesetzt **und im Bericht genannt**. Eine einzige von Hand
bearbeitete Datei hat beim Bau des Programms den gesamten Import mit einem
Datenbankfehler abgebrochen.
:::

## Zeitstempel

Sie kommen aus dem Datensatz (`meta.createdAt` / `meta.updatedAt`), **nicht**
aus den Dateizeiten. Ein Kopiervorgang über das Netz setzt alle Dateizeiten auf
denselben Tag — damit wäre die gesamte Historie des Büros auf das Datum des
Kopierens gefallen.

## Projekte ohne Nummer

Der Vault führt die Projektnummer als optionales Feld, hier ist sie
[Pflicht und eindeutig](/konzepte/projektnummer). Fehlt sie, bekommt das
Projekt denselben Platzhalter wie ein Bestandsprojekt (`OHNE-NUMMER-…`) — er
wird nirgends wie eine Aktennummer angezeigt und ist damit eine sichtbare
offene Aufgabe.

Ist die Nummer hier bereits an ein anderes Projekt vergeben, bekommt das
übernommene ebenfalls den Platzhalter, und der Bericht nennt beide Projekte.

## Vorher eine Sicherung

```bash
sudo patio backup
```

Solange PATIO leer läuft, kostet ein Fehlversuch nichts — danach schon. Siehe
[Sicherung](/betrieb/sicherung).
