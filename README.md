# PATIO

Büro-Software für **Architektur-, Planungs- und Projektsteuerungsbüros**
(Planung, Statik, Bauphysik, Projektsteuerung). PATIO läuft zentral im
eigenen Netz — ein Rechner im Büro, an jedem Arbeitsplatz ein eigenes Programm.

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
- **Entscheidungslog** je Projekt — Begründung, Alternativen, Beteiligte
- **Team-Verwaltung** mit Kategorien, Kontakt-Log, vCard
- **Firmen** — Adressbuch der Beteiligten, mit Zusammenführen von Dubletten
- **Dateien** — die digitale Projektakte mit Upload, Vorschau und Suche
- **Volltextsuche** über Notizen, Aufgaben, Projekte und Dateien, mit
  deutschen Wortstämmen
- **Aktivität** — was zuletzt im Büro passiert ist, über alle Datenarten
- **Papierkorb** — Gelöschtes bleibt wiederherstellbar
- **Konfliktschutz** — zwei Arbeitsplätze am selben Datensatz überschreiben
  einander nicht mehr wortlos
- **Geld-Recht** je Konto — wer keine Honorare sehen darf, bekommt sie in
  keiner Antwort
- **Web-App** (Vue 3) als Arbeitsoberfläche: Dashboard, Listen, Kalender,
  Projektakten — Live-Aktualisierung über Server-Sent Events

## Betrieb

Ein Rechner im Büro-LAN (Mini-PC genügt), Docker Compose mit **drei**
Containern: der Anwendung, PostgreSQL und Caddy für TLS. Nur Caddy hat Ports
nach außen und stellt die Zertifikate aus einer **eigenen lokalen
Zertifizierungsstelle** aus. Alle Daten bleiben im Haus.

Am Arbeitsplatz läuft **`PATIO.exe`** — eine schlanke Hülle, die die Oberfläche
vom Server lädt. Der Browser bleibt der Weg für den Besprechungsraum.

**Kein Außenkontakt im Betrieb:** kein Chat-Bot, keine KI-Laufzeit, kein
Cloud-Dienst, keine Telemetrie, kein Mailversand. Auch die Oberfläche lädt
nichts nach: der frühere Aufruf zu Google Fonts ist entfallen, gesetzt werden
**Systemschriften** (Inter, falls installiert, sonst Segoe UI / Helvetica).
Die mitgelieferte Dokumentation bringt ihre Schriften als lokale Dateien mit.

## Tech-Stack

- Node.js **24** + TypeScript + Hono (HTTP-API)
- PostgreSQL 16 via `postgres.js`, Migrationen als plain SQL, forward-only
- Vue 3 + Pinia + Vite + Tailwind v4
- Electron als Hülle des Arbeitsplatz-Programms
- Docker Compose: `postgres` + `app` + `caddy`

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

Pre-Launch. Der Umbau vom Internet-Stack zum Firmenserver im eigenen Netz ist
weit fortgeschritten: Anmeldung, Compose-Stack, Zertifikat aus eigener CA,
Sicherung, Offline-Updates und das Arbeitsplatz-Programm stehen.

Die **Anmeldung ist einstufig** (Benutzername + Passwort, bcrypt). Der frühere
E-Mail-Code über SMTP ist ersatzlos entfallen — er war auf einem Rechner ohne
Internet nicht gangbar. Der zweite Faktor kommt zurück, sobald es einen Zugang
von außen gibt (VPN).

**Noch offen:** Übernahme der Oberfläche aus PATIO Desktop, Datenübernahme aus
dem alten Vault, PDF-Export, Benachrichtigungen, Board für den
Besprechungsraum, VPN.

---

*Ein Produkt von Julius Sima — „by Sima".*
