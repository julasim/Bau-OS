# DSGVO & Datenschutz

PATIO läuft auf einem Rechner im eigenen Netz. Es gibt **keine
Auftragsverarbeitung durch Dritte**: kein Cloud-Dienst, kein Sprachmodell,
keine Analytik, keine Telemetrie. Die Anwendung spricht im Betrieb
ausschließlich mit ihrer eigenen Datenbank, mit den Browsern im Netz und —
Es gibt keine ausgehenden Verbindungen mehr.

::: tip Was sich geändert hat
Die frühere Fassung von PATIO verarbeitete Inhalte über ein Sprachmodell
(wahlweise OpenAI oder ein lokal betriebenes) und lief über Telegram als
Transportweg. Beides ist mit dem Umbau zum Firmenserver **ersatzlos
entfallen** — nicht abgeschaltet, sondern aus dem Code entfernt. Damit
fallen OpenAI und Telegram als Empfänger personenbezogener Daten weg.
:::

## Datenfluss

```
Arbeitsplatz im Büro (Browser)
        │  HTTPS, internes Netz
        ▼
PATIO auf dem Bürorechner
        ├──► PostgreSQL (derselbe Rechner)
        ├──► Dateisystem (derselbe Rechner)
```

**Ausgehende Verbindungen gibt es keine.** Steht der
Mailserver im Haus, verlässt kein Datum das Gebäude.

## Welche Daten gespeichert werden

Alles Strukturierte liegt in PostgreSQL:

| Kategorie | Tabellen (Auswahl) | Inhalt |
|---|---|---|
| Fachdaten | `projects`, `notes`, `tasks`, `termine`, `meetings`, `bautagebuch`, `time_entries`, `project_phases`, `project_invoices` | Was das Büro erfasst |
| Personen | `team_members`, `companies`, `project_team_members` | Beschäftigte, Bauherren, Fachplaner, Behördenkontakte — inklusive Kontaktdaten und Kontakt-Log |
| Konten | `users`, `user_projects` | Benutzername, Anzeigename, E-Mail, Passwort-Hash, Rolle, Projektzuordnung |
| Dateien | `files`, `file_shares`, `file_stars` | Hochgeladene Dokumente samt Inhalt |
| Anmeldung | `email_otp_tokens` | Kurzlebige Codes und Anmelde-Link-Tokens, gehasht |
| Protokoll | `audit_log` | Anmeldungen und Kontenänderungen |

Dazu Dateien im Dateisystem unter `WORKSPACE_PATH` sowie technische Logs in
`logs/`.

::: warning IP-Adressen werden gespeichert
Das Audit-Log hält zu jedem Anmeldevorgang und jeder Kontenänderung
**IP-Adresse und User-Agent** fest — auch bei fehlgeschlagenen Versuchen.
Das ist für die Sicherheitsanalyse gewollt und personenbezogen. Es gehört
ins Verarbeitungsverzeichnis. Aufbewahrung: `AUDIT_RETENTION_DAYS`, Standard
365 Tage; `0` schaltet die automatische Löschung ab.
:::

::: warning Keine automatische Erkennung
PATIO erkennt **nicht**, ob ein Eintrag personenbezogene oder besonders
schutzwürdige Daten enthält. Was in einer Notiz, einem Protokoll oder einem
hochgeladenen Dokument landet, verantwortet die erfassende Person.
:::

## Was nicht gespeichert wird

- **Keine Tracking-Cookies.** Das Anmelde-Token liegt im `localStorage` des
  Browsers, es gibt kein Session-Cookie und kein Tracking.
- **Keine Analytik.** Kein Google Analytics, kein Matomo, keine Telemetrie
  an den Hersteller.
- **Keine Nutzungsprofile**, kein Scoring, keine automatisierte
  Entscheidungsfindung im Sinne von Art. 22 DSGVO.
- **Keine Übermittlung an Dritte.** Es gibt keine Schnittstelle, über die
  Inhalte das System verlassen — außer den Exporten, die eine Person selbst
  auslöst.

## Auskunft und Löschung

Alles liegt in einer Datenbank, die dem Büro selbst gehört. Auskunft und
Löschung sind damit ohne Hersteller möglich.

**Einzelne Person aus dem Team entfernen:** über die Oberfläche unter
**Team**. Ihre Zuordnungen zu Projekten und der Kontakt-Log gehen mit.

**Benutzerkonto löschen:** unter **Verwaltung → Benutzer**. Im Audit-Log
bleibt der Benutzername als Text stehen, während der Bezug zur Konto-ID
gelöst wird — bewusst, damit alte Einträge lesbar bleiben. Wer auch das
entfernen muss, löscht die betreffenden Audit-Zeilen direkt.

**Vollständige Löschung des Bestands:**

```bash
# Datenbank verwerfen
docker compose down -v          # löscht auch das Datenvolume

# Dokumente verwerfen
rm -rf /opt/patio-workspace/*

# Backups verwerfen
rm -rf /opt/patio-backups/*
```

::: danger Backups nicht vergessen
Eine Löschung, die die Backups auslässt, ist keine. Die Tagesarchive halten
den Bestand bis zu 14 Tage (`RETENTION_DAYS`) — auf dem Rechner und am
Zweitablageort.
:::

## Auftragsverarbeitung

Betreibt das Büro PATIO auf eigener Hardware für eigene Zwecke, liegt keine
Auftragsverarbeitung durch den Hersteller vor — er hat keinen Zugriff auf
das System.

Ein Auftragsverarbeitungsvertrag nach Art. 28 DSGVO wird gebraucht, sobald
Dritte am System arbeiten:

| Beteiligter | Wann relevant |
|---|---|
| Externe IT-Betreuung | Wenn sie den Rechner administriert und damit Zugriff auf die Daten hat |
| Hersteller / Support | Nur wenn er zu Wartungszwecken Zugriff erhält — im Regelbetrieb nicht der Fall |
| *(keine)* | PATIO überträgt keine Daten an Dritte — kein Mailversand, kein Sprachmodell, keine externen Schriften |

::: warning Externer Mailserver ist ein Datenabfluss
## Technische und organisatorische Maßnahmen

| Maßnahme | Umsetzung |
|---|---|
| Zutrittskontrolle | Der Rechner steht im Büro; physischer Zugang ist zu regeln |
| Zugangskontrolle | Anmeldung mit Passwort (bcrypt) und Code per E-Mail |
| Zugriffskontrolle | Rollen Admin/Benutzer, Sichtbarkeit projektweise über `user_projects` |
| Trennungskontrolle | Je Büro eine eigene Installation auf eigener Hardware |
| Übertragung | HTTPS über den Reverse-Proxy; keine unverschlüsselte Verbindung im Netz |
| Verschlüsselung | AES-GCM für einzelne Datenbankfelder |
| Eingabekontrolle | Audit-Log für Anmeldungen und Kontenänderungen |
| Brute-Force-Schutz | 5 Anmeldeversuche je IP in 15 Minuten, 5 Fehlversuche je Code |
| Upload-Prüfung | Endungs-Whitelist plus Magic-Byte-Prüfung |
| Verfügbarkeit | Tägliches Backup mit Datenbank-Dump, zweiter Ablageort |
| Belastbarkeit | Automatischer Neustart nach Absturz, sauberes Herunterfahren bei SIGTERM |

Details: [Zugriffskontrolle](/sicherheit/zugriff) und
[Datenisolation](/sicherheit/isolation).

::: warning Kein Rechtsrat
Diese Seite beschreibt, was die Software tut und wo die Daten liegen. Sie
ersetzt keine datenschutzrechtliche Beratung und kein
Verarbeitungsverzeichnis.
:::
