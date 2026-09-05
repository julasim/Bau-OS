# DSGVO & Datenschutz

PATIO läuft auf einem Rechner im eigenen Netz. Die Anwendung baut im Betrieb
**keine einzige ausgehende Verbindung** auf: keine Cloud, kein Mailversand,
keine Analytik, keine Telemetrie, keine externen Schriften. Sie spricht
ausschließlich mit ihrer eigenen Datenbank, mit dem Dateisystem desselben
Rechners und mit den Arbeitsplätzen im Netz.

::: tip Was sich geändert hat
Die frühere Fassung von PATIO verarbeitete Inhalte über ein Sprachmodell
(wahlweise OpenAI oder ein lokal betriebenes) und lief über Telegram als
Transportweg. Beides ist mit dem Umbau zum Firmenserver **ersatzlos
entfallen** — nicht abgeschaltet, sondern aus dem Code entfernt. Damit
fallen OpenAI und Telegram als Empfänger personenbezogener Daten weg.
:::

::: warning Eine Schnittstelle für ein Sprachmodell gibt es wieder — ab Werk gesperrt
Seit dem 24.08.2026 kann PATIO je Projekt eine **Akte** erzeugen, die ein
Sprachmodell lesen darf. Sie ist die einzige Stelle, an der Inhalte planmäßig
aus dem Haus gehen können. Ohne sie zu nennen, wäre die frühere Zusage „kein
Sprachmodell" auf dieser Seite eine falsche Zusicherung.

PATIO ruft dafür niemanden an — die Akte wird abgeholt, nicht verschickt. Was
das für ein Verarbeitungsverzeichnis bedeutet, steht unter
[KI-Zugriff](#ki-zugriff).
:::

## Datenfluss

```
Arbeitsplatz im Büro (PATIO.exe)
        │  HTTPS, internes Netz
        ▼
PATIO auf dem Bürorechner
        ├──► PostgreSQL (derselbe Rechner)
        ├──► Dateisystem (derselbe Rechner)
```

**Ausgehende Verbindungen gibt es keine** — auch keinen Mailversand. Der
frühere Halbsatz „steht der Mailserver im Haus" ist gegenstandslos: PATIO
verschickt überhaupt keine E-Mail mehr, weder für die Anmeldung noch sonst.

**Von sich aus verlässt damit kein Datum das Gebäude.** Hinaus geht nur, was
ein Mensch holt: ein Download, ein Word- oder PDF-Export, der Volldump — oder
eine freigegebene KI-Akte.

## Welche Daten gespeichert werden

Alles Strukturierte liegt in PostgreSQL:

| Kategorie | Tabellen (Auswahl) | Inhalt |
|---|---|---|
| Fachdaten | `projects`, `notes`, `tasks`, `termine`, `meetings`, `bautagebuch`, `time_entries`, `project_phases`, `project_invoices` | Was das Büro erfasst |
| Personen | `team_members`, `companies`, `project_team_members` | Beschäftigte, Bauherren, Fachplaner, Behördenkontakte — inklusive Kontaktdaten und Kontakt-Log |
| Konten | `users`, `user_projects` | Benutzername, Anzeigename, E-Mail, Passwort-Hash, Rolle, Projektzuordnung |
| Dateien | `files`, `file_shares`, `file_stars` | Hochgeladene Dokumente samt Inhalt |
| Protokoll | `audit_log` | Anmeldungen, Kontenänderungen — und die Exporte: Volldump, Projekt-Dossier, Word-/PDF-Export, KI-Akte. Der Download einer einzelnen Datei wird nicht protokolliert |
| Steuerung | `ki_freigabe`, `ki_freigabe_projekt` | Welche Projekte und Bereiche für ein Sprachmodell freigegeben sind, und mit welcher Personendaten-Stufe |

::: info `email_otp_tokens` steht leer im Schema
Die Tabelle wurde von Migration `020` angelegt und hielt die kurzlebigen Codes
der E-Mail-Anmeldung. **Kein Codepfad schreibt oder liest sie noch** — die
E-Mail-Anmeldung ist entfallen. Sie bleibt vorerst stehen, weil Migrationen nur
vorwärts laufen und ein `DROP` unumkehrbar wäre.

Für ein Verarbeitungsverzeichnis heißt das: die Tabelle existiert, füllt sich
aber nicht mehr. Altbestände darin gehören in eine Löschprüfung.
:::

Hochgeladene Dokumente liegen samt Inhalt in der Datenbank — es gibt keine
Netzfreigabe und keinen zweiten Weg, auf dem Dateien ins System kämen. Im
Ordner unter `WORKSPACE_PATH` liegt nur noch der Altbestand aus der Vault-Zeit,
den die Anwendung ausschließlich liest; dazu kommen technische Logs in `logs/`.
Beides gehört in eine Löschprüfung.

::: warning IP-Adressen werden gespeichert
Das Audit-Log hält zu jedem Anmeldevorgang, jeder Kontenänderung und jedem
Datenabfluss (Word-/PDF-Export, Projekt-Dossier, Volldump, KI-Akte)
**IP-Adresse und User-Agent** fest — bei Anmeldung und Passwortwechsel auch
dann, wenn sie fehlschlagen.
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
  Programms bzw. Browsers, es gibt kein Session-Cookie und kein Tracking.
- **Keine Analytik.** Kein Google Analytics, kein Matomo, keine Telemetrie
  an den Hersteller.
- **Keine Nutzungsprofile**, kein Scoring, keine automatisierte
  Entscheidungsfindung im Sinne von Art. 22 DSGVO.
- **Keine Übermittlung an Dritte von sich aus.** PATIO ruft niemanden an.
  Inhalte verlassen das System nur, wenn ein Mensch sie holt: über einen
  Export, einen Download — oder über eine freigegebene KI-Akte (siehe
  [KI-Zugriff](#ki-zugriff)).

## KI-Zugriff

Seit dem 24.08.2026 kann PATIO je Projekt eine **Akte** erzeugen — eine
Zusammenfassung in lesbarem Text, ausdrücklich dafür gedacht, von einem
Sprachmodell gelesen zu werden (Migration `059`). Für den Datenschutz ist das
der wichtigste Punkt dieser Seite, deshalb hier ungeschminkt.

**Was PATIO tut:** es stellt die Akte im eigenen Netz bereit
(`GET /api/ki/dossier/:projectId`), abrufbar nur für Konten der Verwaltung.
Mehr nicht.

**Was PATIO nicht tut:** es schickt nichts. Es gibt keinen hinterlegten
Anbieter, keinen API-Schlüssel und keine ausgehende Verbindung. Wer die Akte
holt, holt sie.

**Was daraus folgt:** ob personenbezogene Daten an einen Dritten gehen,
entscheidet allein, an welches Sprachmodell die Akte gereicht wird. Läuft es
auf einem Rechner im Haus, bleibt alles im Haus. Ist es ein Cloud-Dienst, ist
das eine Übermittlung an einen Dritten — mit allem, was dazugehört:
Auftragsverarbeitungsvertrag, Eintrag im Verarbeitungsverzeichnis,
Rechtsgrundlage, gegebenenfalls Drittlandtransfer. **Diese Entscheidung nimmt
PATIO niemandem ab.**

::: tip Ab Werk gesperrt
Zwei Schalter müssen stehen, sonst entsteht keine Zeile: der Hauptschalter
unter **Einstellungen → KI-Zugriff** und mindestens ein Häkchen in der
Kreuztabelle Projekt × Bereich. Kein Eintrag heißt nicht freigegeben — ein neu
angelegtes Projekt ist damit automatisch gesperrt. Beides darf nur die
Verwaltung setzen: es ist eine Entscheidung fürs Büro, nicht die Präferenz
eines Arbeitsplatzes.

Der Stand liegt in der Datenbank und nicht in einer Datei am Arbeitsplatz. Er
ist damit für alle nachvollziehbar und überlebt eine Neuinstallation.
:::

Welche personenbezogenen Felder in der Akte landen, regelt eine von drei
Stufen, quer über alle freigegebenen Bereiche. Die genaue Feldliste steht unter
[Zugriffskontrolle](/sicherheit/zugriff#die-drei-personendaten-stufen):

| Stufe | |
|---|---|
| Keine Namen | Personen erscheinen nur als Kennung — dieselbe über alle Bereiche hinweg |
| Namen, keine Kontaktdaten *(Vorgabe)* | Namen bleiben; E-Mail, Telefon, Kontakt-Log, Stundensätze und Personal-Stunden im Bautagebuch fallen weg |
| Alle | auch die Kontaktdaten |

::: danger Freitexte werden nicht redigiert
Die Stufe wirkt auf **Felder**, nicht auf Prosa. Notiz-Inhalte, Protokolltext
und Bautagebuch-Tätigkeiten gehen unverändert in die Akte — steht dort
„Hr. Müller wünscht Sichtbeton", steht es auch bei „Keine Namen" darin.

Für ein Verarbeitungsverzeichnis heißt das: die Stufe ist eine
**Datenminimierung, keine Anonymisierung**. Wer das nicht will, gibt Notizen,
Besprechungen und Bautagebuch nicht frei.
:::

**Nachlesen statt glauben:** neben jedem Projekt steht ein Knopf **Vorschau**.
Er zeigt genau den Text, den ein Sprachmodell zu sehen bekäme — nicht mehr und
nicht weniger. Wer belegen muss, was hinausgeht, liest es dort ab. Aufbau der
Akte und die zehn Bereiche: [KI-Zugriff](/konzepte/ki-zugriff).

## Auskunft und Löschung

Alles liegt in einer Datenbank, die dem Büro selbst gehört. Auskunft und
Löschung sind damit ohne Hersteller möglich.

::: danger Löschen heißt in PATIO zunächst NICHT löschen
Seit dem Papierkorb setzt ein Löschvorgang nur eine Markierung (`deleted_at`).
Der Datensatz bleibt vollständig in der Datenbank und ist wiederherstellbar —
gewollt, weil vorher Daten unwiederbringlich verschwanden.

**Für ein Löschbegehren nach Art. 17 DSGVO genügt das nicht.** Dort ist der
zweite Schritt Pflicht:

**Papierkorb → Eintrag auswählen → endgültig entfernen.**

Erst dieser Schritt entfernt die Zeile wirklich und lässt die Kaskaden im
Schema feuern (abhängige Datensätze gehen mit). Er ist der einzige
unumkehrbare Vorgang in PATIO. Bei **Projekten** ist er der Verwaltung
vorbehalten; **Notizen, Aufgaben und Termine** darf endgültig entfernen, wer
den Eintrag im Papierkorb überhaupt sieht — bei Projektdaten also jeder
Projektbeteiligte, sonst nur der Verfasser. Das Anzeigekonto ändert wie
überall nichts.
:::

**Einzelne Person aus dem Team entfernen:** über die Oberfläche unter
**Team**. Ihre Zuordnungen zu Projekten und der Kontakt-Log gehen mit.

**Benutzerkonto löschen:** unter **Verwaltung → Benutzer**. Im Audit-Log
bleibt der Benutzername als Text stehen, während der Bezug zur Konto-ID
gelöst wird — bewusst, damit alte Einträge lesbar bleiben. Wer auch das
entfernen muss, löscht die betreffenden Audit-Zeilen direkt.

**Vollständige Löschung des Bestands:**

```bash
# Datenbank verwerfen — darin liegen auch die hochgeladenen Dokumente
docker compose down -v          # löscht auch das Datenvolume

# Altbestand im Dateiordner verwerfen (Vault-Zeit)
rm -rf /opt/patio-workspace/*

# Backups verwerfen
rm -rf /mnt/patio-backup/*
```

::: danger Backups nicht vergessen — und sie reichen weit zurück
Eine Löschung, die die Sicherungen auslässt, ist keine.

Hier stand „bis zu 14 Tage". **Das stimmt nicht mehr.** Seit der Umstellung auf
eine gestaffelte Aufbewahrung hält die Sicherung deutlich länger
(`scripts/backup.sh`, Zeilen 51–53):

| Staffel | Stände | reicht zurück bis |
|---|---|---|
| täglich | 7 | eine Woche |
| wöchentlich | 4 | ein Monat |
| monatlich | 12 | **ein Jahr** |

Ein personenbezogener Datensatz kann also bis zu **zwölf Monate** in den
Monatsständen überleben, nachdem er im laufenden Betrieb entfernt wurde. Wer
ein Löschbegehren vollständig erfüllen muss, muss das mitbedenken und
dokumentieren.

**Einen Zweitablageort gibt es nicht** — die früher hier genannte automatische
Auslagerung ist nicht umgesetzt (siehe [Sicherung](/betrieb/sicherung)). Wird
von Hand mit einer Wechselplatte gearbeitet, gehört diese ebenfalls in die
Löschung.
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
| Anbieter eines Sprachmodells | Nur wenn der KI-Zugriff freigegeben **und** die Akte an einen Cloud-Dienst gereicht wird. PATIO stellt die Akte lediglich bereit; die Wahl des Modells trifft das Büro, und mit ihr steht oder fällt die Übermittlung |

Im Auslieferungszustand ist keiner dieser Fälle gegeben: es gibt keinen
Mailversand, kein hinterlegtes Sprachmodell und keine externen Schriften.

## Technische und organisatorische Maßnahmen

| Maßnahme | Umsetzung |
|---|---|
| Zutrittskontrolle | Der Rechner steht im Büro; physischer Zugang ist zu regeln |
| Zugangskontrolle | Anmeldung mit Benutzername und Passwort (bcrypt, Kostenfaktor 12, mindestens 12 Zeichen), Ratebremse gegen Durchprobieren |
| Zugriffskontrolle | Drei Rollen (Verwaltung, Benutzer, Anzeige), Sichtbarkeit projektweise über `user_projects`. Die Anzeigerolle für den Besprechungsraum kann nichts schreiben und bekommt in den Antworten weder Beträge noch Kontaktdaten. Word-Export, PDF und Volldump (`/api/exports/*`) sind für sie gesperrt; Dateien und Datei-Treffer in der Suche bekommt sie ebenfalls nicht — Einzelheiten: [Zugriffskontrolle](/sicherheit/zugriff) |
| Trennungskontrolle | Je Büro eine eigene Installation auf eigener Hardware |
| Übertragung | HTTPS über den Reverse-Proxy; keine unverschlüsselte Verbindung im Netz |
| Verschlüsselung | AES-GCM für einzelne Datenbankfelder |
| Eingabekontrolle | Audit-Log für Anmeldungen und Kontenänderungen |
| Brute-Force-Schutz | 5 Anmeldeversuche je IP in 15 Minuten (der frühere Zusatz „5 Fehlversuche je Code" betraf die entfallene E-Mail-Anmeldung) |
| Upload-Prüfung | Endungs-Whitelist plus Magic-Byte-Prüfung |
| Zweckbindung | Geldbeträge nur für Konten mit ausdrücklichem Recht — serverseitig aus der Antwort entfernt, nicht nur ausgeblendet |
| Datenminimierung (KI) | KI-Zugriff ab Werk gesperrt, je Projekt und Bereich einzeln freizugeben, nur durch die Verwaltung; drei Stufen für personenbezogene Felder, Vorschau vor der Freigabe |
| Verfügbarkeit | Nächtliche Sicherung auf eine externe Platte, gestaffelt 7/4/12, mit Selbstprüfung. **Einen zweiten Ablageort gibt es nicht** — die Auslagerung ist nicht umgesetzt |
| Belastbarkeit | Automatischer Neustart nach Absturz, sauberes Herunterfahren bei SIGTERM |

Details: [Zugriffskontrolle](/sicherheit/zugriff) und
[Datenisolation](/sicherheit/isolation).

::: warning Kein Rechtsrat
Diese Seite beschreibt, was die Software tut und wo die Daten liegen. Sie
ersetzt keine datenschutzrechtliche Beratung und kein
Verarbeitungsverzeichnis.
:::
