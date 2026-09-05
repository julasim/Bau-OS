# PATIO — Project Instructions

> **Produktname:** **PATIO** (P·A·T·I·O — Plan · Architektur · Termine ·
> Intelligenz · Office; zugleich der architektonische Begriff für einen
> Innenhof). Alles Nutzer-Sichtbare (UI, Doku) sagt **PATIO**. Maker-Tag:
> **„by Sima"** — kein Bezug zu „SIMA Architecture" o.ä.
>
> **Repo-Layout:** Der Code (`src/`, `web/`) liegt **direkt im Repo-Root**
> (dieser Ordner; im Workspace unter `apps/patio/`). **Alle `npm`-Befehle aus
> dem Repo-Root ausführen.** Remote: `github.com/julasim/patio`
> (früher `Bau-OS`).

## Zielgruppe (WICHTIG)

> **PATIO ist ein Programm für Architektur-, Planungs- und Projektsteuerungs-
> büros — für die PLANUNG im Büro, NICHT für die Bauausführung/Baustelle.**

- **Primäre Nutzer:** Architekten, Projektleiter im Büro, Sachbearbeiter,
  Statiker, Bauphysik, Hausverwalter, Auftraggeber-Vertreter — Menschen am
  Schreibtisch.
- **Geräte-Annahme:** Desktop, Laptop, gelegentlich Tablet/Phone vom
  Außendienst-Termin. Mobile-UI ist Komfort, nicht Hauptweg.
- **NICHT die Zielgruppe:** Polier, Maurer, Maschinenführer. Sie werden im
  System abgebildet (als `team_members`, in Stundenerfassung, Bautagebuch),
  bedienen es aber nicht.
- **Sprache & Tonalität:** Bürodeutsch, kein Baustellen-Jargon. „Eintrag
  dokumentieren" statt „schnell auf der Baustelle eintippen".

## Umbau zum Firmenserver (Stand 2026-08-30 — Version 1.0.0 ausgeliefert)

> PATIO wird vom Internet-Stack zum **zentral betriebenen Firmenprogramm im
> eigenen Netz** umgebaut: ein Mini-PC im Büro, kein Internet, echte
> Benutzerrollen, projektweise Rechte. Plan und Arbeitspakete:
> `~/.claude/plans/dynamic-floating-pearl.md`, Zielbild:
> `../../PATIO-Umbau-Firmenserver.md` (dessen Zeile 24 ist überholt — Basis ist
> **dieses** Projekt, nicht `apps/patio-app-lokal`).

> ## ⇥ Woran gerade gearbeitet wird
>
> ### Stand 25.08.2026 — der Docker-Bau war 45 Commits lang kaputt
>
> ⚠ **Seit dem 06.08.2026 (`23d4f9a`) liess sich kein Auslieferungspaket mehr
> schnueren.** VitePress holt je Doku-Seite ein Aenderungsdatum ueber
> `git log`; im Bau-Container gibt es weder `git` noch ein Repository, und
> VitePress bricht dabei den GESAMTEN Bau ab (`spawn git ENOENT`).
> Scharfgeschaltet hatte das niemand bewusst — der Eintrag
> `themeConfig.lastUpdated: { text: … }` sieht wie eine Beschriftung aus und
> leitet die Funktion ab.
>
> **Warum es niemand sah:** Drei Kommentare behaupteten Gleichheit zwischen CI
> und Docker (`build.yml` zweimal, `.husky/pre-push` einmal). Der Befehl ist
> gleich, die Umgebung nicht — der Runner hat `git` UND ein `.git`.
>
> Behoben: `lastUpdated: false` in `docs/.vitepress/config.ts`, der
> irrefuehrende Eintrag entfernt, die drei Kommentare korrigiert, und ein
> **eigener CI-Job baut die builder-Stufe wirklich** (`--target builder`, ohne
> LibreOffice, parallel zum Testlauf).
>
> **Dahinter lag mehr — der Auslieferungsweg trug auch nach dem Bau-Fix
> nicht:**
>
> - **Die Basis-Images lagen nie im Paket** (`postgres:16`, `caddy:2-alpine`,
>   `alpine:latest`). Erstinstallation ohne Internet: unmoeglich. Auf einer
>   bestehenden fiel es nicht auf, weil Postgres und Caddy laufen — `alpine`
>   haengt an keinem Container und wird von `backup.sh` gebraucht: fehlte es,
>   scheiterte die naechtliche Sicherung **ohne Meldung**, und jedes Update
>   brach danach ab.
> - **Ein gescheiterter Start umging den Rueckweg.** `docker compose up -d`
>   unter `set -euo pipefail` beendete das Update-Skript sofort — nach
>   `docker load` und nach dem Ersetzen aller Dateien, aber vor
>   Gesundheitspruefung und Ruecksetzen.
> - **Jedes Paket hiess `patio-0.1.0.tar.gz`** und ueberschrieb das vorige
>   still. `package.json` steht seit dem ersten Commit auf 0.1.0.
> - **`logs/`, `data/`, `tools/` gehoerten root**, der Dienst schreibt als
>   uid 1000, der EACCES wird im Logger verschluckt → `patio.log` blieb
>   dauerhaft leer, waehrend Monitoring und Troubleshooting dorthin zeigen.
> - **`MIT_PDF=nein` wurde nicht durchgereicht** — die 350 MB LibreOffice waren
>   im Paket trotzdem drin.
>
> **Verifiziert, nicht behauptet:** voller `docker compose build` aus dem echten
> Repo (EXIT=0), danach ein echtes Paket ueber `release-offline.sh` — 497 MB,
> mit allen drei Basis-Images nachgewiesen im Archiv.
>
> **Diese Liste ist am 28.08. abgearbeitet** — siehe den Eintrag direkt
> darunter.
> Offen bleibt nur der Hinweis in `troubleshooting.md` auf
> `docker image prune -a`; der steht dort seit dem 25.08. mit einem
> Danger-Kasten, der genau erklaert, warum er hier den Rueckweg loescht.
>
> ### Stand 28.08.2026 — Version 1.0.0, Erstinstallation durchgespielt
>
> **Das Paket ist gebaut und der Weg zum ersten Mal wirklich gegangen** — in
> WSL Ubuntu-24.04 mit leeren Volumes, vom `mkdir /opt/patio` bis zum
> Einrichtungsassistenten. `release/patio-1.0.0.tar.gz`, 497 MB, mit allen
> drei Basis-Images.
>
> Belegt am laufenden Stand: `{"ok":true,"db":true}`, `HTTP 200` auf
> `https://patio.sima.intern/` und `/docs/`, `{"needsSetup":true}` vom
> Einrichtungsassistenten, 61 Migrationen auf frischer Datenbank, Zertifikat
> aus der eigenen CA, HTTP→HTTPS-Umleitung (308), `logs/` und
> `patio-workspace` gehoeren uid 1000, **und `patio.log` wird wirklich
> beschrieben** (9821 Bytes) — der Punkt, der laut dem Eintrag vom 25.08.
> dauerhaft leer blieb.
>
> **Was der Durchlauf zutage gefoerdert hat:**
>
> - **Der zweite Installationsversuch scheitert** — und die Meldung zeigt in
>   die falsche Richtung. `install-server.sh` erzeugt jedes Mal ein neues
>   Zufallspasswort, Postgres uebernimmt eines aber nur bei LEEREM
>   Datenverzeichnis. Das Volume `patio_postgres_data` ueberlebt ein
>   `rm -rf /opt/patio` (es liegt in Docker), und der Projektname steht FEST
>   in `docker-compose.yml` (`name: patio`) — das Volume heisst also immer
>   gleich. Ergebnis: `password authentication failed`, waehrend Postgres
>   `healthy` ist und die `.env` in sich stimmt. Das Skript bricht jetzt
>   vorher ab und nennt beide Wege.
> - **Drei Diagnosewege meldeten auf einem GESUNDEN Server Fehler.** Der
>   Health-Check und die Schnelldiagnose riefen `localhost:3000` (Port 3000
>   liegt nicht auf dem Host) und `node --version` (auf dem Server laeuft
>   alles in Containern). Die Fehlerzeile brach zusaetzlich in zwei, weil
>   `grep -c` bei null Treffern die 0 ausgibt **und** mit Exit 1 endet.
> - **`https://localhost/` antwortet auch auf einem gesunden Server nicht.**
>   Caddys Site-Block gilt nur fuer `PATIO_HOSTNAME`; ein Aufruf an
>   `localhost` bricht im TLS-Handshake ab. Das war zwischenzeitlich die
>   eigene „Korrektur" der Zeile darueber — gefunden, weil die Diagnose gegen
>   die laufende Anlage nachgefahren wurde.
> - **Die Pruefsumme trug den Pfad vom Baurechner** (`release/patio-…`). Die
>   Handprobe auf dem Server meldete `FAILED open or read` — es liest sich wie
>   ein beschaedigtes Paket, obwohl nur der Pfad nicht passt.
> - **Auf dem Server war nicht feststellbar, welcher Stand laeuft.**
>   `/opt/patio/VERSION` haelt ihn jetzt fest (erst nach bestandener
>   Gesundheitspruefung, beim Rueckweg zurueckgenommen), `patio status` zeigt
>   ihn.
>
> **Nicht in WSL pruefbar und damit weiterhin offen:** Sicherungsplatte samt
> Ruecksicherung, USV, und ob Electron dem CA-Zertifikat am echten
> Arbeitsplatz traut (AP12 Teil A).
>
> ### Stand 29.08.2026 — die Netzfreigabe ist entfallen
>
> **Entscheid Julius:** Es wird keine Samba-Freigabe geben. Niemand bindet den
> Dokumentenordner mehr im Windows-Explorer ein; **Dateien kommen
> ausschliesslich ueber PATIO selbst herein** und liegen in der Datenbank, mit
> Projektbezug, Rechten und Volltextsuche.
>
> Entfallen sind `deploy/smb-patio.conf` und `docs/betrieb/freigabe.md`, dazu
> Schritt 5 der Installation, die Samba-Pruefung im Installer, die Gruppe
> `patio-buero`, das Konto `patio-dateien` und der Papierkorb der Freigabe in
> `patio dokumente`.
>
> **Der Ordner `/opt/patio-workspace` bleibt** — ausdrueckliche Entscheidung.
> Er haengt weiter als `/workspace` im Container, wird weiter gesichert, und
> der Dienst liest daraus Alt-Datensaetze nach, deren Inhalt nicht in der
> Datenbank liegt. Von aussen ist er nicht mehr erreichbar. `WORKSPACE_PATH`
> bleibt Pflichtangabe (`src/index.ts` bricht sonst den Start ab), und
> `uid 1000` bleibt noetig — jetzt nur noch fuer die Container-Mounts.
>
> **Nebeneffekt:** Damit loest sich die UID-Kollision, die die Erstinstallation
> als erstes getroffen haette. `groupadd -g 1000 patio-buero` und
> `useradd -u 1000 patio-dateien` scheiterten auf Ubuntu 24.04, weil der
> Erstbenutzer diese Kennungen bereits hat — beide Befehle brauchte nur Samba
> und sind mit ihm entfallen. Das verbliebene `chown -R 1000:1000` arbeitet
> numerisch und kollidiert mit nichts.
>
> ### Stand 01.09.2026 — Bugs aus dem Review: AP1, AP3, AP4, AP5 abgearbeitet
>
> Plan: `~/.claude/plans/ich-m-chte-das-du-deep-simon.md`. **801 Prüfungen**
> (vorher 740), Migrationen bis **060**. Uncommittet auf `main`.
>
> **AP1 Sicherung und Betrieb** (elf Fehler): Die nächtliche Sicherung endete
> mit Fehlschlag, obwohl sie durchlief — und blockierte damit **jedes Update**.
> Dazu Rückweg, Proxy-Neustart, systemd-Einheiten, Rücksicherung,
> Gesundheitsprüfung. Am laufenden System belegt, Prüfstand mit 64
> Zusicherungen.
>
> **AP3 Präsentationsrolle.** Das Board durfte Listen sehen, aber keine Akte
> öffnen — es sah aus wie ein Defekt. Jetzt darf es beides. ⚠ Dabei ging der
> **Volldump am Personendaten-Filter vorbei**: Der Filter fasst nur JSON an,
> ein ZIP nicht. Zwei unabhängige Sperren.
>
> ⚠ **Beim Bauen gefunden: das Prüfprotokoll protokollierte seine Details
> nie.** `logEvent` schrieb sie doppelt kodiert, die Leseseite verwarf sie
> stillschweigend zu `{}` — **alle 2839 Einträge** der Testdatenbank. Dieselbe
> Schreibform steckt in fünf weiteren jsonb-Spalten; dort fangen die Leser sie
> ab. Eigener Schritt, Aufgabe liegt an.
>
> **AP4 `termine.datum` von TEXT auf `date`** (Migration 060). ⚠ **Das Board
> hat seit seinem Bau keinen Termin angezeigt** — ISO gegen `TT.MM.JJJJ`
> verglichen, trifft nie zu, wirft nie. Ebenso kaputt: Wochenansicht,
> Portfolio-Frist, „nächster Termin" in der Projektakte, die Sortierung (nach
> Tag im Monat) und das Datumsfeld im Kalender (blieb leer). Gegen eine Kopie
> der gewachsenen Testdatenbank gefahren, **2212 Zeilen Tag für Tag verglichen
> — keine verschoben**, fünf unlesbare in den Papierkorb.
>
> ⚠ **Die eigene Erkennungsabfrage wäre am Dienststart gestorben:**
> `to_date('31.02.2026','DD.MM.YYYY')` wirft in PG16, und der Ausdruck läuft,
> weil das Muster passt. Die Migration, die einen Startabbruch verhindern soll,
> wäre die Ursache dafür geworden. Jetzt über eine Funktion mit
> `EXCEPTION`-Zweig.
>
> **AP5 Frontend.** ⚠ **Der Konfliktschutz für Team-Mitglieder war von jedem
> Client aus unerreichbar** — die Route nimmt nur eine Feld-Weißliste, `rev`
> stand nicht darin. Nicht im Review, beim Nachlesen des Plans gefunden.
> Geprüft wird das jetzt über die **Wirkung**, nicht über den Anfragekörper;
> eine Prüfung der zweiten Art wäre grün geblieben. Dazu: `ApiError` mit
> Statuscode (keine Ansicht konnte 409 von 500 unterscheiden), 204-Antworten
> meldeten einen Fehler trotz Erfolg, die Team-Seite hatte **kein einziges
> Fehler-Ref** bei dreizehn `catch`-Blöcken, und `useEvents` hielt drei
> Verbindungen für dieselben Ereignisse.
>
> ⚠ **Der eigene `useEvents`-Umbau war zuerst wirkungslos:** Drei Komponenten
> im selben Tick kamen alle an `if (quelle) return` vorbei, weil `quelle` erst
> nach dem `await` gesetzt wird. Vom Test gefunden, nicht beim Lesen.
>
> **Die Selbstprüfung danach fand vier weitere Fehler**, zwei davon durch
> diesen Umbau entstanden: Die Migration verglich mit `<>` statt
> `IS DISTINCT FROM` (auf einer Datenbank ohne die Tabelle wäre der Dienst
> nicht gestartet); ein geleertes Datumsfeld wäre ein 500er geworden
> (`if (updates.datum)` ist für `""` falsy). Dazu zwei Altbestände:
> **die Datenübernahme verschob Datumsangaben um Monate** — der 5. Oktober
> wurde zum 9. Mai, ohne Meldung, in vier Tabellen —, und die Portfolio-Frist
> rechnete „heute" aus der Prozesszeit und lag in Wien immer einen Tag zurück.
>
> ⚠ **Die adversariale Runde ist dabei NICHT durchgelaufen:** Die Suchphase
> lieferte 37 Befunde, aber alle 111 Skeptiker scheiterten am Sitzungslimit.
> Die vier oben sind von Hand am System nachgemessen; die übrigen 33 sind
> **ungeprüft** und liegen unter
> `…/subagents/workflows/wf_fe6d71c8-a9d/journal.jsonl`. Darunter unter
> anderem: `tasks.date` ist die letzte TEXT-Datumsspalte ohne jede
> Formatprüfung.
>
> **Offen (nicht beauftragt):** AP2 (Löschen und Rechte — `DELETE /team/:name`
> ohne jede Rechteprüfung, Dateilöschung ohne Papierkorb, Papierkorb-Filter in
> Suche und Aktivität) und AP6 (Gestaltung und Wächter). Zusammen neun der
> zwanzig Review-Bugs.
>
> ### Stand 05.09.2026 — die gesamte Doku gegen den Code abgeglichen
>
> Alle 30 Handbuchseiten plus README, Behauptung für Behauptung. **102
> Verdachtsfälle**, jeder von **zwei** unabhängigen Skeptikern gegengelesen
> (einer gegen die Behauptung, einer gegen den Korrekturvorschlag): **27
> widerlegt, 75 echt und behoben.** Uncommittet auf `main`.
>
> ⚠ **Zwei Pflichtschritte fehlten in der Anleitung.** Nach dem Einhängen der
> Sicherungsplatte muss der App-Container einmal neu erzeugt werden — sonst
> meldet die Sicherungsanzeige dauerhaft „keine Sicherung gefunden", während
> jede Nacht eine geschrieben wird. Und das **Board-Konto lässt sich in der
> Oberfläche gar nicht anlegen**: `AdminUsersView.vue` bietet nur „Nutzer" und
> „Admin"; die Präsentationsrolle geht nur über `POST /api/admin/users`.
>
> **Was schlicht nicht stimmte:** drei Seiten führten ein Verzeichnis `tools/`,
> das es nur in der VPS-Variante gibt · zwei Befehle scheitern ohne `sudo`
> (`.env` ist 600, die Sicherungsarchive auch) · die Fehlersuche empfahl
> Befehle für eine Bare-Metal-Betriebsform, die es nicht mehr gibt, und ein
> `npm ci` auf dem Server, wo kein Quelltext liegt · „Assistent erscheint,
> obwohl Konten existieren" war genau **verkehrt** erklärt · der Papierkorb
> deckt **vier** Datenarten ab, nicht alle · Benachrichtigungen gibt es nur
> beim **Anlegen** · `pdf-parse` ist kein natives Modul.
>
> **Neu dokumentiert, weil es der Code seit dieser Woche anders macht:** das
> Prüfprotokoll hält jeden Datenabfluss fest · die Ratebremse trägt nur hinter
> dem Proxy (daher die Regel „nie ein `ports:` am App-Container") · zwei Wege
> führen das JWT doch in die URL (SSE-Rückfall und jeder Datei-Download) · die
> Rücksicherung legt den alten Dokumentenstand daneben statt ihn zu
> überschreiben.
>
> **`package.json` steht jetzt auf 1.1.0.** Die Doku kündigte den
> Migrationsschritt seit dem 01.09. unter dieser Nummer an, der Code trug noch
> 1.0.0 — das nächste Paket hätte `patio-1.0.0.tar.gz` geheißen und das vorige
> überschrieben. Das vorige Paket ist der Rückweg.
>
> ⚠ **Zum Verfahren, ehrlich:** Die Prüfung lief als Workflow und ist **dreimal
> am Sitzungslimit** gescheitert — beim ersten Lauf starben 158 von 242
> Agenten, darunter **alle acht Schreiber**. Geschrieben habe ich am Ende
> selbst, jeden Befund vorher noch einmal am Code nachgemessen. Ein
> ausgefallener Skeptiker zählte dabei nie als Zustimmung.
>
> ⚠ **WSL fährt zwischen den Aufrufen herunter und nimmt `patio-test-db` mit.**
> Ein `npm test` über mehrere Minuten schlägt dann mitten im Lauf um
> (66 Dateien rot, Meldung `Test timed out`) — es sieht nach einer Regression
> aus und ist keine. Abhilfe: vorher `wsl -d Ubuntu-24.04 -- bash -lc 'sleep
> 900'` im Hintergrund starten. Danach 850 bestanden, 2 übersprungen.
>
> ### Stand 02.09.2026 — der Rest: AP2, AP6 und was die Selbstprüfung fand
>
> **850 Prüfungen** (vorher 801), fünf Bereiche, jeder Fix mit Gegenprobe.
> Uncommittet auf `main`.
>
> ⚠ **Ein Kontaktvermerk zu einem Team-Mitglied war noch NIE sichtbar.**
> `jsonb_typeof` sagte bei **223 von 223** Zeilen `string` — der Leser prüft
> `Array.isArray`, fällt durch, liefert `[]`. Dieselbe Schreibform steckte in
> **sieben** Spalten, nicht in fünf, wie mein eigener Kommentar behauptete;
> und bei zweien fangen die Leser sie **nicht** ab: `users.settings` war beim
> nächsten Speichern weg. Der Leser bleibt nachsichtig (Altbestand,
> forward-only) und kennt jetzt **drei** Formen — die dritte
> (`["[]", "[{…}]"]`) entsteht durch das `||`-Anhängen auf zwei jsonb-**Zeichen-
> ketten** und wäre einem zu einfachen Leser durchgerutscht: `Array.isArray`
> ist dort wahr.
>
> **AP2 Löschen und Rechte.** `DELETE /team/:name` hatte **keine Zeile**
> Rechteprüfung — jedes angemeldete Konto konnte jedes Mitglied entfernen, mit
> vier Fremdschlüsseln und zwei Triggern dahinter und ohne Papierkorb. Zwei
> gleichnamige Mitglieder gingen beide. Bei Dateien prüften Rechte und Wirkung
> **verschiedene Zeilen** (streng über die ID / zusätzlich über den
> Dateinamen). Und das Abhaken einer Aufgabe lief **projektübergreifend**: Die
> Route gab den Projektnamen mit, `complete()` nahm ihn gar nicht entgegen.
> Dazu der Papierkorb-Filter an fünf Stellen — in der Aktivitätsliste stand
> das Gelöschte durch `trg_tasks_updated_at` **ganz oben**.
>
> ⚠ **Zwei Wege am Datei-Verbot des Anzeigekontos vorbei:** Die **Suche** gab
> ihm Dateinamen und 200 Zeichen ausgelesenen Dokumententext aus jedem
> Projekt (Freitextfeld `snippet` — weder Geld- noch Personendaten-Filter
> greifen dort), und die **SSE-Meldung** über einen Upload trug als `id` den
> Dateinamen, beim Sammelupload eine ganze Liste. Entscheid Julius:
> Datei-Treffer für diese Rolle ganz weglassen.
>
> ⚠ **Eine Regression aus der eigenen Runde:** Ich hatte in `DashboardView.vue`
> die lokale Datumsfassung entfernt, die deutsche Werte abfing.
> `new Date("05.09.2026")` ergibt **Sat May 09 2026**, `new Date("15.09.2026")`
> ergibt `Invalid Date`. Aus sichtbar falsch wurde **plausibel falsch**.
> Behoben an EINER Stelle (`toDate()`), weil zehn Formatierer daran hängen.
> `tasks.date` ist weiterhin TEXT — die Prüfung beim Schreiben ist ergänzt, der
> Typwechsel wäre Migration 061 und ein eigener Schritt.
>
> **Die 409-Sackgasse — die Kehrseite meiner eigenen `rev`-Arbeit.** In drei
> Ansichten konnte man nach einem Konflikt **gar nicht mehr speichern**: Der
> nächste Versuch schickte denselben veralteten Zähler. Beim Positionskatalog
> hätte der naheliegende Fix (`load()` im `catch`) die Eingabe weggeworfen —
> dort SIND die Listenobjekte der Entwurf. Geprüft wird auf Wirkung:
> speichern → 409 → **noch einmal speichern → 200**.
>
> ⚠ **`useEvents` hatte zwei Zustände ohne Rückweg**, beide aus dem Umbau vom
> 01.09.: nach ~5,5 Minuten Verbindungsverlust (kürzer als ein `patio update`)
> wurde nie wieder verbunden, und ein hängender Ticket-Abruf verhinderte
> **stumm** jeden weiteren Versuch. Die Zuhörer für `online`/`visibilitychange`
> gehören auf Modul-Ebene — in `onMounted` hätten dreizehn Aufrufstellen
> dreizehn davon angehängt.
>
> ⚠ **Der Bau brach ab, während der Prüflauf grün war.** Ein HTML-Kommentar
> mitten in einem öffnenden Tag (`ProjectZugriffTab.vue`): `vue-tsc` meldet
> nichts, ESLint sieht `.vue` gar nicht an, `npm test` grün — Vite:
> `SyntaxError: Illegal '/' in tags`. Genau die Konstellation, die den
> Docker-Bau schon einmal 45 Commits lang kaputt hielt. Neuer Wächter in
> `tests/vue-komponenten-importiert.test.ts` (übersetzt jedes Template mit
> demselben Compiler, den Vite benutzt); Gegenprobe: Wächter rot, `vue-tsc`
> grün.
>
> **Kleineres:** ein falsches Passwort lud die Anmeldeseite neu und löschte die
> Meldung · eine Notiz meldete Erfolg ohne zu speichern · Benachrichtigungen zu
> Aufgaben und Terminen trugen **nie** einen Projektbezug (nur Besprechungen
> gaben ihn mit) · über die Projektakte angelegte Aufgaben/Termine hatten
> keinen Verfasser · Standardvorlage wechselte in zwei Anweisungen ohne
> Transaktion · Upload meldete `success: true` trotz Fehlschlägen · ein
> Datenabfluss wurde protokolliert, **bevor** feststand, dass etwas ausgeliefert
> wird · die Druckansicht blendete Klassen aus, die es nicht mehr gibt · 20
> Gestaltungsklassen waren nirgends definiert.
>
> ⚠ **Fünf falsche Kommentare aus der eigenen Runde korrigiert** — darunter
> „fünf Spalten, die Leser fangen es ab" (sieben, zwei fangen es nicht) und
> „das Board hat NIE einen Termin gezeigt" (die ISO-Auto-Meilensteine schon;
> richtig ist: kein von Hand angelegter).
>
> ⚠ **Ehrlich zum Stand der Prüfung:** Die adversariale Runde ist erneut
> **nicht** gelaufen (Sitzungslimit am 01.09.). Von den 37 Befunden der
> Suchphase sind fünf von Hand am System nachgemessen — alle fünf stimmten —,
> die übrigen nach Aktenlage eingeordnet und behoben. Das ist weniger als eine
> Widerlegungsrunde. Ebenfalls offen: der Browser-Nachweis für die geteilte
> SSE-Verbindung und die Konflikt-Sackgassen; dafür müsste der Stand in WSL
> ausgerollt werden, dort läuft das alte Image.
>
> **Bewusst nicht behoben:** Der Rückfall auf `token=<JWT>` in der SSE-URL,
> wenn der Ticket-Abruf scheitert. Er hebt den Zweck des Einmal-Tickets auf
> (das JWT landet in Caddys Zugriffslog), ihn zu streichen hieße aber, bei
> einem Ticket-Ausfall gar keine Live-Updates mehr zu haben. Abwägung, keine
> Fehlerbehebung — gehört Julius vorgelegt.
>
> ### Stand 30.08.2026 — Verteilweg, Ratebremse nachgemessen, Zeitstempel
>
> **Die Anleitung zum Arbeitsplatz-Programm zeigte noch auf die abgeschaffte
> Freigabe** — `docs/betrieb/arbeitsplatz.md` hatte der Samba-Ausbau nicht
> angefasst. Sechs Stellen in drei Seiten liessen die `.exe` von einem
> Netzordner starten, den es nicht mehr gibt; jetzt steht dort der USB-Stick,
> auf dem ohnehin Paket und Wurzelzertifikat liegen — samt dem Hinweis, dass
> eine neue Fassung die Datei **an jedem Platz einzeln** ersetzt.
>
> ⚠ **Die Ratebremse haengt vollstaendig an Caddy — an der laufenden Anlage
> nachgemessen.** Direkt gegen den Dienst gerichtet nimmt die App
> `x-forwarded-for` ungeprueft (der Eintrag `login.fail` trug die gefaelschte
> IP); ueber Caddy 2.11.4 wird der Header ERSETZT, und der zweite Versuch
> bekam 429. Betriebsregel daraus, jetzt am Code: **der App-Container darf nie
> ein `ports:` bekommen.** Ein zweiter Proxy davor macht den rechtesten
> Eintrag zum richtigen, nicht den linken.
>
> **Notiz-Auswahl ohne definiertes Ergebnis** (CI-Fehlschlag): `findeNotiz`
> sortiert `ORDER BY rang, created_at DESC`, der Zeitstempel kam aber aus
> JavaScript — Millisekunden. Zwei schnell aufeinanderfolgende Notizen trugen
> denselben Wert, Postgres darf dann beliebig sortieren. Lokal fiel es nie
> auf, weil die Test-DB an der WSL-IP haengt; auf demselben Host kollidierten
> **20 von 20 Paaren**. `DEFAULT now()` genuegt NICHT (Transaktionszeit,
> postgres.js buendelt die INSERTs) — erst `clock_timestamp()`, dazu
> `id DESC` als Tiebreaker.
>
> ### Stand 24.08.2026 — 733 Tests (damals), Migrationen bis 059
>
> **AP9 ist fertig.** Der Fokus-Modus (Schritt 3) steht: `ContextSidebar.vue`
> trägt in der Projektakte die Reiter, in den Einstellungen die Bereiche; die
> Navigationsleiste schrumpft dafür auf 60 px. Ausgelöst über `meta.focus` an
> der Route, nicht über den Routennamen.
>
> - Die Projekt-Navigation ist **aus der NavRail ausgezogen** — sie wechselte
>   dort ihren Inhalt, und wer im Projekt arbeitete, kam ohne Umweg nicht mehr
>   zu den Aufgaben.
> - Die Einstellungen haben ihr **eigenes Menü verloren** und merken sich den
>   Bereich als `?sektion=` statt im localStorage.
> - **Die Listen stehen nur noch einmal:** `views/projekt-tabs.ts` und
>   `views/settings-nav.ts`. Vorher standen die Reiter doppelt (`VALID_TABS`
>   in der Ansicht, `PROJECT_NAV` in der Leiste) — liefen sie auseinander,
>   setzte die Leiste ein `?tab=`, das intern auf „uebersicht" zurückfiel und
>   trotzdem aktiv markiert blieb.
> - **Rechtefilter**, den die Desktop-Vorlage nicht hat: dort gibt es keine
>   Rollen. Ungefiltert böte die Leiste jedem Konto „Rechnungen" und „Zugriff"
>   an, die der Server dann mit 403 abweist.
>
> ⚠ **Der größte Fund des Tages hat nichts mit AP9 zu tun:** `<style scoped>`
> gilt nur in der eigenen Komponente. **44 Klassen** waren in einer Ansicht
> definiert und in einer anderen benutzt — dort ohne jede Wirkung, ohne
> Fehler, ohne Warnung. Die Aufgaben-Ansichten „Matrix" und „Mein Tag" liefen
> seit ihrem Bau vollständig ungestaltet, ebenso die Stammdaten-Felder der
> Team-Seite und die roten Lösch-Schaltflächen. Jetzt `web/src/patio-fach.css`
> plus `tests/web/geteilte-klassen.test.ts` als Wächter.
>
> Weitere Funde: `.mehr-laden` war **nirgends** definiert; „heute" wurde an
> sieben Stellen nach UTC bestimmt (drei davon füllten das Datum eines neuen
> Datensatzes vor — ein Bautagebuch-Eintrag um 00:30 bekam den Vortag, jetzt
> `heuteIso()`); und der Bereichs-Wächter der Einstellungen warf jeden
> Verwalter aus einem per Lesezeichen geöffneten `?sektion=branding`, weil er
> entschied, bevor `/auth/me` geantwortet hatte.
>
> **Die Projektakte ist von 6128 auf 3760 Zeilen** — sieben von dreizehn
> Reitern sind eigene Komponenten unter `projects-v2/` (Phasen, Rechnungen,
> Entscheidungen, Bautagebuch, Besprechungen, Stunden, Zugriff). Jeder lädt
> selbst. **Die übrigen sechs bleiben bewusst drin:** Übersicht, Notizen,
> Aufgaben, Termine, Dateien und Team lesen denselben Zustand, den der
> Projektkopf darüber rendert und der in einem Aufruf geholt wird — sie
> herauszulösen wäre eine Verdopplung mit Synchronisierung, keine Aufteilung.
>
> **Frontend-Tests gibt es jetzt** (`tests/web/`, 32 Prüfungen). Vorher hatte
> `web/` **null** Testdateien; geprüft wurde über `vue-tsc` und von Hand im
> Browser, und beides fängt keine Logik.
>
> ### Stand 23.08.2026 — 582 Tests, Migrationen bis 054
>
> Seit AP12 kamen drei Runden dazu (HEAD `ad9dde8`, gepusht):
>
> - **AP9 Schritt 1+2** (21.08.): SIMA-Designsystem und globale Topbar aus
>   PATIO Desktop übernommen. Schritt 3 (Fokus-Modus) fehlt noch — er setzt
>   eine Kontext-Seitenleiste voraus, die es serverseitig nicht gibt.
> - **Aufgabensystem Stufe 1** (Migrationen 050/051): Rang 1–4, grob
>   gerasterter Aufwand, Tagesplan je Person, Tageswechsel um Mitternacht.
>   Drei neue Ansichten im Aufgabenreiter (Eingang, Matrix, Mein Tag), der
>   Umschalter sitzt in der **Topbar** — die einzige Stelle, die in allen vier
>   Arbeitsweisen gleich liegt. Doku: `docs/konzepte/aufgabensystem.md`.
>   Der Verfall von Rang 4 nach 30 Tagen ist inzwischen gebaut
>   (`RANG4_VERFALL_TAGE`, Wartungslauf 03:15 — verfallen heisst Papierkorb,
>   nicht geloescht).
> - **Die Projektnummer ist die Kennung** (Migrationen 052–054): Pflicht,
>   eindeutig über `lower()` (Papierkorb eingeschlossen), frei im Format,
>   dritte Adressierungsform `?projektnummer=`, in 14 Ansichten, in Dateinamen
>   und als Vorschlag für Rechnungsnummern; frühere Nummern bleiben auffindbar.
>   Doku: `docs/konzepte/projektnummer.md`.
>
> **Dabei dreizehn Rechte-Lücken geschlossen** (alle Altbestand, jede vor dem
> Fix rot nachgewiesen) — acht Projekt-Unterrouten ohne Prüfung, `POST
> /projects` als Beitritt zu jedem fremden Projekt, drei Team-Routen, der
> Vorlagen-Export. Vollständige Liste: `docs/sicherheit/zugriff.md`.
>
> ⚠ **Zwei Fallen, die hier viel Zeit gekostet haben:** ein in einer `.vue`
> benutzter, aber nicht importierter Komponentenname fällt durch *jede*
> Prüfung (`tests/vue-komponenten-importiert.test.ts` fängt das jetzt), und
> Postgres' `lower()` weicht von JavaScripts `toLowerCase()` ab — Nummern
> werden deshalb auf beiden Seiten der Abfrage von der Datenbank verglichen.
>
> **Die Warteschlange aus Abschnitt 0 des Plans
> (`~/.claude/plans/dynamic-floating-pearl.md`) ist vollständig abgearbeitet —
> Stufe 1 bis 6.** 265 → 399 Tests, Migrationen 042–049.
>
> **Danach eine eigene Analyserunde** (Abgleich aller 175 Routen gegen die
> Oberfläche, Suche nach TODOs und toten Pfaden). Sie hat drei Dinge zutage
> gefördert, die in keiner Warteschlange standen:
>
> - **Notizen: Rechteprüfung und Zugriff betrafen verschiedene Datensätze.**
>   Zwei Auflöser mit unterschiedlicher Sortierung — bei gleichnamigen Notizen
>   wurde die eine freigegeben und die andere ausgeliefert, auch aus einem
>   fremden Projekt. Jetzt ein Auflöser, danach nur noch über die ID.
>   Im selben Zug das TODO aus `notes.ts:26`: eine Notiz ohne Projekt gehört
>   ihrem Verfasser (vorher konnte man sie anlegen und nie wieder sehen).
> - **Der Dokumentenordner war über HTTP offen.** `GET /files/read?path=`,
>   `POST /files/mkdir` und `DELETE /files {path}` arbeiteten ohne jede
>   Rechteprüfung im Dateisystem — dem Samba-Verzeichnis „Dokumente". Entfernt
>   statt bewacht: Dateien liegen als `bytea` in der Datenbank, die Wege waren
>   von der Oberfläche nie erreichbar.
> - **Firmenverwaltung war unerreichbar.** Die API gab es seit Migration 006
>   vollständig, aber kein `/companies`-Aufruf im Frontend. Neu: Ansicht
>   `Firmen` samt **Zusammenführen** von Dubletten, die durch die
>   automatische Anlage aus Freitext entstehen.
>
> | Stufe | Ergebnis |
> |---|---|
> | 1 Datenverlust | `db-notes` rät nicht mehr; Konflikt-Zähler `rev` auf allen neun bearbeitbaren Datenarten (042) |
> | 2 Rechte | Word-Export war die offene Hintertür; bürointerne Konfiguration war für jeden schreibbar; **Geld-Recht** (043); Team-Liste verriet alle Projektnamen |
> | 3 Papierkorb | Löschen setzt nur noch `deleted_at` (044); Kaskaden feuern erst beim endgültigen Entfernen |
> | 4 Fachliches | Entscheidungslog (045) · Rechnungspositionen + Positionskatalog (046) · Aktivität · Sicherungs-Status · `?projectId=` |
> | 5 Altbestand | 72 tote `DB_ENABLED`-Abfragen; JSON-Konten abgeschaltet; sechs Tabellen der Bot-/Outlook-Ära entfernt (047) |
> | 6 Suche | `tsvector` mit deutschen Wortstämmen + `ts_rank`, ILIKE bleibt für Wortteile in kurzen Feldern (048) |
>
> **Danach eine Aufräumrunde über alle offenen Punkte** („bitte alles
> fixen"):
>
> - **Zwei Ablagen, damals klar getrennt** (seit dem 29.08.2026 gibt es nur
>   noch eine — die Freigabe ist entfallen). Die Freigabe „Dokumente" war ein
>   normaler Netzordner für Pläne, CAD und große Scans; in PATIO Hochgeladenes
>   liegt in der Datenbank, mit Projektbezug, Rechten und Volltextsuche. Die
>   Anwendung fasst den Ordner nicht an. Dabei gefunden: das Löschen einer
>   Datei nahm die **gleichnamige Datei in der Freigabe** mit.
> - **Papierkorb für Notizen, Aufgaben und Termine** (Migration 049), für alle
>   nutzbar statt nur für die Verwaltung. Dabei gefunden:
>   `db-termine.delete()` löschte per `LIKE` — jeder Termin mit „Abnahme" im
>   Text wäre mitgegangen.
> - **Auth aufgeräumt.** Der JSON-Zweig steckte noch in der Middleware und
>   leitete daraus die Rolle ab. Damit fielen auch die letzten 20 toten
>   `DB_ENABLED`-Abfragen (95 von 109 insgesamt entfernt).
>
> **Bewusst NICHT gemacht:** `?projectId=` bis in die Repos durchziehen. Die
> Auflösung an einer Stelle (`src/api/projekt-bezug.ts`) kostet eine Abfrage
> je Anfrage und leistet dasselbe; alle zwölf Repos auf IDs umzustellen wäre
> ein Umbau quer durch den Baum ohne Gewinn für irgendjemanden.
>
> **Danach AP12 — das Arbeitsplatz-Programm.** Am Arbeitsplatz läuft kein
> Browser, sondern ein Programm. Die Electron-Hülle ist aus PATIO Desktop
> **kopiert** (`apps/patio-app-lokal` bleibt unangetastet) und entkernt: aus
> „Programm startet Server" wird „Programm findet Server". Die Oberfläche
> musste dafür nicht angefasst werden — sie spricht durchgehend relative
> Pfade, ihr ist die Herkunft gleich.
>
> | | Was |
> |---|---|
> | Gestrichen | `boot()` mit den drei dynamischen `import()`, die lokale API, Vault-Verwaltung, MCP-Dossiers, Shared-Secret, `process.chdir` |
> | Übernommen | Fenster, Tray mit Autostart, „Schließen minimiert", Menü, Symbol |
> | Neu | `electron/adresse.ts` (reine Logik, 13 Tests) · `server-store.ts` · `einrichtung.html` als Ersteinrichtung **und** Fehlerseite · Einzelinstanz-Sperre · Download-Rückmeldung |
> | Dazu | Der Server liefert die Doku unter `/docs/` aus — F1 war vorher tot |
>
> **Drei Befunde beim Bauen:** `normalisiereAdresse()` verbog jedes fremde
> Schema zu einem Unsinns-Rechnernamen (`file:///C:/Windows` → `https://file`);
> der harte `app.setPath("userData", …)` hebelte `--user-data-dir` aus und
> machte das gepackte Programm unprüfbar; und die Doku zog per `@import`
> **Inter von Google Fonts** — derselbe Außenkontakt, den AP1 Teil H aus der
> Oberfläche entfernt hat, nur eben in der Datei, die ab jetzt mit ausgeliefert
> wird.
>
> **Das Paket enthielt den kompletten Server-Baum.** `files:` steuert nur die
> App-Dateien; Produktions-Abhängigkeiten packt electron-builder von sich aus
> dazu — 2896 Einträge im Archiv, davon sechs eigene, inklusive nativ neu
> übersetztem bcrypt. Mit `!node_modules/**/*`: **8 Einträge, 86 statt 105 MB**.
>
> **Verifiziert, nicht behauptet:** `scripts/pruefe-arbeitsplatz.mjs` fährt das
> Programm wirklich und liest über das Chrome-DevTools-Protokoll aus, was im
> Fenster steht. **28/28 gegen die gepackte `.exe`** — Erststart, Fehleingabe
> (deutscher Klartext statt `net::ERR_*`), Serverabriss mitten in der Arbeit
> (die `/login`-Navigation der Oberfläche landet auf der eigenen Seite, nicht
> auf Chromiums Fehlerseite), Einzelinstanz-Sperre. Auf der Maschine belegt:
> `%APPDATA%/PATIO-Arbeitsplatz` entsteht **neben** dem unberührten
> `%APPDATA%/PATIO` von PATIO Desktop.
>
> **`PATIO-Arbeitsplatz-0.1.0-portable.exe` ist gebaut und signiert**
> (`CN=Julius Sima`). Vorerst nur portabel: NSIS leitet das
> Installationsverzeichnis aus `productName` ab und liefe sonst über die
> bestehende PATIO-Desktop-Installation.
>
> ⚠ **Der Prozessname kollidiert ebenfalls.** Beide Programme heißen im
> Prozessbaum `PATIO`. Ein `Get-Process PATIO | Stop-Process` beendet PATIO
> Desktop mit — unterschieden wird nur über den Pfad
> (`%LOCALAPPDATA%\Programs\PATIO` gegen `%TEMP%`). Steht als Warnung im
> Prüfstand; sauber gelöst wäre es erst, wenn PATIO Desktop bei seinem nächsten
> eigenen Bau auf `productName: PATIO Desktop` geht.
>
> **Offen und nur am Arbeitsplatz prüfbar** (Plan AP12 Teil A): ob Electron dem
> Zertifikat der internen CA nach dem Import traut. Dafür braucht es einen
> Server mit interner CA und einen echten Windows-Arbeitsplatz — hier **nicht**
> geprüft.
>
> **Was als Nächstes ansteht:** Der Bug-Plan ist mit dem Stand 02.09.2026
> **abgearbeitet** (AP1–AP6 plus die Befunde der Selbstprüfung). Offen bleiben
> daraus nur drei bewusste Entscheidungen: der **Typwechsel von `tasks.date`**
> (wäre Migration 061, eigener Schritt mit eigener CSV-Gegenprobe), der
> **JWT-Rückfall in der SSE-URL** (Abwägung, gehört vorgelegt) und der
> **Browser-Nachweis** für die geteilte SSE-Verbindung und die
> Konflikt-Sackgassen. Danach **AP17** VPN (bringt den zweiten Faktor zurück).
> AP9 bis AP15 sind abgearbeitet.
>
> **Bewusst offen geblieben**, mit Begründung im jeweiligen Commit:
> - Ein **Papierkorb für einzelne Datensätze** (Notizen, Aufgaben, Termine).
>   Stufe 3 zielt auf Projekte, dort ist der Schaden größer.
> - Der **Vault-Zweig im Datei-Upload** ist unerreichbar, aber sein Ausbau
>   baut die Upload-Route um — eigener Schritt, keine Aufräumrunde.
> - **`?projectId=` in den Repos.** Aufgelöst wird an einer Stelle
>   (`src/api/projekt-bezug.ts`); alle zwölf Repos auf IDs umzustellen wäre
>   sauberer, aber ein Umbau quer durch den Baum ohne zusätzlichen Gewinn.

**AP0 abgeschlossen.** Entfernt: Telegram-Bot, LLM-/Agenten-Laufzeit,
MCP-Client, Embeddings, DuckDuckGo-Websuche, Outlook-Abgleich und die
Filesystem-Repos — rund **16.000 Zeilen**. Der Einstiegspunkt `src/index.ts`
ist nicht mehr bot-, sondern API-zentriert.

**Es gibt keinen Dateisystem-Modus mehr.** Der Dienst laeuft immer gegen
PostgreSQL, und `src/index.ts` bricht ohne `DATABASE_URL` bzw. `JWT_SECRET`
hart ab — vorher lief er weiter, galt fuer Docker als gesund und lieferte bei
jedem Datenzugriff einen 500er. Alle Repos sind non-nullable; die 503-Guards
sind aus den Domaenen-Routen verschwunden, in `src/api/routes/files.ts` stehen
in `src/api/routes/files.ts` **keine** mehr — die 17 Altbestand-Abfragen, die
hier lange standen, sind mit `6a0ea8f` (06.08.) entfallen.
Von `src/workspace/` bleibt nur der echte Dateizugriff (1.774 → 245 Zeilen) —
Dokumente liegen weiterhin als Dateien.

**AP1 abgeschlossen (2026-08-06).** Der Server kann aufgesetzt werden:
Anmeldung, Compose-Stack, Zertifikat, Sicherung, Offline-Updates
und das Einrichtungshandbuch stehen. Fünf Commits (`01a933f`…`e82c2a3`),
**265 Tests**.

> **Die Anmeldung ist einstufig — Passwort, kein zweiter Faktor** (Entscheid
> Julius, 2026-08-06). Der E-Mail-Zweig ist ersatzlos entfallen: er verzweigte
> JEDEN Datenbank-Benutzer in den SMTP-Versand, der ohne Internet scheiterte —
> niemand kam hinein außer über das einstufige JSON-Konto. Mindestlänge 12,
> bcrypt 12, beides zentral in `src/config.ts`. `src/api/totp.ts` und
> `routes/auth-2fa.ts` bleiben **unangetastet** liegen; der zweite Faktor
> kommt mit dem VPN (AP17) zurück.

> **Betriebsform: alles in Docker.** `docker-compose.yml` im Repo-Root ist der
> in sich geschlossene Firmenserver-Stack (postgres + app + caddy); die
> VPS-Variante liegt unter `docker/docker-compose.vps.yml`. Auf dem Server
> wird **nie gebaut** — `scripts/release-offline.sh` schnürt ein Paket,
> `scripts/update-offline.sh` spielt es ein.

> **TLS aus einer eigenen lokalen CA** (`tls internal` in `docker/Caddyfile`).
> Der private Schlüssel liegt im Volume `caddy_data` und **gehört in die
> Sicherung** — ohne ihn muss nach einem Wiederaufbau jemand an jeden
> Arbeitsplatz.

**Der Rest des JSON-Konten-Fallbacks** in `src/api/auth.ts` wartet weiter auf
AP7 (jetzt „Konten und Sitzungen").

> Die Migrationen `022`–`024` (Microsoft-Tabellen und die `ms_*`-Spalten an
> `termine`) bleiben vorerst stehen — forward-only, und ein `DROP` wäre
> unumkehrbar. Sie werden mit dem Schema-Paket abgeräumt.

> **pgvector wird nicht mehr gebraucht.** `001_init.sql` legt weder die
> Extension noch Vektor-Spalten an, `040` raeumt die Reste aus bestehenden
> Datenbanken, `041` entfernt die Extension selbst (mehrfach abgesichert: ist
> sie nicht da oder haengt eine fremde Spalte daran, passiert nichts). Beide
> Compose-Dateien laufen auf `postgres:16`. Nachgewiesen an einer frisch
> migrierten Datenbank: nur `pg_trgm`, `plpgsql`, `unaccent`, `uuid-ossp`.
> `tests/db.test.ts` haelt das fest — der Sweep ueber alle Migrationsdateien
> laeuft **ohne** Datenbank und greift damit auch in einer DB-losen CI.

**Was als Nächstes ansteht** (Reihenfolge aus dem Plan): Volltextsuche auf
`tsvector` heben · Schema ergänzen · Konfliktschutz (`rev`) · Papierkorb ·
Rückportierung aus `apps/patio-app-lokal` · Konten und Sitzungen · Rechte
scharf schalten · **Oberfläche aus PATIO Desktop übernehmen** (bestätigt
2026-08-06 — deshalb wurde in AP1 bewusst nicht ins heutige Frontend
investiert; das Desktop-Designsystem nutzt reine Systemschriften und ist
damit von sich aus außenkontaktfrei).

## Stack & Deployment

- **Backend:** Node.js + TypeScript + Hono (HTTP-API), PostgreSQL via
  postgres.js. Kein LLM, kein Bot, kein Außenkontakt im Betrieb.
- **Frontend:** Vue 3 (Composition API) + Vue Router + Vite + Tailwind v4
  (`web/`). **Kein Pinia** — das Paket ist entfernt, geteilter Zustand liegt in
  Composables (`useAufgabensystem`, `useEvents`, `useTheme`, `useBranding`).
- **Deployment:** ein in sich geschlossener Compose-Stack unter `/opt/patio`.
  Drei Container: `patio-postgres`, `patio-app`, `patio-caddy`. Nur Caddy hat
  Ports nach außen (80/443) und terminiert TLS mit einem Zertifikat aus der
  **eigenen lokalen CA**. Die SSE-Route `/api/events` wird ungepuffert
  durchgeleitet — wird sie gepuffert, bleiben Änderungen der Kollegen
  unsichtbar. Die frühere VPS-Fassung mit gemeinsamem `edge-caddy` liegt unter
  `docker/docker-compose.vps.yml`.

**Deploy/Update auf dem Server:** `git pull` gibt es dort nicht — der Rechner
hat kein Internet, und gebaut wird auf ihm nie.

```bash
# Entwicklungsrechner (DATABASE_URL ist Pflicht — sonst laufen die Tests halb)
DATABASE_URL="postgres://patio:patio@<WSL-IP>:5432/patio"   bash scripts/release-offline.sh

# Server, Paket per USB-Stick
sudo patio update patio-<version>.tar.gz
```

DB-Migrationen laufen beim Start automatisch (`DB_AUTO_MIGRATE`, default an).

## Befehle (aus dem Repo-Root)

```bash
npm run dev          # tsx watch src/index.ts (API)
npm run dev:web      # Vite Dev-Server fürs Frontend
npm run build        # tsc → dist/ (kopiert db/migrations/ mit)
npm run build:all    # tsc + Vite-Build von web/ + VitePress-Doku nach dist/docs
npm run start        # node dist/index.js (Produktion)

npm run build:electron   # Arbeitsplatz-Huelle nach dist-electron/
npm run electron:dev     # Huelle lokal starten
npm run dist             # portable .exe bauen (signiert, braucht das Zertifikat)

npm test             # vitest run (852 Pruefungen — nur MIT Datenbank vollstaendig, siehe unten)
npx vitest run tests/<file>.test.ts   # einzelne Datei
npm run lint  /  npm run lint:fix
npm run format

npm run db:migrate   # Migrationen anwenden (nur mit DATABASE_URL)
npm run db:status    # Migrations-Status anzeigen
```

Husky + lint-staged formatieren/linten gestagte `.ts`/`.vue`-Dateien beim
Commit; ein Pre-Push-Hook lässt `npm test` laufen.

> **Prüfbereiche:** `npm run lint` deckt `src/`, `tests/`, `scripts/`,
> `web/src` **und** `electron/` ab. `.vue`-Dateien
> bleiben aussen vor (kein `eslint-plugin-vue`), dafür greift `vue-tsc`.
> Für `scripts/` gibt es jetzt `tsconfig.scripts.json`: `npx tsc --noEmit -p
> tsconfig.scripts.json`. Grund: im damaligen Uebernahme-Skript (heute
> `scripts/import-vault.ts`) stand monatelang ein Import auf ein `VAULT_PATH`,
> das es gar nicht gibt — das Skript brach beim Start ab, und keine Pruefung
> sah je in den Ordner.

> **`npm test` ohne `DATABASE_URL` überspringt still 599 von 852 Prüfungen** —
> und zwar genau die ACL-, Auth- und DB-Tests (`describe.skipIf(!HAS_DB)` in
> 63 Testdateien; `HAS_DB` selbst kommt aus `tests/helpers/acl-fixture.ts`).
> Gemessen am 2026-09-02: `32 passed | 63 skipped (95)` Dateien,
> `253 passed | 599 skipped (852)` Prüfungen; mit Datenbank `850 passed |
> 2 skipped (852)`. **Diese Zahlen wandern mit jedem
> neuen Test** — wer sie hier liest, prüft sie besser einmal nach, statt sich
> auf sie zu verlassen. Der Punkt bleibt derselbe: die Farbe sagt nichts.
>
> ⚠ **Und dieser Lauf meldet GRÜN** — lokal weiterhin, bewusst. **In der CI
> nicht mehr:** seit dem 23.08.2026 läuft dort ein Postgres-Dienst mit
> (`.github/workflows/build.yml`), und `tests/waechter.test.ts` schlägt fehl,
> wenn `DATABASE_URL` in der CI fehlt (`process.env.CI`). Lokal ohne Datenbank
> zu arbeiten bleibt erlaubt — dort ist die Zahl der übersprungenen Dateien im
> Bericht sichtbar, und wer sie liest, weiß, woran er ist. In der CI liest
> niemand; dort zählt nur die Farbe. Trotzdem gilt lokal weiter: **auf die
> Zahl der übersprungenen Prüfungen sehen, nicht auf die Farbe.**
>
> **Diese Zahlen beim Hinzufügen von Tests mitpflegen.** Die
> Test-Datenbank ist der Container `patio-test-db` in **WSL Ubuntu-24.04**; von
> Windows aus ist sie **nicht** über `localhost` erreichbar, es braucht die
> WSL-IP (`wsl -d Ubuntu-24.04 -- hostname -I`, ändert sich bei jedem Start):
>
> ```bash
> DATABASE_URL="postgres://patio:patio@<WSL-IP>:5432/patio" npm test
> ```

## Architektur-Kern

- **Entry:** `src/index.ts` — lädt `.env` → DB-Healthcheck + Auto-Migrate →
  Hono-API. Einziges Support-Modul: `maintenance.ts` (Audit-Retention-Cron).
- **Data-Layer:** `src/data/index.ts` ist die **einzige** Import-Fläche — nie
  direkt aus `db-*` importieren. Alle Repos sind Postgres und non-nullable;
  einen Filesystem-Fallback gibt es nicht mehr.
- **Volltextsuche:** `src/data/db-search.ts` — sucht über Notizen, Aufgaben,
  Projekte und Dateien und **filtert nach sichtbaren Projekten** (die alte
  Suche tat das nicht). Sucht ueber `tsvector` mit deutscher Textkonfiguration
  (Migration 048, `websearch_to_tsquery` + `ts_rank`). `ILIKE` ist bewusst
  geblieben — fuer Wortteile in kurzen Feldern wie Projekt- und Dateinamen,
  wo eine Wortstamm-Suche nicht greift.
  **Typ-Casts sind Pflicht:** `project_id` ist `uuid`, die Scope-IDs kommen als
  Strings — ohne `::uuid[]` wirft Postgres `operator does not exist: uuid =
  text`, und zwar nur bei Nicht-Admins (siehe `tests/api-search-acl.test.ts`).
- **Migrationen:** plain SQL in `src/db/migrations/`, `NNN_name.sql`,
  forward-only, idempotent (`IF NOT EXISTS` / DO-Block-Guards). Runner
  (`src/db/migrate.ts`) trackt per Dateiname in `_migrations` (keine
  Prüfsumme), jede Migration in eigener Transaktion, Advisory-Lock gegen
  parallele Starts. **62 Dateien, aktuellste `060_termine_datum_als_date.sql`** (`055`
  raeumt den letzten Bot-Rest, `056` die Outlook-/Telegram-Spalten, `057` die
  Zuordnungstabelle der Datenuebernahme, `058` die Benachrichtigungen, `059`
  die KI-Freigabe, `060` hebt `termine.datum` von TEXT auf `date`).
  **Schema-Lektion:**
  Beim JOIN müssen Typen passen — `034` hat `chat_messages.session_id` von TEXT
  auf UUID umgestellt (passend zu `chat_sessions.id`), sonst
  `operator does not exist: text = uuid`.
- **Projektsteuerung (PM, Migrationen 035–038):** Leistungsphasen
  (`035_project_phases`, Routes `phases.ts`, Repo `db-phases.ts`, Web
  `projects-v2/ProjectPhasesTab.vue`) · **Gantt-Zeitleiste** mit
  Phasen-Abhängigkeiten + Auto-Meilenstein (`038_phase_gantt`) · **Honorar-
  Ökonomie**: Stundensatz + Deckungsbeitrag (`037_hourly_rate`,
  `036_time_entry_phase`) · **Rechnungen** (Routes `invoices.ts`, Repo
  `db-invoices.ts`, Web `projects-v2/ProjectInvoicesTab.vue`; ACL beachtet) ·
  **Portfolio-Cockpit** (Routes `portfolio.ts`, Repo `db-portfolio.ts`, Web
  `views/portfolio/`) mit echten Fortschrittszahlen. `039` benennt nur den
  internen Kalender-Enum-Wert (`bau-os` → `patio`) um.
- **Web-API + Frontend:** Hono in `src/api/server.ts` (Port `API_PORT`,
  default 3000), JWT-Auth (`authMiddleware` setzt `userId`/`userRole`/
  `dbUser`). Routes in `src/api/routes/` spiegeln die Tool-Fläche. Vue-SPA
  in `web/` — App-Shell `web/src/components/AppLayout.vue` (3-Spalten-Grid
  `.app-v2`: NavRail + ListPane + Detail).
- **Config:** `src/config.ts` — alle Tunables als Konstanten.

## Frontend / PATIO Design System v2 (WICHTIG bei UI-Arbeit)

Das gesamte Frontend wurde auf das **PATIO Design System v2** umgestellt
(Stand Juni 2026). Beim Bauen an Views unbedingt einhalten:

- **Design-Tokens sind die einzige Quelle der Wahrheit:**
  `web/src/patio-tokens.css` (Brand/Produkt — identisch mit der Mainpage, kein
  zweites Brand-System), `patio-components.css` (Komponenten-Styles wie
  `ap-panel`/`ap-grid`/`pt-tabs`), `patio-shell.css` (App-Shell-Layout),
  `patio-fach.css` (Klassen, die mehrere Fach-Ansichten teilen). Keine
  Hardcode-Farben/-Abstände — Tokens (`var(--…)`) verwenden. Niveau-Referenz:
  Linear/Vercel/Stripe; Prinzip: monochrom, flach, präzise, viel Ruhe.
  Schrift: **ausschliesslich Systemschriften** — `--font-sans` und
  `--font-display` sind `"Helvetica Neue", Helvetica, Arial`, `--font-mono` ist
  `ui-monospace, Consolas`. **Keine Webfonts**, kein Inter: die Oberfläche darf
  nichts nachladen.
- **Shell-Bausteine** in `web/src/components/shell/`: `NavRail`,
  `ContextSidebar`, `AppTopbar`, `ListPane`, `DetailPane`, `IconBtn`,
  `Avatar`, `StatusDot`. Die NavRail ist **nicht** mehr kontext-wechselnd —
  im Fokus-Modus (Projektakte, Einstellungen) schrumpft sie auf 60 px, und die
  `ContextSidebar` (238 px) trägt die Modul-Navigation. Ausgelöst über
  `meta: { focus: true }` an der Route; `AppLayout.vue` leitet `data-focus`
  daraus ab.
- ⚠ **`<style scoped>` gilt NUR in der eigenen Komponente.** Wird eine dort
  definierte Klasse in einer zweiten Ansicht benutzt, greift sie nicht — ohne
  Fehler, ohne Warnung, ohne Bau-Problem. Am 24.08.2026 traf das 44 Klassen in
  zehn Ansichten. Was geteilt wird, gehört nach `patio-fach.css`;
  `tests/web/geteilte-klassen.test.ts` meldet jeden neuen Fall.
- **v2-Views** liegen in `web/src/views/<bereich>-v2/` (`notes-v2`,
  `projects-v2`, `tasks-v2`, `team-v2`) im ListPane/DetailPane-Muster. Daneben
  existieren noch ältere Top-Level-Views (`NotesView.vue`, …) — beim Weiterbauen
  die **v2-Variante** bevorzugen.
- **Projekt-Detail** (`ProjectDetailView.vue`) läuft im Fokus-Modus; die
  Reiter stehen in der `ContextSidebar`. **Welche Reiter es gibt, steht in
  `views/projekt-tabs.ts`** — dieselbe Quelle, aus der `VALID_TABS` abgeleitet
  wird. Für die Einstellungen leistet `views/settings-nav.ts` dasselbe.
  Sieben Reiter sind eigene Komponenten unter `projects-v2/`; die übrigen
  sechs teilen ihren Zustand mit dem Projektkopf und bleiben bewusst drin.
- **Neue Ansichten brauchen einen Test unter `tests/web/`.** `vue-tsc` prüft
  Typen, nicht ob ein `v-if` das Richtige trifft oder ein Feld im Template
  anders heißt — genau diese Klasse Fehler ist hier mehrfach durch alle
  Prüfungen gekommen.
- **Keine Emojis in der UI.** Stattdessen Line-Icons über `BIcon.vue` (Glyph in
  `BIcon.vue` ergänzen) oder schlichten Text.

## Commit- & Verifikations-Strategie

- Pro Feature ein Commit, mit Migration-Referenz bei Schema-Änderungen.
- Vor jedem Commit: `npx tsc --noEmit`,
  `npx vue-tsc --noEmit -p web/tsconfig.json`, `npm test`.
- Push auf `main` bringt nichts auf den Server: der hat kein Internet und
  kein Git. Ausgeliefert wird ueber `scripts/release-offline.sh` (Paket
  schnueren) und `sudo patio update <paket>` (einspielen), siehe Deploy oben.
- Lokale `.claude/`-Tooling-Ordner **nicht** committen (kein `git add -A`).

## Tonalität in Code & UX

**Wer benutzt das? Ein Architekt am Schreibtisch, kein Bauarbeiter auf der
Leiter.** Texte und Workflows strukturiert, präzise, doku-orientiert.
Bürodeutsch, kein Hype-Wording.
