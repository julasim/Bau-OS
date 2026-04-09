# Zugriffskontrolle

Bau-OS implementiert mehrere Schichten der Zugriffskontrolle: von der Chat-ID-Bindung bis zum Dateieditor-Whitelist.

## Aktuelle Zugriffskontrolle

### Chat-ID-Bindung

Beim **ersten Kontakt** speichert der Bot die Telegram Chat-ID des Nutzers:

```typescript
// src/heartbeat.ts
export function saveChatId(id: number): void {
  if (_chatId === id) return;
  _chatId = id;
  fs.writeFileSync(CHAT_ID_FILE, String(id), "utf-8");
}
```

Diese Chat-ID wird für den **Heartbeat** verwendet — der Bot sendet proaktive Nachrichten nur an diese gespeicherte ID.

| Mechanismus | Beschreibung |
|---|---|
| Erste Nachricht | Chat-ID wird in `.chat_id` gespeichert |
| Heartbeat | Nutzt gespeicherte Chat-ID für Cron-Nachrichten |
| Nachrichten | Jede Nachricht wird über die Session-Queue verarbeitet |

::: warning Aktueller Stand
Derzeit reagiert der Bot auf **jede eingehende Nachricht**, unabhängig von der Chat-ID. Die Chat-ID wird nur für ausgehende Heartbeat-Nachrichten verwendet. Eine explizite Zugriffsbeschraenkung ist in Planung.
:::

### `/whoami` — Eigene Chat-ID anzeigen

```
/whoami
→ Chat-ID: 123456789
  Username: @meinname
  Name: Max Mustermann
```

## Agent-Datei-Editor: Whitelist

Der LLM-Agent kann über `agent_datei_schreiben` Konfigurationsdateien bearbeiten. Dabei gilt eine **strenge Whitelist**:

```typescript
const EDITABLE_AGENT_FILES = [
  "SOUL.md",       // Persönlichkeit des Agenten
  "BOOT.md",       // Verhaltensregeln bei jedem Start
  "AGENTS.md",     // Sub-Agent-Konfiguration
  "TOOLS.md",      // Tool-Konventionen
  "HEARTBEAT.md",  // Cron-Konfiguration
  "BOOTSTRAP.md",  // Erst-Start-Prompt
  "USER.md",       // Nutzer-Profil
  "IDENTITY.md",   // Name, Emoji, Vibe
  "MEMORY.md",     // Langzeitgedächtnis
];
```

::: tip Nur Markdown-Dateien
Der Agent kann **ausschließlich** die oben genannten `.md`-Dateien bearbeiten. Zugriff auf Quellcode, `.env`, Systemdateien oder beliebige Pfade ist **nicht möglich**.
:::

### Geschuetzte Agenten (PROTECTED_AGENTS)

Der `Main`-Agent ist als **geschuetzt** markiert und kann nicht gelöscht werden:

```typescript
// src/config.ts
export const AGENTS = [
  { name: "Main", model: DEFAULT_MODEL, protected: true, description: "Haupt-Agent" },
];

export const PROTECTED_AGENTS = AGENTS.filter(a => a.protected).map(a => a.name);
```

| Aktion | Main-Agent | Andere Agenten |
|---|---|---|
| Erstellen | Automatisch beim Setup | Via `agent_erstellen` |
| Dateien lesen | Erlaubt | Erlaubt |
| Dateien schreiben | Nur Whitelist | Nur Whitelist |
| Löschen | **Blockiert** | Erlaubt |
| Umbenennen | **Blockiert** | Nicht implementiert |

## SSH-Zugang zum Server

Der VPS ist nur über **SSH** erreichbar:

```bash
# Verbindung zum Server
ssh bauos@<server-ip>

# Bot-Status prüfen
systemctl status bauos

# Logs anzeigen
journalctl -u bauos -f

# .env bearbeiten
nano /home/bauos/bau-os/.env
```

::: warning Root-Zugang
SSH-Zugang zum Server bedeutet **volle Kontrolle** über alle Daten. SSH-Keys sollten sicher aufbewahrt und regelmäßig rotiert werden.
:::

## Rate Limiting

Der Login-Endpoint der Web-API ist gegen Brute-Force-Angriffe geschuetzt:

| Parameter | Wert |
|---|---|
| Max. Versuche | 5 pro IP-Adresse |
| Zeitfenster | 15 Minuten |
| HTTP-Antwort | `429 Too Many Requests` |
| Zaehler-Reset | Bei erfolgreichem Login |

```typescript
// src/api/server.ts
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 Minuten
```

Nach 5 fehlgeschlagenen Login-Versuchen von derselben IP wird der Zugang fuer 15 Minuten gesperrt. Ein erfolgreicher Login setzt den Zaehler zurueck.

## Path-Traversal-Schutz

Alle Datei-Operationen im Vault sind gegen Path-Traversal-Angriffe geschuetzt:

| Modul | Schutz | Beschreibung |
|---|---|---|
| `vault/fileops.ts` | `safePath()` | Prueft ob der aufgeloeste Pfad innerhalb des Vaults liegt |
| `vault/files.ts` | `safePath()` | Schuetzt `readFile`, `createFile`, `listFolder` |
| `vault/projects.ts` | `safeProjectName()` | Validiert Projektnamen gegen `[\w\-. ]+`, blockiert `..` |

```typescript
// Beispiel: safePath() in files.ts
function safePath(relativePath: string): string | null {
  const resolved = path.resolve(vaultPath, relativePath);
  if (!resolved.startsWith(vaultPath)) return null; // Blockiert!
  return resolved;
}
```

::: warning LLM-generierte Pfade
Der LLM-Agent generiert Pfade basierend auf Nutzereingaben. Ohne `safePath()` koennten manipulierte Pfade wie `../../etc/passwd` den Vault verlassen. Alle Datei-Tools validieren Pfade bevor sie auf das Dateisystem zugreifen.
:::

## Shell-Allowlist

Der `befehl_ausfuehren`-Tool verwendet eine **Allowlist** statt einer Blocklist:

```typescript
const ALLOWED_COMMANDS = [
  "ls", "cat", "head", "tail", "grep", "find", "wc", "sort", "uniq",
  "df", "du", "free", "uptime", "ps", "systemctl", "journalctl",
  "curl", "wget", "ping", "dig", "git", "npm", "node", "ollama",
  // ... ~40 Befehle insgesamt
];
```

Nur Befehle in dieser Liste koennen ausgefuehrt werden. Alle anderen werden mit einer Fehlermeldung abgelehnt.

## Geplante Erweiterungen

### ALLOWED_USERS Liste

Geplant ist eine `ALLOWED_USERS`-Umgebungsvariable in der `.env`:

```env
# Geplant:
ALLOWED_USERS=123456789,987654321
```

Nur Chat-IDs in dieser Liste würden vom Bot verarbeitet. Alle anderen Nachrichten würden ignoriert oder mit einer Fehlermeldung beantwortet.

### Rollenbasierte Zugriffskontrolle

Geplant ist eine Unterscheidung zwischen Admin- und User-Rolle:

| Rolle | Rechte |
|---|---|
| **Admin** | Alle Commands, Agent-Verwaltung, `/config`, `/restart`, `/logs` |
| **User** | Nachrichten senden, Notizen/Aufgaben/Termine verwalten |

```env
# Geplant:
ADMIN_USERS=123456789
ALLOWED_USERS=123456789,987654321,555555555
```

### Gruppen-Modus

Geplant ist die Unterstuetzung von Telegram-Gruppen:

| Modus | Beschreibung |
|---|---|
| **DM-Only** (aktuell) | Bot reagiert nur in Direktnachrichten |
| **Gruppen-Modus** (geplant) | Bot reagiert in bestimmten Gruppen, z.B. Bau-Projektgruppen |

## Sicherheits-Checkliste

| Prüfpunkt | Status |
|---|---|
| Chat-ID Persistierung | Implementiert |
| Session-Queue (Race-Condition-Schutz) | Implementiert |
| Agent-Datei-Whitelist | Implementiert |
| PROTECTED_AGENTS | Implementiert |
| Bot-Log mit Rotation (max. 500 Zeilen) | Implementiert |
| Rate Limiting (Login-API) | Implementiert |
| Path-Traversal-Schutz | Implementiert |
| Shell-Allowlist | Implementiert |
| JSON.parse Error-Handling | Implementiert |
| Graceful Shutdown (SIGTERM/SIGINT) | Implementiert |
| MCP-Cleanup bei Shutdown | Implementiert |
| Sandbox-Haertung (kein fetch, gefilterte Env-Vars) | Implementiert |
| CORS konfigurierbar | Implementiert |
| ALLOWED_USERS Liste | Geplant |
| Rollenbasierte Zugriffskontrolle | Geplant |
| Gruppen-Modus | Geplant |
| Audit-Log | Geplant |
