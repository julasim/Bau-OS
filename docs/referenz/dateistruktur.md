# Dateistruktur

Referenz aller Module unter `src/`. Der Code liegt direkt im Repo-Root; alle
`npm`-Befehle werden von dort ausgeführt.

## Übersicht

```
src/
├── index.ts              — Einstiegspunkt und Boot-Sequenz
├── config.ts             — alle Konstanten und Umgebungsvariablen
├── logger.ts             — Logging (Konsole + Textlog + JSONL)
├── maintenance.ts        — täglicher Wartungs-Cron
├── format.ts             — Altbestand aus der Bot-Zeit, ohne Konsumenten
├── api/                  — Hono HTTP-API
│   ├── server.ts         — Hono-App, Login, CORS, Security-Header, Rate-Limit
│   ├── auth.ts           — JWT, Benutzerverwaltung, Auth-Middleware
│   ├── crypto.ts         — Feld-Verschlüsselung (AES-GCM)
│   ├── email.ts          — SMTP-Versand und Mail-Bau
│   ├── email-template.ts — Platzhalter-Renderer für die HTML-Vorlagen
│   ├── events.ts         — Event-Bus für Live-Updates (mit Rechtefilter)
│   ├── sse-tickets.ts    — Einmal-Tickets für den SSE-Verbindungsaufbau
│   ├── file-validation.ts— Upload-Prüfung: Endung und Magic Bytes
│   ├── totp.ts           — TOTP-Hilfsfunktionen (derzeit nicht eingebunden)
│   └── routes/           — 24 Route-Dateien, siehe unten
├── data/                 — Repository-Schicht (ausschließlich PostgreSQL)
│   ├── index.ts          — einzige Import-Fläche für alle Repositories
│   ├── types.ts          — Entity- und Repository-Interfaces
│   ├── access.ts         — Sichtbarkeit und ACL-Prüfungen
│   ├── termin-validation.ts — Validierung von Termin-Eingaben
│   └── db-*.ts           — 21 Repositories, siehe unten
├── db/                   — Datenbankschicht
│   ├── client.ts         — postgres.js-Verbindungspool
│   ├── migrate.ts        — SQL-Migrations-Runner
│   ├── index.ts          — Barrel-Export
│   └── migrations/       — 43 SQL-Dateien (001–041)
├── workspace/            — echter Dateizugriff auf WORKSPACE_PATH
│   ├── index.ts          — Re-Export
│   ├── helpers.ts        — safePath, ensureDir, Pfad-Utilities
│   ├── files.ts          — Lesen, Schreiben, Ordner auflisten
│   └── extractor.ts      — Text aus PDF und DOCX ziehen
├── export/
│   └── docx-render.ts    — DOCX-Erzeugung aus Word-Vorlagen
└── emails/               — 4 HTML-Vorlagen für Systemmails

web/                      — Vue-3-Frontend (eigenes Vite-Projekt)
docker/                   — Standalone-Compose, Caddyfile, DB-Init
scripts/                  — Installations-, Backup- und Wartungsskripte
tests/                    — Vitest-Suite
docs/                     — diese Dokumentation (VitePress)
```

::: warning src/format.ts
Der Markdown-nach-Telegram-HTML-Konverter hat seit dem Umbau **keinen
Aufrufer mehr**. Die Datei ist Altbestand und keine dokumentierte
Schnittstelle.
:::

---

## Einstiegspunkt

### `src/index.ts`

Boot-Sequenz, in dieser Reihenfolge:

1. `.env` laden
2. `WORKSPACE_PATH` prüfen — fehlt der Wert, Abbruch mit Exit-Code 1
3. `DATABASE_URL` prüfen — fehlt der Wert, Abbruch mit Exit-Code 1
4. Datenbank-Healthcheck; antwortet sie nicht, Abbruch mit Exit-Code 1
5. Migrationen anwenden, sofern `DB_AUTO_MIGRATE` nicht auf `false` steht
6. Alt-Konten aus `data/users.json` in die Datenbank nachziehen (idempotent)
7. `ENCRYPTION_KEY` prüfen — fehlt er oder ist zu kurz, nur eine Warnung
8. `JWT_SECRET` prüfen — fehlt es, Abbruch; ist es zu kurz, Abbruch nur bei
   `NODE_ENV=production`
9. Hono-API starten
10. Wartungs-Cron starten

`SIGTERM` und `SIGINT` schließen die Datenbankverbindung und beenden den
Prozess sauber. Unbehandelte Exceptions und Promise-Rejections werden mit
Stack protokolliert; danach beendet sich der Prozess kontrolliert, damit der
Container-Neustart greift statt eines undefinierten Zustands.

::: tip Kein stiller Zombie
Alle Pflicht-Prüfungen brechen hart ab. Früher lief der Prozess ohne
Datenbank weiter, hörte auf Port 3000, galt für Docker als gesund — und
lieferte bei jedem Datenzugriff einen 500er.
:::

---

## Konfiguration und Hilfsdienste

### `src/config.ts`

Alle Tunables als Konstanten, ausgewertet beim ersten Import. Vollständige
Liste: [Konfigurationsreferenz](/referenz/config).

### `src/logger.ts`

Drei Ausgabewege: `console.*` sofort (das ist die Observability im
Container), dazu ein gekürztes Textlog und ein vollständiges JSONL-Log. Die
Dateischreibvorgänge laufen über eine serialisierte Async-Queue, damit kein
`fs.*Sync` den Event-Loop blockiert; bei Prozessende wird synchron geflusht.

### `src/maintenance.ts`

Ein täglicher Cron-Job um 03:15 Uhr (`TIMEZONE`): löscht Audit-Einträge, die
älter sind als `AUDIT_RETENTION_DAYS`, und räumt abgelaufene Tokens weg.

---

## Web-API (`src/api/`)

### `src/api/server.ts`

Die Hono-Anwendung. Enthält neben der Route-Registrierung:

- **Health-Check** `GET /api/health` — ohne Anmeldung und ohne Rate-Limit,
  liefert nur `ok`, Uptime und ob eine Datenbank konfiguriert ist. Bewusst
  ohne Versionen oder Build-Hashes, weil der Endpunkt anonym erreichbar ist.
- **Zentrale Fehlerbehandlung** (`app.onError`) — übersetzt Ausnahmen in
  JSON-Antworten: kaputter JSON-Body wird 400, Statement-Timeout und
  überlastete Datenbank 503, `EACCES`/`EPERM` 403, `ENOSPC` 507, alles
  andere 500 mit Hinweis aufs Log.
- **Security-Header** via `hono/secure-headers`, dazu eine
  Content-Security-Policy im Report-Only-Modus.
- **CORS** — ohne `CORS_ORIGINS` nur `http://localhost:<API_PORT>`.
- **Globaler Rate-Limit** je IP über alle `/api/*`-Routen, danach die
  Auth-Middleware.
- **Login-Kette**: Passwort, E-Mail-Code, Anmelde-Link, Passwort-Reset,
  Setup-Assistent für das erste Admin-Konto.
- **Statische Auslieferung** der gebauten Vue-Anwendung aus `dist/web`
  inklusive SPA-Fallback auf `index.html`.

### `src/api/auth.ts`

JWT-Erstellung und -Prüfung, Auth-Middleware (setzt `userId`, `userRole` und
`dbUser` in den Hono-Kontext), Benutzerverwaltung, E-Mail-Einmalcodes,
Anmelde-Link-Tokens und Passwort-Reset-Tickets. Enthält außerdem noch den
Rückfallpfad auf `data/users.json` für Konten aus der Zeit vor der
Datenbank-Benutzerverwaltung.

### `src/api/crypto.ts`

AES-GCM-Verschlüsselung einzelner Datenbankfelder. Schlüssel ist
`ENCRYPTION_KEY`; ohne ihn greift der Rückfall auf `JWT_SECRET`. Umstellung
eines Bestandssystems: [SEC-4-Migration](/sec-4-crypto-migration).

### `src/api/events.ts`

Typisierter In-Memory-Event-Bus für Live-Updates. Zwei Schutzstufen:

1. Ein Ereignis trägt **keine Inhalte** mehr, nur noch was sich geändert hat
   (`type`, `action`, `id`, `projectId`). Der Client lädt über die reguläre
   Route nach, und die filtert bereits.
2. Jeder Abonnent bringt einen Sichtbarkeits-Kontext mit; zugestellt wird
   nur, was dieser Kontext sehen darf — derselbe Maßstab wie überall sonst.

### `src/api/sse-tickets.ts`

`EventSource` kann keine eigenen Header setzen, das Credential muss also in
die URL. Statt das langlebige JWT dort zu exponieren, holt der Client per
authentifiziertem POST ein Einmal-Ticket mit 30 Sekunden Lebensdauer.

### `src/api/file-validation.ts`

Zwei Schranken gegen getarnte Uploads: eine Endungs-Whitelist als Grobfilter
und eine Magic-Byte-Prüfung, die den erkannten Binärtyp gegen die behauptete
Endung hält. Textformate ohne verlässliche Signatur (`txt`, `md`, `csv`,
`json`, `xml`) werden anhand der Endung akzeptiert.

Erlaubte Endungen: `pdf`, `docx`, `doc`, `xlsx`, `xls`, `csv`, `txt`, `md`,
`png`, `jpg`, `jpeg`, `gif`, `webp`, `zip`, `json`, `xml`.

### `src/api/email.ts` und `email-template.ts`

SMTP-Versand über `nodemailer` sowie der Aufbau der vier Systemmails aus den
HTML-Vorlagen in `src/emails/`. Der Renderer ersetzt `{{var}}`-Platzhalter
und escaped HTML-Variablen; URL-Variablen bleiben unescaped, weil sie aus
dem Backend selbst stammen.

### `src/api/totp.ts`

TOTP-Hilfsfunktionen aus der Zeit der App-basierten Zwei-Faktor-Anmeldung.
Die zugehörigen Routen (`routes/auth-2fa.ts`) sind in `server.ts` bewusst
**nicht eingebunden**, damit nicht zwei Verfahren parallel laufen. Beides
bleibt als Wiederherstellungspfad im Code.

### `src/api/routes/`

24 Route-Dateien, alle unter `/api` eingehängt:

| Datei | Beschreibung |
|---|---|
| `dashboard.ts` | Aggregierte Startseiten-Daten |
| `notes.ts` | Notizen |
| `tasks.ts` | Aufgaben |
| `termine.ts` | Termine |
| `projects.ts` | Projekte und Stammdaten |
| `search.ts` | Volltextsuche |
| `files.ts` | Upload, Download, Datei-Metadaten |
| `team.ts` | Team-Mitglieder |
| `companies.ts` | Firmen |
| `bautagebuch.ts` | Bautagebuch |
| `meetings.ts` | Meetings und Protokolle |
| `time-entries.ts` | Stundenerfassung |
| `phases.ts` | Leistungsphasen und Gantt |
| `invoices.ts` | Rechnungen |
| `portfolio.ts` | Portfolio-Cockpit |
| `admin-users.ts` | Benutzerverwaltung und Projektzuweisung |
| `events.ts` | SSE-Endpunkt für Live-Updates |
| `settings.ts` | Persönliche Einstellungen |
| `branding.ts` | Firmen-Branding, Logo (öffentlicher Teil separat) |
| `templates.ts` | Vorlagen |
| `export-templates.ts` | Word-Exportvorlagen und die Export-Endpunkte |
| `project-modules.ts` | Aktivierbare Module je Projekt |
| `ui-preferences.ts` | Oberflächen-Einstellungen je Benutzer |
| `auth-2fa.ts` | TOTP-Routen — **nicht eingebunden** |

---

## Datenschicht (`src/data/`)

Einzige Import-Fläche für alle Persistenz-Operationen. **Nie direkt aus
`db-*` importieren** — immer über `src/data/index.ts`.

Alle Repositories sind Postgres-Repositories und non-nullable. Die früheren
`fs-*`-Implementierungen und die Weiche zwischen beiden Welten sind mit dem
Umbau zum Firmenserver entfallen; kein Aufrufer muss mehr auf `null` prüfen.

### `src/data/types.ts`

Interfaces aller persistierten Entitäten und aller Repository-Verträge:
`Task`, `Note`, `Termin`, `Project`, `TeamMember`, `Company`, `FileEntry`,
`BautagebuchEntry`, `Meeting`, `MeetingActionItem`, `TimeEntry`,
`ProjectPhase`, `ProjectInvoice`, `PortfolioEntry` und weitere.

### `src/data/access.ts`

Die zentrale Stelle für „wer darf was sehen". Die Repositories bauen ihre
WHERE-Klauseln daraus, statt sich die Logik selbst zusammenzusetzen.

| Funktion | Bedeutung |
|---|---|
| `getVisibleProjectIds(ctx)` | Sichtbare Projekt-IDs; Admins bekommen den Sentinel `"all"` |
| `canSeeProject(ctx, id)` | Einzelprüfung über die Projekt-UUID |
| `canSeeProjectByName(ctx, name)` | Einzelprüfung über den Projektnamen (kommt in vielen Routen als Pfad-Parameter vor) |

Sichtbarkeitsregeln: Admins sehen alles. Benutzer sehen die Projekte aus der
`user_projects`-Zuordnung. Aufgaben und Termine ohne Projektbezug sind
persönlich (erstellt von mir oder mir zugewiesen), Notizen ohne Projektbezug
ebenso, Dateien zusätzlich über Freigaben.

### `src/data/db-search.ts`

Volltextsuche über Notizen, Aufgaben, Projekte und Dateien. Filtert nach
sichtbaren Projekten — die frühere Suche tat das nicht. Sucht derzeit per
`ILIKE`; die Umstellung auf `tsvector` ist ein eigenes Arbeitspaket und
tauscht nur die WHERE-Klauseln aus.

::: warning Typ-Casts sind Pflicht
`project_id` ist `uuid`, die Scope-IDs kommen als Strings. Ohne `::uuid[]`
wirft Postgres `operator does not exist: uuid = text` — und zwar nur bei
Nicht-Admins, weil Admins gar nicht gefiltert werden.
:::

### Repositories

| Datei | Entität |
|---|---|
| `db-notes.ts` | Notizen |
| `db-tasks.ts` | Aufgaben |
| `db-termine.ts` | Termine |
| `db-projects.ts` | Projekte inklusive Stammdaten und Sub-Projekten |
| `db-files.ts` | Dateien mit Blob-Speicherung |
| `db-team.ts` | Team-Mitglieder und Firmen (M:N-Projektzuordnung, Kontakt-Log) |
| `db-bautagebuch.ts` | Bautagebuch-Einträge |
| `db-meetings.ts` | Meetings und Action-Items |
| `db-time-entries.ts` | Stundenerfassung |
| `db-phases.ts` | Leistungsphasen, Abhängigkeiten, Meilensteine |
| `db-invoices.ts` | Rechnungen |
| `db-portfolio.ts` | Portfolio-Kennzahlen über alle Projekte |
| `db-search.ts` | Volltextsuche |
| `db-audit.ts` | Audit-Log |
| `db-branding.ts` | Firmen-Branding |
| `db-templates.ts` | Vorlagen |
| `db-export-templates.ts` | Word-Exportvorlagen |
| `db-project-modules.ts` | Module je Projekt |
| `db-custom-modules.ts` | Benutzerdefinierte Module |
| `db-custom-placeholders.ts` | Platzhalter für Exporte |
| `db-ui-preferences.ts` | Oberflächen-Einstellungen |

---

## Datenbank (`src/db/`)

### `src/db/client.ts`

Verbindungspool über das `postgres`-Paket, konfiguriert aus `DATABASE_URL`.
Exportiert unter anderem `getDb`, `checkDbHealth`, `getPoolStats`, `closeDb`
und `withRetry`.

### `src/db/migrate.ts`

Migrations-Runner. Liest die nummerierten `.sql`-Dateien aus `migrations/`
und wendet die fehlenden der Reihe nach an.

- Forward-only, idempotent (`IF NOT EXISTS`, DO-Block-Guards)
- Tracking per Dateiname in `_migrations`, **ohne Prüfsumme**
- Jede Migration in einer eigenen Transaktion
- Advisory-Lock gegen parallel startende Instanzen

Manuell: `npm run db:migrate`, Status: `npm run db:status`.

::: warning Typen müssen beim JOIN passen
Migration `034` hat `chat_messages.session_id` von `TEXT` auf `UUID`
umgestellt, passend zu `chat_sessions.id` — vorher scheiterte jeder JOIN mit
`operator does not exist: text = uuid`.
:::

### `src/db/migrations/`

43 Dateien, `001` bis `041` (zwei Nummern sind doppelt vergeben: `005` und
`006`). Die inhaltlich wichtigsten:

| Migration | Inhalt |
|---|---|
| `001_init.sql` | Basistabellen; Extensions `uuid-ossp`, `pg_trgm`, `unaccent` |
| `004_project_stammdaten.sql` | Strukturierte Stammdaten für Projekte |
| `006_team_redesign.sql` | Firmen, M:N-Projektzuordnung, Kontakt-Log |
| `008_users_activation.sql` | Benutzerkonten in der Datenbank |
| `009_acl.sql` | Projektweise Sichtbarkeit (`user_projects`) |
| `011_bautagebuch.sql` | Bautagebuch |
| `012_meetings.sql` | Meetings und Protokolle |
| `014_time_entries.sql` | Stundenerfassung |
| `017_user_2fa.sql` | TOTP-Zweitfaktor |
| `018_audit_log.sql` | Audit-Log |
| `020_email_2fa.sql` | Anmeldecodes per E-Mail |
| `021_email_otp_magic_link.sql` | Anmelde-Link per E-Mail |
| `025_org_branding.sql` | Firmen-Branding für Exporte |
| `027_export_templates.sql` | Word-Exportvorlagen |
| `035_project_phases.sql` | Leistungsphasen |
| `037_hourly_rate.sql` | Stundensatz und Deckungsbeitrag |
| `038_phase_gantt.sql` | Phasen-Abhängigkeiten und Auto-Meilenstein |
| `039_rename_calendar_enum.sql` | Umbenennung des internen Kalender-Enums |
| `040_drop_embeddings.sql` | Entfernt die Embedding-Spalten und HNSW-Indizes |
| `041_drop_vector_extension.sql` | Entfernt den `vector`-Eintrag aus `pg_extension` |

::: tip pgvector ist abgelöst
`040` räumt Spalten und Indizes, `041` den Extension-Eintrag selbst, und
`001` legt beides bei Neuinstallationen gar nicht mehr an. Damit läuft PATIO
auf einem gewöhnlichen `postgres:16` — was auf einem Firmenserver ohne
Internet den Ausschlag gibt: das Spezial-Image `pgvector/pgvector:pg16` ist
dort nicht zu beschaffen.

`041` ist bewusst abgesichert: hängt noch eine von Hand angelegte
Vektor-Spalte daran, bleibt die Extension stehen, statt die Migration und
damit den Start scheitern zu lassen.
:::

Die Migrationen `022`–`024` (Microsoft-Tabellen und die `ms_*`-Spalten an
`termine`) stehen bewusst noch da: forward-only, und ein `DROP` wäre
unumkehrbar.

---

## Dateizugriff (`src/workspace/`)

Was hier liegt, betrifft echte Dateien. Notizen, Aufgaben, Termine,
Projekte und Team liegen in der Datenbank; Dokumente werden weiterhin im
Dateisystem abgelegt.

| Datei | Inhalt |
|---|---|
| `helpers.ts` | `safePath()` löst relative Pfade gegen `WORKSPACE_PATH` auf und weist alles außerhalb ab (Path-Traversal-Schutz); dazu `ensureDir` und `workspacePath` |
| `files.ts` | `readFile`, `createFile`, `listFolder` — Letzteres blendet auf Wurzelebene die Systemordner `Agents`, `MEMORY_LOGS`, `Daily` und `Templates` aus |
| `extractor.ts` | Text aus PDF (`pdf-parse`) und DOCX (`mammoth`), begrenzt auf `EXTRACT_MAX_CHARS` |

Der Umfang ist mit dem Umbau von rund 1.770 auf 245 Zeilen geschrumpft.

---

## Export (`src/export/`)

### `src/export/docx-render.ts`

Erzeugt DOCX-Dateien aus hochgeladenen Word-Vorlagen (`docxtemplater` +
`pizzip`). Ein eigener Ausdrucks-Parser löst verschachtelte Platzhalter wie
`{Meeting.Titel}` oder `{Projekt.Bauherr}` auf — ohne ihn würde
`docxtemplater` den Punkt als Teil eines flachen Namens lesen.

Die Endpunkte liegen in `routes/export-templates.ts`:
`/exports/meeting/:id`, `/exports/bautagebuch/:id`, `/exports/time-entries`
und `/exports/project/:name/summary`.

---

## Frontend (`web/`)

Eigenständiges Vite-Projekt, gebaut über `npm run build:all` nach
`dist/web`, von wo die API es ausliefert.

```
web/src/
├── App.vue, main.ts, router.ts
├── api.ts                — HTTP-Client mit Token-Handling
├── patio-tokens.css      — Design-Tokens (einzige Quelle für Farben/Abstände)
├── patio-components.css  — Komponenten-Styles
├── patio-shell.css       — App-Shell-Layout
├── components/
│   ├── AppLayout.vue     — 3-Spalten-Shell: NavRail, ListPane, Detail
│   ├── BIcon.vue         — Line-Icons (keine Emojis in der Oberfläche)
│   └── shell/            — NavRail, ListPane, DetailPane, IconBtn, Avatar, StatusDot
├── composables/          — u.a. Event-Abo für Live-Updates
├── stores/               — Pinia
├── utils/
└── views/
    ├── DashboardView.vue, CalendarView.vue, SearchView.vue,
    │   FileBrowserView.vue, SettingsView.vue, LoginView.vue, SetupView.vue,
    │   AdminUsersView.vue, AdminAuditView.vue, TeamDetailView.vue,
    │   ProjectDetailView.vue
    └── notes-v2/, tasks-v2/, team-v2/, projects-v2/, portfolio/
```

Die `-v2`-Verzeichnisse folgen dem ListPane/DetailPane-Muster des PATIO
Design System v2 und sind beim Weiterbauen den älteren Top-Level-Views
vorzuziehen.

---

## Weitere Verzeichnisse im Repo-Root

| Verzeichnis | Inhalt |
|---|---|
| `tests/` | Vitest-Suite. Die ACL-, Auth- und Datenbanktests überspringen sich still ohne `DATABASE_URL` |
| `scripts/` | Installation, Backup, Restore, Migration, Neuverschlüsselung |
| `docker/` | Standalone-Compose mit eigenem Caddy, Caddyfile, Init-SQL für den Postgres-Container |
| `docs/` | Diese Dokumentation (VitePress) |
| `data/` | Alt-Konten (`users.json`) — gitignored |
| `logs/` | Textlog und JSONL-Log — gitignored |
