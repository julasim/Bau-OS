# Voraussetzungen

Was du brauchst, bevor du Bau-OS auf einem Server installierst.

## Accounts & Zugaenge

| Was | Woher | Hinweis |
|---|---|---|
| **Hetzner Cloud Account** | [hetzner.com](https://www.hetzner.com/cloud) | Oder ein anderer VPS-Anbieter mit EU-Standort |
| **Telegram Bot Token** | [@BotFather](https://t.me/BotFather) | `/newbot` → Token kopieren |
| **SSH Client** | Bereits installiert (Linux/macOS) oder PuTTY (Windows) | Fuer den Zugang zum Server |
| **SSH Key** | `ssh-keygen -t ed25519` | Wird beim Server-Erstellen hinterlegt |

::: tip Warum Hetzner?
Hetzner hat Rechenzentren in Deutschland und Finnland (EU). Das erleichtert die DSGVO-Konformitaet. Die Preise sind im Vergleich zu AWS/GCP deutlich niedriger.
:::

## Hardware-Anforderungen

| Komponente | Minimum | Empfohlen |
|---|---|---|
| **RAM** | 4 GB | 8 GB |
| **CPU** | 2 vCPU Kerne | 3+ vCPU Kerne |
| **Speicher** | 20 GB SSD | 40 GB SSD |
| **OS** | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |

::: warning RAM ist entscheidend
Ollama laedt das gesamte LLM-Modell in den RAM. Ein 7B-Modell (z.B. `qwen2.5:7b`) braucht ca. 4-5 GB RAM. Bei 4 GB Gesamt-RAM wird es knapp — 8 GB sind deutlich stabiler.
:::

## Empfohlene Hetzner-Server

| Server | vCPU | RAM | SSD | Preis/Monat | Geeignet fuer |
|---|---|---|---|---|---|
| **CPX11** | 2 | 4 GB | 40 GB | ~5 EUR | Minimum, kleine Modelle |
| **CPX21** | 3 | 8 GB | 80 GB | ~9 EUR | Empfohlen fuer 7B Modelle |
| **CPX31** | 4 | 16 GB | 160 GB | ~16 EUR | Groessere Modelle, mehrere Agenten |

::: tip Kosteneinschaetzung
Fuer einen einzelnen Kunden mit einem 7B-Modell rechne mit **5-10 EUR/Monat**. Das umfasst Server, Traffic und Snapshots.
:::

## Lokale Werkzeuge

Auf deinem lokalen Rechner brauchst du:

```bash
# SSH Key erstellen (falls noch keiner vorhanden)
ssh-keygen -t ed25519 -C "bau-os-server"

# Oeffentlichen Key anzeigen (wird bei Hetzner hinterlegt)
cat ~/.ssh/id_ed25519.pub
```

## Checkliste

- [ ] Hetzner Account erstellt und verifiziert
- [ ] Telegram Bot Token vorhanden
- [ ] SSH Key-Paar generiert
- [ ] Oeffentlichen Key in Hetzner hinterlegt

## Naechster Schritt

→ [Server erstellen](/betrieb/server)
