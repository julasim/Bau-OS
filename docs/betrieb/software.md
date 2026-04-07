# Software installieren

Node.js, Git und Ollama auf dem frischen Ubuntu-Server einrichten.

::: tip Voraussetzung
Du bist als `bauos`-Benutzer per SSH eingeloggt. Falls nicht: `ssh bauos@DEINE_SERVER_IP`
:::

## 1. Node.js 20 LTS

```bash
# NodeSource Repository hinzufuegen
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -

# Node.js installieren
sudo apt-get install -y nodejs
```

Pruefen:

```bash
node --version   # v20.x.x
npm --version    # 10.x.x
```

## 2. Git

```bash
sudo apt-get install -y git
```

```bash
git --version    # git version 2.x.x
```

## 3. Ollama

```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

Ollama wird automatisch als **systemd-Service** installiert und gestartet.

### Modell herunterladen

```bash
ollama pull qwen2.5:7b
```

::: warning Download-Groesse
Das `qwen2.5:7b` Modell ist ca. 4.4 GB gross. Der Download kann je nach Verbindung einige Minuten dauern.
:::

### Ollama pruefen

```bash
# Service-Status
sudo systemctl status ollama

# API erreichbar?
curl http://localhost:11434/v1/models
```

Erwartete Antwort:

```json
{
  "object": "list",
  "data": [
    {
      "id": "qwen2.5:7b",
      "object": "model",
      ...
    }
  ]
}
```

## 4. Build-Werkzeuge (optional)

Falls beim `npm install` native Module kompiliert werden muessen:

```bash
sudo apt-get install -y build-essential
```

## Installierte Software pruefen

Schnellcheck — alles auf einen Blick:

```bash
echo "Node.js: $(node --version)"
echo "npm:     $(npm --version)"
echo "Git:     $(git --version)"
echo "Ollama:  $(ollama --version)"
sudo systemctl is-active ollama
```

::: tip Ollama beim Booten
Ollama startet automatisch beim Server-Start. Du kannst das pruefen mit:
```bash
sudo systemctl is-enabled ollama
```
:::

## Alternative Modelle

| Modell | Groesse | RAM-Bedarf | Hinweis |
|---|---|---|---|
| `qwen2.5:3b` | ~2 GB | ~3 GB | Fuer 4 GB RAM Server |
| `qwen2.5:7b` | ~4.4 GB | ~5 GB | Standard-Empfehlung |
| `qwen2.5:14b` | ~9 GB | ~10 GB | Braucht 16 GB RAM |
| `llama3.1:8b` | ~4.7 GB | ~5.5 GB | Alternative zu Qwen |

```bash
# Anderes Modell herunterladen
ollama pull qwen2.5:3b

# Modelle auflisten
ollama list

# Nicht mehr benoetigtes Modell loeschen
ollama rm qwen2.5:3b
```

## Naechster Schritt

→ [Bau-OS deployen](/betrieb/deployment)
