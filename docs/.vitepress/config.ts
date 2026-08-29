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

  // ── Warum hier ausdrücklich `false` steht ────────────────────────────────
  //
  // VitePress ermittelt das Änderungsdatum je Seite über `git log`. Eingeschaltet
  // wird das nicht nur durch diese Option, sondern AUCH durch einen Eintrag
  // `themeConfig.lastUpdated` — der wie eine blosse Beschriftung aussieht:
  //
  //     lastUpdated: userConfig.lastUpdated ?? !!userConfig.themeConfig?.lastUpdated
  //     (vitepress/dist/node/chunk-*.js)
  //
  // Im Container gibt es weder das Programm `git` noch ein Repository
  // (`.dockerignore` schliesst `.git/` aus). VitePress 1.6.4 faengt den
  // fehlgeschlagenen Aufruf NICHT ab, sondern lehnt die Zusage ab — und damit
  // scheitert der GESAMTE Bau:
  //
  //     [vitepress] spawn git ENOENT
  //     file: /opt/patio/docs/betrieb/arbeitsplatz.md
  //
  // Das ist am 06.08.2026 mit `23d4f9a` passiert, als `docs:build` in
  // `build:all` wanderte, und blieb 45 Commits lang unbemerkt: Die CI ruft
  // denselben Befehl, aber auf einem Runner MIT git und MIT `.git`.
  //
  // `false` gewinnt gegen die Ableitung, der Aufruf unterbleibt vollständig.
  // Der Preis ist die Zeile „Zuletzt aktualisiert" im Seitenfuss. Sie mit
  // `apt-get install git` zurückzuholen, wäre eine Täuschung: ohne Repository
  // liefert `git log` nichts, das Datum bliebe leer — gemessen — und man hätte
  // ein Paket mehr im Bau-Image für dasselbe sichtbare Ergebnis.
  lastUpdated: false,

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
        items: [
          { text: "Architektur", link: "/konzepte/architektur" },
          { text: "Die Projektnummer", link: "/konzepte/projektnummer" },
          { text: "Das Aufgabensystem", link: "/konzepte/aufgabensystem" },
          { text: "Export und Volldump", link: "/konzepte/export" },
          { text: "Neuigkeiten", link: "/konzepte/benachrichtigungen" },
          { text: "KI-Zugriff", link: "/konzepte/ki-zugriff" },
        ],
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
          { text: "Arbeitsplatz-Programm", link: "/betrieb/arbeitsplatz" },
          { text: "Board (Besprechungsraum)", link: "/betrieb/board" },
          { text: "Datenübernahme", link: "/betrieb/datenuebernahme" },
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
          // Wird aus dem laufenden Betrieb verlinkt (src/index.ts:109 gibt den
          // Pfad in der SEC-4-Warnung aus) und aus drei Doku-Seiten — stand
          // aber in keiner Navigation und war damit nur ueber Umwege auffindbar.
          { text: "Verschlüsselung umstellen", link: "/sec-4-crypto-migration" },
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

    // Hier stand `lastUpdated: { text: "Zuletzt aktualisiert" }`. Der Eintrag
    // sieht wie eine reine Beschriftung aus, schaltet die Datumsermittlung
    // aber selbst scharf (siehe Kommentar bei `lastUpdated: false` oben) — und
    // genau das hat den Docker-Bau 45 Commits lang lahmgelegt. Ohne die
    // Funktion ist die Beschriftung ohnehin wirkungslos; stehen zu bleiben
    // hiesse nur, die Falle für den Nächsten aufzustellen.

    returnToTopLabel: "Nach oben",
    sidebarMenuLabel: "Menu",
    darkModeSwitchLabel: "Darstellung",
  },
});
