# PATIO

Self-hosted KI-Büro-Software für **Architektur-, Planungs- und
Projektsteuerungsbüros** (Planung, Statik, Bauphysik, Projektsteuerung).

> **Wichtig:** PATIO ist ein **Büro-Werkzeug für die Planung**, kein
> Baustellen-Tool. Es dokumentiert und organisiert, was im Büro gebraucht
> wird — Projekte, Termine, Aufgaben, Notizen, Akten, Protokolle — und
> richtet sich an Menschen am Schreibtisch, nicht an die Baustelle.

> **Name:** PATIO = **P**lan · **A**rchitektur · **T**ermine · **I**ntelligenz
> · **O**ffice — und zugleich der architektonische Begriff für den Innenhof.
> Der Repo-Ordner heißt aus historischen Gründen noch `bau-os/`.

## Was es kann

- **Projekte** mit Stammdaten, Sub-Projekten, Bauherr-Verknüpfung, ACL
- **Aufgaben & Termine** mit Team-Zuweisung und Telegram-Notifications
- **Notizen** — Markdown-Aktenvermerke, projektverknüpft, durchsuchbar
  (Volltext + semantisch via pgvector)
- **Meetings/Protokolle** (Bauherrentermine, Behördentermine) mit
  Action-Items, die per Klick zu Aufgaben werden — Export nach DOCX
- **Bautagebuch** & **Stundenerfassung** als Büro-Doku-Werkzeuge
  (rechtskonform nach §26 AZG / BAG-Urteil v. 13.09.2022)
- **Team-Verwaltung** mit Companies, Kategorien, Kontakt-Log, vCard
- **Dateien** mit Volltextsuche, Vorschau, Sharing — die digitale
  Projektakte
- **Telegram-Bot** pro User für unterwegs (Aufgaben, Termine, Notizen via
  natürlicher Sprache)
- **Web-App** (Vue 3) als visueller Workspace: Dashboard, Listen, Kalender,
  Projektakten, Agenten-Editor
- **KI-Agenten** — konfigurierbar als Markdown-Dateien, lesen + schreiben
  via Tools das ganze System; LLM-Backend wahlweise OpenAI oder lokales
  Ollama

## Deployment

Docker Compose auf eigener VM. Alle Daten bleiben beim Nutzer
(self-hosted, DSGVO-konform, kein Cloud-Zwang).

## Tech-Stack

- Node.js + TypeScript + Hono + grammY
- PostgreSQL (postgres.js) + pgvector
- Vue 3 + Pinia + Vite + Tailwind v4
- LLM-Backend: OpenAI (`OPENAI_API_KEY`) oder lokales Ollama

## Status

Pre-Launch. Produktiv im Single-User-Betrieb erprobt; Multi-User-System
komplett vorbereitet. Erster vertraulicher Testlauf mit einem
Architekturbüro ab Mai 2026.

---

*Ein Produkt von Julius Sima — „by Sima".*
