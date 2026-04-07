# Server erstellen

Schritt-fuer-Schritt-Anleitung: Hetzner VPS aufsetzen und absichern.

## 1. Server in Hetzner Cloud anlegen

1. Melde dich bei [console.hetzner.cloud](https://console.hetzner.cloud) an
2. Klicke **"Server erstellen"**
3. Waehle folgende Einstellungen:

| Einstellung | Wert |
|---|---|
| **Standort** | Falkenstein oder Nuernberg (DE) |
| **Image** | Ubuntu 24.04 LTS |
| **Typ** | Shared vCPU → **CPX21** (3 vCPU, 8 GB, 80 GB) |
| **Netzwerk** | Standard (Public IPv4 + IPv6) |
| **SSH Key** | Deinen oeffentlichen Key hinzufuegen |
| **Name** | z.B. `bau-os-kunde1` |

4. Klicke **"Erstellen & Kaufen"**
5. Notiere dir die **IP-Adresse**

::: tip CPX11 reicht zum Testen
Fuer erste Tests kannst du mit CPX11 (4 GB RAM) starten und spaeter upgraden. Hetzner erlaubt Upgrades ohne Datenverlust.
:::

## 2. Firewall konfigurieren

::: warning Nur SSH wird benoetigt
Bau-OS verbindet sich aktiv zu Telegram (Long Polling) und Ollama laeuft lokal. Es sind **keine eingehenden Ports ausser SSH** noetig.
:::

Erstelle eine Firewall in Hetzner Cloud:

| Richtung | Protokoll | Port | Quelle | Aktion |
|---|---|---|---|---|
| **Eingehend** | TCP | 22 | Alle | Erlauben |
| **Eingehend** | ICMP | — | Alle | Erlauben |
| **Eingehend** | Alles andere | — | — | Blockieren |
| **Ausgehend** | Alles | — | — | Erlauben |

Weise die Firewall dem Server zu.

## 3. Erster Login

```bash
ssh root@DEINE_SERVER_IP
```

## 4. System aktualisieren

```bash
apt update && apt upgrade -y
```

::: tip Automatische Sicherheitsupdates
```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```
:::

## 5. Nicht-Root-Benutzer erstellen

```bash
# Benutzer erstellen
adduser bauos

# Sudo-Rechte vergeben
usermod -aG sudo bauos

# SSH Key fuer den neuen Benutzer kopieren
mkdir -p /home/bauos/.ssh
cp /root/.ssh/authorized_keys /home/bauos/.ssh/
chown -R bauos:bauos /home/bauos/.ssh
chmod 700 /home/bauos/.ssh
chmod 600 /home/bauos/.ssh/authorized_keys
```

Teste den Login in einem **neuen Terminal**:

```bash
ssh bauos@DEINE_SERVER_IP
```

## 6. SSH absichern

::: danger Erst testen, dann sperren
Stelle sicher, dass der Login als `bauos` funktioniert, bevor du den Root-Login deaktivierst!
:::

```bash
sudo nano /etc/ssh/sshd_config
```

Aendere diese Zeilen:

```ini
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

SSH-Dienst neu starten:

```bash
sudo systemctl restart sshd
```

## 7. Swap einrichten (optional, empfohlen bei 4 GB RAM)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Permanent machen
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Pruefen:

```bash
free -h
```

## 8. Zeitzone setzen

```bash
sudo timedatectl set-timezone Europe/Vienna
```

## Server-Zusammenfassung

Nach diesen Schritten hast du:

- [x] Einen VPS mit Ubuntu 24.04 LTS
- [x] Firewall: nur SSH offen
- [x] Einen `bauos`-Benutzer mit SSH-Key-Login
- [x] Root-Login und Passwort-Login deaktiviert
- [x] (Optional) 2 GB Swap fuer zusaetzlichen Spielraum

## Naechster Schritt

→ [Software installieren](/betrieb/software)
