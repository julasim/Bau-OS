# Server aufsetzen

Den Rechner im Büro vorbereiten: Grundinstallation, Benutzer, Netz, Zeit.

## 1. Betriebssystem installieren

Ubuntu Server 24.04 LTS, minimale Installation. Der OpenSSH-Server wird
mitinstalliert, damit sich der Rechner ohne Bildschirm und Tastatur
verwalten lässt.

## 2. System aktualisieren

```bash
sudo apt update && sudo apt upgrade -y
```

::: warning Keine automatischen Sicherheitsupdates
`unattended-upgrades` braucht Internet — der Server hat keines, und das ist
Absicht. Stattdessen ein **fester Wartungstermin**, Vorschlag
vierteljährlich: Sicherung prüfen, Maschine kurz ans Netz, aktualisieren,
neu starten, Probe. Bewusst so entschieden, nicht vergessen.

Termin im Kalender eintragen — sonst passiert es nie.
:::

## 3. Feste Adresse vergeben

Der Rechner muss unter derselben Adresse erreichbar bleiben. Entweder eine
feste Reservierung im DHCP des Routers oder eine statische Konfiguration in
Netplan. Dazu ein Name im internen DNS, damit die Arbeitsplätze nicht mit
einer IP-Adresse hantieren müssen — etwa `patio.firma.intern`.

Prüfen:

```bash
ip -4 addr show
```

## 4. Dienst-Benutzer anlegen

Der Dienst soll nicht als `root` laufen.

```bash
sudo adduser patio
sudo usermod -aG sudo patio
```

Beim Docker-Aufbau kommt die Docker-Gruppe dazu:

```bash
sudo usermod -aG docker patio
```

::: warning Docker-Gruppe ist Root-äquivalent
Wer in der Gruppe `docker` ist, kann sich über einen Container Root-Rechte
verschaffen. Auf einem Rechner, der ausschließlich PATIO betreibt, ist das
vertretbar — bewusst entscheiden sollte man es trotzdem.
:::

## 5. SSH absichern

::: danger Erst testen, dann sperren
Stellen Sie sicher, dass die Anmeldung als `patio` funktioniert, bevor Sie
den Root-Zugang deaktivieren.
:::

Schlüssel hinterlegen:

```bash
sudo mkdir -p /home/patio/.ssh
sudo cp /root/.ssh/authorized_keys /home/patio/.ssh/
sudo chown -R patio:patio /home/patio/.ssh
sudo chmod 700 /home/patio/.ssh
sudo chmod 600 /home/patio/.ssh/authorized_keys
```

Dann in `/etc/ssh/sshd_config`:

```ini
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

```bash
sudo systemctl restart ssh
```

## 6. Firewall

Der Rechner steht im internen Netz, nicht am Internet. Offen sein müssen nur
SSH und der Port des Reverse-Proxy:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 22 proto tcp    # SSH
sudo ufw allow from 192.168.0.0/16 to any port 443 proto tcp   # PATIO
sudo ufw allow from 192.168.0.0/16 to any port 445 proto tcp   # Netzfreigabe
sudo ufw enable
sudo ufw status
```

Der Adressbereich ist an das eigene Netz anzupassen. SSH sollte enger stehen —
idealerweise nur der Arbeitsplatz der Administration.

::: warning Datenbank bleibt intern
Der PostgreSQL-Port darf nicht ins Netz. Der Datenbank-Container hängt nur im
internen Docker-Netz und veröffentlicht keinen Port — in `docker-compose.yml`
steht bei ihm bewusst kein `ports:`.
:::

## 7. Zeit

```bash
sudo timedatectl set-timezone Europe/Vienna
```

PATIO rechnet intern mit `Europe/Vienna` (`TIMEZONE` in `src/config.ts`).
Weicht die Systemzeit ab, stimmen die Zeitstempel in Protokollen und
Bautagebuch nicht mit der Wanduhr überein.

::: danger Zeitabgleich ohne Internet
Ohne Internet gibt es kein NTP nach draußen. Läuft die Uhr über Monate weg,
werden die **Zertifikate der internen Zertifizierungsstelle ungültig** — und
niemand kommt mehr hinein.

Den Router als Zeitquelle eintragen, in `/etc/systemd/timesyncd.conf`:

```ini
[Time]
NTP=192.168.1.1
```

```bash
sudo systemctl restart systemd-timesyncd
timedatectl show -p NTPSynchronized --value    # muss "yes" sagen
```
:::

## 7a. Weiteres zur Grundeinrichtung

**Automatischer Start nach Stromausfall.** Im BIOS/UEFI „Power On After Power
Loss" auf *ein*. Sonst steht das Büro, bis jemand den Knopf drückt.

**USV anbinden**, sodass die Maschine bei leerem Akku selbst herunterfährt:

```bash
sudo apt install -y nut
```

Eine USV, die nur überbrückt, schützt die Zeit — nicht die Daten.

**Journal begrenzen**, damit Protokolle über Jahre nicht die Platte füllen.
In `/etc/systemd/journald.conf`:

```ini
[Journal]
SystemMaxUse=2G
```

## 8. Verzeichnisse anlegen

```bash
sudo mkdir -p /opt/patio /opt/patio-workspace /mnt/patio-backup

# Anwendungsverzeichnis: dem Dienst-Benutzer.
sudo chown -R patio:patio /opt/patio

# Dokumente: der UID 1000 — NICHT dem Benutzer `patio`. Begründung unten.
sudo chown -R 1000:1000 /opt/patio-workspace
```

| Verzeichnis | Inhalt | Eigentümer |
|---|---|---|
| `/opt/patio` | Anwendung, `.env`, Compose-Datei | `patio` |
| `/opt/patio-workspace` | Dokumente (`WORKSPACE_PATH`, zugleich Samba-Freigabe) | **UID 1000** |
| `/mnt/patio-backup` | externe Sicherungsplatte | `root` (systemd hängt ein) |

::: danger Die häufigste Falle: `chown -R patio:patio` auf das Dokumentenverzeichnis
Der Container läuft als `node` = **UID 1000** (`Dockerfile`, `USER node`).

Der Dienst-Benutzer `patio` bekommt beim Anlegen irgendeine andere UID — bei
`adduser` die nächste freie (oft 1001, wenn schon ein Konto existiert), bei
`useradd -r` sogar eine **unter** 1000, weil das ein Systemkonto ist.

Gibt man das Dokumentenverzeichnis diesem Benutzer, passt die UID nicht mehr
zu der, unter der der Dienst schreibt. **Er kann dann keine Datei ablegen.**
Der Fehler zeigt sich an ganz anderer Stelle, weil stille `catch`-Blöcke ihn
maskieren — in einem früheren Fall trat er als „LLM nicht erreichbar" auf,
obwohl in Wahrheit nur das Log-Schreiben scheiterte.

Prüfen:

```bash
stat -c '%u %g %n' /opt/patio-workspace     # muss 1000 1000 zeigen
docker exec patio-app touch /workspace/.probe && echo "Dienst kann schreiben"
docker exec patio-app rm /workspace/.probe
```
:::

## Zusammenfassung

Nach diesen Schritten steht:

- [x] Ubuntu 24.04 LTS, aktuell gehalten
- [x] Feste Adresse und DNS-Name im internen Netz
- [x] Dienst-Benutzer `patio` mit SSH-Schlüssel, Root-Login gesperrt
- [x] Firewall: nur SSH und HTTPS aus dem eigenen Netz
- [x] Zeitzone `Europe/Vienna`
- [x] Verzeichnisse angelegt — Dokumente gehören **UID 1000**, nicht `patio`

## Nächster Schritt

→ [PATIO installieren](/betrieb/installation)
