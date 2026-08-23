# Board für den Besprechungsraum

> **In einem Satz:** Ein Bildschirm an der Wand zeigt, was heute im Haus los
> ist — und kann nichts ändern, keine Beträge zeigen und keine Kontaktdaten.

## Einrichten

**1. Ein Konto für das Gerät anlegen** — Verwaltung → Nutzer → Neu, Rolle
**Präsentation**.

**2. Am Gerät anmelden** und `/board` aufrufen.

```
https://patio.<ihre-domain>/board
https://patio.<ihre-domain>/board?rotieren=25
```

`?rotieren=<Sekunden>` wechselt selbsttätig durch die vier Ansichten. Ohne den
Parameter bleibt das Board stehen — für einen Bildschirm neben dem
Besprechungstisch ist das meist richtig: dort will man lesen, nicht
hinterherschauen.

## Die vier Ansichten

| | Zeigt |
|---|---|
| **Heute** | Termine des Tages über alle Personen, dazu was auf den Baustellen läuft |
| **Offene Aufgaben** | über alle Personen, nach Rang sortiert |
| **Projekte** | Phase, Standort, Status, offene Aufgaben |
| **Diese Woche** | die nächsten sieben Tage, nach Tag gruppiert |

::: tip Warum eigene Ansichten und nicht die vorhandenen
Dashboard und Aufgabenreiter filtern auf **Sie** — sie beantworten „was habe
ich zu tun". Ein Gerät im Besprechungsraum ist niemandem zugewiesen und sähe
überall leere Listen. Das Board beantwortet die andere Frage: „was ist heute im
Haus los".

Dazu kommt die Lesbarkeit: der Kalender misst 1477 Zeilen und ist auf Maus und
Detailtiefe gebaut. Auf fünf Meter Entfernung ist davon nichts lesbar.
:::

## Was die Rolle „Präsentation" bedeutet

Sie ist eine **Beschränkung**, kein Zugangsschlüssel.

| | |
|---|---|
| **Schreiben** | gar nicht. Jede Anfrage außer Lesen wird abgewiesen |
| **Beträge** | nie — auch dann nicht, wenn jemand das Geld-Recht am Konto setzt |
| **Kontaktdaten** | keine E-Mail, keine Telefonnummer, kein Kontakt-Log |
| **Projekte** | alle. Ein Board, das nur einen Ausschnitt zeigt, wäre irreführend |

::: danger Warum das im Server steht und nicht in der Anzeige
Als „Administrator mit ausgeblendeten Feldern" gebaut wäre das keine Rolle,
sondern eine Verkleidung: die Daten gingen weiterhin über die Leitung, und ein
Blick in die Entwicklerwerkzeuge des Browsers zeigte sie.

Der Schreibschutz ist **eine** Middleware vor allen Routen — nicht 94 einzelne
Prüfungen. Bei 94 Prüfungen wird die 95. vergessen; genau so sind die
siebzehn Rechte-Lücken entstanden, die im August geschlossen wurden.
:::

**Der Name bleibt sichtbar.** Ohne ihn wäre das Board leer: „zugewiesen an",
„anwesend laut Bautagebuch" — überall steht ein Name, und er ist genau die
Information, wegen der das Gerät im Raum hängt. Die Abwägung ist bewusst: ein
Name ist im Besprechungsraum ohnehin bekannt, eine Privatnummer nicht.

## Betrieb

Das Board holt sich die Daten alle zwei Minuten selbst. Es hält **keine**
dauerhafte Verbindung: an einem Gerät, das nachts durchläuft, wäre eine
Verbindung, die niemand wieder aufbaut, eine Fehlerquelle mehr.

::: warning Ein Gerätekonto lässt sich nicht sperren
PATIO kennt kein „deaktiviert" — nur Löschen. Geht das Gerät verloren oder
verlässt es den Raum, muss das Konto unter **Verwaltung → Nutzer** gelöscht
werden. Das Passwort danach nicht wiederverwenden.
:::
