# DSGVO & Datenschutz

Bau-OS wurde von Grund auf für **maximalen Datenschutz** konzipiert. Im Standard-Modus (Ollama) verlassen keine Daten deinen Server.

## Grundprinzip: Datensouveränität by default

```
Telegram ──► Dein VPS (Hetzner) ──► Ollama (lokal) ──► Obsidian Vault (lokal)
```

::: tip Datensouveränität by default
Im Standard-Modus (Ollama) werden alle Anfragen lokal verarbeitet — kein Datenabfluss.
Wenn `OPENAI_API_KEY` gesetzt ist, werden Anfragen an OpenAI gesendet (opt-in).
Für maximalen Datenschutz: Ollama verwenden.
:::

## EU-Server

| Eigenschaft | Wert |
|---|---|
| Hoster | Hetzner Online GmbH |
| Standort | Deutschland (Falkenstein/Nuernberg) oder Finnland (Helsinki) |
| Rechtsraum | EU / DSGVO |
| Datenverarbeitung | Ausschliesslich auf dem gemieteten VPS |
| Subauftragnehmer | Keine (self-hosted) |

## Welche Daten werden gespeichert?

Bau-OS speichert ausschließlich Daten, die der Nutzer **aktiv sendet**:

| Datentyp | Speicherort | Beschreibung |
|---|---|---|
| Telegram-Nachrichten | `Agents/Main/MEMORY_LOGS/` | Tageslog der Konversation (Markdown) |
| Notizen | `Inbox/` | Vom Nutzer erstellte Notizen |
| Aufgaben | `Aufgaben.md` | Todo-Liste |
| Termine | `Termine.md` | Terminliste |
| Projektdateien | `Projekte/` | Projektspezifische Dateien |
| Langzeitgedächtnis | `Agents/Main/MEMORY.md` | Dauerhaft gespeicherte Fakten |
| Bot-Log | `logs/bot.log` | Technisches Log (max. 500 Zeilen) |
| Chat-ID | `.chat_id` | Telegram Chat-ID für Heartbeat |
| Chat-Sessions | PostgreSQL oder JSONL (je nach Modus) | Gesprächsverlauf der aktuellen Session |
| Embeddings | PostgreSQL + pgvector (optional) | Vektoren für semantische Suche |

::: warning Keine automatische Datenerkennung
Bau-OS erkennt **nicht** automatisch, ob eine Nachricht personenbezogene Daten enthaelt. Der Nutzer ist selbst verantwortlich dafür, welche Inhalte er dem Bot sendet.
:::

## Was wird NICHT gespeichert?

- **Keine Tracking-Cookies** — Die Web-UI verwendet JWT im localStorage, kein Tracking
- **Kein Tracking** — Keine Analytics, kein Google Analytics, kein Matomo
- **Keine IP-Adressen** — Telegram-Nachrichten enthalten keine IP
- **Keine Nutzungsprofile** — Kein Profiling, kein Scoring
- **Keine Drittanbieter-APIs** im Ollama-Modus — Im OpenAI-Modus gehen Anfragen an OpenAI (opt-in)

## Daten löschen

### Markdown-Modus (Standard)

Das vollständige Löschen aller Nutzerdaten ist trivial:

```bash
# Alle Vault-Daten löschen
rm -rf /pfad/zum/vault/*

# Oder spezifisch:
rm -rf /pfad/zum/vault/Agents/Main/MEMORY_LOGS/   # Gespräche
rm -rf /pfad/zum/vault/Inbox/                       # Notizen
rm /pfad/zum/vault/Aufgaben.md                      # Aufgaben
rm /pfad/zum/vault/Termine.md                       # Termine
rm /pfad/zum/vault/Agents/Main/MEMORY.md            # Gedächtnis

# Technische Daten löschen
rm logs/bot.log
rm .chat_id
```

::: tip Einfache Datenloesung (Markdown-Modus)
Da alle Daten als **Markdown-Dateien** im Vault liegen, reicht ein einfaches `rm -rf` auf den Vault-Ordner, um alle Nutzerdaten vollständig zu löschen. Keine Datenbank, kein Export nötig.
:::

### PostgreSQL-Modus (optional)

```bash
# Einzelne Tabellen bereinigen:
psql bauos -c "DELETE FROM notes; DELETE FROM tasks; DELETE FROM termine; DELETE FROM projects;"

# Oder: gesamte Datenbank löschen
dropdb bauos
```

## Auftragsverarbeitung (AVV)

Für den Einsatz bei Kunden ist ein **Auftragsverarbeitungsvertrag** (AVV) nach Art. 28 DSGVO empfohlen:

| Punkt | Umsetzung |
|---|---|
| Gegenstand | KI-gestuetzte Notizverwaltung via Telegram |
| Art der Daten | Textnachrichten, Notizen, Aufgaben, Termine |
| Betroffene Personen | Nutzer des Telegram-Bots |
| Dauer | Solange der VPS betrieben wird |
| Loeschung | Vault-Ordner löschen = vollständige Datenloesung (Markdown-Modus) |
| Subauftragnehmer | Hetzner (Hosting), Telegram (Nachrichtenuebermittlung), ggf. OpenAI (opt-in) |
| Technische Massnahmen | SSH-Zugang, Firewall, eigener VPS, lokales LLM (Standard) |

::: warning Telegram als Transportweg
Telegram übertraegt Nachrichten über seine Server. Die Telegram-API speichert Nachrichten für die Zustellung. Dies liegt ausserhalb der Kontrolle von Bau-OS. Für besonders sensible Daten sollte ein alternativer Kanal in Betracht gezogen werden.
:::

## Technische und organisatorische Massnahmen (TOMs)

| Massnahme | Beschreibung |
|---|---|
| Zutrittskontrolle | SSH-Key-basierter Zugang zum Server |
| Zugangskontrolle | Bot reagiert nur auf gespeicherte Chat-ID |
| Zugriffskontrolle | Agent-Datei-Editor mit Whitelist (nur bestimmte MD-Dateien) |
| Rate Limiting | Login max. 5 Versuche pro IP in 15 Min (Brute-Force-Schutz) |
| Path-Traversal-Schutz | Alle Datei-Operationen validieren Pfade gegen Vault-Grenze |
| Shell-Allowlist | Nur ~40 definierte Befehle ausfuehrbar (kein rm, shutdown etc.) |
| Sandbox-Haertung | Dynamische Tools ohne Netzwerkzugriff, gefilterte Umgebungsvariablen |
| SSRF-Schutz | IPv6-Adressen und dezimale IP-Darstellungen werden blockiert |
| Security Headers | X-Frame-Options, Content-Security-Policy (Web-UI) |
| MIME-Whitelist | Upload-Filter: nur erlaubte Dateitypen werden akzeptiert |
| Trennungskontrolle | Jeder Kunde eigener VPS, eigener Vault, eigener Bot |
| Pseudonymisierung | Chat-ID statt Klarnamen im System |
| Verfügbarkeit | VPS mit Hetzner SLA, Bot-Neustart via `/restart` |
| Belastbarkeit | Session-Queue verhindert Race Conditions |
| Graceful Shutdown | Sauberes Herunterfahren bei SIGTERM/SIGINT, MCP-Cleanup |
| Fehlerresilienz | JSON.parse Error-Handling verhindert Datenverlust bei korrupten Dateien |
