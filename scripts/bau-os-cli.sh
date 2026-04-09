#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# bau-os — CLI Management Tool
# Wird nach Installation verfügbar als: bau-os
# ─────────────────────────────────────────────────────────────────────────────

INSTALL_DIR="/opt/bau-os"
VAULT_DIR="/opt/bau-os-vault"
SERVICE="bau-os"
SERVICE_USER="bauos"

# Farben
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly RED='\033[0;31m'
readonly BOLD='\033[1m'
readonly DIM='\033[2m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m'

# ─────────────────────────────────────────────────────────────────────────────
# Hilfsfunktionen
# ─────────────────────────────────────────────────────────────────────────────

print_logo() {
  echo -e "${BOLD}"
  echo '  ██████╗  █████╗ ██╗   ██╗      ██████╗ ███████╗'
  echo '  ██╔══██╗██╔══██╗██║   ██║     ██╔═══██╗██╔════╝'
  echo '  ██████╔╝███████║██║   ██║     ██║   ██║███████╗'
  echo '  ██╔══██╗██╔══██║██║   ██║     ██║   ██║╚════██║'
  echo '  ██████╔╝██║  ██║╚██████╔╝     ╚██████╔╝███████║'
  echo '  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝       ╚═════╝ ╚══════╝'
  echo -e "${NC}"
  echo -e "  ${DIM}KI-Assistent für die Baubranche${NC}"
  echo -e "  ${DIM}────────────────────────────────────────────────${NC}"
  echo ""
}

need_root() {
  if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}  ✗${NC} Dieser Befehl benötigt root: sudo bau-os $*"
    exit 1
  fi
}

service_status_line() {
  if systemctl is-active --quiet "$SERVICE"; then
    echo -e "  ${GREEN}●${NC} ${BOLD}$SERVICE${NC} läuft"
  else
    echo -e "  ${RED}●${NC} ${BOLD}$SERVICE${NC} gestoppt"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Befehle
# ─────────────────────────────────────────────────────────────────────────────

cmd_status() {
  echo ""
  service_status_line
  echo ""
  systemctl status "$SERVICE" --no-pager -l
}

cmd_logs() {
  local lines="${1:-50}"
  echo ""
  echo -e "  ${BOLD}Letzte $lines Log-Einträge:${NC}"
  echo ""
  journalctl -u "$SERVICE" -n "$lines" --no-pager
}

cmd_logs_live() {
  echo ""
  echo -e "  ${BOLD}Live-Logs${NC} ${DIM}(Ctrl+C zum Beenden)${NC}"
  echo ""
  journalctl -u "$SERVICE" -f
}

cmd_restart() {
  need_root restart
  echo ""
  echo -e "  ${YELLOW}▶${NC} Neustart..."
  systemctl restart "$SERVICE"
  sleep 2
  service_status_line
  echo ""
}

cmd_start() {
  need_root start
  echo ""
  echo -e "  ${YELLOW}▶${NC} Starten..."
  systemctl start "$SERVICE"
  sleep 2
  service_status_line
  echo ""
}

cmd_stop() {
  need_root stop
  echo ""
  echo -e "  ${YELLOW}▶${NC} Stoppen..."
  systemctl stop "$SERVICE"
  sleep 1
  service_status_line
  echo ""
}

cmd_update() {
  need_root update
  echo ""
  bash "$INSTALL_DIR/scripts/update.sh"
}

cmd_check_update() {
  echo ""
  echo -e "  ${BOLD}Update-Check...${NC}"
  echo ""

  if [ ! -d "$INSTALL_DIR/.git" ]; then
    echo -e "  ${RED}Kein Git-Repository in $INSTALL_DIR${NC}"
    return 1
  fi

  cd "$INSTALL_DIR"

  # Remote-Status holen (als Service-User wegen git ownership)
  su -s /bin/bash "$SERVICE_USER" -c "cd $INSTALL_DIR && git fetch origin" 2>/dev/null

  LOCAL=$(su -s /bin/bash "$SERVICE_USER" -c "cd $INSTALL_DIR && git rev-parse HEAD")
  REMOTE=$(su -s /bin/bash "$SERVICE_USER" -c "cd $INSTALL_DIR && git rev-parse origin/main")

  if [ "$LOCAL" = "$REMOTE" ]; then
    echo -e "  ${GREEN}✓${NC} Bau-OS ist auf dem neuesten Stand"
    echo -e "  ${DIM}  Version: ${LOCAL:0:7}${NC}"
    echo ""
    return 0
  fi

  # Neue Commits anzeigen
  BEHIND=$(su -s /bin/bash "$SERVICE_USER" -c "cd $INSTALL_DIR && git rev-list HEAD..origin/main --count")
  echo -e "  ${YELLOW}!${NC} ${BOLD}$BEHIND neue(s) Update(s) verfügbar${NC}"
  echo -e "  ${DIM}  Lokal:  ${LOCAL:0:7}${NC}"
  echo -e "  ${DIM}  Remote: ${REMOTE:0:7}${NC}"
  echo ""
  echo -e "  ${BOLD}Änderungen:${NC}"
  su -s /bin/bash "$SERVICE_USER" -c "cd $INSTALL_DIR && git log HEAD..origin/main --oneline --no-decorate" | while read -r line; do
    echo -e "    ${CYAN}•${NC} $line"
  done
  echo ""

  # Fragen ob installiert werden soll
  if [ "$EUID" -eq 0 ]; then
    read -rp "  Update jetzt installieren? [j/N]: " confirm
    if [[ "$confirm" =~ ^[jJ]$ ]]; then
      echo ""
      bash "$INSTALL_DIR/scripts/update.sh"
    else
      echo ""
      echo -e "  ${DIM}Update übersprungen. Manuell: sudo bau-os update${NC}"
      echo ""
    fi
  else
    echo -e "  ${DIM}Zum Installieren: sudo bau-os check-update${NC}"
    echo ""
  fi
}

cmd_env() {
  echo ""
  echo -e "  ${BOLD}Konfiguration (.env):${NC}"
  echo ""
  if [ -f "$INSTALL_DIR/.env" ]; then
    # BOT_TOKEN maskieren
    sed 's/\(BOT_TOKEN=\)\(.\{8\}\).*/\1\2.../' "$INSTALL_DIR/.env"
  else
    echo -e "  ${RED}  .env nicht gefunden${NC}"
  fi
  echo ""
}

cmd_vault() {
  echo ""
  echo -e "  ${BOLD}Vault-Verzeichnis ($VAULT_DIR):${NC}"
  echo ""
  if [ -d "$VAULT_DIR" ]; then
    ls -la "$VAULT_DIR"
  else
    echo -e "  ${RED}  Vault nicht gefunden${NC}"
  fi
  echo ""
}

cmd_ollama() {
  echo ""
  echo -e "  ${BOLD}Ollama Status:${NC}"
  echo ""
  systemctl status ollama --no-pager -l
}

cmd_user() {
  local subcmd="${1:-}"
  local name="${2:-}"

  case "$subcmd" in
    add)
      need_root user add
      if [ -z "$name" ]; then
        read -rp "  Benutzername: " name
      fi
      if [ -z "$name" ]; then
        echo -e "  ${RED}Benutzername darf nicht leer sein${NC}"
        return 1
      fi
      # Prüfen ob User existiert
      if [ -f "$INSTALL_DIR/data/users.json" ]; then
        if node -e "const u=JSON.parse(require('fs').readFileSync('$INSTALL_DIR/data/users.json','utf-8')); process.exit(u.some(x=>x.username==='$name')?0:1)" 2>/dev/null; then
          echo -e "  ${RED}User '$name' existiert bereits${NC}"
          return 1
        fi
      fi
      read -rsp "  Passwort: " pass
      echo ""
      if [ -z "$pass" ]; then
        echo -e "  ${RED}Passwort darf nicht leer sein${NC}"
        return 1
      fi
      local hash
      hash=$(cd "$INSTALL_DIR" && node -e "const b=require('bcrypt'); b.hash(process.argv[1],10).then(h=>console.log(h))" "$pass")
      local today
      today=$(date +%Y-%m-%d)
      # User hinzufügen
      mkdir -p "$INSTALL_DIR/data"
      if [ -f "$INSTALL_DIR/data/users.json" ]; then
        cd "$INSTALL_DIR" && node -e "
          const fs=require('fs');
          const u=JSON.parse(fs.readFileSync('data/users.json','utf-8'));
          u.push({username:'$name',passwordHash:'$hash',role:'user',createdAt:'$today'});
          fs.writeFileSync('data/users.json',JSON.stringify(u,null,2));"
      else
        echo "[{\"username\":\"$name\",\"passwordHash\":\"$hash\",\"role\":\"user\",\"createdAt\":\"$today\"}]" > "$INSTALL_DIR/data/users.json"
      fi
      chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/data/users.json"
      echo -e "  ${GREEN}✓${NC} User '${BOLD}$name${NC}' erstellt"
      ;;
    list)
      echo ""
      echo -e "  ${BOLD}Web-Benutzer:${NC}"
      echo ""
      if [ -f "$INSTALL_DIR/data/users.json" ]; then
        node -e "
          const u=JSON.parse(require('fs').readFileSync('$INSTALL_DIR/data/users.json','utf-8'));
          u.forEach(x=>console.log('  '+x.username.padEnd(20)+x.role.padEnd(10)+x.createdAt));"
      else
        echo -e "  ${DIM}Keine users.json gefunden${NC}"
      fi
      echo ""
      ;;
    delete|remove)
      need_root user delete
      if [ -z "$name" ]; then
        read -rp "  Benutzername zum Löschen: " name
      fi
      if [ -z "$name" ] || [ ! -f "$INSTALL_DIR/data/users.json" ]; then
        echo -e "  ${RED}User nicht gefunden${NC}"
        return 1
      fi
      cd "$INSTALL_DIR" && node -e "
        const fs=require('fs');
        let u=JSON.parse(fs.readFileSync('data/users.json','utf-8'));
        const before=u.length;
        u=u.filter(x=>x.username!=='$name');
        if(u.length===before){console.log('User nicht gefunden');process.exit(1);}
        fs.writeFileSync('data/users.json',JSON.stringify(u,null,2));"
      echo -e "  ${GREEN}✓${NC} User '${BOLD}$name${NC}' gelöscht"
      ;;
    *)
      echo ""
      echo -e "  ${BOLD}Verwendung:${NC}  bau-os user <befehl> [name]"
      echo ""
      echo -e "    ${BOLD}add${NC} [name]      Neuen User anlegen    ${DIM}(sudo)${NC}"
      echo -e "    ${BOLD}list${NC}            Alle User auflisten"
      echo -e "    ${BOLD}delete${NC} [name]   User löschen          ${DIM}(sudo)${NC}"
      echo ""
      ;;
  esac
}

cmd_help() {
  echo ""
  echo -e "  ${BOLD}Verwendung:${NC}  bau-os [befehl] [optionen]"
  echo ""
  echo -e "  ${CYAN}Befehle:${NC}"
  echo -e "    ${BOLD}status${NC}           Service-Status anzeigen"
  echo -e "    ${BOLD}logs${NC} [n]         Letzte n Log-Einträge (Standard: 50)"
  echo -e "    ${BOLD}logs live${NC}        Live-Logs (Ctrl+C zum Beenden)"
  echo -e "    ${BOLD}restart${NC}          Service neu starten  ${DIM}(sudo)${NC}"
  echo -e "    ${BOLD}start${NC}            Service starten       ${DIM}(sudo)${NC}"
  echo -e "    ${BOLD}stop${NC}             Service stoppen       ${DIM}(sudo)${NC}"
  echo -e "    ${BOLD}update${NC}           Update von GitHub einspielen ${DIM}(sudo)${NC}"
  echo -e "    ${BOLD}check-update${NC}     Auf Updates prüfen"
  echo -e "    ${BOLD}user${NC} add|list|delete  Web-Benutzer verwalten"
  echo -e "    ${BOLD}env${NC}              .env Konfiguration anzeigen"
  echo -e "    ${BOLD}vault${NC}            Vault-Verzeichnis anzeigen"
  echo -e "    ${BOLD}ollama${NC}           Ollama Service Status"
  echo ""
  echo -e "  ${DIM}Ohne Befehl: Interaktives Menü${NC}"
  echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Interaktives Menü
# ─────────────────────────────────────────────────────────────────────────────

cmd_menu() {
  while true; do
    clear
    print_logo
    service_status_line
    echo ""
    echo -e "  ${BOLD}Was möchtest du tun?${NC}"
    echo ""
    echo -e "  ${CYAN}[1]${NC}  Status anzeigen"
    echo -e "  ${CYAN}[2]${NC}  Logs anzeigen (letzte 50)"
    echo -e "  ${CYAN}[3]${NC}  Live-Logs (Ctrl+C zum Beenden)"
    echo -e "  ${CYAN}[4]${NC}  Service neu starten"
    echo -e "  ${CYAN}[5]${NC}  Service starten"
    echo -e "  ${CYAN}[6]${NC}  Service stoppen"
    echo -e "  ${CYAN}[7]${NC}  Auf Updates prüfen"
    echo -e "  ${CYAN}[8]${NC}  .env Konfiguration"
    echo -e "  ${CYAN}[9]${NC}  Vault anzeigen"
    echo -e "  ${CYAN}[10]${NC} Ollama Status"
    echo -e "  ${CYAN}[11]${NC} Web-User verwalten"
    echo ""
    echo -e "  ${DIM}[0]  Beenden${NC}"
    echo ""
    read -rp "  Auswahl: " choice

    case "$choice" in
      1) clear; cmd_status;  read -rp "  [Enter] zurück..." ;;
      2) clear; cmd_logs 50; read -rp "  [Enter] zurück..." ;;
      3) clear; cmd_logs_live ;;
      4) clear; cmd_restart; read -rp "  [Enter] zurück..." ;;
      5) clear; cmd_start;   read -rp "  [Enter] zurück..." ;;
      6) clear; cmd_stop;    read -rp "  [Enter] zurück..." ;;
      7) clear; cmd_check_update; read -rp "  [Enter] zurück..." ;;
      8) clear; cmd_env;     read -rp "  [Enter] zurück..." ;;
      9) clear; cmd_vault;   read -rp "  [Enter] zurück..." ;;
      10) clear; cmd_ollama; read -rp "  [Enter] zurück..." ;;
      11) clear; cmd_user list; read -rp "  [Enter] zurück..." ;;
      0|q|Q) echo ""; break ;;
      *) echo -e "\n  ${RED}Ungültige Eingabe${NC}" ; sleep 1 ;;
    esac
  done
}

# ─────────────────────────────────────────────────────────────────────────────
# Einstiegspunkt
# ─────────────────────────────────────────────────────────────────────────────

case "${1:-}" in
  status)              cmd_status ;;
  logs)
    if [ "${2:-}" = "live" ]; then cmd_logs_live
    else cmd_logs "${2:-50}"
    fi ;;
  restart)             cmd_restart ;;
  start)               cmd_start ;;
  stop)                cmd_stop ;;
  update)              cmd_update ;;
  check-update|check)  cmd_check_update ;;
  user)                cmd_user "${2:-}" "${3:-}" ;;
  env|config)          cmd_env ;;
  vault)               cmd_vault ;;
  ollama)              cmd_ollama ;;
  help|--help|-h)      print_logo; cmd_help ;;
  "")                  cmd_menu ;;
  *)
    echo -e "${RED}  Unbekannter Befehl: $1${NC}"
    cmd_help
    exit 1 ;;
esac
