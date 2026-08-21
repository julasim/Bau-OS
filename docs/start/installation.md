# Installation

Anleitung für eine Installation von Grund auf. Für den Betrieb im Büro
führt der Weg über die [Betriebs-Kapitel](/betrieb/voraussetzungen) — diese
Seite fasst die Möglichkeiten zusammen und ordnet sie ein.

## Systemanforderungen

| Komponente | Minimum | Empfohlen |
|---|---|---|
| **Betriebssystem** | Ubuntu 22.04 / macOS / Windows | Ubuntu 24.04 LTS |
| **CPU** | 2 Kerne | 4 Kerne |
| **RAM** | 8 GB | **16 GB** |
| **Datenträger** | 256 GB SSD | **500 GB NVMe** |
| **Node.js** | **24.x** (`package.json`: `>=24`) | 24.x |
| **PostgreSQL** | 16 | 16 |

::: warning 16 GB sind keine Großzügigkeit, sondern die Auslegung
Der Compose-Stack stellt Postgres ausdrücklich auf 16 GB ein
(`shared_buffers=2GB`, `effective_cache_size=6GB`, `work_mem=32MB`). Wer nach
kleineren Zahlen einkauft, betreibt die Datenbank gegen ihre eigene
Konfiguration.

Dass kein Sprachmodell mehr mitläuft, senkt die Anforderung **nicht** unter
8 GB — der Bedarf sitzt jetzt in der Datenbank. Der begrenzende Faktor bleibt
der Speicherplatz: hochgeladene Dateien liegen in der Datenbank, und die
gestaffelte Sicherung kommt dazu.

Maßgeblich ist die Tabelle unter
[Voraussetzungen](/betrieb/voraussetzungen).
:::

---

## Für den Betrieb im Büro

Auf dem Firmenserver wird **nicht** aus dem Git-Repository installiert und
**nicht** auf der Maschine gebaut — sie hat kein Internet. Das fertige Image
kommt als Paket vom Entwicklungsrechner:

```bash
cd /opt/patio
# Das Installationsskript liegt IM Paket — erst herausholen, dann starten:
sudo tar -xzf patio-<version>.tar.gz ./dabei/scripts/install-server.sh
sudo bash dabei/scripts/install-server.sh patio-<version>.tar.gz
```

::: tip Die erste Zeile gehört dazu
Hier stand nur der zweite Befehl. Der bricht mit „No such file or directory"
ab, weil `dabei/scripts/install-server.sh` vor dem Auspacken nicht existiert.
:::

Vollständige Anleitung mit Sicherungsplatte, Zertifikat und Netzfreigabe:
**[PATIO installieren](/betrieb/installation)**.

::: warning Die früheren Wege sind entfallen
`scripts/install.sh` (Bare Metal), `install-docker.sh`, `install-customer.sh`
und `new-customer.sh` liegen unter `_archive/scripts/saas-aera/`. Sie holten
den Code per `git clone` von GitHub, bauten auf der Maschine und fragten
SMTP-Zugangsdaten ab — jeder dieser Schritte setzt Internet oder abgelöste
Technik voraus.
:::

---

## Für die Entwicklung

Auf dem Entwicklungsrechner, mit Internet:

```bash
git clone https://github.com/julasim/patio.git
cd patio
npm ci
cp .env.example .env
nano .env                    # JWT_SECRET, DATABASE_URL, WORKSPACE_PATH
npm run dev                  # API
npm run dev:web              # Oberfläche
```

Oder als vollständiger Stack:

```bash
docker compose up -d
```

Das schließt Caddy mit der internen Zertifizierungsstelle ein — dieselbe
Konstellation wie auf dem Server.

## Das Verwaltungswerkzeug — nur auf dem Server

::: warning Auf dem Entwicklungsrechner gibt es diesen Befehl nicht
Der Befehl `patio` entsteht erst bei der Installation: `install-server.sh`
legt einen Symlink `/usr/local/bin/patio` auf `scripts/patio-cli.sh`. Er
spricht die Container unter `/opt/patio` an. Dieser Abschnitt stand bisher
unter „Für die Entwicklung" und war dort falsch einsortiert.
:::

```bash
patio status              # Zustand aller Dienste, Sicherung, Erreichbarkeit
patio logs 100            # letzte Protokollzeilen
patio dokumente           # Dokumentenordner, Belegung, Rechte
sudo patio restart
sudo patio update <paket> # Auslieferungspaket einspielen
sudo patio sicherung      # Sicherung jetzt ausführen
```

Benutzer legt der Administrator in der Oberfläche unter `/admin/users` an.

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

Beim ersten Aufruf zeigt PATIO den Setup-Assistenten und legt das
erste Admin-Konto an — sofern der Installer das nicht schon getan hat.

::: tip Kein Mailserver nötig
Die Anmeldung braucht Benutzername und Passwort — kein Code, keine E-Mail,
kein Mailserver.
:::

## Nächste Schritte

- [Einrichtung](/start/einrichtung) — Konten, Branding, Team, Projekte
- [Betrieb](/betrieb/voraussetzungen) — Produktivbetrieb im Büro
- [Umgebungsvariablen](/konfiguration/env) — alles, was in die `.env` gehört
