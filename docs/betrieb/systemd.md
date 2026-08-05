# systemd-Service

Für die Bare-Metal-Installation. Beim Docker-Compose-Aufbau übernimmt
`restart: always` in der Compose-Datei diese Aufgabe — dann ist diese Seite
nicht einschlägig.

## Service-Datei

Das Repository bringt eine fertige Unit mit: `patio.service` im Repo-Root.
Der Installer `scripts/install.sh` legt sie mit angepassten Pfaden ab.
Manuell:

```bash
sudo cp /opt/patio/patio.service /etc/systemd/system/patio.service
sudo nano /etc/systemd/system/patio.service   # Pfade prüfen
```

Der Inhalt im Wesentlichen:

```ini
[Unit]
Description=PATIO — Web-API und Weboberflaeche
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=patio
WorkingDirectory=/opt/patio
EnvironmentFile=/opt/patio/.env
Environment=LANG=de_AT.UTF-8 LC_ALL=de_AT.UTF-8
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=patio

MemoryMax=512M
MemoryHigh=384M
CPUQuota=100%
TasksMax=64

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/opt/patio/logs /opt/patio-workspace /opt/patio/data /opt/patio/tools
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
```

::: tip Abhängigkeit von PostgreSQL
`After=postgresql.service` sorgt dafür, dass die Datenbank zuerst startet.
Das ist keine Kosmetik: PATIO bricht mit Exit-Code 1 ab, wenn die Datenbank
beim Start nicht antwortet. `Restart=always` fängt das ab — beim
Systemstart würde der Dienst sonst dauerhaft ausfallen, nur weil er ein paar
Sekunden zu früh dran war.
:::

::: warning ProtectSystem=strict und ReadWritePaths
Das Dateisystem ist bis auf die aufgeführten Pfade schreibgeschützt. Wird
`WORKSPACE_PATH` auf ein anderes Verzeichnis gelegt, muss es in
`ReadWritePaths` ergänzt werden — sonst schlagen alle Uploads mit `EACCES`
fehl. Die API übersetzt das in einen HTTP-403; im Log steht `Kein
Dateizugriff`.
:::

## Aktivieren und starten

```bash
sudo systemctl daemon-reload
sudo systemctl enable patio
sudo systemctl start patio
```

## Befehle

| Befehl | Wirkung |
|---|---|
| `sudo systemctl start patio` | starten |
| `sudo systemctl stop patio` | stoppen |
| `sudo systemctl restart patio` | neu starten (liest die `.env` neu ein) |
| `sudo systemctl status patio` | Status anzeigen |
| `sudo systemctl enable patio` | Autostart einschalten |
| `sudo systemctl disable patio` | Autostart ausschalten |

## Logs

```bash
sudo journalctl -u patio -f              # live
sudo journalctl -u patio -n 100          # letzte 100 Zeilen
sudo journalctl -u patio --since today   # seit heute
sudo journalctl -u patio -p err          # nur Fehler
```

PATIO schreibt zusätzlich in `logs/patio.log` (gekürzt, für den schnellen
Blick) und `logs/patio.jsonl` (vollständig, maschinenlesbar, rotierend).

## Sauberes Herunterfahren

Auf `SIGTERM` und `SIGINT` schließt PATIO die Datenbankverbindung und
beendet sich mit Code 0. `systemctl stop` und `systemctl restart` sind damit
unkritisch.

Unbehandelte Exceptions und Promise-Rejections werden mit Stack ins Log
geschrieben; danach beendet sich der Prozess bewusst, statt in einem
undefinierten Zustand weiterzulaufen. `Restart=always` fährt ihn wieder
hoch — häufen sich solche Neustarts im Journal, ist das ein echter Befund
und kein Rauschen.

## Nach einer .env-Änderung

```bash
sudo systemctl restart patio
```

`daemon-reload` ist nur nötig, wenn die `.service`-Datei selbst geändert
wurde.

## Nächster Schritt

→ [Updates](/betrieb/updates)
