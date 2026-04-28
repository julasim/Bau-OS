# Bau-OS

Self-hosted KI-Plattform für **Architekturbüros und Büros in der
Baubranche** (Planung, Bauleitung, Projektsteuerung, Statik).

> **Wichtig:** Bau-OS ist ein **Büro-Werkzeug**, kein Baustellen-Tool. Es
> dokumentiert und organisiert das, was im Büro gebraucht wird —
> Projekte, Termine, Aufgaben, Bautagebuch, Meeting-Protokolle, Stunden-
> erfassung — und nicht die Schnell-Eingabe vom Mauerer auf dem Gerüst.

## Was es kann

- **Projekte** mit Stammdaten, Sub-Projekten, Bauherr-Verknüpfung, ACL
- **Aufgaben & Termine** mit Team-Zuweisung und Telegram-Notifications
- **Bautagebuch** (Tageseintrag pro Projekt, Wetter, Personal,
  Maschinen, Tätigkeiten, Vorkommnisse)
- **Meetings/Protokolle** (Bauherrenmeetings, Baubesprechungen,
  Behördentermine) mit Action-Items, die per 1 Klick zu Aufgaben werden
- **Stundenerfassung** pro Projekt + Mitarbeiter (rechtskonform nach
  §26 AZG / BAG-Urteil v. 13.09.2022)
- **Team-Verwaltung** mit Companies, Kategorien, Kontakt-Log, vCard
- **Dateien** mit Volltextsuche, Vorschau, Sharing
- **Telegram-Bot** pro User für unterwegs (Aufgaben anlegen, Termine
  vereinbaren, Bautagebuch eintragen via natürlicher Sprache)
- **KI-Agent** (Ollama) der via Tools das ganze System lesen + schreiben
  kann

## Deployment

Docker Compose auf eigener VM. Alle Daten bleiben beim Nutzer
(self-hosted, DSGVO).

## Tech-Stack

- Node.js + TypeScript + Hono + grammy
- PostgreSQL (postgres.js) + pgvector
- Vue 3 + Vite + Tailwind v4
- Ollama als LLM-Backend (lokal oder cloud)

## Status

Produktiv im Single-User-Betrieb (Architekturbüro Sima). Multi-User-
System komplett vorbereitet, Real-World-Tests stehen aus.
