<script setup lang="ts">
import BIcon from "../components/BIcon.vue";

interface DocCard {
  icon: string;
  title: string;
  desc: string;
  href: string;
  tag?: string;
}

interface Tutorial {
  icon: string;
  title: string;
  desc: string;
  steps: string[];
  tag?: string;
}

const quickLinks: DocCard[] = [
  {
    icon: "zap",
    title: "Schnellstart",
    desc: "In 10 Minuten einsatzbereit — Bot-Token, LLM, Workspace.",
    href: "https://docs.bau-os.de/start/schnellstart",
    tag: "Start",
  },
  {
    icon: "layers",
    title: "Architektur",
    desc: "5-Schichten-Architektur, Datenfluss und Modulstruktur.",
    href: "https://docs.bau-os.de/konzepte/architektur",
    tag: "Konzept",
  },
  {
    icon: "list",
    title: "Tool-Referenz",
    desc: "Alle 56 Tools in 12 Kategorien mit Parametern und Beispielen.",
    href: "https://docs.bau-os.de/referenz/tools",
    tag: "Referenz",
  },
  {
    icon: "cpu",
    title: "Agenten",
    desc: "Agenten konfigurieren, spawnen und per Markdown steuern.",
    href: "https://docs.bau-os.de/konzepte/agenten",
    tag: "Konzept",
  },
  {
    icon: "settings",
    title: "Konfiguration",
    desc: "Alle .env-Variablen, Befehle und Modell-Optionen.",
    href: "https://docs.bau-os.de/konfiguration/env",
    tag: "Referenz",
  },
  {
    icon: "lock",
    title: "DSGVO & Sicherheit",
    desc: "Datenschutz, TOMs, Isolations-Konzept und sichere Defaults.",
    href: "https://docs.bau-os.de/sicherheit/dsgvo",
    tag: "Sicherheit",
  },
];

const tutorials: Tutorial[] = [
  {
    icon: "file",
    title: "Erste Notiz anlegen",
    desc: "Schreib eine Nachricht an den Bot — er speichert automatisch.",
    tag: "Notizen",
    steps: [
      "Öffne Telegram und schreibe deinem Bot.",
      'Sage z.B. „Notiz: Besprechung mit Bauherrn am Freitag."',
      "Der Bot ruft notiz_speichern auf und bestätigt.",
      "In der Web-UI unter Notizen erscheint die Notiz sofort.",
    ],
  },
  {
    icon: "check",
    title: "Aufgabe delegieren",
    desc: "Aufgaben mit Fälligkeit und Projekt-Bezug anlegen.",
    tag: "Aufgaben",
    steps: [
      'Schreibe: „Aufgabe bis Donnerstag: Leistungsverzeichnis für Projekt Müller fertig."',
      "Der Bot erkennt die Aktion und ruft aufgabe_speichern auf.",
      "In der Web-UI unter Aufgaben erscheint die Aufgabe mit Datum.",
      'Zum Abhaken: „Aufgabe Leistungsverzeichnis ist erledigt."',
    ],
  },
  {
    icon: "calendar",
    title: "Termin anlegen",
    desc: "Termine mit Uhrzeit, Ort und Teilnehmern erfassen.",
    tag: "Kalender",
    steps: [
      'Schreibe: „Termin: Baustellenbegehung morgen 9 Uhr, Baustelle Graz."',
      "Der Bot parst Datum, Uhrzeit und Ort automatisch.",
      "Termin erscheint im Kalender der Web-UI.",
      'Optional: „Wer hat morgen einen Termin?" — der Bot listet alle Treffen.',
    ],
  },
  {
    icon: "folder",
    title: "Projekt anlegen",
    desc: "Strukturierte Projekte mit Stammdaten erstellen.",
    tag: "Projekte",
    steps: [
      'Sage: „Neues Projekt: Umbau Villa Steiner, Projektnummer 2024-47, Bauherr Familie Steiner."',
      "Der Bot legt das Projekt mit allen Stammdaten an.",
      "In der Web-UI unter Projekte erscheint das neue Projekt.",
      "Notizen, Aufgaben und Termine können dem Projekt zugeordnet werden.",
    ],
  },
  {
    icon: "search",
    title: "Semantisch suchen",
    desc: "Inhalte nach Bedeutung finden — nicht nur per Keyword.",
    tag: "Suche",
    steps: [
      "Voraussetzung: PostgreSQL + pgvector installiert und DATABASE_URL gesetzt.",
      'Sage: „Suche alles über Fassadendämmung."',
      "Der Bot verwendet semantisch_suchen mit Vektor-Embeddings.",
      "Ergebnisse werden nach inhaltlicher Nähe gerankt, nicht nach Texttreffer.",
    ],
  },
  {
    icon: "zap",
    title: "Dynamic Tool erstellen",
    desc: "Eigene Tools per Telegram ohne Code-Deploy anlegen.",
    tag: "Erweitert",
    steps: [
      'Sage: „Erstelle ein Tool namens wetter das die aktuelle Temperatur in Wien abruft."',
      "Der Bot legt tools/wetter/tool.json + run.js automatisch an.",
      "Das Tool steht im nächsten LLM-Aufruf sofort zur Verfügung.",
      'Teste es: „Wie ist das Wetter in Wien?"',
    ],
  },
];

function openLink(href: string) {
  window.open(href, "_blank", "noopener,noreferrer");
}
</script>

<template>
  <div class="docs-root">
    <!-- Header -->
    <div class="docs-header">
      <h1 class="docs-title">Dokumentation</h1>
      <p class="docs-subtitle">
        Referenzen, Konzepte und Tutorials zu Bau-OS.
      </p>
    </div>

    <!-- Quick Links -->
    <section class="docs-section">
      <h2 class="settings-h3 mb-4">Dokumentation</h2>
      <div class="docs-grid">
        <button
          v-for="card in quickLinks"
          :key="card.title"
          class="docs-card"
          @click="openLink(card.href)"
        >
          <div class="docs-card-top">
            <div class="docs-card-icon">
              <BIcon :name="card.icon" :size="16" />
            </div>
            <span v-if="card.tag" class="docs-tag">{{ card.tag }}</span>
          </div>
          <div class="docs-card-title">{{ card.title }}</div>
          <div class="docs-card-desc">{{ card.desc }}</div>
          <div class="docs-card-arrow">
            <BIcon name="arrowUpRight" :size="13" />
          </div>
        </button>
      </div>
    </section>

    <!-- Tutorials -->
    <section class="docs-section">
      <h2 class="settings-h3 mb-4">Tutorials</h2>
      <div class="docs-tutorials">
        <div
          v-for="tut in tutorials"
          :key="tut.title"
          class="docs-tutorial-card"
        >
          <div class="docs-tutorial-head">
            <div class="docs-card-icon">
              <BIcon :name="tut.icon" :size="15" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="docs-tutorial-title">{{ tut.title }}</div>
              <div class="docs-tutorial-desc">{{ tut.desc }}</div>
            </div>
            <span v-if="tut.tag" class="docs-tag">{{ tut.tag }}</span>
          </div>
          <ol class="docs-steps">
            <li v-for="(step, i) in tut.steps" :key="i" class="docs-step">
              <span class="docs-step-num">{{ i + 1 }}</span>
              <span class="docs-step-text">{{ step }}</span>
            </li>
          </ol>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.docs-root {
  max-width: 880px;
  margin: 0 auto;
  padding: 32px 24px 64px;
}

.docs-header {
  margin-bottom: 32px;
}

.docs-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: -0.01em;
}

.docs-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  margin-top: 4px;
}

.docs-section {
  margin-bottom: 40px;
}

/* ── Quick Link Grid ─────────────────────────────────────────────────────── */
.docs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.docs-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  text-align: left;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease;
}

.docs-card:hover {
  border-color: var(--color-text-muted);
  background: var(--color-bg-subtle);
}

.docs-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.docs-card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  background: var(--color-border-subtle);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.docs-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.docs-card-desc {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.docs-card-arrow {
  position: absolute;
  top: 14px;
  right: 14px;
  color: var(--color-text-tertiary);
  opacity: 0;
  transition: opacity 140ms ease;
}

.docs-card:hover .docs-card-arrow {
  opacity: 1;
}

.docs-tag {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary);
  background: var(--color-border-subtle);
  padding: 2px 7px;
  border-radius: 9999px;
}

/* ── Tutorials ───────────────────────────────────────────────────────────── */
.docs-tutorials {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.docs-tutorial-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  overflow: hidden;
}

.docs-tutorial-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
}

.docs-tutorial-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.docs-tutorial-desc {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 2px;
}

.docs-steps {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  list-style: none;
  margin: 0;
}

.docs-step {
  display: flex;
  gap: 10px;
  align-items: baseline;
}

.docs-step-num {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 9999px;
  background: var(--color-border-subtle);
  color: var(--color-text-tertiary);
  font-size: 10px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.docs-step-text {
  font-size: 12.5px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

/* ── SettingsView shared classes ─────────────────────────────────────────── */
.settings-h3 {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-text-tertiary);
}
</style>
