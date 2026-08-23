# Was ist PATIO?

PATIO ist eine Büro-Software für **Architektur-, Planungs- und
Projektsteuerungsbüros**. Sie läuft zentral auf einem Rechner im eigenen Netz.
Am Arbeitsplatz steht ein **eigenes Programm** — `PATIO.exe`, mit Symbol in
der Taskleiste. Es wird als portable Datei aus dem geteilten Ordner gestartet;
einen Installer und damit einen Startmenü-Eintrag gibt es bewusst noch nicht.

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
PATIO.exe je Arbeitsplatz       Besprechungsraum: Browser, Vollbild
            │                              │
            └──────────────┬───────────────┘
                           ▼
                    Caddy (TLS, eigene lokale CA)
                           ▼
             PATIO-Anwendung (Hono-API + Vue-Oberfläche)
                           │
                           ▼
                      PostgreSQL
        Projekte, Notizen, Aufgaben, Termine, Team
        — und die hochgeladenen Dokumente selbst


   daneben, von PATIO nicht angefasst:

        Netzfreigabe „Dokumente"
        Pläne, CAD, große Scans — direkt im Explorer
```

Drei Container auf einem Rechner: Datenbank, Anwendung und der TLS-Zugang.
Kein Cloud-Dienst, keine externe Schnittstelle, keine Telemetrie — die
Anwendung spricht im Betrieb ausschließlich mit ihrer eigenen Datenbank und
mit den Arbeitsplätzen im Netz.

::: info Programm oder Browser?
Die Oberfläche ist in beiden Fällen dieselbe: `PATIO.exe` ist ein Fenster,
das sie vom Server lädt. Der Unterschied liegt in der Verpackung — kein
Adressfeld, keine Lesezeichen, kein versehentlich geschlossener Reiter.

Der Browser bleibt der Weg für den **Besprechungsraum** und als Rückfallebene,
wenn an einem Platz das Programm fehlt. Einrichtung und Verteilung:
[Arbeitsplatz-Programm](/betrieb/arbeitsplatz).
:::

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
| **Projekte** | Stammdaten, Sub-Projekte, Bauherr-Verknüpfung, Module je Projekt zuschaltbar. Die [Projektnummer](/konzepte/projektnummer) vergeben Sie, und das Projekt wird überall unter ihr geführt |
| **Aufgaben & Termine** | Zuweisung an Team-Mitglieder, Kalenderansicht |
| **[Aufgabensystem](/konzepte/aufgabensystem)** | Eingang, Matrix und Tagesplan im selben Reiter — Rang statt Priorität, Tagesbudget mit sichtbarer Auslastung |
| **Notizen** | Markdown-Aktenvermerke, projektverknüpft |
| **Meetings** | Protokolle mit Action-Items, die per Klick zu Aufgaben werden |
| **Bautagebuch** | Tageseinträge mit Wetter, Personal, Vorkommnissen |
| **Stundenerfassung** | Zeiten je Projekt und Leistungsphase |
| **Leistungsphasen** | LPH mit Abhängigkeiten, Auto-Meilensteinen und Gantt-Zeitleiste |
| **Honorar** | Stundensätze, Deckungsbeitrag je Projekt |
| **Rechnungen** | Projektbezogene Rechnungsstellung |
| **Portfolio** | Übersicht über alle Projekte mit echten Fortschrittszahlen |
| **Entscheidungen** | Entscheidungslog je Projekt: Begründung, Alternativen, Beteiligte |
| **Team** | Mitglieder, Kategorien, Kontakt-Log, vCard |
| **Firmen** | Adressbuch der Beteiligten, mit Zusammenführen von Dubletten |
| **Dateien** | Upload, Vorschau, Projektakte |
| **Suche** | Volltext über Notizen, Aufgaben, Projekte und Dateien — mit deutschen Wortstämmen |
| **Aktivität** | Was zuletzt im Büro passiert ist, über alle Datenarten |
| **[Neuigkeiten](/konzepte/benachrichtigungen)** | Was an **Sie** gerichtet ist: Zuweisungen, Termine, Besprechungen, fällige Aufgaben — mit Lesestatus |
| **Papierkorb** | Gelöschtes ist wiederherstellbar, statt sofort weg zu sein |
| **[Exporte](/konzepte/export)** | Fünf Dokumentarten aus eigenen Word-Vorlagen — Protokoll, Bautagebuch, Stundenzettel, Projektübersicht, **Rechnung** — wahlweise als PDF |
| **Volldump** | Der ganze Bestand als Markdown-Ordnerbaum: lesbar ohne PATIO |

## Datenhaltung

Alles liegt in PostgreSQL: Projekte, Notizen, Aufgaben, Termine, Team,
Meetings, Bautagebuch, Stunden, Phasen, Rechnungen — **und die hochgeladenen
Dokumente selbst**, als Binärinhalt in der Tabelle `files`. Auf der Platte
landet dabei nichts.

`WORKSPACE_PATH` zeigt auf die **Netzfreigabe** „Dokumente" und ist eine
andere Sache (siehe Kasten unten).

Einen Dateisystem-Modus als Alternative zur Datenbank gibt es nicht mehr —
ohne erreichbare Datenbank startet PATIO gar nicht.

::: warning Zwei Ablagen, die man nicht verwechseln darf
Es gibt **zwei getrennte Orte** für Dateien, und die Unterscheidung ist im
Alltag wichtig:

- **Die Netzfreigabe „Dokumente"** ist ein ganz normaler Netzordner im
  Explorer — für Pläne, CAD-Dateien und große Scans. Die Anwendung fasst ihn
  nicht an.
- **In PATIO Hochgeladenes** liegt in der Datenbank, mit Projektbezug,
  Rechteprüfung und Volltextsuche.

Eine Datei in PATIO zu löschen berührt die Freigabe nicht, und umgekehrt.
Details: [Netzfreigabe](/betrieb/freigabe).
:::

## Benutzer und Rechte

Anmeldung mit Benutzername und Passwort, zwei Rollen: **Admin** sieht alles,
**Benutzer** sieht die Projekte, die ihm zugewiesen sind. Aufgaben, Termine und
Notizen ohne Projektbezug sind persönlich — sie gehören dem, der sie angelegt
hat.

Daneben gibt es ein eigenes Recht für **Geldbeträge** (Stundensätze, Honorare,
Rechnungssummen, Deckungsbeiträge). Es ist standardmäßig **zu** und wird je
Konto freigegeben. Wer es nicht hat, bekommt diese Beträge in keiner Antwort —
auch nicht über Suche, Export oder Live-Kanal. Sie werden serverseitig aus der
Antwort entfernt, nicht nur ausgeblendet.

Details: [Zugriffskontrolle](/sicherheit/zugriff).

## Wenn zwei gleichzeitig arbeiten

Die bearbeitbaren Datensätze tragen einen Änderungszähler: **Notizen,
Aufgaben, Termine, Besprechungen, Projekte, Team, Leistungsphasen, Rechnungen,
Stunden, Entscheidungen und der Positionskatalog** — elf Tabellen.

Speichert jemand einen Stand, den ein Kollege inzwischen geändert hat, wird der
Vorgang **abgelehnt** statt still zu überschreiben — die
Oberfläche lädt dann den aktuellen Stand nach und sagt, was passiert ist.
Früher gewann schlicht der Letzte, ohne Hinweis.

::: warning Wo der Schutz NICHT greift
**Bautagebuch-Einträge, Dateien und die bürointerne Konfiguration** haben
keinen Zähler. Dort gilt weiterhin: der Letzte gewinnt. Für Tageseinträge, an
denen selten zwei Personen gleichzeitig arbeiten, ist das vertretbar — man
sollte es nur wissen.
:::

## Nächste Schritte

- [Schnellstart](/start/schnellstart) — lokal zum Laufen bringen
- [Architektur](/konzepte/architektur) — wie das System aufgebaut ist
- [Betrieb](/betrieb/voraussetzungen) — Server im Büro aufsetzen
