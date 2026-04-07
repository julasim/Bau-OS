import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Bau-OS",
  description: "KI-Plattform fuer Bueros und Bauunternehmen",
  lang: "de-DE",

  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Start", link: "/start/uebersicht" },
      { text: "Konzepte", link: "/konzepte/architektur" },
      { text: "Betrieb", link: "/betrieb/voraussetzungen" },
      { text: "Referenz", link: "/referenz/tools" },
    ],

    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Uebersicht", link: "/start/uebersicht" },
          { text: "Schnellstart", link: "/start/schnellstart" },
          { text: "Installation", link: "/start/installation" },
          { text: "Einrichtung", link: "/start/einrichtung" },
        ],
      },
      {
        text: "Konzepte",
        items: [
          { text: "Architektur", link: "/konzepte/architektur" },
          { text: "Agenten", link: "/konzepte/agenten" },
          { text: "Workspace", link: "/konzepte/workspace" },
          { text: "Vault", link: "/konzepte/vault" },
          { text: "Heartbeat", link: "/konzepte/heartbeat" },
          { text: "Memory", link: "/konzepte/memory" },
        ],
      },
      {
        text: "Agenten-Dateien",
        collapsed: true,
        items: [
          { text: "IDENTITY.md", link: "/agenten/identity" },
          { text: "SOUL.md", link: "/agenten/soul" },
          { text: "BOOT.md", link: "/agenten/boot" },
          { text: "AGENTS.md", link: "/agenten/agents" },
          { text: "TOOLS.md", link: "/agenten/tools" },
          { text: "MEMORY.md", link: "/agenten/memory" },
          { text: "HEARTBEAT.md", link: "/agenten/heartbeat" },
          { text: "BOOTSTRAP.md", link: "/agenten/bootstrap" },
          { text: "USER.md", link: "/agenten/user" },
          { text: "MEMORY_LOGS/", link: "/agenten/memory-logs" },
        ],
      },
      {
        text: "Konfiguration",
        items: [
          { text: "Umgebungsvariablen", link: "/konfiguration/env" },
          { text: "Modelle", link: "/konfiguration/modelle" },
          { text: "Slash-Commands", link: "/konfiguration/commands" },
          { text: "Anpassung", link: "/konfiguration/anpassung" },
        ],
      },
      {
        text: "Betrieb",
        items: [
          { text: "Voraussetzungen", link: "/betrieb/voraussetzungen" },
          { text: "Server erstellen", link: "/betrieb/server" },
          { text: "Software installieren", link: "/betrieb/software" },
          { text: "Bot deployen", link: "/betrieb/deployment" },
          { text: "systemd Service", link: "/betrieb/systemd" },
          { text: "Updates", link: "/betrieb/updates" },
          { text: "Backup", link: "/betrieb/backup" },
          { text: "Monitoring", link: "/betrieb/monitoring" },
          { text: "Troubleshooting", link: "/betrieb/troubleshooting" },
        ],
      },
      {
        text: "Sicherheit",
        items: [
          { text: "DSGVO", link: "/sicherheit/dsgvo" },
          { text: "Datenisolation", link: "/sicherheit/isolation" },
          { text: "Zugriffskontrolle", link: "/sicherheit/zugriff" },
        ],
      },
      {
        text: "Referenz",
        items: [
          { text: "LLM-Tools", link: "/referenz/tools" },
          { text: "Dateistruktur", link: "/referenz/dateistruktur" },
          { text: "Konfiguration", link: "/referenz/config" },
          { text: "Changelog", link: "/referenz/changelog" },
        ],
      },
    ],

    socialLinks: [
      // { icon: "github", link: "https://github.com/..." },
    ],

    search: {
      provider: "local",
    },

    outline: {
      label: "Auf dieser Seite",
    },

    docFooter: {
      prev: "Vorherige Seite",
      next: "Naechste Seite",
    },

    lastUpdated: {
      text: "Zuletzt aktualisiert",
    },

    returnToTopLabel: "Nach oben",
    sidebarMenuLabel: "Menu",
    darkModeSwitchLabel: "Darstellung",
  },
});
