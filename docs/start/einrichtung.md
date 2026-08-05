# Einrichtung

Was nach der Installation zu tun ist, bis das Büro arbeiten kann.

## 1. Erstes Admin-Konto

Solange weder in der Datenbank noch in `data/users.json` ein Konto steht,
zeigt die Oberfläche beim Aufruf den **Setup-Assistenten**. Er legt genau
ein Konto an, mit Admin-Rolle.

| Feld | Anforderung |
|---|---|
| Benutzername | mindestens 3 Zeichen |
| Passwort | mindestens 8 Zeichen |
| E-Mail-Adresse | Pflicht — der Login schickt den Bestätigungscode dorthin |

Sobald ein Konto existiert, antwortet der Assistent mit HTTP 410 und ist
damit dicht. Weitere Benutzer legt der Admin über die Benutzerverwaltung an.

::: warning E-Mail-Versand muss stehen
Der Login verlangt nach Benutzername und Passwort einen 6-stelligen Code per
E-Mail. Ohne konfigurierten `SMTP_HOST` wird nichts zugestellt und **niemand
kann sich anmelden**. Der SMTP-Server muss aus dem Büronetz erreichbar sein.
:::

Beim Installer `scripts/install.sh` wird das erste Admin-Konto bereits
während der Installation abgefragt und angelegt — dann entfällt dieser
Schritt.

## 2. Weitere Benutzer anlegen

Als Admin unter **Verwaltung → Benutzer**. Je Benutzer:

- Benutzername (mindestens 3 Zeichen, eindeutig)
- Passwort (mindestens 8 Zeichen)
- E-Mail-Adresse (Pflicht, für den Anmeldecode)
- Anzeigename (optional)
- Rolle: **Admin** oder **Benutzer**

::: tip Rollen
**Admin** sieht alle Projekte und darf Benutzer verwalten. **Benutzer** sieht
nur die Projekte, die ihm zugewiesen wurden — plus seine persönlichen
Aufgaben, Termine und Notizen ohne Projektbezug.
:::

## 3. Firmen-Branding hinterlegen

Unter **Einstellungen → Branding**: Firmenname, Anschrift, Kontaktdaten und
Logo. Diese Angaben laufen in die DOCX-Exporte (Meeting-Protokolle,
Bautagebuch, Stundenlisten, Projektübersichten) und erscheinen auf der
Anmeldeseite.

Das Logo wird über einen eigenen, nicht angemeldeten Endpunkt ausgeliefert,
damit `<img>`-Tags es auch auf der Anmeldeseite laden können. Es sollte also
nichts Vertrauliches enthalten.

## 4. Team und Firmen erfassen

Unter **Team**: Mitarbeiter des eigenen Büros sowie externe Beteiligte
(Bauherren, Fachplaner, Behördenkontakte, ausführende Firmen). Mitglieder
lassen sich Firmen und Kategorien zuordnen, Projekten mit einer Projektrolle
zuweisen und im Kontakt-Log dokumentieren.

Ein Team-Mitglied kann mit einem Benutzerkonto verknüpft werden — erst dann
lassen sich ihm Aufgaben und Termine zuweisen, die in seiner Oberfläche
auftauchen.

## 5. Projekte anlegen und freigeben

Beim Anlegen eines Projekts werden Stammdaten erfasst (Projektnummer,
Bauherr, Standort, Projektart, Nutzung, Phase). Danach:

- **Module zuschalten** — welche Reiter das Projekt zeigt (Bautagebuch,
  Stunden, Rechnungen und so weiter)
- **Zugriff vergeben** — welche Benutzer das Projekt sehen. Ohne Zuweisung
  ist es für einen Benutzer nicht vorhanden; Admins sehen es immer.
- **Leistungsphasen** anlegen, mit Abhängigkeiten und Terminen

## 6. Exportvorlagen hinterlegen (optional)

Unter **Einstellungen → Exportvorlagen** lassen sich eigene Word-Dateien
hochladen — je Dokumentart eine Standardvorlage. PATIO füllt darin
Platzhalter wie `{Meeting.Titel}` oder `{Projekt.Bauherr}`. Ohne eigene
Vorlage bleibt der jeweilige Export leer.

Die verfügbaren Platzhalter listet der Endpunkt
`GET /api/export-templates/_variables`; die Oberfläche zeigt sie beim
Hochladen an.

## Checkliste

- [ ] Admin-Konto angelegt, Anmeldung mit E-Mail-Code getestet
- [ ] SMTP-Versand erreichbar und erprobt
- [ ] Benutzer angelegt und Rollen vergeben
- [ ] Branding hinterlegt
- [ ] Team-Mitglieder erfasst, Benutzerkonten verknüpft
- [ ] Erstes Projekt angelegt, Module und Zugriff gesetzt
- [ ] Backup eingerichtet ([Anleitung](/betrieb/backup))
