# Zugriffskontrolle

Wer sich anmelden kann, was er dann sieht, und welche Schranken dazwischen
liegen.

## Anmeldung

**Einstufig: Benutzername und Passwort.**

```
POST /api/auth/login    Benutzername + Passwort
   → JWT
```

| Element | Wert |
|---|---|
| Passwort-Hash | bcrypt, **12 Runden** |
| Mindestlänge Passwort | **12 Zeichen** |
| Ausgestelltes JWT | 7 Tage gültig |
| Ratebremse | 5 Fehlversuche je IP in 15 Minuten, danach 429 |

Die Fehlermeldung ist bei falschem Passwort und unbekanntem Benutzer
**dieselbe** — sonst ließen sich vorhandene Konten abfragen.

::: warning Das Passwort ist der einzige Faktor — bewusst
Zweistufig ging es bis zum Umbau zum Firmenserver: Passwort, dann ein
6-stelliger Code per E-Mail. Auf einem Rechner ohne Internet ist dieser Weg
nicht gangbar — der Versand scheiterte, und **niemand** kam mehr hinein.

Was das bedeutet: ein erratenes oder weitergegebenes Passwort ist voller
Zugang. Getragen wird das von drei Dingen — dem geschlossenen Büronetz ohne
Weg von außen, der Ratebremse, und dem Prüfprotokoll.

**Sobald es einen Zugang von außen gibt (VPN), muss der zweite Faktor
zurück.** `src/api/totp.ts` und `src/api/routes/auth-2fa.ts` liegen dafür
unangetastet im Quellbaum.
:::

::: danger Passwort vergessen
Es gibt **keinen** Selbstbedienungsweg — kein „Passwort vergessen", keinen
Anmelde-Link, keine Reset-Mail. Zurücksetzen kann nur ein anderer
Administrator unter `/admin/users`.

Deshalb: **immer zwei Administratoren.** Sonst hilft im Ernstfall nur der
Weg über die Datenbank, siehe
[Troubleshooting](/betrieb/troubleshooting).
:::

::: tip Alt-Konten aus `data/users.json` melden sich NICHT mehr an
Hier stand bis zuletzt das Gegenteil. Der einstufige Sonderweg über die
JSON-Datei ist geschlossen — er war der letzte Anmeldeweg ohne Datenbank und
umging damit Rollen und Rechte.

Von der Datei bleiben zwei harmlose Verwendungen:

- **Übernahme beim Start** (`importLegacyJsonUsers()` in `src/api/auth.ts`):
  Konten, die es nur in der JSON-Datei gibt, werden idempotent in die Datenbank
  gezogen. Wer von einer alten Installation kommt, sperrt sich damit nicht aus.
- **Sperre der Ersteinrichtung**: der Setup-Assistent zählt sie mit, damit er
  nicht ein zweites Mal aufgeht.

Ein Konto, das nur in der Datei steht und nie übernommen wurde, kommt nicht
hinein. Auf einem produktiven System sollte die Datei leer sein.
:::

## Ersteinrichtung

`POST /api/setup/admin` legt das erste Admin-Konto an — aber nur, solange
weder in der Datenbank noch in `data/users.json` ein Konto steht. Danach
antwortet der Endpunkt mit 410.

## Rollen

| Rolle | Sichtbarkeit | Schreiben | Beträge | Kontaktdaten |
|---|---|---|---|---|
| **admin** | Alles (`getVisibleProjectIds()` liefert `"all"`) | ja | ja | ja |
| **user** | Nur die Projekte aus `user_projects` | ja | nur mit Geld-Recht | ja |
| **praesentation** | Alle Projekte in den Listen; die Projektakte selbst bleibt zu (siehe unten) | **nein** | **nie** | **nie** — mit einer Ausnahme, siehe unten |

Die dritte Rolle ist das [Board für den Besprechungsraum](/betrieb/board). Sie
ist eine Beschränkung, kein Zugangsschlüssel — und zwar an drei Stellen
serverseitig, nicht in der Oberfläche:

| Schranke | Umsetzung |
|---|---|
| Alles außer `GET` und `HEAD` endet mit 403 | `schreibschutz()` in `src/api/personendaten.ts`, als Middleware vor allen Routen |
| Beträge: hart „nein", noch vor dem Recht am Konto | `darfGeldSehen()` in `src/api/geld.ts` |
| Kontaktdaten fallen aus jeder JSON-Antwort | `personendatenFilter()` in `src/api/personendaten.ts` |

Der Personendaten-Filter arbeitet wie der Geld-Filter auf dem Rückweg und
entfernt `email`, `phone`, `mobile`, `telefon`, `handy`, `adresse`/`address`,
`privatAdresse`, `contactLog` und `vcard`. Der **Name** bleibt stehen — ein
Board ohne Namen wäre leer, und wer im Besprechungsraum sitzt, ist ohnehin
bekannt; seine Privatnummer nicht.

::: danger Offener Befund: der Volldump geht am Personendaten-Filter vorbei
`GET /exports/volldump` liefert ein ZIP, kein JSON — der Filter sieht es
nicht. Darin liegt `Team.md` mit **Name, Rolle, E-Mail, Telefon und Firma
aller Mitglieder** (`src/export/volldump.ts`, Zeile 354). Die Projektauswahl
holt sich die Route aus `getVisibleProjectIds()`, und das liefert der
Präsentationsrolle `"all"`.

Die Route ist ein `GET`, der Schreibschutz greift also nicht, und einen
Rollen-Wächter hat sie nicht (`src/api/routes/export-templates.ts`, Zeile
264). Ein Anzeigekonto kann das Archiv damit herunterladen. Beträge fehlen
darin — `darfGeldSehen(c)` wird in den ZIP-Bau durchgereicht —, Kontaktdaten
nicht.

**Das ist ein Befund, keine Entwurfsentscheidung**, und keine Prüfung deckt
ihn ab: `tests/api-board.test.ts` ist der einzige Test, der die
Präsentationsrolle überhaupt kennt, und er fasst die Export-Wege nicht an.
Bis das behoben ist, gilt: ein Anzeigekonto gehört auf ein Gerät, an dem
niemand einen Download auslösen kann.
:::

Warum das Geld-Recht hart gesetzt ist, statt am Schalter zu hängen: sonst
genügte ein versehentlich gesetzter Haken im Benutzerdialog, um Honorare an
die Wand eines Raums zu werfen, in dem auch Bauherren sitzen.

::: info „Alle Projekte" heißt: in den Listen, nicht in der Akte
`getVisibleProjectIds()` liefert der Präsentationsrolle `"all"` — das Board
soll das ganze Haus zeigen, ein Ausschnitt wäre irreführend.
`canSeeProject()` und `canSeeProjectByName()` kennen diese Ausnahme **nicht**;
sie fragen `user_projects`. Ein Anzeigekonto bekommt `GET /projects` deshalb
vollständig, auf `GET /projects/:name` aber 403 — und damit auch auf jede
Unterroute der Projektakte. Für das Board reicht das: es liest ausschließlich
`/api/board/*`.
:::

Datensätze **ohne** Projektbezug sind persönlich:

| Typ | Sichtbar für |
|---|---|
| Aufgaben | Ersteller oder zugewiesene Person |
| Termine | Ersteller oder eingetragene Teilnehmer |
| Notizen | Ersteller |
| Dateien | Hochladende Person oder über eine Freigabe |

Die gesamte Logik liegt in `src/data/access.ts` — niemand setzt sich die
Sichtbarkeit selbst aus `user_projects` zusammen, deshalb ist genau diese eine
Stelle prüfbar.

**Wichtig ist aber, wo sie ausgewertet wird:** die Routen rufen
`getVisibleProjectIds()` bzw. `canSeeProjectByName()` auf und reichen das
Ergebnis weiter; die Repositories wenden eine übergebene Liste an, **ermitteln
sie aber nie selbst**. Eine neue Route, die den Aufruf vergisst, liefert damit
ungefiltert aus.

Projekt-Zugriff lesen, vergeben und entziehen: `GET` und `POST` auf
`/api/projects/:name/access`, `DELETE` auf
`/api/projects/:name/access/:userId`. Alle drei sind der Verwaltung
vorbehalten und antworten sonst mit 403. In der Oberfläche ist das der Reiter
**Zugriff** der Projektakte, der ebenfalls nur ihr angezeigt wird.

::: danger Genau so sind hier Lücken entstanden — siebzehn Stück
Das Verfahren ist richtig, aber es vergisst sich leicht. Am 23.08.2026 haben
zwei systematische Durchsichten **siebzehn Routen** gefunden, die den Aufruf
nicht machten. Alle sind geschlossen; jede ist durch eine Prüfung festgehalten,
die vor der Reparatur rot war.

**Was möglich war — mit einem gültigen Konto und dem Projektnamen:**

| Weg | Was ging |
|---|---|
| `POST /projects` mit fremdem Namen | Beitritt zu jedem fremden Projekt: Eintrag in `user_projects`, danach Notizen, Aufgaben, Dossier — und **schreibend** die Projektnummer überschreiben |
| derselbe POST | ein gelöschtes Projekt aus dem Papierkorb zurückholen |
| `GET .../notes/:note` | den vollen Inhalt jeder Notiz lesen |
| `GET .../export.md` | das komplette Projekt-Dossier laden |
| `GET .../notes`, `.../tasks`, `.../termine`, `.../children` | Listen fremder Projekte |
| `PATCH .../tasks` | eine fremde Aufgabe abhaken |
| `DELETE .../termine` | einen fremden Termin löschen |
| `POST/PATCH/DELETE /team/:id/projects…` | Projektzuordnungen fremder Projekte setzen, ändern, löschen — ohne Papierkorb |
| `GET /templates/:id/render?project=` | Stammdaten fremder Projekte (Nummer, Bauherr, Standort, Nutzung, Phase) |
| `POST /files/upload` | Dateien samt extrahiertem Volltext in ein fremdes Projekt einstellen |
| `POST /files/:id/star` | jede beliebige Datei markieren — Name, Projekt und Projektnummer standen danach in der eigenen Merkliste |
| `GET /files/starred` | dieselbe Liste ungefiltert ausliefern |
| `PATCH /team/:id` | das alte Einzelfeld `projectId` auf ein fremdes Projekt umbiegen |

**Warum es so lange unsichtbar war:** die Lücken standen jeweils direkt neben
richtigem Code. `POST /projects/:name/tasks` prüft sauber — das drei Zeilen
weiter stehende `PATCH /projects/:name/tasks` prüfte nicht. In `team.ts`
benutzen die beiden lesenden Routen den Sichtbarkeitsfilter korrekt, die drei
schreibenden nicht. In `files.ts` haben `GET /files`, `/files/read`,
`/files/search`, `/files/download` und `DELETE` jeweils ihren Wachposten — der
einzige schreibende Weg, `POST /files/upload`, hatte keinen. Beim Lesen sieht
eine solche Datei bewacht aus.

**Dazu ein Recht, das es nur auf dem Papier gab:** der Upload trug den
Hochladenden nicht ein (`uploaded_by` blieb `NULL`). Damit war jede
Eigentümer-Prüfung wirkungslos — wer eine Datei hochlud, konnte sie weder
löschen noch freigeben, und ein Upload ohne Projekt war für niemanden ausser
dem Administrator je wieder erreichbar. Sieben Testdateien prüften das
Eigentümer-Recht und keine davon rief die Upload-Route auf; sie setzten das
Feld selbst am Repository vorbei.

**Was daraus folgt:** wer hier eine Route ergänzt, ergänzt eine Zeile in
`tests/api-projects-acl-luecke.test.ts`, `api-projekt-beitritt.test.ts`,
`api-team-projekt-acl.test.ts` oder `api-dateien-acl.test.ts`. Der Projektname
aus dem Pfad ist eine Behauptung des Aufrufers, keine Berechtigung.

**Und ein Muster, das sich als Falle herausgestellt hat:** eine Prüfung der
Form `if (rolle !== "admin" && datensatz.projectName)` schaltet sich selbst ab,
sobald der Projektname fehlt — ein `LEFT JOIN`, ein Projekt im Papierkorb, ein
umbenanntes Feld genügt. Besprechungen und Entscheidungen prüfen deshalb jetzt
über die Projekt-UUID, die immer da ist.
:::

::: info Dass ein Projektname existiert, ist keine geschützte Auskunft
`GET /projects/:name` antwortet mit 404, wenn es das Projekt nicht gibt, und
mit 403, wenn man es nicht sehen darf. Der Statuscode verrät damit die
Existenz. Das ist geprüft und bewusst so gelassen:

Projekt- und Nummernraum sind eindeutig. `POST /projects` **muss** auf einen
vergebenen Namen mit 409 antworten und auf einen freien mit 201 — eine
Eindeutigkeit ohne Existenzauskunft gibt es nicht. Die Auskunft an einer
Stelle zu schließen, während sie an der anderen offen bleiben muss, kostet nur
Verständlichkeit: der Ersteller eines gelöschten Projekts bekäme dann „kein
Zugriff" statt „nicht gefunden".

Die Unterrouten prüfen trotzdem zuerst das Recht — dort geht es um **Inhalte**,
nicht um die bloße Existenz eines Namens.
:::

## Das Geld-Recht

Getrennt von den Rollen gibt es ein eigenes Recht für **Geldbeträge**:
Stundensätze, Honorare, Rechnungssummen, Deckungsbeiträge. In einem Büro sollen
nicht alle die Sätze der Kollegen kennen.

| | |
|---|---|
| Spalte | `users.can_see_money` (Migration `043`) |
| Voreinstellung | **aus** — neue Konten sehen keine Beträge |
| Admins | haben es immer |
| Vergabe | Verwaltung → Benutzer, eigener Schalter |

::: tip Eine Filterstelle statt neun
Beträge kommen an neun Stellen heraus: Rechnungen, Portfolio, Projekt-Cockpit,
Stundenliste, Team, Leistungsphasen, Volltextsuche, Live-Kanal und Export.
Statt es neunmal einzeln zu prüfen — und beim zehnten Mal zu vergessen — sitzt
**eine Middleware hinter allen Routen**:

```
app.use("/api/*", geldFilter);      // src/api/server.ts:503
```

`src/api/geld.ts` geht die fertige JSON-Antwort rekursiv durch und entfernt die
Geldfelder, wenn das Konto das Recht nicht hat. Eine neue Route, die JSON
liefert, kann das nicht vergessen, weil sie nichts dafür tun muss.

Die Beträge werden also **nicht in der Oberfläche ausgeblendet**, sondern
verlassen den Server gar nicht erst. Ein Mitschnitt der Netzwerkantworten
enthält sie nicht.
:::

::: warning Der Filter fasst nur JSON an
Dateidownloads, der Word-Export und der Live-Kanal (`text/event-stream`) laufen
unverändert durch — ein ZIP ist kein JSON, der Antwort-Filter sieht es nicht.
Für den Live-Kanal ist das kein Loch: seine Ereignisse tragen keine Nutzdaten
(siehe unten). Die übrigen Wege prüfen deshalb **selbst**:

| Weg | Prüfung |
|---|---|
| `GET /exports/volldump` | reicht `darfGeldSehen(c)` in den ZIP-Bau durch |
| Word-Export einer Rechnung | 403 ohne Geld-Recht |
| `GET /projects/:name/finance` | 403 — die Route ist von vorne bis hinten Geld, eine leergeräumte Hülle wäre die unehrlichere Antwort |
| Rechnungen schreiben (`POST`/`PUT`/`DELETE`) | 403 — sonst setzte jemand Beträge, die er selbst nicht sieht |
| Positionskatalog | 403, lesend wie schreibend |

**Wer einen neuen Weg baut, der etwas anderes als JSON ausliefert, prüft
selbst.** Das ist die zweite Stelle, die dieses Verfahren nicht abnimmt.
:::

::: danger Die Grenze des Verfahrens — bitte beim Weiterbauen beachten
Der Filter erkennt Geld an **Feldnamen**, nicht am Inhalt. `GELD_FELDER` in
`src/api/geld.ts` ist eine feste Liste (`hourlyRate`, `betrag`, `einzelpreis`,
`budget`, `honorar`, `deckungsbeitrag`, `kostenIst` und weitere).

**Ein Betrag unter einem neuen Namen — etwa `preis`, `summe` oder `netto` —
ginge ungefiltert hinaus.** Der Test `tests/api-geld-recht.test.ts` prüft
gegen dieselbe Liste und würde es ebenfalls nicht bemerken.

Wer ein neues Geldfeld einführt, muss es also an **zwei** Stellen eintragen:
in `GELD_FELDER` und in die Endpunktliste des Tests. Das ist der eine Handgriff,
den dieses Verfahren nicht abnimmt.
:::

## KI-Zugriff

PATIO kann je Projekt eine **Akte** erzeugen, die ein Sprachmodell lesen darf
(Migration `059`). Sicherheitsrelevant sind daran drei Dinge:

| | |
|---|---|
| Routen | `GET`/`PATCH` `/api/ki/freigabe` · `PUT /api/ki/freigabe/:projectId` · `GET /api/ki/dossier[/:projectId]` |
| Wer darf | **nur die Verwaltung** — `kiFreigabeRoutes.use("/ki/*", adminMiddleware)` |
| Voreinstellung | aus. Kein Eintrag heißt nicht freigegeben; ein neu angelegtes Projekt ist damit gesperrt |

Auch das **Lesen** der Akten ist Verwaltungssache. Die Freigabe ist ausdrücklich
unabhängig von der Projektzuordnung — ohne diese Einschränkung wäre der
Akten-Abruf der Weg, auf dem jedes Konto an jedes freigegebene Projekt käme.

### Die drei Personendaten-Stufen

`src/mcp/redact.ts` redigiert jeden Datensatz, bevor er in die Akte geht. Die
Stufe gilt quer über **alle** freigegebenen Bereiche — eine Freigabe nur für
„Besprechungen" gäbe sonst über die Teilnehmerlisten das halbe Adressbuch mit
heraus.

| Stufe | Was wegfällt |
|---|---|
| `alle` | nichts |
| `namen-ohne-kontakt` *(Vorgabe)* | am Team-Mitglied `email`, `phone`, `contactLog` und `hourlyRate`; im Bautagebuch die geleisteten Stunden je Person |
| `keine` | zusätzlich jeder Klarname: `createdByUsername`, `updatedByUsername`, `assigneeName`, `memberName`, die Aufgaben-Zuweisung, die Teilnehmer an Terminen, Besprechungen und Entscheidungen, der Bauherr am Projekt und die Firma am Mitglied. Eine Person erscheint nur noch als ihre Mitglieds-ID — dasselbe Pseudonym in jedem Abschnitt. Externe ohne Mitglieds-ID entfallen ersatzlos |

::: warning Die Stufe wirkt auf Felder, nicht auf Prosa
Notiz-Inhalte, Protokoll-Text und Bautagebuch-Tätigkeiten werden **nicht**
durchsucht. Steht in einem Protokoll „Hr. Müller wünscht Sichtbeton", bleibt
das stehen — auch bei `keine`. Eine automatische Namenserkennung in Freitext
wäre entweder löchrig oder zerstörerisch; wer das nicht will, gibt diese
Bereiche nicht frei.
:::

Der Aufbau der Akte, die zehn Bereiche und die Vorschau stehen unter
[KI-Zugriff](/konzepte/ki-zugriff). Wohin die Akte gehen kann und was das
datenschutzrechtlich bedeutet, unter [DSGVO](/sicherheit/dsgvo).

## Live-Updates

Der SSE-Kanal war lange die einzige Stelle ohne Rechtefilter. Heute zwei
Stufen:

1. **Kein Inhalt im Ereignis.** Es sagt nur, *was* sich geändert hat
   (`type`, `action`, `id`, `projectId`), nicht wie es aussieht. Der Client
   lädt über die reguläre Route nach, und die filtert bereits.
2. **Zustellung nach Sichtbarkeit.** Jeder Abonnent bringt seinen
   Sichtbarkeits-Kontext mit; zugestellt wird nur, was er sehen darf —
   derselbe Maßstab wie überall sonst.

Für den Verbindungsaufbau holt der Client ein **Einmal-Ticket** mit 30
Sekunden Gültigkeit. Grund: `EventSource` kann keine eigenen Header setzen,
das Credential müsste also in die URL — und dort landet es in Server-Logs,
Browser-Verlauf und Referer.

## Rate-Limiting

| Bereich | Grenze | Reaktion |
|---|---|---|
| Login | 5 Versuche je IP in 15 Minuten | HTTP 429 |
| Alle `/api/*` | 600 Anfragen je IP und Minute | HTTP 429 mit `Retry-After` |

Beide Zähler liegen im Arbeitsspeicher. Für den vorgesehenen Betrieb — eine
Instanz — genügt das; ein Neustart setzt sie zurück.

::: tip Nur die erste IP aus X-Forwarded-For
Ein Angreifer könnte sonst mit wechselnden Header-Werten pro Anfrage einen
anderen Zähler erzeugen und das Limit umgehen.
:::

## Uploads

Zwei Schranken:

1. **Endungs-Whitelist** — `pdf`, `docx`, `doc`, `xlsx`, `xls`, `csv`,
   `txt`, `md`, `png`, `jpg`, `jpeg`, `gif`, `webp`, `zip`, `json`, `xml`.
2. **Magic-Byte-Prüfung** — der aus dem Inhalt erkannte Binärtyp muss zur
   behaupteten Endung passen. Eine als `.png` getarnte HTML-Datei fliegt
   raus, ebenso ein PDF hinter einer `.txt`-Endung.

Textformate ohne verlässliche Signatur (`txt`, `md`, `csv`, `json`, `xml`)
werden anhand der Endung akzeptiert — dafür gibt es keine Magic Bytes.

Größenlimit: `MAX_UPLOAD_MB`, Standard 50.

## Dateizugriff

**Es gibt keinen Weg mehr, der einen Pfad entgegennimmt.** `GET /files/read`
verlangt eine Datei-ID (`?id=`), `DELETE /files` ebenfalls; `POST /files/mkdir`
und das Löschen über einen Pfad sind entfallen — letzteres rief
`rmSync(recursive)` und konnte damit von jedem angemeldeten Konto aus einen
ganzen Ordner unterhalb von `WORKSPACE_PATH` entfernen. Damit ist heute jeder
Zugriff über eine Datenbankzeile gedeckt, und die trägt Projekt und Eigentümer,
also die Rechteprüfung.

Der Dateibrowser listet auch keine Ordner des Dateisystems mehr: er baut seine
Struktur logisch aus den Projekten. Hier stand bis zuletzt, er blende auf
Wurzelebene Systemordner aus — `listFolder()` samt dieser Ausblendliste ist mit
den pfadbasierten Routen entfallen.

Übrig bleibt ein einziger Dateisystem-Zugriff: der Download-Rückfall für
Alt-Einträge aus der Vault-Zeit, deren Datenbankzeile keinen Inhalt trägt
(`readFile()` in `src/workspace/files.ts`). Er läuft durch `safePath()` in
`src/workspace/helpers.ts` — löst gegen `WORKSPACE_PATH` auf, weist alles
außerhalb ab und lehnt Symlinks ab. Die Prüfung arbeitet mit Separator-Suffix;
`startsWith("/workspace")` allein würde auch `/workspace-backup` durchlassen.

Am Dienst vorbei kommt an diesen Ordner niemand: er ist keine Netzfreigabe,
sondern nur in den Container eingehängt. **Dateien gelangen ausschließlich über
den Upload in PATIO herein** — damit gibt es keine Datei ohne Datenbankzeile
und keine Datei ohne Rechteprüfung.

## HTTP-Absicherung

| Maßnahme | Umsetzung |
|---|---|
| Security-Header | `hono/secure-headers`: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` und weitere |
| Content-Security-Policy | Eigene Richtlinie, **erzwingend**. `default-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` |
| CORS | Ohne `CORS_ORIGINS` nur `http://localhost:<API_PORT>` |
| Fehlerantworten | Zentral in JSON, ohne Stack-Trace nach außen |

::: tip Die CSP ist der Punkt, an dem die Offline-Zusage durchgesetzt wird
Bis zum 23.08.2026 lief die Richtlinie unter `Content-Security-Policy-Report-Only`:
Verstöße erschienen in der Konsole, blockiert wurde nichts. Als
Beobachtungsphase gedacht, als solche zu lange gelaufen — eine Richtlinie, die
nichts blockiert, ist keine Maßnahme, sondern eine Notiz.

Jetzt ist sie scharf. `default-src 'self'` und `connect-src 'self'` machen aus
„PATIO lädt nichts von außen nach" eine Regel, die der Browser durchsetzt,
statt eine, die beim nächsten eingefügten Schnipsel bricht.

**Die Dokumentation unter `/docs/` hat eine eigene Richtlinie**: die gebaute
VitePress-Seite enthält drei Inline-Skripte (Hell/Dunkel-Umschaltung,
Plattform-Erkennung), die unter `script-src 'self'` blockiert würden. Statt der
ganzen Anwendung `'unsafe-inline'` zu geben, gilt die Ausnahme nur dort — und
auch dort bleiben `default-src 'self'` und `connect-src 'self'` bestehen.
:::

## Feld-Verschlüsselung

Einzelne Datenbankfelder werden mit AES-GCM verschlüsselt
(`src/api/crypto.ts`). Schlüssel ist `ENCRYPTION_KEY`, getrennt vom
`JWT_SECRET` — so reißt eine Rotation des Anmelde-Secrets die
verschlüsselten Felder nicht mit. Ist kein eigener Schlüssel gesetzt, wird mit
`JWT_SECRET` verschlüsselt, und der Start warnt.

Beim **Entschlüsseln** gibt es seit dem 23.08.2026 nur noch diesen einen
Schlüssel: ein Wert, der damit nicht lesbar ist, ergibt `null` — nicht mehr
Klartext, nicht mehr einen zweiten Versuch mit `JWT_SECRET`. Das macht das
Setzen des Schlüssels zu einem Einbahnweg; was dabei zu beachten ist, steht
unter [Verschlüsselung umstellen](/sec-4-crypto-migration).

Betroffen ist genau ein Feld, `users.totp_secret_encrypted`, und das schreibt
derzeit niemand: der zweite Faktor ist nicht eingehängt.

## Audit-Log

Sicherheitsrelevante Vorgänge werden protokolliert, einsehbar unter
**Verwaltung → Audit**:

| Bereich | Ereignisse |
|---|---|
| Anmeldung | `login.success`, `login.fail` |
| Passwort | `password.change` (selbst geändert), `password.admin_reset` (vom Admin zurückgesetzt) |
| Benutzer | `user.create`, `user.update`, `user.role`, `user.delete` |

Mehr wird derzeit nicht geschrieben. `user.role` statt `user.update` erscheint
nur, wenn sich tatsächlich die Rolle ändert.

::: info Tote Ereignistypen im Quellcode
`src/data/db-audit.ts` führt weitere Typen, die **nicht mehr entstehen können**:

- `login.magic_link.*`, `login.email.*`, `login.email_setup_required`,
  `login.2fa.*`, `email_setup.*` — die E-Mail-Anmeldung ist ersatzlos
  entfallen, es gibt keinen Codepfad mehr, der sie schreibt.
- `ms.*` — der Outlook-Abgleich ist entfallen.
- `bot.token.*` und `pair.*` — Telegram-Altbestand. Die Tabelle
  `telegram_pair_tokens` ist mit Migration `055` gefallen, die Spalte
  `users.telegram_bot_token` mit `056`.
- `2fa.*` — hier steht der Code noch (`src/api/routes/auth-2fa.ts`), aber die
  Routen sind **nicht eingehängt** (`src/api/server.ts:575` ist
  auskommentiert). Unerreichbar, nicht gelöscht — der zweite Faktor kommt mit
  dem VPN zurück.

In einem bestehenden Audit-Log können solche Einträge als **Historie**
auftauchen. Das ist kein Hinweis darauf, dass der Weg noch offen wäre.
:::

Jeder Eintrag hält IP und User-Agent (auf 256 Zeichen gekürzt).
Aufbewahrung: `AUDIT_RETENTION_DAYS`, Standard 365 Tage; der Wartungs-Cron
räumt nachts auf.

## Was nicht mehr existiert

Die frühere Zugriffskontrolle über Telegram-Chat-IDs (`ALLOWED_CHAT_IDS`,
Auto-Owner), die Whitelist für Agenten-Dateien, die Shell-Allowlist und der
SSRF-Schutz für den Webabruf sind ersatzlos entfallen — mit dem Code, den
sie abgesichert haben. PATIO ruft im Betrieb keine externen Adressen mehr
auf und führt keine Shell-Befehle aus.

::: info Ein fremder Prozess bleibt: LibreOffice
Die PDF-Umwandlung ruft `soffice` auf (`src/export/pdf.ts`) — über `execFile`
mit einer Argumentliste, also **ohne Shell**: am Dateinamen wird nichts
interpretiert, und er wird zuvor von Pfadanteilen und Sonderzeichen befreit.
Jeder Lauf bekommt einen eigenen Temp-Ordner mit eigenem LibreOffice-Profil
und ein Zeitlimit von 60 Sekunden; der Ordner wird auch im Fehlerfall
gelöscht, weil das Dokument darin im Klartext liegt — auf dem Firmenserver
stehen darin Honorare.

Fehlt `soffice`, antwortet die Route mit einem erklärenden Satz statt mit
einem 500er. Die PDF-Umwandlung ist optional, der Word-Export bleibt in jedem
Fall vollständig.
:::
