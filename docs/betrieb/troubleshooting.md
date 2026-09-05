# Troubleshooting

Häufige Probleme und ihre Ursachen. Die Reihenfolge folgt der Häufigkeit,
nicht der Dramatik.

::: tip Erst Logs, dann raten
Vor jeder Vermutung: frische Logs holen — `docker compose logs --since 2m
app`. PATIO ist bei Startfehlern ausgesprochen redselig; die Meldung nennt
fast immer die Ursache.

**Nicht** `journalctl -u patio`: eine solche Unit gibt es nicht, die Anwendung
läuft nur als Compose-Stack. Über systemd laufen ausschließlich die
Sicherungs-Einheiten (`journalctl -u patio-backup`).
:::

---

## Der Dienst startet nicht

PATIO bricht bei fehlender Pflicht-Konfiguration **absichtlich** mit
Exit-Code 1 ab. Ein Dienst, der ohne sie hochkommt, sieht für Docker und
systemd gesund aus und ist trotzdem tot.

| Meldung im Log | Ursache | Abhilfe |
|---|---|---|
| `WORKSPACE_PATH fehlt in .env` | Dokumentenverzeichnis nicht gesetzt | `WORKSPACE_PATH` eintragen |
| `DATABASE_URL fehlt in .env` | Keine Datenbank konfiguriert | `DATABASE_URL` eintragen; im Compose-Aufbau `POSTGRES_*` prüfen |
| `die Datenbank antwortet nicht` | Postgres läuft nicht oder Zugangsdaten falsch | siehe unten |
| `JWT_SECRET fehlt in .env` | Kein Secret gesetzt | `openssl rand -base64 48` |
| `JWT_SECRET zu kurz` | Unter 32 Zeichen bei `NODE_ENV=production` | längeres Secret setzen |

::: warning Aus dem falschen Verzeichnis gestartet
`docker compose` findet die `.env` nur, wenn es aus dem Projektverzeichnis
läuft. Aus dem Home-Verzeichnis aufgerufen kommen Warnungen der Art
`variable is not set` und anschließend `role "..." does not exist`. Nicht
die Datenbank ist kaputt — der Pfad ist falsch.
:::

---

## Datenbank nicht erreichbar

```bash
docker compose ps
docker compose logs postgres --tail 50
docker compose exec postgres pg_isready -U patio
```

Häufige Ursachen:

- Der Postgres-Container ist noch nicht `healthy`, wenn `app` startet. Das
  `depends_on` mit `condition: service_healthy` deckt den Normalfall ab; nach
  einem Stromausfall kann die Datenbank länger für die Wiederherstellung
  brauchen. `restart: always` fängt das ab — im Log stehen dann ein bis zwei
  fehlgeschlagene Startversuche.
- Passwort in der `.env` geändert, aber das Datenbank-Volume ist alt.
  `POSTGRES_PASSWORD` wirkt **nur beim allerersten Anlegen** des Volumes.
  Danach muss das Passwort in der Datenbank selbst geändert werden.
- **Zweiter Installationsversuch über einem alten Volume** — siehe den Kasten
  unten. Der häufigste Fall, und der mit der irreführendsten Meldung.
- Migrationen hängen. Der Runner nimmt einen Advisory-Lock; ein hart
  abgeschossener Prozess kann ihn kurzzeitig halten. Neustart.

::: warning `password authentication failed for user "patio"` nach einer Neuinstallation
Der zweite Installationsversuch auf derselben Maschine läuft hier hinein, und
die Meldung des Dienstes zeigt in die falsche Richtung:

```
password authentication failed for user "patio"
DATABASE_URL ist gesetzt, aber die Datenbank antwortet nicht.
Postgres starten bzw. Host/Port/Zugangsdaten in DATABASE_URL pruefen.
```

Postgres **läuft** aber (der Container ist `healthy`), und die `.env` ist in
sich richtig. Sie passt nur nicht zu dem, was im Volume steht:
`install-server.sh` erzeugt bei jedem Lauf ein neues Zufallspasswort, und
Postgres übernimmt eines **nur bei leerem Datenverzeichnis**. Das Volume
`patio_postgres_data` überlebt ein `rm -rf /opt/patio` — es liegt in Docker,
nicht im Installationsverzeichnis.

Wer der Meldung folgt, sucht am Netz, an den Ports und an der `.env`, also
überall außer an der Stelle. Der App-Container läuft dabei in einer
Neustartschleife.

`install-server.sh` bricht seit dem 28.08.2026 vorher ab und sagt, was zu tun
ist. Für den Fall, dass man doch davorsteht:

```bash
docker volume ls | grep patio      # ist es wirklich da?
# Nichts Wertvolles darin — löscht die Datenbank unwiderruflich:
cd /opt/patio && docker compose down
docker volume rm patio_postgres_data
sudo bash dabei/scripts/install-server.sh patio-<version>.tar.gz
```

Gehört das Volume dagegen zu einer **bestehenden** Installation, fehlt nur die
passende `.env`. Die muss aus der Sicherung zurück — ohne sie ist das Volume
ohnehin nicht mehr vollständig lesbar, denn der `ENCRYPTION_KEY` steht darin.
:::

---

## Änderung an der .env wirkt nicht

`docker compose restart` liest die `.env` **nicht** neu ein.

```bash
docker compose up -d --force-recreate app
docker compose exec app sh -c 'echo $PATIO_HOSTNAME'
```

::: tip `docker compose restart` reicht nicht — `patio restart` schon
Ein `docker compose restart app` liest die `.env` **nicht** neu. Nötig ist
`docker compose up -d --force-recreate app`. Das ist die häufigste Ursache
dafür, dass eine geänderte Einstellung „nicht greift".

**`patio restart` erzeugt die Container seit dem 30.08.2026 neu** und liest die
`.env` damit mit. Vorher rief der Befehl schlicht `docker compose restart`
durch — wer nach einer Änderung den naheliegenden Befehl nahm, arbeitete also
weiter mit den alten Werten, ohne jeden Hinweis.
:::

::: warning Zwei Werte lassen sich nicht per .env ändern
`docker-compose.yml` setzt `DATABASE_URL` und `WORKSPACE_PATH` im
`environment:`-Block. Was dort steht, überschreibt die `.env` immer. Wer
diese Werte ändern will, muss die Compose-Datei anpassen.
:::

---

## Niemand kann sich anmelden

Die Anmeldung braucht **Benutzername und Passwort**, sonst nichts. Kein Code,
keine E-Mail, kein zweiter Faktor.

```bash
patio logs 100 | grep -i "login"
docker exec patio-postgres psql -U patio -d patio -c   "SELECT username, role FROM users ORDER BY created_at"
```

| Symptom | Ursache |
|---|---|
| „Benutzername oder Passwort falsch" | genau das — die Meldung ist absichtlich gleich für beide Fälle, damit sie keine Konten verrät |
| HTTP 429 | Ratebremse: 5 Fehlversuche je IP in 15 Minuten |
| Seite lädt nicht, Zertifikatswarnung | kein Anmeldeproblem — siehe [Zertifikat](/betrieb/zertifikat) |
| Der Einrichtungsassistent erscheint, obwohl Konten existieren | die Datenbank antwortet, enthält aber keine Konten — meist ein frisch angelegtes Volume statt dem mit den Daten. Antwortet sie gar nicht, erscheint der Assistent **nicht**; dann bleibt die Anmeldeseite stehen |

::: tip Passwort zurücksetzen
Über einen anderen Admin unter `/admin/users`. Gibt es keinen zweiten Admin
mehr, hilft nur der Weg über die Datenbank — dafür muss ein bcrypt-Hash
erzeugt werden:

```bash
docker exec patio-app node -e   "require('bcrypt').hash('NeuesPasswort123', 12).then(h => console.log(h))"
docker exec patio-postgres psql -U patio -d patio -c   "UPDATE users SET password_hash = '<hash>' WHERE username = 'admin'"
```

Deshalb: **immer zwei Administratoren.**
:::

---

## Anmeldung gesperrt (HTTP 429)

Nach 5 fehlgeschlagenen Versuchen ist die IP 15 Minuten gesperrt. Die Zähler
liegen im Arbeitsspeicher des Prozesses:

```bash
docker compose restart app       # setzt die Zähler zurück
```

Der globale Rate-Limit (600 Anfragen pro Minute und IP) greift im normalen
Betrieb nicht. Schlägt er zu, obwohl nur wenige Personen arbeiten, steht
vermutlich ein Proxy davor, der alle Anfragen unter derselben IP zeigt —
dann muss er `X-Forwarded-For` korrekt setzen.

---

## Live-Updates kommen nicht an

Änderungen anderer Arbeitsplätze erscheinen erst nach dem Neuladen.

Ursache ist fast immer der Reverse-Proxy: er puffert die SSE-Verbindung
`/api/events`. Bei Caddy:

```text
@stream path /api/events*
reverse_proxy @stream app:3000 {
    flush_interval -1
    transport http { read_timeout 24h  write_timeout 24h }
}
```

Bei nginx entsprechend `proxy_buffering off;` und ein großzügiges
`proxy_read_timeout`.

Prüfen, ob überhaupt jemand verbunden ist. Im Anwendungsprotokoll steht das
**nicht** — PATIO schreibt beim Auf- und Abbau einer Live-Verbindung nichts
hinein. Die Zahl der offenen Verbindungen liefert ein eigener Endpunkt hinter
der Anmeldung:

```bash
# 1. Anmelden — die Antwort enthält {"token": "…"}
docker exec patio-app curl -s -X POST localhost:3000/api/auth/login      -H "Content-Type: application/json"      -d '{"username":"admin","password":"<Passwort>"}'

# 2. Verbindungen zählen
docker exec patio-app curl -s "localhost:3000/api/events/status?token=<TOKEN>"
# → {"connectedClients":3}
```

Steht dort eine Zahl, während die Arbeitsplätze nichts sehen, liegt es an der
Pufferung weiter oben. Steht dort `0`, während mehrere Arbeitsplätze geöffnet
sind, kommt die Verbindung gar nicht bis zur Anwendung.

---

## Upload schlägt fehl

Hochgeladene Dateien landen als `bytea` in der Datenbank; auf der Platte des
Servers wird dabei nichts angelegt. Die Rechte am Dokumentenordner spielen
beim Upload deshalb keine Rolle.

| Symptom | Ursache |
|---|---|
| „Kein Zugriff auf dieses Projekt" (403) | Das Konto ist dem Projekt nicht zugewiesen |
| „Kein Speicherplatz mehr auf dem Server" (507) | Platte voll — die Datei liegt in der Datenbank, die Datenbank auf der Platte |
| Datei wird abgelehnt (415) | Endung nicht erlaubt oder Inhalt passt nicht zur Endung |
| Datei zu groß (413) | über `MAX_UPLOAD_MB` (Standard 50) |

Erlaubte Endungen: `pdf`, `docx`, `doc`, `xlsx`, `xls`, `csv`, `txt`, `md`,
`png`, `jpg`, `jpeg`, `gif`, `webp`, `zip`, `json`, `xml`. Zusätzlich prüft
PATIO die Magic Bytes: eine als `.png` getarnte HTML-Datei wird abgelehnt.

::: warning Scheitert ein HERUNTERLADEN, sind es doch die Dateirechte
Einträge aus der Vault-Zeit haben keinen Inhalt in der Datenbank; für sie
liest die Anwendung die Datei aus `/opt/patio-workspace`. Gehört dieser Ordner
nicht der Kennung 1000, unter der der Dienst im Container läuft, endet der
Download mit „Kein Zugriff auf die Datei bzw. den Ordner" (403):

```bash
ls -la /opt/patio-workspace
sudo chown -R 1000:1000 /opt/patio-workspace    # Container läuft als UID 1000
```

Wer das Verzeichnis stattdessen dem Dienstbenutzer eines Systemkontos zuweist
(`useradd -r` vergibt eine uid **unter** 1000), nimmt dem Dienst den Zugriff —
und der Fehler zeigt sich an ganz anderer Stelle.
:::

---

## Suche findet nichts oder wirft einen Fehler

Die Volltextsuche filtert auf die sichtbaren Projekte. Zwei typische Fälle:

- **Ein Benutzer findet weniger als ein Admin.** Das ist beabsichtigt — er
  sieht nur zugewiesene Projekte.
- **Fehler `operator does not exist: uuid = text`.** Ein fehlender
  Typ-Cast in einer Suchabfrage. Tritt ausschließlich bei Nicht-Admins auf,
  weil Admins gar nicht gefiltert werden — deshalb fällt so etwas beim Test
  mit einem Admin-Konto nie auf.

---

## Antwort dauert zu lange (HTTP 503)

```
Die Anfrage hat zu lange gedauert. Bitte den Umfang eingrenzen.
```

Eine Abfrage lief in das `statement_timeout` von PostgreSQL (SQLSTATE
57014). Ein solches Zeitlimit setzt allein die Volltextsuche — fünf Sekunden,
und nur für ihre eigene Abfrage. Auswertungen wie das Portfolio laufen ohne
Limit; sie werden langsam, brechen aber nicht mit dieser Meldung ab.
Kurzfristig: Suchbegriff eingrenzen.

Die Suche läuft bereits über `tsvector` mit GIN-Index (Migration `048`) — die
früher hier genannte Umstellung ist erledigt. Tritt der Fehler weiterhin auf,
lohnt ein Blick darauf, ob die Indizes wirklich angelegt sind:

```bash
docker compose exec postgres psql -U patio -d patio \
  -c "\di+ *such_text*"
```

Kommt stattdessen „Datenbank derzeit nicht erreichbar" (SQLSTATE 53300),
sind die Verbindungen aufgebraucht:

```bash
docker compose exec postgres \
  psql -U patio -d patio -c "SELECT count(*) FROM pg_stat_activity;"
```

---

## Migrationen

```bash
docker compose exec postgres psql -U patio -d patio   -c "SELECT name, applied_at FROM _migrations ORDER BY name DESC LIMIT 5;"
```

::: warning `npm run db:status` läuft auf dem Server NICHT
Hier stand bis zum 27.08.2026 `docker compose exec app npm run db:status`. Der
Befehl kann dort nicht funktionieren: Er ruft `tsx scripts/db-migrate.ts`, und
`scripts/` liegt gar nicht im Laufzeit-Image — `tsconfig.json` baut nur
`src/**`, und das Dockerfile kopiert aus der Bau-Stufe nur `node_modules`,
`dist` und `package.json`.

Dasselbe gilt für `db:migrate`, `db:import` und `db:reencrypt`: alles
Werkzeuge für den Entwicklungsrechner. Auf dem Server laufen die Migrationen
beim Start des Dienstes von selbst (`DB_AUTO_MIGRATE`), und was angewendet
wurde, steht in der Tabelle `_migrations` — daher die Abfrage oben.
:::

Zu beachten:

- **Forward-only.** Es gibt keinen Rückweg. Vor jedem Update ein Backup.
- **Kein Prüfsummen-Tracking.** Der Runner merkt sich Dateinamen. Eine
  bereits angewendete Migration nachträglich zu ändern bleibt folgenlos —
  und führt zu Systemen, die auf demselben Stand behaupten zu sein und es
  nicht sind.
- **Doppelte Dateinummern.** `005` und `006` existieren je zweimal.
  Historisch gewachsen, unproblematisch — der Runner arbeitet nach Dateinamen.

### Der Dienst bleibt bei `052` oder `054` stehen

```
Migration 054: mehrfach vergebene Projektnummern:
  saztg-2026-001 → Sanierung Hauptstraße, Wohnhaus Huber
Bitte in der Datenbank vereindeutigen und den Dienst erneut starten.
```

Das ist **kein Defekt, sondern Absicht.** Beide Migrationen machen die
Projektnummer eindeutig; finden sie zwei Projekte mit derselben, brechen sie
ab und der Dienst kommt nicht hoch.

Die Meldung nennt die **Projektnamen**, nicht nur die Nummer — der Abbruch
rollt die Bereinigung mit zurück, die genannte Nummer stünde danach in keiner
Zeile mehr, und wer nach ihr sucht, fände nichts.

So finden Sie die betroffenen Projekte selbst:

```bash
docker compose exec postgres psql -U patio -d patio -c "SELECT lower(projektnummer) AS nummer, array_agg(name) AS projekte FROM projects GROUP BY 1 HAVING count(*) > 1;"
```

Eine der beiden Nummern ändern, dann `docker compose up -d app`. Die
Migration läuft in einer Transaktion — beim Abbruch bleibt das Schema
unversehrt, es geht nichts verloren.

Eine zweite Meldung derselben Art nennt Projekte **ohne brauchbare Nummer**.
Dieselbe Behandlung: nachtragen, neu starten. Hintergrund:
[Die Projektnummer](/konzepte/projektnummer).

---

## Fehler nach dem Bauen

Gebaut wird ausschließlich auf dem Entwicklungsrechner. Auf dem Server liegen
nur Konfiguration, Skripte und das fertige Abbild — kein Quellcode, kein
`node_modules`, kein Node.

```bash
# Entwicklungsrechner, im Wurzelverzeichnis des Repositorys
rm -rf node_modules
npm ci

# Node-Version prüfen
node --version    # 24.x erwartet — dieselbe Hauptversion wie im Container
```

Nach einem Wechsel der Node-Hauptversion muss `npm ci` durchlaufen: `bcrypt`
ist ein natives Modul und wird gegen die installierte Version kompiliert.

---

## Platte voll

```bash
df -h /
du -sh /mnt/patio-backup /opt/patio-workspace /opt/patio/logs

# Datenbankgröße
docker compose exec postgres \
  psql -U patio -d patio -c "SELECT pg_size_pretty(pg_database_size('patio'));"

# Alte Backups
# Alte Staende raeumt `scripts/backup.sh` selbst auf (7 Tage / 4 Wochen /
# 12 Monate). Von Hand nur, wenn die Platte akut voll ist — und dann NIE den
# juengsten vollstaendigen Stand. Abgebrochene Staende sind immer entbehrlich:
find /mnt/patio-backup/taeglich -maxdepth 1 -type d -name '*.UNVOLLSTAENDIG' -exec rm -rf {} +

# Journal begrenzen
sudo journalctl --vacuum-size=200M

# Ungenutzte Docker-Images — NICHT ohne den Hinweis unten
docker image prune -a
```

::: danger `docker image prune -a` löscht hier den Rückweg
Auf diesem Rechner hängen zwei Dinge daran, die **ohne Internet nicht
wiederzubeschaffen** sind:

- **Das vorige PATIO-Image.** `update-offline.sh` merkt sich vor einem Update
  dessen Image-ID und setzt darauf zurück, wenn der Dienst danach nicht
  antwortet. Nach dem Update trägt es keine Marke mehr — `prune -a` räumt es
  damit als „ungenutzt" weg. Der automatische Rückweg ist dann fort.
- **`alpine:latest`.** `backup.sh` sichert damit den privaten Schlüssel der
  internen CA, `restore.sh` spielt ihn damit zurück. Der Container läuft nur
  für Sekunden, hängt also an keinem laufenden Dienst.

Wenn wirklich Platz fehlt, gezielt aufräumen statt pauschal:

```bash
# Was liegt überhaupt herum?
docker images

# Einzelnes altes PATIO-Image, dessen Version Sie nicht mehr brauchen
docker rmi patio-app:0.1.0
```

Beides kommt mit dem nächsten Auslieferungspaket zurück — seit dem
25.08.2026 liegen die Basis-Images mit im Paket.
:::

---

## Schnelldiagnose

```bash
cd /opt/patio || exit 1        # Compose braucht das Projektverzeichnis (.env)

echo "=== PATIO Schnelldiagnose ==="
echo "Stand:     $(cat /opt/patio/VERSION 2>/dev/null || echo 'unbekannt')"
echo "Container: $(docker compose ps --format '{{.Name}} {{.State}}' | tr '\n' ' ')"
# Von innen fragen — Port 3000 liegt nicht auf dem Host.
echo "Health:    $(docker exec patio-app curl -s localhost:3000/api/health 2>/dev/null || echo 'keine Antwort')"
# Der Weg, den die Arbeitsplaetze nehmen. Der HOSTNAME zaehlt, nicht
# localhost: Caddys Site-Block gilt nur fuer PATIO_HOSTNAME, ein Aufruf an
# localhost bricht im TLS-Handshake ab. -k wegen der eigenen CA.
HOST=$(grep '^PATIO_HOSTNAME=' /opt/patio/.env | cut -d= -f2)
echo "Zugang:    $(curl -sk -o /dev/null -w '%{http_code}' --resolve "$HOST:443:127.0.0.1" "https://$HOST/" 2>/dev/null || echo 'keine Antwort')"
echo "RAM:       $(free -h | awk '/Mem:/ {print $3 "/" $2}')"
echo "Disk:      $(df -h / | awk 'NR==2 {print $3 "/" $2 " (" $5 ")"}')"
echo "Sicherung: $(find /mnt/patio-backup/taeglich -maxdepth 2 -name VOLLSTAENDIG -mtime -1 2>/dev/null | wc -l) vollstaendige Staende aus 24 h"
# `grep -c` gibt bei NULL Treffern die 0 aus UND endet mit Exit 1. Ein
# `|| echo '?'` haengte deshalb auf jedem gesunden Server zusaetzlich ein
# Fragezeichen an — die Zeile brach in zwei. Erst zuweisen, dann den
# Fehlschlag auffangen: so bleibt 0 eine 0, und ? heisst wirklich
# "Datei nicht lesbar".
FEHLER=$(grep -c '"level":"error"' /opt/patio/logs/patio.jsonl 2>/dev/null) || FEHLER=${FEHLER:-?}
echo "Fehler:    ${FEHLER:-?} im JSONL-Log"
```

::: warning Was hier lange falsch stand
Auf einem **gesunden** Server meldete diese Diagnose zwei Fehler von sechs
Zeilen:

- `curl -s localhost:3000/…` → „keine Antwort". Port 3000 liegt nicht auf dem
  Host, der Dienst wird von innen gefragt.
- `node --version` → „nicht installiert". Richtig so: auf dem Server läuft
  alles in Containern, Node gehört dort nicht hin. Die Zeile ist ersatzlos
  entfallen.

Dazu lief `docker compose -f /opt/patio/docker-compose.yml ps` ohne `cd` —
Compose liest die `.env` aus dem **aktuellen** Verzeichnis. Aus dem
Heimatverzeichnis aufgerufen fehlen damit die Datenbank-Zugangsdaten.

Eine Diagnose, die auf einer gesunden Maschine Fehler meldet, ist im Störfall
wertlos: man sucht dann an der falschen Stelle.
:::

::: warning Meldet die Fehlerzeile dauerhaft `0` oder `?`, prüfen Sie die Rechte
`/opt/patio/logs/` wird in den Container gehängt, und der Dienst läuft dort
als Kennung **1000**. Gehört das Verzeichnis `root`, darf er nicht
hineinschreiben — und der Fehler wird im Programm verschluckt, statt
aufzufallen. `patio.log` und `patio.jsonl` bleiben dann **dauerhaft leer**,
während der Dienst selbst völlig normal läuft: die Ausgabe geht weiterhin an
`docker compose logs`.

Die Zeile oben meldet dann `0` auf einer Maschine, die sehr wohl Fehler hat.

`install-server.sh` setzt die Rechte seit dem 25.08.2026 selbst. Bei einer
**vorher aufgesetzten** Installation einmalig nachholen:

```bash
sudo chown -R 1000:1000 /opt/patio/logs /opt/patio/data
cd /opt/patio && sudo docker compose restart app
```

Danach zur Probe eine Anmeldung mit falschem Passwort versuchen und sehen, ob
etwas in `/opt/patio/logs/patio.jsonl` ankommt.
:::
