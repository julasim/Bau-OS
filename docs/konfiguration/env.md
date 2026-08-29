# Umgebungsvariablen (.env)

Alle Einstellungen kommen aus einer `.env`-Datei im Projekt-Root. PATIO lädt
sie beim Start automatisch via `dotenv` (`import "dotenv/config"` in
`src/index.ts` und `src/config.ts`).

Diese Seite listet **jede** Variable, die der Code tatsächlich liest.
Vorlage: `.env.example`. Was hier nicht steht, wird nirgends ausgewertet.

## Übersicht

| Variable | Pflicht | Standardwert | Beschreibung |
|---|---|---|---|
| `WORKSPACE_PATH` | Ja | — | Absoluter Pfad zum internen Ablageordner (Alias: `VAULT_PATH`) |
| `DATABASE_URL` | Ja | — | PostgreSQL-Verbindungsstring |
| `JWT_SECRET` | Ja | — | Secret für die Login-Token, mind. 32 Zeichen |
| `API_PORT` | Nein | `3000` | Port der Web-Oberfläche |
| `PATIO_HOSTNAME` | Nein | `patio.sima.intern` | Rechnername für das Zertifikat |
| `WORKSPACE_HOST_DIR` | Nein | `./workspace` | Ablageordner auf dem Host, den Compose einhängt |
| `BACKUP_DIR` | Nein | `/mnt/patio-backup` | Ziel der nächtlichen Sicherung (Host) |
| `SICHERUNG_DIR` | Nein | `/opt/patio/backup` | Wo der Dienst die Sicherungsstände **liest** (Container) |
| `CORS_ORIGINS` | Nein | `http://localhost:<API_PORT>` | Erlaubte Origins, komma-getrennt |
| `DB_AUTO_MIGRATE` | Nein | `true` | Migrationen beim Start automatisch anwenden |
| `ENCRYPTION_KEY` | Nein | leer | Eigener Schlüssel für verschlüsselte Felder |
| `NODE_ENV` | Nein | `development` | `production` schaltet die Härtung scharf |
| `MAX_UPLOAD_MB` | Nein | `50` | Maximale Dateigröße beim Upload |
| `AUDIT_RETENTION_DAYS` | Nein | `365` | Aufbewahrung der Audit-Einträge in Tagen, `0` = nie löschen |
| `RANG4_VERFALL_TAGE` | Nein | `30` | Verfall von Rang-4-Aufgaben in Tagen, `0` = aus |
| `MELDUNGEN_AUFBEWAHREN_TAGE` | Nein | `60` | Aufbewahrung gelesener Benachrichtigungen in Tagen |
| `API_RATE_LIMIT_REQUESTS` | Nein | `600` | Anfragen pro Zeitfenster und IP |
| `API_RATE_LIMIT_WINDOW_MS` | Nein | `60000` | Zeitfenster des globalen Limits in Millisekunden |
| `LOG_JSONL_MAX_BYTES` | Nein | `5242880` | Dateigröße, ab der das JSONL-Log rotiert |
| `LOG_JSONL_KEEP_FILES` | Nein | `5` | Anzahl rotierter Logdateien |

Zwei aus dieser Tabelle liest der Anwendungscode selbst nie: `PATIO_HOSTNAME`
wertet **Docker Compose** aus und reicht es an Caddy weiter, `BACKUP_DIR`
ebenfalls Compose (als Einhängepunkt) und dazu `scripts/backup.sh`. Nur im
Compose-Betrieb gibt es außerdem `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DB` und `WORKSPACE_HOST_DIR` (siehe unten), und allein
`scripts/backup.sh` liest die sieben Stellschrauben der Sicherung.

## Pflicht-Variablen

Fehlt eine der drei, bricht `src/index.ts` den Start mit Exit-Code 1 ab. Das
ist Absicht: ein Dienst, der ohne seine Pflicht-Konfiguration hochkommt,
sieht für Docker und systemd gesund aus und ist trotzdem tot.

### WORKSPACE_PATH

Absoluter Pfad zu einem **rein internen Ablageordner**. Im Compose-Betrieb ist
das `/workspace` im Container; auf dem Host liegt er unter
`WORKSPACE_HOST_DIR`. `VAULT_PATH` wird als Alias weiterhin akzeptiert.

::: warning Nicht der Ablageort für Uploads
Hier stand „Verzeichnis, in dem PATIO Dokumente als Dateien ablegt". Das
stimmt nicht: was in PATIO hochgeladen wird, landet in der **Datenbank**
(Tabelle `files`), nicht auf der Platte. In diesen Ordner **schreibt die
Anwendung nichts**.

Geblieben ist ein einziger Lesefall: Datei-Datensätze aus der Vault-Zeit,
deren Inhalt damals wirklich im Ordner lag und nie in die Datenbank gewandert
ist. Beim Download fällt `routes/files.ts` dafür auf `readFile()` aus
`src/workspace/` zurück; neu geschrieben wird dort nichts mehr.

Von außen ist der Ordner nicht erreichbar — es gibt keine Freigabe darauf,
und niemand bindet ihn am Arbeitsplatz ein. Zu sehen bekommt ihn nur der
Dienst selbst; deshalb gehört er auf dem Host dem Benutzer mit `uid 1000`,
unter dem der App-Container läuft.

Pflichtangabe bleibt die Variable trotzdem: ohne sie bricht `src/index.ts` den
Start mit Exit-Code 1 ab.
:::

```bash
# Linux
WORKSPACE_PATH=/opt/patio-workspace

# Windows
WORKSPACE_PATH=C:\Users\max\Patio
```

### DATABASE_URL

PATIO läuft **ausschließlich** gegen PostgreSQL. Einen Dateisystem-Modus
gibt es seit dem Umbau zum Firmenserver nicht mehr — alle Repositories in
`src/data/` sind Postgres-Repositories.

```bash
DATABASE_URL=postgres://patio:PASSWORT@localhost:5432/patio
```

Nach dem Setzen prüft der Start die Erreichbarkeit (`checkDbHealth()`).
Antwortet die Datenbank nicht, endet der Prozess mit Exit-Code 1.

::: tip Docker Compose
Im Compose-Setup **nicht** selbst setzen: `docker-compose.yml` baut die
`DATABASE_URL` aus `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`
zusammen und richtet sie auf den Container `postgres`. Der Wert im
`environment:`-Block überschreibt alles aus der `.env`.
:::

### JWT_SECRET

Signiert die Anmelde-Token. Die Web-API ist der einzige Dienst von PATIO —
ohne Secret gäbe es keinen Login und damit keinen Dienst.

```bash
# Secret erzeugen
openssl rand -base64 48

JWT_SECRET=<erzeugter Wert>
```

Mindestens 32 Zeichen. Bei `NODE_ENV=production` verweigert der Start mit
kürzerem Secret den Dienst; im Entwicklungsmodus gibt es nur eine Warnung.

## Web-Oberfläche

### API_PORT

Port, auf dem der Hono-Server hört (`0.0.0.0`). Standard `3000`.

### PATIO_HOSTNAME

Rechnername, unter dem die Arbeitsplätze PATIO erreichen. Caddy stellt dafür
ein Zertifikat aus seiner eigenen, lokalen Zertifizierungsstelle aus.

```bash
PATIO_HOSTNAME=patio.sima.intern
```

Bewusst keine `.local`-Endung — die ist für mDNS reserviert und macht unter
Windows Ärger. Der Name muss im Netz auflösbar sein und das
CA-Wurzelzertifikat auf jedem Arbeitsplatz liegen:
[Zertifikat](/betrieb/zertifikat).

*Hier stand früher `APP_URL` — eine Basis-URL für Links in E-Mails. PATIO
verschickt keine Mails mehr.*

### CORS_ORIGINS

Komma-getrennte Liste erlaubter Origins. Ohne Angabe erlaubt die API nur
`http://localhost:<API_PORT>`. Wird nur gebraucht, wenn die Oberfläche unter
einer anderen Herkunft läuft als die API — im Normalbetrieb liefert PATIO
das Frontend selbst aus, dann ist die Variable überflüssig.

## Datenbank

### DB_AUTO_MIGRATE

Steuert, ob die SQL-Migrationen beim Start automatisch laufen.

```bash
DB_AUTO_MIGRATE=true    # Standard
DB_AUTO_MIGRATE=false   # Migrationen nur explizit über `npm run db:migrate`
```

## Verschlüsselung

### ENCRYPTION_KEY

Eigener Schlüssel für verschlüsselte Datenbankfelder, getrennt vom
`JWT_SECRET`. So reißt eine Rotation des JWT-Secrets die verschlüsselten
Felder nicht mit.

Ist der Wert leer, fällt `src/api/crypto.ts` auf `JWT_SECRET` zurück und der
Start warnt. Ein zu kurzer Schlüssel (< 32 Zeichen) wird ebenfalls nur
bemängelt, nicht abgelehnt.

Umstellung eines bestehenden Systems: [SEC-4-Migration](/sec-4-crypto-migration).

## Betriebsmodus

### NODE_ENV

`production` schaltet die Härtung scharf: ein zu kurzes `JWT_SECRET` führt
dann zum Abbruch statt zu einer Warnung.

## Uploads

### MAX_UPLOAD_MB

Obergrenze je hochgeladener Datei in Megabyte, Standard `50`. Daraus
berechnet `src/config.ts` das Byte-Limit.

## Protokollierung

### AUDIT_RETENTION_DAYS

Wie lange Audit-Einträge (Anmeldungen, fehlgeschlagene Versuche,
Passwort-Resets) aufbewahrt werden. Standard `365` Tage, `0` schaltet das
automatische Löschen ab. Aufgeräumt wird vom Wartungs-Cron
(`src/maintenance.ts`).

### RANG4_VERFALL_TAGE

Nach wie vielen Tagen **ohne Berührung** eine Aufgabe auf Rang 4
(„Streichen") in den Papierkorb wandert. Standard `30`, `0` schaltet den
Verfall ab. Gerechnet wird gegen „zuletzt geändert" — jede Bearbeitung setzt
die Frist zurück.

Verfallen heißt **nicht gelöscht**: die Aufgabe steht danach im Papierkorb und
lässt sich zurückholen. Erledigtes und die Ränge 1 bis 3 sind nie betroffen.
Ausgeführt wird das im selben Wartungs-Cron um 03:15. Hintergrund:
[Das Aufgabensystem](/konzepte/aufgabensystem).

### LOG_JSONL_MAX_BYTES / LOG_JSONL_KEEP_FILES

Das maschinenlesbare JSONL-Log rotiert größenbasiert: bei Überschreitung
wird `patio.jsonl` zu `patio.jsonl.1`, `.1` zu `.2` und so weiter; die älteste
Datei fällt weg. Standard sind 5 MB und 5 Dateien, also höchstens 25 MB.

## Rate-Limiting

### API_RATE_LIMIT_REQUESTS / API_RATE_LIMIT_WINDOW_MS

Globaler Durchsatz je IP über alle `/api/*`-Routen. Standard: 600 Anfragen
pro Minute — großzügig genug, dass normale Bedienung nie limitiert wird.
Wird das Limit überschritten, antwortet die API mit 429 und einem
`Retry-After`-Header.

Das engere Limit für den Login (5 Versuche je IP in 15 Minuten) ist fest im
Code hinterlegt und nicht über die `.env` steuerbar.

## Sicherung

### BACKUP_DIR

Ziel der nächtlichen Sicherung — die externe Festplatte.

```bash
BACKUP_DIR=/mnt/patio-backup
```

`scripts/backup.sh` bricht ab, wenn dort **keine Platte eingehängt** ist.
Ohne diese Prüfung schriebe die Sicherung in das leere Verzeichnis auf der
Systemplatte, meldete Erfolg und liefe still auf. Details:
[Sicherung](/betrieb/sicherung).

Dieselbe Zeile hängt das Verzeichnis **schreibgeschützt** in den
App-Container, damit unter „Verwaltung → Sicherung" sichtbar ist, ob die
Sicherung läuft. Geschrieben wird dort nichts: die Sicherung selbst ist ein
systemd-Timer auf dem Host.

### SICHERUNG_DIR

Wo der Dienst die Sicherungsstände **liest**. Das ist der Pfad **im
Container**, nicht auf dem Host — Compose hängt `BACKUP_DIR` genau dorthin.
Vorgabe `/opt/patio/backup`; im Compose-Betrieb ist also nichts zu setzen.

Gebraucht wird die Variable auf dem Entwicklungsrechner, wo es das Verzeichnis
nicht gibt: ohne sie meldet die Route schlicht „nicht eingerichtet".
`src/api/routes/sicherung.ts` liest sie bei **jedem** Aufruf neu — sonst
bräuchte eine Änderung an der Umgebung einen Neustart, und die Auskunft hätte
sich still auf einen Pfad festgelegt, den es nicht mehr gibt.

### Die Stellschrauben von `scripts/backup.sh`

Sie stehen in derselben `.env`, werden aber nur vom Sicherungsskript gelesen.
Die Vorgaben passen für den Regelbetrieb; wer nichts setzt, bekommt genau sie.

| Variable | Vorgabe | Bedeutung |
|---|---|---|
| `REQUIRE_MOUNT` | `true` | Abbruch, wenn unter `BACKUP_DIR` keine Platte eingehängt ist |
| `KEEP_DAILY` | `7` | Aufbewahrung der täglichen Stände |
| `KEEP_WEEKLY` | `4` | Aufbewahrung der wöchentlichen Stände |
| `KEEP_MONTHLY` | `12` | Aufbewahrung der monatlichen Stände |
| `DISK_WARN_PERCENT` | `80` | Ab dieser Belegung warnt der Lauf |
| `DB_CONTAINER` | `patio-postgres` | Name des Postgres-Containers für den Dump |
| `CADDY_VOLUME` | `patio_caddy_data` | Volume mit dem **privaten Schlüssel der lokalen CA** |

::: warning `REQUIRE_MOUNT` nicht abschalten
Sonst schreibt die Sicherung in das leere Verzeichnis auf der **Systemplatte**,
meldet Erfolg und füllt über Wochen das Wurzel-Dateisystem. Auffallen würde das
in genau dem Moment, in dem man die Sicherung braucht.

Stimmt der Name in `CADDY_VOLUME` nicht, warnt der Lauf und sichert den
CA-Schlüssel **nicht** — ein Wiederaufbau kostet dann den Gang zu jedem
Arbeitsplatz.
:::

### BACKUP_REMOTE

::: danger Diese Variable tut derzeit nichts
Die `.env.example` beschrieb sie als zweites Ziel, auf das jede Sicherung
zusätzlich abgeworfen wird — eine Wechselplatte außer Haus. **Das ist nicht
umgesetzt.** Weder `scripts/backup.sh` noch `scripts/restore.sh` lesen die
Variable; im ganzen Repo kommt sie nur in der `.env.example` und in dieser
Dokumentation vor — in keiner Zeile Code:

```bash
grep -rl BACKUP_REMOTE --exclude-dir=node_modules .
# → .env.example, docs/konfiguration/env.md, docs/betrieb/sicherung.md
```

Wer sie gesetzt hat, hat **keine** Auslagerung. Die Zeile bleibt als Warnung
stehen, statt still gelöscht zu werden.

**Was die Sicherung heute leistet:** Schutz gegen Plattenausfall,
versehentliches Löschen und ein misslungenes Update. **Was sie nicht leistet:**
Schutz gegen Brand, Diebstahl oder einen Verschlüsselungstrojaner — die Platte
steht im selben Raum.
:::

## Entfallene Variablen

Diese liest kein Code mehr. Stehen sie noch in einer alten `.env`, schaden
sie nicht — sie tun aber auch nichts:

| Variable | Entfallen mit |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | Umstellung der Anmeldung auf Passwort — PATIO verschickt nichts mehr |
| `APP_URL` | diente nur Links in E-Mails |
| `OLLAMA_*`, `OPENAI_*` | LLM-Laufzeit entfallen |
| `TELEGRAM_*`, `BOT_TOKEN` | Telegram-Bot entfallen |

::: tip Kein Mailserver nötig
Frühere Fassungen dieser Seite verlangten einen erreichbaren SMTP-Server,
sonst könne sich „niemand anmelden". Das galt für die E-Mail-Codes und ist
mit deren Ausbau hinfällig.
:::

## Nur für Docker Compose

Diese Variablen liest der Anwendungscode nie; sie werden von
`docker-compose.yml` ausgewertet.

| Variable | Standardwert | Zweck |
|---|---|---|
| `POSTGRES_USER` | `patio` | Benutzer im Postgres-Container |
| `POSTGRES_PASSWORD` | `patio` | Passwort im Postgres-Container |
| `POSTGRES_DB` | `patio` | Datenbankname |
| `WORKSPACE_HOST_DIR` | `./workspace` | Host-Verzeichnis, das als `/workspace` eingehängt wird |

::: tip Es gibt genau zwei Compose-Dateien
`docker-compose.yml` im Repo-Root **ist** der Firmenserver-Stack (postgres,
app, caddy — in sich geschlossen). Die alte VPS-Fassung mit gemeinsamem
Edge-Proxy liegt unter `docker/docker-compose.vps.yml`.

Eine Datei `docker/docker-compose.standalone.yml` gibt es **nicht mehr** — sie
ist beim Umbau zur heutigen `docker-compose.yml` geworden. Ebenso entfallen
sind `CADDY_DOMAIN` und `CADDY_EMAIL`: Caddy stellt die Zertifikate über
`tls internal` aus der eigenen lokalen CA aus und braucht dafür weder Domain
noch Mailadresse.
:::

## Beispiel-.env

```bash
# ── Pflicht ───────────────────────────────────────────────
WORKSPACE_PATH=/opt/patio-workspace
DATABASE_URL=postgres://patio:PASSWORT@localhost:5432/patio
JWT_SECRET=<openssl rand -base64 48>

# ── Web-Oberfläche ────────────────────────────────────────
API_PORT=3000
PATIO_HOSTNAME=patio.sima.intern

# ── Sicherung ─────────────────────────────────────────────
BACKUP_DIR=/mnt/patio-backup

# ── Betrieb ───────────────────────────────────────────────
NODE_ENV=production
ENCRYPTION_KEY=<openssl rand -base64 48>
MAX_UPLOAD_MB=50

# ── nur Docker Compose ────────────────────────────────────
POSTGRES_USER=patio
POSTGRES_PASSWORD=
POSTGRES_DB=patio
```

::: danger .env niemals committen
Die Datei enthält `JWT_SECRET`, `ENCRYPTION_KEY` und Datenbank-Zugangsdaten.
Sie steht bereits in `.gitignore`.
:::

## Feste Werte im Code

Nicht über die `.env` steuerbar, nur durch Änderung von `src/config.ts` und
anschließenden Neubau:

| Konstante | Wert | Bedeutung |
|---|---|---|
| `TIMEZONE` | `Europe/Vienna` | Zeitzone für Cron und Zeitstempel |
| `LOCALE` | `de-AT` | Datums- und Zahlenformat |
| `LANGUAGE` | `Deutsch` | Sprache der Oberfläche |
| `RATE_LIMIT_ATTEMPTS` | `5` | Login-Versuche je IP |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Sperrfenster nach zu vielen Versuchen (15 Minuten) |
| `PASSWORD_MIN_LENGTH` | `12` | Mindestlänge; das Passwort ist der einzige Faktor |
| `BCRYPT_ROUNDS` | `12` | Kostenfaktor. Bestehende Hashes tragen ihren eigenen und bleiben gültig |
| `MAX_LOG_LINES` | `500` | Zeilenlimit im lesbaren Textlog |
| `EXTRACT_MAX_CHARS` | `50000` | Zeichenlimit bei der Text-Extraktion aus Dokumenten |

Die vollständige Liste steht in der [Konfigurationsreferenz](/referenz/config).
