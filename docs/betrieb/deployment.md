# PATIO deployen

Die Anwendung auf den Rechner bringen, konfigurieren und erstmals starten.

---

## Docker Compose

### 1. Repository holen

```bash
sudo -u patio git clone https://github.com/julasim/patio.git /opt/patio
cd /opt/patio
```

### 2. .env anlegen

```bash
cp .env.example .env
nano .env
```

Erforderlich:

```bash
WORKSPACE_PATH=/workspace          # Pfad IM Container, nicht auf dem Host
JWT_SECRET=<openssl rand -base64 48>
ENCRYPTION_KEY=<openssl rand -base64 48>
NODE_ENV=production

POSTGRES_USER=patio
POSTGRES_PASSWORD=<starkes Passwort>
POSTGRES_DB=patio

WORKSPACE_HOST_DIR=/opt/patio-workspace

SMTP_HOST=mail.firma.intern
SMTP_PORT=587
SMTP_USER=patio@firma.intern
SMTP_PASS=<Passwort>
SMTP_FROM=PATIO <patio@firma.intern>

APP_URL=https://patio.firma.intern
```

::: warning DATABASE_URL nicht selbst setzen
`docker-compose.yml` baut sie aus `POSTGRES_USER`, `POSTGRES_PASSWORD` und
`POSTGRES_DB` zusammen und richtet sie auf den Container `postgres`. Der
Wert im `environment:`-Block überschreibt alles, was in der `.env` steht.
Gleiches gilt für `WORKSPACE_PATH`, das im Container fest auf `/workspace`
zeigt — der Host-Pfad kommt über `WORKSPACE_HOST_DIR`.
:::

::: danger .env niemals committen
Sie enthält `JWT_SECRET`, `ENCRYPTION_KEY` und das Datenbank-Passwort und
steht bereits in `.gitignore`.
:::

### 3. Proxy-Netz sicherstellen

Nur beim Aufbau mit gemeinsamem Edge-Proxy:

```bash
docker network create proxy   # falls noch nicht vorhanden
```

### 4. Bauen und starten

```bash
docker compose build app
docker compose up -d
docker compose ps
```

Erwartet: beide Container laufen, `postgres` meldet `healthy`.

### 5. Start prüfen

```bash
docker compose logs -f app
```

Erwartete Zeilen:

```
[DB] PostgreSQL verbunden
[API] Web-Server gestartet auf http://0.0.0.0:3000
PATIO gestartet
```

Bricht der Start ab, sagt die Meldung warum — die Pflicht-Prüfungen sind
bewusst redselig:

| Meldung | Ursache |
|---|---|
| `WORKSPACE_PATH fehlt in .env` | Dokumentenverzeichnis nicht gesetzt |
| `DATABASE_URL fehlt in .env` | Datenbank nicht konfiguriert |
| `die Datenbank antwortet nicht` | Postgres nicht erreichbar oder Zugangsdaten falsch |
| `JWT_SECRET fehlt in .env` | Kein Secret gesetzt |
| `JWT_SECRET zu kurz` | Unter 32 Zeichen, bei `NODE_ENV=production` fatal |

### 6. Erreichbarkeit prüfen

```bash
docker compose exec app curl -s localhost:3000/api/health
```

Antwort: `{"ok":true,"uptime":…,"db":true}`.

Danach von einem Arbeitsplatz aus die konfigurierte Adresse aufrufen und den
[Setup-Assistenten](/start/einrichtung) durchlaufen.

---

## Bare Metal

### 1. Repository holen und bauen

```bash
sudo -u patio git clone https://github.com/julasim/patio.git /opt/patio
cd /opt/patio
npm ci
npm run build:all
```

`build:all` baut das Backend nach `dist/` und das Frontend nach `dist/web`,
von wo die API es ausliefert.

### 2. Konfiguration

```bash
npm run setup
```

Das Skript fragt `WORKSPACE_PATH`, `DATABASE_URL` und `JWT_SECRET` ab und
schreibt sie in die `.env`. Alles Weitere (SMTP, `APP_URL`,
`ENCRYPTION_KEY`, `NODE_ENV`) danach von Hand ergänzen — siehe
[Umgebungsvariablen](/konfiguration/env).

### 3. Erststart von Hand

```bash
npm start
```

Beim ersten Start wendet PATIO die Migrationen an (`DB_AUTO_MIGRATE`,
standardmäßig an). Läuft alles, mit `Ctrl+C` beenden und den Dienst als
systemd-Unit einrichten.

### 4. Verzeichnisstruktur

```
/opt/patio/                 Anwendung
├── dist/                   gebautes Backend
│   └── web/                gebautes Frontend
├── src/                    Quellcode
├── .env                    Konfiguration
├── data/                   Alt-Konten (users.json)
└── logs/                   Text- und JSONL-Log

/opt/patio-workspace/       hochgeladene Dokumente (WORKSPACE_PATH)
/opt/patio-backups/         Tagesbackups
```

---

## Update

**Docker Compose:**

```bash
cd /opt/patio && git pull && docker compose build app && docker compose up -d app
```

**Bare Metal:**

```bash
cd /opt/patio && git pull && npm ci && npm run build:all && sudo systemctl restart patio
```

::: warning Nur die .env geändert?
`docker compose restart` liest die `.env` **nicht** neu ein. Es braucht
`docker compose up -d --force-recreate app`. Bei systemd genügt ein
`restart`, weil die Unit die Datei bei jedem Start neu einliest.
:::

Mehr dazu: [Updates](/betrieb/updates).

## Nächster Schritt

→ [Updates](/betrieb/updates)
