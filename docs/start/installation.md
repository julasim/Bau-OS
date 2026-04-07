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

::: warning RAM ist entscheidend
Ollama braucht RAM für das LLM-Modell. Ein 7B-Modell benötigt ca. 4-5 GB RAM. Wenn der Server zu wenig RAM hat, wird das Modell sehr langsam oder stürzt ab.
:::

## Node.js installieren

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

## Ollama installieren

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

## Bau-OS installieren

```bash
git clone https://github.com/your-repo/bau-os.git
cd bau-os
npm install
```

## Setup ausführen

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
