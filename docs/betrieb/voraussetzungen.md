# Voraussetzungen und Kaufliste

Was beschafft sein muss, bevor PATIO im Büro aufgesetzt wird.

::: danger Der Server ist ab jetzt der einzige Ausfallpunkt
Vor dem Umbau konnte man bei einer Störung im Explorer weiterarbeiten. Das ist
vorbei. **Vier Dinge gehören von Tag eins dazu und dürfen nicht nachgereicht
werden** — sie stehen unten in der Kaufliste:

nächtliche Sicherung auf eine externe Platte · eine **geprobte**
Rücksicherung mit Zeitmessung · ein zweites identisches Gerät im Schrank ·
eine USV.
:::

## Der Rechner

Ein gebrauchter Business-Kleinrechner genügt. PATIO ist ein Node-Prozess
neben einer PostgreSQL-Datenbank — es läuft **kein Sprachmodell**, keine
Bildverarbeitung, nichts Rechenintensives.

| | Minimum | Empfohlen |
|---|---|---|
| **CPU** | 2 Kerne | 4 Kerne |
| **Arbeitsspeicher** | 8 GB | **16 GB** |
| **Datenträger** | 256 GB SSD | **500 GB NVMe** |
| **Netzwerk** | — | **Kabel**, kein WLAN |
| **Betriebssystem** | Ubuntu Server 24.04 LTS | |

Bewährte Geräte, gebraucht für 150–300 €:

- **Dell OptiPlex Micro** (7050 / 7080 / 7090)
- **HP EliteDesk 800 Mini** (G4 / G5 / G6)
- **Lenovo ThinkCentre Tiny** (M720q / M920q)

Neu als Alternative: ein Mini-PC mit **Intel N100 oder N150**, 16 GB, ab
etwa 200 €.

::: warning Von Einplatinenrechnern wird abgeraten
Ein Raspberry Pi wirkt verlockend, aber: SD-Karten sterben unter
Datenbanklast, der Arbeitsspeicher ist knapp, und es gibt keinen Weg, das
Gerät im Fehlerfall schnell durch ein baugleiches zu ersetzen.
:::

Die 16 GB sind kein Luxus — die Compose-Datei stellt Postgres auf
`shared_buffers=2GB` ein, was auf 8 GB ebenfalls läuft, aber weniger Luft für
das Zwischenspeichern von Dateien lässt.

## Kaufliste

| Was | Warum | Grob |
|---|---|---|
| **Server** (siehe oben) | | 150–300 € |
| **Zweites, baugleiches Gerät** | Bei einem Hardwaredefekt ist das Büro sonst tagelang blind. Mit Ersatzgerät ist es eine Rücksicherung. | 150–300 € |
| **Externe Festplatte, 2 TB** | Ziel der nächtlichen Sicherung. Fest angesteckt, mit **ext4** formatiert. | 60–90 € |
| **USV** (ca. 650 VA) | Ein Stromausfall mitten in einem Datenbankschreibvorgang beschädigt Daten. Die USV muss den Rechner selbst herunterfahren können — reine Überbrückung genügt nicht. | 80–150 € |

::: tip Zum zweiten Gerät gehört, dass es einmal durchgespielt wird
Aus der Sicherung hochziehen, Zeit notieren, wieder wegstellen. Ein
Ersatzgerät, auf dem nie etwas lief, ist ein Karton.
:::

### Zur Größe der Sicherungsplatte

Die Staffelung hält 23 Stände (7 Tage, 4 Wochen, 12 Monate).
Wochen- und Monatsstände sind **harte Links** auf den jeweiligen Tagesstand —
solange dieser existiert, kosten sie keinen zusätzlichen Platz. Nach sieben
Tagen fällt der Tagesstand weg, und der verlinkte Wochen- oder Monatsstand
hält seine Datenblöcke ab da allein. Als Faustregel: das Fünffache des
erwarteten Datenbestands. Für ein Büro dieser Größe reichen 2 TB reichlich.

**ext4, nicht exFAT oder NTFS** — harte Links gibt es nur auf einem
Linux-Dateisystem, und Eigentümer und Rechte überleben dort ebenfalls.

## Netz

| Punkt | Anforderung |
|---|---|
| **Kabel** | Der Server hängt am Kabel, nicht am WLAN |
| **Feste Adresse** | Feste IP im internen Netz |
| **Namensauflösung** | `patio.<intern>` muss auf den Server zeigen — Router-DNS oder `hosts`-Datei je Arbeitsplatz |
| **Internet** | **Für den Betrieb nicht nötig.** Einmalig beim Aufsetzen, um Ubuntu und Docker zu installieren |

::: tip Kein Mailserver nötig
Frühere Fassungen verlangten hier SMTP, weil die Anmeldung 6-stellige Codes
per E-Mail verschickte. Das ist entfallen: die Anmeldung läuft über
**Benutzername und Passwort**. PATIO verschickt nichts mehr.
:::

## Was NICHT gebraucht wird

- **Kein Mailserver** — siehe oben
- **Keine öffentliche Domain und kein Let's Encrypt** — das Zertifikat kommt
  aus einer eigenen Zertifizierungsstelle auf dem Server
  ([Zertifikat](/betrieb/zertifikat))
- **Kein Internet im Betrieb** — Updates kommen als Datei über einen
  USB-Stick ([Updates](/betrieb/updates)). Auch die **Erstinstallation**
  kommt ohne aus: seit dem 25.08.2026 liegen die Basis-Images
  (`postgres:16`, `caddy:2-alpine`, `alpine:latest`) mit im Paket. Vorher
  fehlten sie, und der erste Start des Stacks wollte sie ziehen.
- **Kein zweiter Faktor / keine Authenticator-App** — im geschlossenen
  Büronetz trägt Passwort plus Ratebremse. Das ändert sich, sobald es einen
  Zugang von außen gibt.

## Checkliste vor dem Aufsetzen

- [ ] Server beschafft, Ubuntu Server 24.04 installiert
- [ ] Zweites, baugleiches Gerät vorhanden
- [ ] Externe Festplatte vorhanden (wird beim Aufsetzen mit ext4 formatiert)
- [ ] USV angeschlossen und mit dem Server verbunden
- [ ] Feste IP vergeben, Kabelnetzwerk
- [ ] Rechnername im Router-DNS eingetragen
- [ ] Auslieferungspaket vom Entwicklungsrechner auf einem USB-Stick — es ist
      **rund 500 MB** groß, seit die Basis-Images mit darin liegen

## Nächster Schritt

→ [Server aufsetzen](/betrieb/server)
