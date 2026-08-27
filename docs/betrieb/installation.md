# PATIO installieren

Von der leeren Maschine bis zum laufenden Dienst. Zum Abhaken.

**Voraussetzung:** Hardware beschafft und Ubuntu Server 24.04 installiert
([Kaufliste](/betrieb/voraussetzungen)), Grundeinrichtung erledigt
([Server aufsetzen](/betrieb/server)).

**Mitzubringen:** der USB-Stick mit dem Auslieferungspaket
`patio-<version>.tar.gz` (rund 500 MB) und der Prüfsummen-Datei daneben. Das
Paket entsteht auf dem Entwicklungsrechner ([Updates](/betrieb/updates)).

::: tip Einmal Internet, dann nie wieder
Ubuntu und Docker zu installieren braucht einmalig eine Internetverbindung.
Danach läuft der Server ohne — und soll es auch.

Alles Weitere steckt im Paket: seit dem 25.08.2026 liegen die **Basis-Images**
(`postgres:16`, `caddy:2-alpine`, `alpine:latest`) mit darin. Vorher enthielt
es nur PATIO selbst, und der erste `docker compose up -d` versuchte die
fehlenden Images zu ziehen. Der Satz oben stimmte damit nicht: wer den Rechner
nach Schritt 1 vom Netz nahm — oder ihn gleich im Büro ohne Internet
aufsetzte —, kam über Schritt 2 nicht hinaus.
:::

---

## 1. Docker installieren

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 samba
sudo systemctl enable --now docker
```

Prüfen:

```bash
docker --version
docker compose version
```

## 2. Paket einspielen

```bash
sudo mkdir -p /opt/patio
sudo cp /media/usb/patio-*.tar.gz* /opt/patio/
cd /opt/patio
sudo tar -xzf patio-*.tar.gz ./dabei/scripts/install-server.sh
sudo bash dabei/scripts/install-server.sh patio-*.tar.gz
```

Das Skript legt die Verzeichnisse an, erzeugt eine `.env` mit zufälligen
Geheimnissen, spielt PATIO **und die Basis-Images** aus dem Paket ein, startet
den Stack, richtet den Sicherungs-Zeitplan ein und macht den Befehl `patio`
verfügbar.

Dabei gibt es den Dokumentenordner sowie `logs/`, `data/` und `tools/` der
**UID 1000** — der Kennung, unter der der Dienst im Container läuft. Ohne das
bliebe `logs/patio.log` dauerhaft leer, während der Dienst normal weiterläuft
(Begründung: [Server aufsetzen](/betrieb/server), Abschnitt 8).

Danach:

```bash
patio status
```

Erwartet: alle drei Dienste laufen, „Der Dienst antwortet."

::: warning Was das Skript bewusst NICHT tut
Vier Schritte brauchen Entscheidungen und bleiben Handarbeit — sie folgen
jetzt: Sicherungsplatte, Rechnername, Zertifikat, Netzfreigabe.
:::

## 3. Sicherungsplatte einrichten

Externe Platte anstecken, dann:

```bash
lsblk -f                                    # Gerät finden
sudo mkfs.ext4 -L PATIO-SICHERUNG /dev/sdX1 # ACHTUNG: löscht die Platte
sudo blkid /dev/sdX1                        # UUID notieren
```

Einhänge-Einheit aus der Vorlage anlegen, **UUID eintragen**:

```bash
sudo mkdir -p /mnt/patio-backup
sudo cp /opt/patio/deploy/mnt-patio-backup.mount.vorlage \
        "/etc/systemd/system/$(systemd-escape -p --suffix=mount /mnt/patio-backup)"
sudo nano "/etc/systemd/system/$(systemd-escape -p --suffix=mount /mnt/patio-backup)"
sudo systemctl daemon-reload
sudo systemctl enable --now "$(systemd-escape -p --suffix=mount /mnt/patio-backup)"
```

Prüfen und einmal von Hand sichern:

```bash
mountpoint /mnt/patio-backup      # muss "is a mountpoint" sagen
sudo systemctl enable --now patio-backup.timer
sudo patio sicherung              # zusehen!
```

Der erste Lauf muss durchlaufen **und** seine Selbstprüfung bestehen.
Details: [Sicherung](/betrieb/sicherung).

## 4. Rechnername und Zertifikat

```bash
grep PATIO_HOSTNAME /opt/patio/.env
```

Diesen Namen im Router-DNS auf die Server-IP zeigen lassen, dann das
Wurzelzertifikat auf die Arbeitsplätze bringen:
[Zertifikat](/betrieb/zertifikat).

## 5. Netzfreigabe

```bash
sudo groupadd -g 1000 patio-buero
sudo useradd -u 1000 -g patio-buero -M -s /usr/sbin/nologin patio-dateien
sudo chown -R 1000:1000 /opt/patio-workspace

echo 'include = /opt/patio/deploy/smb-patio.conf' | sudo tee -a /etc/samba/smb.conf
sudo testparm && sudo systemctl reload smbd
```

Je Person:

```bash
sudo usermod -aG patio-buero anna
sudo smbpasswd -a anna
```

Details: [Netzfreigabe](/betrieb/freigabe).

## 6. Erstes Konto

Am Arbeitsplatz `https://patio.sima.intern/` öffnen. Beim ersten Aufruf führt
der Einrichtungsassistent durch das Anlegen des Administrator-Kontos.

Das Passwort braucht **mindestens 12 Zeichen** — es ist der einzige Faktor.

Weitere Konten danach unter `/admin/users`.

## 7. Die Probe, ohne die es nicht fertig ist

::: danger Eine ungeprüfte Sicherung ist keine
Bevor echte Daten auf den Server gehen, **einmal vollständig
zurücksichern** — auf dem Ersatzgerät, damit auch das einmal gelaufen ist:

```bash
sudo bash /opt/patio/scripts/restore.sh
```

Die gemeldete **Dauer notieren**. Sie ist die Antwort auf die einzige Frage,
die im Ernstfall gestellt wird: „Wie lange stehen wir?"
:::

## Abnahme

- [ ] `patio status` zeigt alle drei Dienste und „Der Dienst antwortet."
- [ ] Neustart der Maschine — der Stack kommt **ohne Handgriff** hoch
- [ ] Die Oberfläche zeigt ein **Schloss ohne Warnung** (Browser; später auch im Programmfenster)
- [ ] Anmeldung mit Benutzername und Passwort
- [ ] Netzfreigabe im Explorer erreichbar, Datei anlegen und löschen
- [ ] Gelöschte Datei liegt im Papierkorb der Freigabe
- [ ] `sudo patio sicherung` läuft durch, Selbstprüfung bestanden
- [ ] **Rücksicherung geprobt, Dauer notiert:** ______ Minuten
- [ ] USV zieht den Stecker-Test durch: Rechner fährt selbst herunter
- [ ] Ersatzgerät einmal aus der Sicherung hochgezogen

## Wenn etwas klemmt

```bash
patio status            # Zustand aller Dienste
patio logs 100          # letzte Protokollzeilen
patio dokumente         # Rechte am Dokumentenordner
docker compose ps       # aus /opt/patio
```

Häufige Ursachen: [Troubleshooting](/betrieb/troubleshooting).

## Nächster Schritt

→ [Zertifikat](/betrieb/zertifikat)
