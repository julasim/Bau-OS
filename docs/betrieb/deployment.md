# Deployment

PATIO auf den Server bringen, konfigurieren und erstmals starten.

## Automatische Installation (empfohlen)

```bash
sudo bash scripts/install.sh
```

Der Installer fragt interaktiv nach:
1. **Telegram Bot Token**
2. **LLM-Modus**: Cloud (kimi-k2.5, qwen3, gemma4) oder Lokal (qwen2.5:7b, llama3.1:8b)
3. **Installationsverzeichnis** (Standard: `/opt/bau-os`)
4. **Workspace-Verzeichnis** (Standard: `/opt/bau-os-workspace`)
5. **Web-Admin Benutzername**
6. **Web-Admin Passwort**
7. **API-Port** (Standard: 3000)

Was automatisch eingerichtet wird:
- Node.js 20 LTS
- Ollama + Modell-Download (im Lokal-Modus)
- systemd-Service `bau-os` (Autostart, Restart bei Fehler)
- CLI-Tool `/usr/local/bin/bau-os`
- `.env` und `data/users.json`

### bau-os CLI

Nach der Installation steht ein interaktives CLI zur Verfügung:

```bash
bau-os              # Interaktives Menü
bau-os status       # Service-Status
bau-os logs         # Letzte Logs
bau-os logs live    # Logs live verfolgen
sudo bau-os restart # Bot neu starten
sudo bau-os update  # Updates einspielen
sudo bau-os user add  # Web-Benutzer anlegen
```

---

## Manuelle Installation

Falls du die Installation Schritt für Schritt selbst durchführen möchtest.

### 1. Repository klonen

```bash
cd /home/bauos
git clone https://github.com/your-org/bau-os.git
cd bau-os
```

::: tip Privates Repository?
Falls das Repo privat ist, nutze SCP statt Git:
```bash
# Auf deinem lokalen Rechner:
scp -r ./bau-os bauos@DEINE_SERVER_IP:/home/bauos/
```
Oder richte einen SSH Deploy Key ein:
```bash
# Auf dem Server:
ssh-keygen -t ed25519 -C "deploy-key"
cat ~/.ssh/id_ed25519.pub
# → Key als Deploy Key im GitHub Repo hinterlegen
```
:::

### 2. Dependencies installieren

```bash
cd /home/bauos/bau-os
npm install
```

### 3. TypeScript kompilieren

```bash
npm run build
```

Das erstellt den `dist/` Ordner mit dem kompilierten JavaScript.

### 4. Setup ausführen

```bash
npm run setup
```

Der interaktive Installer fragt nach:

| Eingabe | Beispielwert | Beschreibung |
|---|---|---|
| **BOT_TOKEN** | `7123456:AAH...` | Telegram Bot Token von @BotFather |
| **VAULT_PATH** | `/home/bauos/vault` | Pfad zum Obsidian Vault (wird erstellt) |
| **OLLAMA_BASE_URL** | `http://localhost:11434/v1` | Ollama API Endpunkt |
| **OLLAMA_MODEL** | `qwen2.5:7b` | Das Modell, das Ollama nutzen soll |

::: warning Vault-Pfad
Verwende einen **absoluten Pfad**. Der Ordner wird automatisch erstellt, falls er nicht existiert.
:::

### 5. Ergebnis prüfen

#### .env Datei

```bash
cat .env
```

Erwartete Ausgabe:

```env
BOT_TOKEN=7123456:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VAULT_PATH=/home/bauos/vault
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=qwen2.5:7b
```

#### Workspace-Dateien

```bash
ls /home/bauos/vault/Agents/Main/
```

Erwartete Ausgabe:

```
AGENTS.md    BOOT.md       BOOTSTRAP.md  HEARTBEAT.md
IDENTITY.md  MEMORY.md     Logs/         SOUL.md
TOOLS.md     USER.md
```

### 6. Erststart (manuell)

```bash
npm start
```

Der Bot sollte starten und du siehst:

```
[INFO] Bot gestartet
[INFO] Ollama verbunden: qwen2.5:7b
```

Öffne jetzt Telegram und schreibe dem Bot eine Nachricht. Wenn er antwortet, funktioniert alles.

::: tip Ersteinrichtung via Telegram
Beim ersten Start führt der Bot dich durch die Ersteinrichtung (Bootstrap). Beantworte die Fragen — danach loescht der Bot die `BOOTSTRAP.md` und ist betriebsbereit.
:::

Stoppe den Bot mit `Ctrl+C`.

### 7. Verzeichnisstruktur

Nach dem erfolgreichen Start sieht die Struktur so aus:

```
/home/bauos/
├── bau-os/              ← Anwendungs-Code
│   ├── dist/            ← Kompilierter Code
│   ├── src/             ← TypeScript Quellcode
│   ├── .env             ← Konfiguration
│   └── package.json
└── vault/               ← Alle Daten (Obsidian Vault)
    ├── Agents/Main/     ← Agent-Konfiguration
    ├── Inbox/           ← Notizen
    ├── Aufgaben/        ← Aufgaben
    └── Termine/         ← Termine
```

::: danger .env niemals committen
Die `.env` Datei enthaelt den Bot Token. Sie darf **niemals** in ein Git-Repository gelangen. Sie steht bereits in `.gitignore`.
:::

## Docker Compose (Alternative)

Statt des systemd-Installers kann der vollständige Stack auch via Docker Compose gestartet werden. Das umfasst PostgreSQL 16 (pgvector), Ollama und die PATIO App.

```bash
# .env anpassen (BOT_TOKEN, WORKSPACE_PATH, etc.)
cp .env.example .env
nano .env

# Stack starten
docker compose up -d

# Logs verfolgen
docker compose logs -f

# Update einspielen
git pull && docker compose pull && docker compose build app && docker compose up -d
```

::: tip TLS / HTTPS
Docker Compose stellt keinen eigenen HTTPS-Proxy bereit. Für Produktivbetrieb mit TLS einen externen Edge-Caddy (`/opt/proxy`) oder einen eigenen Reverse-Proxy vorschalten — siehe Kommentar im `docker-compose.yml`.
:::

## Nächster Schritt

→ [systemd-Service einrichten](/betrieb/systemd)
