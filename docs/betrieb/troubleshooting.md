# Troubleshooting

Haeufige Probleme und Lösungen für Bau-OS im Produktivbetrieb.

## Bot antwortet nicht

### 1. Service prüfen

```bash
sudo systemctl status bau-os
```

Falls `inactive` oder `failed`:

```bash
sudo journalctl -u bau-os -n 50 --no-pager
sudo systemctl restart bau-os
```

### 2. Ollama prüfen

```bash
sudo systemctl status ollama
curl http://localhost:11434/v1/models
```

Falls Ollama nicht läuft:

```bash
sudo systemctl restart ollama
# Warten bis das Modell geladen ist (ca. 10-30 Sek.)
sleep 10
sudo systemctl restart bau-os
```

### 3. Bot Token prüfen

```bash
grep BOT_TOKEN /home/bauos/bau-os/.env
```

::: danger Token kompromittiert?
Falls der Token oeffentlich wurde, erstelle sofort einen neuen bei @BotFather mit `/revoke` und aktualisiere die `.env`:
```bash
nano /home/bauos/bau-os/.env
sudo systemctl restart bau-os
```
:::

### 4. Netzwerk prüfen

```bash
# Kann der Server Telegram erreichen?
curl -s https://api.telegram.org/bot<DEIN_TOKEN>/getMe
```

Falls keine Verbindung: DNS oder Firewall prüfen.

```bash
# DNS-Aufloesung testen
nslookup api.telegram.org

# Ausgehende HTTPS-Verbindung testen
curl -I https://api.telegram.org
```

---

## Ollama: Out of Memory

Symptome: Bot antwortet extrem langsam oder gar nicht. In den Logs:

```
Error: model requires more memory than available
```

### Lösung 1: Kleineres Modell verwenden

```bash
ollama pull qwen2.5:3b
```

`.env` anpassen:

```bash
nano /home/bauos/bau-os/.env
# OLLAMA_MODEL=qwen2.5:3b
sudo systemctl restart bau-os
```

### Lösung 2: Swap hinzufuegen

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

::: warning Swap ist langsam
Swap auf SSD ist akzeptabel, aber deutlich langsamer als RAM. Besser: Server upgraden (z.B. CPX11 → CPX21).
:::

### Lösung 3: Server upgraden

In der Hetzner Cloud Console: Server → Rescale → CPX21 (8 GB RAM) wählen. Erfordert kurzen Neustart.

---

## Telegram Timeout / Fehler 409

### Fehler 409: Conflict

```
Error: 409: Conflict: terminated by other getUpdates request
```

**Ursache:** Zwei Bot-Instanzen laufen gleichzeitig mit dem gleichen Token.

```bash
# Alle Node-Prozesse finden
ps aux | grep node

# Doppelte Instanzen beenden
sudo systemctl stop bau-os
pkill -f "node dist/index.js"
sudo systemctl start bau-os
```

### Timeout-Fehler

```
Error: ETIMEOUT connecting to api.telegram.org
```

```bash
# Netzwerk prüfen
ping -c 3 api.telegram.org

# DNS prüfen
cat /etc/resolv.conf

# Ggf. Google DNS setzen
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
```

---

## Build-Fehler nach Update

### npm install schlaegt fehl

```bash
# Node Modules komplett neu installieren
cd /home/bauos/bau-os
rm -rf node_modules package-lock.json
npm install
```

### TypeScript-Kompilierungsfehler

```bash
# Node.js Version prüfen
node --version
# Muss v20.x.x sein

# Falls zu alt:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
```

### Permission-Fehler

```bash
# Eigentuemer prüfen
ls -la /home/bauos/bau-os/

# Falls nötig, Eigentuemer korrigieren
sudo chown -R bauos:bauos /home/bauos/bau-os
sudo chown -R bauos:bauos /home/bauos/vault
```

---

## Heartbeat funktioniert nicht

Der Heartbeat (geplante Nachrichten) wird über die `HEARTBEAT.md` Datei konfiguriert.

### 1. HEARTBEAT.md prüfen

```bash
cat /home/bauos/vault/Agents/Main/HEARTBEAT.md
```

::: warning Cron-Zeile erforderlich
Die Datei **muss** eine Zeile mit `Cron:` enthalten, z.B.:
```markdown
Cron: 0 8 * * 1-5
```
Ohne diese Zeile wird kein Heartbeat ausgefuehrt.
:::

### 2. Nach Änderungen neu starten

Heartbeat-Änderungen werden erst nach einem Neustart wirksam:

```bash
sudo systemctl restart bau-os
```

### 3. Cronjob in den Logs prüfen

```bash
sudo journalctl -u bau-os --since today | grep -i heartbeat
```

---

## Agent gibt falsche oder unpassende Antworten

### SOUL.md prüfen

Die Persönlichkeit des Agenten ist in `SOUL.md` definiert:

```bash
cat /home/bauos/vault/Agents/Main/SOUL.md
```

Passe die Datei an, falls der Ton oder die Anweisungen nicht stimmen:

```bash
nano /home/bauos/vault/Agents/Main/SOUL.md
```

::: tip Kein Neustart nötig
Änderungen an `SOUL.md`, `BOOT.md` und anderen Agent-Dateien werden bei der nächsten Nachricht automatisch geladen. Kein Neustart erforderlich.
:::

### BOOT.md prüfen

Die Startanweisungen für jeden Chat:

```bash
cat /home/bauos/vault/Agents/Main/BOOT.md
```

### Tages-Log zurücksetzen

Falls der Kontext durch einen fehlerhaften Tages-Log verunreinigt ist:

```
/clear
```

Dieser Befehl in Telegram loescht den Tages-Log und startet frisch.

### Modell wechseln

Falls das Modell grundsaetzlich unpassende Antworten gibt:

```bash
# Anderes Modell testen
ollama pull llama3.1:8b

# In .env ändern
nano /home/bauos/bau-os/.env
# OLLAMA_MODEL=llama3.1:8b

sudo systemctl restart bau-os
```

---

## Festplatte voll

```bash
# Plattennutzung prüfen
df -h /

# Größte Verzeichnisse finden
du -sh /home/bauos/* | sort -rh

# Alte Backups aufräumen
ls -lh /home/bauos/backups/
find /home/bauos/backups/ -name "vault-*.tar.gz" -mtime +30 -delete

# Alte Ollama-Modelle entfernen
ollama list
ollama rm nicht-benoetigtes-modell

# Journal-Logs begrenzen
sudo journalctl --vacuum-size=100M
```

---

## Schnelldiagnose

Kopiere diesen Block und führe ihn auf dem Server aus:

```bash
echo "=== Schnelldiagnose ==="
echo "Bot:     $(systemctl is-active bau-os)"
echo "Ollama:  $(systemctl is-active ollama)"
echo "Node:    $(node --version 2>/dev/null || echo 'FEHLT')"
echo "RAM:     $(free -h | awk '/Mem:/ {print $3 "/" $2}')"
echo "Disk:    $(df -h / | awk 'NR==2 {print $3 "/" $2 " (" $5 ")"}')"
echo "Uptime:  $(uptime -p)"
echo "Vault:   $(ls /home/bauos/vault/Agents/Main/IDENTITY.md 2>/dev/null && echo 'OK' || echo 'FEHLT')"
echo "Fehler:  $(journalctl -u bau-os -p err --since '1 hour ago' --no-pager 2>/dev/null | wc -l) in letzter Stunde"
echo "========================"
```
