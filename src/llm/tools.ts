import type OpenAI from "openai";

export const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  // Notizen
  {
    type: "function",
    function: {
      name: "notiz_speichern",
      description: "Speichert eine freie Notiz im Vault (Inbox oder Projektordner). Nutze dieses Tool fuer Gedanken, Beobachtungen, Ideen und Informationen die keine konkrete Aufgabe oder Termin sind. Ohne Projekt landet die Notiz in der Inbox.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Inhalt der Notiz" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notizen_auflisten",
      description: "Listet die letzten Notizen aus der Inbox auf, sortiert nach Datum. Nutze dieses Tool um einen Ueberblick ueber aktuelle Notizen zu bekommen oder eine bestimmte Notiz zu finden.",
      parameters: {
        type: "object",
        properties: {
          anzahl: { type: "number", description: "Wie viele Notizen anzeigen (Standard: 5)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notiz_lesen",
      description: "Liest den vollstaendigen Inhalt einer Notiz-Datei. Nutze notizen_auflisten um zuerst den genauen Dateinamen zu finden.",
      parameters: {
        type: "object",
        properties: {
          dateiname: { type: "string", description: "Name der Notiz-Datei" },
        },
        required: ["dateiname"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notiz_loeschen",
      description: "Loescht eine Notiz dauerhaft aus dem Vault. Achtung: nicht rueckgaengig machbar. Stelle sicher dass du den richtigen Dateinamen hast.",
      parameters: {
        type: "object",
        properties: {
          dateiname: { type: "string", description: "Name der Notiz-Datei" },
        },
        required: ["dateiname"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notiz_bearbeiten",
      description: "Fuegt einer bestehenden Notiz am Ende einen Nachtrag hinzu (Append). Nicht fuer Ersetzen — dafuer datei_bearbeiten verwenden. Der Nachtrag wird mit Zeitstempel angehaengt.",
      parameters: {
        type: "object",
        properties: {
          dateiname: { type: "string", description: "Name der Notiz-Datei" },
          text:      { type: "string", description: "Inhalt des Nachtrags" },
        },
        required: ["dateiname", "text"],
      },
    },
  },
  // Aufgaben
  {
    type: "function",
    function: {
      name: "aufgabe_speichern",
      description: "Speichert eine neue Aufgabe (Todo) im Vault. Aufgaben immer mit konkretem Verb beginnen (z.B. 'Angebot fuer Fenster einholen'). Optional einem Projekt zuordnen. Nutze vault_suchen vorher um Duplikate zu vermeiden.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Beschreibung der Aufgabe" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "aufgaben_auflisten",
      description: "Listet alle offenen (nicht erledigten) Aufgaben auf. Optional auf ein Projekt filterbar. Zeigt Aufgabentext, Verantwortlichen und Faelligkeitsdatum an.",
      parameters: {
        type: "object",
        properties: {
          projekt: { type: "string", description: "Optional: nur Aufgaben eines Projekts" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "aufgabe_erledigen",
      description: "Markiert eine Aufgabe als erledigt (done). Der Text muss exakt uebereinstimmen — nutze aufgaben_auflisten um den genauen Text zu finden.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Exakter Text der Aufgabe" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
  // Termine
  {
    type: "function",
    function: {
      name: "termin_speichern",
      description: "Speichert einen neuen Termin, Meeting oder Deadline. Datum immer im Format TT.MM.JJJJ angeben. Relative Angaben wie 'morgen' oder 'naechsten Montag' muessen vorher in ein konkretes Datum umgerechnet werden.",
      parameters: {
        type: "object",
        properties: {
          datum: { type: "string", description: "Datum im Format TT.MM.JJJJ" },
          text: { type: "string", description: "Beschreibung des Termins" },
          uhrzeit: { type: "string", description: "Optional: Uhrzeit im Format HH:MM" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["datum", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "termine_auflisten",
      description: "Listet alle gespeicherten Termine auf, sortiert nach Datum. Zeigt Datum, Uhrzeit, Beschreibung und Ort an. Optional auf ein Projekt filterbar.",
      parameters: {
        type: "object",
        properties: {
          projekt: { type: "string", description: "Optional: nur Termine eines Projekts" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "termin_loeschen",
      description: "Loescht einen Termin dauerhaft. Der Text muss exakt oder als Teiltext uebereinstimmen. Nutze termine_auflisten um den genauen Text zu finden.",
      parameters: {
        type: "object",
        properties: {
          text:    { type: "string", description: "Text oder Teiltext des Termins" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
  // Dateien
  {
    type: "function",
    function: {
      name: "datei_lesen",
      description: "Liest den vollstaendigen Inhalt einer beliebigen Datei im Vault. Pfad ist relativ zum Vault-Root. Nutze dateien_suchen oder ordner_auflisten um den Pfad zu finden wenn du ihn nicht kennst.",
      parameters: {
        type: "object",
        properties: {
          pfad: { type: "string", description: "Relativer Pfad im Vault, z.B. 'Projekte/Alpha/README.md'" },
        },
        required: ["pfad"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "datei_erstellen",
      description: "Erstellt eine neue Datei im Vault oder ueberschreibt eine bestehende. Pfad ist relativ zum Vault-Root. Fehlende Ordner werden automatisch erstellt. Fuer Aenderungen an bestehenden Dateien besser datei_bearbeiten nutzen.",
      parameters: {
        type: "object",
        properties: {
          pfad:   { type: "string", description: "Relativer Pfad im Vault" },
          inhalt: { type: "string", description: "Dateiinhalt" },
        },
        required: ["pfad", "inhalt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ordner_auflisten",
      description: "Listet den Inhalt eines Ordners im Vault auf (Dateien und Unterordner). Zeigt nur eine Ebene — nicht rekursiv. Fuer rekursive Suche dateien_suchen verwenden.",
      parameters: {
        type: "object",
        properties: {
          pfad: { type: "string", description: "Relativer Pfad (leer = Vault-Wurzel)" },
        },
        required: [],
      },
    },
  },
  // Erweiterte Dateioperationen
  {
    type: "function",
    function: {
      name: "datei_bearbeiten",
      description: "Sucht Text in einer Vault-Datei und ersetzt ihn (Find-and-Replace). Fuer praezise Aenderungen an bestehenden Dateien. Unterstuetzt exakte Textsuche und Regex-Muster. Nicht fuer Notiz-Nachtraege — dafuer notiz_bearbeiten nutzen.",
      parameters: {
        type: "object",
        properties: {
          pfad:     { type: "string",  description: "Relativer Pfad im Vault (z.B. 'Projekte/Alpha/README.md')" },
          suchen:   { type: "string",  description: "Text der gesucht wird (exakt oder Regex)" },
          ersetzen: { type: "string",  description: "Ersetzungstext" },
          regex:    { type: "boolean", description: "true = suchen ist ein Regex-Muster (Standard: false)" },
          alle:     { type: "boolean", description: "true = alle Vorkommen ersetzen (Standard: false, nur erstes)" },
        },
        required: ["pfad", "suchen", "ersetzen"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dateien_suchen",
      description: "Sucht Dateien im Vault nach Name/Muster (Glob). Unterstuetzt * und ** Platzhalter. Beispiele: '**/*.md', 'Projekte/*/README.md', 'Inbox/*.md'.",
      parameters: {
        type: "object",
        properties: {
          muster:   { type: "string",  description: "Glob-Muster (z.B. '**/*.md', 'Projekte/*/*.md')" },
          ordner:   { type: "string",  description: "Optional: Startordner (Standard: Vault-Wurzel)" },
          limit:    { type: "number",  description: "Max. Ergebnisse (Standard: 50)" },
        },
        required: ["muster"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "regex_suchen",
      description: "Durchsucht Dateiinhalte im Vault mit Regex-Mustern (wie grep). Gibt Treffer mit Zeilennummern zurueck. Durchsucht alle Dateitypen, nicht nur .md. Fuer einfache Textsuche in Notizen ist vault_suchen schneller.",
      parameters: {
        type: "object",
        properties: {
          muster:      { type: "string",  description: "Regex-Suchmuster (z.B. 'OENORM.*B\\\\s?1801', 'TODO|FIXME')" },
          ordner:      { type: "string",  description: "Optional: Unterordner (Standard: gesamter Vault)" },
          kontext:     { type: "number",  description: "Zeilen Kontext vor/nach Treffer (Standard: 0)" },
          dateifilter: { type: "string",  description: "Optional: Datei-Glob (z.B. '*.md', '*.json')" },
          limit:       { type: "number",  description: "Max. Treffer gesamt (Standard: 20)" },
        },
        required: ["muster"],
      },
    },
  },
  // Vault & Projekte
  {
    type: "function",
    function: {
      name: "vault_suchen",
      description: "Schnelle Freitextsuche in allen .md-Dateien des Vaults. Gibt Dateiname und erste Trefferzeile zurueck (max 10 Ergebnisse). Fuer Regex oder alle Dateitypen regex_suchen verwenden.",
      parameters: {
        type: "object",
        properties: {
          suchbegriff: { type: "string", description: "Der Suchbegriff" },
          projekt: { type: "string", description: "Optional: Suche auf ein Projekt begrenzen" },
        },
        required: ["suchbegriff"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "projekte_auflisten",
      description: "Listet alle Projekte im Vault auf (Ordner unter Projekte/). Zeigt nur die Namen — fuer Details zu einem Projekt projekt_info verwenden.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "projekt_info",
      description: "Zeigt eine Uebersicht zu einem Projekt: Anzahl Notizen, offene Aufgaben und anstehende Termine. Nutze den exakten Projektnamen aus projekte_auflisten.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name des Projekts" },
        },
        required: ["name"],
      },
    },
  },
  // Langzeitgedaechtnis
  {
    type: "function",
    function: {
      name: "memory_speichern",
      description: "Speichert eine wichtige Information dauerhaft in der MEMORY.md des Agenten. Verwenden wenn: (1) Julius explizit sagt 'merk dir', 'vergiss nicht', 'speicher dauerhaft' o.ae., (2) eine Information fuer zukuenftige Gespraeche wichtig ist (Praeferenzen, Projektdetails, Entscheidungen, Kontakte).",
      parameters: {
        type: "object",
        properties: {
          eintrag: { type: "string", description: "Die zu speichernde Information – praegnant formuliert (1-2 Saetze)" },
        },
        required: ["eintrag"],
      },
    },
  },
  // Agent-Sessions
  {
    type: "function",
    function: {
      name: "agent_verlauf",
      description: "Liest den heutigen Gespraechsverlauf eines Agenten (User-Nachrichten und Agent-Antworten). Zeigt die letzten 20 Eintraege. Nuetzlich um zu sehen was ein Sub-Agent heute bereits bearbeitet hat.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Name des Agenten (z.B. 'Protokoll')" },
        },
        required: ["agent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_aktiv",
      description: "Listet alle Agenten auf die heute aktiv waren (mindestens einen Tageslog-Eintrag haben). Zeigt nur die Namen — fuer Details agent_verlauf verwenden.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  // Multi-Agent
  {
    type: "function",
    function: {
      name: "agent_spawnen_async",
      description: "Startet einen Sub-Agenten non-blocking im Hintergrund. Du bekommst sofort eine Bestaetigung — das Ergebnis kommt als separate Telegram-Nachricht. Ideal fuer laengere Aufgaben (Recherche, Analyse). Der Sub-Agent hat eigenen Workspace aber die gleichen Tools.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Name des Sub-Agenten" },
          aufgabe: { type: "string", description: "Aufgabenbeschreibung fuer den Sub-Agenten" },
        },
        required: ["agent", "aufgabe"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_spawnen",
      description: "Startet einen Sub-Agenten und wartet auf das Ergebnis (blocking). Das Ergebnis wird direkt zurueckgegeben. Fuer kurze Aufgaben die in wenigen Sekunden fertig sind. Fuer laengere Aufgaben agent_spawnen_async verwenden.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Name des Sub-Agenten (z.B. 'Protokoll', 'Recherche')" },
          aufgabe: { type: "string", description: "Detaillierte Aufgabenbeschreibung fuer den Sub-Agenten" },
        },
        required: ["agent", "aufgabe"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_erstellen",
      description: "Erstellt einen neuen Sub-Agenten mit eigenem Workspace (SOUL.md, BOOT.md, TOOLS.md etc.). Die Beschreibung wird zu SOUL.md — definiere hier Rolle, Aufgabenbereich und Verhalten. Geschuetzte Agenten (z.B. Main) koennen nicht ueberschrieben werden.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name des neuen Agenten" },
          beschreibung: { type: "string", description: "Was dieser Agent tun soll (wird zu SOUL.md)" },
        },
        required: ["name", "beschreibung"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agenten_auflisten",
      description: "Listet alle verfuegbaren Agenten auf (Ordner unter Agents/). Zeigt sowohl geschuetzte Agenten (Main) als auch selbst erstellte Sub-Agenten.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  // System & Web
  {
    type: "function",
    function: {
      name: "befehl_ausfuehren",
      description: "Fuehrt einen Shell-Befehl auf dem Server aus. Fuer: Systeminfo (df -h, uptime, free -h, top -bn1), Dateien (ls, cat, wc, head, tail, grep, find), Services (systemctl status), Netzwerk (curl, ping, dig), Pakete (apt list), Prozesse (ps aux), Logs (journalctl -u bau-os -n 50). Befehle koennen mit | verkettet werden. Destruktive Befehle (rm -rf, shutdown, reboot) sind blockiert.",
      parameters: {
        type: "object",
        properties: {
          befehl: { type: "string", description: "Shell-Befehl (z.B. 'df -h', 'cat /etc/hostname', 'ps aux | grep node')" },
          verzeichnis: { type: "string", description: "Optionales Arbeitsverzeichnis (Standard: /opt/bau-os)" },
          timeout: { type: "number", description: "Timeout in Sekunden (Standard: 15, max: 60)" },
        },
        required: ["befehl"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code_ausfuehren",
      description: "Fuehrt JavaScript-Code direkt auf dem Server aus. Fuer: Berechnungen (Flaechen, Kosten, Prozent), Daten transformieren (JSON parsen, CSV verarbeiten, Datumsberechnungen), Text verarbeiten (Regex, Split, Format). Der Code laeuft in Node.js — alle eingebauten Module verfuegbar (fs, path, crypto etc.). Letzter Ausdruck wird als Ergebnis zurueckgegeben.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "JavaScript-Code (z.B. 'Math.round(125.5 * 0.2 * 100) / 100' oder mehrzeiliger Code)" },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "http_anfrage",
      description: "Sendet eine HTTP-Anfrage an eine beliebige URL. Fuer: REST APIs aufrufen, Webhooks triggern, Daten von externen Diensten abrufen, JSON APIs abfragen.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Die Ziel-URL (z.B. 'https://api.example.com/data')" },
          methode: { type: "string", description: "HTTP-Methode: GET, POST, PUT, PATCH, DELETE (Standard: GET)" },
          body: { type: "string", description: "Request-Body als JSON-String (fuer POST/PUT/PATCH)" },
          headers: { type: "string", description: "Zusaetzliche Headers als JSON-String (z.B. '{\"Authorization\": \"Bearer xxx\"}')" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_suchen",
      description: "Sucht im Internet via DuckDuckGo nach Informationen. Gibt Titel, URL und Kurzbeschreibung zurueck. Fuer Recherche, aktuelle Preise, Normen, Vorschriften etc. Fuer den vollstaendigen Inhalt einer gefundenen URL dann webseite_lesen verwenden.",
      parameters: {
        type: "object",
        properties: {
          suchbegriff: { type: "string", description: "Der Suchbegriff (z.B. 'OENORM B 1801 Kalkulation')" },
          anzahl: { type: "number", description: "Anzahl Ergebnisse (Standard: 5, max 10)" },
        },
        required: ["suchbegriff"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "webseite_lesen",
      description: "Liest den Textinhalt einer Webseite und gibt bereinigten Text zurueck (HTML-Tags entfernt). Max 8000 Zeichen. Ideal in Kombination mit web_suchen: erst suchen, dann relevante URL lesen.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Die URL der Webseite (z.B. 'https://example.com/artikel')" },
        },
        required: ["url"],
      },
    },
  },
  // Dynamische Tools (Meta)
  {
    type: "function",
    function: {
      name: "tool_erstellen",
      description: "Erstellt ein neues wiederverwendbares Tool als Script. Das Tool wird sofort verfuegbar — kein Neustart noetig. Schreibe den Code so, dass er `args.paramName` nutzt und mit `return 'ergebnis'` das Resultat zurueckgibt. Fuer Templates: nutze `files()` um Zusatzdateien im Tool-Ordner zu lesen.",
      parameters: {
        type: "object",
        properties: {
          ordner: { type: "string", description: "Ordnername (z.B. 'kalkulation', 'bauprotokoll', 'preischeck')" },
          name: { type: "string", description: "Tool-Name fuer LLM (z.B. 'kalkulation_berechnen')" },
          beschreibung: { type: "string", description: "Was das Tool tut — wird dem LLM gezeigt" },
          parameter: { type: "string", description: "Parameter als JSON: {\"flaeche\": {\"type\": \"number\", \"description\": \"m²\"}, ...}" },
          pflichtfelder: { type: "string", description: "Komma-separierte Pflichtfelder (z.B. 'flaeche,typ')" },
          code: { type: "string", description: "JavaScript-Code des Tools. Zugriff auf args.*, files(), Math, Date, JSON, fetch. Ergebnis via return." },
          typ: { type: "string", description: "Script-Typ: 'js' (Standard) oder 'sh' (Shell)" },
          zusatzdateien: { type: "string", description: "Optionale Zusatzdateien als JSON: {\"vorlage.md\": \"# Template\\n...\"}" },
        },
        required: ["ordner", "name", "beschreibung", "code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tools_auflisten",
      description: "Listet alle selbst erstellten dynamischen Tools auf (aus dem tools/ Verzeichnis). Zeigt Name, Beschreibung und Parameter jedes Tools.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "tool_loeschen",
      description: "Loescht ein dynamisches Tool dauerhaft (gesamter Ordner). Nicht rueckgaengig machbar. Nutze tools_auflisten um den Ordnernamen zu finden.",
      parameters: {
        type: "object",
        properties: {
          ordner: { type: "string", description: "Ordnername des Tools (z.B. 'kalkulation')" },
        },
        required: ["ordner"],
      },
    },
  },
  // Agent-Datei Editor
  {
    type: "function",
    function: {
      name: "agent_datei_lesen",
      description: "Liest eine Konfigurationsdatei eines Agenten (SOUL.md, BOOT.md, HEARTBEAT.md, TOOLS.md, MEMORY.md etc.). Damit kannst du die Konfiguration und Persoenlichkeit eines Agenten einsehen.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Name des Agenten (z.B. 'Main', 'CEO')" },
          datei: { type: "string", description: "Dateiname (z.B. 'SOUL.md', 'HEARTBEAT.md')" },
        },
        required: ["agent", "datei"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_datei_schreiben",
      description: "Ueberschreibt eine Konfigurationsdatei eines Agenten vollstaendig. Erlaubte Dateien: SOUL.md, BOOT.md, AGENTS.md, TOOLS.md, HEARTBEAT.md, BOOTSTRAP.md, USER.md, IDENTITY.md, MEMORY.md. Bei HEARTBEAT.md wird der Cron-Job sofort aktualisiert — kein Neustart noetig.",
      parameters: {
        type: "object",
        properties: {
          agent:  { type: "string", description: "Name des Agenten" },
          datei:  { type: "string", description: "Dateiname (muss in der Whitelist sein)" },
          inhalt: { type: "string", description: "Neuer vollstaendiger Inhalt der Datei" },
        },
        required: ["agent", "datei", "inhalt"],
      },
    },
  },
];
