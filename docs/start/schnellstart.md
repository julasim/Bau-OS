# Schnellstart

PATIO lokal auf dem eigenen Rechner starten — zum Entwickeln oder Ansehen.
Für den Betrieb im Büro siehe [Voraussetzungen](/betrieb/voraussetzungen).

## Voraussetzungen

- **Node.js 20+** — [nodejs.org](https://nodejs.org/)
- **PostgreSQL** — lokal installiert oder als Container

::: warning Ohne Datenbank kein Start
PATIO läuft ausschließlich gegen PostgreSQL. Fehlt `DATABASE_URL` oder
antwortet die Datenbank nicht, bricht der Start mit Exit-Code 1 ab. Einen
Dateisystem-Modus gibt es nicht.
:::

## 1. Datenbank bereitstellen

Am schnellsten als Container:

```bash
docker run -d --name patio-db \
  -e POSTGRES_USER=patio \
  -e POSTGRES_PASSWORD=patio \
  -e POSTGRES_DB=patio \
  -p 5432:5432 \
  postgres:16
```

Wer PostgreSQL schon installiert hat, legt Rolle und Datenbank direkt an:

```bash
sudo -u postgres createuser patio --pwprompt
sudo -u postgres createdb -O patio patio
```

## 2. Projekt einrichten

```bash
git clone https://github.com/julasim/patio.git
cd patio
npm install
```

## 3. Konfiguration anlegen

Entweder interaktiv:

```bash
npm run setup
```

Das Skript fragt nach `WORKSPACE_PATH`, `DATABASE_URL` und `JWT_SECRET` und
schreibt sie in die `.env` — genau die drei Werte, ohne die der Dienst nicht
startet.

Oder von Hand:

```bash
cp .env.example .env
```

Minimale `.env`:

```bash
WORKSPACE_PATH=/pfad/zum/dokumentenordner
DATABASE_URL=postgres://patio:patio@localhost:5432/patio
JWT_SECRET=<openssl rand -base64 48>
```

Vollständige Liste aller Variablen: [Umgebungsvariablen](/konfiguration/env).

## 4. Starten

Zwei Terminals:

```bash
npm run dev        # API auf Port 3000, wendet die Migrationen mit an
npm run dev:web    # Vite-Dev-Server fürs Frontend
```

Der Vite-Dev-Server öffnet die Oberfläche; die API liefert die Daten. Im
Produktionsbau (`npm run build:all`) liefert die API das gebaute Frontend
selbst aus, dann genügt Port 3000.

## 5. Erstes Konto anlegen

Beim ersten Aufruf ist die Benutzertabelle leer. Die Oberfläche zeigt dann
den Setup-Assistenten und legt das erste Admin-Konto an — Benutzername,
Passwort und E-Mail-Adresse.

Sobald ein Konto existiert, ist der Assistent gesperrt (HTTP 410). Weitere
Benutzer legt der Admin über die Benutzerverwaltung an.

::: tip Ein Faktor
Benutzername und Passwort genügen — kein Code, keine Authenticator-App. Das
Passwort braucht mindestens 12 Zeichen, weil es der einzige Faktor ist.
:::

## Nützliche Befehle

```bash
npm run build          # Backend nach dist/
npm run build:all      # Backend + Frontend
npm start              # Produktionsstart aus dist/

npm test               # Vitest
npm run lint           # ESLint
npm run db:migrate     # Migrationen anwenden
npm run db:status      # Migrationsstand anzeigen

npm run docs:dev       # diese Dokumentation lokal ansehen
```

::: warning Tests ohne Datenbank
Ohne gesetzte `DATABASE_URL` überspringen sich die ACL-, Auth- und
Datenbanktests **still**. Die Suite meldet trotzdem grün, obwohl der
größere Teil gar nicht gelaufen ist.
:::

## Weiter

- [Einrichtung](/start/einrichtung) — erstes Konto und Grundkonfiguration
- [Architektur](/konzepte/architektur) — wie das System aufgebaut ist
- [Betrieb](/betrieb/voraussetzungen) — Installation im Büro
