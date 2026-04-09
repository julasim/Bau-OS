# Monitoring

Bau-OS überwachen: Logs, Health-Checks und Systemstatus.

## Bot-Logs via journalctl

Die wichtigste Anlaufstelle für Logs:

```bash
# Live-Logs
sudo journalctl -u bau-os -f

# Letzte 100 Zeilen
sudo journalctl -u bau-os -n 100

# Logs seit heute
sudo journalctl -u bau-os --since today

# Logs der letzten Stunde
sudo journalctl -u bau-os --since "1 hour ago"

# Nur Fehler
sudo journalctl -u bau-os -p err

# Logs zwischen zwei Zeitpunkten
sudo journalctl -u bau-os --since "2026-04-07 08:00" --until "2026-04-07 12:00"
```

## /logs Befehl in Telegram

Bau-OS hat einen eingebauten `/logs`-Befehl für Administratoren:

```
/logs        → Zeigt die letzten Log-Einträge
```

::: tip Direkt im Chat
Du brauchst keinen SSH-Zugang für einen schnellen Blick auf die Logs. Schreibe einfach `/logs` an den Bot.
:::

## bot.log Datei

Bau-OS schreibt zusätzlich eine `bot.log` Datei:

```bash
cat /home/bauos/bau-os/bot.log
```

::: warning Auto-Trimming
Die `bot.log` Datei wird automatisch auf **maximal 500 Zeilen** gekürzt. Ältere Einträge werden entfernt. Für vollständige Logs nutze `journalctl`.
:::

## Ollama-Status prüfen

```bash
# Service-Status
sudo systemctl status ollama

# API erreichbar?
curl -s http://localhost:11434/v1/models | head -20

# Welche Modelle sind geladen?
ollama list

# Ollama-Logs
sudo journalctl -u ollama -n 50
```

## Systemressourcen

### RAM-Verbrauch

```bash
free -h
```

::: warning Kritische Schwelle
Wenn der freie RAM unter 200 MB fällt, wird Ollama langsam oder stürzt ab. Prüfe regelmäßig:
```bash
free -h | grep Mem
```
:::

### Festplattenplatz

```bash
df -h /

# Größe des Vaults
du -sh /home/bauos/vault

# Größe der Backups
du -sh /home/bauos/backups

# Größe der Ollama-Modelle
du -sh /usr/share/ollama/.ollama/models
```

### CPU und Prozesse

```bash
# Bau-OS Prozess finden
ps aux | grep "node dist/index.js"

# Systemlast
uptime

# Top-Prozesse
top -b -n 1 | head -20
```

## Health-Check-Skript

Erstelle ein Skript für einen schnellen Gesundheitscheck:

```bash
nano /home/bauos/health-check.sh
```

Inhalt:

```bash
#!/bin/bash

echo "=== Bau-OS Health Check ==="
echo "Datum: $(date)"
echo ""

# 1. Bot-Service
echo -n "Bot-Service:     "
if systemctl is-active --quiet bau-os; then
    echo "OK (läuft)"
else
    echo "FEHLER (gestoppt!)"
fi

# 2. Ollama-Service
echo -n "Ollama-Service:  "
if systemctl is-active --quiet ollama; then
    echo "OK (läuft)"
else
    echo "FEHLER (gestoppt!)"
fi

# 3. Ollama API
echo -n "Ollama-API:      "
if curl -s http://localhost:11434/v1/models > /dev/null 2>&1; then
    echo "OK (erreichbar)"
else
    echo "FEHLER (nicht erreichbar!)"
fi

# 4. RAM
echo -n "RAM verfügbar:  "
FREE_MB=$(free -m | awk '/Mem:/ {print $7}')
if [ "$FREE_MB" -gt 500 ]; then
    echo "OK (${FREE_MB} MB frei)"
elif [ "$FREE_MB" -gt 200 ]; then
    echo "WARNUNG (${FREE_MB} MB frei)"
else
    echo "KRITISCH (${FREE_MB} MB frei!)"
fi

# 5. Festplatte
echo -n "Festplatte:      "
DISK_PERCENT=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK_PERCENT" -lt 80 ]; then
    echo "OK (${DISK_PERCENT}% belegt)"
elif [ "$DISK_PERCENT" -lt 90 ]; then
    echo "WARNUNG (${DISK_PERCENT}% belegt)"
else
    echo "KRITISCH (${DISK_PERCENT}% belegt!)"
fi

# 6. Vault vorhanden
echo -n "Vault:           "
if [ -d "/home/bauos/vault/Agents/Main" ]; then
    echo "OK (vorhanden)"
else
    echo "FEHLER (nicht gefunden!)"
fi

echo ""
echo "=== Ende ==="
```

```bash
chmod +x /home/bauos/health-check.sh
./health-check.sh
```

Erwartete Ausgabe:

```
=== Bau-OS Health Check ===
Datum: Mon Apr  7 10:30:00 CEST 2026

Bot-Service:     OK (läuft)
Ollama-Service:  OK (läuft)
Ollama-API:      OK (erreichbar)
RAM verfügbar:  OK (2048 MB frei)
Festplatte:      OK (35% belegt)
Vault:           OK (vorhanden)

=== Ende ===
```

## MCP-Server Status

MCP-Server-Verbindungen koennen im Telegram-Chat geprueft werden:

```
Nutze mcp_server_auflisten
```

Oder in den Logs:

```bash
sudo journalctl -u bau-os --since today | grep -i mcp
```

Erwartete Log-Eintraege bei gesundem System:

```
[MCP] filesystem verbunden — 11 Tool(s): read_file, write_file, ...
```

::: tip Graceful Shutdown
Bei `systemctl stop bau-os` werden alle MCP-Server sauber getrennt (`disconnectAll()`). Verwaiste MCP-Prozesse sind damit ausgeschlossen. Pruefen: `ps aux | grep mcp`
:::

## Automatischer Health Check (optional)

Fuege einen stündlichen Check zum Crontab hinzu:

```bash
crontab -e
```

```cron
0 * * * * /home/bauos/health-check.sh >> /home/bauos/health.log 2>&1
```

## Nächster Schritt

→ [Troubleshooting](/betrieb/troubleshooting)
