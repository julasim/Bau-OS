# Backup

Das Wichtigste vorweg: **die Datenbank ist der Datenbestand.** Projekte,
Notizen, Aufgaben, Termine, Team, Meetings, Bautagebuch, Stunden, Phasen,
Rechnungen und die hochgeladenen Dateien liegen dort. Das
Workspace-Verzeichnis hält nur, was ohnehin als Datei abgelegt wurde.

## Was gesichert werden muss

| Was | Pfad | Priorität | Inhalt |
|---|---|---|---|
| **Datenbank** | PostgreSQL | Kritisch | Der gesamte fachliche Bestand |
| **.env** | `/opt/patio/.env` | Kritisch | `JWT_SECRET`, `ENCRYPTION_KEY`, Zugangsdaten |
| **Workspace** | `/opt/patio-workspace/` | Hoch | Abgelegte Dokumente |
| **data/** | `/opt/patio/data/` | Mittel | Alt-Konten (`users.json`) |
| **Code** | `/opt/patio/` | Niedrig | Jederzeit neu klonbar |

::: danger .env und Datenbank gehören zusammen
`ENCRYPTION_KEY` — beziehungsweise `JWT_SECRET` als Rückfall — entschlüsselt
Felder in der Datenbank. Geht die `.env` verloren und der Dump bleibt, sind
diese Felder nicht mehr lesbar. **Immer beide zusammen sichern und beide aus
demselben Tag zurückspielen.**
:::

## Das mitgelieferte Backup-Skript

```bash
sudo bash /opt/patio/scripts/backup.sh
```

Es erzeugt zwei Dateien in `/opt/patio-backups`:

| Datei | Inhalt |
|---|---|
| `patio-backup-<Zeitstempel>.tar.gz` | Workspace, `.env`, `data/`, `tools/` |
| `patio-db-<Zeitstempel>.sql.gz` | `pg_dump` mit `--clean --if-exists --no-owner --no-privileges` |

Beide Dateien bekommen `chmod 600` — im Tarball steckt die `.env`. Backups
älter als 14 Tage werden gelöscht; über `RETENTION_DAYS` einstellbar.

Eigene Pfade als Argumente:

```bash
sudo bash /opt/patio/scripts/backup.sh /opt/patio /opt/patio-workspace /mnt/nas/patio
```

::: warning Der Dump braucht einen laufenden Container
Das Skript zieht den Dump über `docker exec` aus dem Postgres-Container
(`patio-postgres`, ersatzweise `patio-db`). Läuft keiner — etwa bei einer
Bare-Metal-Installation — wird der Dump **übersprungen** und nur eine
Warnung ausgegeben. Das Skript endet trotzdem mit Erfolg. In diesem Fall
muss der Dump separat gefahren werden:

```bash
pg_dump -U patio --clean --if-exists --no-owner --no-privileges patio \
  | gzip > /opt/patio-backups/patio-db-$(date +%Y%m%d-%H%M%S).sql.gz
```
:::

## Täglich laufen lassen

```bash
sudo crontab -e
```

```cron
0 3 * * * /bin/bash /opt/patio/scripts/backup.sh >> /opt/patio/logs/backup.log 2>&1
```

Die Vorlage liegt als `scripts/backup-cron.conf` bei. Der Wartungs-Cron von
PATIO läuft um 03:15 Uhr — bewusst versetzt, damit der Dump nicht mitten in
eine Löschwelle im Audit-Log fällt.

Prüfen:

```bash
sudo crontab -l
tail -20 /opt/patio/logs/backup.log
```

## Zweiter Ablageort

Ein Backup auf demselben Rechner ist bei dessen Ausfall mitverloren. Im
Büronetz bietet sich ein NAS oder eine Netzfreigabe an:

```cron
0 3 * * * /bin/bash /opt/patio/scripts/backup.sh >> /opt/patio/logs/backup.log 2>&1
30 3 * * * rsync -a --delete /opt/patio-backups/ /mnt/nas/patio-backups/ >> /opt/patio/logs/backup.log 2>&1
```

Das Ziel muss die Rechte erhalten (`chmod 600`) — die Dateien enthalten
Secrets. Eine Netzfreigabe, auf die das ganze Büro zugreifen kann, ist als
Backup-Ziel ungeeignet.

## Wiederherstellung

```bash
sudo bash /opt/patio/scripts/restore.sh \
  /opt/patio-backups/patio-backup-20260420-030000.tar.gz \
  /opt/patio-backups/patio-db-20260420-030000.sql.gz
```

Das Skript entpackt den Tarball, spielt den Dump in den laufenden
Postgres-Container ein und startet den Anwendungs-Container neu. Wird der
Dump weggelassen, sucht es den passenden selbst.

::: danger Der Restore löscht den aktuellen Bestand
Der Dump läuft mit `--clean --if-exists` — bestehende Tabellen werden
verworfen und neu angelegt. Vor jedem Restore den aktuellen Stand sichern:

```bash
sudo bash /opt/patio/scripts/backup.sh
```
:::

::: warning Beide Dateien aus demselben Lauf
Ein Tarball von gestern mit einem Dump von heute bringt eine `.env`, die
einen anderen Migrationsstand erwartet als der eingespielte. Immer das Paar
mit demselben Zeitstempel verwenden.
:::

## Neuaufbau auf einem anderen Rechner

1. [Server aufsetzen](/betrieb/server) und
   [Software installieren](/betrieb/software)
2. Repository klonen
3. `.env` aus dem Tarball übernehmen
4. Stack starten, damit der Postgres-Container läuft
5. `restore.sh` mit Tarball und Dump aufrufen
6. Anmelden und stichprobenartig prüfen

## Der Test, der zählt

Ein Backup, das nie zurückgespielt wurde, ist kein Backup. Einmal im Quartal
einen Restore auf einem Testsystem fahren und prüfen, ob Anmeldung,
Projektliste und ein Dateidownload funktionieren. Gerade der Dateidownload
ist aussagekräftig — er berührt Datenbank, Verschlüsselung und
Dateisystem gleichzeitig.

## Checkliste

- [ ] `backup.sh` läuft täglich per Cron
- [ ] Der DB-Dump wird tatsächlich erzeugt (nicht stillschweigend übersprungen)
- [ ] Backups landen zusätzlich auf einem zweiten Gerät
- [ ] Die Dateirechte am Zielort sind eng
- [ ] Ein Restore wurde mindestens einmal durchgespielt

## Nächster Schritt

→ [Monitoring](/betrieb/monitoring)
