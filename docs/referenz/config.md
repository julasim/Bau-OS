# Konfigurationsreferenz

Alle Konstanten aus `src/config.ts`, ausgewertet beim ersten Import. Werte
mit Eintrag in der `.env`-Spalte lassen sich über Umgebungsvariablen
überschreiben; alle anderen sind fest im Code und erfordern einen Neubau
(`npm run build`).

::: tip Zwei Seiten, zwei Blickwinkel
Diese Seite listet die Konstanten so, wie der Code sie sieht. Wer nur wissen
will, was in die `.env` gehört, ist bei den
[Umgebungsvariablen](/konfiguration/env) besser aufgehoben.
:::

## Pflicht beim Start

`src/index.ts` beendet den Prozess mit Exit-Code 1, sobald einer dieser Werte
fehlt — geprüft wird aber nicht alles vorab: zuerst `WORKSPACE_PATH`, dann
`DATABASE_URL`. Danach verbindet sich der Dienst mit der Datenbank und spielt
bei aktivem `DB_AUTO_MIGRATE` die Migrationen ein; `JWT_SECRET` kommt erst im
Anschluss. Fehlt nur das Secret, ist die Datenbank also schon migriert, wenn
der Start abbricht.

| Konstante | `.env`-Variable | Beschreibung |
|---|---|---|
| `WORKSPACE_PATH` | `WORKSPACE_PATH` / `VAULT_PATH` | Absoluter Pfad zum internen Ablageordner |
| `DATABASE_URL` | `DATABASE_URL` | PostgreSQL-Verbindungsstring |
| `JWT_SECRET` | `JWT_SECRET` | Secret für die Anmelde-Token |

## Datenbank

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `DATABASE_URL` | — (Pflicht) | `DATABASE_URL` | Verbindungsstring |
| `DB_ENABLED` | — | — | Abgeleitet: `true`, wenn `DATABASE_URL` gesetzt ist |
| `DB_AUTO_MIGRATE` | `true` | `DB_AUTO_MIGRATE` | Migrationen beim Start anwenden |
| `AUDIT_RETENTION_DAYS` | `365` | `AUDIT_RETENTION_DAYS` | Aufbewahrung der Audit-Einträge in Tagen, `0` = nie löschen |
| `RANG4_VERFALL_TAGE` | `30` | `RANG4_VERFALL_TAGE` | Nach wie vielen Tagen ohne Berührung eine Rang-4-Aufgabe in den Papierkorb wandert, `0` = kein Verfall |
| `MELDUNGEN_AUFBEWAHREN_TAGE` | `60` | `MELDUNGEN_AUFBEWAHREN_TAGE` | Aufbewahrung **gelesener** Benachrichtigungen in Tagen; ungelesene bleiben immer |

::: warning DB_ENABLED ist kein Schalter mehr
`DB_ENABLED` war früher die Weiche zwischen Datenbank- und
Dateisystem-Modus. Den Dateisystem-Modus gibt es nicht mehr — die Konstante
ist nur noch ein abgeleiteter Wert, den der Boot-Check und einige
Altbestand-Stellen lesen. Ohne `DATABASE_URL` startet PATIO gar nicht.
:::

::: warning Auto-Migrate in Produktion
`DB_AUTO_MIGRATE=true` ist bequem für die Entwicklung. Wer den Zeitpunkt der
Migration kontrollieren will, setzt `false` und ruft `npm run db:migrate`
explizit auf.
:::

## Web-API

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `API_PORT` | `3000` | `API_PORT` | Port des Hono-Servers |
| `JWT_SECRET` | — (Pflicht) | `JWT_SECRET` | Secret für die Token-Signatur |
| `API_ENABLED` | — | — | Abgeleitet: `true`, wenn `JWT_SECRET` gesetzt ist |
| `JWT_SECRET_OK` | — | — | Abgeleitet: `true` ab 32 Zeichen Secret-Länge |
| `USERS_FILE` | `<cwd>/data/users.json` | — | Datei der Alt-Konten — **kein Anmeldeweg mehr**, nur Übernahme beim Start |
| `NODE_ENV` | `development` | `NODE_ENV` | Betriebsmodus |
| `IS_PRODUCTION` | — | — | Abgeleitet: `NODE_ENV === "production"` |

Bei `IS_PRODUCTION` und zu kurzem Secret verweigert `startApi()` den Dienst.
Im Entwicklungsmodus bleibt es bei einer Warnung.

## Verschlüsselung

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `ENCRYPTION_KEY` | leer | `ENCRYPTION_KEY` | Eigener Schlüssel für verschlüsselte Felder |
| `ENCRYPTION_KEY_SET` | — | — | Abgeleitet: Schlüssel ist gesetzt |
| `ENCRYPTION_KEY_OK` | — | — | Abgeleitet: Schlüssel hat mindestens 32 Zeichen |

Ohne eigenen Schlüssel fällt die Feld-Verschlüsselung auf `JWT_SECRET`
zurück; der Start warnt. Ein gesetzter, aber zu kurzer Schlüssel wird
ebenfalls nur bemängelt. Umstellung: [SEC-4-Migration](/sec-4-crypto-migration).

## Rate-Limiting

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `RATE_LIMIT_ATTEMPTS` | `5` | — | Login-Versuche je IP |
| `RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | — | Sperrfenster für den Login |
| `API_RATE_LIMIT_REQUESTS` | `600` | `API_RATE_LIMIT_REQUESTS` | Anfragen je IP und Fenster über alle `/api/*` |
| `API_RATE_LIMIT_WINDOW_MS` | `60000` (1 min) | `API_RATE_LIMIT_WINDOW_MS` | Zeitfenster des globalen Limits |

Beide Zähler liegen im Arbeitsspeicher des Prozesses. Das genügt, solange
PATIO als eine Instanz läuft — was der vorgesehene Betrieb ist. Ein
Neustart setzt die Zähler zurück.

## Uploads und Dokumente

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `MAX_UPLOAD_MB` | `50` | `MAX_UPLOAD_MB` | Obergrenze je Datei in Megabyte |
| `MAX_UPLOAD_BYTES` | — | — | Abgeleitet aus `MAX_UPLOAD_MB` |
| `EXTRACT_MAX_CHARS` | `50000` | — | Zeichenlimit bei der Text-Extraktion aus PDF/DOCX |

## Entfallene Konstanten

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`,
`SMTP_SECURE` und `APP_URL` gibt es in `src/config.ts` nicht mehr. Sie
gehörten zum Mailversand für die Anmeldecodes; mit der Umstellung auf den
Passwort-Login ist beides entfallen — PATIO verschickt nichts mehr.

Neu dafür:

| Konstante | Vorgabe | Env | Bedeutung |
|---|---|---|---|
| `PASSWORD_MIN_LENGTH` | `12` | — | Mindestlänge; das Passwort ist der einzige Faktor |
| `BCRYPT_ROUNDS` | `12` | — | Kostenfaktor. Bestehende Hashes tragen ihren eigenen und bleiben gültig |

## Workspace

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `WORKSPACE_PATH` | — (Pflicht) | `WORKSPACE_PATH` / `VAULT_PATH` | Interner Ablageordner; die Anwendung liest nur daraus |

Der Ordner ist von außen nicht erreichbar — es gibt keine Freigabe darauf.
Geschrieben wird dort nichts: Hochgeladenes liegt als `bytea` in der Tabelle
`files`. Gelesen wird nur für Datei-Datensätze aus der Vault-Zeit, deren
Inhalt nie in die Datenbank gewandert ist — Näheres unter
[Dateistruktur](/referenz/dateistruktur).

::: tip Die beiden Altbestand-Ordner sind weg
`WORKSPACE_AGENTS_DIR` (`"Agents"`) und `WORKSPACE_LOGS_DIR`
(`"MEMORY_LOGS"`) standen hier: zwei Ordnernamen aus der Bot-Zeit, die der
Dateibrowser ausblendete. Ihr einziger Leser war `listFolder()`, und der ist
mit den pfadbasierten Routen entfallen — damit auch die beiden Konstanten.
:::

## Protokollierung

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `LOG_FILE` | `<cwd>/logs/patio.log` | — | Lesbares Textlog |
| `MAX_LOG_LINES` | `500` | — | Zeilenlimit des Textlogs (Rotation) |
| `LOG_JSONL_MAX_BYTES` | `5242880` (5 MB) | `LOG_JSONL_MAX_BYTES` | Größe, ab der das JSONL-Log rotiert |
| `LOG_JSONL_KEEP_FILES` | `5` | `LOG_JSONL_KEEP_FILES` | Anzahl aufbewahrter rotierter Dateien |

Das JSONL-Log ist vollständig und maschinenlesbar, das Textlog gekürzt und
für den schnellen Blick gedacht. Der Dateiname ist in `src/config.ts` fest
verdrahtet; er hiess bis zum Umbau zum Firmenserver `bot.log` und wurde beim
Rebrand auf `patio.log` gezogen — den Bot gab es da schon nicht mehr, und der
alte Name führte beim Suchen im Betrieb in die Irre.

## System

| Konstante | Wert | Beschreibung |
|---|---|---|
| `TIMEZONE` | `Europe/Vienna` | Zeitzone für Cron-Jobs und Zeitstempel |
| `LOCALE` | `de-AT` | Datums- und Zahlenformat |
| `LANGUAGE` | `Deutsch` | Sprache der Oberfläche |

## Was es nicht mehr gibt

Mit dem Umbau zum Firmenserver sind diese Konstanten ersatzlos entfallen —
der zugehörige Code ist gelöscht:

| Weggefallen | Was es war |
|---|---|
| `BOT_TOKEN`, `ALLOWED_CHAT_IDS` | Telegram-Bot und dessen Zugriffskontrolle |
| `OPENAI_API_KEY`, `OLLAMA_BASE_URL`, `MAIN_MODEL`, `FAST_MODEL`, … | LLM-Backend und Modellwahl |
| `MAX_TOOL_ROUNDS`, `MAX_SPAWN_DEPTH`, `AGENTS`, `PROTECTED_AGENTS` | Agenten-Laufzeit |
| `MAX_HISTORY_CHARS`, `COMPACT_THRESHOLD`, `KEEP_RECENT_LOGS` | Gesprächsgedächtnis |
| `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | Vektor-Suche über pgvector |
| `WEB_CACHE_TTL_MS`, `FETCH_TIMEOUT_MS`, `MAX_RESPONSE_BYTES` | Websuche und Seitenabruf |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID`, `MS_REDIRECT_URI` | Outlook-Abgleich über Microsoft Graph |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` | Supabase Realtime |
| `DAILY_NOTES_DIR`, `TEMPLATES_DIR`, `ATTACHMENTS_DIR` | Ordnernamen der Dateiablage |

Stehen diese Variablen noch in einer alten `.env`, schaden sie nicht — sie
werden schlicht nirgends gelesen.
