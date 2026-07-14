# Tool-Referenz

68 Tools in 15 Kategorien stehen dem Agenten zur Verfügung, plus das spezielle `antworten`-Terminator-Tool. Die Tools werden in jeder LLM-Runde automatisch bereitgestellt und können direkt aufgerufen werden.

---

## Spezialtool: `antworten`

Das einzige Tool das Text an den Nutzer ausgibt. Der Agent kann **nicht** direkt Text erzeugen — er muss immer `antworten` aufrufen. `runtime.ts` wertet diesen Aufruf als Schleifenende.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | string | ✓ | Die Antwort an den Benutzer (Markdown erlaubt) |

---

## Notizen (5 Tools)

### `notiz_speichern`

Speichert eine freie Notiz im Workspace (Inbox oder Projektordner). Für Gedanken, Beobachtungen, Ideen und Informationen die keine konkrete Aufgabe oder Termin sind. Ohne Projekt landet die Notiz in der Inbox.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | string | ✓ | Inhalt der Notiz |
| `projekt` | string | – | Optionaler Projektname |

---

### `notizen_auflisten`

Listet die letzten Notizen aus der Inbox auf, sortiert nach Datum. Für einen Überblick über aktuelle Notizen oder um eine bestimmte Notiz zu finden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `anzahl` | number | – | Wie viele Notizen anzeigen (Standard: 5) |

---

### `notiz_lesen`

Liest den vollständigen Inhalt einer Notiz-Datei. Vorher `notizen_auflisten` nutzen um den genauen Dateinamen zu finden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `dateiname` | string | ✓ | Name der Notiz-Datei |

---

### `notiz_loeschen`

Löscht eine Notiz dauerhaft aus dem Workspace. Nicht rückgängig machbar.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `dateiname` | string | ✓ | Name der Notiz-Datei |

---

### `notiz_bearbeiten`

Fügt einer bestehenden Notiz am Ende einen Nachtrag hinzu (Append). Der Nachtrag wird mit Zeitstempel angehängt. Nicht für Ersetzen — dafür `datei_bearbeiten` verwenden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `dateiname` | string | ✓ | Name der Notiz-Datei |
| `text` | string | ✓ | Inhalt des Nachtrags |

---

## Aufgaben (3 Tools)

### `aufgabe_speichern`

Speichert eine neue Aufgabe (Todo). Aufgaben immer mit konkretem Verb beginnen. Optional einem Projekt und einem Team-Mitglied zuordnen. Bei Zuweisung bekommt das Mitglied automatisch eine Telegram-Benachrichtigung (sofern verlinkt).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | string | ✓ | Beschreibung der Aufgabe |
| `projekt` | string | – | Optionaler Projektname |
| `zuweisung` | string | – | Team-Mitglied dem die Aufgabe zugewiesen wird (Name oder Teilname) |
| `faellig` | string | – | Fälligkeitsdatum im Format TT.MM.JJJJ |

---

### `aufgaben_auflisten`

Listet alle offenen (nicht erledigten) Aufgaben auf. Optional auf ein Projekt filterbar. Zeigt Aufgabentext, Verantwortlichen und Fälligkeitsdatum an.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | string | – | Optional: nur Aufgaben eines Projekts |

---

### `aufgabe_erledigen`

Markiert eine Aufgabe als erledigt (done). Der Text muss exakt übereinstimmen — vorher `aufgaben_auflisten` nutzen.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | string | ✓ | Exakter Text der Aufgabe |
| `projekt` | string | – | Optionaler Projektname |

---

## Termine (3 Tools)

### `termin_speichern`

Speichert einen neuen Termin, Meeting oder Deadline. Datum immer im Format TT.MM.JJJJ angeben. Relative Angaben wie "morgen" müssen vorher in ein konkretes Datum umgerechnet werden. Optional Team-Mitglieder als Teilnehmer einladen — die bekommen automatisch eine Telegram-Benachrichtigung.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `datum` | string | ✓ | Datum im Format TT.MM.JJJJ |
| `text` | string | ✓ | Beschreibung des Termins |
| `uhrzeit` | string | – | Uhrzeit im Format HH:MM |
| `projekt` | string | – | Optionaler Projektname |
| `teilnehmer` | string | – | Team-Mitglieder als Teilnehmer (komma-getrennt); nicht erkannte Namen werden als Freitext gespeichert |

---

### `termine_auflisten`

Listet alle gespeicherten Termine auf, sortiert nach Datum. Zeigt Datum, Uhrzeit, Beschreibung und Ort an. Optional auf ein Projekt filterbar.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | string | – | Optional: nur Termine eines Projekts |

---

### `termin_loeschen`

Löscht einen Termin dauerhaft. Der Text muss exakt oder als Teiltext übereinstimmen.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | string | ✓ | Text oder Teiltext des Termins |
| `projekt` | string | – | Optionaler Projektname |

---

## Dateien (11 Tools)

### `datei_lesen`

Liest den Inhalt einer Datei im Workspace. Unterstützt Textdateien (.md, .txt, .json etc.) und Dokumente (.pdf, .docx). PDF- und Word-Dateien werden automatisch extrahiert. Pfad relativ zum Workspace-Root.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `pfad` | string | ✓ | Relativer Pfad im Workspace, z.B. `Projekte/Alpha/README.md` |

---

### `datei_erstellen`

Erstellt eine neue Datei im Workspace oder überschreibt eine bestehende. Fehlende Ordner werden automatisch erstellt.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `pfad` | string | ✓ | Relativer Pfad im Workspace |
| `inhalt` | string | ✓ | Dateiinhalt |

---

### `ordner_auflisten`

Listet den Inhalt eines Ordners im Workspace auf (Dateien und Unterordner). Zeigt nur eine Ebene — nicht rekursiv. Für rekursive Suche `dateien_suchen` verwenden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `pfad` | string | – | Relativer Pfad (leer = Workspace-Wurzel) |

---

### `vault_suchen`

Keyword-Textsuche nur in System-Dateien im Workspace (IDENTITY, SOUL, BOOT, TOOLS, AGENTS, MEMORY, HEARTBEAT, USER). **Nicht** für User-Inhalte — Notizen und hochgeladene Dateien sind nur über `semantisch_suchen` erreichbar. Verwenden wenn du etwas über deine eigene Konfiguration wissen willst.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `suchbegriff` | string | ✓ | Der Suchbegriff |
| `projekt` | string | – | Optional: Suche auf ein Projekt begrenzen |

---

### `semantisch_suchen`

**Haupt-Suchtool für User-Inhalte.** Findet Notizen, hochgeladene Dateien (PDF, DOCX, MD), Angebote, Protokolle, Baubeschreibungen etc. nach Bedeutung — nicht nur nach exaktem Text. Nutzt KI-Embeddings (pgvector). Bei nicht aktivierter Datenbank: Fallback auf Textsuche.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `frage` | string | ✓ | Die Suchanfrage in natürlicher Sprache |
| `typ` | string (enum) | – | Suchbereich: `all` (Standard), `note` (nur Notizen), `file` (nur Dateien) |
| `limit` | number | – | Max. Ergebnisse (Standard: 8) |
| `projekt` | string | – | Optional: Suche auf ein Projekt beschränken |

---

### `datei_bearbeiten`

Sucht Text in einer Workspace-Datei und ersetzt ihn (Find-and-Replace). Unterstützt exakte Textsuche und Regex-Muster. Nicht für Notiz-Nachträge — dafür `notiz_bearbeiten` nutzen.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `pfad` | string | ✓ | Relativer Pfad im Workspace |
| `suchen` | string | ✓ | Text der gesucht wird (exakt oder Regex) |
| `ersetzen` | string | ✓ | Ersetzungstext |
| `regex` | boolean | – | `true` = suchen ist ein Regex-Muster (Standard: false) |
| `alle` | boolean | – | `true` = alle Vorkommen ersetzen (Standard: false, nur erstes) |

---

### `dateien_suchen`

Sucht Dateien nach Name oder Muster. Bei aktiver Datenbank werden alle hochgeladenen Dateien (PDF, DOCX, Bilder etc.) durchsucht. Unterstützt Glob-Platzhalter (`**/*.pdf`, `*deutsch*`).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `muster` | string | ✓ | Glob-Muster (z.B. `**/*.pdf`, `Projekte/*/*.md`) |
| `ordner` | string | – | Optional: Startordner (Standard: Workspace-Wurzel) |
| `limit` | number | – | Max. Ergebnisse (Standard: 50) |

---

### `regex_suchen`

Regex-Suche in System-Dateien des Workspace (Agent-Files, Tools, Configs — nicht User-Content). Gibt Treffer mit Zeilennummern zurück. Für User-Inhalte immer `semantisch_suchen` verwenden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `muster` | string | ✓ | Regex-Suchmuster (z.B. `OENORM.*B\\s?1801`, `TODO\|FIXME`) |
| `ordner` | string | – | Optional: Unterordner (Standard: gesamter Workspace) |
| `kontext` | number | – | Zeilen Kontext vor/nach Treffer (Standard: 0) |
| `dateifilter` | string | – | Optional: Datei-Glob (z.B. `*.md`, `*.json`) |
| `limit` | number | – | Max. Treffer gesamt (Standard: 20) |

---

### `pdf_erstellen`

Erstellt eine PDF-Datei mit Titel und Textinhalt. Speichert die PDF im Workspace unter `Exports/`. Danach `datei_senden` aufrufen um sie an den Nutzer zu schicken.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `titel` | string | ✓ | Titel der PDF (erscheint als Überschrift) |
| `inhalt` | string | ✓ | Textinhalt der PDF (Zeilenumbrüche erlaubt) |
| `dateiname` | string | ✓ | Dateiname, z.B. `Bericht_April.pdf` (ohne Pfad) |

---

### `docx_erstellen`

Erstellt eine Word-Datei (.docx) mit Titel und Textinhalt. Ideal wenn der Nutzer ein bearbeitbares Dokument braucht (Angebot, Vertrag, Protokoll). Speichert die Datei im Workspace unter `Exports/`. Danach `datei_senden` aufrufen.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `titel` | string | ✓ | Titel des Dokuments (erscheint als Überschrift) |
| `inhalt` | string | ✓ | Textinhalt des Dokuments (Zeilenumbrüche erlaubt) |
| `dateiname` | string | ✓ | Dateiname, z.B. `Angebot_Muster.docx` (ohne Pfad) |

---

### `datei_senden`

Sendet eine Datei als Telegram-Dokument an den Nutzer. Entweder `id` (Datenbank-Datei-ID oder Dateiname hochgeladener Dateien) oder `pfad` (relativer Workspace-Pfad für generierte Exports). Mindestens eines der beiden Parameter muss angegeben werden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `id` | string | – | DB-ID oder Dateiname einer hochgeladenen Datei |
| `pfad` | string | – | Relativer Pfad im Workspace (z.B. `Exports/Bericht.pdf`) |

---

## Projekte (5 Tools)

### `projekte_auflisten`

Listet alle Projekte im Workspace auf. Zeigt nur die Namen — für Details zu einem Projekt `projekt_info` verwenden.

Keine Parameter.

---

### `projekt_info`

Zeigt die Stammdaten eines Projekts (Projektnummer, Bauherr, Standort, Projektart, Nutzung, Phase, Start/Ende) sowie Counts (Notizen, offene Aufgaben, Termine, Dateien).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ✓ | Name des Projekts (exakt aus `projekte_auflisten`) |

---

### `projekt_anlegen`

Legt ein neues Projekt in der Datenbank an. Projekte sind rein logische DB-Entities — es werden keine Ordner/Dateien angelegt. Idempotent: existiert der Name schon, werden die Stammdaten gepatcht.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ✓ | Projektname (Konvention: Bauherr + Ort, z.B. `EFH Müller Krems`) |
| `projektnummer` | string | – | Interne fortlaufende Projektnummer, z.B. `2026-037` |
| `bauherr` | string | – | Bauherr-Name plus Kontakt |
| `standort` | string | – | Standort — mindestens Ort/Gemeinde |
| `projektart` | string (enum) | – | Art der baulichen Maßnahme: `Neubau`, `Umbau`, `Sanierung`, `Zubau` |
| `nutzung` | string | – | Geplante Nutzung, z.B. `Wohnbau`, `Büro`, `Gewerbe` |
| `phase` | string | – | Projekt-Phase, z.B. `Vorentwurf`, `Einreichung`, `Ausführung`, `Abgeschlossen` |
| `start_date` | string | – | Start-Datum im Format `YYYY-MM-DD` |
| `end_date` | string | – | Geplantes End-Datum im Format `YYYY-MM-DD` |
| `beschreibung` | string | – | Freie Kurzbeschreibung (Besonderheiten, Kontext) |

---

### `projekt_aktualisieren`

Aktualisiert Stammdaten eines bestehenden Projekts. Nur die im Aufruf gesetzten Felder werden geändert; weggelassene Felder bleiben unverändert. Um ein Feld gezielt zu leeren, leeren String übergeben.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ✓ | Exakter Projektname (unveränderlich) |
| `projektnummer` | string | – | Projektnummer aktualisieren |
| `bauherr` | string | – | Bauherr aktualisieren |
| `standort` | string | – | Standort aktualisieren |
| `projektart` | string (enum) | – | `Neubau`, `Umbau`, `Sanierung`, `Zubau` |
| `nutzung` | string | – | Nutzung aktualisieren |
| `phase` | string | – | Phase aktualisieren |
| `start_date` | string | – | Start-Datum im Format `YYYY-MM-DD` |
| `end_date` | string | – | End-Datum im Format `YYYY-MM-DD` |
| `beschreibung` | string | – | Freie Beschreibung |
| `status` | string (enum) | – | Projekt-Status: `aktiv`, `pausiert`, `archiviert` |

---

### `projekt_loeschen`

Löscht ein Projekt aus der Datenbank. Notizen des Projekts werden per FK-CASCADE mitgelöscht. Aufgaben, Termine, Dateien und Team-Mitglieder bleiben erhalten, verlieren aber den Projektbezug. Unwiderruflich.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ✓ | Exakter Projektname |

---

## Team (10 Tools)

### `team_auflisten`

Listet alle Team-Mitglieder auf. Pro Mitglied: Name, Rolle, Firma, Kategorie (Intern/Planer/Ausführende/Behörde/Lieferant/Bauherr), E-Mail, Telefon und wie vielen Projekten sie zugeordnet sind.

Keine Parameter.

---

### `team_anlegen`

Legt ein neues Team-Mitglied an. Vor dem INSERT wird nach Duplikaten gesucht (gleiche E-Mail ODER gleicher Name + gleiche Firma) — bei Treffer kommt ein Warnhinweis zurück. Falls Firma nicht existiert, wird sie automatisch angelegt.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ✓ | Vor- und Nachname |
| `rolle` | string | – | Beruf/Rolle, z.B. Statiker, Polier, Architekt |
| `email` | string | – | E-Mail-Adresse |
| `telefon` | string | – | Telefonnummer |
| `firma` | string | – | Firmenname — wird auto-angelegt wenn neu |
| `kategorie` | string (enum) | – | `Intern`, `Planer`, `Ausführende`, `Behörde`, `Lieferant`, `Bauherr` |

---

### `team_aktualisieren`

Aktualisiert Stammdaten eines bestehenden Team-Mitglieds. Referenzierung per Name oder ID. Nur explizit gesetzte Felder werden geändert.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `ref` | string | ✓ | Name oder UUID des Mitglieds |
| `rolle` | string | – | Rolle aktualisieren |
| `email` | string | – | E-Mail aktualisieren |
| `telefon` | string | – | Telefon aktualisieren |
| `firma` | string | – | Firma aktualisieren |
| `kategorie` | string (enum) | – | `Intern`, `Planer`, `Ausführende`, `Behörde`, `Lieferant`, `Bauherr` |

---

### `team_zuordnen`

Ordnet ein Team-Mitglied einem Projekt zu (M:N). Optional kann eine projekt-spezifische Rolle gesetzt werden. Idempotent — bestehende Zuordnungen werden nicht dupliziert.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `mitglied` | string | ✓ | Name oder UUID des Mitglieds |
| `projekt` | string | ✓ | Projekt-Name |
| `projekt_rolle` | string | – | Rolle nur für dieses Projekt |

---

### `team_entfernen_aus_projekt`

Hebt die Zuordnung eines Mitglieds zu einem Projekt auf — das Mitglied bleibt im Team-Verzeichnis erhalten.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `mitglied` | string | ✓ | Name oder UUID des Mitglieds |
| `projekt` | string | ✓ | Projektname |

---

### `team_projektrolle_setzen`

Setzt oder ändert die projekt-spezifische Rolle eines bereits zugeordneten Mitglieds.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `mitglied` | string | ✓ | Name oder UUID des Mitglieds |
| `projekt` | string | ✓ | Projektname |
| `rolle` | string | ✓ | Neue Rolle (leerer String = Rolle löschen) |

---

### `team_log_eintrag`

Fügt einen Eintrag ins Kontakt-Log eines Mitglieds ein — für Gesprächsnotizen, Telefonate, Vereinbarungen. Zeitstempel wird automatisch gesetzt.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `mitglied` | string | ✓ | Name oder UUID des Mitglieds |
| `text` | string | ✓ | Inhalt des Eintrags |
| `autor` | string | – | Optional: wer den Eintrag verfasst hat |

---

### `team_entfernen`

Löscht ein Team-Mitglied komplett (inkl. aller Projekt-Zuordnungen). Irreversibel.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ✓ | Name oder UUID des Mitglieds |

---

### `firma_auflisten`

Listet alle Firmen mit Anzahl der zugeordneten Mitglieder auf. Nur im DB-Modus verfügbar.

Keine Parameter.

---

### `firma_anlegen`

Legt eine neue Firma an. Wird auch automatisch bei `team_anlegen`/`team_aktualisieren` aufgerufen wenn der Firmenname neu ist. Dieses Tool ist nur nötig um zusätzlich Adresse/Website zu hinterlegen.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ✓ | Firmenname |
| `adresse` | string | – | Firmenadresse |
| `website` | string | – | Website-URL |
| `notizen` | string | – | Optionale Notizen zur Firma |

---

## Bautagebuch (3 Tools)

Nur im DB-Modus verfügbar. Für die Dokumentation von Baustellen-Tagesberichten — typischerweise vom Büro aus, retrospektiv (abends oder am nächsten Vormittag).

### `bautagebuch_eintrag`

Dokumentiert einen Bautagebuch-Eintrag für einen Tag und ein Projekt (UPSERT). Pro Projekt + Datum gibt es genau einen Eintrag — ein vorhandener Eintrag wird aktualisiert.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | string | ✓ | Projektname |
| `datum` | string | – | Datum im Format TT.MM.JJJJ (Standard: heute) |
| `wetter` | string (enum) | – | `sonnig`, `bewoelkt`, `regen`, `schnee`, `sturm`, `nebel`, `frost`, `hagel` |
| `temperatur_min` | number | – | Tiefste Temperatur des Tages in °C |
| `temperatur_max` | number | – | Höchste Temperatur in °C |
| `personal` | string | – | Anwesende Personen/Trupps als Freitext |
| `maschinen` | string | – | Eingesetzte Maschinen/Geräte als Freitext |
| `taetigkeiten` | string | – | Was wurde gemacht (Markdown erlaubt) |
| `vorkommnisse` | string | – | Besondere Vorkommnisse, Behinderungen, Störungen, Unfälle |

---

### `bautagebuch_woche`

Listet die letzten Bautagebuch-Einträge eines Projekts auf (Standard: 7 Tage). Gibt einen kompakten Überblick mit Datum, Wetter, Tätigkeiten und Vorkommnissen.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | string | ✓ | Projektname |
| `tage` | number | – | Anzahl Einträge (Standard: 7) |

---

### `bautagebuch_lesen`

Liest einen einzelnen Bautagebuch-Eintrag für ein bestimmtes Datum und Projekt mit allen Feldern im Detail.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | string | ✓ | Projektname |
| `datum` | string | ✓ | Datum im Format TT.MM.JJJJ |

---

## Meetings (3 Tools)

Nur im DB-Modus verfügbar. Für Baubesprechungen, Bauherrenmeetings, Subunternehmer-Abstimmungen, Behördentermine und Abnahmen.

### `meeting_anlegen`

Legt ein neues Meeting / eine Besprechung für ein Projekt an. Kann mit Agenda vorab oder mit Protokoll im Nachhinein angelegt werden. Erkannte Team-Mitglieder als Teilnehmer werden benachrichtigt.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | string | ✓ | Projektname |
| `titel` | string | ✓ | Kurzer Titel der Sitzung |
| `datum` | string | ✓ | Datum im Format TT.MM.JJJJ |
| `startzeit` | string | – | Startzeit HH:MM |
| `endzeit` | string | – | Endzeit HH:MM |
| `typ` | string (enum) | – | `Bauherrenmeeting`, `Baubesprechung`, `Subunternehmer`, `Planung`, `Behoerde`, `Abnahme`, `Sonstiges` |
| `ort` | string | – | Ort der Sitzung |
| `teilnehmer` | string | – | Teilnehmer (komma-getrennt); erkannte Team-Mitglieder werden verlinkt und benachrichtigt |
| `agenda` | string | – | Tagesordnung (Markdown erlaubt) |
| `protokoll` | string | – | Protokoll der Sitzung (Markdown erlaubt) |
| `beschluesse` | string | – | Getroffene Beschlüsse |
| `folgetermin` | string | – | Folgetermin im Format TT.MM.JJJJ |

---

### `meetings_auflisten`

Listet die letzten Meetings eines Projekts auf, neueste zuerst. Zeigt Datum, Titel, Typ und Anzahl Teilnehmer.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | string | ✓ | Projektname |
| `anzahl` | number | – | Anzahl Meetings (Standard: 10) |

---

### `meeting_lesen`

Gibt die vollständigen Details eines Meetings aus: Agenda, Protokoll, Beschlüsse, To-Dos und Folgetermin.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | string | ✓ | Projektname |
| `datum` | string | ✓ | Datum im Format TT.MM.JJJJ |
| `titel` | string | – | Titel oder Teiltitel des Meetings (bei Mehrdeutigkeit zeigt das Tool eine Auswahl) |

---

## Stundenerfassung (3 Tools)

Nur im DB-Modus verfügbar. Für die retrospektive Dokumentation von Arbeitsstunden pro Mitarbeiter, Tag und Projekt — typischerweise abends vom Bauleiter.

### `stunden_eintragen`

Erfasst Arbeitsstunden pro Mitarbeiter, Tag und Projekt. Mitarbeiter wird per Name-Match auf das Team aufgelöst — externe Personen ohne Stammdatensatz werden als Freitext-Name übernommen.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | string | ✓ | Projektname |
| `mitarbeiter` | string | ✓ | Name des Mitarbeiters (Team-Mitglied oder Freitext) |
| `stunden` | number | ✓ | Gearbeitete Stunden (Dezimal, z.B. 8.5) |
| `datum` | string | – | Datum TT.MM.JJJJ (Standard: heute) |
| `beginn` | string | – | Startzeit HH:MM |
| `ende` | string | – | Endzeit HH:MM |
| `pause_minuten` | number | – | Pause in Minuten (Standard: 0) |
| `taetigkeit` | string | – | Tätigkeit, z.B. `Schalung EG`, `Maurerarbeiten` |
| `notiz` | string | – | Optionale Anmerkung |

---

### `stunden_woche`

Listet die Stunden-Einträge eines Projekts der letzten N Tage (Standard: 7). Zeigt Datum, Mitarbeiter, Stunden und Tätigkeit.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | string | ✓ | Projektname |
| `tage` | number | – | Anzahl Tage zurück (Standard: 7) |

---

### `stunden_summe`

Aggregiert Stunden pro Mitarbeiter für ein Projekt in einem Zeitraum (Standard: laufender Monat).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | string | ✓ | Projektname |
| `von` | string | – | Start TT.MM.JJJJ (Standard: 1. des Monats) |
| `bis` | string | – | Ende TT.MM.JJJJ (Standard: heute) |

---

## Agenten (9 Tools)

### `memory_speichern`

Speichert eine wichtige Information dauerhaft in der `MEMORY.md` des Agenten. Verwenden wenn der Nutzer explizit "merk dir" sagt, oder wenn eine Information für zukünftige Gespräche wichtig ist.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `eintrag` | string | ✓ | Die zu speichernde Information — prägnant formuliert (1-2 Sätze) |

---

### `agent_verlauf`

Liest den heutigen Gesprächsverlauf eines Agenten (User-Nachrichten und Agent-Antworten). Zeigt die letzten 20 Einträge.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | string | ✓ | Name des Agenten (z.B. `Protokoll`) |

---

### `agent_aktiv`

Listet alle Agenten auf die heute aktiv waren (mindestens einen Tageslog-Eintrag haben). Zeigt nur die Namen.

Keine Parameter.

---

### `agent_spawnen_async`

Startet einen Sub-Agenten non-blocking im Hintergrund. Sofortige Bestätigung — das Ergebnis kommt als separate Telegram-Nachricht. Ideal für längere Aufgaben (Recherche, Analyse). Sub-Agenten können nicht weiter spawnen (max. Tiefe: 2).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | string | ✓ | Name des Sub-Agenten |
| `aufgabe` | string | ✓ | Aufgabenbeschreibung für den Sub-Agenten |

---

### `agent_spawnen`

Startet einen Sub-Agenten und wartet auf das Ergebnis (blocking). Das Ergebnis wird direkt zurückgegeben. Für kurze Aufgaben die in wenigen Sekunden fertig sind.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | string | ✓ | Name des Sub-Agenten (z.B. `Protokoll`, `Recherche`) |
| `aufgabe` | string | ✓ | Detaillierte Aufgabenbeschreibung für den Sub-Agenten |

---

### `agent_erstellen`

Erstellt einen neuen Sub-Agenten mit eigenem Workspace (SOUL.md, BOOT.md, TOOLS.md etc.). Die Beschreibung wird zu SOUL.md. Geschützte Agenten (z.B. Main) können nicht überschrieben werden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ✓ | Name des neuen Agenten |
| `beschreibung` | string | ✓ | Was dieser Agent tun soll (wird zu SOUL.md) |

---

### `agenten_auflisten`

Listet alle verfügbaren Agenten auf (Ordner unter `Agents/`). Zeigt sowohl geschützte Agenten (Main) als auch selbst erstellte Sub-Agenten.

Keine Parameter.

---

### `agent_datei_lesen`

Liest eine Konfigurationsdatei eines Agenten (SOUL.md, BOOT.md, HEARTBEAT.md, TOOLS.md, MEMORY.md etc.).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | string | ✓ | Name des Agenten (z.B. `Main`, `CEO`) |
| `datei` | string | ✓ | Dateiname (z.B. `SOUL.md`, `HEARTBEAT.md`) |

---

### `agent_datei_schreiben`

Überschreibt eine Konfigurationsdatei eines Agenten vollständig. Erlaubte Dateien: `SOUL.md`, `BOOT.md`, `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `USER.md`, `IDENTITY.md`, `MEMORY.md`. Bei `HEARTBEAT.md` wird der Cron-Job sofort aktualisiert — kein Neustart nötig.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | string | ✓ | Name des Agenten |
| `datei` | string | ✓ | Dateiname (muss in der Whitelist sein) |
| `inhalt` | string | ✓ | Neuer vollständiger Inhalt der Datei |

---

## System (2 Tools)

### `befehl_ausfuehren`

Führt einen Shell-Befehl auf dem Server aus. Für: Systeminfo (`df -h`, `uptime`, `free -h`), Dateien (`ls`, `cat`, `wc`), Services (`systemctl status`), Netzwerk (`curl`, `ping`), Logs (`journalctl -u patio -n 50`). Befehle können mit `|` verkettet werden. Destruktive Befehle (`rm -rf`, `shutdown`, `reboot`) sind blockiert.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `befehl` | string | ✓ | Shell-Befehl (z.B. `df -h`, `ps aux \| grep node`) |
| `verzeichnis` | string | – | Optionales Arbeitsverzeichnis (Standard: `/opt/patio`) |
| `timeout` | number | – | Timeout in Sekunden (Standard: 15, max: 60) |

---

### `code_ausfuehren`

Führt JavaScript-Code direkt auf dem Server aus. Für: Berechnungen (Flächen, Kosten, Prozent), Daten transformieren (JSON parsen, CSV verarbeiten, Datumsberechnungen), Text verarbeiten. Der Code läuft in einer Node.js VM-Sandbox. Letzter Ausdruck wird als Ergebnis zurückgegeben.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `code` | string | ✓ | JavaScript-Code |

---

## Web (4 Tools)

### `http_anfrage`

Sendet eine HTTP-Anfrage an eine beliebige URL. Für: REST APIs aufrufen, Webhooks triggern, Daten von externen Diensten abrufen. Interne/private Adressen (localhost, 192.168.x.x etc.) sind blockiert (SSRF-Schutz).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `url` | string | ✓ | Die Ziel-URL |
| `methode` | string | – | HTTP-Methode: GET, POST, PUT, PATCH, DELETE (Standard: GET) |
| `body` | string | – | Request-Body als JSON-String (für POST/PUT/PATCH) |
| `headers` | string | – | Zusätzliche Headers als JSON-String |

---

### `web_suchen`

Sucht im Internet via DuckDuckGo nach Informationen. Gibt Titel, URL und Kurzbeschreibung zurück. Für Recherche, aktuelle Preise, Normen, Vorschriften. Für den vollständigen Inhalt einer gefundenen URL dann `webseite_lesen` verwenden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `suchbegriff` | string | ✓ | Der Suchbegriff |
| `anzahl` | number | – | Anzahl Ergebnisse (Standard: 5, max 10) |

---

### `nachrichten_suchen`

Sucht aktuelle Nachrichten und Meldungen im Internet (Google News, Region Österreich). Gibt Titel, URL, Quelle und Datum zurück. Ideal für: aktuelle Bauvorschriften, Förderungen, Marktpreise, Branchen-News.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `suchbegriff` | string | ✓ | Der Suchbegriff |
| `anzahl` | number | – | Anzahl Ergebnisse (Standard: 5, max 10) |

---

### `webseite_lesen`

Liest den Hauptinhalt einer Webseite und gibt ihn als strukturiertes Markdown zurück (Navigation, Footer, Werbung werden entfernt). Max 10.000 Zeichen. Ideal in Kombination mit `web_suchen` oder `nachrichten_suchen`.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `url` | string | ✓ | Die URL der Webseite |

---

## Dynamische Tools (3 Tools)

Dynamische Tools werden als Skripte im `tools/`-Verzeichnis abgelegt und sind sofort nach Erstellung verfügbar — kein Neustart nötig. Jedes Tool besteht aus `tool.json` (OpenAI-Schema) + `run.js` oder `run.sh`.

### `tool_erstellen`

Erstellt ein neues wiederverwendbares Tool als Skript. Sofort verfügbar nach Erstellung. JavaScript-Code erhält `args.paramName` und gibt das Ergebnis via `return 'ergebnis'` zurück. Für Templates: `files()` zum Lesen von Zusatzdateien im Tool-Ordner.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `ordner` | string | ✓ | Ordnername (z.B. `kalkulation`, `bauprotokoll`) |
| `name` | string | ✓ | Tool-Name für LLM (z.B. `kalkulation_berechnen`) |
| `beschreibung` | string | ✓ | Was das Tool tut — wird dem LLM gezeigt |
| `code` | string | ✓ | JavaScript- oder Shell-Code des Tools |
| `parameter` | string | – | Parameter als JSON: `{"flaeche": {"type": "number", "description": "m²"}}` |
| `pflichtfelder` | string | – | Komma-separierte Pflichtfelder (z.B. `flaeche,typ`) |
| `typ` | string | – | Script-Typ: `js` (Standard) oder `sh` (Shell) |
| `zusatzdateien` | string | – | Optionale Zusatzdateien als JSON: `{"vorlage.md": "# Template\n..."}` |

---

### `tools_auflisten`

Listet alle selbst erstellten dynamischen Tools auf (aus dem `tools/`-Verzeichnis). Zeigt Name, Beschreibung und Parameter jedes Tools.

Keine Parameter.

---

### `tool_loeschen`

Löscht ein dynamisches Tool dauerhaft (gesamter Ordner). Nicht rückgängig machbar. Vorher `tools_auflisten` nutzen um den Ordnernamen zu finden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `ordner` | string | ✓ | Ordnername des Tools (z.B. `kalkulation`) |

---

## MCP (3 Tools)

MCP (Model Context Protocol) ermöglicht die Anbindung externer Dienste als Child-Prozesse. Konfiguration in `mcp.json` im Projekt-Root.

### `mcp_server_auflisten`

Listet alle konfigurierten MCP-Server auf mit Status (verbunden/getrennt) und verfügbaren Tools.

Keine Parameter.

---

### `mcp_server_verbinden`

Verbindet einen MCP-Server aus der `mcp.json`-Konfiguration. Der Server wird als Kindprozess gestartet und seine Tools werden sofort verfügbar.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ✓ | Name des MCP-Servers (z.B. `github`, `filesystem`) |

---

### `mcp_server_trennen`

Trennt die Verbindung zu einem laufenden MCP-Server und entfernt seine Tools. Der Server kann später über `mcp_server_verbinden` wieder gestartet werden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ✓ | Name des MCP-Servers |

---

## Chat (1 Tool)

### `chat_suchen`

Durchsucht ältere Chat-Nachrichten (über alle Sessions, Telegram + Web) nach einem Stichwort. Unverzichtbar wenn der Nutzer sich auf Vergangenes bezieht. Liefert Treffer mit Datum, Rolle (user/assistant) und Inhalt — neueste zuerst.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `query` | string | ✓ | Suchbegriff oder Stichwort, z.B. `CCV`, `Termin Völkendorf` |
| `limit` | number | – | Maximale Anzahl Treffer (Standard: 10, Max: 30) |

---

## Zusammenfassung

| Kategorie | Anzahl | Tools |
|---|---|---|
| Notizen | 5 | `notiz_speichern`, `notizen_auflisten`, `notiz_lesen`, `notiz_loeschen`, `notiz_bearbeiten` |
| Aufgaben | 3 | `aufgabe_speichern`, `aufgaben_auflisten`, `aufgabe_erledigen` |
| Termine | 3 | `termin_speichern`, `termine_auflisten`, `termin_loeschen` |
| Dateien | 11 | `datei_lesen`, `datei_erstellen`, `ordner_auflisten`, `vault_suchen`, `semantisch_suchen`, `datei_bearbeiten`, `dateien_suchen`, `regex_suchen`, `pdf_erstellen`, `docx_erstellen`, `datei_senden` |
| Projekte | 5 | `projekte_auflisten`, `projekt_info`, `projekt_anlegen`, `projekt_aktualisieren`, `projekt_loeschen` |
| Team | 10 | `team_auflisten`, `team_anlegen`, `team_aktualisieren`, `team_zuordnen`, `team_entfernen_aus_projekt`, `team_projektrolle_setzen`, `team_log_eintrag`, `team_entfernen`, `firma_auflisten`, `firma_anlegen` |
| Bautagebuch | 3 | `bautagebuch_eintrag`, `bautagebuch_woche`, `bautagebuch_lesen` |
| Meetings | 3 | `meeting_anlegen`, `meetings_auflisten`, `meeting_lesen` |
| Stundenerfassung | 3 | `stunden_eintragen`, `stunden_woche`, `stunden_summe` |
| Agenten | 9 | `memory_speichern`, `agent_verlauf`, `agent_aktiv`, `agent_spawnen_async`, `agent_spawnen`, `agent_erstellen`, `agenten_auflisten`, `agent_datei_lesen`, `agent_datei_schreiben` |
| System | 2 | `befehl_ausfuehren`, `code_ausfuehren` |
| Web | 4 | `http_anfrage`, `web_suchen`, `nachrichten_suchen`, `webseite_lesen` |
| Dynamische Tools | 3 | `tool_erstellen`, `tools_auflisten`, `tool_loeschen` |
| MCP | 3 | `mcp_server_auflisten`, `mcp_server_verbinden`, `mcp_server_trennen` |
| Chat | 1 | `chat_suchen` |
| **Gesamt** | **68** | + `antworten` (Spezialtool) |
