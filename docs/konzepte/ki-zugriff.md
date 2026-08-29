# KI-Zugriff

> **In einem Satz:** PATIO kann je Projekt eine **Akte** erzeugen, die ein
> Sprachmodell lesen darf — und Sie bestimmen bis auf die Kategorie genau, was
> darin steht.

## Nichts geschieht von selbst

Zwei Schalter müssen stehen, sonst entsteht keine Zeile:

1. der **Hauptschalter** unter Einstellungen → KI-Zugriff, und
2. mindestens ein **Häkchen** in der Kreuztabelle Projekt × Bereich.

::: tip Deny by default
Kein Häkchen heißt **nicht freigegeben**. Ein neu angelegtes Projekt ist damit
automatisch gesperrt — die Umkehrung („alles frei, bis jemand widerspricht")
wäre bei Bauherrendaten die falsche Voreinstellung.

Der Hauptschalter sticht alles: steht er aus, liefert auch ein vollständig
abgehaktes Projekt nichts.
:::

## Die zehn Bereiche

Stammdaten · Leistungsphasen · Aufgaben · Termine · Notizen · Besprechungen ·
Bautagebuch · Entscheidungen · Rechnungen · Beteiligte

Jeder einzeln, je Projekt. Ein Projekt kann also Aufgaben und Termine
freigeben, aber keine Notizen und keine Rechnungen.

## Personenbezogene Daten

Drei Stufen, quer über **alle** freigegebenen Bereiche:

| Stufe | |
|---|---|
| **Keine Namen** | Personen erscheinen nur als Kennung — dieselbe über alle Bereiche hinweg |
| **Namen, keine Kontaktdaten** | Namen bleiben (Protokolle bleiben lesbar), aber keine E-Mail, Telefonnummer, Kontakt-Log, Stundensätze und keine Personal-Stunden im Bautagebuch |
| **Alle** | auch die Kontaktdaten |

Warum das quer über alle Bereiche wirkt: eine Freigabe für „Besprechungen"
gäbe sonst über die Teilnehmerlisten das halbe Adressbuch mit heraus.

::: warning Freitexte werden nicht durchsucht
Die Stufe wirkt auf **Felder**, nicht auf Prosa. Steht in einem Protokoll
„Hr. Müller wünscht Sichtbeton", bleibt das stehen — auch bei „Keine Namen".

Das ist eine bewusste Grenze: eine automatische Namenserkennung in Freitext
wäre entweder löchrig oder zerstörerisch, und beides wäre schlechter als eine
klare Ansage. **Wer das nicht will, gibt Notizen und Besprechungen nicht
frei.**
:::

::: tip „Keine Namen" heißt nicht „keine Person"
Personen erscheinen als ihre stabile Kennung — dasselbe Pseudonym in jedem
Bereich. Damit bleibt „wer war in Besprechung X und hat Aufgabe Y?"
beantwortbar, ohne dass ein Klarname durchsickert. Ein erfundener Platzhalter
(„Person 1") wäre pro Abschnitt verschieden und damit wertlos.
:::

## Vorschau: nicht glauben, nachlesen

Neben jedem Projekt steht ein Knopf **Vorschau**. Er zeigt genau den Text, den
die KI zu sehen bekommt — nicht mehr und nicht weniger.

Das ist der eigentliche Grund für die Bauform „eine Akte je Projekt" statt
eines Datenabzugs: eine Datei öffnen und lesen, statt einen Ordnerbaum zu
prüfen.

## Wie die Akte aufgebaut ist

Markdown mit Überschriften und Tabellen. Jeder Eintrag führt seine **Kennung**
mit, und Querverweise bleiben immer erhalten:

- eine Aufgabe zeigt auf ihre Leistungsphase,
- eine Entscheidung auf die Besprechung, in der sie fiel.

Ist die Ziel-Kategorie **nicht** freigegeben, bleibt der Verweis stehen und
nur der Klartext fehlt. So bleibt der Zusammenhang erkennbar, ohne dass die
gesperrte Kategorie mitgeht.

::: info Was nie in der Akte steht
Die Akte wird nach einer **Positivliste** gebaut: jeder Bereich schreibt genau
aufgezählte Felder. Was dort nicht steht, kommt nie hinein — Konflikt-Zähler,
Suchindex, interne Kennungen von Konten, und auch alles, was in Zukunft an die
Datenbank angehängt wird.

Die Umkehrung („alles schreiben, Heikles entfernen") wäre eine Liste, die bei
jedem neuen Feld zu ergänzen ist. Genau so entstehen Lecks.
:::

## Rechte

Freigeben, ändern **und lesen** darf nur die Verwaltung.

Auch das Lesen: die Freigabe ist ausdrücklich unabhängig von der
Projektzuordnung. Ohne diese Einschränkung wäre der Akten-Abruf der Weg, auf
dem jedes Konto an jedes freigegebene Projekt käme.

## Noch offen: wie Claude die Akte erreicht

Die Akten entstehen und sind über den Server abrufbar
(`GET /api/ki/dossier/:projectId`, Verwaltung). **Wie** ein Sprachmodell sie
liest, hängt daran, auf welchem Gerät es läuft — dafür gibt es zwei Wege:

| Weg | |
|---|---|
| **Kleiner Zubringer am Arbeitsplatz** | Ein MCP-Programm auf dem PC holt die Akten über HTTP mit einem widerrufbaren Token |
| **MCP direkt am Server** | Der Server spricht MCP selbst; braucht einen eigenen Zugang im Büronetz |

Beide gehen über HTTP, und das ist kein Zufall: PATIO hat keinen Netzordner
mehr, in den der Server die Akten legen könnte. Dateien kommen ausschließlich
durch die Anwendung herein und gehen ausschließlich durch sie wieder hinaus —
damit bleibt auch für die Akten die Rechteprüfung der einzige Weg.

Welcher der beiden der richtige ist, entscheidet sich daran, wo Claude Desktop
läuft und wer darauf zugreifen darf. Bis dahin ist der Abruf über die
Oberfläche und die Vorschau vollständig nutzbar.
