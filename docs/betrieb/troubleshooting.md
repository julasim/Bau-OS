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
# Docker
docker compose ps
docker compose logs postgres --tail 50
docker compose exec postgres pg_isready -U patio

# Bare Metal
systemctl status postgresql
psql "$DATABASE_URL" -c "SELECT 1;"
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
- Migrationen hängen. Der Runner nimmt einen Advisory-Lock; ein hart
  abgeschossener Prozess kann ihn kurzzeitig halten. Neustart.

---

## Änderung an der .env wirkt nicht

`docker compose restart` liest die `.env` **nicht** neu ein.

```bash
docker compose up -d --force-recreate app
docker compose exec app sh -c 'echo $PATIO_HOSTNAME'
```

::: tip `restart` reicht nicht
Ein `docker compose restart app` liest die `.env` **nicht** neu. Nötig ist
`docker compose up -d --force-recreate app`. Das ist die häufigste Ursache
dafür, dass eine geänderte Einstellung „nicht greift".
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
| Der Einrichtungsassistent erscheint, obwohl Konten existieren | die Anwendung sieht die Datenbank nicht; `patio status` prüfen |

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

```caddyfile
@stream path /api/events*
reverse_proxy @stream app:3000 {
    flush_interval -1
    transport http { read_timeout 24h  write_timeout 24h }
}
```

Bei nginx entsprechend `proxy_buffering off;` und ein großzügiges
`proxy_read_timeout`.

Prüfen, ob überhaupt jemand verbunden ist:

```bash
docker compose logs app | grep -i -E "sse|events"
```

---

## Upload schlägt fehl

| Symptom | Ursache |
|---|---|
| „Kein Zugriff auf die Datei bzw. den Ordner" (403) | Dateirechte am Workspace-Verzeichnis |
| „Kein Speicherplatz mehr auf dem Server" (507) | Platte voll |
| Datei wird abgelehnt | Endung nicht erlaubt oder Inhalt passt nicht zur Endung |
| Datei zu groß | über `MAX_UPLOAD_MB` (Standard 50) |

Rechte prüfen und richten:

```bash
ls -la /opt/patio-workspace
sudo chown -R 1000:1000 /opt/patio-workspace    # Container läuft als UID 1000
```

Der Eigentümer ist die häufigste Ursache: der Container läuft als uid 1000,
und wer das Verzeichnis dem Dienstbenutzer eines Systemkontos zuweist
(`useradd -r` vergibt eine uid **unter** 1000), macht den Dienst
schreibunfähig. Der Fehler zeigt sich dann an ganz anderer Stelle.

Erlaubte Endungen: `pdf`, `docx`, `doc`, `xlsx`, `xls`, `csv`, `txt`, `md`,
`png`, `jpg`, `jpeg`, `gif`, `webp`, `zip`, `json`, `xml`. Zusätzlich prüft
PATIO die Magic Bytes: eine als `.png` getarnte HTML-Datei wird abgelehnt.

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
57014). Meist eine sehr breite Suche oder eine Portfolio-Auswertung über
viele Projekte. Kurzfristig: Suchbegriff eingrenzen.

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
docker compose exec app npm run db:status
```

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

```bash
# Abhängigkeiten sauber neu holen
cd /opt/patio
rm -rf node_modules
npm ci

# Node-Version prüfen
node --version    # 24.x erwartet
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

# Ungenutzte Docker-Images
docker image prune -a
```

---

## Schnelldiagnose

```bash
echo "=== PATIO Schnelldiagnose ==="
echo "Container: $(docker compose -f /opt/patio/docker-compose.yml ps --format '{{.Name}} {{.State}}' | tr '\n' ' ')"
echo "Health:    $(curl -s localhost:3000/api/health || echo 'keine Antwort')"
echo "Node:      $(node --version 2>/dev/null || echo 'nicht installiert')"
echo "RAM:       $(free -h | awk '/Mem:/ {print $3 "/" $2}')"
echo "Disk:      $(df -h / | awk 'NR==2 {print $3 "/" $2 " (" $5 ")"}')"
echo "Sicherung: $(find /mnt/patio-backup/taeglich -maxdepth 2 -name VOLLSTAENDIG -mtime -1 2>/dev/null | wc -l) vollstaendige Staende aus 24 h"
echo "Fehler:    $(grep -c '\"level\":\"error\"' /opt/patio/logs/patio.jsonl 2>/dev/null || echo '?') im JSONL-Log"
```
