# PATIO

Büro-Software für **Architektur-, Planungs- und Projektsteuerungsbüros**
(Planung, Statik, Bauphysik, Projektsteuerung). PATIO läuft zentral im
eigenen Netz — ein Rechner im Büro, alle Arbeitsplätze im Browser.

> **Wichtig:** PATIO ist ein **Büro-Werkzeug für die Planung**, kein
> Baustellen-Tool. Es dokumentiert und organisiert, was im Büro gebraucht
> wird — Projekte, Termine, Aufgaben, Notizen, Akten, Protokolle — und
> richtet sich an Menschen am Schreibtisch, nicht an die Baustelle.

> **Name:** PATIO = **P**lan · **A**rchitektur · **T**ermine · **I**ntelligenz
> · **O**ffice — und zugleich der architektonische Begriff für den Innenhof.
> Früherer Projektname: `Bau-OS`.

## Was es kann

- **Projekte** mit Stammdaten, Sub-Projekten, Bauherr-Verknüpfung und
  projektweiser Sichtbarkeit
- **Aufgaben & Termine** mit Team-Zuweisung
- **Notizen** — Markdown-Aktenvermerke, projektverknüpft, durchsuchbar
- **Meetings/Protokolle** (Bauherrentermine, Behördentermine) mit
  Action-Items, die per Klick zu Aufgaben werden — Export nach DOCX
- **Bautagebuch** & **Stundenerfassung** als Büro-Doku-Werkzeuge
  (rechtskonform nach §26 AZG / BAG-Urteil v. 13.09.2022)
- **Leistungsphasen & Gantt** — Projekt-Phasen (LPH) mit Abhängigkeiten,
  Auto-Meilensteinen und Zeitleiste
- **Honorar & Deckungsbeitrag** — Stundensätze, Honorar-Ökonomie je Projekt
- **Rechnungen** — projektbezogene Rechnungsstellung
- **Portfolio-Cockpit** — projektübergreifende Übersicht mit echten
  Fortschrittszahlen
- **Team-Verwaltung** mit Firmen, Kategorien, Kontakt-Log, vCard
- **Dateien** — die digitale Projektakte mit Upload, Vorschau und Suche
- **Volltextsuche** über Notizen, Aufgaben, Projekte und Dateien
- **Web-App** (Vue 3) als Arbeitsoberfläche: Dashboard, Listen, Kalender,
  Projektakten — Live-Aktualisierung über Server-Sent Events

## Betrieb

Ein Rechner im Büro-LAN (Mini-PC genügt), Docker Compose mit zwei
Containern: der Anwendung und PostgreSQL. Alle Daten bleiben im Haus.

**Kein Außenkontakt im Betrieb:** kein Chat-Bot, keine KI-Laufzeit, kein
Cloud-Dienst, keine Telemetrie. Der Dienst spricht ausschließlich mit
seiner eigenen Datenbank und mit den Browsern im Netz.

## Tech-Stack

- Node.js + TypeScript + Hono (HTTP-API)
- PostgreSQL via `postgres.js`, Migrationen als plain SQL
- Vue 3 + Pinia + Vite + Tailwind v4
- Docker Compose (App + PostgreSQL), Reverse-Proxy davor

## Loslegen

```bash
npm install
cp .env.example .env     # WORKSPACE_PATH, DATABASE_URL, JWT_SECRET setzen
npm run dev              # API auf Port 3000
npm run dev:web          # Vite-Dev-Server fürs Frontend (zweites Terminal)
```

PATIO braucht zwingend eine erreichbare PostgreSQL-Datenbank sowie
`WORKSPACE_PATH` und `JWT_SECRET` — ohne diese Werte bricht der Start mit
Exit-Code 1 ab. Details: [`docs/start/schnellstart.md`](docs/start/schnellstart.md).

Die vollständige Dokumentation liegt unter `docs/` und lässt sich als
Website ansehen:

```bash
npm run docs:dev         # lokale Vorschau
npm run docs:build       # statische Site bauen
```

## Status

Pre-Launch. Der Umbau vom Internet-Stack zum Firmenserver im eigenen Netz
läuft; die Anmeldung setzt derzeit noch E-Mail-Codes über SMTP voraus und
wird auf ein netzunabhängiges Verfahren umgestellt.

---

*Ein Produkt von Julius Sima — „by Sima".*
