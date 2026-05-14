# DSGVO & Datenschutz

PATIO wurde für maximalen Datenschutz konzipiert. Im Standard-Modus (Ollama) verlassen keine Nutzerdaten deinen Server. Cloud-LLM (OpenAI) ist opt-in.

## Grundprinzip: Datensouveränität by default

```
Telegram ──► Dein VPS (Hetzner) ──► Ollama (lokal) ──► Workspace (Markdown / PostgreSQL)
```

::: tip Datensouveränität by default
Im Standard-Modus (Ollama) werden alle Anfragen lokal verarbeitet — kein Datenabfluss an einen LLM-Anbieter.

Wenn `OPENAI_API_KEY` in der `.env` gesetzt ist, werden Anfragen an OpenAI gesendet (opt-in). In diesem Fall gelten die Datenschutzbedingungen von OpenAI — Nutzungsdaten gehen an OpenAI's Server.

Für maximalen Datenschutz: Ollama ohne `OPENAI_API_KEY` verwenden.
:::

## EU-Server

| Eigenschaft | Wert |
|---|---|
| Hoster | Hetzner Online GmbH |
| Standort | Deutschland (Falkenstein/Nürnberg) oder Finnland (Helsinki) |
| Rechtsraum | EU / DSGVO |
| Datenverarbeitung | Ausschließlich auf dem gemieteten VPS |
| Subauftragnehmer | Keine (self-hosted); bei OpenAI-Nutzung: OpenAI als Subauftragnehmer |

## Welche Daten werden gespeichert?

PATIO speichert ausschließlich Daten, die der Nutzer **aktiv sendet**:

| Datentyp | Speicherort | Beschreibung |
|---|---|---|
| Telegram-Nachrichten | `Agents/Main/MEMORY_LOGS/` | Tageslog der Konversation (Markdown) |
| Notizen | `Inbox/` oder PostgreSQL | Vom Nutzer erstellte Notizen |
| Aufgaben | `Aufgaben.md` oder PostgreSQL | Todo-Liste |
| Termine | `Termine.md` oder PostgreSQL | Terminliste |
| Projektdateien | `Projekte/` oder PostgreSQL | Projektspezifische Dateien |
| Langzeitgedächtnis | `Agents/Main/MEMORY.md` | Dauerhaft gespeicherte Fakten |
| Bot-Log | `logs/bot.log` | Technisches Log (max. 500 Zeilen) |
| Chat-ID | `.chat_id` | Telegram Chat-ID für Heartbeat |
| Chat-Sessions | JSONL-Dateien (`MEMORY_LOGS/`) | Gesprächsverlauf — immer Markdown, auch im DB-Modus |
| Embeddings | PostgreSQL + pgvector (optional) | Vektoren für semantische Suche |

::: tip Chat-Verlauf immer als Datei
Chat-History und Agent-Logs werden immer als JSONL-Dateien gespeichert — unabhängig davon, ob PostgreSQL aktiv ist. Das macht sie einfach lesbar und löschbar.
:::

::: warning Keine automatische Datenerkennung
PATIO erkennt **nicht** automatisch, ob eine Nachricht personenbezogene Daten enthält. Der Nutzer ist selbst verantwortlich dafür, welche Inhalte er dem Bot sendet.
:::

## Was wird NICHT gespeichert?

- **Keine Tracking-Cookies** — Die Web-UI verwendet JWT im `localStorage`, kein Session-Tracking, keine Tracking-Cookies
- **Kein Tracking** — Keine Analytics, kein Google Analytics, kein Matomo
- **Keine IP-Adressen** — Telegram-Nachrichten enthalten keine IP
- **Keine Nutzungsprofile** — Kein Profiling, kein Scoring
- **Keine Drittanbieter-APIs** im Ollama-Modus — Im OpenAI-Modus gehen Prompt-Daten an OpenAI (opt-in)

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

::: tip Einfache Datenlösung (Markdown-Modus)
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
| Gegenstand | KI-gestützte Notizverwaltung via Telegram und Web-UI |
| Art der Daten | Textnachrichten, Notizen, Aufgaben, Termine |
| Betroffene Personen | Nutzer des Telegram-Bots und der Web-Oberfläche |
| Dauer | Solange der VPS betrieben wird |
| Löschung | Vault-Ordner löschen = vollständige Datenlösung (Markdown-Modus); DROP TABLE / dropdb im DB-Modus |
| Subauftragnehmer | Hetzner (Hosting), Telegram (Nachrichtenübermittlung), ggf. OpenAI (opt-in, nur wenn OPENAI_API_KEY gesetzt) |
| Technische Maßnahmen | SSH-Zugang, Firewall, eigener VPS, lokales LLM (Standard) |

::: warning Telegram als Transportweg
Telegram überträgt Nachrichten über seine Server. Die Telegram-API speichert Nachrichten für die Zustellung. Dies liegt außerhalb der Kontrolle von PATIO. Für besonders sensible Daten sollte ein alternativer Kanal in Betracht gezogen werden.
:::

## Technische und organisatorische Maßnahmen (TOMs)

| Maßnahme | Beschreibung |
|---|---|
| Zutrittskontrolle | SSH-Key-basierter Zugang zum Server |
| Zugangskontrolle | Bot reagiert nur auf gespeicherte Chat-ID; Web-UI erfordert JWT-Authentifizierung |
| Zugriffskontrolle | Agent-Datei-Editor mit Whitelist (nur bestimmte MD-Dateien) |
| Rate Limiting (Login) | Max. 5 Versuche pro IP in 15 Min (Brute-Force-Schutz für Web-Login) |
| Rate Limiting (API) | Max. 600 Requests/Min pro IP (globaler API-Throttle, 429 mit Retry-After) |
| Path-Traversal-Schutz | Alle Datei-Operationen validieren Pfade gegen Vault-Grenze |
| Shell-Allowlist | Nur ~40 definierte Befehle ausführbar (kein rm, shutdown etc.) |
| Sandbox-Härtung | Dynamische Tools ohne Netzwerkzugriff, gefilterte Umgebungsvariablen |
| SSRF-Schutz | IPv6-Adressen und dezimale IP-Darstellungen werden blockiert |
| Security Headers | X-Frame-Options, Content-Security-Policy (Web-UI) |
| MIME-Whitelist | Upload-Filter: nur erlaubte Dateitypen werden akzeptiert |
| Trennungskontrolle | Jeder Kunde eigener VPS, eigener Vault, eigener Bot |
| Pseudonymisierung | Chat-ID statt Klarnamen im System |
| Verfügbarkeit | VPS mit Hetzner SLA, Bot-Neustart via `/restart` |
| Belastbarkeit | Session-Queue verhindert Race Conditions |
| Graceful Shutdown | Sauberes Herunterfahren bei SIGTERM/SIGINT, MCP-Cleanup |
| Fehlerresilienz | JSON.parse Error-Handling verhindert Datenverlust bei korrupten Dateien |
| Audit-Log | Login-Ereignisse werden mit Retention (Standard: 365 Tage) aufbewahrt |
