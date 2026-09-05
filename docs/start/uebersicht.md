# Was ist PATIO?

PATIO ist eine Büro-Software für **Architektur-, Planungs- und
Projektsteuerungsbüros**. Sie läuft zentral auf einem Rechner im eigenen Netz.
Am Arbeitsplatz steht ein **eigenes Programm** — `PATIO.exe`, mit Symbol in
der Taskleiste. Es ist eine portable Datei, die einmal auf den Rechner kopiert
wird; einen Installer und damit einen Startmenü-Eintrag gibt es bewusst noch
nicht.

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
| **[Board](/betrieb/board)** | Bildschirm für den Besprechungsraum: heute, Aufgaben, Projekte, Woche — ohne Beträge und Kontaktdaten |
| **[KI-Zugriff](/konzepte/ki-zugriff)** | Je Projekt eine Akte für ein Sprachmodell — freigegeben bis auf die Kategorie genau, mit Vorschau |
| **Papierkorb** | Gelöschte Projekte, Notizen, Aufgaben und Termine lassen sich zurückholen; alles Übrige ist mit dem Löschen endgültig weg |
| **[Exporte](/konzepte/export)** | Fünf Dokumentarten aus eigenen Word-Vorlagen — Protokoll, Bautagebuch, Stundenzettel, Projektübersicht, **Rechnung** — wahlweise als PDF |
| **Volldump** | Der ganze Bestand als Markdown-Ordnerbaum: lesbar ohne PATIO |

## So ist die Oberfläche aufgebaut

Links steht die **Navigationsleiste** — der Weg durch das Programm: Dashboard,
Neuigkeiten, Aufgaben, Kalender, Projekte, Portfolio, Notizen, Dateien, Team,
Firmen, Aktivität, Papierkorb. Darunter ein zweiter Block, den nur die
Verwaltung sieht: Nutzer, Audit-Log, Sicherung. Ganz unten Einstellungen und
Abmelden.

In der **Projektakte** und in den **Einstellungen** kommt eine zweite Leiste
dazu. Sie trägt dort die Reiter des Projekts (Übersicht, Phasen, Termine,
Aufgaben, Rechnungen, Stunden, Notizen, Bautagebuch, Meetings, Entscheidungen,
Dateien, Team, Zugriff) beziehungsweise die Bereiche der Einstellungen. Die
erste Leiste schrumpft dafür auf Symbolbreite:

```
┌────┬──────────────┬──────────────────────────────────┐
│ ▣  │  Projekt     │                                  │
│ ☑  │  ─────────   │   Der Reiter, den Sie gewählt    │
│ 📅 │  Übersicht   │   haben                          │
│ ▤  │  Phasen      │                                  │
│ ▦  │  Termine     │                                  │
│ ✎  │  Aufgaben    │                                  │
│    │              │                                  │
│60px│    238px     │            der Rest              │
└────┴──────────────┴──────────────────────────────────┘
```

Die zweite Leiste zeigt **nur, was Ihr Konto auch öffnen darf**. In der
Projektakte setzt „Rechnungen" das Recht voraus, Beträge zu sehen, und
„Zugriff" ist Sache der Verwaltung. In den Einstellungen gilt dasselbe:
Branding, Vorlagen, Word-Export, Projekt-Module und KI-Zugriff sieht nur die
Verwaltung, den Positionskatalog nur, wer Beträge sehen darf. Ein Eintrag, der
beim Klick nur eine Fehlermeldung öffnet, gehört nicht in die Navigation.

::: tip Bereiche sind verlinkbar
Der geöffnete Einstellungs-Bereich steht in der Adresse — etwa
`…/settings?sektion=word-export`. So lässt sich ein Link auf eine bestimmte
Stelle weitergeben. Dasselbe gilt in der Projektakte über `?tab=`.

Vorher merkte sich der Browser den zuletzt geöffneten Bereich lokal. Das hatte
zwei Nachteile: ein Link darauf ließ sich nicht weitergeben, und wer sich einen
Rechner teilt, landete im Bereich des Vorgängers.
:::

Auf **Handy und Tablet** liegen beide Leisten als Überblendung über dem Inhalt
und werden über die zwei Schaltflächen oben links geöffnet.

## Datenhaltung

Alles liegt in PostgreSQL: Projekte, Notizen, Aufgaben, Termine, Team,
Meetings, Bautagebuch, Stunden, Phasen, Rechnungen — **und die hochgeladenen
Dokumente selbst**, als Binärinhalt in der Tabelle `files`. Auf der Platte
landet dabei nichts.

Einen Dateisystem-Modus als Alternative zur Datenbank gibt es nicht mehr —
ohne erreichbare Datenbank startet PATIO gar nicht.

::: info Eine Ablage, nicht zwei
Dateien kommen **ausschließlich über PATIO selbst** herein: hochladen in der
Oberfläche, danach mit Projektbezug, Rechteprüfung und Volltextsuche. Einen
zweiten Weg — einen Netzordner, den man im Explorer öffnet und in den man
Dateien legt — gibt es bewusst nicht. Damit gibt es auch keinen Bestand, von
dem PATIO nichts weiß.

Der Dienst braucht weiterhin ein Verzeichnis (`WORKSPACE_PATH`, im Container
`/workspace`) und startet ohne die Angabe nicht. Das ist aber ein rein
**interner Ordner**: Nur der Dienst sieht ihn, von den Arbeitsplätzen aus ist
er nicht erreichbar. Darin liegt Altbestand aus der Vault-Zeit — Dateien, die
vor der Umstellung auf die Datenbank angelegt wurden. Findet PATIO zu einem
Eintrag keinen Inhalt in der Datenbank, liest es ihn von dort. Die nächtliche
Sicherung nimmt den Ordner mit.
:::

## Benutzer und Rechte

Anmeldung mit Benutzername und Passwort. **Admin** sieht alles, **Benutzer**
sieht die Projekte, die ihm zugewiesen sind. Aufgaben, Termine und Notizen ohne
Projektbezug sind persönlich: eine Notiz sieht nur, wer sie angelegt hat; eine
Aufgabe zusätzlich die zugewiesene Person, einen Termin zusätzlich die
eingetragenen Teilnehmer.

Dazu kommt eine dritte Rolle **Präsentation** — für den Bildschirm im
Besprechungsraum. Sie ist eine Beschränkung, kein Zugangsschlüssel: nur lesen,
nie Beträge, keine Kontaktdaten. Details: [Board](/betrieb/board).

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
