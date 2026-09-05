#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# PATIO — Naechtliche Sicherung auf die externe Festplatte
#
# Gesichert wird alles, was nach einem Totalausfall NICHT wiederbeschaffbar
# ist. Compose-Datei, Caddyfile und die Skripte gehoeren nicht dazu — die
# kommen aus dem Auslieferungspaket:
#
#   1. Die Datensaetze          pg_dump aus dem Container patio-postgres
#   2. Die Dokumente            /opt/patio-workspace (echte Dateien)
#   3. .env                     enthaelt JWT_SECRET und ENCRYPTION_KEY
#   4. data/                   Legacy-Konten (users.json)
#   5. Volume caddy_data        der private Schluessel der internen CA
#
# Punkt 5 ist neu und der teuerste, wenn er fehlt: geht der CA-Schluessel
# verloren, erzeugt Caddy beim Neuaufbau eine NEUE Zertifizierungsstelle — und
# dann muss jemand an JEDEN Arbeitsplatz, um das neue Wurzelzertifikat
# einzuspielen. Die Sicherung waere formal vollstaendig und der Wiederanlauf
# trotzdem ein Tagesprojekt.
#
# Punkt 3 gehoert zwingend zu Punkt 1: der ENCRYPTION_KEY entschluesselt Felder
# in der Datenbank. Dump ohne .env ist unvollstaendig.
#
# Aufbewahrung gestaffelt (Grossvater-Vater-Sohn):
#   7 Tagesstaende · 4 Wochenstaende · 12 Monatsstaende
# Wochen- und Monatsstaende sind HARTE LINKS auf den jeweiligen Tagesstand und
# kosten damit keinen zusaetzlichen Platz. Das setzt ein Linux-Dateisystem auf
# der externen Platte voraus (ext4) — exFAT und NTFS koennen das nicht.
#
# Aufruf (normalerweise ueber den systemd-Timer patio-backup.timer):
#   sudo bash /opt/patio/scripts/backup.sh
#
# Rueckweg: scripts/restore.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/patio}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/opt/patio-workspace}"
BACKUP_DIR="${BACKUP_DIR:-/mnt/patio-backup}"

# Muss die Sicherungsplatte eingehaengt sein? Standard: ja.
# Nur fuer Probelaeufe auf einem gewoehnlichen Verzeichnis abschaltbar.
REQUIRE_MOUNT="${REQUIRE_MOUNT:-true}"

DB_CONTAINER="${DB_CONTAINER:-patio-postgres}"
CADDY_VOLUME="${CADDY_VOLUME:-patio_caddy_data}"
POSTGRES_USER="${POSTGRES_USER:-patio}"
POSTGRES_DB="${POSTGRES_DB:-patio}"

# Staffelung
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"

# Ab diesem Fuellstand der Zielplatte wird gewarnt (Prozent).
DISK_WARN_PERCENT="${DISK_WARN_PERCENT:-80}"

STAMP=$(date +%Y%m%d-%H%M%S)

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fehl() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] FEHLER: $*" >&2; exit 1; }

# ── 1. Ziel pruefen ──────────────────────────────────────────────────────────
#
# DIE wichtigste Pruefung des ganzen Skripts. Ist die externe Platte nicht
# eingehaengt, existiert das Einhaenge-Verzeichnis trotzdem — es liegt dann auf
# der SYSTEMPLATTE. Ohne diese Pruefung schreibt die Sicherung dorthin, meldet
# Erfolg, fuellt ueber Wochen das Wurzel-Dateisystem, und auffallen wuerde es
# erst in dem Moment, in dem man die Sicherung braucht. Genau dieser stille
# Fehlschlag soll hier unmoeglich sein.
if [ "$REQUIRE_MOUNT" = "true" ]; then
  if ! mountpoint -q "$BACKUP_DIR"; then
    fehl "Die Sicherungsplatte ist nicht eingehaengt: $BACKUP_DIR
       Ohne sie wuerde die Sicherung auf die Systemplatte schreiben und dort
       still auflaufen. Pruefen mit:  lsblk -f   und   systemctl status $(systemd-escape -p --suffix=mount "$BACKUP_DIR" 2>/dev/null || echo '<mount-unit>')
       Der Einhaenge-Eintrag arbeitet mit der UUID der Platte, nicht mit
       /dev/sdX — der Geraetename wandert, sobald etwas anderes angesteckt wird."
  fi
  log "Sicherungsplatte eingehaengt: $BACKUP_DIR"
fi

[ -d "$WORKSPACE_DIR" ] || fehl "Dokumentenverzeichnis nicht gefunden: $WORKSPACE_DIR"
[ -d "$INSTALL_DIR" ]   || fehl "Installationsverzeichnis nicht gefunden: $INSTALL_DIR"

mkdir -p "$BACKUP_DIR"/{taeglich,woechentlich,monatlich}

# Platz pruefen, bevor etwas geschrieben wird.
BELEGT=$(df --output=pcent "$BACKUP_DIR" | tail -1 | tr -dc '0-9')
if [ "${BELEGT:-0}" -ge "$DISK_WARN_PERCENT" ]; then
  log "WARNUNG: Sicherungsplatte zu ${BELEGT}% belegt (Schwelle ${DISK_WARN_PERCENT}%)."
fi

ZIEL="$BACKUP_DIR/taeglich/$STAMP"
mkdir -p "$ZIEL"

# ── Abbruch-Aufraeumer ───────────────────────────────────────────────────────
#
# Ab hier existiert ein Zielverzeichnis. Bricht der Lauf danach ab — leerer
# Dump, tar-Fehler, Ctrl-C, SIGTERM —, blieb es bisher OHNE Marke liegen:
# weder `VOLLSTAENDIG` noch die Endung `.UNVOLLSTAENDIG`. Beide Aufraeumregeln
# unten sehen nur auf genau diese beiden Zustaende; ein markenloser Ordner
# gehoert damit keiner Kategorie an und bleibt fuer immer liegen. Bei einem
# Dump von mehreren hundert Megabyte fuellt das die Platte, ohne dass die
# Aufbewahrung es bemerkt.
#
# Der Aufraeumer erledigt ZWEI Dinge, und deshalb gibt es nur EINEN trap:
# ein zweiter `trap ... EXIT` wuerde den ersten stillschweigend ersetzen, und
# dann bliebe bei einem Abbruch waehrend der Selbstpruefung ein
# postgres:16-Container stehen.
PRUEF_CONTAINER="patio-backup-pruefung-$$"

abbruch_aufraeumen() {
  docker rm -f "$PRUEF_CONTAINER" >/dev/null 2>&1 || true
  # Nur eingreifen, wenn der Stand NICHT als vollstaendig markiert wurde.
  if [ -d "$ZIEL" ] && [ ! -f "$ZIEL/VOLLSTAENDIG" ]; then
    mv "$ZIEL" "${ZIEL}.UNVOLLSTAENDIG" 2>/dev/null || true
    log "Abgebrochener Stand als ${ZIEL}.UNVOLLSTAENDIG abgelegt."
  fi
}
trap abbruch_aufraeumen EXIT

# ── 2. Datenbank ─────────────────────────────────────────────────────────────
docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER" \
  || fehl "Postgres-Container laeuft nicht: $DB_CONTAINER"

log "Datenbank sichern..."
# --clean --if-exists --no-owner --no-privileges: direkt einspielbar, ohne
# dass Eigentuemer-Rollen auf dem Zielsystem existieren muessen.
docker exec "$DB_CONTAINER" pg_dump -U "$POSTGRES_USER" \
  --clean --if-exists --no-owner --no-privileges "$POSTGRES_DB" \
  | gzip > "$ZIEL/datenbank.sql.gz"

[ -s "$ZIEL/datenbank.sql.gz" ] || fehl "Datenbank-Dump ist leer."

# ── 3. Dokumente, Konfiguration, CA-Schluessel ───────────────────────────────
log "Dokumente sichern..."
tar -czf "$ZIEL/dokumente.tar.gz" -C "$(dirname "$WORKSPACE_DIR")" "$(basename "$WORKSPACE_DIR")"

log "Konfiguration sichern..."
# .env und data/ — jedes nur, wenn vorhanden.
TAR_TEILE=()
[ -f "$INSTALL_DIR/.env" ] && TAR_TEILE+=(".env")
[ -d "$INSTALL_DIR/data" ] && TAR_TEILE+=("data")
if [ ${#TAR_TEILE[@]} -gt 0 ]; then
  tar -czf "$ZIEL/konfiguration.tar.gz" -C "$INSTALL_DIR" "${TAR_TEILE[@]}"
else
  log "WARNUNG: weder .env noch data/ gefunden."
fi

log "CA-Schluessel sichern (Volume $CADDY_VOLUME)..."
if docker volume inspect "$CADDY_VOLUME" >/dev/null 2>&1; then
  # Ueber einen Wegwerf-Container, weil das Volume dem Docker-Daemon gehoert.
  docker run --rm -v "$CADDY_VOLUME":/quelle:ro -v "$ZIEL":/ziel alpine:latest \
    tar -czf /ziel/caddy-daten.tar.gz -C /quelle . 2>/dev/null
  [ -s "$ZIEL/caddy-daten.tar.gz" ] || log "WARNUNG: caddy-daten.tar.gz ist leer."
else
  log "WARNUNG: Volume $CADDY_VOLUME nicht gefunden — der CA-Schluessel fehlt in dieser Sicherung."
fi

# ── 4. Rechte + Pruefsummen ──────────────────────────────────────────────────
# konfiguration.tar.gz enthaelt .env mit JWT_SECRET und ENCRYPTION_KEY.
chmod 600 "$ZIEL"/*.gz
( cd "$ZIEL" && sha256sum ./*.gz > pruefsummen.sha256 )

# ── 5. Selbstpruefung: die Sicherung einmal zurueck lesen ────────────────────
#
# Eine Sicherung, die nie gelesen wurde, ist keine. Der frische Dump wird in
# einen Wegwerf-Container eingespielt und die Zeilen der Kerntabellen werden
# gegen die Quelle gehalten. Weicht etwas ab, schlaegt der Lauf fehl — lieber
# eine Fehlermeldung um 3 Uhr nachts als eine Ueberraschung im Ernstfall.
log "Selbstpruefung: Dump probeweise zurueckspielen..."
TABELLEN="users projects notes tasks termine team_members"

docker run -d --name "$PRUEF_CONTAINER" \
  -e POSTGRES_USER="$POSTGRES_USER" -e POSTGRES_PASSWORD=pruefung \
  -e POSTGRES_DB="$POSTGRES_DB" postgres:16 >/dev/null

for _ in $(seq 1 30); do
  docker exec "$PRUEF_CONTAINER" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$PRUEF_CONTAINER" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1 \
  || fehl "Pruef-Datenbank kam nicht hoch."

gunzip -c "$ZIEL/datenbank.sql.gz" \
  | docker exec -i "$PRUEF_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q >/dev/null 2>&1 \
  || fehl "Der Dump liess sich nicht einspielen — die Sicherung ist unbrauchbar."

ABWEICHUNGEN=0
for t in $TABELLEN; do
  soll=$(docker exec "$DB_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
          "SELECT count(*) FROM $t" 2>/dev/null || echo "-")
  ist=$(docker exec "$PRUEF_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
          "SELECT count(*) FROM $t" 2>/dev/null || echo "-")
  if [ "$soll" != "$ist" ]; then
    log "  ABWEICHUNG $t: Quelle $soll, Sicherung $ist"
    ABWEICHUNGEN=$((ABWEICHUNGEN + 1))
  else
    log "  $t: $ist Zeilen"
  fi
done
docker rm -f "$PRUEF_CONTAINER" >/dev/null 2>&1 || true

if [ "$ABWEICHUNGEN" -ne 0 ]; then
  # Den unbrauchbaren Stand kenntlich machen, statt ihn liegen zu lassen.
  # Ohne das nimmt `restore.sh` ohne Argument den JUENGSTEN Stand — und das
  # waere ausgerechnet dieser hier. Im Ernstfall wuerde also die kaputte
  # Sicherung eingespielt. Umbenennen statt loeschen: der Stand ist Beweis-
  # material fuer die Fehlersuche.
  mv "$ZIEL" "${ZIEL}.UNVOLLSTAENDIG"
  fehl "$ABWEICHUNGEN Tabelle(n) weichen ab — die Sicherung ist nicht vollstaendig.
       Der Stand liegt als ${ZIEL}.UNVOLLSTAENDIG und wird von restore.sh
       nicht angeboten."
fi
log "Selbstpruefung bestanden."

# ── 5b. Sind wirklich alle vier Bestandteile da? ─────────────────────────────
#
# Die Selbstpruefung oben deckt nur den Datenbank-Dump ab. Fuer die drei
# uebrigen Teile stand bisher lediglich eine WARNUNG im Protokoll, und die
# Marke VOLLSTAENDIG entstand trotzdem. Am teuersten faellt das beim
# CA-Schluessel aus: fehlt er, ist die Sicherung formal vollstaendig, der
# Wiederanlauf aber ein Tagesprojekt, weil jemand an jeden Arbeitsplatz muss.
#
# Ein Stand, dem etwas fehlt, ist deshalb ein UNVOLLSTAENDIGER Stand — kein
# vollstaendiger mit Fussnote.
FEHLT=()
for teil in datenbank.sql.gz dokumente.tar.gz konfiguration.tar.gz caddy-daten.tar.gz; do
  [ -s "$ZIEL/$teil" ] || FEHLT+=("$teil")
done
if [ ${#FEHLT[@]} -gt 0 ]; then
  mv "$ZIEL" "${ZIEL}.UNVOLLSTAENDIG"
  fehl "Der Sicherung fehlen Bestandteile: ${FEHLT[*]}
       Der Stand liegt als ${ZIEL}.UNVOLLSTAENDIG und wird von restore.sh
       nicht angeboten. Haeufigste Ursache bei caddy-daten.tar.gz: das Volume
       heisst anders als \$CADDY_VOLUME (${CADDY_VOLUME}) — pruefen mit
       'docker volume ls'."
fi

# Erst JETZT gilt der Stand als brauchbar. restore.sh sucht nach dieser Marke
# und ueberspringt jeden Stand ohne sie — auch einen, der mittendrin
# abgebrochen ist (Stromausfall waehrend der Sicherung).
date --iso-8601=seconds > "$ZIEL/VOLLSTAENDIG"

# ── 6. Staffelung ────────────────────────────────────────────────────────────
#
# Wochen- und Monatsstand sind harte Links auf den Tagesstand: derselbe
# Datenblock, nur ein zweiter Verzeichniseintrag. Erst wenn der Tagesstand
# wegrotiert, kostet der Wochenstand ueberhaupt Platz.
verlinken() {
  local kategorie="$1" name="$2"
  local ordner="$BACKUP_DIR/$kategorie/$name"
  [ -e "$ordner" ] && return 0
  mkdir -p "$ordner"
  cp -al "$ZIEL"/. "$ordner"/ 2>/dev/null || cp -a "$ZIEL"/. "$ordner"/
  log "$kategorie: $name angelegt"
}

# Montag = Wochenstand, Monatserster = Monatsstand.
[ "$(date +%u)" = "1" ] && verlinken woechentlich "$(date +%G-W%V)"
[ "$(date +%d)" = "01" ] && verlinken monatlich "$(date +%Y-%m)"

# Nur VOLLSTAENDIGE Staende zaehlen fuer die Aufbewahrung.
#
# Sonst belegt jeder fehlgeschlagene Lauf einen der Plaetze: bei sieben
# Tagesstaenden und einer Woche Fehlschlaegen waeren alle sieben Plaetze mit
# unbrauchbaren Staenden gefuellt — und der letzte gute waere weggerotiert.
# Genau dann, wenn man ihn braucht.
aufraeumen() {
  local kategorie="$1" behalten="$2"
  local ordner="$BACKUP_DIR/$kategorie"
  [ -d "$ordner" ] || return 0

  local vollstaendige
  # `if` statt `[ … ] && echo`: die while-Schleife endet sonst mit dem Status
  # ihres letzten Durchlaufs. Sortiert ein Ordner OHNE Marke als letzter —
  # ein `.UNVOLLSTAENDIG` tut genau das —, endete die Schleife mit 1, und
  # pipefail + set -e toeteten die Sicherung NACH getaner Arbeit, mitten im
  # Aufraeumen. Seit der Abbruch-Aufraeumer solche Ordner zuverlaessig anlegt,
  # waere das kein Randfall mehr gewesen, sondern der zweite Lauf nach jedem
  # Fehlschlag.
  vollstaendige=$(find "$ordner" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
                  | while read -r d; do if [ -f "$d/VOLLSTAENDIG" ]; then echo "$d"; fi; done | sort)
  local anzahl
  anzahl=$(echo "$vollstaendige" | grep -c . || true)
  if [ "$anzahl" -gt "$behalten" ]; then
    echo "$vollstaendige" | head -n -"$behalten" | while read -r alt; do
      [ -n "$alt" ] || continue
      rm -rf "$alt"
      log "$kategorie: $(basename "$alt") entfernt"
    done
  fi
}

# Fehlgeschlagene Staende getrennt aufraeumen: die zwei juengsten bleiben zur
# Fehlersuche liegen, aeltere fliegen — sonst fuellen sie ueber Monate die
# Platte, ohne je zu nuetzen.
aufraeumen_unvollstaendige() {
  local ordner="$BACKUP_DIR/$1"
  [ -d "$ordner" ] || return 0
  find "$ordner" -mindepth 1 -maxdepth 1 -type d -name '*.UNVOLLSTAENDIG' 2>/dev/null \
    | sort | head -n -2 | while read -r alt; do
        [ -n "$alt" ] || continue
        rm -rf "$alt"
        log "$1: unbrauchbaren Stand $(basename "$alt") entfernt"
      done
}

# Ordner, die WEDER eine Marke tragen NOCH die Endung .UNVOLLSTAENDIG haben.
#
# Der EXIT-trap oben faengt Ctrl-C, SIGTERM und jeden Skript-Abbruch — aber
# NICHT den Stromausfall und nicht SIGKILL (der OOM-Killer um drei Uhr nachts).
# In diesen Faellen bleibt das Zielverzeichnis markenlos liegen und faellt
# durch beide Rotationsregeln: `aufraeumen` sieht nur VOLLSTAENDIG,
# `aufraeumen_unvollstaendige` nur die Endung. Ein solcher Ordner traegt einen
# halben Dump von mehreren hundert Megabyte und verschwindet nie wieder.
#
# Deshalb raeumt JEDER Lauf die Reste seiner Vorgaenger nach: markenlos =
# abgebrochen. Das eigene Ziel ist zu diesem Zeitpunkt bereits als
# VOLLSTAENDIG markiert und deshalb nicht betroffen.
#
# `-mmin +120` ist dabei kein Feinschliff: Ohne diese Grenze wuerde der Lauf
# das Zielverzeichnis eines GLEICHZEITIG laufenden zweiten Sicherungslaufs
# umbenennen — dessen Marke steht ja erst am Ende. Zwei Laeufe zur selben Zeit
# sind moeglich: der systemd-Timer, ein `patio sicherung` von Hand und das
# erzwungene Backup vor einem Update sind drei unabhaengige Ausloeser, und es
# gibt keine Sperre zwischen ihnen. Zwei Stunden liegen weit ueber jeder
# realistischen Laufzeit und weit unter dem Tagesabstand.
aufraeumen_markenlose() {
  local ordner="$BACKUP_DIR/$1"
  [ -d "$ordner" ] || return 0
  find "$ordner" -mindepth 1 -maxdepth 1 -type d ! -name '*.UNVOLLSTAENDIG' -mmin +120 2>/dev/null     | while read -r d; do
        if [ ! -f "$d/VOLLSTAENDIG" ]; then
          mv "$d" "${d}.UNVOLLSTAENDIG" 2>/dev/null || true
          log "Rest eines abgebrochenen Laufs gefunden und als $(basename "$d").UNVOLLSTAENDIG abgelegt."
        fi
      done
}
aufraeumen_markenlose taeglich
aufraeumen_markenlose woechentlich
aufraeumen_markenlose monatlich

aufraeumen taeglich "$KEEP_DAILY"
aufraeumen woechentlich "$KEEP_WEEKLY"
aufraeumen monatlich "$KEEP_MONTHLY"
# Auf allen drei Stufen: seit `aufraeumen_markenlose` koennen abgebrochene
# Wochen- und Monatsstaende (`verlinken` bricht mittendrin ab) ebenfalls die
# Endung tragen. Liefe die Rotation nur auf `taeglich`, blieben sie fuer immer
# liegen — und die Abschlusszeile meldete sie fuer immer als „unbrauchbar".
aufraeumen_unvollstaendige taeglich
aufraeumen_unvollstaendige woechentlich
aufraeumen_unvollstaendige monatlich

GROESSE=$(du -sh "$ZIEL" | cut -f1)
log "Sicherung abgeschlossen: $ZIEL ($GROESSE)"
# Nur vollstaendige Staende melden — eine Zahl, die kaputte mitzaehlt, waere
# eine Erfolgsmeldung ueber etwas, das im Ernstfall nicht traegt.
zaehle_vollstaendige() {
  # `if` statt AND-Liste — gleiche Begruendung wie in aufraeumen().
  find "$BACKUP_DIR/$1" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
    | while read -r d; do if [ -f "$d/VOLLSTAENDIG" ]; then echo x; fi; done | wc -l
}
log "Bestand (nur vollstaendige): $(zaehle_vollstaendige taeglich) taeglich, $(zaehle_vollstaendige woechentlich) woechentlich, $(zaehle_vollstaendige monatlich) monatlich"

UNBRAUCHBAR=$(find "$BACKUP_DIR" -maxdepth 2 -type d -name '*.UNVOLLSTAENDIG' 2>/dev/null | wc -l)
if [ "$UNBRAUCHBAR" -gt 0 ]; then
  log "HINWEIS: $UNBRAUCHBAR unbrauchbare(r) Stand/Staende liegen zur Fehlersuche bereit."
fi

# ── Die Fehlermarke des letzten Fehlschlags zuruecknehmen ────────────────────
#
# `patio-backup-fehler@.service` schreibt bei einem Fehlschlag
# logs/SICHERUNG-FEHLGESCHLAGEN, und `patio status` zeigt den Inhalt an.
# Geloescht hat sie bisher NIEMAND — im ganzen Repo gab es keinen einzigen
# `rm` darauf. Das rote Kreuz stand damit dauerhaft, auch nach zehn geglueckten
# Naechten, und war nach kurzer Zeit nur noch Hintergrundrauschen.
rm -f "$INSTALL_DIR/logs/SICHERUNG-FEHLGESCHLAGEN"

# ── Warum hier ein ausdrueckliches `exit 0` steht ────────────────────────────
#
# Frueher endete das Skript mit `[ "$UNBRAUCHBAR" -gt 0 ] && log "..."`. Ist die
# Zahl 0 — also im NORMALFALL —, ist der Status dieser Zeile 1, und weil es die
# letzte war, war das der Exit-Code des Skripts. Nachgemessen: EXIT=1.
#
# Die Folgen waren erheblich und zeigten in die falsche Richtung:
#   * `patio-backup.service` loeste nach JEDER erfolgreichen Nacht seinen
#     OnFailure-Dienst aus — Wall-Nachricht, Fehler-Log, Fehlermarke.
#   * `update-offline.sh` bricht ab, wenn die Sicherung fehlschlaegt. Der
#     Server waere damit nicht mehr aktualisierbar gewesen.
#
# Die Bedingung steht jetzt in einem vollstaendigen `if`, und der Erfolgsfall
# wird ausdruecklich gemeldet statt sich aus der letzten Zeile zu ergeben.
exit 0
