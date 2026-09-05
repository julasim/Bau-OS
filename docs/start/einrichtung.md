# Einrichtung

Was nach der Installation zu tun ist, bis das Büro arbeiten kann.

## 1. Erstes Admin-Konto

Solange weder in der Datenbank noch in `data/users.json` ein Konto steht,
zeigt die Oberfläche beim Aufruf den **Setup-Assistenten**. Er legt genau
ein Konto an, mit Admin-Rolle.

| Feld | Anforderung |
|---|---|
| Benutzername | mindestens 3 Zeichen |
| Passwort | **mindestens 12 Zeichen** |
| E-Mail-Adresse | optional, reine Kontaktinformation |

Sobald ein Konto existiert, antwortet der Assistent mit HTTP 410 und ist
damit dicht. Weitere Benutzer legt der Admin über die Benutzerverwaltung an.

::: warning Das Passwort ist der einzige Faktor
Es gibt keinen Code per E-Mail und keine Authenticator-App. Deshalb die
12 Zeichen — und deshalb gehört ein Passwort, das anderswo schon im Einsatz
ist, hier nicht hin.

Gegen Durchprobieren steht eine Ratebremse: fünf Fehlversuche je IP-Adresse
in 15 Minuten, danach 429.
:::

::: tip Immer zwei Administratoren
Ein Passwort zurücksetzen kann nur ein anderer Admin. Gibt es keinen
zweiten, hilft im Ernstfall nur der Weg über die Datenbank.
:::

## 2. Weitere Benutzer anlegen

Als Admin unter **System → Nutzer** (`/admin/users`). Je Benutzer:

- Benutzername (mindestens 3 Zeichen, eindeutig)
- Passwort (mindestens 12 Zeichen)
- E-Mail-Adresse (optional, reine Kontaktinformation)
- Anzeigename (optional)
- Rolle: **Admin** oder **Benutzer**

Das **Geld-Recht ist beim Anlegen nicht dabei** — `POST /admin/users` nimmt es
gar nicht entgegen. Neue Konten starten ohne. Freigeschaltet wird es
anschließend in der Benutzerliste über den Schalter in der Spalte **Beträge**.

::: tip Rollen
**Admin** sieht alle Projekte und darf Benutzer verwalten. **Benutzer** sieht
nur die Projekte, die ihm zugewiesen wurden — plus seine persönlichen
Aufgaben, Termine und Notizen ohne Projektbezug.
:::

::: warning Das Geld-Recht ist von den Rollen getrennt
Stundensätze, Honorare, Rechnungsbeträge und Deckungsbeiträge hängen **nicht**
an der Rolle, sondern an einem eigenen Schalter je Konto. Er ist bei neuen
Konten zu — bewusst, denn in einem Büro sollen nicht alle die Stundensätze der
Kollegen kennen.

Wer ihn nicht hat, sieht die bekannten Geldfelder in keiner Antwort: nicht im
Projekt, nicht im Portfolio, nicht in der Suche, nicht im Word-Export und nicht
über den Live-Kanal. Das wird nicht in der Oberfläche ausgeblendet, sondern
schon auf dem Server aus der Antwort entfernt. Admins haben das Recht immer.

Der Filter erkennt Geld an **Feldnamen** aus einer festen Liste — was das für
neue Felder bedeutet, steht unter
[Zugriffskontrolle](/sicherheit/zugriff).
:::

## 3. Firmen-Branding hinterlegen

Unter **Einstellungen → Branding**: Firmenname, Anschrift, Kontaktdaten und
Logo. Die Textangaben stehen allen fünf Word-Exporten als Platzhalter zur
Verfügung — Besprechungsprotokoll, Bautagebuch, Stundenzettel,
Projektübersicht und Rechnung — und erscheinen dort, wo Ihre Vorlage sie
verwendet ([Exporte](/konzepte/export)). Das Logo gehört nicht dazu: im
Programm steht es in der Navigationsleiste, in die Word-Dokumente kommt es
über Ihre eigene Vorlage. Die **Anmeldeseite zeigt kein Firmen-Branding**.

Das Logo wird über einen eigenen Endpunkt ausgeliefert
(`GET /api/branding/logo`), der ohne Anmeldung erreichbar ist — ein
`<img>`-Tag kann den Anmelde-Token nicht mitschicken. Es sollte also nichts
Vertrauliches enthalten.

## 4. Team und Firmen erfassen

Unter **Team**: Mitarbeiter des eigenen Büros sowie externe Beteiligte
(Bauherren, Fachplaner, Behördenkontakte, ausführende Firmen). Mitglieder
lassen sich Firmen und Kategorien zuordnen, Projekten mit einer Projektrolle
zuweisen und im Kontakt-Log dokumentieren.

Ein Team-Mitglied kann mit einem Benutzerkonto verknüpft werden — erst dann
lassen sich ihm Aufgaben und Termine zuweisen, die in seiner Oberfläche
auftauchen.

## 5. Projekte anlegen und freigeben

Beim Anlegen eines Projekts ist die **Projektnummer Pflicht** — sie ist die
Kennung, unter der das Projekt im ganzen Programm geführt wird
(`SAZTG-2026-014`). Sie vergeben sie selbst; PATIO erfindet keine, zeigt aber
die zuletzt vergebenen fünf zur Orientierung an. Eine bereits vergebene
Nummer wird abgelehnt.

Details: [Die Projektnummer](/konzepte/projektnummer).

Daneben werden die übrigen Stammdaten erfasst (Bauherr, Standort, Projektart,
Nutzung, Phase). Danach:

- **Module zuschalten** — welche Reiter das Projekt zeigt (Bautagebuch,
  Stunden, Rechnungen und so weiter)
- **Zugriff vergeben** — welche Benutzer das Projekt sehen. Ohne Zuweisung
  ist es für einen Benutzer nicht vorhanden; Admins sehen es immer.
- **Leistungsphasen** anlegen, mit Abhängigkeiten und Terminen

## 6. Word-Vorlagen hinterlegen (optional)

Unter **Einstellungen → Word-Export** lassen sich eigene Word-Dateien
hochladen — je Dokumentart eine Standardvorlage. PATIO füllt darin
Platzhalter wie `{Meeting.Titel}` oder `{Projekt.Bauherr}`.

::: warning „Optional" heißt nicht „geht auch ohne"
Hier stand, ohne eigene Vorlage bleibe der Export „leer". Das stimmt nicht:
**er schlägt fehl.** Der Server antwortet mit HTTP 400 und der Meldung

> Kein Default-Template für „meeting". Lade in Settings → Word-Export ein
> .docx hoch und markiere es als Standard.

Es gibt also keine mitgelieferte Rückfallvorlage. Wer den Word-Export nutzen
will, muss je Dokumentart eine Datei hochladen **und als Standard markieren** —
das Hochladen allein genügt nicht.
:::

Die verfügbaren Platzhalter listet der Endpunkt
`GET /api/export-templates/_variables`; die Oberfläche zeigt sie beim
Hochladen an.

## 7. Arbeitsplätze ausstatten

Am Arbeitsplatz läuft kein Browser, sondern `PATIO.exe`. Zu tun ist dort
zweierlei: das **Wurzelzertifikat** der internen Zertifizierungsstelle
einspielen ([Anleitung](/betrieb/zertifikat)) und das **Programm** aus dem
USB-Stick auf den Rechner kopieren ([Anleitung](/betrieb/arbeitsplatz)).

Beim ersten Start fragt es nach der Serveradresse und merkt sie sich.

## Checkliste

- [ ] Admin-Konto angelegt, Anmeldung mit Passwort getestet
- [ ] Zweiter Admin angelegt (sonst gibt es keinen Weg zurück)
- [ ] Benutzer angelegt, Rollen **und Geld-Recht** vergeben
- [ ] Branding hinterlegt
- [ ] Team-Mitglieder erfasst, Benutzerkonten verknüpft
- [ ] Erstes Projekt angelegt, Module und Zugriff gesetzt
- [ ] Wurzelzertifikat auf den Arbeitsplätzen eingespielt
- [ ] Arbeitsplatz-Programm verteilt und mit der Serveradresse verbunden
- [ ] Sicherung eingerichtet ([Anleitung](/betrieb/sicherung))
- [ ] Rücksicherung **einmal geprobt** und die Dauer notiert
