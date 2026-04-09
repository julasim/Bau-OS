# LLM Tools Referenz

Bau-OS stellt dem LLM **35+ Tools** zur Verfügung, mit denen es eigenständig Daten im Vault verwalten kann. Alle Tools sind in `src/llm/tools.ts` definiert und in `src/llm/executor.ts` implementiert.

## Notizen

### `notiz_speichern`

Speichert eine neue Notiz als Markdown-Datei im Vault.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | `string` | Ja | Inhalt der Notiz |
| `projekt` | `string` | Nein | Optionaler Projektname (Unterordner) |

```
User: "Notier dir: Baustellenbegehung war erfolgreich"
→ Tool: notiz_speichern({ text: "Baustellenbegehung war erfolgreich" })
→ Notiz gespeichert: 2026-04-07_baustellenbegehung.md
```

---

### `notizen_auflisten`

Listet die letzten Notizen aus der Inbox auf.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `anzahl` | `number` | Nein | Wie viele Notizen anzeigen (Standard: 5) |

```
User: "Zeig mir meine letzten Notizen"
→ Tool: notizen_auflisten({ anzahl: 5 })
→ 2026-04-07_baustellenbegehung.md
  2026-04-06_materialliste.md
  ...
```

---

### `notiz_lesen`

Liest den Inhalt einer bestimmten Notiz.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `dateiname` | `string` | Ja | Name der Notiz-Datei |

```
User: "Was steht in der Notiz zur Baustellenbegehung?"
→ Tool: notiz_lesen({ dateiname: "2026-04-07_baustellenbegehung.md" })
→ [Inhalt der Notiz]
```

---

### `notiz_bearbeiten`

Fügt einer bestehenden Notiz einen Nachtrag hinzu.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `dateiname` | `string` | Ja | Name der Notiz-Datei |
| `text` | `string` | Ja | Inhalt des Nachtrags |

```
User: "Ergänze die Baustellennotiz: Statiker kommt Freitag"
→ Tool: notiz_bearbeiten({ dateiname: "2026-04-07_baustellenbegehung.md", text: "Statiker kommt Freitag" })
→ Nachtrag gespeichert
```

---

### `notiz_loeschen`

Löscht eine Notiz dauerhaft aus dem Vault.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `dateiname` | `string` | Ja | Name der Notiz-Datei |

```
User: "Lösch die alte Materialliste"
→ Tool: notiz_loeschen({ dateiname: "2026-04-06_materialliste.md" })
→ Notiz gelöscht
```

## Aufgaben

### `aufgabe_speichern`

Speichert eine neue Aufgabe / Todo.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | `string` | Ja | Beschreibung der Aufgabe |
| `projekt` | `string` | Nein | Optionaler Projektname |

```
User: "Erinnerung: Angebot an Firma Mueller schicken"
→ Tool: aufgabe_speichern({ text: "Angebot an Firma Mueller schicken" })
→ Aufgabe gespeichert
```

---

### `aufgaben_auflisten`

Listet alle offenen Aufgaben auf.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | `string` | Nein | Nur Aufgaben eines bestimmten Projekts |

```
User: "Was steht an?"
→ Tool: aufgaben_auflisten({})
→ * Angebot an Firma Mueller schicken
  * Plaene aktualisieren
  ...
```

---

### `aufgabe_erledigen`

Markiert eine Aufgabe als erledigt.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | `string` | Ja | Exakter Text der Aufgabe |
| `projekt` | `string` | Nein | Optionaler Projektname |

```
User: "Angebot an Mueller ist raus"
→ Tool: aufgabe_erledigen({ text: "Angebot an Firma Mueller schicken" })
→ Erledigt
```

## Termine

### `termin_speichern`

Speichert einen Termin oder ein Meeting.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `datum` | `string` | Ja | Datum im Format TT.MM.JJJJ |
| `text` | `string` | Ja | Beschreibung des Termins |
| `uhrzeit` | `string` | Nein | Uhrzeit im Format HH:MM |
| `projekt` | `string` | Nein | Optionaler Projektname |

```
User: "Am 15.04. um 10 Uhr Baustellenbegehung mit Statiker"
→ Tool: termin_speichern({ datum: "15.04.2026", text: "Baustellenbegehung mit Statiker", uhrzeit: "10:00" })
→ Termin gespeichert
```

---

### `termine_auflisten`

Listet alle gespeicherten Termine auf.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `projekt` | `string` | Nein | Nur Termine eines bestimmten Projekts |

```
User: "Welche Termine habe ich?"
→ Tool: termine_auflisten({})
→ 15.04.2026 10:00 – Baustellenbegehung mit Statiker
  20.04.2026 – Einreichfrist Baubewilligung
```

---

### `termin_loeschen`

Löscht einen Termin aus der Terminliste.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | `string` | Ja | Text oder Teiltext des Termins |
| `projekt` | `string` | Nein | Optionaler Projektname |

```
User: "Streich den Termin mit dem Statiker"
→ Tool: termin_loeschen({ text: "Baustellenbegehung mit Statiker" })
→ Termin gelöscht
```

## Projekte

### `projekte_auflisten`

Listet alle vorhandenen Projekte auf.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|

_Keine Parameter._

```
User: "Welche Projekte gibt es?"
→ Tool: projekte_auflisten({})
→ Projekt Alpha
  Projekt Beta
  Sanierung Hauptstrasse
```

---

### `projekt_info`

Zeigt Informationen zu einem bestimmten Projekt.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | `string` | Ja | Name des Projekts |

```
User: "Was weißt du über Projekt Alpha?"
→ Tool: projekt_info({ name: "Projekt Alpha" })
→ [Projektinformationen]
```

## Dateien

### `datei_lesen`

Liest eine beliebige Datei aus dem Vault (relativer Pfad).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `pfad` | `string` | Ja | Relativer Pfad im Vault, z.B. `Projekte/Alpha/README.md` |

```
User: "Lies mir die README aus Projekt Alpha vor"
→ Tool: datei_lesen({ pfad: "Projekte/Alpha/README.md" })
→ [Dateiinhalt]
```

---

### `datei_erstellen`

Erstellt eine neue Datei im Vault oder überschreibt eine bestehende.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `pfad` | `string` | Ja | Relativer Pfad im Vault |
| `inhalt` | `string` | Ja | Dateiinhalt |

```
User: "Erstell mir eine Checkliste für die Baustellenbegehung"
→ Tool: datei_erstellen({ pfad: "Projekte/Alpha/checkliste.md", inhalt: "# Checkliste\n- [ ] ..." })
→ Datei erstellt: checkliste.md
```

---

### `ordner_auflisten`

Listet den Inhalt eines Ordners im Vault auf.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `pfad` | `string` | Nein | Relativer Pfad (leer = Vault-Wurzel) |

```
User: "Was liegt im Projekt-Alpha-Ordner?"
→ Tool: ordner_auflisten({ pfad: "Projekte/Alpha" })
→ README.md
  checkliste.md
  plaene/
```

## Suche

### `vault_suchen`

Sucht nach einem Begriff in allen Notizen.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `suchbegriff` | `string` | Ja | Der Suchbegriff |
| `projekt` | `string` | Nein | Suche auf ein Projekt begrenzen |

```
User: "Wo steht was über den Statiker?"
→ Tool: vault_suchen({ suchbegriff: "Statiker" })
→ 2026-04-07_baustellenbegehung.md
     Statiker kommt Freitag
  Termine.md
     15.04.2026 – Baustellenbegehung mit Statiker
```

## Memory

### `memory_speichern`

Speichert eine wichtige Information dauerhaft in der `MEMORY.md` des Agenten.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `eintrag` | `string` | Ja | Die zu speichernde Information (1-2 Sätze) |

::: tip Wann wird Memory verwendet?
- Nutzer sagt explizit: "merk dir", "vergiss nicht", "speicher dauerhaft"
- Information ist für zukünftige Gespräche wichtig (Präferenzen, Kontakte, Entscheidungen)
:::

```
User: "Merk dir: Herr Mueller bevorzugt E-Mail statt Telefon"
→ Tool: memory_speichern({ eintrag: "Herr Mueller bevorzugt E-Mail statt Telefon" })
→ In MEMORY.md gespeichert
```

## Agent-Verwaltung

### `agent_erstellen`

Erstellt einen neuen Sub-Agenten mit eigenem Workspace.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `name` | `string` | Ja | Name des neuen Agenten |
| `beschreibung` | `string` | Ja | Was dieser Agent tun soll (wird zu SOUL.md) |

```
User: "Erstell mir einen Protokoll-Agenten"
→ Tool: agent_erstellen({ name: "Protokoll", beschreibung: "Erstellt Besprechungsprotokolle" })
→ Agent "Protokoll" erstellt mit Workspace in Agents/Protokoll/
```

---

### `agent_spawnen`

Startet einen Sub-Agenten und wartet auf das Ergebnis (**blocking**). Für kurze Aufgaben.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | `string` | Ja | Name des Sub-Agenten |
| `aufgabe` | `string` | Ja | Detaillierte Aufgabenbeschreibung |

```
→ Tool: agent_spawnen({ agent: "Protokoll", aufgabe: "Fasse das heutige Meeting zusammen" })
→ [Protokoll]: Zusammenfassung des Meetings...
```

---

### `agent_spawnen_async`

Startet einen Sub-Agenten **non-blocking** im Hintergrund. Sofortige Rückkehr — Ergebnis wird als separate Nachricht gepostet wenn fertig.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | `string` | Ja | Name des Sub-Agenten |
| `aufgabe` | `string` | Ja | Aufgabenbeschreibung |

```
→ Tool: agent_spawnen_async({ agent: "Recherche", aufgabe: "Finde alle Normen zu Waermedaemmung" })
→ Recherche-Agent gestartet – Ergebnis kommt gleich.
```

---

### `agenten_auflisten`

Listet alle verfügbaren Sub-Agenten auf.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|

_Keine Parameter._

---

### `agent_verlauf`

Liest den heutigen Gesprächsverlauf eines anderen Agenten.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | `string` | Ja | Name des Agenten |

---

### `agent_aktiv`

Listet alle Agenten auf, die heute aktiv waren (einen Tageslog haben).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|

_Keine Parameter._

---

### `agent_datei_lesen`

Liest eine Konfigurationsdatei eines Agenten.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | `string` | Ja | Name des Agenten (z.B. `Main`, `Protokoll`) |
| `datei` | `string` | Ja | Dateiname (z.B. `SOUL.md`, `HEARTBEAT.md`) |

---

### `agent_datei_schreiben`

Überschreibt eine Konfigurationsdatei eines Agenten.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `agent` | `string` | Ja | Name des Agenten |
| `datei` | `string` | Ja | Dateiname (muss in der Whitelist sein) |
| `inhalt` | `string` | Ja | Neuer vollständiger Inhalt der Datei |

::: warning Whitelist
Erlaubte Dateien: `SOUL.md`, `BOOT.md`, `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `USER.md`, `IDENTITY.md`, `MEMORY.md`
:::

## System-Tools

### `befehl_ausfuehren`

Fuehrt einen Shell-Befehl auf dem Server aus. Nur Befehle aus der **Allowlist** sind erlaubt.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `befehl` | `string` | Ja | Der auszufuehrende Befehl |
| `verzeichnis` | `string` | Nein | Arbeitsverzeichnis (Standard: Projektroot) |
| `timeout` | `number` | Nein | Timeout in Sekunden (Standard: 15, max: 60) |

**Erlaubte Befehle** (~40):
`ls`, `cat`, `head`, `tail`, `grep`, `find`, `wc`, `sort`, `df`, `du`, `free`, `uptime`, `ps`, `systemctl`, `journalctl`, `curl`, `wget`, `ping`, `dig`, `pwd`, `git`, `npm`, `node`, `ollama`, `docker`, `cp`, `mv`, `mkdir`, `touch`, `chmod`, `tar`, `zip`, `unzip` u.a.

::: warning Sicherheit
Nicht erlaubte Befehle (rm, shutdown, reboot, sudo, etc.) werden mit einer Fehlermeldung abgelehnt. Die Allowlist ist in `src/llm/executor.ts` definiert.
:::

---

### `code_ausfuehren`

Fuehrt JavaScript-Code in einer **Sandbox** aus (kein Netzwerk, kein Dateisystem).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `code` | `string` | Ja | JavaScript-Code |

Verfuegbar in der Sandbox: `Math`, `Date`, `JSON`, `String`, `Number`, `Array`, `Object`, `RegExp`, `Map`, `Set`. Timeout: 10 Sekunden.

---

### `http_anfrage`

Sendet HTTP-Anfragen an externe APIs.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `url` | `string` | Ja | Ziel-URL |
| `methode` | `string` | Nein | HTTP-Methode (Standard: GET) |
| `headers` | `string` | Nein | JSON-String mit Headers |
| `body` | `string` | Nein | Request-Body (fuer POST/PUT/PATCH) |

---

### `heute_briefing`

::: tip Hinweis
Das Tages-Briefing wird nicht als eigenes Tool aufgerufen, sondern über den `/heute`-Command ausgeloest. Intern führt es `processAgent("Main", <briefing-prompt>)` aus.
:::

---

### `konversation_loeschen`

::: tip Hinweis
Das Zurücksetzen des Gesprächskontexts erfolgt über den `/neu`-Command. Intern wird `clearAgentToday("Main")` aufgerufen, was den heutigen Tageslog löscht.
:::

## Übersicht: Alle Tools nach Kategorie

| Kategorie | Tools | Anzahl |
|---|---|---|
| Notizen | `notiz_speichern`, `notizen_auflisten`, `notiz_lesen`, `notiz_bearbeiten`, `notiz_loeschen` | 5 |
| Aufgaben | `aufgabe_speichern`, `aufgaben_auflisten`, `aufgabe_erledigen` | 3 |
| Termine | `termin_speichern`, `termine_auflisten`, `termin_loeschen` | 3 |
| Projekte | `projekte_auflisten`, `projekt_info` | 2 |
| Dateien | `datei_lesen`, `datei_erstellen`, `ordner_auflisten` | 3 |
| Suche | `vault_suchen` | 1 |
| Memory | `memory_speichern` | 1 |
| Agent-Verwaltung | `agent_erstellen`, `agent_spawnen`, `agent_spawnen_async`, `agenten_auflisten`, `agent_verlauf`, `agent_aktiv`, `agent_datei_lesen`, `agent_datei_schreiben` | 8 |
| System | `befehl_ausfuehren`, `code_ausfuehren`, `http_anfrage` | 3 |
| Dateieditor | `datei_bearbeiten`, `dateien_suchen`, `regex_suchen` | 3 |
| Dynamische Tools | `tool_erstellen`, `tools_auflisten`, `tool_loeschen` | 3 |
| MCP | `mcp_server_auflisten`, `mcp_server_verbinden`, `mcp_server_trennen` | 3 |
| **Gesamt** | | **35** |
