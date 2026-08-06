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
log "Image bauen: patio-app:${VERSION}"
docker build -t "patio-app:${VERSION}" -t "patio-app:latest" . \
  || fehl "docker build fehlgeschlagen."

# ── 3. Paket schnueren ───────────────────────────────────────────────────────
mkdir -p "$AUSGABE"
ARBEIT=$(mktemp -d)
trap 'rm -rf "$ARBEIT"' EXIT

log "Image speichern (dauert einen Moment)..."
docker save "patio-app:${VERSION}" "patio-app:latest" | gzip > "$ARBEIT/image.tar.gz"

# Dazu alles, was der Server neben dem Image braucht. Compose-Datei und
# Skripte aendern sich mit — sie muessen zum Image passen.
log "Konfiguration und Skripte beilegen..."
mkdir -p "$ARBEIT/dabei"
cp docker-compose.yml "$ARBEIT/dabei/"
cp .env.example "$ARBEIT/dabei/"
cp -r docker "$ARBEIT/dabei/"
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
sha256sum "$PAKET" > "${PAKET}.sha256"

GROESSE=$(du -h "$PAKET" | cut -f1)
echo
echo "════════════════════════════════════════════════════════"
echo "Paket fertig: $PAKET ($GROESSE)"
echo "════════════════════════════════════════════════════════"
cat "$ARBEIT/PAKET.txt"
