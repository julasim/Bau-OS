# Die Projektnummer

> **In einem Satz:** Jedes Projekt trägt eine Nummer, die Sie vergeben — und
> unter der es im ganzen Programm geführt wird.

Im Büro heißt sie zum Beispiel `SAZTG-2026-014`. In PATIO ist sie ab
Migration 052 keine Zusatzangabe unter den Stammdaten mehr, sondern die
**Kennung** des Projekts.

## Was das bedeutet

| | |
|---|---|
| **Pflicht** | Ohne Nummer wird kein Projekt angelegt. |
| **Eindeutig** | Keine zweite trägt dieselbe — auch nicht in anderer Groß-/Kleinschreibung. |
| **Von Hand** | PATIO erfindet keine Nummern. Beim Anlegen stehen die zuletzt vergebenen fünf als Gedächtnisstütze darunter. |
| **Überall sichtbar** | Neben dem Projektnamen in Aufgaben, Notizen, Terminen, Dateien, Suche, Aktivität, Papierkorb, Portfolio. |
| **Änderbar** | Ein Zahlendreher lässt sich korrigieren, ohne dass ein einziger Verweis bricht. |

## Das Format ist frei

PATIO prüft nur, was ohne jede Kenntnis Ihrer Aktenordnung falsch ist: leer,
länger als 60 Zeichen, mit unsichtbaren Steuerzeichen. Alles andere ist
erlaubt — `SAZTG-2026-014`, `A-14/2`, `Altbestand 1998/7`.

Das ist Absicht. Jedes festgeschriebene Muster steht irgendwann einem echten
Vorgang im Weg — einem Bauteil, einem Unterprojekt, einem übernommenen
Altprojekt, einem Jahreswechsel mitten im Auftrag. Und ein Muster, das im Weg
steht, wird umgangen, nicht gepflegt.

## Sie ersetzt die interne Kennung nach außen

Intern führt PATIO jedes Projekt weiter unter einer unveränderlichen
technischen Kennung (einer UUID). Die sehen Sie nirgends — und das ist der
Punkt: **überall dort, wo früher diese Kennung stand, steht jetzt Ihre
Projektnummer.**

Eine Abfrage kann ein Projekt darüber adressieren:

```
/api/tasks?projektnummer=SAZTG-2026-014
```

gleichwertig zu `?project=<Name>` und der technischen `?projectId=`. Wird
mehreres mitgeschickt, gilt: technische Kennung vor Projektnummer vor Name —
der Name ist die schwächste Angabe, weil er sich ändern kann.

::: tip Warum nicht ganz ersetzen?
Weil die Nummer von Hand vergeben wird und darum irgendwann korrigiert wird.
Wäre sie der technische Schlüssel, müsste jede Korrektur zwölf Tabellen
mitziehen — Aufgaben, Notizen, Termine, Dateien, Phasen, Rechnungen, Zeiten
und die übrigen —, und solange das läuft, ist der Datenbestand angreifbar. So
kostet dieselbe Korrektur eine einzige Änderung, und kein Verweis bricht.
:::

## Suchen

Die Suche findet ein Projekt unter

- der ganzen Nummer (`SAZTG-2026-014`),
- dem Bürokürzel allein (`SAZTG`),
- dem Anfang (`SAZTG-2026`),
- **und einem Teilstück ohne Kürzel** (`2026-014`).

Der letzte Fall ist der, den man am häufigsten tippt — das Kürzel ist bei
jedem Projekt des Hauses gleich und wird darum weggelassen.

## Eine Nummer korrigieren

Das ist ausdrücklich vorgesehen. PATIO merkt sich die alte:

- Das Projekt bleibt **unter der alten Nummer auffindbar**. Wer ein bereits
  versendetes Protokoll in der Hand hält, findet damit das richtige Projekt.
- Im Projektkopf steht sie als „früher: …".
- Die alte Nummer wird **nicht** dauerhaft gesperrt. Sonst wäre jeder
  Tippfehler eine für immer verbrannte Aktennummer.

Weil sie nicht gesperrt ist, kann eine später neu vergebene Nummer in der
Suche zwei Treffer liefern — das aktuelle Projekt und das frühere. Beide
haben mit dieser Nummer wirklich zu tun.

## In Dateinamen und Exporten

Word-Exporte und das Markdown-Dossier tragen die Nummer vorne:

```
SAZTG-2026-014 Besprechungsprotokoll 2026-08-23.docx
SAZTG-2026-014 Villa Müller.md
```

Wer zwanzig Protokolle in einem Ordner hat, sortiert sie damit nach Akte
statt nach Datum. Zeichen, die Windows in Dateinamen verbietet, werden
ersetzt: aus `A-14/2` wird `A-14-2`. In der Nummer selbst bleibt der
Schrägstrich erhalten.

## Rechnungsnummern

Beim Anlegen einer Teilrechnung schlägt PATIO die nächste freie Nummer des
Projekts vor:

```
SAZTG-2026-014-R01, -R02, -R03 …
```

**Das ist ein Vorschlag, keine Vergabe.** Sie können ihn überschreiben, und
eine doppelte Nummer wird gewarnt, nicht gesperrt: Stornos, übernommene
Vorgänge und Korrekturen folgen keinem Schema, und eine Software, die Ihre
Buchhaltung nicht kennt, sollte ein steuerlich relevantes Nummernsystem nicht
erzwingen.

Gezählt wird die höchste tatsächlich vergebene Nummer dieser Form — nicht die
Anzahl der Rechnungen. Sonst zeigte der Vorschlag nach einer gelöschten
Rechnung auf eine bereits vergebene Nummer.

## Projekte ohne Nummer

Für Projekte, die schon vor Migration 052 bestanden, trägt PATIO einen
Platzhalter ein (`OHNE-NUMMER-…`), damit die Spalte überhaupt Pflicht werden
konnte.

Dieser Platzhalter wird **nirgends wie eine Aktennummer angezeigt**. In
Projektliste, Portfolio und Projektkopf steht stattdessen „ohne Nummer" in
Warnfarbe, und in Dateinamen und Exporten fehlt er ersatzlos. Er ist eine
sichtbare offene Aufgabe, keine Nummer.

## Was PATIO als Nummer ablehnt

Neben leer und länger als 60 Zeichen auch:

- **Steuerzeichen** und **unsichtbare Formatzeichen** — Zero-Width-Space,
  Wortverbinder, Rechts-nach-links-Marke, weiches Trennzeichen. Sie kommen
  beim Einfügen aus Word oder Outlook mit und machen aus zwei *gleich
  aussehenden* Nummern zwei verschiedene.
- **Eine Nummer ohne Buchstabe oder Ziffer** — `---` ist keine Aktennummer.

Umlaute werden auf eine Schreibweise gebracht (Unicode-Normalform C), damit
`Ä` als ein Zeichen und `A` mit angehängtem Akzent dieselbe Nummer sind.
Datenbank und Programm tun das gleich; ein Test hält beide Seiten
gegeneinander.

## Beim Umstellen einer bestehenden Datenbank

Migration 052 schreibt Bestandsdaten um. Sie bereinigt dabei auch Leerraum in
vorhandenen Nummern — dadurch können zwei Einträge, die für Menschen schon
immer dieselbe Nummer waren, erstmals als Doppel auffallen.

In dem Fall **bricht die Migration mit Klartext ab** und nennt die
betroffenen Nummern:

```
Migration 052: mehrfach vergebene Projektnummern:
  saztg-2026-001 → Sanierung Hauptstraße, Wohnhaus Huber
Bitte in der Datenbank vereindeutigen und den Dienst erneut starten.
```

Die Meldung nennt die **Projektnamen**, nicht nur die Nummer: der Abbruch
rollt die Bereinigung mit zurück, die genannte Nummer stünde danach in keiner
Zeile mehr — man würde danach suchen und nichts finden.

Das ist Absicht: eine Datenbank, die ohne die Eindeutigkeit startet, während
das Programm sich darauf verlässt, wäre schlechter als ein Dienst, der mit
einer klaren Meldung stehen bleibt. Die Migration läuft in einer Transaktion —
beim Abbruch bleibt das Schema unversehrt.

**Vor dem ersten Start auf einem Server mit echten Daten eine Sicherung
ziehen** (siehe [Sicherung](/betrieb/sicherung)).

Migration 054 bereinigt zusätzlich Leerraum, den 052 stehen ließ — Tabulator,
Zeilenumbruch, geschütztes Leerzeichen, Byte-Reihenfolge-Marke. Solche Werte
entstehen nicht über PATIO, wohl aber beim Übernehmen fremder Daten. Dabei
können zwei Einträge, die für Menschen schon immer dieselbe Nummer waren,
erstmals als Doppel auffallen; dann bricht 054 mit derselben Klartext-Meldung
ab und nennt die **Projektnamen**.
