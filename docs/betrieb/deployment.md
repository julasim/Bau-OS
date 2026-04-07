# Deployment

Bau-OS auf den Server bringen, konfigurieren und erstmals starten.

## 1. Repository klonen

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

## 2. Dependencies installieren

```bash
cd /home/bauos/bau-os
npm install
```

## 3. TypeScript kompilieren

```bash
npm run build
```

Das erstellt den `dist/` Ordner mit dem kompilierten JavaScript.

## 4. Setup ausführen

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

## 5. Ergebnis prüfen

### .env Datei

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

### Workspace-Dateien

```bash
ls /home/bauos/vault/Agents/Main/
```

Erwartete Ausgabe:

```
AGENTS.md    BOOT.md       BOOTSTRAP.md  HEARTBEAT.md
IDENTITY.md  MEMORY.md     MEMORY_LOGS/  SOUL.md
TOOLS.md     USER.md
```

## 6. Erststart (manuell)

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

## 7. Verzeichnisstruktur

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

## Nächster Schritt

→ [systemd-Service einrichten](/betrieb/systemd)
