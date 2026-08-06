# Installationsskripte aus der Internet-Ära

Hier liegen fünf Skripte, die aus der Zeit stammen, als PATIO auf einer VPS
mit öffentlicher Domain lief und an mehrere Büros ausgeliefert werden sollte.

Aufgehoben am **2026-08-06** beim Umbau zum Firmenserver (AP1, Teil G).
Gelöscht wurden sie **nicht** — sollte PATIO je an andere Büros gehen, ist das
hier der Ausgangspunkt. Umschreiben müsste man sie ohnehin.

| Datei | Was sie tut | Warum sie nicht mehr passt |
|---|---|---|
| `new-customer.sh` | legt einen DNS-Eintrag über die **Cloudflare-API** an und gibt dem Kunden einen Installationsbefehl | setzt eine öffentliche Domain und einen Cloudflare-Zugang voraus |
| `install-customer.sh` | Kunden-Installer: Let's Encrypt, offene Ports 80/443, Domain zeigt auf den Server | der Firmenserver ist aus dem Internet nicht erreichbar und soll es nicht sein |
| `install.sh` | Installation direkt auf der Maschine (Node, Postgres, systemd-Unit) | die gewählte Betriebsform ist „alles in Docker"; das Image kommt fertig vom Entwicklungsrechner |
| `install-docker.sh` | Docker-Installer: `git clone` von GitHub, Image auf der Maschine bauen, SMTP abfragen, externes `proxy`-Netz anlegen | jeder dieser vier Schritte setzt Internet oder abgelöste Technik voraus. Ersetzt durch `scripts/install-server.sh` |
| `uninstall.sh` | entfernt systemd-Unit, Dienstbenutzer und Verzeichnisse | betraf die Bare-Metal-Installation. Beim Docker-Stack genügt `docker compose down -v` plus das Löschen von `/opt/patio` |

> Die letzten beiden verwiesen zuletzt auf Dateien, die es nicht mehr gibt
> (`patio.service`, `update.sh`, `docker-update.sh`) — sie hätten also
> ohnehin nicht mehr funktioniert.

## Was an ihre Stelle getreten ist

- **Einrichtung:** `scripts/install-docker.sh` (wird zu `install-server.sh`)
- **Update:** `scripts/release-offline.sh` auf dem Entwicklungsrechner,
  `scripts/update-offline.sh` auf dem Server — beide ohne Internet
- **Zertifikat:** eigene lokale CA über Caddy statt Let's Encrypt
  (`docker/Caddyfile`)

## Zwei Fallen, falls jemand hier weiterarbeitet

1. **`install.sh:422` legt den Dienstbenutzer mit `useradd -r` an** — also als
   Systemkonto mit einer uid *unter* 1000. Der Container schreibt aber als
   uid 1000. Wer das Dokumentenverzeichnis diesem Benutzer gibt, baut sich
   einen `EACCES`-Fehler ein, der sich an ganz anderer Stelle zeigt. Siehe
   `docs/betrieb/freigabe.md`.
2. Alle drei Skripte holen den Code per `git clone` bzw. `curl` von GitHub.
   Auf einem Rechner ohne Internet funktioniert davon nichts.
