#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# PATIO — Auslieferungspaket fuer den Firmenserver bauen
#
# LAEUFT AUF DEM ENTWICKLUNGSRECHNER, nicht auf dem Server.
#
# Warum es das gibt: der Firmenserver hat kein Internet. `git pull`,
# `npm install` und `docker compose pull` funktionieren dort nicht — genau
# darauf bauten aber die frueheren Update-Wege (update.sh, docker-update.sh).
# Stattdessen entsteht hier EINE Datei, die per USB-Stick oder ueber die
# Sicherungsplatte auf den Server wandert.
#
# Aufruf:
#   bash scripts/release-offline.sh              # Version aus package.json
#   bash scripts/release-offline.sh 0.2.0        # ausdrueckliche Version
#
# Ergebnis in release/:
#   patio-<version>.tar.gz        Image + Konfiguration + Skripte
#   patio-<version>.tar.gz.sha256 Pruefsumme
#
# Auf dem Server einspielen:  scripts/update-offline.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-$(node -p "require('./package.json').version")}"
AUSGABE="release"
PAKET="$AUSGABE/patio-${VERSION}.tar.gz"

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
fehl() { echo "FEHLER: $*" >&2; exit 1; }

command -v docker >/dev/null || fehl "docker nicht gefunden."

# ── Kein stilles Ueberschreiben ──────────────────────────────────────────────
#
# Ohne Argument kommt die Version aus package.json — und die steht seit dem
# ersten Commit auf 0.1.0. Jedes Paket hiess damit `patio-0.1.0.tar.gz` und
# ueberschrieb das vorige ohne Rueckfrage. Das vorige Paket ist aber der
# Rueckweg, wenn ein Update auf dem Server nicht traegt.
if [ -e "$PAKET" ] && [ "${UEBERSCHREIBEN:-false}" != "true" ]; then
  fehl "Es gibt bereits $PAKET (vom $(date -r "$PAKET" '+%d.%m.%Y %H:%M')).

       Ein zweites Paket derselben Version wuerde es ersetzen — und damit den
       Rueckweg, falls das Update auf dem Server nicht traegt.

       Entweder eine eigene Version vergeben:
         bash scripts/release-offline.sh 0.2.0
       oder bewusst ueberschreiben:
         UEBERSCHREIBEN=true bash scripts/release-offline.sh"
fi

# ── 1. Pruefkette ────────────────────────────────────────────────────────────
#
# Bewusst VOR dem Bau. Ein Paket, das der Server nicht starten kann, kostet
# einen zweiten Weg ins Buero — und im Zweifel einen Arbeitstag.
if [ "${SKIP_TESTS:-false}" != "true" ]; then
  log "Pruefkette..."
  npx tsc --noEmit                            || fehl "tsc"
  npx tsc --noEmit -p tsconfig.scripts.json   || fehl "tsc (scripts)"
  npx vue-tsc --noEmit -p web/tsconfig.json   || fehl "vue-tsc"
  npm run lint                                 || fehl "lint"
  if [ -n "${DATABASE_URL:-}" ]; then
    npm test || fehl "Tests"
  else
    # Ohne DATABASE_URL ueberspringt vitest still 142 von 267 Tests — genau
    # die ACL-, Auth- und DB-Tests — und meldet trotzdem gruen. Ein Paket auf
    # dieser Grundlage zu bauen waere fahrlaessig.
    fehl "DATABASE_URL ist nicht gesetzt. Ohne Datenbank ueberspringt die
       Testsuite still die Haelfte der Pruefungen und meldet trotzdem gruen.
       Setzen und erneut versuchen, oder mit SKIP_TESTS=true bewusst umgehen."
  fi
  log "Pruefkette gruen."
else
  log "WARNUNG: Pruefkette uebersprungen (SKIP_TESTS=true)."
fi

# ── 2. Image bauen ───────────────────────────────────────────────────────────
#
# Zwei Marken: die Version (der Rueckweg auf dem Server haengt daran) und
# `latest` (worauf docker-compose.yml zeigt).
# `MIT_PDF=nein` spart rund 350 MB LibreOffice im Image — der PDF-Weg
# antwortet dann mit 503 und einem Satz in Klartext, der Word-Export bleibt
# vollstaendig. docs/betrieb/updates.md empfiehlt das fuer kleinere Pakete,
# aber der Bau hier reichte den Wert nicht durch: wer vorher
# `docker compose build --build-arg MIT_PDF=nein app` lief, bekam von diesem
# Skript trotzdem wieder das volle Image.
log "Image bauen: patio-app:${VERSION} (MIT_PDF=${MIT_PDF:-ja})"
docker build \
  --build-arg "MIT_PDF=${MIT_PDF:-ja}" \
  -t "patio-app:${VERSION}" -t "patio-app:latest" . \
  || fehl "docker build fehlgeschlagen."

# ── 3. Paket schnueren ───────────────────────────────────────────────────────
mkdir -p "$AUSGABE"
ARBEIT=$(mktemp -d)
trap 'rm -rf "$ARBEIT"' EXIT

log "Image speichern (dauert einen Moment)..."
docker save "patio-app:${VERSION}" "patio-app:latest" | gzip > "$ARBEIT/image.tar.gz"

# ── Die Basis-Images gehoeren mit ins Paket ──────────────────────────────────
#
# Bis hierher enthielt das Paket NUR patio-app. Der Stack braucht aber drei
# fremde Images, und der Server hat kein Internet:
#
#   postgres:16      docker-compose.yml (Dienst `postgres`)
#   caddy:2-alpine   docker-compose.yml (Dienst `caddy`)
#   alpine:latest    scripts/backup.sh sichert damit den CA-Schluessel,
#                    scripts/restore.sh spielt ihn damit zurueck
#
# Auf einer BESTEHENDEN Installation faellt das nicht auf: postgres und caddy
# laufen ja und sind dadurch vorhanden. `alpine` haengt an keinem laufenden
# Container — fehlt es, scheitert die naechtliche Sicherung unter
# `set -euo pipefail`, und weil dort `2>/dev/null` steht, ohne jede Meldung.
# `update-offline.sh` bricht daraufhin JEDES Update ab, ohne dass die Ursache
# irgendwo steht.
#
# Bei einer ERSTINSTALLATION scheitert `docker compose up -d` sofort: es
# versucht zu ziehen und kommt nicht ins Netz.
#
# Vorher ziehen, damit das Paket auch dann vollstaendig ist, wenn auf diesem
# Rechner gerade nichts davon liegt.
log "Basis-Images beschaffen und speichern..."
BASIS_IMAGES="postgres:16 caddy:2-alpine alpine:latest"
for bild in $BASIS_IMAGES; do
  docker image inspect "$bild" >/dev/null 2>&1 || {
    log "  $bild fehlt lokal — ziehen..."
    docker pull "$bild" || fehl "$bild liess sich nicht beschaffen. Ohne die
       Basis-Images ist das Paket auf einem Rechner ohne Internet wertlos."
  }
done
# shellcheck disable=SC2086  # absichtlich in Woerter zerlegt
docker save $BASIS_IMAGES | gzip > "$ARBEIT/basis-images.tar.gz"

# Dazu alles, was der Server neben dem Image braucht. Compose-Datei und
# Skripte aendern sich mit — sie muessen zum Image passen.
log "Konfiguration und Skripte beilegen..."
mkdir -p "$ARBEIT/dabei"
cp docker-compose.yml "$ARBEIT/dabei/"
cp .env.example "$ARBEIT/dabei/"

# Aus docker/ nur, was der Stack wirklich einhaengt — nachgesehen in
# docker-compose.yml: `./docker/Caddyfile` und `./docker/init`.
#
# `cp -r docker` nahm frueher alles mit, also auch `docker-compose.vps.yml`
# (die abgeloeste VPS-Fassung) und `docker/.env.example` (dieselbe Rolle wie
# die Vorlage im Wurzelverzeichnis, nur aelter). Auf dem Server standen damit
# zwei Compose-Dateien und zwei .env-Vorlagen; wer im Stoerfall nachsieht,
# welche gilt, findet die falsche zuerst — sie liegt im Unterordner und sieht
# dadurch spezifischer aus.
mkdir -p "$ARBEIT/dabei/docker"
cp docker/Caddyfile "$ARBEIT/dabei/docker/"
cp -r docker/init   "$ARBEIT/dabei/docker/"

cp -r deploy "$ARBEIT/dabei/"
mkdir -p "$ARBEIT/dabei/scripts"
# Alles, was auf dem Server gebraucht wird. `release-offline.sh` gehoert
# NICHT dazu — es baut, und auf dem Server wird nie gebaut.
cp scripts/backup.sh \
   scripts/restore.sh \
   scripts/update-offline.sh \
   scripts/install-server.sh \
   scripts/patio-cli.sh \
   "$ARBEIT/dabei/scripts/"

cat > "$ARBEIT/PAKET.txt" <<EOF
PATIO — Auslieferungspaket
Version:   ${VERSION}
Gebaut:    $(date '+%d.%m.%Y %H:%M:%S')
Auf:       $(hostname)
Git:       $(git rev-parse --short HEAD 2>/dev/null || echo "kein Repo")$(git diff --quiet 2>/dev/null || echo " (mit uncommitteten Aenderungen!)")

Einspielen auf dem Server:
  1. Paket nach /opt/patio/ kopieren
  2. cd /opt/patio && bash scripts/update-offline.sh patio-${VERSION}.tar.gz

Das Update-Skript loest vorher eine Sicherung aus und kann bei einem
Fehlschlag auf das vorige Image zurueck.

ACHTUNG: Datenbank-Migrationen laufen nur vorwaerts. Der Rueckweg auf das
alte Image holt das Schema NICHT zurueck. Deshalb die Sicherung davor.
EOF

log "Paket schnueren..."
tar -czf "$PAKET" -C "$ARBEIT" .

# Pruefsumme mit reinem DATEINAMEN, nicht mit dem Pfad von hier.
#
# `sha256sum "$PAKET"` schreibt "release/patio-1.0.0.tar.gz" hinein — ein
# Pfad, den es auf dem Server nicht gibt. Dort liegt die Datei in /opt/patio.
# Wer nach dem Transport von Hand prueft (`sha256sum -c …`), bekommt dann
# "FAILED open or read" und haelt das Paket fuer beschaedigt.
#
# `update-offline.sh` faellt darauf nicht herein — es vergleicht nur den Hash.
# Aber die Handprobe ist der naheliegende erste Griff nach dem USB-Stick.
(cd "$AUSGABE" && sha256sum "$(basename "$PAKET")" > "$(basename "$PAKET").sha256")

GROESSE=$(du -h "$PAKET" | cut -f1)
echo
echo "════════════════════════════════════════════════════════"
echo "Paket fertig: $PAKET ($GROESSE)"
echo "════════════════════════════════════════════════════════"
cat "$ARBEIT/PAKET.txt"
