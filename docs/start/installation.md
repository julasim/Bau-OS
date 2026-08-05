# Installation

Anleitung für eine Installation von Grund auf. Für den Betrieb im Büro
führt der Weg über die [Betriebs-Kapitel](/betrieb/voraussetzungen) — diese
Seite fasst die Möglichkeiten zusammen und ordnet sie ein.

## Systemanforderungen

| Komponente | Minimum | Empfohlen |
|---|---|---|
| **Betriebssystem** | Ubuntu 22.04 / macOS / Windows | Ubuntu 24.04 LTS |
| **CPU** | 2 Kerne | 4 Kerne |
| **RAM** | 4 GB | 8 GB |
| **Speicher** | 20 GB frei | 256 GB SSD (Produktivbetrieb) |
| **Node.js** | 20.x | 24.x LTS |
| **PostgreSQL** | 16 | 16 |

::: tip Bescheidene Anforderungen
PATIO ist ein Node-Prozess neben einer Datenbank. Es läuft kein Sprachmodell
mit — die frühere RAM-Anforderung von 8 GB allein für Ollama ist entfallen.
Der begrenzende Faktor ist der Speicherplatz: hochgeladene Dateien liegen in
der Datenbank, und die Backups kommen dazu.
:::

---

## Weg 1 — Docker Compose (empfohlen für den Betrieb)

Zwei Container: die Anwendung und PostgreSQL 16. Ein Reverse-Proxy davor
terminiert TLS.

```bash
git clone https://github.com/julasim/patio.git /opt/patio
cd /opt/patio
cp .env.example .env
nano .env                    # JWT_SECRET, POSTGRES_*, SMTP_*, APP_URL
docker compose build app
docker compose up -d
```

Vollständig: [PATIO deployen](/betrieb/deployment).

::: warning Kein Reverse-Proxy im Stack
`docker-compose.yml` gibt Port 3000 nur containerintern frei. Für HTTPS
gehört ein Proxy davor — entweder ein gemeinsamer Edge-Proxy im externen
Docker-Netz `proxy` oder der Standalone-Aufbau
`docker/docker-compose.standalone.yml` mit eigenem Caddy.
:::

---

## Weg 2 — Automatischer Installer (Bare Metal)

Für Ubuntu-Server:

```bash
sudo bash scripts/install.sh
```

Der Installer richtet ein:

- Node.js 24 LTS
- PostgreSQL samt Rolle, Datenbank und Extensions
- den PATIO-Build (Backend und Frontend)
- den Dienst-Benutzer und die Verzeichnisse
- die `.env` mit erzeugten Secrets
- die systemd-Unit `patio` mit Autostart
- das CLI-Werkzeug `/usr/local/bin/patio`

Abgefragt werden Installations- und Workspace-Verzeichnis, Benutzername und
Passwort des ersten Admin-Kontos sowie der Port.

### Das CLI danach

```bash
patio                   # interaktives Menü
patio status            # Status anzeigen
patio logs              # letzte Logs
sudo patio restart      # Dienst neu starten
sudo patio update       # Update aus Git einspielen
sudo patio user add     # Benutzer anlegen
```

---

## Weg 3 — Manuell

### Node.js

::: code-group
```bash [Ubuntu/Debian]
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt-get install -y nodejs
```

```bash [macOS]
brew install node@24
```

```powershell [Windows]
winget install OpenJS.NodeJS.LTS
```
:::

```bash
node --version
npm --version
```

### PostgreSQL

::: code-group
```bash [Ubuntu/Debian]
sudo apt-get install -y postgresql-16
sudo -u postgres createuser patio --pwprompt
sudo -u postgres createdb -O patio patio
```

```bash [Docker]
docker run -d --name patio-db \
  -e POSTGRES_USER=patio -e POSTGRES_PASSWORD=patio -e POSTGRES_DB=patio \
  -p 5432:5432 postgres:16
```
:::

Die Extensions `uuid-ossp`, `pg_trgm` und `unaccent` legt Migration `001`
selbst an.

### Build-Werkzeuge

Unter Linux für die nativen Module (`bcrypt`, `pdf-parse`):

```bash
sudo apt-get install -y build-essential
```

### PATIO

```bash
git clone https://github.com/julasim/patio.git
cd patio
npm ci
npm run setup          # fragt WORKSPACE_PATH, DATABASE_URL, JWT_SECRET ab
npm run build:all
npm start
```

Die Migrationen laufen beim ersten Start mit.

---

## Nach der Installation

Beim ersten Aufruf im Browser zeigt PATIO den Setup-Assistenten und legt das
erste Admin-Konto an — sofern der Installer das nicht schon getan hat.

::: warning Ohne E-Mail-Versand keine Anmeldung
Der Login verlangt einen Code per E-Mail. `SMTP_HOST` und die zugehörigen
Werte müssen gesetzt und der Mailserver erreichbar sein.
:::

## Nächste Schritte

- [Einrichtung](/start/einrichtung) — Konten, Branding, Team, Projekte
- [Betrieb](/betrieb/voraussetzungen) — Produktivbetrieb im Büro
- [Umgebungsvariablen](/konfiguration/env) — alles, was in die `.env` gehört
