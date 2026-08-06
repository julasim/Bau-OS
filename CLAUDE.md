# PATIO — Project Instructions

> **Produktname:** **PATIO** (P·A·T·I·O — Plan · Architektur · Termine ·
> Intelligenz · Office; zugleich der architektonische Begriff für einen
> Innenhof). Alles Nutzer-Sichtbare (UI, Doku) sagt **PATIO**. Maker-Tag:
> **„by Sima"** — kein Bezug zu „SIMA Architecture" o.ä.
>
> **Repo-Layout:** Der Code (`src/`, `web/`) liegt **direkt im Repo-Root**
> (dieser Ordner; im Workspace unter `apps/patio/`). **Alle `npm`-Befehle aus
> dem Repo-Root ausführen.** Remote: `github.com/julasim/patio`
> (früher `Bau-OS`).

## Zielgruppe (WICHTIG)

> **PATIO ist ein Programm für Architektur-, Planungs- und Projektsteuerungs-
> büros — für die PLANUNG im Büro, NICHT für die Bauausführung/Baustelle.**

- **Primäre Nutzer:** Architekten, Projektleiter im Büro, Sachbearbeiter,
  Statiker, Bauphysik, Hausverwalter, Auftraggeber-Vertreter — Menschen am
  Schreibtisch.
- **Geräte-Annahme:** Desktop, Laptop, gelegentlich Tablet/Phone vom
  Außendienst-Termin. Mobile-UI ist Komfort, nicht Hauptweg.
- **NICHT die Zielgruppe:** Polier, Maurer, Maschinenführer. Sie werden im
  System abgebildet (als `team_members`, in Stundenerfassung, Bautagebuch),
  bedienen es aber nicht.
- **Sprache & Tonalität:** Bürodeutsch, kein Baustellen-Jargon. „Eintrag
  dokumentieren" statt „schnell auf der Baustelle eintippen".

## Umbau zum Firmenserver (LAUFEND — Stand 2026-08-05)

> PATIO wird vom Internet-Stack zum **zentral betriebenen Firmenprogramm im
> eigenen Netz** umgebaut: ein Mini-PC im Büro, kein Internet, echte
> Benutzerrollen, projektweise Rechte. Plan und Arbeitspakete:
> `~/.claude/plans/dynamic-floating-pearl.md`, Zielbild:
> `../../PATIO-Umbau-Firmenserver.md` (dessen Zeile 24 ist überholt — Basis ist
> **dieses** Projekt, nicht `apps/patio-app-lokal`).

> ## ⇥ Woran gerade gearbeitet wird
>
> **Die Warteschlange aus Abschnitt 0 des Plans
> (`~/.claude/plans/dynamic-floating-pearl.md`) ist vollständig abgearbeitet —
> Stufe 1 bis 6.** 265 → 387 Tests, Migrationen 042–048.
>
> **Danach eine eigene Analyserunde** (Abgleich aller 175 Routen gegen die
> Oberfläche, Suche nach TODOs und toten Pfaden). Sie hat drei Dinge zutage
> gefördert, die in keiner Warteschlange standen:
>
> - **Notizen: Rechteprüfung und Zugriff betrafen verschiedene Datensätze.**
>   Zwei Auflöser mit unterschiedlicher Sortierung — bei gleichnamigen Notizen
>   wurde die eine freigegeben und die andere ausgeliefert, auch aus einem
>   fremden Projekt. Jetzt ein Auflöser, danach nur noch über die ID.
>   Im selben Zug das TODO aus `notes.ts:26`: eine Notiz ohne Projekt gehört
>   ihrem Verfasser (vorher konnte man sie anlegen und nie wieder sehen).
> - **Der Dokumentenordner war über HTTP offen.** `GET /files/read?path=`,
>   `POST /files/mkdir` und `DELETE /files {path}` arbeiteten ohne jede
>   Rechteprüfung im Dateisystem — dem Samba-Verzeichnis „Dokumente". Entfernt
>   statt bewacht: Dateien liegen als `bytea` in der Datenbank, die Wege waren
>   von der Oberfläche nie erreichbar.
> - **Firmenverwaltung war unerreichbar.** Die API gab es seit Migration 006
>   vollständig, aber kein `/companies`-Aufruf im Frontend. Neu: Ansicht
>   `Firmen` samt **Zusammenführen** von Dubletten, die durch die
>   automatische Anlage aus Freitext entstehen.
>
> | Stufe | Ergebnis |
> |---|---|
> | 1 Datenverlust | `db-notes` rät nicht mehr; Konflikt-Zähler `rev` auf allen neun bearbeitbaren Datenarten (042) |
> | 2 Rechte | Word-Export war die offene Hintertür; bürointerne Konfiguration war für jeden schreibbar; **Geld-Recht** (043); Team-Liste verriet alle Projektnamen |
> | 3 Papierkorb | Löschen setzt nur noch `deleted_at` (044); Kaskaden feuern erst beim endgültigen Entfernen |
> | 4 Fachliches | Entscheidungslog (045) · Rechnungspositionen + Positionskatalog (046) · Aktivität · Sicherungs-Status · `?projectId=` |
> | 5 Altbestand | 72 tote `DB_ENABLED`-Abfragen; JSON-Konten abgeschaltet; sechs Tabellen der Bot-/Outlook-Ära entfernt (047) |
> | 6 Suche | `tsvector` mit deutschen Wortstämmen + `ts_rank`, ILIKE bleibt für Wortteile in kurzen Feldern (048) |
>
> **Offen und für Julius zu entscheiden:** die Samba-Freigabe „Dokumente"
> (`/opt/patio-workspace`, AP1-E) und die Dateiablage der Anwendung zeigen
> **verschiedene Dinge**. Uploads landen in der Datenbank, die Freigabe zeigt
> das Verzeichnis. Beides nebeneinander ist vertretbar (die Freigabe für
> Pläne und CAD, die Anwendung für alles mit Projektbezug), aber es sollte
> eine bewusste Entscheidung sein und in der Doku stehen.
>
> **Was als Nächstes ansteht** — nichts davon steht mehr in der Warteschlange,
> das sind die großen Pakete aus dem Plan: **AP9** Oberfläche aus PATIO
> Desktop übernehmen · **AP12** Arbeitsplatz-Programm (Electron-Hülle) ·
> **AP10** MCP-Dossiers · **AP11** Datenübernahme · **AP13** Export/PDF ·
> **AP14** Benachrichtigungen · **AP15** Board · **AP17** VPN.
>
> **Bewusst offen geblieben**, mit Begründung im jeweiligen Commit:
> - Ein **Papierkorb für einzelne Datensätze** (Notizen, Aufgaben, Termine).
>   Stufe 3 zielt auf Projekte, dort ist der Schaden größer.
> - Der **Vault-Zweig im Datei-Upload** ist unerreichbar, aber sein Ausbau
>   baut die Upload-Route um — eigener Schritt, keine Aufräumrunde.
> - **`?projectId=` in den Repos.** Aufgelöst wird an einer Stelle
>   (`src/api/projekt-bezug.ts`); alle zwölf Repos auf IDs umzustellen wäre
>   sauberer, aber ein Umbau quer durch den Baum ohne zusätzlichen Gewinn.

**AP0 abgeschlossen.** Entfernt: Telegram-Bot, LLM-/Agenten-Laufzeit,
MCP-Client, Embeddings, DuckDuckGo-Websuche, Outlook-Abgleich und die
Filesystem-Repos — rund **16.000 Zeilen**. Der Einstiegspunkt `src/index.ts`
ist nicht mehr bot-, sondern API-zentriert.

**Es gibt keinen Dateisystem-Modus mehr.** Der Dienst laeuft immer gegen
PostgreSQL, und `src/index.ts` bricht ohne `DATABASE_URL` bzw. `JWT_SECRET`
hart ab — vorher lief er weiter, galt fuer Docker als gesund und lieferte bei
jedem Datenzugriff einen 500er. Alle Repos sind non-nullable; die 503-Guards
sind aus den Domaenen-Routen verschwunden, in `src/api/routes/files.ts` stehen
aber noch 17 `DB_ENABLED`-Abfragen (Altbestand, harmlos, aber irrefuehrend).
Von `src/workspace/` bleibt nur der echte Dateizugriff (1.774 → 245 Zeilen) —
Dokumente liegen weiterhin als Dateien.

**AP1 abgeschlossen (2026-08-06).** Der Server kann aufgesetzt werden:
Anmeldung, Compose-Stack, Zertifikat, Sicherung, Netzfreigabe, Offline-Updates
und das Einrichtungshandbuch stehen. Fünf Commits (`01a933f`…`e82c2a3`),
**265 Tests**.

> **Die Anmeldung ist einstufig — Passwort, kein zweiter Faktor** (Entscheid
> Julius, 2026-08-06). Der E-Mail-Zweig ist ersatzlos entfallen: er verzweigte
> JEDEN Datenbank-Benutzer in den SMTP-Versand, der ohne Internet scheiterte —
> niemand kam hinein außer über das einstufige JSON-Konto. Mindestlänge 12,
> bcrypt 12, beides zentral in `src/config.ts`. `src/api/totp.ts` und
> `routes/auth-2fa.ts` bleiben **unangetastet** liegen; der zweite Faktor
> kommt mit dem VPN (AP17) zurück.

> **Betriebsform: alles in Docker.** `docker-compose.yml` im Repo-Root ist der
> in sich geschlossene Firmenserver-Stack (postgres + app + caddy); die
> VPS-Variante liegt unter `docker/docker-compose.vps.yml`. Auf dem Server
> wird **nie gebaut** — `scripts/release-offline.sh` schnürt ein Paket,
> `scripts/update-offline.sh` spielt es ein.

> **TLS aus einer eigenen lokalen CA** (`tls internal` in `docker/Caddyfile`).
> Der private Schlüssel liegt im Volume `caddy_data` und **gehört in die
> Sicherung** — ohne ihn muss nach einem Wiederaufbau jemand an jeden
> Arbeitsplatz.

**Der Rest des JSON-Konten-Fallbacks** in `src/api/auth.ts` wartet weiter auf
AP7 (jetzt „Konten und Sitzungen").

> Die Migrationen `022`–`024` (Microsoft-Tabellen und die `ms_*`-Spalten an
> `termine`) bleiben vorerst stehen — forward-only, und ein `DROP` wäre
> unumkehrbar. Sie werden mit dem Schema-Paket abgeräumt.

> **pgvector wird nicht mehr gebraucht.** `001_init.sql` legt weder die
> Extension noch Vektor-Spalten an, `040` raeumt die Reste aus bestehenden
> Datenbanken, `041` entfernt die Extension selbst (mehrfach abgesichert: ist
> sie nicht da oder haengt eine fremde Spalte daran, passiert nichts). Beide
> Compose-Dateien laufen auf `postgres:16`. Nachgewiesen an einer frisch
> migrierten Datenbank: nur `pg_trgm`, `plpgsql`, `unaccent`, `uuid-ossp`.
> `tests/db.test.ts` haelt das fest — der Sweep ueber alle Migrationsdateien
> laeuft **ohne** Datenbank und greift damit auch in einer DB-losen CI.

**Was als Nächstes ansteht** (Reihenfolge aus dem Plan): Volltextsuche auf
`tsvector` heben · Schema ergänzen · Konfliktschutz (`rev`) · Papierkorb ·
Rückportierung aus `apps/patio-app-lokal` · Konten und Sitzungen · Rechte
scharf schalten · **Oberfläche aus PATIO Desktop übernehmen** (bestätigt
2026-08-06 — deshalb wurde in AP1 bewusst nicht ins heutige Frontend
investiert; das Desktop-Designsystem nutzt reine Systemschriften und ist
damit von sich aus außenkontaktfrei).

## Stack & Deployment

- **Backend:** Node.js + TypeScript + Hono (HTTP-API), PostgreSQL via
  postgres.js. Kein LLM, kein Bot, kein Außenkontakt im Betrieb.
- **Frontend:** Vue 3 (Composition API) + Pinia + Vite + Tailwind v4 (`web/`).
- **Deployment:** ein in sich geschlossener Compose-Stack unter `/opt/patio`.
  Drei Container: `patio-postgres`, `patio-app`, `patio-caddy`. Nur Caddy hat
  Ports nach außen (80/443) und terminiert TLS mit einem Zertifikat aus der
  **eigenen lokalen CA**. Die SSE-Route `/api/events` wird ungepuffert
  durchgeleitet — wird sie gepuffert, bleiben Änderungen der Kollegen
  unsichtbar. Die frühere VPS-Fassung mit gemeinsamem `edge-caddy` liegt unter
  `docker/docker-compose.vps.yml`.

**Deploy/Update auf dem Server:** `git pull` gibt es dort nicht — der Rechner
hat kein Internet, und gebaut wird auf ihm nie.

```bash
# Entwicklungsrechner (DATABASE_URL ist Pflicht — sonst laufen die Tests halb)
DATABASE_URL="postgres://patio:patio@<WSL-IP>:5432/patio"   bash scripts/release-offline.sh

# Server, Paket per USB-Stick
sudo patio update patio-<version>.tar.gz
```

DB-Migrationen laufen beim Start automatisch (`DB_AUTO_MIGRATE`, default an).

## Befehle (aus dem Repo-Root)

```bash
npm run dev          # tsx watch src/index.ts (API)
npm run dev:web      # Vite Dev-Server fürs Frontend
npm run build        # tsc → dist/ (kopiert db/migrations/ mit)
npm run build:all    # tsc + Vite-Build von web/
npm run start        # node dist/index.js (Produktion)

npm test             # vitest run (alle Tests, 387 — nur MIT Datenbank, siehe unten)
npx vitest run tests/<file>.test.ts   # einzelne Datei
npm run lint  /  npm run lint:fix
npm run format

npm run db:migrate   # Migrationen anwenden (nur mit DATABASE_URL)
npm run db:status    # Migrations-Status anzeigen
```

Husky + lint-staged formatieren/linten gestagte `.ts`/`.vue`-Dateien beim
Commit; ein Pre-Push-Hook lässt `npm test` laufen.

> **Prüfbereiche:** `npm run lint` deckt seit dieser Runde `src/`, `tests/`,
> `scripts/` **und** `web/src` ab — vorher nur die ersten beiden. `.vue`-Dateien
> bleiben aussen vor (kein `eslint-plugin-vue`), dafür greift `vue-tsc`.
> Für `scripts/` gibt es jetzt `tsconfig.scripts.json`: `npx tsc --noEmit -p
> tsconfig.scripts.json`. Grund: in `scripts/migrate-vault-to-db.ts` stand
> monatelang ein Import auf ein `VAULT_PATH`, das es gar nicht gibt — das
> Skript brach beim Start ab, und keine Prüfung sah je in den Ordner.

> **`npm test` ohne `DATABASE_URL` überspringt still 278 von 387 Tests** —
> und zwar genau die ACL-, Auth- und DB-Tests (`describe.skipIf(!HAS_DB)` in
> 32 Testdateien; `HAS_DB` selbst kommt aus `tests/helpers/acl-fixture.ts`).
> Von den 109, die dann laufen, **scheitern vier** — seit `tests/db.test.ts`
> dazukam, meldet die Suite ohne Datenbank also nicht mehr grün, sondern rot.
> Das ist eine Verbesserung: vorher sah ein halber Lauf wie ein voller aus.
> **Diese Zahl beim Hinzufügen von Tests mitpflegen** — sie war schon einmal
> veraltet, ausgerechnet die Warnung vor stiller Nicht-Prüfung. Die
> Test-Datenbank ist der Container `patio-test-db` in **WSL Ubuntu-24.04**; von
> Windows aus ist sie **nicht** über `localhost` erreichbar, es braucht die
> WSL-IP (`wsl -d Ubuntu-24.04 -- hostname -I`, ändert sich bei jedem Start):
>
> ```bash
> DATABASE_URL="postgres://patio:patio@<WSL-IP>:5432/patio" npm test
> ```

## Architektur-Kern

- **Entry:** `src/index.ts` — lädt `.env` → DB-Healthcheck + Auto-Migrate →
  Hono-API. Einziges Support-Modul: `maintenance.ts` (Audit-Retention-Cron).
- **Data-Layer:** `src/data/index.ts` ist die **einzige** Import-Fläche — nie
  direkt aus `db-*` importieren. Alle Repos sind Postgres und non-nullable;
  einen Filesystem-Fallback gibt es nicht mehr.
- **Volltextsuche:** `src/data/db-search.ts` — sucht über Notizen, Aufgaben,
  Projekte und Dateien und **filtert nach sichtbaren Projekten** (die alte
  Suche tat das nicht). Sucht derzeit per `ILIKE`; der Umbau auf `tsvector`
  ist ein eigenes Arbeitspaket und tauscht nur die WHERE-Klauseln aus.
  **Typ-Casts sind Pflicht:** `project_id` ist `uuid`, die Scope-IDs kommen als
  Strings — ohne `::uuid[]` wirft Postgres `operator does not exist: uuid =
  text`, und zwar nur bei Nicht-Admins (siehe `tests/api-search-acl.test.ts`).
- **Migrationen:** plain SQL in `src/db/migrations/`, `NNN_name.sql`,
  forward-only, idempotent (`IF NOT EXISTS` / DO-Block-Guards). Runner
  (`src/db/migrate.ts`) trackt per Dateiname in `_migrations` (keine
  Prüfsumme), jede Migration in eigener Transaktion, Advisory-Lock gegen
  parallele Starts. Aktuellste: `048_volltextsuche.sql`. **Schema-Lektion:**
  Beim JOIN müssen Typen passen — `034` hat `chat_messages.session_id` von TEXT
  auf UUID umgestellt (passend zu `chat_sessions.id`), sonst
  `operator does not exist: text = uuid`.
- **Projektsteuerung (PM, Migrationen 035–038):** Leistungsphasen
  (`035_project_phases`, Routes `phases.ts`, Repo `db-phases.ts`, Web
  `projects-v2/ProjectPhasesTab.vue`) · **Gantt-Zeitleiste** mit
  Phasen-Abhängigkeiten + Auto-Meilenstein (`038_phase_gantt`) · **Honorar-
  Ökonomie**: Stundensatz + Deckungsbeitrag (`037_hourly_rate`,
  `036_time_entry_phase`) · **Rechnungen** (Routes `invoices.ts`, Repo
  `db-invoices.ts`, Web `projects-v2/ProjectInvoicesTab.vue`; ACL beachtet) ·
  **Portfolio-Cockpit** (Routes `portfolio.ts`, Repo `db-portfolio.ts`, Web
  `views/portfolio/`) mit echten Fortschrittszahlen. `039` benennt nur den
  internen Kalender-Enum-Wert (`bau-os` → `patio`) um.
- **Web-API + Frontend:** Hono in `src/api/server.ts` (Port `API_PORT`,
  default 3000), JWT-Auth (`authMiddleware` setzt `userId`/`userRole`/
  `dbUser`). Routes in `src/api/routes/` spiegeln die Tool-Fläche. Vue-SPA
  in `web/` — App-Shell `web/src/components/AppLayout.vue` (3-Spalten-Grid
  `.app-v2`: NavRail + ListPane + Detail).
- **Config:** `src/config.ts` — alle Tunables als Konstanten.

## Frontend / PATIO Design System v2 (WICHTIG bei UI-Arbeit)

Das gesamte Frontend wurde auf das **PATIO Design System v2** umgestellt
(Stand Juni 2026). Beim Bauen an Views unbedingt einhalten:

- **Design-Tokens sind die einzige Quelle der Wahrheit:**
  `web/src/patio-tokens.css` (Brand/Produkt — identisch mit der Mainpage, kein
  zweites Brand-System), `patio-components.css` (Komponenten-Styles wie
  `ap-panel`/`ap-grid`/`pt-tabs`), `patio-shell.css` (App-Shell-Layout). Keine
  Hardcode-Farben/-Abstände — Tokens (`var(--…)`) verwenden. Niveau-Referenz:
  Linear/Vercel/Stripe; Prinzip: monochrom, flach, präzise, viel Ruhe.
  Schrift: **Inter / Inter Tight / JetBrains Mono**.
- **Shell-Bausteine** in `web/src/components/shell/`: `NavRail`, `ListPane`,
  `DetailPane`, `IconBtn`, `Avatar`, `StatusDot`. Die NavRail ist
  **kontext-wechselnd** — im Projekt zeigt sie die Projekt-Module (statt einer
  Tab-Leiste).
- **v2-Views** liegen in `web/src/views/<bereich>-v2/` (`notes-v2`,
  `projects-v2`, `tasks-v2`, `team-v2`) im ListPane/DetailPane-Muster. Daneben
  existieren noch ältere Top-Level-Views (`NotesView.vue`, …) — beim Weiterbauen
  die **v2-Variante** bevorzugen.
- **Projekt-Detail** (`ProjectDetailView.vue`) läuft **vollbreit** (keine
  ListPane), Module über die kontext-wechselnde Sidebar.
- **Keine Emojis in der UI.** Stattdessen Line-Icons über `BIcon.vue` (Glyph in
  `BIcon.vue` ergänzen) oder schlichten Text.

## Commit- & Verifikations-Strategie

- Pro Feature ein Commit, mit Migration-Referenz bei Schema-Änderungen.
- Vor jedem Commit: `npx tsc --noEmit`,
  `npx vue-tsc --noEmit -p web/tsconfig.json`, `npm test`.
- Push auf `main` → Server holt's per `git pull` (siehe Deploy oben).
- Lokale `.claude/`-Tooling-Ordner **nicht** committen (kein `git add -A`).

## Tonalität in Code & UX

**Wer benutzt das? Ein Architekt am Schreibtisch, kein Bauarbeiter auf der
Leiter.** Texte und Workflows strukturiert, präzise, doku-orientiert.
Bürodeutsch, kein Hype-Wording.
