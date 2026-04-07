# Updates

Bau-OS und Ollama-Modelle aktualisieren.

## Bau-OS aktualisieren

### Manuell

```bash
cd /home/bauos/bau-os

# Neuen Code holen
git pull

# Dependencies aktualisieren
npm install

# Neu kompilieren
npm run build

# Service neu starten
sudo systemctl restart bau-os

# Pruefen ob alles laeuft
sudo systemctl status bau-os
```

### Update-Skript

Erstelle ein Skript fuer bequeme Updates:

```bash
nano /home/bauos/update-bau-os.sh
```

Inhalt:

```bash
#!/bin/bash
set -e

APP_DIR="/home/bauos/bau-os"
SERVICE="bau-os"

echo "=== Bau-OS Update ==="
echo ""

cd "$APP_DIR"

echo "1/5 Code aktualisieren..."
git pull

echo "2/5 Dependencies installieren..."
npm install

echo "3/5 TypeScript kompilieren..."
npm run build

echo "4/5 Service neu starten..."
sudo systemctl restart "$SERVICE"

echo "5/5 Status pruefen..."
sleep 2
sudo systemctl status "$SERVICE" --no-pager

echo ""
echo "=== Update abgeschlossen ==="
```

Ausfuehrbar machen:

```bash
chmod +x /home/bauos/update-bau-os.sh
```

Ausfuehren:

```bash
./update-bau-os.sh
```

::: tip Keine Datenverluste
Updates betreffen nur den Anwendungs-Code. Der Vault (alle Daten, Notizen, Agent-Konfiguration) bleibt unberuehrt.
:::

## Ollama-Modell aktualisieren

```bash
# Aktuelles Modell auf neueste Version bringen
ollama pull qwen2.5:7b

# Ollama selbst aktualisieren
curl -fsSL https://ollama.ai/install.sh | sh
```

::: warning Modell-Update = neuer Download
`ollama pull` laedt das Modell neu herunter, wenn eine neuere Version verfuegbar ist. Das kann einige Minuten dauern und verbraucht Bandbreite.
:::

## Wann ist ein frisches Setup noetig?

Ein `npm run setup` ist **nur** noetig, wenn:

- Der Bot zum ersten Mal auf einem Server installiert wird
- Die `.env` Datei verloren gegangen ist
- Der Vault von Grund auf neu erstellt werden soll

::: danger Setup ueberschreibt Agent-Dateien
`npm run setup` erstellt die Agent-Dateien (`IDENTITY.md`, `SOUL.md`, etc.) neu. Wenn du sie bereits angepasst hast, gehen diese Aenderungen verloren. Mache vorher ein Backup:
```bash
cp -r /home/bauos/vault/Agents/Main/ /home/bauos/agents-backup-$(date +%Y%m%d)
```
:::

## Node.js aktualisieren

Falls eine neue Node.js LTS Version erscheint:

```bash
# NodeSource Repository aktualisieren
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# Version pruefen
node --version

# Bau-OS neu bauen
cd /home/bauos/bau-os
npm install
npm run build
sudo systemctl restart bau-os
```

## System-Updates

```bash
sudo apt update && sudo apt upgrade -y
```

::: tip Neustart nach Kernel-Update
Nach einem Kernel-Update ist ein Neustart noetig:
```bash
sudo reboot
```
Bau-OS und Ollama starten dank systemd automatisch wieder.
:::

## Naechster Schritt

→ [Backup-Strategie](/betrieb/backup)
