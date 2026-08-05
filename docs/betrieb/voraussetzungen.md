# Voraussetzungen

Was gebraucht wird, bevor PATIO im Büro installiert wird.

## Der Rechner

PATIO läuft auf **einem Rechner im Büronetz**. Ein Mini-PC genügt — die
Anwendung ist ein Node-Prozess neben einer PostgreSQL-Datenbank, es läuft
kein Sprachmodell und keine Bildverarbeitung mit.

| Komponente | Minimum | Empfohlen |
|---|---|---|
| **CPU** | 2 Kerne | 4 Kerne |
| **RAM** | 4 GB | 8 GB |
| **Speicher** | 64 GB SSD | 256 GB SSD oder mehr |
| **Betriebssystem** | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |

::: tip Speicher ist der begrenzende Faktor
Hochgeladene Dateien liegen in der Datenbank. Ein Büro mit vielen Plänen und
Fotos füllt eine Platte deutlich schneller als es CPU oder RAM auslastet.
Die Backups kommen dazu — planen Sie den Ablageort dafür getrennt.
:::

Der Rechner sollte durchlaufen und nicht der Arbeitsplatz einer Person sein.
Er braucht eine feste IP im Netz oder einen festen DNS-Namen; die
Arbeitsplätze erreichen ihn ausschließlich über den Browser.

## Software auf dem Rechner

Zwei Wege, je nachdem wie tief man einsteigen will:

| Weg | Was gebraucht wird |
|---|---|
| **Docker Compose** (empfohlen) | Docker Engine und das Compose-Plugin |
| **Bare Metal** | Node.js 24, PostgreSQL 16, Git, `build-essential` |

Details: [Software installieren](/betrieb/software).

## Netz

| Punkt | Anforderung |
|---|---|
| **Erreichbarkeit** | Die Arbeitsplätze müssen den Rechner über HTTP(S) erreichen |
| **Feste Adresse** | Feste IP oder DNS-Eintrag im internen Netz |
| **Zertifikat** | Eigenes Zertifikat der internen CA oder ein selbst signiertes; Let's Encrypt funktioniert ohne öffentlich erreichbaren Namen nicht |
| **SMTP** | Ein Mailserver, der aus dem Büronetz erreichbar ist |
| **Internet** | Nicht erforderlich für den Betrieb — nur für Updates aus dem Git-Repository und für Container-Images beim ersten Aufsetzen |

::: warning Der Login braucht E-Mail
Die Anmeldung verlangt nach Benutzername und Passwort einen 6-stelligen
Code, der per E-Mail zugestellt wird. Ohne erreichbaren SMTP-Server kann
sich **niemand** anmelden. Steht kein Mailserver im Haus, muss dieser Punkt
vor der Inbetriebnahme geklärt sein.
:::

## Backup-Ziel

Ein Backup, das auf demselben Rechner liegt, ist bei dessen Ausfall
mitverloren. Vorzusehen ist ein zweiter Ablageort im Haus — ein NAS, eine
Netzfreigabe oder eine Wechselplatte. Details:
[Backup](/betrieb/backup).

## Checkliste

- [ ] Rechner beschafft, Ubuntu installiert, läuft durch
- [ ] Feste IP oder DNS-Name vergeben
- [ ] Docker Engine + Compose-Plugin installiert (oder Node und PostgreSQL)
- [ ] Zertifikat für den Reverse-Proxy vorhanden
- [ ] SMTP-Zugangsdaten vorhanden und aus dem Netz erreichbar
- [ ] Backup-Ziel festgelegt

## Nächster Schritt

→ [Server aufsetzen](/betrieb/server)
