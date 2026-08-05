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

Automatische Sicherheitsupdates einschalten:

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

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
sudo ufw allow from 192.168.0.0/16 to any port 22 proto tcp
sudo ufw allow from 192.168.0.0/16 to any port 443 proto tcp
sudo ufw enable
sudo ufw status
```

Das Adressbereich ist an das eigene Netz anzupassen.

::: warning Datenbank bleibt intern
Der PostgreSQL-Port darf nicht ins Netz. Im Compose-Aufbau hängt der
Datenbank-Container nur im internen Docker-Netz und veröffentlicht keinen
Port; bei einer Bare-Metal-Installation gehört `listen_addresses` auf
`localhost`.
:::

## 7. Zeitzone setzen

```bash
sudo timedatectl set-timezone Europe/Vienna
```

PATIO rechnet intern mit `Europe/Vienna` (`TIMEZONE` in `src/config.ts`).
Weicht die Systemzeit ab, stimmen die Zeitstempel in Protokollen und
Bautagebuch nicht mit der Wanduhr überein.

## 8. Verzeichnisse anlegen

```bash
sudo mkdir -p /opt/patio /opt/patio-workspace /opt/patio-backups
sudo chown -R patio:patio /opt/patio /opt/patio-workspace /opt/patio-backups
```

| Verzeichnis | Inhalt |
|---|---|
| `/opt/patio` | Anwendung, `.env`, Compose-Datei |
| `/opt/patio-workspace` | hochgeladene Dokumente (`WORKSPACE_PATH`) |
| `/opt/patio-backups` | Tagesbackups |

::: warning Rechte bei Bind-Mounts
Läuft der Container als Benutzer mit UID 1000, gehören die gemounteten
Verzeichnisse auf dem Host auch dieser UID. Sonst scheitert das Schreiben
mit `EACCES` — und der Fehler zeigt sich an unerwarteter Stelle, etwa als
fehlschlagender Upload.
:::

## Zusammenfassung

Nach diesen Schritten steht:

- [x] Ubuntu 24.04 LTS, aktuell gehalten
- [x] Feste Adresse und DNS-Name im internen Netz
- [x] Dienst-Benutzer `patio` mit SSH-Schlüssel, Root-Login gesperrt
- [x] Firewall: nur SSH und HTTPS aus dem eigenen Netz
- [x] Zeitzone `Europe/Vienna`
- [x] Verzeichnisse angelegt und dem Dienst-Benutzer zugeordnet

## Nächster Schritt

→ [Software installieren](/betrieb/software)
