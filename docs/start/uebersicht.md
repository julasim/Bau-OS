# Was ist PATIO?

PATIO ist eine Büro-Software für **Architektur-, Planungs- und
Projektsteuerungsbüros**. Sie läuft zentral auf einem Rechner im eigenen
Netz; alle Arbeitsplätze arbeiten im Browser damit.

::: warning Wichtige Abgrenzung
PATIO ist ein **Büro-Werkzeug**, nicht für die Baustelle gedacht. Zielgruppe
sind Architekten, Projektleiter, Projektsteuerer, Statiker und
Sachbearbeiter im Büro — nicht der Polier oder Maurer auf dem Gerüst.
Stundenerfassung, Bautagebuch und Meeting-Protokolle dienen der **Doku im
Büro**, in der Regel retrospektiv erfasst, nicht der Echtzeit-Eingabe von
der Baustelle.
:::

## Wie es aufgebaut ist

```
Arbeitsplätze im Büro (Browser)
            │
            ▼
      Reverse-Proxy (TLS)
            │
            ▼
   PATIO-Anwendung (Hono-API + Vue-Oberfläche)
            │
            ├──► PostgreSQL   Projekte, Notizen, Aufgaben, Termine, Team
            └──► Dateisystem  hochgeladene Dokumente
```

Zwei Container auf einem Rechner, dazu ein Reverse-Proxy. Kein Cloud-Dienst,
keine externe Schnittstelle, keine Telemetrie — die Anwendung spricht im
Betrieb ausschließlich mit ihrer Datenbank und mit den Browsern im Netz.

## Für wen?

- **Architekturbüros** für Projektsteuerung, Termine, Bauakte
- **Planungs- und Statikbüros** für die Aufgabenverteilung im Team
- **Projektsteuerer** für Bautagebuch, Meeting-Protokolle, Stundenerfassung
- **Büros mit Datenschutz-Anforderungen**, die Projektdaten nicht in eine
  Cloud geben wollen

**Nicht dafür gedacht:** Echtzeit-Bedienung von der Baustelle,
Schnelleingabe vom Gerüst, gewerbliches Personal als Bediener. Diese
Personen werden im System abgebildet (als Team-Mitglieder, in der
Stundenerfassung, im Bautagebuch), bedienen es aber nicht.

## Was es kann

| Bereich | Umfang |
|---|---|
| **Projekte** | Stammdaten, Sub-Projekte, Bauherr-Verknüpfung, Module je Projekt zuschaltbar |
| **Aufgaben & Termine** | Zuweisung an Team-Mitglieder, Kalenderansicht |
| **Notizen** | Markdown-Aktenvermerke, projektverknüpft |
| **Meetings** | Protokolle mit Action-Items, die per Klick zu Aufgaben werden |
| **Bautagebuch** | Tageseinträge mit Wetter, Personal, Vorkommnissen |
| **Stundenerfassung** | Zeiten je Projekt und Leistungsphase |
| **Leistungsphasen** | LPH mit Abhängigkeiten, Auto-Meilensteinen und Gantt-Zeitleiste |
| **Honorar** | Stundensätze, Deckungsbeitrag je Projekt |
| **Rechnungen** | Projektbezogene Rechnungsstellung |
| **Portfolio** | Übersicht über alle Projekte mit echten Fortschrittszahlen |
| **Team** | Mitglieder, Firmen, Kategorien, Kontakt-Log, vCard |
| **Dateien** | Upload, Vorschau, Projektakte |
| **Suche** | Volltext über Notizen, Aufgaben, Projekte und Dateien |
| **Exporte** | DOCX auf Basis eigener Word-Vorlagen mit Firmen-Branding |

## Datenhaltung

Alles Strukturierte liegt in PostgreSQL: Projekte, Notizen, Aufgaben,
Termine, Team, Meetings, Bautagebuch, Stunden, Phasen, Rechnungen und die
Datei-Metadaten. Hochgeladene Dokumente liegen als Dateien unter
`WORKSPACE_PATH`.

Einen Dateisystem-Modus als Alternative zur Datenbank gibt es nicht mehr —
ohne erreichbare Datenbank startet PATIO gar nicht.

## Benutzer und Rechte

Anmeldung mit Benutzerkonto, zwei Rollen: **Admin** sieht alles, **Benutzer**
sieht die Projekte, die ihm zugewiesen sind. Aufgaben, Termine und Notizen
ohne Projektbezug sind persönlich.

Details: [Zugriffskontrolle](/sicherheit/zugriff).

## Nächste Schritte

- [Schnellstart](/start/schnellstart) — lokal zum Laufen bringen
- [Architektur](/konzepte/architektur) — wie das System aufgebaut ist
- [Betrieb](/betrieb/voraussetzungen) — Server im Büro aufsetzen
