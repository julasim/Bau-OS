# PATIO — VPS-Betriebs-Runbook

Betriebsthemen, die **kein Repo-Code** sind, sondern am Server eingerichtet
werden. Ergänzt die bestehende Betriebs-Doku (`docs/betrieb/`) und die
Backup-Skripte (`scripts/backup.sh`, `scripts/restore.sh`) um die drei zuletzt
offenen Punkte: Offsite-Backup, Monitoring und LLM-Provider-Fallback.

Das allgemeine Server-/Docker-Modell (Edge-Proxy, Zwei-Netzwerke, `.env`-Reload
via `--force-recreate`) steht im globalen `SERVER-PLAYBOOK.md`.

---

## INF-4 — Offsite-Backup (restic → Hetzner Storage Box)

`scripts/backup.sh` erzeugt **lokale** Tagesbackups in `/opt/patio-backups`
(Vault + `.env` + `data/` + PostgreSQL-Dump, 14-Tage-Rotation). Fällt der Server
komplett aus, sind auch die Backups weg → zusätzlich **offsite** sichern.

> **Warnung (aus `backup.sh`):** `.env` (mit `JWT_SECRET`/`ENCRYPTION_KEY`) und
> der DB-Dump müssen **zusammen** gesichert werden — die Keys entschlüsseln die
> Felder. Das restic-Repo deckt beides ab (es sichert `/opt/patio-backups`, dort
> steckt die `.env` im Tarball). Das **restic-Repo-Passwort** getrennt vom
> Server aufbewahren (Passwortmanager).

### Einrichtung

```bash
# 1) restic installieren
sudo apt-get update && sudo apt-get install -y restic

# 2) Hetzner Storage Box als SFTP-Ziel (Repo einmalig initialisieren).
#    <box> = uXXXXXX, Sub-Account/SSH-Key vorher in der Hetzner-Konsole anlegen.
export RESTIC_REPOSITORY="sftp:<box>@<box>.your-storagebox.de:/patio-restic"
export RESTIC_PASSWORD_FILE=/root/.patio-restic-pass   # chmod 600, starkes Passwort
restic init

# 3) Backup-Skript um einen restic-Push erweitern: NACH dem lokalen Backup
#    das Backup-Verzeichnis offsite schieben + Retention setzen.
```

`/opt/patio/scripts/offsite-backup.sh` (neu am Server anlegen, nicht im Repo):

```bash
#!/bin/bash
set -euo pipefail
export RESTIC_REPOSITORY="sftp:<box>@<box>.your-storagebox.de:/patio-restic"
export RESTIC_PASSWORD_FILE=/root/.patio-restic-pass

# Erst das lokale Tagesbackup, dann offsite.
/bin/bash /opt/patio/scripts/backup.sh
restic backup /opt/patio-backups
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
```

### Cron (ersetzt die lokale-only Zeile aus `backup-cron.conf`)

```cron
0 3 * * * /bin/bash /opt/patio/scripts/offsite-backup.sh >> /opt/patio/logs/backup.log 2>&1
```

### Restore-Test (regelmäßig!)

```bash
restic snapshots                       # verfügbare Stände
restic restore latest --target /tmp/patio-restore
# dann wie gewohnt: scripts/restore.sh mit Tarball + DB-Dump aus /tmp/patio-restore
```

Ein Backup, das nie testweise zurückgespielt wurde, ist kein Backup.

---

## INF-14 — Monitoring (Uptime-Kuma)

`docs/betrieb/monitoring.md` deckt Logs/Health am Server ab. Für externe
Verfügbarkeits-Überwachung + Alarmierung kommt **Uptime-Kuma** dazu (self-hosted,
ein Container).

### Aufsetzen (eigener kleiner Stack)

```yaml
# /opt/uptime-kuma/docker-compose.yml
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: uptime-kuma
    volumes:
      - kuma_data:/app/data
    networks: [proxy]          # nur am gemeinsamen Edge-Proxy, kein Host-Port
    restart: unless-stopped
volumes:
  kuma_data:
networks:
  proxy:
    external: true
```

Caddyfile-Block im Edge-Proxy (eigene Subdomain), dann Proxy reloaden:

```caddyfile
status.<domain> {
    reverse_proxy uptime-kuma:3001
}
```

### Monitore

- **PATIO liveness:** HTTP-Monitor auf `https://<domain>/api/health`,
  Intervall 60 s, Keyword-Check auf `"ok":true`. Der Endpunkt ist bewusst
  anonym + ohne Rate-Limit (siehe `src/api/server.ts`).
- **TLS-Ablauf:** Uptime-Kuma warnt automatisch vor Zertifikatsablauf.
- **Benachrichtigung:** Telegram (eigener Bot-Token, nicht der PATIO-Bot) oder
  E-Mail einrichten — sonst merkt niemand den Ausfall.

Optional später: differenzierterer Health-Endpunkt (DB-Ping, Bot-Status) statt
nur Liveness — steht im Backlog II.

---

## LLM-Provider-Fallback (Groq / OpenRouter via `.env`)

Produktiv läuft das LLM über **Ollama Cloud** (`patio-ollama`, per `ollama
signin`). Fällt das aus, lässt sich der Bot ohne Code-Änderung auf einen
OpenAI-kompatiblen Drittanbieter umstellen — der LLM-Client
(`src/llm/client.ts`) unterstützt dafür `OPENAI_BASE_URL`.

### Umschalten (in `/opt/patio/.env`)

**Groq:**
```dotenv
OPENAI_API_KEY=gsk_...
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OLLAMA_MODEL=llama-3.3-70b-versatile
```

**OpenRouter:**
```dotenv
OPENAI_API_KEY=sk-or-...
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OLLAMA_MODEL=meta-llama/llama-3.3-70b-instruct
```

Dann die `.env` einlesen lassen (ein `restart` reicht **nicht**):

```bash
cd /opt/patio && docker compose up -d --force-recreate app
```

Hinweise:
- `OLLAMA_MODEL` steuert den Modellnamen **unabhängig vom Provider** (überschreibt
  `DEFAULT_MODEL`). Ohne Override nimmt der OpenAI-Pfad `gpt-4o-mini`.
- Das Modell muss **agentic Tool-Calling** beherrschen — auf schwachen Modellen
  antwortet der Bot als Fließtext statt Tool-Call. 70B-Klasse oder besser.
- Zurück zu Ollama Cloud: `OPENAI_API_KEY` + `OPENAI_BASE_URL` wieder
  entfernen/leeren, `--force-recreate`.
- **Embeddings** können lokal/bei Ollama bleiben — der Fallback betrifft nur den
  Chat-/Tool-Loop.
