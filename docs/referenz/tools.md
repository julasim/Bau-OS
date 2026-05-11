# Tool-Referenz

Vollständige Referenz aller eingebauten Tools die dem LLM-Agenten zur Verfügung stehen. Die Tools werden in jeder Runde automatisch bereitgestellt und können vom Agenten direkt aufgerufen werden.

**56 Tools in 12 Kategorien** plus das spezielle `antworten`-Tool.

---

## Spezialtool: `antworten`

Das einzige Tool das Text an den Nutzer ausgibt. Der Agent kann **nicht** direkt Text erzeugen — er muss immer `antworten` aufrufen. Das `runtime.ts` behandelt diesen Aufruf als Schleifenende.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | string | ja | Die Antwort an den Benutzer (Markdown erlaubt) |

---

## Notizen (5 Tools)

### `notiz_speichern`

Speichert eine freie Notiz im Workspace (Inbox oder Projektordner). Für Gedanken, Beobachtungen, Ideen und Informationen die keine konkrete Aufgabe oder Termin sind. Ohne Projekt landet die Notiz in der Inbox.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | string | ja | Inhalt der Notiz |
| `projekt` | string | nein | Optionaler Projektname |

**Beispiel:**
```
notiz_speichern({ text: "Beton-Lieferant Muster GmbH bietet 5% Rabatt bei Abnahme ab 50t", projekt: "EFH Müller Krems" })
```

---

### `notizen_auflisten`

Listet die letzten Notizen aus der Inbox auf, sortiert nach Datum. Für einen Überblick über aktuelle Notizen oder um eine bestimmte Notiz zu finden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `anzahl` | number | nein | Wie viele Notizen anzeigen (Standard: 5) |

**Beispiel:**
```
notizen_auflisten({ anzahl: 10 })
```

---

### `notiz_lesen`

Liest den vollständigen Inhalt einer Notiz-Datei. Vorher `notizen_auflisten` nutzen um den genauen Dateinamen zu finden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `dateiname` | string | ja | Name der Notiz-Datei |

**Beispiel:**
```
notiz_lesen({ dateiname: "2026-05-11_beton-rabatt.md" })
```

---

### `notiz_loeschen`

Löscht eine Notiz dauerhaft aus dem Workspace. Nicht rückgängig machbar.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `dateiname` | string | ja | Name der Notiz-Datei |

**Beispiel:**
```
notiz_loeschen({ dateiname: "2026-05-11_beton-rabatt.md" })
```

---

### `notiz_bearbeiten`

Fügt einer bestehenden Notiz am Ende einen Nachtrag hinzu (Append). Der Nachtrag wird mit Zeitstempel angehängt. Nicht für Ersetzen — dafür `datei_bearbeiten` verwenden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `dateiname` | string | ja | Name der Notiz-Datei |
| `text` | string | ja | Inhalt des Nachtrags |

**Beispiel:**
```
notiz_bearbeiten({ dateiname: "2026-05-11_beton-rabatt.md", text: "Angebot per E-Mail angefordert." })
```

---

## Aufgaben (3 Tools)

### `aufgabe_speichern`

Speichert eine neue Aufgabe (Todo) im Workspace. Aufgaben immer mit konkretem Verb beginnen. Vorher `vault_suchen` nutzen um Duplikate zu vermeiden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | string | ja | Beschreibung der Aufgabe |
| `projekt` | string | nein | Optionaler Projektname |

**Beispiel:**
```
aufgabe_speichern({ text: "Angebot für Fenster einholen", projekt: "EFH Müller Krems" })
```

---

### `aufgaben_auflisten`

Listet alle offenen (nicht erledigten) Aufgaben auf. Optional auf ein Projekt filterbar. Zeigt Aufgabentext, Verantwortlichen und Fälligkeitsdatum an.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | string | nein | Optional: nur Aufgaben eines Projekts |

**Beispiel:**
```
aufgaben_auflisten({ projekt: "EFH Müller Krems" })
```

---

### `aufgabe_erledigen`

Markiert eine Aufgabe als erledigt (done). Der Text muss exakt übereinstimmen — vorher `aufgaben_auflisten` nutzen.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | string | ja | Exakter Text der Aufgabe |
| `projekt` | string | nein | Optionaler Projektname |

**Beispiel:**
```
aufgabe_erledigen({ text: "Angebot für Fenster einholen", projekt: "EFH Müller Krems" })
```

---

## Termine (3 Tools)

### `termin_speichern`

Speichert einen neuen Termin, Meeting oder Deadline. Datum immer im Format TT.MM.JJJJ angeben. Relative Angaben wie "morgen" müssen vorher in ein konkretes Datum umgerechnet werden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `datum` | string | ja | Datum im Format TT.MM.JJJJ |
| `text` | string | ja | Beschreibung des Termins |
| `uhrzeit` | string | nein | Uhrzeit im Format HH:MM |
| `projekt` | string | nein | Optionaler Projektname |

**Beispiel:**
```
termin_speichern({ datum: "15.05.2026", text: "Baubesprechung mit Polier", uhrzeit: "10:00", projekt: "EFH Müller Krems" })
```

---

### `termine_auflisten`

Listet alle gespeicherten Termine auf, sortiert nach Datum. Zeigt Datum, Uhrzeit, Beschreibung und Ort an. Optional auf ein Projekt filterbar.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | string | nein | Optional: nur Termine eines Projekts |

**Beispiel:**
```
termine_auflisten({ projekt: "EFH Müller Krems" })
```

---

### `termin_loeschen`

Löscht einen Termin dauerhaft. Der Text muss exakt oder als Teiltext übereinstimmen.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | string | ja | Text oder Teiltext des Termins |
| `projekt` | string | nein | Optionaler Projektname |

**Beispiel:**
```
termin_loeschen({ text: "Baubesprechung mit Polier" })
```

---

## Dateien (11 Tools)

### `datei_lesen`

Liest den Inhalt einer Datei im Workspace. Unterstützt Textdateien (.md, .txt, .json etc.) und Dokumente (.pdf, .docx). PDF- und Word-Dateien werden automatisch extrahiert. Pfad relativ zum Workspace-Root.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `pfad` | string | ja | Relativer Pfad im Workspace, z.B. `Projekte/Alpha/README.md` |

**Beispiel:**
```
datei_lesen({ pfad: "Projekte/EFH Müller Krems/Baubeschreibung.pdf" })
```

---

### `datei_erstellen`

Erstellt eine neue Datei im Workspace oder überschreibt eine bestehende. Fehlende Ordner werden automatisch erstellt.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `pfad` | string | ja | Relativer Pfad im Workspace |
| `inhalt` | string | ja | Dateiinhalt |

**Beispiel:**
```
datei_erstellen({ pfad: "Projekte/EFH Müller Krems/Protokoll-2026-05-15.md", inhalt: "# Protokoll\n\nAnwesend: ..." })
```

---

### `ordner_auflisten`

Listet den Inhalt eines Ordners im Workspace auf (Dateien und Unterordner). Zeigt nur eine Ebene — nicht rekursiv. Für rekursive Suche `dateien_suchen` verwenden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `pfad` | string | nein | Relativer Pfad (leer = Workspace-Wurzel) |

**Beispiel:**
```
ordner_auflisten({ pfad: "Projekte/EFH Müller Krems" })
```

---

### `vault_suchen`

Keyword-Textsuche nur in System-Dateien im Workspace (IDENTITY, SOUL, BOOT, TOOLS, AGENTS, MEMORY, HEARTBEAT, USER). **Nicht** für User-Inhalte — Notizen und Dateien sind nur über `semantisch_suchen` erreichbar. Verwenden wenn du etwas über deine eigene Konfiguration wissen willst.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `suchbegriff` | string | ja | Der Suchbegriff |
| `projekt` | string | nein | Optional: Suche auf ein Projekt begrenzen |

**Beispiel:**
```
vault_suchen({ suchbegriff: "Bauprotokoll" })
```

---

### `semantisch_suchen`

**Haupt-Suchtool für User-Inhalte.** Findet Notizen, hochgeladene Dateien (PDF, DOCX, MD), Angebote, Protokolle, Baubeschreibungen etc. nach Bedeutung — nicht nur nach exaktem Text. Nutzt KI-Embeddings (pgvector). Bei nicht aktivierter Datenbank: Fallback auf Textsuche.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `frage` | string | ja | Die Suchanfrage in natürlicher Sprache |
| `typ` | string (enum) | nein | Suchbereich: `all` (Standard), `note` (nur Notizen), `file` (nur Dateien) |
| `limit` | number | nein | Max. Ergebnisse (Standard: 8) |
| `projekt` | string | nein | Optional: Suche auf ein Projekt beschränken |

**Beispiel:**
```
semantisch_suchen({ frage: "Betonpreise und Lieferanten", typ: "file", limit: 5, projekt: "EFH Müller Krems" })
```

---

### `datei_bearbeiten`

Sucht Text in einer Workspace-Datei und ersetzt ihn (Find-and-Replace). Unterstützt exakte Textsuche und Regex-Muster. Nicht für Notiz-Nachträge — dafür `notiz_bearbeiten` nutzen.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `pfad` | string | ja | Relativer Pfad im Workspace (z.B. `Projekte/Alpha/README.md`) |
| `suchen` | string | ja | Text der gesucht wird (exakt oder Regex) |
| `ersetzen` | string | ja | Ersetzungstext |
| `regex` | boolean | nein | `true` = suchen ist ein Regex-Muster (Standard: false) |
| `alle` | boolean | nein | `true` = alle Vorkommen ersetzen (Standard: false, nur erstes) |

**Beispiel:**
```
datei_bearbeiten({ pfad: "Projekte/EFH Müller Krems/Protokoll.md", suchen: "Anwesend: Max", ersetzen: "Anwesend: Max Müller", alle: false })
```

---

### `dateien_suchen`

Sucht Dateien nach Name oder Muster. Bei aktiver Datenbank werden alle hochgeladenen Dateien (PDF, DOCX, Bilder etc.) durchsucht. Unterstützt Glob-Platzhalter.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `muster` | string | ja | Glob-Muster (z.B. `**/*.pdf`, `Projekte/*/*.md`) |
| `ordner` | string | nein | Optional: Startordner (Standard: Workspace-Wurzel) |
| `limit` | number | nein | Max. Ergebnisse (Standard: 50) |

**Beispiel:**
```
dateien_suchen({ muster: "**/*.pdf", ordner: "Projekte/EFH Müller Krems", limit: 20 })
```

---

### `regex_suchen`

Regex-Suche in System-Dateien des Workspace (Agent-Files, Tools, Configs — nicht User-Content). Gibt Treffer mit Zeilennummern zurück. Für User-Inhalte immer `semantisch_suchen` verwenden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `muster` | string | ja | Regex-Suchmuster (z.B. `OENORM.*B\\s?1801`) |
| `ordner` | string | nein | Optional: Unterordner (Standard: gesamter Workspace) |
| `kontext` | number | nein | Zeilen Kontext vor/nach Treffer (Standard: 0) |
| `dateifilter` | string | nein | Optional: Datei-Glob (z.B. `*.md`, `*.json`) |
| `limit` | number | nein | Max. Treffer gesamt (Standard: 20) |

**Beispiel:**
```
regex_suchen({ muster: "TODO|FIXME", dateifilter: "*.md", limit: 10 })
```

---

### `pdf_erstellen`

Erstellt eine PDF-Datei mit Titel und Textinhalt. Speichert die PDF im Workspace unter `Exports/`. Danach `datei_senden` aufrufen um sie an den Nutzer zu schicken.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `titel` | string | ja | Titel der PDF (erscheint als Überschrift) |
| `inhalt` | string | ja | Textinhalt der PDF (Zeilenumbrüche erlaubt) |
| `dateiname` | string | ja | Dateiname, z.B. `Bericht_April.pdf` (ohne Pfad) |

**Beispiel:**
```
pdf_erstellen({ titel: "Baubericht April 2026", inhalt: "...", dateiname: "Baubericht_April_2026.pdf" })
```

---

### `docx_erstellen`

Erstellt eine Word-Datei (.docx) mit Titel und Textinhalt. Ideal wenn der Nutzer ein bearbeitbares Dokument braucht. Speichert die Datei im Workspace unter `Exports/`. Danach `datei_senden` aufrufen.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `titel` | string | ja | Titel des Dokuments (erscheint als Überschrift) |
| `inhalt` | string | ja | Textinhalt des Dokuments (Zeilenumbrüche erlaubt) |
| `dateiname` | string | ja | Dateiname, z.B. `Angebot_Muster.docx` (ohne Pfad) |

**Beispiel:**
```
docx_erstellen({ titel: "Angebot Fenster", inhalt: "...", dateiname: "Angebot_Fenster_2026-05.docx" })
```

---

### `datei_senden`

Sendet eine Datei als Telegram-Dokument an den Nutzer. Entweder `id` (Datenbank-Datei-ID oder Dateiname hochgeladener Dateien) oder `pfad` (relativer Workspace-Pfad für generierte Exports). Mindestens eines der beiden Parameter muss angegeben werden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `id` | string | nein | DB-ID oder Dateiname einer hochgeladenen Datei |
| `pfad` | string | nein | Relativer Pfad im Workspace (z.B. `Exports/Bericht.pdf`) |

**Beispiel:**
```
datei_senden({ pfad: "Exports/Baubericht_April_2026.pdf" })
```

---

## Projekte (5 Tools)

### `projekte_auflisten`

Listet alle Projekte im Workspace auf. Zeigt nur die Namen — für Details zu einem Projekt `projekt_info` verwenden.

Keine Parameter.

**Beispiel:**
```
projekte_auflisten({})
```

---

### `projekt_info`

Zeigt die Stammdaten eines Projekts (Projektnummer, Bauherr, Standort, Projektart, Nutzung, Phase, Start/Ende) sowie Counts (Notizen, offene Aufgaben, Termine, Dateien).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ja | Name des Projekts (exakt aus `projekte_auflisten`) |

**Beispiel:**
```
projekt_info({ name: "EFH Müller Krems" })
```

---

### `projekt_anlegen`

Legt ein neues Projekt in der Datenbank an. Projekte sind rein logische DB-Entities — es werden keine Ordner/Dateien angelegt. Idempotent: existiert der Name schon, werden die Stammdaten gepatcht. Bevor dieses Tool aufgerufen wird, sollten Projektnummer, Bauherr, Standort, Projektart und Nutzung bekannt sein — fehlende Felder beim Nutzer nachfragen oder später mit `projekt_aktualisieren` nachtragen.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ja | Projektname (Konvention: Bauherr + Ort, z.B. `EFH Müller Krems`) |
| `projektnummer` | string | nein | Interne fortlaufende Projektnummer, z.B. `2026-037` |
| `bauherr` | string | nein | Bauherr-Name plus Kontakt |
| `standort` | string | nein | Standort — mindestens Ort/Gemeinde |
| `projektart` | string (enum) | nein | Art der baulichen Maßnahme: `Neubau`, `Umbau`, `Sanierung`, `Zubau` |
| `nutzung` | string | nein | Geplante Nutzung, z.B. `Wohnbau`, `Büro`, `Gewerbe` |
| `phase` | string | nein | Projekt-Phase, z.B. `Vorentwurf`, `Einreichung`, `Ausführung`, `Abgeschlossen` |
| `start_date` | string | nein | Start-Datum im Format `YYYY-MM-DD` |
| `end_date` | string | nein | Geplantes End-Datum im Format `YYYY-MM-DD` |
| `beschreibung` | string | nein | Freie Kurzbeschreibung (Besonderheiten, Kontext) |

**Beispiel:**
```
projekt_anlegen({
  name: "EFH Müller Krems",
  projektnummer: "2026-037",
  bauherr: "Stefan und Karin Müller — stefan.mueller@example.at",
  standort: "Lindenstraße 14, 3500 Krems",
  projektart: "Neubau",
  nutzung: "Wohnbau",
  phase: "Vorentwurf",
  start_date: "2026-04-01"
})
```

---

### `projekt_aktualisieren`

Aktualisiert Stammdaten eines bestehenden Projekts. Nur die im Aufruf gesetzten Felder werden geändert; weggelassene Felder bleiben unverändert. Um ein Feld gezielt zu leeren, leeren String übergeben.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ja | Exakter Projektname (unveränderlich) |
| `projektnummer` | string | nein | Projektnummer aktualisieren |
| `bauherr` | string | nein | Bauherr aktualisieren |
| `standort` | string | nein | Standort aktualisieren |
| `projektart` | string (enum) | nein | `Neubau`, `Umbau`, `Sanierung`, `Zubau` |
| `nutzung` | string | nein | Nutzung aktualisieren |
| `phase` | string | nein | Phase aktualisieren |
| `start_date` | string | nein | Start-Datum im Format `YYYY-MM-DD` |
| `end_date` | string | nein | End-Datum im Format `YYYY-MM-DD` |
| `beschreibung` | string | nein | Freie Beschreibung |
| `status` | string (enum) | nein | Projekt-Status: `aktiv`, `pausiert`, `archiviert` |

**Beispiel:**
```
projekt_aktualisieren({ name: "EFH Müller Krems", phase: "Einreichung", status: "aktiv" })
```

---

### `projekt_loeschen`

Löscht ein Projekt aus der Datenbank. Notizen des Projekts werden per FK-CASCADE mitgelöscht. Aufgaben, Termine, Dateien und Team-Mitglieder bleiben erhalten, verlieren aber den Projektbezug. Unwiderruflich.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ja | Exakter Projektname |

**Beispiel:**
```
projekt_loeschen({ name: "EFH Müller Krems" })
```

---

## Team (3 Tools)

### `team_auflisten`

Listet alle Team-Mitglieder auf (Namen und ggf. Rolle / Firma).

Keine Parameter.

**Beispiel:**
```
team_auflisten({})
```

---

### `team_anlegen`

Legt ein neues Team-Mitglied an. Mindestens der Name ist erforderlich. Im Filesystem-Modus wird nur der Name gespeichert; im DB-Modus werden alle optionalen Felder gespeichert.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ja | Vor- und Nachname |
| `rolle` | string | nein | Z.B. Polier, Techniker, Buchhaltung |
| `email` | string | nein | E-Mail-Adresse |
| `telefon` | string | nein | Telefonnummer |
| `firma` | string | nein | Firma / Subunternehmer |

**Beispiel:**
```
team_anlegen({ name: "Georg Huber", rolle: "Polier", telefon: "+43 699 1234567", firma: "Huber Bau GmbH" })
```

---

### `team_entfernen`

Entfernt ein Team-Mitglied per Name oder ID.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ja | Name oder ID des Mitglieds |

**Beispiel:**
```
team_entfernen({ name: "Georg Huber" })
```

---

## Agenten (9 Tools)

### `memory_speichern`

Speichert eine wichtige Information dauerhaft in der `MEMORY.md` des Agenten. Verwenden wenn Julius explizit "merk dir" sagt, oder wenn eine Information für zukünftige Gespräche wichtig ist (Präferenzen, Projektdetails, Entscheidungen, Kontakte).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `eintrag` | string | ja | Die zu speichernde Information — prägnant formuliert (1-2 Sätze) |

**Beispiel:**
```
memory_speichern({ eintrag: "Julius bevorzugt Beton-Lieferanten aus der Region Krems. Kontakt: Muster GmbH, +43 2732 xxxxx." })
```

---

### `agent_verlauf`

Liest den heutigen Gesprächsverlauf eines Agenten (User-Nachrichten und Agent-Antworten). Zeigt die letzten 20 Einträge. Nützlich um zu sehen was ein Sub-Agent heute bereits bearbeitet hat.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | string | ja | Name des Agenten (z.B. `Protokoll`) |

**Beispiel:**
```
agent_verlauf({ agent: "Protokoll" })
```

---

### `agent_aktiv`

Listet alle Agenten auf die heute aktiv waren (mindestens einen Tageslog-Eintrag haben). Zeigt nur die Namen — für Details `agent_verlauf` verwenden.

Keine Parameter.

**Beispiel:**
```
agent_aktiv({})
```

---

### `agent_spawnen_async`

Startet einen Sub-Agenten non-blocking im Hintergrund. Sofortige Bestätigung — das Ergebnis kommt als separate Telegram-Nachricht. Ideal für längere Aufgaben (Recherche, Analyse). Sub-Agenten können nicht weiter spawnen (max. Tiefe: 2).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | string | ja | Name des Sub-Agenten |
| `aufgabe` | string | ja | Aufgabenbeschreibung für den Sub-Agenten |

**Beispiel:**
```
agent_spawnen_async({ agent: "Recherche", aufgabe: "Recherchiere aktuelle Betonpreise in Österreich 2026 und fasse zusammen." })
```

---

### `agent_spawnen`

Startet einen Sub-Agenten und wartet auf das Ergebnis (blocking). Das Ergebnis wird direkt zurückgegeben. Für kurze Aufgaben die in wenigen Sekunden fertig sind. Für längere Aufgaben `agent_spawnen_async` verwenden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | string | ja | Name des Sub-Agenten (z.B. `Protokoll`, `Recherche`) |
| `aufgabe` | string | ja | Detaillierte Aufgabenbeschreibung für den Sub-Agenten |

**Beispiel:**
```
agent_spawnen({ agent: "Protokoll", aufgabe: "Erstelle ein Baubesprechungsprotokoll aus diesen Stichpunkten: ..." })
```

---

### `agent_erstellen`

Erstellt einen neuen Sub-Agenten mit eigenem Workspace (SOUL.md, BOOT.md, TOOLS.md etc.). Die Beschreibung wird zu SOUL.md. Geschützte Agenten (z.B. Main) können nicht überschrieben werden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ja | Name des neuen Agenten |
| `beschreibung` | string | ja | Was dieser Agent tun soll (wird zu SOUL.md) |

**Beispiel:**
```
agent_erstellen({ name: "Kalkulation", beschreibung: "Spezialist für Kostenkalkulationen nach ÖNORM B 1801." })
```

---

### `agenten_auflisten`

Listet alle verfügbaren Agenten auf (Ordner unter `Agents/`). Zeigt sowohl geschützte Agenten (Main) als auch selbst erstellte Sub-Agenten.

Keine Parameter.

**Beispiel:**
```
agenten_auflisten({})
```

---

### `agent_datei_lesen`

Liest eine Konfigurationsdatei eines Agenten (SOUL.md, BOOT.md, HEARTBEAT.md, TOOLS.md, MEMORY.md etc.). Damit kann die Konfiguration und Persönlichkeit eines Agenten eingesehen werden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | string | ja | Name des Agenten (z.B. `Main`, `CEO`) |
| `datei` | string | ja | Dateiname (z.B. `SOUL.md`, `HEARTBEAT.md`) |

**Beispiel:**
```
agent_datei_lesen({ agent: "Main", datei: "MEMORY.md" })
```

---

### `agent_datei_schreiben`

Überschreibt eine Konfigurationsdatei eines Agenten vollständig. Erlaubte Dateien: `SOUL.md`, `BOOT.md`, `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `USER.md`, `IDENTITY.md`, `MEMORY.md`. Bei `HEARTBEAT.md` wird der Cron-Job sofort aktualisiert — kein Neustart nötig.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | string | ja | Name des Agenten |
| `datei` | string | ja | Dateiname (muss in der Whitelist sein) |
| `inhalt` | string | ja | Neuer vollständiger Inhalt der Datei |

**Beispiel:**
```
agent_datei_schreiben({ agent: "Kalkulation", datei: "SOUL.md", inhalt: "# Kalkulation\n\n## Rolle\n..." })
```

---

## System (2 Tools)

### `befehl_ausfuehren`

Führt einen Shell-Befehl auf dem Server aus. Für: Systeminfo (`df -h`, `uptime`, `free -h`), Dateien (`ls`, `cat`, `wc`), Services (`systemctl status`), Netzwerk (`curl`, `ping`), Logs (`journalctl -u bau-os -n 50`). Befehle können mit `|` verkettet werden. Destruktive Befehle (`rm -rf`, `shutdown`, `reboot`) sind blockiert.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `befehl` | string | ja | Shell-Befehl (z.B. `df -h`, `ps aux \| grep node`) |
| `verzeichnis` | string | nein | Optionales Arbeitsverzeichnis (Standard: `/opt/bau-os`) |
| `timeout` | number | nein | Timeout in Sekunden (Standard: 15, max: 60) |

**Beispiel:**
```
befehl_ausfuehren({ befehl: "df -h && free -h" })
```

---

### `code_ausfuehren`

Führt JavaScript-Code direkt auf dem Server aus. Für: Berechnungen (Flächen, Kosten, Prozent), Daten transformieren (JSON parsen, CSV verarbeiten, Datumsberechnungen), Text verarbeiten. Der Code läuft in Node.js — alle eingebauten Module verfügbar. Letzter Ausdruck wird als Ergebnis zurückgegeben.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `code` | string | ja | JavaScript-Code |

**Beispiel:**
```
code_ausfuehren({ code: "Math.round(125.5 * 0.2 * 100) / 100" })
```

---

## Web (4 Tools)

### `http_anfrage`

Sendet eine HTTP-Anfrage an eine beliebige URL. Für: REST APIs aufrufen, Webhooks triggern, Daten von externen Diensten abrufen. Interne/private Adressen (localhost, 192.168.x.x etc.) sind blockiert (SSRF-Schutz).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `url` | string | ja | Die Ziel-URL |
| `methode` | string | nein | HTTP-Methode: GET, POST, PUT, PATCH, DELETE (Standard: GET) |
| `body` | string | nein | Request-Body als JSON-String (für POST/PUT/PATCH) |
| `headers` | string | nein | Zusätzliche Headers als JSON-String |

**Beispiel:**
```
http_anfrage({ url: "https://api.example.com/preise", methode: "GET" })
```

---

### `web_suchen`

Sucht im Internet via DuckDuckGo nach Informationen. Gibt Titel, URL und Kurzbeschreibung zurück. Für Recherche, aktuelle Preise, Normen, Vorschriften etc. Für den vollständigen Inhalt einer gefundenen URL dann `webseite_lesen` verwenden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `suchbegriff` | string | ja | Der Suchbegriff |
| `anzahl` | number | nein | Anzahl Ergebnisse (Standard: 5, max 10) |

**Beispiel:**
```
web_suchen({ suchbegriff: "ÖNORM B 1801 Kalkulation 2026", anzahl: 5 })
```

---

### `nachrichten_suchen`

Sucht aktuelle Nachrichten und Meldungen im Internet (Google News, Region Österreich). Gibt Titel, URL, Quelle und Datum zurück. Ideal für: aktuelle Bauvorschriften, Förderungen, Marktpreise, Branchen-News.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `suchbegriff` | string | ja | Der Suchbegriff |
| `anzahl` | number | nein | Anzahl Ergebnisse (Standard: 5, max 10) |

**Beispiel:**
```
nachrichten_suchen({ suchbegriff: "Förderung Sanierung Steiermark 2026", anzahl: 5 })
```

---

### `webseite_lesen`

Liest den Hauptinhalt einer Webseite und gibt ihn als strukturiertes Markdown zurück (Navigation, Footer, Werbung werden entfernt). Max 10.000 Zeichen. Ideal in Kombination mit `web_suchen` oder `nachrichten_suchen`.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `url` | string | ja | Die URL der Webseite |

**Beispiel:**
```
webseite_lesen({ url: "https://example.com/baunorm-artikel" })
```

---

## Dynamische Tools (3 Tools)

Dynamische Tools werden als Skripte im `tools/`-Verzeichnis abgelegt und sind sofort nach Erstellung verfügbar — kein Neustart nötig. Jedes Tool besteht aus `tool.json` (OpenAI-Schema) + `run.js` oder `run.sh`.

### `tool_erstellen`

Erstellt ein neues wiederverwendbares Tool als Skript. Sofort verfügbar nach Erstellung. JavaScript-Code erhält `args.paramName` und gibt das Ergebnis via `return 'ergebnis'` zurück. Für Templates: `files()` zum Lesen von Zusatzdateien im Tool-Ordner.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `ordner` | string | ja | Ordnername (z.B. `kalkulation`, `bauprotokoll`) |
| `name` | string | ja | Tool-Name für LLM (z.B. `kalkulation_berechnen`) |
| `beschreibung` | string | ja | Was das Tool tut — wird dem LLM gezeigt |
| `code` | string | ja | JavaScript- oder Shell-Code des Tools |
| `parameter` | string | nein | Parameter als JSON: `{"flaeche": {"type": "number", "description": "m²"}}` |
| `pflichtfelder` | string | nein | Komma-separierte Pflichtfelder (z.B. `flaeche,typ`) |
| `typ` | string | nein | Script-Typ: `js` (Standard) oder `sh` (Shell) |
| `zusatzdateien` | string | nein | Optionale Zusatzdateien als JSON: `{"vorlage.md": "# Template\n..."}` |

**Beispiel:**
```
tool_erstellen({
  ordner: "kalkulation",
  name: "kalkulation_berechnen",
  beschreibung: "Berechnet Baukosten nach ÖNORM",
  parameter: '{"flaeche": {"type": "number", "description": "Fläche in m²"}, "typ": {"type": "string", "description": "Nutzungstyp"}}',
  pflichtfelder: "flaeche,typ",
  code: "const preis = args.typ === 'Wohnbau' ? 1800 : 2200; return `Kostenschätzung: ${args.flaeche * preis} €`;"
})
```

---

### `tools_auflisten`

Listet alle selbst erstellten dynamischen Tools auf (aus dem `tools/`-Verzeichnis). Zeigt Name, Beschreibung und Parameter jedes Tools.

Keine Parameter.

**Beispiel:**
```
tools_auflisten({})
```

---

### `tool_loeschen`

Löscht ein dynamisches Tool dauerhaft (gesamter Ordner). Nicht rückgängig machbar. Vorher `tools_auflisten` nutzen um den Ordnernamen zu finden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `ordner` | string | ja | Ordnername des Tools (z.B. `kalkulation`) |

**Beispiel:**
```
tool_loeschen({ ordner: "kalkulation" })
```

---

## MCP (3 Tools)

MCP (Model Context Protocol) ermöglicht die Anbindung externer Dienste als Child-Prozesse. Konfiguration in `mcp.json` im Projekt-Root.

### `mcp_server_auflisten`

Listet alle konfigurierten MCP-Server auf mit Status (verbunden/getrennt) und verfügbaren Tools.

Keine Parameter.

**Beispiel:**
```
mcp_server_auflisten({})
```

---

### `mcp_server_verbinden`

Verbindet einen MCP-Server aus der `mcp.json`-Konfiguration. Der Server wird als Kindprozess gestartet und seine Tools werden sofort verfügbar.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ja | Name des MCP-Servers (z.B. `github`, `filesystem`) |

**Beispiel:**
```
mcp_server_verbinden({ name: "github" })
```

---

### `mcp_server_trennen`

Trennt die Verbindung zu einem laufenden MCP-Server und entfernt seine Tools. Der Server kann später über `mcp_server_verbinden` wieder gestartet werden.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | string | ja | Name des MCP-Servers |

**Beispiel:**
```
mcp_server_trennen({ name: "github" })
```

---

## Chat (1 Tool)

### `chat_suchen`

Durchsucht ältere Chat-Nachrichten (über alle Sessions, Telegram + Web) nach einem Stichwort. Unverzichtbar wenn der Nutzer sich auf Vergangenes bezieht. Liefert Treffer mit Datum, Rolle (user/assistant) und Inhalt — neueste zuerst.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `query` | string | ja | Suchbegriff oder Stichwort, z.B. `CCV`, `Termin Völkendorf` |
| `limit` | number | nein | Maximale Anzahl Treffer (Standard: 10, Max: 30) |

**Beispiel:**
```
chat_suchen({ query: "Termin Völkendorf", limit: 15 })
```

---

## Zusammenfassung

| Kategorie | Anzahl | Tools |
|---|---|---|
| Notizen | 5 | `notiz_speichern`, `notizen_auflisten`, `notiz_lesen`, `notiz_loeschen`, `notiz_bearbeiten` |
| Aufgaben | 3 | `aufgabe_speichern`, `aufgaben_auflisten`, `aufgabe_erledigen` |
| Termine | 3 | `termin_speichern`, `termine_auflisten`, `termin_loeschen` |
| Dateien | 11 | `datei_lesen`, `datei_erstellen`, `ordner_auflisten`, `vault_suchen`, `semantisch_suchen`, `datei_bearbeiten`, `dateien_suchen`, `regex_suchen`, `pdf_erstellen`, `docx_erstellen`, `datei_senden` |
| Projekte | 5 | `projekte_auflisten`, `projekt_info`, `projekt_anlegen`, `projekt_aktualisieren`, `projekt_loeschen` |
| Team | 3 | `team_auflisten`, `team_anlegen`, `team_entfernen` |
| Agenten | 9 | `memory_speichern`, `agent_verlauf`, `agent_aktiv`, `agent_spawnen_async`, `agent_spawnen`, `agent_erstellen`, `agenten_auflisten`, `agent_datei_lesen`, `agent_datei_schreiben` |
| System | 2 | `befehl_ausfuehren`, `code_ausfuehren` |
| Web | 4 | `http_anfrage`, `web_suchen`, `nachrichten_suchen`, `webseite_lesen` |
| Dynamische Tools | 3 | `tool_erstellen`, `tools_auflisten`, `tool_loeschen` |
| MCP | 3 | `mcp_server_auflisten`, `mcp_server_verbinden`, `mcp_server_trennen` |
| Chat | 1 | `chat_suchen` |
| **Gesamt** | **56** | + `antworten` (Spezialtool) |
