import type OpenAI from "openai";

export const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  // Notizen
  {
    type: "function",
    function: {
      name: "notiz_speichern",
      description: "Speichert eine Notiz im Obsidian Vault.",
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
      description: "Listet die letzten Notizen aus der Inbox auf.",
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
      description: "Liest den Inhalt einer bestimmten Notiz.",
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
      description: "Loescht eine Notiz dauerhaft aus dem Vault.",
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
      description: "Fuegt einer bestehenden Notiz einen Nachtrag hinzu.",
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
      description: "Speichert eine neue Aufgabe / Todo.",
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
      description: "Listet alle offenen Aufgaben auf.",
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
      description: "Markiert eine Aufgabe als erledigt.",
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
      description: "Speichert einen Termin oder Meeting.",
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
      description: "Listet alle Termine auf.",
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
      description: "Loescht einen Termin aus der Terminliste.",
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
      description: "Liest eine beliebige Datei aus dem Vault (relativer Pfad).",
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
      description: "Erstellt eine neue Datei im Vault oder ueberschreibt eine bestehende.",
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
      description: "Listet den Inhalt eines Ordners im Vault auf.",
      parameters: {
        type: "object",
        properties: {
          pfad: { type: "string", description: "Relativer Pfad (leer = Vault-Wurzel)" },
        },
        required: [],
      },
    },
  },
  // Vault & Projekte
  {
    type: "function",
    function: {
      name: "vault_suchen",
      description: "Sucht nach einem Begriff in allen Notizen.",
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
      description: "Listet alle vorhandenen Projekte auf.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "projekt_info",
      description: "Zeigt Informationen zu einem bestimmten Projekt.",
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
      description: "Liest den heutigen Gespraechsverlauf eines anderen Agenten.",
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
      description: "Listet alle Agenten auf die heute aktiv waren (einen Tageslog haben).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  // Multi-Agent
  {
    type: "function",
    function: {
      name: "agent_spawnen_async",
      description: "Startet einen Sub-Agenten non-blocking im Hintergrund. Sofortige Rueckkehr – Ergebnis wird als separate Nachricht gepostet wenn fertig.",
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
      description: "Startet einen Sub-Agenten und wartet auf das Ergebnis (blocking). Fuer kurze Aufgaben.",
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
      description: "Erstellt einen neuen Sub-Agenten mit eigenem Workspace.",
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
      description: "Listet alle verfuegbaren Sub-Agenten auf.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  // System & Web
  {
    type: "function",
    function: {
      name: "befehl_ausfuehren",
      description: "Fuehrt einen Shell-Befehl auf dem Server aus. Fuer Systeminfo (df, uptime, free), Datei-Operationen (ls, cat, wc), Service-Status (systemctl status) etc. Keine destruktiven Befehle (rm, shutdown, reboot) erlaubt.",
      parameters: {
        type: "object",
        properties: {
          befehl: { type: "string", description: "Der auszufuehrende Shell-Befehl (z.B. 'df -h', 'uptime', 'ls /opt/bau-os')" },
        },
        required: ["befehl"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_suchen",
      description: "Sucht im Internet nach Informationen. Gibt Suchergebnisse mit Titel, URL und Beschreibung zurueck.",
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
      description: "Liest den Textinhalt einer Webseite. Gibt den bereinigten Text zurueck (ohne HTML-Tags).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Die URL der Webseite (z.B. 'https://example.com/artikel')" },
        },
        required: ["url"],
      },
    },
  },
  // Agent-Datei Editor
  {
    type: "function",
    function: {
      name: "agent_datei_lesen",
      description: "Liest eine Konfigurationsdatei eines Agenten (z.B. SOUL.md, HEARTBEAT.md, TOOLS.md).",
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
      description: "Ueberschreibt eine Konfigurationsdatei eines Agenten. Erlaubte Dateien: SOUL.md, BOOT.md, AGENTS.md, TOOLS.md, HEARTBEAT.md, BOOTSTRAP.md, USER.md, IDENTITY.md, MEMORY.md.",
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
