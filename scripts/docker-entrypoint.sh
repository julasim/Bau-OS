#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Bau-OS Docker Entrypoint
# Startet Ollama im Hintergrund, wartet bis es bereit ist, dann Node.js
# ─────────────────────────────────────────────────────────────────────────────

set -e

# Ollama als Hintergrundprozess starten
ollama serve &

# Warten bis Ollama API antwortet (max. 30 Sekunden)
echo "[bau-os] Warte auf Ollama..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "[bau-os] Ollama bereit"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[bau-os] Warnung: Ollama antwortet nicht — starte trotzdem"
  fi
  sleep 1
done

# Bau-OS starten (exec ersetzt diesen Prozess → korrekte Signal-Weiterleitung)
exec node dist/index.js
