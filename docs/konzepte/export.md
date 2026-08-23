# Was PATIO herausgeben kann

> **In einem Satz:** Fünf Dokumentarten aus Ihren eigenen Word-Vorlagen,
> wahlweise als PDF — und einmal der ganze Bestand als Textdateien.

## Die fünf Dokumentarten

| Art | Wo | Enthält |
|---|---|---|
| **Besprechungsprotokoll** | Projekt → Besprechungen | Agenda, Protokoll, Beschlüsse, Teilnehmer, Aufgaben |
| **Bautagebuch** | Projekt → Bautagebuch | Ein Tag: Wetter, Personal, Maschinen, Tätigkeiten, Vorkommnisse |
| **Stundenzettel** | Projekt → Stunden | Alle Zeiten im Zeitraum, mit Summe |
| **Projektübersicht** | Projektkopf | Stammdaten |
| **Rechnung** | Projekt → Rechnungen | Positionen, Netto, Umsatzsteuer je Satz, Endbetrag |

::: tip Die Rechnung war die Lücke
Die anderen vier gibt es länger. Die Rechnung fehlte — obwohl alle Daten im
System stehen: Positionen, Menge, Einzelpreis, Umsatzsteuersatz, Phase,
Projektnummer. Für ein Büro, das Honorare abrechnet, ist sie die einzige
Datenart, die das Haus wirklich verlässt.

Gerechnet wird dabei im Server, nicht in der Vorlage: Word kann keine Summe
über eine Schleife bilden, und eine Rechnung, deren Endbetrag von der Vorlage
abhängt, ist keine Rechnung.
:::

## Ihre Vorlagen, nicht unsere

Jede Art rendert aus einer **`.docx`, die Sie hochladen** — mit Ihrem Logo,
Ihrer Schrift, Ihrer Kopf- und Fußzeile. Verwaltet unter
**Einstellungen → Word-Export**: hochladen, als Standard markieren, Testdruck,
Original herunterladen.

Die Platzhalter stehen dort je Art aufgelistet, zum Beispiel für die Rechnung:

```
{Rechnung.Nummer}   {Rechnung.Datum}    {Rechnung.Phase}
{Rechnung.Netto}    {Rechnung.Ust}      {Rechnung.Brutto}
{Projekt.Name}      {Projekt.Projektnummer}   {Projekt.Bauherr}

{#Positionen}{Nr} {Text} {Menge} {Einheit} {Einzelpreis} {Summe}{/Positionen}
{#UstZeilen}{Satz} % … {Betrag}{/UstZeilen}
```

**Mehrere Vorlagen je Art** sind möglich — etwa „Protokoll ausführlich" und
„Protokoll kurz". Gibt es mehr als eine, erscheint beim Export ein Auswahlfeld
daneben; bei genau einer nicht.

## PDF: dieselbe Datei, anderes Format

Jeder Export hat neben „Word" einen Knopf „PDF". Dahinter steckt **genau
dieselbe** Word-Datei, durch LibreOffice geschickt.

::: warning Warum keine eigene PDF-Erzeugung
Weil das ein zweites Layoutsystem wäre. Eine PDF-Bibliothek könnte Ihre
Word-Vorlage nicht lesen — sie bräuchte ein eigenes Layout, das dann irgendwann
anders aussieht als der Word-Export. Zwei Ausgaben desselben Dokuments, die
sich unterscheiden, sind schlimmer als eine.
:::

**PDF ist optional.** LibreOffice wiegt rund 350 MB im Server-Abbild, und jedes
Offline-Update trägt die Last mit. Ist es nicht installiert, erscheint der
PDF-Knopf gar nicht erst, und ein direkter Aufruf antwortet mit einem Satz in
Klartext statt eines Serverfehlers. Der Word-Export bleibt in jedem Fall
vollständig.

Abschalten beim Bauen:

```bash
docker compose build --build-arg MIT_PDF=nein app
```

## Der Volldump — die Lock-in-Versicherung

**Verwaltung → Sicherung → Volldump herunterladen**

Ein ZIP mit dem gesamten Bestand als Ordnerbaum aus `.md`-Dateien:

```
LIESMICH.md
SAZTG-2026-014 Wohnhaus Müller/
    Stammdaten.md
    Aufgaben.md
    Termine.md
    Entscheidungen.md
    Bautagebuch.md
    Leistungsphasen.md
    Rechnungen.md
    Notizen/001 Aktenvermerk Fassade.md …
    Besprechungen/2026-05-12 Jour fixe.md …
    Dokumente/Grundriss EG.pdf …
Team.md
```

Lesbar mit jedem Texteditor — ohne PATIO, ohne PostgreSQL, ohne Docker. Die
hochgeladenen Dateien liegen als echte Dateien mit im Archiv.

::: danger Der Volldump ersetzt keine Sicherung
Eine [Sicherung](/betrieb/sicherung) ist ein Datenbankabzug: sie hilft, wenn
PATIO **wieder aufgesetzt** wird. Der Volldump hilft, wenn PATIO **nicht mehr
aufgesetzt** wird.

Zwei verschiedene Fragen, zwei verschiedene Antworten. Keine ersetzt die
andere.
:::

## Rechte

Ein Export ist kein Weg an den Rechten vorbei.

| | |
|---|---|
| Projektbezogene Exporte | brauchen Zugriff auf das Projekt — sonst 403 |
| **Rechnung** | braucht **zusätzlich das Geld-Recht** |
| Volldump | enthält nur die sichtbaren Projekte; ohne Geld-Recht ohne Beträge |

::: warning Warum das Geld-Recht hier eigens geprüft wird
Der [Antwort-Filter](/sicherheit/zugriff) räumt Geldbeträge aus jeder
JSON-Antwort. Eine `.docx` und ein ZIP sind kein JSON — der Filter sieht sie
nicht, und die Beträge stehen darin ausgeschrieben.

Ohne die eigene Prüfung wäre der Rechnungsexport der Weg, auf dem ein Konto
ohne Geld-Recht doch an Honorare kommt. Genau diese Klasse Lücke war der
Word-Export schon einmal.
:::

Ein unbekannter Datensatz antwortet mit **404, nicht 403** — sonst verriete der
Statuscode, welche Datensätze es gibt.
