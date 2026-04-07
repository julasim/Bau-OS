# Changelog

Versionshistorie von Bau-OS. Älteste Version zuerst.

## v0.1.0 — Initial MVP
**04.04.2026**

Erster funktionsfähiger Prototyp mit Telegram-Bot, lokalem LLM und Obsidian-Vault.

- Telegram-Bot mit grammY-Framework
- Ollama-Integration als lokales LLM (qwen2.5:7b)
- Obsidian Vault als Datenspeicher (Markdown-Dateien)
- 30+ Slash-Commands (`/hilfe`, `/status`, `/heute`, etc.)
- Notizen, Aufgaben und Termine verwalten
- Vault-Suche über alle Markdown-Dateien
- Projekt-Verwaltung mit Unterordnern
- System-Prompt aus Markdown-Dateien (SOUL.md, BOOT.md, etc.)

::: tip MVP-Entscheidung
Bewusste Entscheidung gegen Cloud-AI (OpenAI, etc.) zugunsten von vollständiger Datensouveränität. Alle Daten bleiben auf dem eigenen Server.
:::

---

## v0.2.0 — Multi-Agent System
**05.04.2026**

Einführung des Multi-Agent-Systems mit Sub-Agenten, Session-Queue und Tageslog-Komprimierung.

- Multi-Agent-Architektur: Main-Agent kann Sub-Agenten spawnen
- `agent_spawnen` (blocking) und `agent_spawnen_async` (non-blocking)
- `agent_erstellen` — neue Agenten zur Laufzeit anlegen
- Session-Queue: Serialisierung pro Chat-ID gegen Race Conditions
- Tageslog-Komprimierung (Compaction) via LLM
- Gesprächsverlauf: Laden der letzten N Einträge
- PROTECTED_AGENTS: Main-Agent kann nicht gelöscht werden
- MAX_SPAWN_DEPTH: Verschachtelungstiefe begrenzt auf 2

---

## v0.3.0 — Setup-Wizard & Heartbeat
**06.04.2026**

Interaktiver Einrichtungsassistent und zeitgesteuertes Heartbeat-System.

- Setup-Wizard beim ersten Start (Name, Emoji, Vibe, Unternehmen)
- `setup_abschliessen`-Tool: LLM sammelt Daten und konfiguriert sich selbst
- HEARTBEAT.md: Cron-basierte Agent-Ausführung
- Stille-Modus: Agent antwortet mit `[STILL]` wenn nichts zu melden
- `node-cron` Integration mit Timezone-Support (Europe/Vienna)
- Installer-Script für automatisiertes Deployment

---

## v0.4.0 — LLM Tools & File Editor
**06.04.2026**

Umstellung von Regex-Commands auf LLM Tool Calling. Der Bot versteht jetzt natürliche Sprache.

- LLM Tool Calling statt Regex-basierte Erkennung
- OpenAI Function Calling Format (JSON Schema)
- Agentic Loop: Bis zu 5 Tool-Runden pro Nachricht
- Agent-Datei-Editor: `agent_datei_lesen`, `agent_datei_schreiben`
- Whitelist für editierbare Dateien (SOUL.md, BOOT.md, etc.)
- CRUD-Operationen über natürliche Sprache
- `/btw`-Modus: Direkte Antwort ohne Tools und ohne Log
- Memory-Tool: `memory_speichern` für Langzeitgedächtnis

::: tip Paradigmenwechsel
Vorher: `/notiz Baustellenbegehung war erfolgreich`
Nachher: "Notier dir dass die Baustellenbegehung erfolgreich war"
:::

---

## v0.5.0 — Admin Commands & Logging
**07.04.2026**

Erweitertes Logging-System und administrative Telegram-Commands.

- Logging-Modul (`src/logger.ts`) mit Datei- und Konsolen-Ausgabe
- Log-Rotation: Automatisches Kürzen auf 500 Zeilen
- `/logs [n]` — Letzte Log-Einträge im Chat anzeigen
- `/config` — Aktuelle Konfiguration anzeigen
- `/restart` — Bot per Command neu starten
- `/kontext` — Kontext-Auslastung mit Token-Schaetzung
- `/export` — Session-Log als Markdown exportieren
- `/model` — Modell zur Laufzeit wechseln
- `/fast` — Fast-Modus umschalten
- Zeitstempel im österreichischen Format (de-AT, Europe/Vienna)

---

## v0.6.0 — Modularisierung
**07.04.2026**

Komplette Projekt-Restrukturierung: Von 2 großen Dateien zu 15+ fokussierten Modulen.

- `src/vault/` — 8 Module: notes, tasks, termine, projects, files, search, agents, helpers
- `src/llm/` — 5 Module: client, tools, executor, runtime, compaction, setup
- `src/commands/` — System-Commands in eigenes Modul
- Barrel Re-Exports (`vault/index.ts`)
- Zirkulaere Imports aufgeloest (Late-Binding Pattern in executor.ts)
- Express-Dependency entfernt (kein Web-Dashboard mehr)
- Codebase von ~1.500 Zeilen in 2 Dateien zu ~2.150 Zeilen in 23 Dateien

::: warning Breaking Change
Die Module-Pfade haben sich geändert. Alle Imports zeigen jetzt auf Sub-Module statt auf monolithische Dateien.
:::

---

## v0.7.0 — Hardcode-Reduktion & Dokumentation
**07.04.2026**

Konfiguration zentralisiert und VitePress-Dokumentation aufgebaut.

- Zentrale `config.ts` mit allen Konstanten
- Umgebungsvariablen für LLM-Modelle (`OLLAMA_MODEL`, `OLLAMA_FAST_MODEL`, `OLLAMA_SUBAGENT_MODEL`)
- VitePress-Dokumentation mit vollständiger Referenz
- Sicherheitsdokumentation: DSGVO, Isolation, Zugriffskontrolle
- Tool-Referenz: Alle 26 LLM-Tools dokumentiert
- Dateistruktur-Referenz: Alle 23 Module dokumentiert
- Konfigurationsreferenz: Alle Konstanten dokumentiert

---

## Roadmap

Geplante Features für zukuenftige Versionen:

| Feature | Prioritaet | Status |
|---|---|---|
| ALLOWED_USERS-Liste | Hoch | Geplant |
| Rollenbasierte Zugriffskontrolle | Hoch | Geplant |
| Sprachnachrichten (Whisper) | Mittel | Vorbereitet |
| ÖNORM-Kalkulations-Agent | Mittel | Geplant |
| Telegram-Gruppen-Support | Mittel | Geplant |
| Webhook-Modus (statt Long Polling) | Niedrig | Geplant |
| Rate Limiting | Niedrig | Geplant |
| Audit-Log | Niedrig | Geplant |
