# Installation

Detaillierte Anleitung für die Installation auf einem frischen System.

## Systemanforderungen

| Komponente | Minimum | Empfohlen |
|---|---|---|
| **OS** | Ubuntu 22.04 / macOS / Windows | Ubuntu 24.04 LTS |
| **RAM** | 4 GB | 8 GB (für 7B Modell) |
| **CPU** | 2 Kerne | 4 Kerne |
| **Speicher** | 10 GB frei | 20 GB frei |
| **Node.js** | 20.x | 20.x LTS |

::: warning RAM ist entscheidend (nur Ollama-Modus)
Ollama braucht RAM für das LLM-Modell. Ein 7B-Modell benötigt ca. 4–5 GB RAM. Wenn der Server zu wenig RAM hat, wird das Modell sehr langsam oder stürzt ab. Im OpenAI-Modus entfällt diese Anforderung.
:::

---

## Empfohlener Weg: Automatischer Installer (Produktion)

Für Ubuntu-Server gibt es einen vollautomatischen Installer:

```bash
sudo bash scripts/install.sh
```

Der Installer fragt interaktiv nach:

1. **Telegram Bot Token** — von @BotFather
2. **LLM-Modus** — Cloud (kimi-k2.5, gemma4, qwen3 via Ollama Cloud) oder Lokal (qwen2.5:7b, llama3.1:8b)
3. **Installationsverzeichnis** — Standard: `/opt/bau-os`
4. **Workspace-Verzeichnis** — Standard: `/opt/bau-os-workspace`
5. **Web-Admin Benutzername** — für die Web-Oberfläche
6. **Web-Admin Passwort**
7. **API-Port** — Standard: `3000`

Was der Installer automatisch einrichtet:

- Node.js 20 LTS (via nodesource)
- Ollama + gewähltes Modell
- systemd-Service `bau-os` (autostart bei Reboot)
- CLI-Tool `/usr/local/bin/bau-os`
- Web-Admin-User in `data/users.json`
- `.env` mit allen gesetzten Werten

### CLI nach Installation

```bash
bau-os                   # Interaktives Menü
bau-os status            # Status anzeigen
bau-os logs              # Letzte Logs
bau-os logs live         # Live-Logs (tail -f)
sudo bau-os restart      # Service neu starten
sudo bau-os update       # Update aus Git einspielen
sudo bau-os user add     # Neuen Web-User anlegen
```

---

## Alternative: Docker Compose

Für Umgebungen mit Docker steht ein vollständiger Stack bereit:

```bash
cp .env.example .env
# .env anpassen: BOT_TOKEN, WORKSPACE_PATH, etc.
docker compose up -d
```

Stack-Komponenten:

- **PostgreSQL 16 + pgvector** — Datenbankbackend mit Vektor-Suche
- **Ollama** — lokales LLM (optional; weglassen wenn OpenAI genutzt wird)
- **Bau-OS App** — der Bot + API
- **Caddy** — Reverse Proxy mit automatischem HTTPS

---

## Manuell: Node.js installieren

::: code-group
```bash [Ubuntu/Debian]
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
```

```bash [macOS]
brew install node@20
```

```powershell [Windows]
# Download von https://nodejs.org/
# Oder via winget:
winget install OpenJS.NodeJS.LTS
```
:::

Prüfe die Installation:

```bash
node --version   # v20.x.x
npm --version    # 10.x.x
```

## Manuell: Ollama installieren (nur Ollama-Modus)

::: code-group
```bash [Linux]
curl -fsSL https://ollama.ai/install.sh | sh
```

```bash [macOS]
brew install ollama
```

```powershell [Windows]
# Download von https://ollama.ai/download/windows
```
:::

Modell herunterladen:

```bash
ollama pull qwen2.5:7b
```

Prüfe ob Ollama läuft:

```bash
curl http://localhost:11434/v1/models
```

## Telegram Bot erstellen

1. Öffne Telegram und suche **@BotFather**
2. Schreibe `/newbot`
3. Wähle einen Namen (z.B. "Bau-OS Assistent")
4. Wähle einen Username (z.B. "bauos_assistent_bot")
5. Kopiere den **Bot Token** — du brauchst ihn gleich

::: tip Tipp
Deaktiviere "Group Privacy" mit `/setprivacy` → Disabled, falls der Bot in Gruppen funktionieren soll.
:::

## Manuell: Bau-OS installieren

```bash
git clone <repository-url>
cd bau-os
npm install
```

## Manuell: Setup ausführen

```bash
npm run setup
```

Der interaktive Installer erstellt:
- `.env` Datei mit allen Konfigurationswerten
- Agent-Workspace unter `VAULT_PATH/Agents/Main/` (10 Markdown-Dateien)

## Vault-Struktur

Nach dem Setup sieht der Vault so aus:

```
VAULT_PATH/
├── Agents/
│   └── Main/
│       ├── IDENTITY.md
│       ├── SOUL.md
│       ├── BOOT.md
│       ├── BOOTSTRAP.md    ← wird nach Ersteinrichtung gelöscht
│       ├── AGENTS.md
│       ├── USER.md
│       ├── TOOLS.md
│       ├── MEMORY.md
│       ├── HEARTBEAT.md
│       └── MEMORY_LOGS/
├── Inbox/                  ← hier landen Notizen
├── Aufgaben/               ← hier landen Aufgaben
└── Termine/                ← hier landen Termine
```

## Nächste Schritte

- [Einrichtung](/start/einrichtung) — Setup-Wizard via Telegram starten
- [Betrieb](/betrieb/voraussetzungen) — Für Produktion auf einem Server
