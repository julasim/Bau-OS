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
             (rund 170 MB)                     ├─ Prüfsumme kontrollieren
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
Testsuite still 156 von 267 Prüfungen — genau die ACL-, Auth- und DB-Tests —
und meldet trotzdem grün. Ein Auslieferungspaket auf dieser Grundlage wäre
fahrlässig.

Ergebnis in `release/`:

| Datei | Inhalt |
|---|---|
| `patio-<version>.tar.gz` | Image, Compose-Datei, `docker/`, `deploy/`, Skripte |
| `patio-<version>.tar.gz.sha256` | Prüfsumme |

Im Paket liegt eine `PAKET.txt` mit Version, Baudatum, Rechnername und
Git-Stand — **einschließlich eines Vermerks, wenn beim Bauen uncommittete
Änderungen im Baum lagen.**

## Auf dem Server

```bash
# Paket nach /opt/patio kopieren, dann:
sudo patio update patio-0.2.0.tar.gz
```

Der Ablauf:

1. **Prüfsumme** — ein auf dem Weg beschädigtes Paket fällt hier auf.
2. **Zielverzeichnis prüfen** — vor dem ersten Handgriff, damit kein halb
   aktualisierter Rechner zurückbleibt.
3. **Sicherung auslösen.** Schlägt sie fehl, bricht das Update ab.
4. `docker load`, Konfiguration und Skripte ersetzen, Stack neu starten.
5. **Gesundheitsprüfung** gegen `/api/health`. Antwortet der Dienst nicht,
   setzt das Skript auf das vorige Image zurück.

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
patio status              # Zustand aller Dienste
patio logs 100            # letzte Protokollzeilen
docker images patio-app   # welche Stände liegen noch da?
```

Der Rückweg von Hand, falls die automatische Rücksetzung nicht greift:

```bash
docker tag patio-app:<alte-version> patio-app:latest
cd /opt/patio && docker compose up -d app
```

## Was das Update nicht anfasst

`.env` bleibt unberührt — dort stehen die Geheimnisse dieser Installation.
Kommen neue Schlüssel dazu, stehen sie in der mitgelieferten `.env.example`
und müssen von Hand übernommen werden.

## Arbeitsplätze

Die Oberfläche steckt im selben Image wie der Dienst (`serveStatic` aus
`dist/web`) — Server und Browser können also nicht auseinanderlaufen. An den
Arbeitsplätzen ist nach einem Update nichts zu tun außer einem Neuladen der
Seite.

## Nächster Schritt

→ [Sicherung](/betrieb/sicherung)
