# Neuigkeiten und Aktivität

> **In einem Satz:** Die Aktivität sagt „im Büro ist etwas passiert" — die
> Neuigkeiten sagen „**Ihnen** wurde etwas zugewiesen".

Das ist kein Wortspiel, sondern der ganze Unterschied. Das eine ist eine
Übersicht, das andere eine Adressierung. Und nur die zweite darf man
verpassen.

| | Aktivität | Neuigkeiten |
|---|---|---|
| Zeigt | alles im Büro, was Sie sehen dürfen | nur, was an Sie gerichtet ist |
| Lesestatus | keiner | je Person |
| Entsteht | abgeleitet aus den Datensätzen | als eigener Eintrag beim Auslösen |

## Wovon es eine Meldung gibt

| Anlass | Wann |
|---|---|
| **Aufgabe zugewiesen** | Eine Aufgabe wird Ihnen zugewiesen — beim Anlegen oder beim Ändern |
| **Heute fällig** | Eine Ihnen zugewiesene Aufgabe ist heute fällig (einmal, im nächtlichen Lauf) |
| **Termin** | Sie werden als Teilnehmer eingetragen |
| **Besprechung** | Sie werden als Teilnehmer eingetragen |

Vier Anlässe, nicht vierzig. Alles andere ist Aktivität — eine Glocke, die bei
jeder Änderung im Haus aufleuchtet, wird nach zwei Tagen ignoriert.

::: tip Wer sich selbst etwas zuweist, bekommt keine Meldung
Sonst wäre die Liste nach einer halben Stunde Arbeit voll mit dem, was man
gerade selbst getan hat.
:::

Abschaltbar je Person und je Anlass unter **Einstellungen → Präferenzen →
Benachrichtigungen**. Die Voreinstellung ist „an": eine Meldung, die niemand
bestellt hat, ist besser als eine verpasste Zuweisung.

## Warum es dafür eine eigene Tabelle braucht

Es gab schon zwei Dinge, die danach aussahen. Beide taugen nicht dafür:

- **Der Live-Kanal** (Server-Sent Events) ist ein Set im Arbeitsspeicher ohne
  Speicher und ohne Nachliefern. Wer im Moment der Änderung nicht verbunden
  war — Mittagspause, Termin, Feierabend —, erfährt sie nie. Er taugt als
  **Auslöser**, nicht als Gedächtnis.
- **Die Aktivität** ist bewusst *abgeleitet*: sie liest die Datensätze selbst.
  Genau deshalb kann sie keinen Lesestatus je Person tragen — es gibt keine
  Zeile, an der ein „gesehen" hängen könnte.

## Der Name des Auslösers steht in der Meldung

Nicht ein Verweis auf das Konto, sondern der **Name als Text**.

::: warning Die Lehre aus dem Prüfprotokoll
Im Audit-Log steht die Benutzer-ID. Nach dem Löschen eines Kontos stand in den
Einträgen nichts mehr — aus „Anna Berger hat …" wurde eine leere Stelle.

Eine Meldung beschreibt einen Moment in der Vergangenheit. Der ändert sich
nicht, wenn jemand später heiratet oder das Büro verlässt. Der Preis ist eine
Kopie des Namens, und die ist hier richtig.
:::

## Aufräumen

**Gelesene** Meldungen werden nach 60 Tagen entfernt
(`MELDUNGEN_AUFBEWAHREN_TAGE`, `0` schaltet es ab).

**Ungelesene bleiben — immer.** Eine Meldung, die niemand gesehen hat,
verschwindet nicht, nur weil sie alt ist. Genau das unterscheidet sie vom
flüchtigen Live-Kanal.

## Was es (noch) nicht gibt

**Keine Meldung außerhalb des Programms.** Kein E-Mail-Versand — der Server
hat kein Internet und keinen erreichbaren Mailserver. Keine Windows-Meldung am
Arbeitsplatz; das Arbeitsplatz-Programm kann sie technisch, es fehlt der Weg
vom Server dorthin.

Was es gibt, ist die Glocke in der Navigationsleiste mit der Zahl der
ungelesenen Meldungen.
