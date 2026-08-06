# Architektur

PATIO besteht aus drei Schichten: der **Vue-Oberfläche**, der **Hono-API** als
einzigem Dienst und **PostgreSQL** als Speicher. Dokumente liegen daneben als
echte Dateien im Dateisystem.

Die Oberfläche läuft am Arbeitsplatz in einem eigenen Programmfenster
(`PATIO.exe`, geplant) und im Besprechungsraum im Browser. Für die Architektur
macht das keinen Unterschied: **sie spricht durchgehend relative Pfade**
(`/api/…`), kennt also gar keine Serveradresse. Genau deshalb ist dieselbe
Oberfläche in beiden Verpackungen lauffähig.

## Datenfluss

```
        Arbeitsplätze im Büro-LAN
        (PATIO.exe bzw. Browser)
                    │
                    │  HTTPS
                    ▼
            [ Reverse-Proxy ]
                    │
                    ▼
    ┌───────────────────────────────────┐
    │  Hono-API (src/api/server.ts)     │
    │  · JWT-Auth, Rate-Limit, CORS     │
    │  · Routes je Domäne               │
    │  · SSE-Kanal für Live-Updates     │
    └────────────┬──────────────────────┘
                 │
                 ▼
    ┌───────────────────────────────────┐
    │  Datenschicht (src/data/index.ts) │
    │  · ein Repository je Domäne       │
    │  · Sichtbarkeit via access.ts     │
    └────────┬──────────────────┬───────┘
             │                  │
             ▼                  ▼
      [ PostgreSQL ]     [ Dateisystem ]
      Projekte, Notizen,  WORKSPACE_PATH:
      Aufgaben, Termine,  hochgeladene
      Team, Metadaten     Dokumente
```

Es gibt **keine ausgehende Verbindung** im Betrieb — abgesehen vom
Kein Mailserver, kein Sprachmodell, kein Außenkontakt.

### Ablauf einer Anfrage

1. Die Oberfläche schickt die Anfrage mit dem JWT im `Authorization`-Header.
2. Der globale Rate-Limit prüft die IP (Standard: 600 Anfragen pro Minute).
3. `authMiddleware` prüft das Token und legt `userId`, `userRole` und
   `dbUser` in den Hono-Kontext.
4. Die Route lädt über `src/data/index.ts` — und nur darüber.
5. **Die Route** filtert über `getVisibleProjectIds()` auf die für diesen
   Benutzer sichtbaren Projekte und gibt das Ergebnis ans Repository weiter.
   Admins bekommen den Sentinel `"all"` und damit keinen Filter.
6. Schreibende Routen melden die Änderung an den Event-Bus. Der stellt sie
   allen SSE-Abonnenten zu, deren Sichtbarkeits-Kontext sie abdeckt — ohne
   Inhalte, nur „was hat sich geändert". Die Oberfläche lädt über die reguläre
   Route nach.

::: warning Der Filter sitzt in den Routen, nicht in den Repositories
Zwölf Routen rufen `getVisibleProjectIds()` auf; **kein einziges Repository**
tut es. Das heißt: eine neue Route, die den Aufruf vergisst, liefert
ungefiltert aus. Genau so sind in diesem Projekt vier Lücken entstanden.

Die Umkehrung — Filterung als `WHERE`-Klausel im Repository, wo man sie nicht
vergessen kann — ist als eigenes Arbeitspaket vorgesehen. Bis dahin gilt beim
Bauen neuer Routen: **Rechtefilter nicht vergessen.**
:::

## Modulstruktur

```
src/
├── index.ts       Boot: .env → Datenbank → API → Wartungs-Cron
├── config.ts      alle Konstanten und Umgebungsvariablen
├── logger.ts      Konsole + Textlog + JSONL, nicht blockierend
├── maintenance.ts täglicher Cron (Audit-Retention, abgelaufene Tokens)
├── api/
│   ├── server.ts        Hono-App, Login-Kette, Middleware, statische Auslieferung
│   ├── auth.ts          JWT, Benutzer, E-Mail-Codes, Anmelde-Links
│   ├── crypto.ts        Feld-Verschlüsselung (AES-GCM)
│   ├── events.ts        Event-Bus mit Rechtefilter
│   ├── sse-tickets.ts   Einmal-Tickets für den SSE-Aufbau
│   ├── file-validation.ts  Endung + Magic Bytes bei Uploads
│   └── routes/          24 Route-Dateien je Domäne
├── data/
│   ├── index.ts   einzige Import-Fläche für alle Repositories
│   ├── access.ts  Sichtbarkeit und ACL
│   ├── types.ts   Entities und Repository-Verträge
│   └── db-*.ts    21 Postgres-Repositories
├── db/
│   ├── client.ts  Verbindungspool (postgres.js)
│   ├── migrate.ts Migrations-Runner mit Advisory-Lock
│   └── migrations/ nummerierte SQL-Dateien, forward-only
├── workspace/     echter Dateizugriff (safePath, lesen/schreiben, PDF/DOCX-Extraktion)
└── export/        DOCX-Erzeugung aus Word-Vorlagen

web/               Vue 3 + Pinia + Vue Router (eigenes Vite-Projekt)
```

Detaillierte Auflistung: [Dateistruktur](/referenz/dateistruktur).

## Stack

| Komponente | Technologie |
|---|---|
| Laufzeit | Node.js 24 (Container), TypeScript |
| HTTP-API | Hono |
| Datenbank | PostgreSQL 16 via `postgres.js` |
| Frontend | Vue 3 + Pinia + Vue Router + Vite + Tailwind v4 |
| Live-Updates | Server-Sent Events |
| Dokumenten-Export | `docxtemplater` auf Basis eigener Word-Vorlagen |
| Zeitplanung | `node-cron` (Europe/Vienna) |
| Betrieb | Docker Compose, zwei Container, Reverse-Proxy davor |

## Design-Prinzipien

### Ein Speicher, kein Zweitweg

PATIO läuft ausschließlich gegen PostgreSQL. Der frühere Dateisystem-Modus
ist ersatzlos entfallen — alle Repositories sind Postgres-Repositories und
non-nullable, kein Aufrufer prüft mehr auf `null`. Das Dateisystem hält nur
noch, was ohnehin Dateien sind: hochgeladene Dokumente.

Der Datenzugriff läuft **ausschließlich** über `src/data/index.ts`. Direkt
aus `db-*` zu importieren umgeht die Abstraktion und ist verboten.

### Harter Abbruch statt stiller Zombie

Fehlt `WORKSPACE_PATH`, `DATABASE_URL` oder `JWT_SECRET`, beendet sich der
Prozess mit Exit-Code 1. Vorher lief er weiter, hörte auf Port 3000, galt für
Docker als gesund und lieferte bei jedem Datenzugriff einen 500er. Ein
Dienst, der ohne seine Pflicht-Konfiguration hochkommt, ist schlimmer als
einer, der gar nicht startet.

Dieselbe Haltung gilt zur Laufzeit: unbehandelte Exceptions und
Promise-Rejections werden mit Stack protokolliert und beenden den Prozess
kontrolliert, damit `restart: always` ihn sauber neu hochfährt.

### Sichtbarkeit an einer Stelle

`src/data/access.ts` ist die einzige Quelle für „wer darf was sehen". Die
Repositories bauen ihre WHERE-Klauseln daraus, statt sich die Logik jeweils
selbst aus `user_projects` zusammenzusetzen. Auch der SSE-Kanal misst an
demselben Maßstab.

### Migrationen forward-only

Plain SQL in `src/db/migrations/`, benannt `NNN_name.sql`, idempotent
geschrieben (`IF NOT EXISTS`, DO-Block-Guards). Der Runner trackt per
Dateiname in `_migrations`, fährt jede Migration in einer eigenen
Transaktion und hält einen Advisory-Lock gegen parallel startende Instanzen.
Rückwärts-Migrationen gibt es nicht.

### Kein Außenkontakt

Kein Chat-Bot, keine KI-Laufzeit, keine Websuche, kein Cloud-Dienst, keine
Telemetrie. Das ist keine Einstellung, sondern der Zustand des Codes: die
entsprechenden Module wurden entfernt, nicht abgeschaltet.

## Was es früher gab

PATIO war eine self-hosted KI-Büro-Software mit Telegram-Bot,
LLM-Agenten, Vault-Dateien und semantischer Suche über pgvector (alles entfallen). Mit dem
Umbau zum Firmenserver ist das alles ersatzlos entfallen — rund 16.000
Zeilen. Wer auf alte Notizen, Skripte oder Konfigurationen stößt, die
`BOT_TOKEN`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL` oder Agenten-Markdown
erwähnen: das ist Altbestand, kein aktueller Stand.
