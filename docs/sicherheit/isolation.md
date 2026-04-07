# Kundenisolation

Jeder Bau-OS-Kunde erhaelt eine **vollstaendig getrennte Infrastruktur**. Es gibt keine gemeinsam genutzten Ressourcen zwischen Kunden.

## Prinzip: Ein Kunde = Ein Server

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│       Kunde A (VPS 1)       │     │       Kunde B (VPS 2)       │
│                             │     │                             │
│  ┌───────────────────────┐  │     │  ┌───────────────────────┐  │
│  │  Telegram Bot A       │  │     │  │  Telegram Bot B       │  │
│  │  Token: abc...        │  │     │  │  Token: xyz...        │  │
│  └──────────┬────────────┘  │     │  └──────────┬────────────┘  │
│             │               │     │             │               │
│  ┌──────────▼────────────┐  │     │  ┌──────────▼────────────┐  │
│  │  Ollama (qwen2.5:7b)  │  │     │  │  Ollama (qwen2.5:7b)  │  │
│  │  localhost:11434       │  │     │  │  localhost:11434       │  │
│  └──────────┬────────────┘  │     │  └──────────┬────────────┘  │
│             │               │     │             │               │
│  ┌──────────▼────────────┐  │     │  ┌──────────▼────────────┐  │
│  │  Vault A              │  │     │  │  Vault B              │  │
│  │  /home/bauos/vault/   │  │     │  │  /home/bauos/vault/   │  │
│  └───────────────────────┘  │     │  └───────────────────────┘  │
│                             │     │                             │
│  .env A                     │     │  .env B                     │
│  BOT_TOKEN=abc...           │     │  BOT_TOKEN=xyz...           │
│  VAULT_PATH=/home/.../vault │     │  VAULT_PATH=/home/.../vault │
└─────────────────────────────┘     └─────────────────────────────┘
         Hetzner VPS 1                       Hetzner VPS 2
```

## Was ist pro Kunde getrennt?

| Komponente | Isolation |
|---|---|
| VPS | Eigener virtueller Server (Hetzner) |
| Ollama-Instanz | Eigener Prozess auf `localhost:11434` |
| LLM-Modell | Eigene Modelldateien auf dem VPS |
| Telegram-Bot | Eigener Bot mit eigenem `BOT_TOKEN` |
| Obsidian Vault | Eigener Ordner mit allen Daten |
| `.env`-Datei | Eigene Konfiguration |
| Chat-ID | Eigene `.chat_id`-Datei |
| Bot-Log | Eigene `logs/bot.log` |
| Cron-Jobs | Eigene Heartbeat-Konfiguration |
| SSH-Zugang | Eigener SSH-Key |

::: tip Keine Shared Infrastructure
Es gibt **keinen zentralen Server**, keine gemeinsame Datenbank und kein API-Gateway. Jede Bau-OS-Instanz ist voellig unabhaengig. Wenn ein Server ausfaellt, sind andere Kunden nicht betroffen.
:::

## Warum kein Multi-Tenant?

Viele SaaS-Produkte nutzen Multi-Tenant-Architekturen (eine Instanz fuer alle Kunden). Bau-OS vermeidet dies bewusst:

| Multi-Tenant (ueblich) | Bau-OS (Single-Tenant) |
|---|---|
| Gemeinsame Datenbank | Eigener Vault pro Kunde |
| Shared LLM-API | Eigene Ollama-Instanz |
| Ein Server fuer alle | Ein VPS pro Kunde |
| Datenleck-Risiko zwischen Kunden | Physisch getrennte Daten |
| Zentrale Ausfallpunkte | Unabhaengige Instanzen |
| Komplexe Berechtigungslogik | Einfache Dateisystem-Isolation |

::: warning Hoehere Kosten, hoeherer Schutz
Single-Tenant-Architektur bedeutet hoehere Infrastrukturkosten (ein VPS pro Kunde statt ein grosser Server). Dafuer erhaelt jeder Kunde maximale Datenisolation und keine Abhaengigkeit von anderen Kunden.
:::

## Deployment pro Kunde

Jede Kundeninstanz wird identisch aufgesetzt:

```bash
# 1. VPS bei Hetzner erstellen
# 2. Bau-OS installieren
curl -fsSL https://raw.githubusercontent.com/.../install.sh | bash

# 3. Kunden-spezifische .env konfigurieren
cat > .env << EOF
BOT_TOKEN=<kundenspezifischer-token>
VAULT_PATH=/home/bauos/vault
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=qwen2.5:7b
EOF

# 4. Bot starten
npm start
```

## Netzwerk-Isolation

```
Internet
   │
   ├── Telegram API (ausgehend, Port 443)
   │
   ▼
┌──────────────┐
│   Firewall   │
│  Port 22     │ ◄── SSH (nur Admin)
│  (nur SSH)   │
└──────┬───────┘
       │
┌──────▼───────┐
│  Bau-OS Bot  │
│  Node.js     │──► Ollama (localhost:11434, nicht extern erreichbar)
│              │──► Vault  (Dateisystem, nicht extern erreichbar)
└──────────────┘
```

- **Ollama** laeuft auf `localhost` und ist **nicht von aussen erreichbar**
- **Kein offener Port** ausser SSH (22)
- Telegram-Kommunikation laeuft ueber **Long Polling** (ausgehende Verbindung, kein Webhook)
- Der Vault ist ein **lokaler Ordner** ohne Netzwerkzugriff
