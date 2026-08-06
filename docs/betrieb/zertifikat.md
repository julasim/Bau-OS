# Zertifikat und Rechnername

PATIO läuft im Büronetz über **HTTPS**. Das Zertifikat kommt von einer
**eigenen Zertifizierungsstelle auf dem Server** — nichts davon verlässt das
Haus.

## Warum nicht Let's Encrypt

Drei Gründe, jeder für sich ausreichend:

1. **Der Server ist aus dem Internet nicht erreichbar** und soll es nicht sein.
   Let's Encrypt muss ihn aber erreichen können, um die Domain zu prüfen.
2. **Jedes öffentlich ausgestellte Zertifikat landet im
   Certificate-Transparency-Log** — einem weltweit einsehbaren Verzeichnis.
   Der interne Rechnername wäre damit für jeden nachlesbar.
3. **Die Erneuerung braucht alle 90 Tage Internet.** Fällt sie aus, steht
   irgendwann das ganze Büro — an einem beliebigen Dienstagmorgen.

Caddy betreibt stattdessen eine kleine Zertifizierungsstelle auf dem Server
(`local_certs` + `tls internal` in `docker/Caddyfile`) und erneuert
selbständig. Die Blattzertifikate sind absichtlich kurzlebig (Stunden), das
Wurzelzertifikat gilt **zehn Jahre**.

::: warning Die Uhr muss stimmen
Ohne Internet gibt es kein NTP nach draußen. Läuft die Systemuhr über Monate
weg, werden die Zertifikate ungültig — und niemand kommt mehr hinein. Als
Zeitquelle den Router eintragen, siehe [Server aufsetzen](/betrieb/server).
:::

## Drei Schritte, sonst warnt jeder Arbeitsplatz

Und an Warnungen gewöhnen sich Leute — das ist schlimmer als gar keine.

### 1. Rechnername festlegen

In der `.env`:

```bash
PATIO_HOSTNAME=patio.sima.intern
```

::: tip Keine `.local`-Endung
Die ist für mDNS reserviert und macht unter Windows Ärger. `.intern`,
`.lan` oder eine Unterdomäne der eigenen Domain funktionieren problemlos.
:::

### 2. Namen auflösbar machen

Die Arbeitsplätze müssen `patio.sima.intern` finden. Zwei Wege:

**Router-DNS** (empfohlen, einmalig für alle):
Im Router einen Eintrag `patio.sima.intern → <Server-IP>` anlegen. Die genaue
Stelle heißt je nach Gerät „Statische DNS-Einträge", „Local DNS" oder
„Host-Einträge".

**hosts-Datei** (Notlösung, je Arbeitsplatz):
`C:\Windows\System32\drivers\etc\hosts` als Administrator öffnen und
ergänzen:

```
192.168.1.50    patio.sima.intern
```

Prüfen: `ping patio.sima.intern` muss die Server-IP zeigen.

### 3. Wurzelzertifikat auf die Arbeitsplätze

Vom Server holen:

```bash
docker cp patio-caddy:/data/caddy/pki/authorities/local/root.crt \
          /opt/patio-workspace/PATIO-Zertifikat.crt
```

Die Datei liegt damit in der Netzfreigabe und ist von jedem Arbeitsplatz aus
erreichbar.

**Auf jedem Windows-Arbeitsplatz** (als Administrator):

```powershell
Import-Certificate -FilePath "\\patio.sima.intern\Dokumente\PATIO-Zertifikat.crt" `
                   -CertStoreLocation Cert:\LocalMachine\Root
```

Oder von Hand: Doppelklick → „Zertifikat installieren" → „Lokaler Computer" →
„Alle Zertifikate in folgendem Speicher speichern" → **„Vertrauenswürdige
Stammzertifizierungsstellen"**.

::: danger Firefox hat einen eigenen Zertifikatspeicher
Wer Firefox nutzt, muss dort getrennt importieren:
`Einstellungen → Datenschutz & Sicherheit → Zertifikate anzeigen →
Zertifizierungsstellen → Importieren`, und dabei **„Dieser CA vertrauen, um
Websites zu identifizieren"** ankreuzen.

Chrome, Edge und der Explorer nutzen den Windows-Speicher und sind mit
Schritt 3 erledigt.
:::

### Gilt das auch für das Arbeitsplatz-Programm?

`PATIO.exe` baut auf Electron und damit auf Chromium. Für **lokal
installierte** Wurzelzertifikate greift dort derselbe Windows-Speicher — der
eigene Chrome-Root-Store betrifft nur öffentliche Wurzeln. Schritt 3 sollte
also für Programm und Browser gemeinsam gelten.

::: warning Begründet, aber nicht nachgemessen
Das Programm gibt es noch nicht. Der praktische Test steht als **erste
Aufgabe** in dessen Arbeitspaket — vor allem anderen und bevor acht
Arbeitsplätze eingerichtet werden.

Ein Detail, das dabei mitgeprüft gehört: eine Erreichbarkeitsprüfung mit
Node-Bordmitteln (`fetch`, `https`) **scheitert** an diesem Zertifikat, weil
Node seinen eigenen CA-Vorrat mitbringt und den Windows-Speicher nicht kennt —
während das Fenster daneben problemlos lädt.
:::

Bei einer Domäne mit Active Directory geht das zentral per Gruppenrichtlinie:
`Computerkonfiguration → Windows-Einstellungen → Sicherheitseinstellungen →
Richtlinien für öffentliche Schlüssel → Vertrauenswürdige
Stammzertifizierungsstellen`.

## Prüfen

Am Arbeitsplatz `https://patio.sima.intern/` öffnen. Es muss ein **Schloss
ohne Warnung** erscheinen.

Auf dem Server:

```bash
# Wird ein Zertifikat ausgestellt?
docker logs patio-caddy 2>&1 | grep -i "certificate obtained"

# Prüfung durch die ganze Kette
docker cp patio-caddy:/data/caddy/pki/authorities/local/root.crt /tmp/ca.crt
curl --cacert /tmp/ca.crt https://patio.sima.intern/api/health
```

Ohne `--cacert` **muss** curl die Verbindung ablehnen — das ist der Beweis,
dass hier kein öffentliches Zertifikat im Spiel ist.

## Der teuerste Fehler

::: danger Der private Schlüssel der CA liegt im Volume `caddy_data`
Geht er verloren, erzeugt Caddy beim Neuaufbau eine **neue**
Zertifizierungsstelle. Dann zeigt jeder Arbeitsplatz wieder eine Warnung,
bis jemand an **jedem einzelnen** das neue Wurzelzertifikat einspielt.

`scripts/backup.sh` sichert das Volume deshalb mit, und
`scripts/restore.sh` spielt es zurück. Prüfen, dass es wirklich drin ist:

```bash
tar -tzf /mnt/patio-backup/taeglich/*/caddy-daten.tar.gz | grep root.key
```
:::

## Wenn eine Warnung auftaucht

| Meldung | Ursache |
|---|---|
| „Der Server ist nicht erreichbar" | Namensauflösung fehlt — Schritt 2 |
| „Diesem Zertifikat wird nicht vertraut" | Wurzelzertifikat fehlt — Schritt 3 |
| Nur in Firefox eine Warnung | eigener Zertifikatspeicher — Schritt 3 |
| Warnung nach einem Wiederaufbau | CA-Schlüssel war nicht in der Sicherung |
| „Zertifikat ist abgelaufen" | Systemuhr des Servers weggelaufen |

## Nächster Schritt

→ [Netzfreigabe](/betrieb/freigabe)
