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

| Rolle | Sichtbarkeit |
|---|---|
| **admin** | Alles. `getVisibleProjectIds()` liefert den Sentinel `"all"`, es wird gar nicht gefiltert |
| **user** | Nur die Projekte aus der Zuordnungstabelle `user_projects` |

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

Projekt-Zugriff vergeben und entziehen: `POST` und `DELETE` auf
`/api/projects/:name/access`.

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

::: tip Eine Filterstelle statt acht
Das Recht müsste an acht Stellen greifen: Rechnungen, Portfolio,
Projekt-Cockpit, Positionskatalog, Volltextsuche, Live-Kanal, Word-Export und
Sicherungs-Status. Statt es achtmal einzeln zu prüfen — und beim neunten Mal zu
vergessen — sitzt **eine Middleware hinter allen Routen**:

```
app.use("/api/*", geldFilter);      // src/api/server.ts:431
```

`src/api/geld.ts` geht die fertige JSON-Antwort rekursiv durch und entfernt die
Geldfelder, wenn das Konto das Recht nicht hat. Eine neue Route kann das nicht
vergessen, weil sie nichts dafür tun muss.

Die Beträge werden also **nicht in der Oberfläche ausgeblendet**, sondern
verlassen den Server gar nicht erst. Ein Mitschnitt der Netzwerkantworten
enthält sie nicht.
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

`safePath()` in `src/workspace/helpers.ts` löst jeden relativen Pfad gegen
`WORKSPACE_PATH` auf und weist alles außerhalb ab. Die Prüfung arbeitet mit
Separator-Suffix — `startsWith("/workspace")` allein würde auch
`/workspace-backup` durchlassen.

Der Dateibrowser blendet auf Wurzelebene die Systemordner `Agents`,
`MEMORY_LOGS`, `Daily` und `Templates` sowie alles mit führendem Punkt aus.

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
verschlüsselten Felder nicht mit. Ohne eigenen Schlüssel greift der Rückfall
auf `JWT_SECRET`, und der Start warnt.

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
  `email_setup.*` — die E-Mail-Anmeldung ist ersatzlos entfallen, es gibt
  keinen Codepfad mehr, der sie schreibt.
- `ms.*` — der Outlook-Abgleich ist entfallen.
- `2fa.*` — hier steht der Code noch (`src/api/routes/auth-2fa.ts`), aber die
  Routen sind **nicht eingehängt** (`src/api/server.ts:486` ist
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
