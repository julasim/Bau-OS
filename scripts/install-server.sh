#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# PATIO — Erstinstallation auf dem Firmenserver
#
# Getestet auf Ubuntu Server 24.04 LTS.
#
# Aufruf (auf der Maschine, mit dem Auslieferungspaket daneben):
#   sudo bash install-server.sh patio-0.2.0.tar.gz
#
# ── Warum dieses Skript und nicht install-docker.sh ──────────────────────────
#
# Der frühere Installer holte den Code per `git clone` von GitHub, baute das
# Image auf der Maschine und fragte SMTP-Zugangsdaten ab. Auf dem Firmenserver
# funktioniert davon nichts: kein Internet, kein Bauen, kein Mailversand. Das
# fertige Image kommt stattdessen als Paket vom Entwicklungsrechner.
#
# ── Was dieses Skript NICHT tut ─────────────────────────────────────────────
#
# Es installiert KEINE Pakete — es prueft nur, ob Docker da ist. Das ist
# Absicht (der Server hat kein Internet), wurde aber zweimal falsch
# dokumentiert: „install-server.sh installiert Docker und Samba". Docker muss
# im einmaligen Internet-Fenster von Hand kommen:
#   sudo apt install -y docker.io docker-compose-v2
#
# Was es sehr wohl tut: die .env mit frischen Geheimnissen anlegen, Eigentuemer
# setzen, das Paket auspacken, den Stack starten, die systemd-Einheiten der
# Sicherung installieren und `patio` nach /usr/local/bin legen.
#
# Dazu bleiben drei Schritte Handarbeit, weil sie Entscheidungen brauchen:
#   1. die Sicherungsplatte einrichten (formatieren löscht Daten)
#   2. das CA-Wurzelzertifikat auf die Arbeitsplätze bringen
#   3. den Rechnernamen im Router-DNS eintragen
# Das Skript sagt am Ende, was zu tun ist.
#
# ── Keine Netzfreigabe mehr ─────────────────────────────────────────────────
#
# Bis zum 29.08.2026 richtete dieser Abschnitt zusaetzlich eine Samba-Freigabe
# „Dokumente" ein — ein Netzordner, den jeder im Explorer einbinden konnte.
# Der Weg ist entfallen: Dateien kommen ausschliesslich ueber PATIO selbst
# herein und liegen in der Datenbank, mit Projektbezug, Rechten und
# Volltextsuche.
#
# Der Ordner /opt/patio-workspace bleibt bestehen — der Dienst haengt ihn
# weiterhin ein und liest daraus Alt-Datensaetze nach, deren Inhalt nicht in
# der Datenbank liegt. Von aussen erreichbar ist er nicht mehr.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/patio}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/opt/patio-workspace}"
BACKUP_DIR="${BACKUP_DIR:-/mnt/patio-backup}"
HOSTNAME_VORGABE="${PATIO_HOSTNAME:-patio.sima.intern}"

readonly GRUEN='\033[0;32m' GELB='\033[1;33m' ROT='\033[0;31m' FETT='\033[1m' AUS='\033[0m'
schritt() { echo -e "\n${FETT}▶ $*${AUS}"; }
ok()      { echo -e "  ${GRUEN}✓${AUS} $*"; }
hinweis() { echo -e "  ${GELB}!${AUS} $*"; }
fehl()    { echo -e "  ${ROT}✗${AUS} $*" >&2; exit 1; }

PAKET="${1:-}"
[ "$EUID" -eq 0 ] || fehl "Bitte mit sudo aufrufen."
[ -n "$PAKET" ]   || fehl "Aufruf: sudo bash $0 <paket.tar.gz>"
[ -f "$PAKET" ]   || fehl "Paket nicht gefunden: $PAKET"
PAKET=$(readlink -f "$PAKET")

# ── 1. Voraussetzungen ───────────────────────────────────────────────────────
schritt "Voraussetzungen prüfen"

command -v docker >/dev/null || fehl "Docker fehlt. Einmalig mit Internet installieren:
       sudo apt update && sudo apt install -y docker.io docker-compose-v2"
docker compose version >/dev/null 2>&1 || fehl "docker compose (v2) fehlt."
ok "Docker vorhanden: $(docker --version | cut -d, -f1)"

# Uhrzeit: ohne Internet gibt es kein NTP nach draußen. Läuft die Uhr weg,
# laufen die Zertifikate der internen CA ins Leere und alle Zeitstempel
# stimmen nicht.
if timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes; then
  ok "Uhrzeit abgeglichen"
else
  hinweis "Uhrzeit NICHT abgeglichen. Ohne Internet als Zeitquelle den Router
       eintragen (/etc/systemd/timesyncd.conf). Läuft die Uhr weg, werden die
       Zertifikate der internen CA ungültig."
fi

# ── 2. Verzeichnisse ─────────────────────────────────────────────────────────
schritt "Verzeichnisse anlegen"

mkdir -p "$INSTALL_DIR"/{scripts,logs,data}
mkdir -p "$WORKSPACE_DIR"
mkdir -p "$BACKUP_DIR"

# Der Container läuft als `node` = uid 1000 und liest aus diesem Verzeichnis
# Alt-Datensaetze nach. Gehört es jemand anderem, bekommt der Dienst EACCES —
# und der Fehler zeigt sich an ganz anderer Stelle.
#
# Bis zum 29.08.2026 stand hier noch ein zweiter Grund: die Samba-Freigabe
# schrieb mit derselben Kennung hinein, damit sich Dienst und Kolleginnen
# nicht gegenseitig aussperren. Diesen zweiten Schreiber gibt es nicht mehr.
chown -R 1000:1000 "$WORKSPACE_DIR"
ok "$WORKSPACE_DIR gehört uid 1000 (die Kennung des Dienstes)"

# Dasselbe gilt für die drei Bind-Mounts aus docker-compose.yml. Hier legt sie
# root an, der Container schreibt als uid 1000 — und `src/logger.ts` schluckt
# den EACCES in einem leeren `catch`. Ohne diese Zeile bleiben
# `logs/patio.log` und `logs/patio.jsonl` DAUERHAFT LEER, während der Dienst
# selbst normal läuft: stdout geht weiter an `docker compose logs`.
#
# Das ist heimtückisch, weil docs/betrieb/monitoring.md und die
# Schnelldiagnose in troubleshooting.md genau auf diese Dateien zeigen. Der
# Fehlerzähler meldet dort 0 auf einer Maschine, die Fehler hat.
#
# Das `chown -R node:node` im Dockerfile hilft nicht: das gilt fürs Image,
# nicht für den daruntergehängten Ordner vom Host.
chown -R 1000:1000 "$INSTALL_DIR"/{logs,data}
ok "logs/ und data/ gehören uid 1000 (sonst bleibt das Protokoll leer)"
ok "$INSTALL_DIR angelegt"

# ── 3. Konfiguration ─────────────────────────────────────────────────────────
schritt "Konfiguration"

if [ -f "$INSTALL_DIR/.env" ]; then
  ok ".env vorhanden — bleibt unberührt"
else
  command -v openssl >/dev/null || fehl "openssl fehlt (für die Geheimnisse)."

  # ── Liegt schon ein Datenbank-Volume herum? ────────────────────────────────
  #
  # Gleich wird eine .env mit einem ZUFAELLIGEN POSTGRES_PASSWORD erzeugt.
  # Postgres uebernimmt das aber nur bei LEEREM Datenverzeichnis. Liegt das
  # Volume noch von einem frueheren Versuch da, behaelt es sein altes Passwort,
  # und der Dienst kommt nicht hinein:
  #
  #     password authentication failed for user "patio"
  #
  # Die Meldung, die der Dienst dazu ausgibt, zeigt in die falsche Richtung —
  # sie rät, Postgres zu starten und die Zugangsdaten zu pruefen. Postgres
  # LAEUFT aber, und die .env ist in sich richtig; sie passt nur nicht zum
  # Volume. Wer der Meldung folgt, sucht ueberall ausser an der Stelle.
  #
  # Das trifft jeden zweiten Anlauf: abgebrochene Installation, ein
  # `rm -rf /opt/patio` mit Neuversuch, oder ein Ersatzgeraet, auf dem schon
  # einmal etwas getestet wurde.
  #
  # Der Projektname steht FEST in docker-compose.yml (`name: patio`), haengt
  # also nicht am Installationsverzeichnis — das Volume heisst immer gleich,
  # egal wohin installiert wird. Die Compose-Datei selbst liegt hier noch
  # nicht: sie kommt erst mit dem Paket, einen Schritt spaeter.
  #
  # `COMPOSE_PROJECT_NAME` hat Vorrang vor dem `name:` in der Datei. Wer damit
  # bewusst einen zweiten, getrennten Stand faehrt, bekommt eigene Volumes —
  # und die Pruefung muss dann auf DIESE sehen, nicht auf die fremden.
  PROJEKT="${COMPOSE_PROJECT_NAME:-patio}"
  if docker volume inspect "${PROJEKT}_postgres_data" >/dev/null 2>&1; then
    fehl "Es gibt schon ein Datenbank-Volume: ${PROJEKT}_postgres_data

       Gleich entstuende eine neue .env mit einem neuen Zufallspasswort — das
       Volume behaelt aber sein altes. Der Dienst kaeme dann nicht an die
       Datenbank, und die Fehlermeldung wuerde auf Netz und Zugangsdaten
       zeigen statt hierher.

       Steckt in dem Volume noch etwas Wertvolles?
         NEIN, weg damit (loescht die Datenbank unwiderruflich):
           docker volume rm ${PROJEKT}_postgres_data
           danach dieses Skript erneut aufrufen

         JA, es gehoert zu einer bestehenden Installation:
           dann fehlt nur die .env dazu. Sie aus der Sicherung
           zurueckholen — ohne sie ist das Volume nicht mehr lesbar, denn
           der ENCRYPTION_KEY steht darin."
  fi
  cat > "$INSTALL_DIR/.env" <<ENVE
# PATIO — erzeugt von install-server.sh am $(date '+%d.%m.%Y %H:%M')
# Erklärungen zu allen Werten: .env.example

WORKSPACE_PATH=/workspace
WORKSPACE_HOST_DIR=$WORKSPACE_DIR

JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
ENCRYPTION_KEY=$(openssl rand -base64 48 | tr -d '\n')

POSTGRES_USER=patio
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '\n/+=')
POSTGRES_DB=patio

PATIO_HOSTNAME=$HOSTNAME_VORGABE
API_PORT=3000

BACKUP_DIR=$BACKUP_DIR
DB_AUTO_MIGRATE=true
AUDIT_RETENTION_DAYS=365
ENVE
  chmod 600 "$INSTALL_DIR/.env"
  ok ".env erzeugt, Geheimnisse zufällig, Rechte 600"
  hinweis "Diese Datei gehört in die Sicherung — der ENCRYPTION_KEY
       entschlüsselt Felder in der Datenbank."
fi

# ── 4. Paket einspielen ──────────────────────────────────────────────────────
schritt "Auslieferungspaket einspielen"

# Das Update-Skript liegt im Paket. Für die Erstinstallation holen wir es
# vorab heraus, damit es die eigentliche Arbeit machen kann.
VORAB=$(mktemp -d)
tar -xzf "$PAKET" -C "$VORAB" ./dabei/scripts 2>/dev/null || tar -xzf "$PAKET" -C "$VORAB"
cp "$VORAB/dabei/scripts/"*.sh "$INSTALL_DIR/scripts/"
chmod +x "$INSTALL_DIR/scripts/"*.sh
rm -rf "$VORAB"

# Bei der Erstinstallation gibt es noch nichts zu sichern.
# INSTALL_DIR ausdruecklich exportieren, damit das aufgerufene Skript denselben
# Pfad sieht — sonst faellt es auf seine eigene Vorgabe /opt/patio zurueck.
export INSTALL_DIR
SKIP_BACKUP=true bash "$INSTALL_DIR/scripts/update-offline.sh" "$PAKET" \
  || fehl "Das Einspielen ist fehlgeschlagen."

# ── 5. Sicherung einrichten ──────────────────────────────────────────────────
schritt "Zeitplan für die Sicherung"

if [ -d "$INSTALL_DIR/deploy" ]; then
  cp "$INSTALL_DIR/deploy/patio-backup.service" \
     "$INSTALL_DIR/deploy/patio-backup.timer" \
     "$INSTALL_DIR/deploy/patio-backup-fehler@.service" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable patio-backup.timer >/dev/null 2>&1
  ok "patio-backup.timer eingerichtet (täglich 03:00)"
  hinweis "Gestartet wird er erst, wenn die Sicherungsplatte eingehängt ist —
       sonst schlüge der erste Lauf zu Recht fehl."
fi

# ── 6. Verwaltungswerkzeug ───────────────────────────────────────────────────
schritt "Verwaltungswerkzeug"

if [ -f "$INSTALL_DIR/scripts/patio-cli.sh" ]; then
  ln -sf "$INSTALL_DIR/scripts/patio-cli.sh" /usr/local/bin/patio
  chmod +x "$INSTALL_DIR/scripts/patio-cli.sh"
  ok "Befehl 'patio' verfügbar — 'patio status' zeigt den Zustand"
fi

# ── Abschluss ────────────────────────────────────────────────────────────────
cat <<ENDE

════════════════════════════════════════════════════════════════
PATIO ist installiert.
════════════════════════════════════════════════════════════════

  Zustand ansehen:   patio status
  Protokoll:         patio logs

Drei Schritte fehlen noch — sie brauchen Entscheidungen und stehen
deshalb nicht im Skript:

  1. SICHERUNGSPLATTE
     Externe Platte anstecken, mit ext4 formatieren (löscht sie!),
     über die UUID einhängen. Danach:
         sudo systemctl start patio-backup.timer
         sudo patio sicherung          # einmal von Hand, zusehen
         cd $INSTALL_DIR && sudo docker compose up -d --force-recreate app

     Die letzte Zeile nicht überspringen: Die Container laufen seit eben,
     die Platte kommt erst jetzt dazu. Ohne das Neuerzeugen sieht der Dienst
     weiterhin das leere Verzeichnis von vorhin und meldet unter
     „Verwaltung → Sicherung" dauerhaft „keine Sicherung gefunden" —
     während nachts sauber gesichert wird.
     Anleitung: docs/betrieb/sicherung.md

  2. RECHNERNAME IM NETZ
     $HOSTNAME_VORGABE muss auf diesen Rechner zeigen —
     Eintrag im Router-DNS, ersatzweise die hosts-Datei je Arbeitsplatz.

  3. ZERTIFIKAT AUF DIE ARBEITSPLÄTZE
     Das Wurzelzertifikat der internen Zertifizierungsstelle holen:
         docker cp patio-caddy:/data/caddy/pki/authorities/local/root.crt .
     und einmalig auf jedem Arbeitsplatz installieren. Firefox hat einen
     eigenen Zertifikatspeicher.
     Anleitung: docs/betrieb/zertifikat.md

Danach im Browser https://$HOSTNAME_VORGABE/ öffnen — beim ersten
Aufruf führt der Einrichtungsassistent durch das Anlegen des
Administrator-Kontos.

ENDE
