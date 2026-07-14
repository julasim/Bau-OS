# systemd-Service

PATIO als systemd-Service einrichten, damit der Bot automatisch startet und bei Abstuerzen neu gestartet wird.

## Service-Datei erstellen

```bash
sudo nano /etc/systemd/system/patio.service
```

Folgenden Inhalt einfuegen:

```ini
[Unit]
Description=PATIO Telegram Bot
Documentation=https://github.com/your-org/patio
After=network.target ollama.service
Wants=ollama.service

[Service]
Type=simple
User=patio
Group=patio
WorkingDirectory=/home/patio/patio
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=5

# Umgebungsvariablen aus .env laden
EnvironmentFile=/home/patio/patio/.env

# Sicherheit
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/home/patio/vault /home/patio/patio

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=patio

[Install]
WantedBy=multi-user.target
```

::: tip Abhängigkeit von Ollama
`After=ollama.service` stellt sicher, dass Ollama zuerst startet. `Wants=ollama.service` startet Ollama mit, falls es noch nicht läuft.
:::

## Service aktivieren und starten

```bash
# systemd neu laden
sudo systemctl daemon-reload

# Service beim Booten automatisch starten
sudo systemctl enable patio

# Service jetzt starten
sudo systemctl start patio
```

## Wichtige Befehle

| Befehl | Beschreibung |
|---|---|
| `sudo systemctl start patio` | Bot starten |
| `sudo systemctl stop patio` | Bot stoppen |
| `sudo systemctl restart patio` | Bot neu starten |
| `sudo systemctl status patio` | Status anzeigen |
| `sudo systemctl enable patio` | Autostart aktivieren |
| `sudo systemctl disable patio` | Autostart deaktivieren |

### Status prüfen

```bash
sudo systemctl status patio
```

Erwartete Ausgabe:

```
● patio.service - PATIO Telegram Bot
     Loaded: loaded (/etc/systemd/system/patio.service; enabled)
     Active: active (running) since ...
   Main PID: 12345 (node)
     Memory: 120.0M
        CPU: 1.234s
     CGroup: /system.slice/patio.service
             └─12345 /usr/bin/node dist/index.js
```

## Logs anzeigen

```bash
# Live-Logs (wie tail -f)
sudo journalctl -u patio -f

# Letzte 50 Zeilen
sudo journalctl -u patio -n 50

# Logs seit heute
sudo journalctl -u patio --since today

# Nur Fehler
sudo journalctl -u patio -p err
```

::: warning Restart-Limits
Die Konfiguration erlaubt maximal **5 Neustarts in 60 Sekunden**. Wenn der Bot oefter abstuerzt, stoppt systemd den Service. Prüfe dann die Logs:
```bash
sudo journalctl -u patio -n 100 --no-pager
```
Und starte manuell nach Fehlerbehebung:
```bash
sudo systemctl reset-failed patio
sudo systemctl start patio
```
:::

## Graceful Shutdown

PATIO faehrt bei `SIGTERM` und `SIGINT` sauber herunter:

1. **Bot stoppen** — Telegram-Polling wird beendet
2. **MCP-Server trennen** — Alle verbundenen MCP-Server-Prozesse werden sauber beendet
3. **Prozess beenden** — `process.exit(0)`

```typescript
// src/index.ts
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

Das bedeutet:
- `systemctl stop patio` beendet den Bot sauber (kein Datenverlust)
- `systemctl restart patio` startet den Bot sauber neu
- Keine verwaisten MCP-Server-Prozesse nach einem Neustart

::: tip Kein KillSignal noetig
Da der Bot auf SIGTERM reagiert, muss in der Service-Datei kein `KillSignal` oder `TimeoutStopSec` konfiguriert werden. systemd sendet standardmaessig SIGTERM und wartet 90 Sekunden.
:::

## Service nach .env-Änderung neu laden

Wenn du die `.env` Datei änderst, muss der Service neu gestartet werden:

```bash
sudo systemctl restart patio
```

::: tip Kein daemon-reload nötig
Bei Änderungen an der `.env` reicht ein `restart`. Nur bei Änderungen an der `.service`-Datei selbst brauchst du vorher `sudo systemctl daemon-reload`.
:::

## Nächster Schritt

→ [Updates durchführen](/betrieb/updates)
