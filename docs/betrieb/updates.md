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
Testsuite still **599 von 852** Prüfungen — genau die ACL-, Auth- und DB-Tests
— und meldet trotzdem grün (gemessen am 02.09.2026: `253 passed | 599
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
laufenden Container — es wird von `backup.sh` gebraucht, um den privaten
Schlüssel der internen CA zu sichern, und von `restore.sh`, um ihn
zurückzuspielen. Fehlte es, scheiterte die nächtliche
Sicherung **ohne jede Meldung**, und jedes Update brach danach mit „Die
Sicherung ist fehlgeschlagen" ab, ohne dass die Ursache irgendwo stand.

Das Paket wächst dadurch um rund 180 MB (gemessen: `basis-images.tar.gz` = 179 MB, Gesamtpaket 497 MB statt 318 MB). Ein Paket älterer Fassung ohne die
Datei lässt sich weiterhin einspielen; `update-offline.sh` sagt dann, dass es
das nimmt, was auf dem Rechner liegt.
:::

::: warning Eine Version, ein Paket
Ohne Argument nimmt das Skript die Version aus `package.json`; dort steht
heute `1.1.0`. Bis zum 28.08.2026 stand seit dem ersten Commit `0.1.0` darin:
jedes Paket hiess damit gleich und überschrieb das vorige stillschweigend. Genau dieses vorige Paket ist aber der
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

::: tip Der Rückweg holt seit dem 30.08.2026 mehr zurück als das Image
Vorher setzte er ausschließlich `patio-app:latest` auf das vorige Image
zurück — Compose-Datei, `docker/` und `deploy/` waren zu diesem Zeitpunkt aber
längst ersetzt. Setzt die neue Compose-Datei etwas voraus, das die alte Fassung
nicht mitbringt (eine neue Pflichtangabe in der `.env`, ein neuer Mount),
scheitert auch das zurückgesetzte Image — und übrig bleibt genau der halb
aktualisierte Rechner, den die Vorprüfung verhindern soll.

Das Update legt den vorigen Stand deshalb vorher unter `/opt/patio/.vorher`
beiseite und spielt ihn beim Rücksetzen mit zurück.

**Wird ein Update hart abgebrochen** (Strg+C in der Warteschleife,
Stromausfall), bleibt eine Marke `/opt/patio/.update-laeuft` liegen. Ein
zweiter Anlauf erkennt sie und lässt `.vorher` **unangetastet** — sonst würde
er den halb aktualisierten Stand als „vorher" ablegen und beim nächsten
Fehlschlag genau diesen zurückspielen, mit Erfolgsmeldung. Aus demselben Grund
liegt die Kennung des vorigen Images in `.vorher/IMAGE_ID`: Nach einem
`docker load` zeigt `patio-app:latest` bereits auf das neue.

**Eine Ausnahme mit Absicht: `scripts/` wird nicht automatisch zurückgespielt**
— `update-offline.sh` läuft selbst aus diesem Verzeichnis, und eine Datei, die
unter der laufenden Shell ausgetauscht wird, führt Bruchstücke aus. Die
vorigen Skripte liegen unter `/opt/patio/.vorher/scripts` und lassen sich nach
dem Lauf von Hand zurückholen.
:::

::: warning Der Proxy zählt bei der Gesundheitsprüfung mit
Seit dem 31.08.2026 wird der Caddyfile beim Update **sofort** wirksam (vorher
hielt der laufende Container die alte Datei fest). Damit kann ein fehlerhafter
Caddyfile im Paket den einzigen Zugangsweg der Arbeitsplätze lahmlegen — und
die Gesundheitsprüfung würde es nicht merken: Sie fragt die Anwendung
containerintern, also **am Proxy vorbei**.

Das Update prüft deshalb nach dem Neuerzeugen, ob der Proxy noch läuft oder in
der Neustartschleife kreiselt. Kreiselt er, während die Anwendung einwandfrei
antwortet, wird **nur** die Proxy-Konfiguration zurückgenommen: `docker/` kommt
aus `.vorher` zurück, der Proxy wird damit neu erzeugt. Das Programm-Abbild
bleibt auf dem neuen Stand — seine Migrationen sind bereits angewendet und
laufen nur vorwärts. Das Update endet trotzdem mit einer Fehlermeldung, die auf
den fehlerhaften `docker/Caddyfile` aus dem Paket verweist. Kommt der Proxy auch
mit der vorigen Konfiguration nicht hoch, greift der vollständige Rückweg.
:::

::: tip Geänderte systemd-Einheiten kommen jetzt mit
Bis zum 30.08.2026 wurden die Einheiten der Sicherung **nur bei der
Erstinstallation** nach `/etc/systemd/system` gelegt. Ein Update ersetzte
`deploy/` im Installationsverzeichnis, die installierte Einheit blieb aber die
alte — und niemand merkte es, weil sie weiterlief. Heute vergleicht das Update
sie und spielt Unterschiede ein (mit `daemon-reload`, ohne den Timer-Zustand
anzufassen).
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

## Wenn ein Update das Datenbankschema ändert

Die meisten Updates tauschen nur Programm und Konfiguration aus. Bei einem
solchen Update ist der Rückweg einfach: das vorige Paket noch einmal
einspielen, fertig.

::: danger Ein Schema-Update ist nicht durch ein Downgrade zurückzunehmen
Migrationen laufen in eine Richtung. Sobald eine davon eine Spalte umbaut,
passt das vorige Programm nicht mehr zum Schema — es startet zwar, aber jeder
Zugriff auf die geänderte Stelle scheitert.

**Der Rückweg ist dann `patio restore` mit der Sicherung von VOR dem Update**,
nicht das alte Paket. Deshalb erzwingt `patio update` vorher eine Sicherung,
und deshalb gehört ein Schema-Update auf einen Zeitpunkt, an dem jemand
danach hinsehen kann — nicht auf Freitagabend.
:::

### Version 1.1.0: `termine.datum` wird ein echtes Datum

Migration `060` hebt die Terminspalte von Text auf `date`. Ohne sie zeigte das
Board im Besprechungsraum **keinen von Hand angelegten Termin an** — es
verglich ein ISO-Datum gegen `TT.MM.JJJJ`, und das trifft nie zu. Nur die
automatischen Meilensteine der Leistungsphasen erschienen: sie stehen seit
jeher in ISO in derselben Spalte.

**Vorher nachsehen, ob unlesbare Datumsangaben im Bestand stehen.** Sie können
nur aus einer alten Datenübernahme stammen; die Oberfläche lässt sie nicht zu:

```bash
cd /opt/patio && sudo docker compose exec postgres psql -U patio -d patio -c "SELECT id, datum, left(text, 60) FROM termine WHERE datum::text !~ '^[0-9]{2}[.][0-9]{2}[.][0-9]{4}$' AND datum::text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';"
```

Kommt dabei etwas heraus: **diese Termine landen beim Update im Papierkorb**,
mit ihrem ursprünglichen Wert im Text (`[Datum unlesbar bei Migration 060: …]`).
Nichts geht verloren, aber wer sie im Kalender behalten will, korrigiert das
Datum vorher in der Oberfläche.

**Eine leere Trefferliste ist allerdings keine Garantie.** Die Abfrage findet
nur falsche Schreibweisen. In den Papierkorb wandert auch, was richtig
geschrieben ist, es als Datum aber nicht gibt — etwa `31.02.2026`. Die
Migration nennt jede betroffene Zeile mit ihrer Kennung im Startprotokoll:
`060: diese Termine wandern in den Papierkorb (Datum unlesbar): …`.

Das `::text` in der Abfrage ist Absicht: So läuft sie auch NACH dem
Update noch und liefert dann keine Zeile — ohne das Cast antwortet
Postgres danach mit `operator does not exist: date !~ unknown`, was wie
ein Fehler aussieht und keiner ist.

Was die Migration getan hat, steht nach dem Update im Protokoll:

```bash
sudo docker logs patio-app 2>&1 | grep "060:"
```

Erwartet wird eine Zeile wie `060: 2201 Termine deutsch, 1 in ISO, 0 unlesbar.`
und darunter `060: termine.datum ist jetzt date.`

## Arbeitsplätze

Die Oberfläche steckt im selben Image wie der Dienst (`serveStatic` aus
`dist/web`) — Server und Browser können also nicht auseinanderlaufen. An den
Arbeitsplätzen ist nach einem Update nichts zu tun außer einem Neuladen der
Seite.

## Nächster Schritt

→ [Sicherung](/betrieb/sicherung)
