# systemd-Service

Bau-OS als systemd-Service einrichten, damit der Bot automatisch startet und bei Abstuerzen neu gestartet wird.

## Service-Datei erstellen

```bash
sudo nano /etc/systemd/system/bau-os.service
```

Folgenden Inhalt einfuegen:

```ini
[Unit]
Description=Bau-OS Telegram Bot
Documentation=https://github.com/your-org/bau-os
After=network.target ollama.service
Wants=ollama.service

[Service]
Type=simple
User=bauos
Group=bauos
WorkingDirectory=/home/bauos/bau-os
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=5

# Umgebungsvariablen aus .env laden
EnvironmentFile=/home/bauos/bau-os/.env

# Sicherheit
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/home/bauos/vault /home/bauos/bau-os

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=bau-os

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
sudo systemctl enable bau-os

# Service jetzt starten
sudo systemctl start bau-os
```

## Wichtige Befehle

| Befehl | Beschreibung |
|---|---|
| `sudo systemctl start bau-os` | Bot starten |
| `sudo systemctl stop bau-os` | Bot stoppen |
| `sudo systemctl restart bau-os` | Bot neu starten |
| `sudo systemctl status bau-os` | Status anzeigen |
| `sudo systemctl enable bau-os` | Autostart aktivieren |
| `sudo systemctl disable bau-os` | Autostart deaktivieren |

### Status prüfen

```bash
sudo systemctl status bau-os
```

Erwartete Ausgabe:

```
● bau-os.service - Bau-OS Telegram Bot
     Loaded: loaded (/etc/systemd/system/bau-os.service; enabled)
     Active: active (running) since ...
   Main PID: 12345 (node)
     Memory: 120.0M
        CPU: 1.234s
     CGroup: /system.slice/bau-os.service
             └─12345 /usr/bin/node dist/index.js
```

## Logs anzeigen

```bash
# Live-Logs (wie tail -f)
sudo journalctl -u bau-os -f

# Letzte 50 Zeilen
sudo journalctl -u bau-os -n 50

# Logs seit heute
sudo journalctl -u bau-os --since today

# Nur Fehler
sudo journalctl -u bau-os -p err
```

::: warning Restart-Limits
Die Konfiguration erlaubt maximal **5 Neustarts in 60 Sekunden**. Wenn der Bot oefter abstuerzt, stoppt systemd den Service. Prüfe dann die Logs:
```bash
sudo journalctl -u bau-os -n 100 --no-pager
```
Und starte manuell nach Fehlerbehebung:
```bash
sudo systemctl reset-failed bau-os
sudo systemctl start bau-os
```
:::

## Graceful Shutdown

Bau-OS faehrt bei `SIGTERM` und `SIGINT` sauber herunter:

1. **Bot stoppen** — Telegram-Polling wird beendet
2. **MCP-Server trennen** — Alle verbundenen MCP-Server-Prozesse werden sauber beendet
3. **Prozess beenden** — `process.exit(0)`

```typescript
// src/index.ts
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

Das bedeutet:
- `systemctl stop bau-os` beendet den Bot sauber (kein Datenverlust)
- `systemctl restart bau-os` startet den Bot sauber neu
- Keine verwaisten MCP-Server-Prozesse nach einem Neustart

::: tip Kein KillSignal noetig
Da der Bot auf SIGTERM reagiert, muss in der Service-Datei kein `KillSignal` oder `TimeoutStopSec` konfiguriert werden. systemd sendet standardmaessig SIGTERM und wartet 90 Sekunden.
:::

## Service nach .env-Änderung neu laden

Wenn du die `.env` Datei änderst, muss der Service neu gestartet werden:

```bash
sudo systemctl restart bau-os
```

::: tip Kein daemon-reload nötig
Bei Änderungen an der `.env` reicht ein `restart`. Nur bei Änderungen an der `.service`-Datei selbst brauchst du vorher `sudo systemctl daemon-reload`.
:::

## Nächster Schritt

→ [Updates durchführen](/betrieb/updates)
