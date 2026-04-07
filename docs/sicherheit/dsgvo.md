# DSGVO & Datenschutz

Bau-OS wurde von Grund auf fuer **maximalen Datenschutz** konzipiert. Kein Cloud-AI, kein Tracking, keine Drittanbieter.

## Grundprinzip: Alles bleibt auf deinem Server

```
Telegram ──► Dein VPS (Hetzner) ──► Ollama (lokal) ──► Obsidian Vault (lokal)
                    │
                    └── Kein externer API-Call, kein Cloud-LLM
```

::: tip Kein Cloud-AI
Bau-OS verwendet **Ollama** als lokales LLM. Alle Anfragen werden direkt auf dem Server verarbeitet. Es werden **keine Daten an OpenAI, Google, Anthropic oder andere Cloud-Dienste** gesendet.
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

Bau-OS speichert ausschliesslich Daten, die der Nutzer **aktiv sendet**:

| Datentyp | Speicherort | Beschreibung |
|---|---|---|
| Telegram-Nachrichten | `Agents/Main/MEMORY_LOGS/` | Tageslog der Konversation (Markdown) |
| Notizen | `Inbox/` | Vom Nutzer erstellte Notizen |
| Aufgaben | `Aufgaben.md` | Todo-Liste |
| Termine | `Termine.md` | Terminliste |
| Projektdateien | `Projekte/` | Projektspezifische Dateien |
| Langzeitgedaechtnis | `Agents/Main/MEMORY.md` | Dauerhaft gespeicherte Fakten |
| Bot-Log | `logs/bot.log` | Technisches Log (max. 500 Zeilen) |
| Chat-ID | `.chat_id` | Telegram Chat-ID fuer Heartbeat |

::: warning Keine automatische Datenerkennung
Bau-OS erkennt **nicht** automatisch, ob eine Nachricht personenbezogene Daten enthaelt. Der Nutzer ist selbst verantwortlich dafuer, welche Inhalte er dem Bot sendet.
:::

## Was wird NICHT gespeichert?

- **Keine Cookies** — Bau-OS hat kein Web-Frontend fuer Endnutzer
- **Kein Tracking** — Keine Analytics, kein Google Analytics, kein Matomo
- **Keine IP-Adressen** — Telegram-Nachrichten enthalten keine IP
- **Keine Nutzungsprofile** — Kein Profiling, kein Scoring
- **Keine Drittanbieter-APIs** — Kein Datenabfluss an externe Dienste

## Daten loeschen

Das vollstaendige Loeschen aller Nutzerdaten ist trivial:

```bash
# Alle Vault-Daten loeschen
rm -rf /pfad/zum/vault/*

# Oder spezifisch:
rm -rf /pfad/zum/vault/Agents/Main/MEMORY_LOGS/   # Gespraeche
rm -rf /pfad/zum/vault/Inbox/                       # Notizen
rm /pfad/zum/vault/Aufgaben.md                      # Aufgaben
rm /pfad/zum/vault/Termine.md                       # Termine
rm /pfad/zum/vault/Agents/Main/MEMORY.md            # Gedaechtnis

# Technische Daten loeschen
rm logs/bot.log
rm .chat_id
```

::: tip Einfache Datenloesung
Da alle Daten als **Markdown-Dateien** im Vault liegen, reicht ein einfaches `rm -rf` auf den Vault-Ordner, um alle Nutzerdaten vollstaendig zu loeschen. Keine Datenbank, kein Export noetig.
:::

## Auftragsverarbeitung (AVV)

Fuer den Einsatz bei Kunden ist ein **Auftragsverarbeitungsvertrag** (AVV) nach Art. 28 DSGVO empfohlen:

| Punkt | Umsetzung |
|---|---|
| Gegenstand | KI-gestuetzte Notizverwaltung via Telegram |
| Art der Daten | Textnachrichten, Notizen, Aufgaben, Termine |
| Betroffene Personen | Nutzer des Telegram-Bots |
| Dauer | Solange der VPS betrieben wird |
| Loeschung | Vault-Ordner loeschen = vollstaendige Datenloesung |
| Subauftragnehmer | Hetzner (Hosting), Telegram (Nachrichtenuebermittlung) |
| Technische Massnahmen | SSH-Zugang, Firewall, eigener VPS, lokales LLM |

::: warning Telegram als Transportweg
Telegram uebertraegt Nachrichten ueber seine Server. Die Telegram-API speichert Nachrichten fuer die Zustellung. Dies liegt ausserhalb der Kontrolle von Bau-OS. Fuer besonders sensible Daten sollte ein alternativer Kanal in Betracht gezogen werden.
:::

## Technische und organisatorische Massnahmen (TOMs)

| Massnahme | Beschreibung |
|---|---|
| Zutrittskontrolle | SSH-Key-basierter Zugang zum Server |
| Zugangskontrolle | Bot reagiert nur auf gespeicherte Chat-ID |
| Zugriffskontrolle | Agent-Datei-Editor mit Whitelist (nur bestimmte MD-Dateien) |
| Trennungskontrolle | Jeder Kunde eigener VPS, eigener Vault, eigener Bot |
| Pseudonymisierung | Chat-ID statt Klarnamen im System |
| Verfuegbarkeit | VPS mit Hetzner SLA, Bot-Neustart via `/restart` |
| Belastbarkeit | Session-Queue verhindert Race Conditions |
