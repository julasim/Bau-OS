# Architektur

PATIO besteht aus drei Schichten: der **Vue-Oberfläche**, der **Hono-API** als
einzigem Dienst und **PostgreSQL** als Speicher — und zwar als einzigem: auch
hochgeladene Dokumente liegen dort (Tabelle `files`), nicht auf der Platte.

Der Ordner hinter `WORKSPACE_PATH` ist etwas anderes: die Netzfreigabe
„Dokumente", in die die Anwendung nichts schreibt.

Die Oberfläche läuft am Arbeitsplatz in einem eigenen Programmfenster
(`PATIO.exe`) und im Besprechungsraum im Browser. Für die Architektur macht das
keinen Unterschied: **sie spricht durchgehend relative Pfade** (`/api/…`),
kennt also gar keine Serveradresse. Genau deshalb ist dieselbe Oberfläche in
beiden Verpackungen lauffähig — und genau deshalb musste für das
Arbeitsplatz-Programm keine Zeile der Oberfläche angefasst werden. Siehe
[Arbeitsplatz-Programm](/betrieb/arbeitsplatz).

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
      [ PostgreSQL ]
      Projekte, Notizen, Aufgaben, Termine, Team
      UND die hochgeladenen Dokumente (Tabelle `files`)

   daneben, ohne Zutun der Anwendung:
      Netzfreigabe "Dokumente" (WORKSPACE_PATH) — Plaene, CAD, Scans
```

Es gibt **keine ausgehende Verbindung** im Betrieb: kein Mailserver, kein
Sprachmodell, kein Cloud-Dienst, keine Telemetrie. Auch die Oberfläche lädt
nichts nach — der frühere Aufruf zu Google Fonts ist entfallen; gesetzt werden
Systemschriften mit Inter als erster Wahl, falls vorhanden.

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

## Wie ein Projekt adressiert wird

Drei Formen, aufgelöst an **einer** Stelle (`src/api/projekt-bezug.ts`):

| Form | Beispiel | Eigenschaft |
|---|---|---|
| `?projectId=` | `9db792d3-8042-…` | Technische Kennung. Unveränderlich, aber unlesbar — steht in keinem Dokument. |
| `?projektnummer=` | `SAZTG-2026-014` | Die Kennung des Büros (Migration 052). Eindeutig, aussprechbar, korrigierbar. |
| `?project=` | `Villa Müller` | Der Name. Gut lesbar, aber änderbar — die schwächste Angabe. |

Vorrang bei mehreren: **Kennung > Nummer > Name.**

::: warning Eine zweite Adressierung ist keine zweite Tür
Die Auflösung liefert nur einen **Namen**. Ob der Fragende das Projekt sehen
darf, entscheidet danach unverändert die Route über `canSeeProjectByName()`.
Eine Projektnummer öffnet damit keinen Weg an den Rechten vorbei, sondern
einen zweiten Weg zum selben Tor — festgehalten in
`tests/api-projektnummer.test.ts`: über die Nummer muss dieselbe Antwort
kommen wie über den Namen.

Eine Nummer, die ins Leere zeigt, ergibt einen **404** und nicht die
projektübergreifende Liste. Sonst bekäme ein Aufrufer mit veralteter Angabe
mehr zu sehen statt weniger.
:::

Ausführlich: [Die Projektnummer](/konzepte/projektnummer).

::: warning Der Filter wird in den Routen ERMITTELT, nicht in den Repositories
Die Aufteilung ist wichtig, weil sie erklärt, wo Lücken entstehen:

- **17 Routen** rufen `getVisibleProjectIds()` auf und reichen das Ergebnis
  weiter; **15** prüfen einzeln über `canSeeProject()` bzw.
  `canSeeProjectByName()`.
- **6 Repositories** (`db-search`, `db-files`, `db-portfolio`, `db-meetings`,
  `db-bautagebuch`, `db-entscheidungen`) wenden eine übergebene Liste an —
  **keines ermittelt sie selbst.**

Das heißt: ein Repository filtert zwar, aber nur mit dem, was die Route ihm
gibt. Eine neue Route, die den Aufruf vergisst, liefert ungefiltert aus. Genau
so sind in diesem Projekt **dreizehn** Lücken entstanden — die vollständige
Liste mit dem, was jeweils offen lag, steht unter
[Zugriffsrechte](/sicherheit/zugriff).

Die Umkehrung — Filterung fest als `WHERE`-Klausel im Repository, wo man sie
nicht vergessen kann — ist als eigenes Arbeitspaket vorgesehen. Bis dahin gilt
beim Bauen neuer Routen: **Rechtefilter nicht vergessen.**
:::

## Modulstruktur

```
src/
├── index.ts       Boot: .env → Datenbank → API → Wartungs-Cron
├── config.ts      alle Konstanten und Umgebungsvariablen
├── logger.ts      Konsole + Textlog + JSONL, nicht blockierend
├── maintenance.ts täglicher Cron (Audit-Retention, abgelaufene Tokens)
├── api/
│   ├── server.ts        Hono-App, Anmeldung, Middleware, statische Auslieferung
│   ├── auth.ts          JWT, Benutzerkonten, Passwörter (bcrypt)
│   ├── geld.ts          EINE Filterschicht für alle Geldbeträge
│   ├── projekt-bezug.ts löst `?projectId=`, `?projektnummer=` und `?project=` auf
│   ├── crypto.ts        Feld-Verschlüsselung (AES-GCM)
│   ├── events.ts        Event-Bus mit Rechtefilter
│   ├── sse-tickets.ts   Einmal-Tickets für den SSE-Aufbau
│   ├── file-validation.ts  Endung + Magic Bytes bei Uploads
│   └── routes/          30 Route-Dateien je Domäne
├── data/
│   ├── index.ts   einzige Import-Fläche für alle Repositories
│   ├── access.ts  Sichtbarkeit und ACL
│   ├── types.ts   Entities und Repository-Verträge
│   ├── konflikt.ts      Konflikt-Zähler `rev`
│   ├── projektnummer.ts Regeln der Projektnummer
│   ├── zeitstempel.ts   jedes Datum verlässt den Server als ISO 8601
│   └── db-*.ts    25 Postgres-Repositories
├── db/
│   ├── client.ts  Verbindungspool (postgres.js)
│   ├── migrate.ts Migrations-Runner mit Advisory-Lock
│   └── migrations/ 58 SQL-Dateien, forward-only (bis `056`)
├── workspace/     NUR Lesezugriff auf die Netzfreigabe (Rueckfall fuer alte
│                  Datei-Datensaetze) + Text aus PDF und DOCX ziehen
└── export/        DOCX-Erzeugung aus Word-Vorlagen

web/               Vue 3 + Vue Router (eigenes Vite-Projekt)
electron/          Hülle des Arbeitsplatz-Programms (lädt die Oberfläche vom Server)
docs/              diese Dokumentation (VitePress) — der Server liefert sie unter /docs/
```

Detaillierte Auflistung: [Dateistruktur](/referenz/dateistruktur).

::: info Pinia ist eingebunden, aber leer
`web/src/main.ts` registriert Pinia; einen Store gibt es nicht. Geteilter
Zustand liegt in Composables (`useAufgabensystem`, `useEvents`, `useTheme`) —
das reicht für eine Oberfläche dieser Größe und spart eine zweite Schicht,
in der derselbe Zustand ein zweites Mal steht.
:::

## Stack

| Komponente | Technologie |
|---|---|
| Laufzeit | Node.js 24 (Container), TypeScript |
| HTTP-API | Hono |
| Datenbank | PostgreSQL 16 via `postgres.js` |
| Frontend | Vue 3 + Vue Router + Vite + Tailwind v4 |
| Live-Updates | Server-Sent Events |
| Dokumenten-Export | `docxtemplater` auf Basis eigener Word-Vorlagen |
| Zeitplanung | `node-cron` (Europe/Vienna) |
| Arbeitsplatz | Electron-Hülle, lädt die Oberfläche vom Server |
| Betrieb | Docker Compose, **drei Container** (`postgres`, `app`, `caddy`) |

## Design-Prinzipien

### Ein Speicher, kein Zweitweg

PATIO läuft ausschließlich gegen PostgreSQL. Der frühere Dateisystem-Modus
ist ersatzlos entfallen — alle Repositories sind Postgres-Repositories und
non-nullable, kein Aufrufer prüft mehr auf `null`. Auch hochgeladene Dokumente
liegen dort und nicht auf der Platte; das ist der Sinn von „ein Speicher".

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

`src/data/access.ts` ist die einzige Quelle für „wer darf was sehen". Niemand
setzt sich die Logik selbst aus `user_projects` zusammen. Auch der SSE-Kanal
misst an demselben Maßstab. Wo die Auswertung sitzt — Route oder Repository —
steht im Kasten weiter oben.

### Geldbeträge an genau einer Stelle filtern

Wer keine Honorare sehen darf, soll sie in keiner Antwort finden. Statt das in
jeder betroffenen Route einzeln zu prüfen — Rechnungen, Portfolio, Cockpit,
Positionskatalog, Suche, Live-Kanal, Export und Sicherungs-Status — sitzt eine
einzige Middleware hinter allen Routen: `src/api/geld.ts` geht die fertige
JSON-Antwort rekursiv durch und entfernt die Geldfelder, wenn das Konto das
Recht nicht hat. Eine neue Route kann das nicht vergessen, weil sie nichts
dafür tun muss.

**Die Grenze:** erkannt wird an Feldnamen aus einer festen Liste, nicht am
Inhalt. Ein Betrag unter einem neuen Namen ginge durch — Einzelheiten unter
[Zugriffskontrolle](/sicherheit/zugriff).

### Konflikte melden statt still überschreiben

**Elf Tabellen** tragen einen Zähler `rev`: die neun aus Migration `042`
(Notizen, Aufgaben, Termine, Besprechungen, Projekte, Team, Leistungsphasen,
Rechnungen, Stunden) sowie Entscheidungen und Positionskatalog, die ihn mit
`045` und `046` gleich mitbekommen haben. Das Repository schreibt ihn als
**ein einziges** Kommando:

```sql
UPDATE … SET …, rev = rev + 1 WHERE id = $1 AND rev = $2
```

Trifft das keine Zeile, hat inzwischen jemand anderes gespeichert — die Route
antwortet mit **409**, und die Oberfläche lädt den aktuellen Stand nach.
Entscheidend ist, dass Prüfung und Schreiben **dasselbe** Kommando sind: ein
vorgelagertes `SELECT` mit anschließendem `UPDATE` hätte genau dazwischen eine
Lücke.

Ohne Zähler laufen das **Bautagebuch**, die **Dateien** und die bürointerne
Konfiguration — dort gilt weiterhin „der Letzte gewinnt".

### Migrationen forward-only

Plain SQL in `src/db/migrations/`, benannt `NNN_name.sql`, idempotent
geschrieben (`IF NOT EXISTS`, DO-Block-Guards). Der Runner trackt per
Dateiname in `_migrations`, fährt jede Migration in einer eigenen
Transaktion und hält einen Advisory-Lock gegen parallel startende Instanzen.
Rückwärts-Migrationen gibt es nicht.

Derzeit 51 Dateien mit Nummern bis `049`. Die Nummern `005` und `006` sind
historisch **je zweimal** vergeben — das ist kein Fehler: der Runner
unterscheidet nach vollem Dateinamen, nicht nach Nummer.

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
