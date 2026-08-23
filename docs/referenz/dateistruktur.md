# Dateistruktur

Referenz aller Module unter `src/`. Der Code liegt direkt im Repo-Root; alle
`npm`-Befehle werden von dort ausgeführt.

## Übersicht

```
src/
├── index.ts              — Einstiegspunkt und Boot-Sequenz
├── config.ts             — alle Konstanten und Umgebungsvariablen
├── logger.ts             — Logging (Konsole + Textlog + JSONL)
├── maintenance.ts        — täglicher Wartungs-Cron (Audit-Retention, Tageswechsel)
├── api/                  — Hono HTTP-API
│   ├── server.ts         — Hono-App, Login, CORS, Security-Header, Rate-Limit
│   ├── auth.ts           — JWT, Benutzerverwaltung, Auth-Middleware
│   ├── crypto.ts         — Feld-Verschlüsselung (AES-GCM)
│   ├── events.ts         — Event-Bus für Live-Updates (mit Rechtefilter)
│   ├── sse-tickets.ts    — Einmal-Tickets für den SSE-Verbindungsaufbau
│   ├── file-validation.ts— Upload-Prüfung: Endung und Magic Bytes
│   ├── totp.ts           — TOTP-Hilfsfunktionen (derzeit nicht eingebunden)
│   ├── geld.ts           — EINE Filterschicht für alle Geldbeträge
│   ├── projekt-bezug.ts  — löst ?projectId=, ?projektnummer= und ?project= auf
│   ├── dateiname.ts     — Dateiname im Content-Disposition-Header (RFC 5987)
│   └── routes/           — 30 Route-Dateien, siehe unten
├── data/                 — Repository-Schicht (ausschließlich PostgreSQL)
│   ├── index.ts          — einzige Import-Fläche für alle Repositories
│   ├── types.ts          — Entity- und Repository-Interfaces
│   ├── access.ts         — Sichtbarkeit und ACL-Prüfungen
│   ├── konflikt.ts       — Konflikt-Zähler `rev` (Migration 042)
│   ├── projektnummer.ts  — Regeln der Projektnummer (Migration 052)
│   ├── zeitstempel.ts    — jedes Datum verlässt den Server als ISO 8601
│   ├── sql-like.ts       — Maskierung für LIKE-Muster
│   ├── termin-validation.ts — Validierung von Termin-Eingaben
│   └── db-*.ts           — 25 Repositories, siehe unten
├── db/                   — Datenbankschicht
│   ├── client.ts         — postgres.js-Verbindungspool
│   ├── migrate.ts        — SQL-Migrations-Runner
│   ├── index.ts          — Barrel-Export
│   └── migrations/       — 58 SQL-Dateien, Nummern bis 056
├── workspace/            — LESENDER Dateizugriff auf WORKSPACE_PATH
│   ├── index.ts          — Re-Export (nur `readFile`)
│   ├── helpers.ts        — `safePath` (Traversal-Schutz)
│   ├── files.ts          — `readFile`, sonst nichts mehr
│   └── extractor.ts      — Text aus PDF und DOCX ziehen (nur aus Buffern)
├── export/
│   └── docx-render.ts    — DOCX-Erzeugung aus Word-Vorlagen

web/                      — Vue-3-Frontend (eigenes Vite-Projekt)
electron/                 — Hülle des Arbeitsplatz-Programms
├── main.ts               — Fenster, Tray, Menü; findet den Server
├── adresse.ts            — reine Logik: Adressen und Fehlertexte (getestet)
├── server-store.ts       — merkt die Serveradresse
├── einrichtung.html      — Ersteinrichtung UND Fehleranzeige in einem
├── preload.cjs           — einziger Rückkanal, nur für die Einrichtungsseite
└── app-icon.ts           — Symbol als Data-URL
docker/                   — Caddyfile, DB-Init, VPS-Compose
scripts/                  — Installations-, Backup- und Wartungsskripte
tests/                    — Vitest-Suite
docs/                     — diese Dokumentation (VitePress → dist/docs, /docs/)
```

Die Compose-Datei des Firmenservers liegt im **Repo-Root**
(`docker-compose.yml`); unter `docker/` steht nur noch die alte VPS-Fassung.

::: info Was aus der Bot-Zeit verschwunden ist
`src/format.ts` (Markdown-nach-Telegram) und `src/api/email-template.ts`
(Platzhalter für die HTML-Anmeldemails) standen hier lange im Baum, obwohl es
sie nicht mehr gibt. Beide sind mit dem Bot- bzw. E-Mail-Altbestand entfallen.
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
  **erzwingende** Content-Security-Policy (eigene, lockerere Fassung nur für
  `/docs/`, siehe [Zugriffskontrolle](/sicherheit/zugriff)).
- **CORS** — ohne `CORS_ORIGINS` nur `http://localhost:<API_PORT>`.
- **Globaler Rate-Limit** je IP über alle `/api/*`-Routen, danach die
  Auth-Middleware und dahinter der Geld-Filter (`geldFilter`).
- **Anmeldung**: Benutzername und Passwort, **einstufig**. Dazu der
  Setup-Assistent für das erste Admin-Konto. Die frühere Kette aus
  E-Mail-Code, Anmelde-Link und Passwort-Reset ist ersatzlos entfallen — sie
  brauchte einen erreichbaren Mailserver, den es hier nicht gibt.
- **Statische Auslieferung**: die Vue-Oberfläche aus `dist/web`, davor die
  Dokumentation unter `/docs/` aus `dist/docs`.
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

`src/api/email.ts` und `email-template.ts` sind mit dem Ausbau des
Mailversands entfallen — PATIO verschickt nichts mehr. `src/emails/` liegt
noch als **leerer Ordner** herum: Git speichert keine leeren Verzeichnisse,
er steht also nur auf Arbeitsrechnern, die den Ordner noch von früher haben.
Dasselbe gilt für `web/src/stores/` aus der Pinia-Zeit.

### `src/api/totp.ts`

TOTP-Hilfsfunktionen aus der Zeit der App-basierten Zwei-Faktor-Anmeldung.
Die zugehörigen Routen (`routes/auth-2fa.ts`) bleiben für den späteren
Zugang von außen (VPN) unangetastet liegen und sind in `server.ts` bewusst
**nicht eingebunden**, damit nicht zwei Verfahren parallel laufen. Beides
bleibt als Wiederherstellungspfad im Code.

### `src/api/routes/`

**30 Route-Dateien.** Alle unter `/api` eingehängt — mit einer Ausnahme, die
unten steht.

| Datei | Beschreibung |
|---|---|
| `dashboard.ts` | Aggregierte Startseiten-Daten |
| `notes.ts` | Notizen |
| `tasks.ts` | Aufgaben |
| `aufgabensystem.ts` | Eingang, Matrix und Tagesplan — die drei Arbeitsweisen des Aufgabenreiters |
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
| `positionskatalog.ts` | Wiederverwendbare Rechnungspositionen |
| `portfolio.ts` | Portfolio-Cockpit |
| `entscheidungen.ts` | Entscheidungslog je Projekt |
| `aktivitaet.ts` | Was zuletzt passiert ist — abgeleitet, ohne eigene Tabelle |
| `papierkorb.ts` | Gelöschtes ansehen, zurückholen, endgültig entfernen |
| `sicherung.ts` | Status der nächtlichen Sicherung (nur Admin) |
| `admin-users.ts` | Benutzerverwaltung und Projektzuweisung |
| `events.ts` | SSE-Endpunkt für Live-Updates |
| `settings.ts` | Persönliche Einstellungen |
| `branding.ts` | Firmen-Branding, Logo (öffentlicher Teil separat) |
| `templates.ts` | Vorlagen |
| `export-templates.ts` | Word-Exportvorlagen und die Export-Endpunkte |
| `project-modules.ts` | Aktivierbare Module je Projekt |
| `ui-preferences.ts` | Oberflächen-Einstellungen je Benutzer |
| `auth-2fa.ts` | TOTP-Routen — **nicht eingebunden** (`server.ts:509` auskommentiert) |

### `src/api/dateiname.ts`

`contentDisposition(name, art)` baut den Header für jeden Download.

In einem österreichischen Büro trägt fast jede zweite Datei einen Umlaut oder
ein Leerzeichen, ein HTTP-Header darf aber nur ASCII enthalten. RFC 5987 löst
das mit **zwei** Angaben im selben Header: `filename=` trägt eine
ASCII-Notlösung für alte Clients, `filename*=UTF-8''…` den echten Namen
prozentkodiert.

::: warning `filename="${encodeURIComponent(name)}"` ist der falscheste Fall
Genau das stand an drei Stellen. Ein Browser dekodiert innerhalb der
Anführungszeichen **nichts** — der Nutzer bekam wörtlich
`Angebot%20M%C3%BCller%20%26%20S%C3%B6hne.pdf` auf die Platte. Ein einziges
Leerzeichen genügte.

Insgesamt gab es zehn Stellen mit drei verschiedenen und drei falschen
Antworten. Deshalb eine Funktion: bei zehn Einzelkorrekturen macht es die elfte
Stelle wieder falsch.
:::

CR und LF werden entfernt, bevor irgendetwas in den Header geht — Node wirft
darauf `ERR_INVALID_CHAR`, und aus dem Download würde ein 500er. Dateinamen
entstehen bei Exporten aus Freitext (Projektname, Besprechungstitel).

Die Gegenstelle steht im Frontend: `web/src/utils/dateiname.ts` liest
`filename*` **bevorzugt**. Wer nur die einfache Angabe liest, speichert
„Mueller" statt „Müller" und merkt es nie, weil beides plausibel aussieht.

### `src/api/geld.ts`

Die **eine** Stelle, an der Geldbeträge gefiltert werden. Als Middleware hinter
allen Routen eingehängt (`app.use("/api/*", geldFilter)`): sie geht die fertige
JSON-Antwort rekursiv durch und entfernt die bekannten Geldfelder, wenn das
Konto `can_see_money` nicht hat. Admins immer durchgelassen.

Der Grund für diese Bauweise: das Recht müsste sonst an acht Stellen einzeln
geprüft werden — und beim neunten Mal vergisst es jemand. So kann eine neue
Route es gar nicht falsch machen.

### `src/api/projekt-bezug.ts`

Löst `?projectId=<uuid>` an einer einzigen Stelle auf einen Projektnamen auf.
Damit verstehen die Routen eine umbenennungsfeste Alternative zu
`?project=<Name>`, ohne dass alle zwölf Repositories auf IDs umgebaut werden
mussten. Unterscheidet ausdrücklich „ID zeigt ins Leere" (404) von „kein
Projekt angegeben".

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

Die zentrale Stelle für „wer darf was sehen" — niemand setzt sich die Logik
selbst aus `user_projects` zusammen.

**Ermittelt wird die Sichtbarkeit in den Routen** (16 rufen
`getVisibleProjectIds()` auf), **angewandt** in sechs Repositories, die eine
übergebene Liste entgegennehmen. Kein Repository ermittelt sie selbst — eine
Route, die den Aufruf vergisst, liefert deshalb ungefiltert aus.

| Funktion | Bedeutung |
|---|---|
| `getVisibleProjectIds(ctx)` | Sichtbare Projekt-IDs; Admins bekommen den Sentinel `"all"` |
| `canSeeProject(ctx, id)` | Einzelprüfung über die Projekt-UUID |
| `canSeeProjectByName(ctx, name)` | Einzelprüfung über den Projektnamen (kommt in vielen Routen als Pfad-Parameter vor) |

Sichtbarkeitsregeln: Admins sehen alles. Benutzer sehen die Projekte aus der
`user_projects`-Zuordnung. Aufgaben und Termine ohne Projektbezug sind
persönlich (erstellt von mir oder mir zugewiesen), Notizen ohne Projektbezug
ebenso, Dateien zusätzlich über Freigaben.

### `src/data/projektnummer.ts`

Die Regeln der Projektnummer an **einer** Stelle: prüfen und normalisieren
(`pruefeProjektnummer`), Platzhalter erkennen (`istPlatzhalter`), als
Dokumentwert oder Dateinamensteil ausgeben (`alsDokumentwert`,
`alsDateinamensteil`), Doppelvergabe an der Datenbankmeldung erkennen
(`istNummerVergeben`, SQLSTATE 23505).

Was die Nummer fachlich bedeutet, steht unter
[Die Projektnummer](/konzepte/projektnummer).

::: warning `vergleichbar()` gehört nicht in eine Abfrage
Die Funktion schreibt für Vergleiche im Arbeitsspeicher klein. Für die
Datenbank ist sie **falsch**: Postgres' `lower()` und JavaScripts
`toLowerCase()` gehen in 9 von 1181 kleinschreibbaren Zeichen auseinander
(praxisnah das türkische `İ`). Wer damit vorab „ist frei?" prüft, bekommt ein
Ja und danach den eindeutigen Index um die Ohren. Verglichen wird auf beiden
Seiten der Abfrage mit `lower()`.
:::

### `src/data/zeitstempel.ts`

`alsIso()` und `alsIsoOderNull()`. Jedes Datum verlässt den Server als ISO
8601 — auch dann, wenn der Treiber ein `Date`-Objekt liefert und nicht den
Text aus der Spalte.

Vorher gab es zwei Formate nebeneinander: die Oberfläche sortierte
Zeitstempel als Zeichenketten, und `Fri Aug 22 2026 …` sortiert nach dem
**Wochentagsnamen**. `tests/zeitstempel-vertrag.test.ts` hält den Vertrag
fest.

### `src/data/db-search.ts`

Volltextsuche über Notizen, Aufgaben, Projekte und Dateien. Filtert nach
sichtbaren Projekten — die frühere Suche tat das nicht.

Sucht über **`tsvector` mit deutscher Textkonfiguration** (Migration `048`):
generierte Spalten `such_text`, GIN-Index, Abfrage per
`websearch_to_tsquery`, Sortierung nach `ts_rank`. Damit greifen Wortstämme —
„Rechnungen" findet „Rechnung".

`ILIKE` ist **absichtlich geblieben**, und zwar für kurze Felder wie
Projektnamen und Dateinamen: dort sucht man nach Wortteilen („müll" soll
„Wohnhaus Müller" finden), und genau das kann eine Wortstamm-Suche nicht. Die
beiden Verfahren ergänzen sich, das eine hat das andere nicht abgelöst.

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
| `db-positionskatalog.ts` | Wiederverwendbare Rechnungspositionen |
| `db-entscheidungen.ts` | Entscheidungslog je Projekt |
| `db-aktivitaet.ts` | Was zuletzt passiert ist — abgeleitet, ohne eigene Tabelle |
| `db-aufgabensystem.ts` | Rang, Aufwand und Tagesplan der Aufgaben |
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

58 Dateien, `001` bis `056` (zwei Nummern sind doppelt vergeben: `005` und
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
| `042_rev_konfliktschutz.sql` | Konflikt-Zähler `rev` auf allen bearbeitbaren Datenarten |
| `043_geld_recht.sql` | `users.can_see_money` — das Geld-Recht |
| `044_papierkorb.sql` | Projekte werden weich gelöscht (`deleted_at`) |
| `045_entscheidungen.sql` | Entscheidungslog |
| `046_rechnungspositionen.sql` | Rechnungspositionen und Positionskatalog |
| `047_drop_bot_tabellen.sql` | Sechs Tabellen der Bot- und Outlook-Ära entfernt |
| `048_volltextsuche.sql` | `tsvector` mit deutschen Wortstämmen |
| `049_papierkorb_datensaetze.sql` | Papierkorb auch für Notizen, Aufgaben, Termine |
| `050_aufgabensystem.sql` | Rang, geschätzter Aufwand, Tagesplan |
| `051_aufgaben_status.sql` | Aufgaben-Status auf eine Schreibweise (`offen` → `open`) |
| `052_projektnummer.sql` | Die Projektnummer wird Pflicht und eindeutig |
| `053_projektnummer_historie.sql` | Früher vergebene Nummern bleiben auffindbar |
| `054_projektnummer_bereinigung.sql` | Bereinigung deckungsgleich mit der Anwendung |
| `055_telegram_pair_tokens.sql` | Letzter Rest der Bot-Ära: die Pair-Token-Tabelle (nur wenn leer) |
| `056_altbestand_spalten.sql` | Die sieben Outlook-Spalten an `termine` und die drei Bot-Spalten an `users` |

::: tip Die Projektnummer ist die Kennung des Hauses
`052` bis `054` machen aus einem optionalen Stammdatenfeld die Kennung, unter
der ein Projekt geführt wird — Pflicht, eindeutig, korrigierbar, überall
sichtbar. Was das im Betrieb bedeutet, steht auf einer eigenen Seite:
[Die Projektnummer](/konzepte/projektnummer).
:::

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
│   ├── ProjektBezug.vue  — Projektnummer und -name, überall gleich
│   ├── ConfirmDialog.vue, MarkdownRenderer.vue, FileGlyph.vue,
│   │   TeamPicker.vue, SystemStatusBanner.vue
│   └── shell/            — NavRail, AppTopbar, ListPane, DetailPane,
│                           IconBtn, Avatar, StatusDot
├── composables/          — useEvents (Live-Updates), useAufgabensystem,
│                           useBranding, useTheme, useConfirm,
│                           useCurrentUser, useWorkspaceShell
├── utils/                — format.ts (Datum, Zahlen, EUR),
│                           projektnummer.ts (Anzeige und Platzhalter)
├── constants.ts, style.css
└── views/
    ├── DashboardView.vue, CalendarView.vue, SearchView.vue,
    │   FileBrowserView.vue, SettingsView.vue, LoginView.vue, SetupView.vue,
    │   AdminUsersView.vue, AdminAuditView.vue, AdminSicherungView.vue,
    │   AktivitaetView.vue, PapierkorbView.vue, FirmenView.vue,
    │   TeamDetailView.vue, ProjectDetailView.vue
    ├── aufgaben/         — Eingang, Matrix, Mein Tag + Umschalter
    └── notes-v2/, tasks-v2/, team-v2/, projects-v2/, portfolio/
```

::: info Der Aufgabenreiter hat vier Arbeitsweisen
`views/aufgaben/` ist kein eigener Bereich, sondern die drei zusätzlichen
Ansichten des Aufgabenreiters — Eingang, Matrix, Mein Tag — neben der
gewohnten Liste aus `tasks-v2/`. Umgeschaltet wird über einen Streifen in der
Topbar, weil das die einzige Stelle ist, die in allen vier Ansichten gleich
liegt: drei laufen vollbreit, die Liste im Listen-/Detail-Raster.
:::

::: warning Ein fehlender Komponenten-Import fällt hier durch jede Prüfung
Vue rendert eine im Template benutzte, aber nicht importierte Komponente als
unbekanntes HTML-Element — ohne Fehler, ohne Warnung im Produktionsbau. Die
Stelle bleibt schlicht leer. Weder `vue-tsc` noch ESLint beanstanden es
(`eslint-plugin-vue` ist in diesem Projekt bewusst nicht installiert).

Dagegen prüft `tests/vue-komponenten-importiert.test.ts` alle `.vue`-Dateien
und braucht dafür keine Datenbank.
:::

Die `-v2`-Verzeichnisse folgen dem ListPane/DetailPane-Muster des PATIO
Design System v2 und sind beim Weiterbauen den älteren Top-Level-Views
vorzuziehen.

---

## Weitere Verzeichnisse im Repo-Root

| Verzeichnis | Inhalt |
|---|---|
| `tests/` | Vitest-Suite. Ohne `DATABASE_URL` überspringen sich die ACL-, Auth- und Datenbanktests **still** — gemessen am 23.08.2026 laufen 159 von 603, die übrigen 444 werden übersprungen, und der Lauf meldet trotzdem grün — **in der CI** verhindert das ein Wächter |
| `scripts/` | Installation, Sicherung, Rücksicherung, Offline-Pakete, Neuverschlüsselung, Prüfstand des Arbeitsplatz-Programms |
| `electron/` | Hülle des Arbeitsplatz-Programms |
| `docker/` | Caddyfile, Init-SQL für den Postgres-Container, alte VPS-Compose-Datei. **Der Firmenserver-Stack liegt im Repo-Root** (`docker-compose.yml`) |
| `deploy/` | systemd-Einheiten der Sicherung, Samba-Abschnitt |
| `docs/` | Diese Dokumentation (VitePress) — gebaut nach `dist/docs`, ausgeliefert unter `/docs/` |
| `build/` | Programmsymbol für den Bau der `.exe` |
| `data/` | Alt-Konten (`users.json`) — gitignored, **kein Anmeldeweg mehr**, nur Übernahme beim Start |
| `logs/` | Textlog und JSONL-Log — gitignored |
| `release/` | Auslieferungspakete und die gebaute `.exe` — gitignored |
