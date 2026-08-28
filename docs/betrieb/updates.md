# Updates

Auf dem Firmenserver wird **nie gebaut**. Er hat kein Internet, also gibt es
weder `git pull` noch `npm install` noch `docker compose pull`. Stattdessen
entsteht auf dem Entwicklungsrechner **eine Datei**, die per USB-Stick auf den
Server wandert.

```
Entwicklungsrechner                        Firmenserver
───────────────────                        ────────────
scripts/release-offline.sh
  ├─ volle Prüfkette
  ├─ docker build
  └─ docker save + Prüfsumme
        │
        └──▶ patio-<version>.tar.gz ──USB──▶ scripts/update-offline.sh
             (rund 500 MB)                     ├─ Prüfsumme kontrollieren
                                               ├─ Sicherung auslösen
                                               ├─ docker load
                                               ├─ Stack neu starten
                                               └─ Gesundheit prüfen
```

## Auf dem Entwicklungsrechner

```bash
cd apps/patio
DATABASE_URL="postgres://patio:patio@<WSL-IP>:5432/patio" \
  bash scripts/release-offline.sh
```

Das Skript **besteht auf `DATABASE_URL`**. Ohne Datenbank überspringt die
Testsuite still **527 von 733** Prüfungen — genau die ACL-, Auth- und DB-Tests
— und meldet trotzdem grün (gemessen am 25.08.2026: `206 passed | 527
skipped`). Ein Auslieferungspaket auf dieser Grundlage wäre fahrlässig.

Ergebnis in `release/`:

| Datei | Inhalt |
|---|---|
| `patio-<version>.tar.gz` | PATIO-Image, **Basis-Images**, Compose-Datei, `docker/`, `deploy/`, Skripte |
| `patio-<version>.tar.gz.sha256` | Prüfsumme |

Von Hand prüfen lässt sie sich nach dem Transport im selben Verzeichnis:

```bash
cd /opt/patio && sha256sum -c patio-<version>.tar.gz.sha256
```

::: tip Warum dort der reine Dateiname steht
Die Datei entstand früher mit `sha256sum release/patio-1.0.0.tar.gz` und trug
damit den **Pfad vom Baurechner**. Auf dem Server gibt es kein `release/` —
die Handprobe meldete „FAILED open or read", und das liest sich wie ein
beschädigtes Paket. `patio update` fiel nie darauf herein (es vergleicht nur
den Hash), aber die Handprobe ist der naheliegende erste Griff nach dem
USB-Stick.
:::

::: tip Die Basis-Images liegen seit dem 25.08.2026 mit im Paket
`postgres:16`, `caddy:2-alpine` und `alpine:latest`. Vorher enthielt das Paket
nur PATIO selbst — auf einem Rechner ohne Internet scheiterte damit jede
**Erstinstallation**, weil `docker compose up -d` die fehlenden Images ziehen
wollte.

Auf einer bestehenden Installation fiel es nicht auf: Postgres und Caddy laufen
ja und sind dadurch vorhanden. `alpine:latest` hängt dagegen an keinem
laufenden Container — es wird nur von `backup.sh` gebraucht, um den privaten
Schlüssel der internen CA zu sichern. Fehlte es, scheiterte die nächtliche
Sicherung **ohne jede Meldung**, und jedes Update brach danach mit „Die
Sicherung ist fehlgeschlagen" ab, ohne dass die Ursache irgendwo stand.

Das Paket wächst dadurch um rund 180 MB (gemessen: `basis-images.tar.gz` = 179 MB, Gesamtpaket 497 MB statt 318 MB). Ein Paket älterer Fassung ohne die
Datei lässt sich weiterhin einspielen; `update-offline.sh` sagt dann, dass es
das nimmt, was auf dem Rechner liegt.
:::

::: warning Eine Version, ein Paket
Ohne Argument nimmt das Skript die Version aus `package.json` — und die steht
seit dem ersten Commit auf `0.1.0`. Jedes Paket hiess damit gleich und
überschrieb das vorige stillschweigend. Genau dieses vorige Paket ist aber der
Rückweg, wenn ein Update auf dem Server nicht trägt.

Seit dem 25.08.2026 bricht der Bau ab, wenn die Datei schon existiert. Also
eine eigene Version vergeben:

```bash
DATABASE_URL="…" bash scripts/release-offline.sh 0.2.0
```

Bewusst überschreiben geht mit `UEBERSCHREIBEN=true`.
:::

::: warning Die Paketgröße hängt an der PDF-Ausgabe
Das Server-Abbild enthält LibreOffice, damit PATIO Word-Exporte in PDF
umwandeln kann — rund **350 MB**, die jedes Offline-Update auf dem
Datenträger mitträgt.

Wer darauf verzichten kann, baut ohne:

```bash
DATABASE_URL="…" MIT_PDF=nein bash scripts/release-offline.sh 0.2.0
```

Dann erscheint der PDF-Knopf gar nicht erst; der Word-Export bleibt
vollständig. Einzelheiten: [Export und Volldump](/konzepte/export).

Hier stand bis zum 25.08.2026 `docker compose build --build-arg MIT_PDF=nein
app`. Das half nicht: `release-offline.sh` baute danach mit einem eigenen
`docker build` **ohne** diesen Wert neu, und die 350 MB waren wieder drin. Das
Skript reicht `MIT_PDF` jetzt durch.
:::

Im Paket liegt eine `PAKET.txt` mit Version, Baudatum, Rechnername und
Git-Stand — **einschließlich eines Vermerks, wenn beim Bauen uncommittete
Änderungen im Baum lagen.**

## Auf dem Server

```bash
# Paket nach /opt/patio kopieren, dann DORT aufrufen:
cd /opt/patio
sudo patio update patio-0.2.0.tar.gz
```

Das `cd` ist nicht schmückendes Beiwerk: Der Pfad wird relativ zum aktuellen
Verzeichnis gesucht. Aus dem Heimatverzeichnis aufgerufen meldet das Skript
„Paket nicht gefunden".

Der Ablauf:

1. **Prüfsumme** — ein auf dem Weg beschädigtes Paket fällt hier auf.
   **Fehlt die `.sha256`-Datei, bricht das Skript ab.** Sie entsteht beim
   Bauen automatisch und gehört mit auf den Stick; bewusst ohne Kontrolle
   einspielen geht mit `OHNE_PRUEFSUMME=true`.
2. **Zielverzeichnis prüfen** — vor dem ersten Handgriff, damit kein halb
   aktualisierter Rechner zurückbleibt.
3. **Sicherung auslösen.** Schlägt sie fehl, bricht das Update ab.
4. `docker load`, Konfiguration und Skripte ersetzen, Stack neu starten.
5. **Gesundheitsprüfung** gegen `/api/health`. Antwortet der Dienst nicht,
   setzt das Skript auf das vorige Image zurück.
6. **Stand vermerken** — erst nach bestandener Gesundheitsprüfung, in
   `/opt/patio/VERSION`. Beim Rückweg wird der vorige Eintrag
   wiederhergestellt.

::: danger Migrationen laufen nur vorwärts
Der Rückweg auf das alte Image holt das **Schema nicht** zurück. Ein Update,
das migriert hat, ist damit praktisch einbahnig — die erzwungene Sicherung
davor ist der einzige echte Rückweg.

Kommt die alte Fassung mit dem neuen Schema nicht zurecht:

```bash
sudo bash /opt/patio/scripts/restore.sh
```
:::

## Wenn etwas schiefgeht

```bash
patio status              # Zustand aller Dienste — zeigt auch den Stand
patio logs 100            # letzte Protokollzeilen
docker images patio-app   # welche Stände liegen noch da?
```

::: tip Welcher Stand läuft hier gerade?
Die erste Bildschirmseite von `patio status` beantwortet das seit dem
28.08.2026. Vorher war es **auf dem Server nicht feststellbar**: die API kennt
keine Version, die Oberfläche zeigt keine, und `docker-compose.yml` zeigt auf
`patio-app:latest` — diese Marke sieht vor und nach einem Rückweg gleich aus.

Wer wissen wollte, ob ein Update angekommen ist, hatte keine Antwort. Nach
einem halb durchgelaufenen Update, also genau dann, wenn man sie braucht, erst
recht nicht.

Steht dort `unbekannt`, wurde zuletzt vor diesem Datum eingespielt.
:::

Der Rückweg von Hand, falls die automatische Rücksetzung nicht greift:

```bash
docker tag patio-app:<alte-version> patio-app:latest
cd /opt/patio && docker compose up -d app
```

## Was das Update anfasst — und was nicht

`.env` bleibt unberührt — dort stehen die Geheimnisse dieser Installation.
Kommen neue Schlüssel dazu, stehen sie in der mitgelieferten `.env.example`
und müssen von Hand übernommen werden. `logs/`, `data/` und der
Dokumentenordner bleiben ebenfalls, wie sie sind.

`docker/` und `deploy/` dagegen werden **vollständig ersetzt**, nicht
ergänzt. Beide kommen restlos aus dem Paket und tragen nichts, was auf dem
Server entsteht.

::: info Warum das Ersetzen wichtig ist
Vorher legte `cp -r` nur obendrauf. Was eine neue Fassung nicht mehr
mitlieferte, blieb liegen — auf unbestimmte Zeit, weil dort nie jemand
aufräumt. So standen auf dem Server zuletzt `docker/docker-compose.vps.yml`
(die abgelöste VPS-Fassung) und eine zweite `.env.example` aus derselben Zeit.

Wer im Störfall nachsieht, welche Compose-Datei gilt, findet die falsche
zuerst: sie liegt im Unterordner und sieht dadurch spezifischer aus. Beide
liefert das Paket seit dem 28.08.2026 nicht mehr mit — und dank des Ersetzens
verschwinden sie beim nächsten Update auch von bestehenden Installationen.
:::

## Arbeitsplätze

Die Oberfläche steckt im selben Image wie der Dienst (`serveStatic` aus
`dist/web`) — Server und Browser können also nicht auseinanderlaufen. An den
Arbeitsplätzen ist nach einem Update nichts zu tun außer einem Neuladen der
Seite.

## Nächster Schritt

→ [Sicherung](/betrieb/sicherung)
