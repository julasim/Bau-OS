# Sicherung und Rücksicherung

> **Der Server ist der einzige Ausfallpunkt.** Vor dem Umbau konnte man bei
> einer Störung im Explorer weiterarbeiten — das ist vorbei. Die Sicherung ist
> deshalb kein Nebenschauplatz, sondern Teil der Grundeinrichtung.

## Was gesichert wird

| Was | Wo es liegt | Warum es dazugehört |
|---|---|---|
| Datensätze | Container `patio-postgres` | Projekte, Notizen, Aufgaben, Termine, Rechnungen |
| Dokumente | `/opt/patio-workspace` | die echten Dateien, auch über Samba erreichbar |
| `.env` | `/opt/patio` | enthält `JWT_SECRET` **und** `ENCRYPTION_KEY` |
| `data/`, `tools/` | `/opt/patio` | Konten-Altbestand und Werkzeuge |
| **CA-Schlüssel** | Volume `patio_caddy_data` | der private Schlüssel der internen Zertifizierungsstelle |

**Die letzten beiden Zeilen sind die, die man vergisst.**

`.env` gehört zwingend zum Datenbank-Dump: der `ENCRYPTION_KEY` entschlüsselt
Felder in der Datenbank. Ein Dump ohne die passende `.env` ist unvollständig.

Der **CA-Schlüssel** ist der teuerste Verlust. Fehlt er beim Wiederaufbau,
erzeugt Caddy eine neue Zertifizierungsstelle — und dann muss jemand an
**jeden** Arbeitsplatz, um das neue Wurzelzertifikat einzuspielen. Die
Sicherung wäre formal vollständig und der Wiederanlauf trotzdem ein
Tagesprojekt.

## Wohin gesichert wird

Auf eine **externe Festplatte am Mini-PC**, eingehängt unter
`/mnt/patio-backup`.

Drei Dinge sind daran nicht verhandelbar:

**1. Einhängen über die UUID, nicht über `/dev/sdb1`.** Gerätenamen werden in
der Reihenfolge vergeben, in der der Kernel die Datenträger findet. Steckt
jemand einen USB-Stick an und startet neu, kann aus `/dev/sdb1` plötzlich
`/dev/sdc1` werden. Vorlage: `deploy/mnt-patio-backup.mount.vorlage`.

**2. ext4, nicht exFAT oder NTFS.** Die Staffelung spart Platz über harte
Links, und die gibt es nur auf einem Linux-Dateisystem. Eigentümer und Rechte
überleben dort ebenfalls.

**3. Die Sicherung prüft vor jedem Schreiben, ob die Platte wirklich eingehängt
ist.** Ist sie es nicht, existiert das Verzeichnis `/mnt/patio-backup` trotzdem
— es liegt dann auf der Systemplatte. Ohne diese Prüfung schriebe die Sicherung
dorthin, meldete Erfolg, füllte über Wochen das Wurzel-Dateisystem, und
auffallen würde es erst in dem Moment, in dem man die Sicherung braucht.

> **Was diese Lösung nicht abdeckt.** Eine dauerhaft angesteckte Platte steht
> im selben Raum. Gegen Plattenausfall, versehentliches Löschen und einen
> misslungenen Update schützt sie vollständig — gegen Brand, Diebstahl oder
> einen Verschlüsselungstrojaner nicht.

::: danger Es gibt KEINE automatische Auslagerung
Die `.env.example` beschrieb `BACKUP_REMOTE` als zweites Ziel, auf das jede
Sicherung zusätzlich abgeworfen wird. **Das ist nicht umgesetzt.** Weder
`scripts/backup.sh` noch `scripts/restore.sh` lesen die Variable; im ganzen
Repo kommt sie nur in der `.env.example` vor:

```bash
grep -rl BACKUP_REMOTE --exclude-dir=node_modules .
# → nur .env.example
```

Wer sie gesetzt hat, hat **keine** Kopie außer Haus. Das ist genau die Art
Fehler, die erst auffällt, wenn man die Sicherung braucht.

**Bis das gebaut ist, hilft nur Handarbeit:** eine zweite Platte im Wechsel.
Dazu `BACKUP_DIR` auf deren Einhängepunkt zeigen lassen und den Lauf einmal
von Hand anstoßen — das Skript verlangt ohnehin eine wirklich eingehängte
Platte und bricht sonst ab. Zwei Platten abwechselnd, eine davon außer Haus,
schließen die Lücke.
:::

## Aufbewahrung

**7 Tagesstände · 4 Wochenstände · 12 Monatsstände.**

Wochen- und Monatsstände sind harte Links auf den jeweiligen Tagesstand:
derselbe Datenblock, nur ein zweiter Verzeichniseintrag. Erst wenn der
Tagesstand wegrotiert, kostet der Wochenstand überhaupt Platz.

```
/mnt/patio-backup/
├── taeglich/20260806-030000/
│   ├── datenbank.sql.gz
│   ├── dokumente.tar.gz
│   ├── konfiguration.tar.gz     ← .env, data/, tools/ (Rechte 600)
│   ├── caddy-daten.tar.gz       ← CA-Schlüssel
│   ├── pruefsummen.sha256
│   └── VOLLSTAENDIG             ← erst nach bestandener Selbstprüfung
├── woechentlich/2026-W32/
└── monatlich/2026-08/
```

## Die Selbstprüfung

**Eine Sicherung, die nie gelesen wurde, ist keine.**

Jeder Lauf spielt den frischen Dump in einen Wegwerf-Container zurück und hält
die Zeilenzahlen der Kerntabellen gegen die Quelle. Weicht etwas ab:

- schlägt der Lauf fehl (Exit-Code 1),
- wird der Stand in `<name>.UNVOLLSTAENDIG` umbenannt,
- und die Marke `VOLLSTAENDIG` **nicht** geschrieben.

`restore.sh` betrachtet ohne Argument nur Stände **mit** dieser Marke. Damit
kann im Ernstfall weder ein fehlgeschlagener noch ein von einem Stromausfall
abgeschnittener Stand eingespielt werden — obwohl er der jüngste wäre.

## Einrichtung

```bash
# 1. Platte finden
lsblk -f

# 2. Formatieren — ACHTUNG, löscht die Platte
sudo mkfs.ext4 -L PATIO-SICHERUNG /dev/sdX1

# 3. UUID ablesen
sudo blkid /dev/sdX1

# 4. Einhänge-Einheit aus der Vorlage anlegen (UUID eintragen!)
sudo mkdir -p /mnt/patio-backup
sudo cp deploy/mnt-patio-backup.mount.vorlage \
        "/etc/systemd/system/$(systemd-escape -p --suffix=mount /mnt/patio-backup)"
sudo systemctl daemon-reload
sudo systemctl enable --now "$(systemd-escape -p --suffix=mount /mnt/patio-backup)"

# 5. Prüfen, dass es wirklich eingehängt ist
mountpoint /mnt/patio-backup

# 6. Zeitplan aktivieren
sudo cp deploy/patio-backup.service deploy/patio-backup.timer \
        deploy/patio-backup-fehler@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now patio-backup.timer

# 7. Einmal von Hand laufen lassen und zusehen
sudo systemctl start patio-backup.service
journalctl -u patio-backup -f
```

## Wenn etwas schiefgeht

Ein fehlgeschlagener Lauf meldet sich über `OnFailure=` an drei Stellen:
`/var/log/patio-sicherung-fehler.log`, die Datei
`/opt/patio/logs/SICHERUNG-FEHLGESCHLAGEN` und als Nachricht an alle
angemeldeten Terminals.

Ohne diesen Weg scheitert die Sicherung still im Journal — genau das ist in
diesem Projekt schon einmal passiert: der nächtliche Lauf brach monatelang mit
„Verzeichnis nicht gefunden" ab, und niemand sah zu.

```bash
systemctl status patio-backup.timer      # läuft der Zeitplan?
systemctl list-timers patio-backup       # wann das nächste Mal?
journalctl -u patio-backup -n 50         # was ist zuletzt passiert?
ls -la /mnt/patio-backup/taeglich/       # sind Stände da?
```

## Rücksicherung

```bash
# Jüngsten vollständigen Stand einspielen
sudo bash /opt/patio/scripts/restore.sh

# Oder einen bestimmten
sudo bash /opt/patio/scripts/restore.sh /mnt/patio-backup/monatlich/2026-07
```

Das Skript prüft zuerst die Prüfsummen — eine beschädigte Sicherung fällt auf,
**bevor** die bestehenden Daten überschrieben werden. Danach hält es den
Dienst an, spielt Datenbank, Dokumente, Konfiguration und CA-Schlüssel ein,
setzt die Dateirechte auf uid 1000 und startet den Dienst wieder.

**Am Ende meldet es die Dauer.** Diese Zahl gehört hierher ins Handbuch — sie
ist die Antwort auf die einzige Frage, die im Ernstfall gestellt wird:

> Gemessene Dauer der Rücksicherung: **noch einzutragen**
> (auf der echten Maschine mit echtem Datenbestand messen; die Probe in WSL
> mit Testdaten lag bei 2 Sekunden und sagt über den Ernstfall wenig aus)

Nach jeder Rücksicherung prüfen:

1. Anmelden — ohne Zertifikatswarnung
2. Ein Projekt öffnen, eine Datei herunterladen
3. Prüfprotokoll unter `/admin/audit` ansehen
