# Zugriffskontrolle

PATIO implementiert mehrere Schichten der Zugriffskontrolle: von der Telegram-Absender-Prüfung bis zur Dateioperations-Whitelist.

## Telegram-Zugriffskontrolle

### Auto-Owner-Modus (Standard)

Wenn `ALLOWED_CHAT_IDS` nicht gesetzt ist, gilt der **Auto-Owner-Mechanismus**:

1. Erster Kontakt: Jede Chat-ID darf durch (Setup-Phase)
2. Beim ersten Schreiben wird die Chat-ID in `.chat_id` gespeichert
3. Ab diesem Zeitpunkt werden **alle anderen Chat-IDs** stillschweigend ignoriert

```
Erste Nachricht → erlaubt → Chat-ID wird gespeichert
Zweite Nachricht (gleiche ID) → erlaubt (Owner)
Nachricht fremder ID → wird ignoriert (kein Reply, kein Fehler)
```

### Explizite Whitelist (ALLOWED_CHAT_IDS)

Für mehrere Nutzer oder erhöhte Sicherheit:

```bash
# .env
ALLOWED_CHAT_IDS=123456789,987654321
```

Die Middleware in `bot.ts` prüft **vor allen Commands** ob die eingehende Chat-ID erlaubt ist.

```
ALLOWED_CHAT_IDS gesetzt? → prüfe ob ID in der Liste → sonst ignorieren
ALLOWED_CHAT_IDS leer?    → prüfe .chat_id-Datei    → Auto-Owner-Logik
```

Eigene Chat-ID herausfinden: `/whoami` im Bot.

::: tip
Das `/whoami`-Command zeigt Chat-ID, Telegram-Username und Anzeigename — praktisch für die Ersteinrichtung.
:::

### Heartbeat-Targeting

Der Heartbeat sendet proaktive Nachrichten immer an die **gespeicherte Owner-Chat-ID** — unabhängig von `ALLOWED_CHAT_IDS`.

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
Der Agent kann **ausschließlich** die oben genannten `.md`-Dateien bearbeiten. Quellcode, `.env`, Systemdateien und beliebige Pfade sind nicht erreichbar.
:::

### Geschützte Agenten (PROTECTED_AGENTS)

Der `Main`-Agent ist als geschützt markiert und kann nicht gelöscht werden:

| Aktion | Main-Agent | Andere Agenten |
|---|---|---|
| Erstellen | Automatisch beim Setup | Via `agent_erstellen` |
| Dateien lesen | Erlaubt | Erlaubt |
| Dateien schreiben | Nur Whitelist | Nur Whitelist |
| Löschen | **Blockiert** | Erlaubt |

## Datei-Upload-Sicherheit

### MIME/Endungs-Whitelist

Uploads via Telegram und Web-API werden gegen eine Whitelist erlaubter Dateiendungen geprüft:

```
pdf, docx, doc, xlsx, xls, csv, txt, md
png, jpg, jpeg, gif, webp
zip, json, xml
```

Nicht erlaubte Endungen werden **vor dem Download** abgelehnt (kein unnötiger Traffic).

### Größenlimit

```bash
MAX_UPLOAD_MB=50   # Standard: 50 MB
```

Das Limit wird **vor dem Download** von Telegram geprüft (`file_size`-Feld).

## Path-Traversal-Schutz

Alle Dateioperationen sind gegen Path-Traversal-Angriffe geschützt.

### Workspace-Schutz (`safePath`)

```typescript
// src/workspace/helpers.ts
function safePath(relativePath: string): string | null {
  const resolved = path.resolve(workspacePath, relativePath);
  // Korrekte Prüfung mit Separator-Suffix — verhindert /vault-backup als /vault-Bypass
  if (!resolved.startsWith(workspacePath + path.sep) && resolved !== workspacePath) return null;
  return resolved;
}
```

::: warning Separator-Check
`startsWith("/vault")` würde auch `/vault-backup` akzeptieren. Die korrekte Prüfung mit `path.sep` schließt diesen Bypass aus.
:::

### Dynamic Tool-Schutz (`safeToolDir`)

```typescript
// src/tools.ts
function safeToolDir(folderName: string): string {
  if (!/^[\w\-]+$/.test(folderName)) throw new Error("Ungültiger Tool-Name");
  const resolved = path.resolve(TOOLS_DIR, folderName);
  if (!resolved.startsWith(path.resolve(TOOLS_DIR) + path.sep)) throw new Error("Path-Traversal erkannt");
  return resolved;
}
```

### searchWorkspace-Schutz

Der `limitTo`-Parameter für die Arbeitsbereichssuche wird auf verdächtige Zeichen geprüft:

```typescript
if (limitTo && /[/\\.]/.test(limitTo)) return [];
```

## SSRF-Schutz (Web-Abruf)

Das `webseite_lesen`-Tool schützt gegen Server-Side Request Forgery:

### Blockierte Hostnamen

| Kategorie | Beispiele |
|---|---|
| Localhost | `localhost`, `127.0.0.1`, `0.0.0.0` |
| Private IPv4 | `10.*`, `192.168.*`, `172.16–31.*`, `169.254.*` |
| Dezimal-IPs | `2130706433` (= 127.0.0.1) |
| IPv6 privat | `::1`, `fd00::`, `fc00::`, `fe80::`, `::ffff:` |
| lokale Domains | `*.local`, `*.internal` |

## Rate Limiting

### Login-Endpoint

```
Max. Versuche:  5 pro IP-Adresse
Zeitfenster:    15 Minuten
HTTP-Antwort:   429 Too Many Requests
Reset:          Bei erfolgreichem Login
```

### Chat-Endpoint

```
Max. Anfragen:  30 pro Minute pro User
Zeitfenster:    60 Sekunden
HTTP-Antwort:   SSE-Error-Event
```

## Security Headers

Die Web-API sendet automatisch Security-Header via `hono/secure-headers`:

| Header | Zweck |
|---|---|
| `X-Frame-Options` | Clickjacking-Schutz |
| `X-Content-Type-Options` | MIME-Sniffing deaktivieren |
| `Content-Security-Policy` | XSS-Reduktion |
| `Referrer-Policy` | Referrer-Leaks minimieren |

## MCP-Server-Isolation

Der integrierte MCP Filesystem-Server ist **standardmäßig deaktiviert** (`enabled: false` in `mcp.json`). Wenn aktiviert, sollte der Scope auf den Workspace beschränkt werden:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/pfad/zum/vault"],
      "enabled": false
    }
  }
}
```

::: danger
Niemals `.` als Scope setzen — das gibt dem MCP-Server Zugriff auf `.env`, `data/users.json` und den Quellcode.
:::

## Sicherheits-Checkliste

| Prüfpunkt | Status |
|---|---|
| Telegram-Zugriffskontrolle (Auto-Owner + ALLOWED_CHAT_IDS) | ✅ Implementiert |
| Session-Queue (Race-Condition-Schutz) | ✅ Implementiert |
| Agent-Datei-Whitelist | ✅ Implementiert |
| PROTECTED_AGENTS | ✅ Implementiert |
| Rate Limiting — Login-API | ✅ Implementiert |
| Rate Limiting — Chat-API | ✅ Implementiert |
| Security Headers (hono/secure-headers) | ✅ Implementiert |
| Path-Traversal-Schutz (Workspace + Tools + Search) | ✅ Implementiert |
| SSRF-Schutz (inkl. IPv6 + Dezimal-IPs) | ✅ Implementiert |
| MIME/Endungs-Whitelist (Upload) | ✅ Implementiert |
| Datei-Größenlimit (Upload) | ✅ Implementiert |
| Passwort-Mindestlänge (12 Zeichen) | ✅ Implementiert |
| Sandbox-Härtung (kein fetch, gefilterte Env-Vars) | ✅ Implementiert |
| JSON.parse Error-Handling | ✅ Implementiert |
| Graceful Shutdown (SIGTERM/SIGINT) | ✅ Implementiert |
| MCP-Cleanup bei Shutdown | ✅ Implementiert |
| MCP Filesystem deaktiviert (enabled: false) | ✅ Implementiert |
| CORS konfigurierbar | ✅ Implementiert |
| Rollenbasierte Zugriffskontrolle (Admin/User) | Geplant |
| Telegram-Gruppen-Modus | Geplant |
| Audit-Log | Geplant |
