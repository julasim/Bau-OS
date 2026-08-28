# Monitoring

PATIO überwachen: Health-Check, Logs, Systemzustand.

## Health-Check

Auf dem Server:

```bash
docker exec patio-app curl -s localhost:3000/api/health
```

```json
{ "ok": true, "uptime": 86400, "db": true }
```

::: warning Nicht vom Server aus auf Port 3000
`curl http://localhost:3000/api/health` **auf dem Server** antwortet nicht.
Der Dienst hört zwar auf 3000, aber `docker-compose.yml` legt den Port nicht
auf den Host — von außen führt der Weg ausschließlich über Caddy. Das ist
Absicht: nur ein einziger Eingang.

Der Befehl oben fragt deshalb von innen. Wer den Weg der Arbeitsplätze prüfen
will, nimmt den **Hostnamen**, nicht `localhost`:

```bash
curl -sk https://patio.sima.intern/          # vom Arbeitsplatz aus
curl -sk --resolve patio.sima.intern:443:127.0.0.1 \
     https://patio.sima.intern/              # auf dem Server selbst
```

`https://localhost/` antwortet auch auf einem gesunden Server **nicht**: Caddy
stellt das Zertifikat für `PATIO_HOSTNAME` aus, und der Site-Block gilt nur für
diesen Namen. Ein Aufruf an `localhost` trifft keinen Block, der TLS-Handshake
bricht mit `tlsv1 alert internal error` ab. `-k` steht dort, weil das
Zertifikat aus der eigenen CA stammt — geprüft wird die Erreichbarkeit, nicht
die Vertrauenskette.
:::

Der Endpunkt liegt **vor** der Anmeldung und vor dem Rate-Limit und liefert
bewusst wenig: keine Versionen, keine Build-Hashes, keine Zugangsdaten — er
ist anonym erreichbar.

::: warning Was der Health-Check nicht sagt
`ok: true` heißt: der Prozess lebt und nimmt Anfragen an. `db: true` heißt
lediglich, dass eine `DATABASE_URL` konfiguriert ist — **nicht**, dass die
Datenbank gerade antwortet. Eine ausgefallene Datenbank zeigt sich hier
nicht; sie zeigt sich als 503 auf den fachlichen Routen.
:::

Dasselbe über Compose, wenn man ohnehin in `/opt/patio` steht:

```bash
cd /opt/patio && docker compose exec app curl -s localhost:3000/api/health
```

## Logs

### Docker Compose

```bash
docker compose logs -f app                # live
docker compose logs --since 2m app        # letzte zwei Minuten
docker compose logs --tail 100 app        # letzte 100 Zeilen
docker compose logs app | grep -i error
```

### systemd — nur für die Sicherung

::: warning `journalctl -u patio` gibt es nicht
Hier standen vier Befehle auf eine Unit `patio.service`. **Die existiert
nicht** — PATIO läuft ausschließlich als Compose-Stack, es gibt keinen
systemd-Dienst für die Anwendung. Wer die Befehle eingibt, bekommt
„Unit patio.service could not be found". Für die Anwendungsprotokolle gilt der
Docker-Abschnitt darüber.
:::

Über systemd laufen nur die **Sicherungs-Einheiten** (`deploy/patio-backup.timer`,
`patio-backup.service`, `patio-backup-fehler@.service`):

```bash
systemctl status patio-backup.timer       # läuft der Zeitplan?
systemctl list-timers patio-backup        # wann das nächste Mal?
sudo journalctl -u patio-backup -n 100    # Protokoll des letzten Laufs
sudo journalctl -u patio-backup --since today
```

### Logdateien

PATIO schreibt zusätzlich in `logs/`:

| Datei | Inhalt |
|---|---|
| `patio.log` | Lesbarer Auszug, auf 500 Zeilen gekürzt |
| `patio.jsonl` | Vollständig und maschinenlesbar, rotiert bei 5 MB, 5 Dateien |

Die Dateinamen sind ein Überbleibsel aus der Bot-Zeit und in `src/config.ts`
fest hinterlegt.

::: danger Sind beide Dateien leer, liegt es an den Rechten — nicht daran, dass alles gutgeht
`/opt/patio/logs/` wird in den Container gehängt, und der Dienst läuft dort
unter der Kennung **1000**. Gehört das Verzeichnis `root`, darf er nicht
hineinschreiben. Der Fehler wird im Programm verschluckt statt gemeldet: die
Dateien bleiben **dauerhaft leer**, während der Dienst völlig normal
weiterläuft — seine Ausgabe geht ja zusätzlich an `docker compose logs`.

Das ist die unangenehme Sorte Fehler: Alles auf dieser Seite funktioniert
scheinbar, nur zählt jede Auswertung 0 Fehler auf einer Maschine, die welche
hat.

Nachsehen:

```bash
ls -ld /opt/patio/logs        # sollte 1000 gehören, nicht root
ls -la /opt/patio/logs        # liegen dort Dateien, und wachsen sie?
```

`install-server.sh` setzt die Rechte seit dem 25.08.2026 selbst. Bei einer
**vorher aufgesetzten** Installation einmalig nachholen:

```bash
sudo chown -R 1000:1000 /opt/patio/logs /opt/patio/data /opt/patio/tools
cd /opt/patio && sudo docker compose restart app
```
:::

Auswerten:

```bash
# Fehler des heutigen Tages
grep '"level":"error"' /opt/patio/logs/patio.jsonl | tail -20

# mit jq
jq -r 'select(.level=="error") | "\(.ts) \(.ctx // "-") \(.msg)"' \
  /opt/patio/logs/patio.jsonl | tail -20
```

::: tip Was im Log auffallen sollte
Wiederkehrende `[FATAL] Uncaught Exception` oder `[FATAL] Unhandled Promise
Rejection` sind echte Befunde. PATIO beendet sich in diesen Fällen bewusst
und wird neu gestartet — die Anwendung läuft also weiter, aber die Ursache
bleibt. Solche Zeilen gehören untersucht, nicht weggeklickt.
:::

## Systemzustand

```bash
# Container
docker compose ps
docker stats --no-stream

# Speicherplatz
df -h /
du -sh /opt/patio-workspace
du -sh /mnt/patio-backup

# Größe der Datenbank
docker compose exec postgres \
  psql -U patio -d patio -c "SELECT pg_size_pretty(pg_database_size('patio'));"
```

::: warning Speicherplatz ist der wahrscheinlichste Ausfallgrund
Hochgeladene Dateien liegen in der Datenbank, die Backups daneben auf der
Platte. Läuft sie voll, antwortet die API mit HTTP 507 („Kein Speicherplatz
mehr auf dem Server") und Schreibvorgänge scheitern. Ein Schwellwert-Alarm
bei 80 Prozent ist die lohnendste einzelne Überwachungsmaßnahme.
:::

## Datenbank prüfen

```bash
# Antwortet sie?
docker compose exec postgres psql -U patio -d patio -c "SELECT 1;"

# Migrationsstand — direkt aus der Datenbank
docker compose exec postgres psql -U patio -d patio   -c "SELECT name, applied_at FROM _migrations ORDER BY name DESC LIMIT 5;"

# Aktive Verbindungen
docker compose exec postgres \
  psql -U patio -d patio -c "SELECT count(*) FROM pg_stat_activity;"
```

## Ein einfaches Prüfskript

::: warning Zwei Fallen, die hier lange drinsteckten
Das Skript stand hier mit `curl http://localhost:3000/api/health` — **so
meldet es auf einem gesunden Server „FEHLER"**. Port 3000 ist in
`docker-compose.yml` nur `expose`d und liegt bewusst **nicht** auf dem Host;
von außen führt der Weg ausschließlich über Caddy. Nachgesehen am laufenden
Container: `PORTS=[3000/tcp]`, kein `0.0.0.0`-Mapping. Als stündlicher
Cron-Job hätte das dauerhaft falschen Alarm ins Protokoll geschrieben.

Die zweite Falle war `docker compose -f /opt/patio/docker-compose.yml …` ohne
vorheriges `cd`: Compose liest die `.env` aus dem **aktuellen** Verzeichnis,
nicht aus dem der Compose-Datei. Aus dem Heimatverzeichnis aufgerufen fehlen
damit `POSTGRES_USER` und die übrigen Werte.

Beides ist unten korrigiert — der Dienst wird von innen gefragt, so wie es
`patio status` und `update-offline.sh` auch tun.
:::

`/opt/patio/health-check.sh`:

```bash
#!/bin/bash
echo "=== PATIO Health Check — $(date) ==="

# Compose braucht das Projektverzeichnis, sonst findet es die .env nicht.
cd /opt/patio || exit 1

echo -n "Anwendung:   "
# Von INNEN fragen: Port 3000 liegt nicht auf dem Host.
if docker exec patio-app curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
  echo "OK"
else
  echo "FEHLER (antwortet nicht)"
fi

echo -n "Zugang:      "
# Der Weg, den die Arbeitsplätze wirklich nehmen.
#
# Der HOSTNAME zählt, nicht localhost: Caddy stellt das Zertifikat für
# PATIO_HOSTNAME aus, und der Caddyfile-Block gilt nur für diesen Namen. Ein
# Aufruf an https://localhost/ trifft keinen Site-Block, der TLS-Handshake
# bricht ab — auf einem völlig gesunden Server.
#
# `-k`, weil das Zertifikat aus der eigenen CA stammt: geprüft wird die
# Erreichbarkeit, nicht die Vertrauenskette.
HOST=$(grep '^PATIO_HOSTNAME=' /opt/patio/.env | cut -d= -f2)
if curl -sk -o /dev/null --resolve "$HOST:443:127.0.0.1" "https://$HOST/" 2>/dev/null; then
  echo "OK"
else
  echo "FEHLER (Caddy antwortet nicht)"
fi

echo -n "Datenbank:   "
if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-patio}" > /dev/null 2>&1; then
  echo "OK"
else
  echo "FEHLER (nicht erreichbar)"
fi

echo -n "Festplatte:  "
DISK=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
if   [ "$DISK" -lt 80 ]; then echo "OK (${DISK}% belegt)"
elif [ "$DISK" -lt 90 ]; then echo "WARNUNG (${DISK}% belegt)"
else echo "KRITISCH (${DISK}% belegt)"
fi

echo -n "Sicherung:   "
# Gezaehlt werden nur VOLLSTAENDIGE Staende: ein abgebrochener Lauf hinterlaesst
# ein Verzeichnis, das aussieht wie eine Sicherung, aber keine ist.
NEUESTES=$(find /mnt/patio-backup/taeglich -maxdepth 2 -name VOLLSTAENDIG -mtime -1 2>/dev/null | wc -l)
[ "$NEUESTES" -gt 0 ] && echo "OK (vollstaendiger Stand aus den letzten 24 h)" \
                      || echo "WARNUNG (kein aktueller vollstaendiger Stand)"
```

```bash
chmod +x /opt/patio/health-check.sh
/opt/patio/health-check.sh
```

Stündlich per Cron:

```text
0 * * * * /opt/patio/health-check.sh >> /opt/patio/logs/health.log 2>&1
```

## Alarmierung

Ein Prüfskript, dessen Ausgabe niemand liest, meldet keinen Ausfall.

**Eine Mail scheidet aus** — PATIO verschickt seit dem Umbau nichts mehr, und
ein Mailserver steht dafür auch nicht bereit. Die Meldungen gehen deshalb
dorthin, wo sie beim nächsten Anmelden am Server auffallen: ins Journal, in
eine Datei unter `/opt/patio/logs/` und als Nachricht an alle angemeldeten
Terminals. So macht es der Sicherungslauf über `OnFailure=`
(siehe `deploy/patio-backup-fehler@.service`).

Die erste Bildschirmseite von `patio status` nennt den eingespielten Stand
(aus `/opt/patio/VERSION`) und zeigt außerdem, wann die Sicherung zuletzt
vollständig durchlief — und warnt, wenn das über 30 Stunden her ist.

Externe Überwachungsdienste scheiden aus: der Rechner ist von außen nicht
erreichbar, und das soll er auch nicht sein.

## Nächster Schritt

→ [Troubleshooting](/betrieb/troubleshooting)
