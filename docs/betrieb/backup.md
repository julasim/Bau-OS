# Backup

Sicherungsstrategie für Bau-OS. Das Wichtigste: **der Vault ist alles**.

## Was muss gesichert werden?

| Was | Pfad | Priorität | Inhalt |
|---|---|---|---|
| **Vault** | `/home/bauos/vault/` | Kritisch | Alle Daten: Notizen, Aufgaben, Termine, Agent-Config, Memory |
| **.env** | `/home/bauos/bau-os/.env` | Hoch | Bot Token, Pfade, Modell-Konfiguration |
| **Code** | `/home/bauos/bau-os/` | Niedrig | Kann jederzeit neu geklont werden |

::: tip Der Vault ist die einzige Wahrheit
Alle Daten liegen als Markdown-Dateien im Vault. Agent-Persönlichkeit, Erinnerungen, Aufgaben, Notizen — alles ist dort. Wenn du den Vault hast, kannst du Bau-OS jederzeit auf einem neuen Server wiederherstellen.
:::

## Manuelles Backup

### Vault kopieren

```bash
# Lokales Backup auf dem Server
cp -r /home/bauos/vault /home/bauos/vault-backup-$(date +%Y%m%d)

# Oder per SCP auf deinen Rechner
scp -r bauos@DEINE_SERVER_IP:/home/bauos/vault ./vault-backup-$(date +%Y%m%d)
```

### .env sichern

```bash
scp bauos@DEINE_SERVER_IP:/home/bauos/bau-os/.env ./env-backup-$(date +%Y%m%d)
```

## Automatisches Backup (Cron)

Erstelle ein Backup-Skript:

```bash
nano /home/bauos/backup.sh
```

Inhalt:

```bash
#!/bin/bash
set -e

VAULT_PATH="/home/bauos/vault"
BACKUP_DIR="/home/bauos/backups"
ENV_FILE="/home/bauos/bau-os/.env"
KEEP_DAYS=14

# Backup-Verzeichnis erstellen
mkdir -p "$BACKUP_DIR"

# Datum für Dateinamen
DATE=$(date +%Y%m%d_%H%M)

# Vault komprimieren
tar -czf "$BACKUP_DIR/vault-$DATE.tar.gz" -C "$(dirname $VAULT_PATH)" "$(basename $VAULT_PATH)"

# .env sichern
cp "$ENV_FILE" "$BACKUP_DIR/env-$DATE.bak"

# Alte Backups löschen (älter als KEEP_DAYS Tage)
find "$BACKUP_DIR" -name "vault-*.tar.gz" -mtime +$KEEP_DAYS -delete
find "$BACKUP_DIR" -name "env-*.bak" -mtime +$KEEP_DAYS -delete

echo "[$(date)] Backup erstellt: vault-$DATE.tar.gz"
```

Ausführbar machen:

```bash
chmod +x /home/bauos/backup.sh
```

### Cronjob einrichten

```bash
crontab -e
```

Fuege diese Zeile hinzu (täglich um 3:00 Uhr):

```cron
0 3 * * * /home/bauos/backup.sh >> /home/bauos/backups/backup.log 2>&1
```

Prüfen ob der Cronjob eingerichtet ist:

```bash
crontab -l
```

## Hetzner Snapshots

Hetzner bietet Server-Snapshots als zusätzliche Sicherung:

1. Öffne [console.hetzner.cloud](https://console.hetzner.cloud)
2. Wähle deinen Server
3. Tab **"Snapshots"** → **"Snapshot erstellen"**

::: tip Kosten
Snapshots kosten bei Hetzner 0,0119 EUR/GB/Monat. Ein 20 GB Snapshot kostet ca. 0,24 EUR/Monat.
:::

::: warning Snapshots ersetzen kein Backup
Snapshots sichern den gesamten Server-Zustand. Für regelmäßige Datensicherung nutze das Backup-Skript. Snapshots sind gut vor größeren Änderungen (z.B. OS-Upgrade).
:::

## Wiederherstellung

### Vault aus Backup wiederherstellen

```bash
# Aktuellen Vault sichern (zur Sicherheit)
mv /home/bauos/vault /home/bauos/vault-old

# Backup entpacken
tar -xzf /home/bauos/backups/vault-20260407_0300.tar.gz -C /home/bauos/

# Bot neu starten
sudo systemctl restart bau-os
```

### .env wiederherstellen

```bash
cp /home/bauos/backups/env-20260407_0300.bak /home/bauos/bau-os/.env
sudo systemctl restart bau-os
```

### Komplette Neuinstallation aus Backup

1. Neuen Server erstellen ([Anleitung](/betrieb/server))
2. Software installieren ([Anleitung](/betrieb/software))
3. Bau-OS klonen und bauen ([Anleitung](/betrieb/deployment))
4. `.env` aus Backup kopieren
5. Vault aus Backup entpacken
6. Service starten

```bash
# Auf dem neuen Server:
scp dein-rechner:vault-backup.tar.gz /home/bauos/
tar -xzf vault-backup.tar.gz -C /home/bauos/
scp dein-rechner:env-backup.bak /home/bauos/bau-os/.env
sudo systemctl start bau-os
```

## Backup-Checkliste

- [ ] Backup-Skript unter `/home/bauos/backup.sh` erstellt
- [ ] Cronjob eingerichtet (täglich)
- [ ] Erster Testlauf erfolgreich (`./backup.sh`)
- [ ] `.env` separat gesichert
- [ ] Hetzner Snapshot vor größeren Änderungen

## Nächster Schritt

→ [Monitoring](/betrieb/monitoring)
