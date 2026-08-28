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

## Umbau zum Firmenserver (LAUFEND — Stand 2026-08-05)

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
> **Nicht in WSL pruefbar und damit weiterhin offen:** Samba-Freigabe,
> Sicherungsplatte samt Ruecksicherung, USV, und ob Electron dem
> CA-Zertifikat am echten Arbeitsplatz traut (AP12 Teil A).
>
> ### Stand 24.08.2026 — 733 Tests, Migrationen bis 059
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
>   **Noch nicht gebaut:** der Verfall von Rang 4 nach 30 Tagen.
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
> - **Zwei Ablagen, jetzt klar getrennt.** Die Freigabe „Dokumente" ist ein
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
> **Was als Nächstes ansteht:** **AP17** VPN (bringt den zweiten Faktor
> zurück). AP9 bis AP15 sind abgearbeitet.
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
Anmeldung, Compose-Stack, Zertifikat, Sicherung, Netzfreigabe, Offline-Updates
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
- **Frontend:** Vue 3 (Composition API) + Pinia + Vite + Tailwind v4 (`web/`).
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

npm test             # vitest run (733 Tests — nur MIT Datenbank vollstaendig, siehe unten)
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
> tsconfig.scripts.json`. Grund: in `scripts/migrate-vault-to-db.ts` stand
> monatelang ein Import auf ein `VAULT_PATH`, das es gar nicht gibt — das
> Skript brach beim Start ab, und keine Prüfung sah je in den Ordner.

> **`npm test` ohne `DATABASE_URL` überspringt still 527 von 733 Tests** —
> und zwar genau die ACL-, Auth- und DB-Tests (`describe.skipIf(!HAS_DB)` in
> 34 Testdateien; `HAS_DB` selbst kommt aus `tests/helpers/acl-fixture.ts`).
> Gemessen am 2026-08-24: `24 passed | 56 skipped (80)` Dateien,
> `206 passed | 527 skipped (733)` Prüfungen; mit Datenbank `731 passed | 2 skipped`. **Diese Zahlen wandern mit jedem
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
  parallele Starts. Aktuellste: `054_projektnummer_bereinigung.sql`. **Schema-Lektion:**
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
  Schrift: **Inter / Inter Tight / JetBrains Mono**.
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
