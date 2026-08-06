import { defineConfig } from "vitepress";

export default defineConfig({
  // Die Doku wird vom PATIO-Server unter /docs/ ausgeliefert (Menue "Hilfe →
  // Dokumentation", F1 im Arbeitsplatz-Programm). Beides ist Pflicht:
  //   base   — sonst zeigen die erzeugten Verweise auf /assets/… und kollidieren
  //            mit den gleichnamigen Dateien der Vue-Oberflaeche.
  //   outDir — landet in dist/, denn nur dist/ wandert ins Laufzeit-Image
  //            (Dockerfile Stufe 2 kopiert genau diesen Ordner).
  base: "/docs/",
  outDir: "../dist/docs",

  title: "PATIO",
  description: "Büro-Software für Architektur- und Planungsbüros — im eigenen Netz betrieben",
  lang: "de-DE",

  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Start", link: "/start/uebersicht" },
      { text: "Konzepte", link: "/konzepte/architektur" },
      { text: "Betrieb", link: "/betrieb/voraussetzungen" },
      { text: "Referenz", link: "/referenz/dateistruktur" },
    ],

    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Übersicht", link: "/start/uebersicht" },
          { text: "Schnellstart", link: "/start/schnellstart" },
          { text: "Installation", link: "/start/installation" },
          { text: "Einrichtung", link: "/start/einrichtung" },
        ],
      },
      {
        text: "Konzepte",
        items: [{ text: "Architektur", link: "/konzepte/architektur" }],
      },
      {
        text: "Konfiguration",
        items: [{ text: "Umgebungsvariablen", link: "/konfiguration/env" }],
      },
      {
        text: "Betrieb",
        items: [
          { text: "Voraussetzungen", link: "/betrieb/voraussetzungen" },
          { text: "Server aufsetzen", link: "/betrieb/server" },
          { text: "PATIO installieren", link: "/betrieb/installation" },
          { text: "Zertifikat", link: "/betrieb/zertifikat" },
          { text: "Netzfreigabe", link: "/betrieb/freigabe" },
          { text: "Updates", link: "/betrieb/updates" },
          { text: "Sicherung", link: "/betrieb/sicherung" },
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
      next: "Nächste Seite",
    },

    lastUpdated: {
      text: "Zuletzt aktualisiert",
    },

    returnToTopLabel: "Nach oben",
    sidebarMenuLabel: "Menu",
    darkModeSwitchLabel: "Darstellung",
  },
});
