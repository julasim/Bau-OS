# Arbeitsplatz-Programm

Am Arbeitsplatz läuft kein Browser, sondern ein eigenes Programm: `PATIO.exe`,
mit Symbol in der Taskleiste. Es ist eine schlanke Hülle um dieselbe
Oberfläche, die der Server ausliefert — kein Adressfeld, keine Lesezeichen,
kein versehentlich geschlossener Reiter.

::: info Was das Programm NICHT ist
Es bringt keine eigenen Daten und keinen eigenen Server mit. Es hält keine
Kopie der Projekte vor. Ohne Verbindung zum Firmenserver zeigt es eine
Erklärung und sonst nichts — **Offline-Arbeiten ist nicht vorgesehen.**
:::

## Verteilung

Es gibt keinen Update-Dienst und keinen Installer — die Datei wird von Hand
auf die Arbeitsplätze gebracht.

::: warning Der frühere Weg über die Netzfreigabe ist entfallen
Hier stand `\\<server>\Dokumente\_Programm\…`. Diese Freigabe gibt es seit
dem 29.08.2026 nicht mehr: Dateien kommen ausschließlich über PATIO selbst
herein, und einen Netzordner zum Ablegen gibt es damit nicht.
:::

In der Praxis derselbe Weg, der ohnehin schon zweimal gebraucht wird — der
USB-Stick, auf dem das Auslieferungspaket und das Wurzelzertifikat liegen:

```
PATIO-Arbeitsplatz-<version>-portable.exe
```

Datei auf den Rechner kopieren, Verknüpfung anlegen, fertig. Es gibt kein
Installationsverzeichnis und keinen Startmenü-Eintrag.

Eine neue Fassung ersetzt die Datei — **an jedem Platz einzeln**. Wer eine
Kopie auf dem eigenen Rechner hat, bekommt eine neue Fassung sonst gar nicht
mit. Bei acht Plätzen ist das überschaubar, aber es muss jemand anstoßen.

Das Programm ist mit `CN=Julius Sima` signiert. Weil es sich um ein
selbstsigniertes Zertifikat handelt, kann Windows beim ersten Start eine
SmartScreen-Warnung zeigen — über *Weitere Informationen → Trotzdem ausführen*.

::: warning Vorerst nur die portable Fassung
Ein Installer wird bewusst noch nicht ausgeliefert: NSIS leitet das
Installationsverzeichnis aus dem Produktnamen ab, und der ist derselbe wie bei
**PATIO Desktop** (dem älteren, dateibasierten Einzelplatzprogramm). Ein
Installer liefe damit über eine bestehende Installation. Solange beide
Programme nebeneinander bestehen, bleibt es bei der portablen Datei.
:::

## Erster Start

1. Programm starten.
2. Es fragt nach der **Serveradresse**, z. B. `patio.sima.intern`.
   Ohne `https://` davor wird eine verschlüsselte Verbindung angenommen.
3. Das Programm prüft die Adresse, bevor es sie übernimmt. Antwortet dort ein
   PATIO-Server, wird sie gemerkt und die Oberfläche geladen.

Ab dem zweiten Start geht es ohne Zwischenschritt direkt hinein.

Die Adresse lässt sich später über **Datei → Server wechseln…** ändern; unter
**Zuletzt verwendet** stehen die letzten acht.

::: tip Adresse zentral vorgeben
Ist die Umgebungsvariable `PATIO_SERVER` gesetzt (etwa per Gruppenrichtlinie),
nimmt das Programm sie beim ersten Start automatisch. Sie wird **nicht**
gespeichert — eine spätere Änderung durch die Verwaltung greift damit sofort,
statt von einem einmal gemerkten Wert überstimmt zu werden.

Reihenfolge: gemerkte Adresse → `PATIO_SERVER` → Nachfrage.
:::

## Das Zertifikat gehört vorher eingespielt

Der Server weist sich mit einem Zertifikat aus der **eigenen lokalen
Zertifizierungsstelle** aus. Solange deren Wurzelzertifikat auf dem
Arbeitsplatz fehlt, verweigert das Programm die Verbindung — genau wie ein
Browser es täte.

Das ist beabsichtigt: Zertifikatsfehler werden **nicht** übergangen. Das
Programm zeigt dann eine verständliche Meldung mit Verweis auf die
[Anleitung zum Zertifikat](/betrieb/zertifikat), statt die Warnung
wegzuklicken. Eine Warnung, die man wegklicken kann, gewöhnen sich Leute an —
und dann schützt sie nichts mehr.

::: danger Auf einem echten Arbeitsplatz noch nicht nachgemessen
Dass Windows-Chromium für lokal installierte Wurzelzertifikate den
System-Speicher nutzt, ist gut begründet, aber für dieses Programm **noch
nicht praktisch bestätigt** — dafür fehlten bislang ein Server mit interner CA
und ein echter Windows-Arbeitsplatz.

**Beim ersten Aufbau also zuerst prüfen:** Zertifikat einspielen, Programm
starten, verbinden. Klappt es nicht, ist das kein Fehler in der Einrichtung,
sondern der noch offene Punkt.

**Firefox bringt einen eigenen Zertifikatsspeicher mit** und muss getrennt
bedacht werden — das betrifft den Browser im Besprechungsraum, nicht dieses
Programm.
:::

## Wenn der Server nicht antwortet

| Lage | Was das Programm tut |
|---|---|
| Beim Start nicht erreichbar | zeigt die Einrichtungsseite mit Adresse, Grund und *Erneut versuchen* |
| Verbindung bricht mitten in der Arbeit weg | dieselbe Seite, sobald die Oberfläche etwas nachladen will |
| Sitzung abgelaufen, Server gleichzeitig weg | ebenfalls dieselbe Seite — **nicht** die Fehlerseite von Chromium |
| Zertifikat nicht vertraut | eigene Meldung mit Verweis auf die Zertifikats-Anleitung |

Die Meldungen sind Klartext, nicht `net::ERR_CONNECTION_REFUSED`. Beispiele:

- *„Der Rechnername ist im Netz nicht bekannt. Tippfehler in der Adresse — oder
  die Namensauflösung fehlt."*
- *„Der Rechner ist erreichbar, nimmt aber keine Verbindung an. Läuft PATIO auf
  dem Server?"*

## Bedienung

| | |
|---|---|
| **Fenster schließen** | minimiert in den Infobereich, beendet das Programm nicht |
| **Beenden** | Rechtsklick auf das Symbol im Infobereich → *Beenden* |
| **Mit Windows starten** | Rechtsklick auf das Symbol → Häkchen setzen |
| **Dokumentation** | `F1` — öffnet diese Seiten vom Server |
| **Zweiter Start** | holt das bestehende Fenster nach vorn, statt ein zweites zu öffnen |

Heruntergeladene Dateien landen im gewohnten Speichern-Dialog; nach dem
Abschluss öffnet sich der Zielordner im Explorer.

## Abgrenzung zu PATIO Desktop

Auf manchen Rechnern liegt noch **PATIO Desktop** — das ältere Programm, das
seine Daten in einem Ordner auf dem NAS hält. Beide können nebeneinander
bestehen; ihre Einstellungen sind getrennt:

| | PATIO Desktop | PATIO (Arbeitsplatz) |
|---|---|---|
| Daten | Ordner im Netzlaufwerk | PostgreSQL auf dem Firmenserver |
| Konfigurationsordner | `%APPDATA%\PATIO` | `%APPDATA%\PATIO-Arbeitsplatz` |
| Installation | Installer | portable Datei, von Hand kopiert |

::: warning Beide heißen im Task-Manager „PATIO"
Sie tragen denselben Produktnamen. Ein pauschales Beenden über den Namen —
etwa `Get-Process PATIO | Stop-Process` — **beendet das jeweils andere Programm
mit.** Unterscheiden lassen sie sich nur am Pfad:

```powershell
# Nur das Arbeitsplatz-Programm, PATIO Desktop bleibt unberührt:
Get-Process PATIO | Where-Object { $_.Path -notlike '*\Programs\PATIO\*' } | Stop-Process -Force
```
:::

## Was bewusst fehlt

- **Automatische Updates.** Es gibt keinen Update-Server — der Rechner hat
  kein Internet, es gäbe keine Feed-Adresse. Eine neue Fassung wird an jedem
  Platz von Hand ersetzt.
- **Erinnerungen an fällige Aufgaben.** Sie brauchen einen Zugang zur API, den
  die Hülle nicht hat. Der richtige Ort dafür ist der Server — er kennt die
  Fälligkeiten ohnehin und erreicht damit alle Arbeitsplätze gleich.
- **Offline-Betrieb.** Siehe oben.

## Für Entwickler

```bash
npm run build:electron   # Hülle nach dist-electron/
npm run electron:dev     # lokal starten
npm run dist             # portable .exe bauen (signiert, braucht das Zertifikat)
```

Die Hülle lässt sich nicht mit Vitest prüfen — sie braucht einen echten
Electron-Prozess. Dafür gibt es einen eigenen Prüfstand, der das Programm
startet und über das Chrome-DevTools-Protokoll ausliest, was im Fenster
tatsächlich steht:

```bash
node scripts/pruefe-arbeitsplatz.mjs alle http://127.0.0.1:3399
```

Mit `PATIO_EXE=release/PATIO-Arbeitsplatz-<version>-portable.exe` läuft
derselbe Prüfstand gegen das **gepackte** Programm statt gegen den Bauzustand.
Die reine Logik (Adressen, Fehlertexte) liegt getrennt in
`electron/adresse.ts` und ist von der normalen Testsuite abgedeckt.
