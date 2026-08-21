# Monitoring

PATIO überwachen: Health-Check, Logs, Systemzustand.

## Health-Check

```bash
curl -s http://localhost:3000/api/health
```

```json
{ "ok": true, "uptime": 86400, "db": true }
```

Der Endpunkt liegt **vor** der Anmeldung und vor dem Rate-Limit und liefert
bewusst wenig: keine Versionen, keine Build-Hashes, keine Zugangsdaten — er
ist anonym erreichbar.

::: warning Was der Health-Check nicht sagt
`ok: true` heißt: der Prozess lebt und nimmt Anfragen an. `db: true` heißt
lediglich, dass eine `DATABASE_URL` konfiguriert ist — **nicht**, dass die
Datenbank gerade antwortet. Eine ausgefallene Datenbank zeigt sich hier
nicht; sie zeigt sich als 503 auf den fachlichen Routen.
:::

Aus dem Container heraus:

```bash
docker compose exec app curl -s localhost:3000/api/health
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

# Migrationsstand
docker compose exec app npm run db:status

# Aktive Verbindungen
docker compose exec postgres \
  psql -U patio -d patio -c "SELECT count(*) FROM pg_stat_activity;"
```

## Einfacher Prüfskript

`/opt/patio/health-check.sh`:

```bash
#!/bin/bash
echo "=== PATIO Health Check — $(date) ==="

echo -n "Anwendung:   "
if curl -sf http://localhost:3000/api/health > /dev/null; then
  echo "OK"
else
  echo "FEHLER (antwortet nicht)"
fi

echo -n "Datenbank:   "
if docker compose -f /opt/patio/docker-compose.yml exec -T postgres \
     pg_isready -U patio > /dev/null 2>&1; then
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

```cron
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

Die erste Bildschirmseite von `patio status` zeigt außerdem, wann die
Sicherung zuletzt vollständig durchlief — und warnt, wenn das über 30 Stunden
her ist.

Externe Überwachungsdienste scheiden aus: der Rechner ist von außen nicht
erreichbar, und das soll er auch nicht sein.

## Nächster Schritt

→ [Troubleshooting](/betrieb/troubleshooting)
