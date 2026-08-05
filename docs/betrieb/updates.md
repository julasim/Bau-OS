# Updates

PATIO auf einen neueren Stand bringen.

## Vorher: Backup

Ein Update kann Migrationen mitbringen, und Migrationen sind
**forward-only** — es gibt keinen Rückweg. Vor jedem Update:

```bash
sudo bash /opt/patio/scripts/backup.sh
```

Details: [Backup](/betrieb/backup).

## Docker Compose

```bash
cd /opt/patio
git pull
docker compose build app
docker compose up -d app
docker compose logs -f app
```

Die Migrationen laufen beim Start der Anwendung mit, sofern
`DB_AUTO_MIGRATE` nicht auf `false` steht.

Für den Standardfall gibt es das Skript `scripts/docker-update.sh`, das
dieselben Schritte bündelt.

::: warning Nur die .env geändert?
`docker compose restart` liest die `.env` **nicht** neu ein. Dafür braucht
es:

```bash
docker compose up -d --force-recreate app
```

Prüfen, ob der Wert angekommen ist:

```bash
docker compose exec app sh -c 'echo $APP_URL'
```
:::

## Bare Metal

```bash
cd /opt/patio
git pull
npm ci
npm run build:all
sudo systemctl restart patio
sudo systemctl status patio
```

Oder gebündelt:

```bash
sudo bash /opt/patio/scripts/update.sh
```

::: tip npm ci statt npm install
`npm ci` installiert exakt das, was in `package-lock.json` steht. `npm
install` darf Versionen anheben — auf einem Produktivsystem ist das keine
gute Idee.
:::

## Migrationen kontrolliert fahren

Wer den Zeitpunkt selbst bestimmen will, setzt `DB_AUTO_MIGRATE=false` und
fährt sie explizit:

```bash
npm run db:status     # was ist angewendet, was fehlt
npm run db:migrate    # fehlende anwenden
```

Im Compose-Aufbau:

```bash
docker compose exec app npm run db:status
```

Der Runner hält einen Advisory-Lock, es können also nicht zwei Instanzen
gleichzeitig migrieren. Getrackt wird per Dateiname in `_migrations`, **ohne
Prüfsumme** — eine bereits angewendete Migration nachträglich zu ändern
bleibt folgenlos und ist deshalb zu vermeiden.

## Nach dem Update prüfen

```bash
# Docker
docker compose ps
docker compose exec app curl -s localhost:3000/api/health

# Bare Metal
systemctl is-active patio
curl -s localhost:3000/api/health
```

Dann von einem Arbeitsplatz anmelden und eine Änderung speichern — der
Health-Check sagt nur, dass der Prozess lebt, nicht dass die Anwendung
funktioniert.

## Node.js aktualisieren

Nur bei der Bare-Metal-Installation nötig; im Container gibt das Basisimage
die Version vor.

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt-get install -y nodejs
node --version

cd /opt/patio
npm ci
npm run build:all
sudo systemctl restart patio
```

::: warning Native Module neu bauen
`bcrypt` wird gegen die installierte Node-Version kompiliert. Nach einem
Wechsel der Hauptversion muss `npm ci` durchlaufen, sonst startet der Dienst
mit einem ABI-Fehler nicht.
:::

## System-Updates

```bash
sudo apt update && sudo apt upgrade -y
```

Nach einem Kernel-Update ist ein Neustart fällig:

```bash
sudo reboot
```

PATIO kommt danach von selbst wieder hoch — über systemd beziehungsweise
über `restart: always` in der Compose-Datei.

## Nächster Schritt

→ [Backup](/betrieb/backup)
