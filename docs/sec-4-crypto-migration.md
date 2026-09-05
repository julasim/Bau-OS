# SEC-4 — Feld-Verschlüsselung auf eigenen `ENCRYPTION_KEY` umstellen

Diese Seite wird aus dem laufenden Betrieb heraus verlinkt: Startet PATIO ohne
`ENCRYPTION_KEY`, protokolliert es eine Warnung mit genau diesem Pfad
(`src/index.ts`, Zeile 109). Für eine **neue** Installation genügt es, den
Schlüssel von Anfang an in die `.env` zu setzen — dann ist hier nichts zu tun.

## Warum

Bisher wurde der Schlüssel für die Feld-Verschlüsselung (TOTP-Secret; dazu
die Altbestände Telegram-Bot-Token und Microsoft-OAuth-Token) aus dem
`JWT_SECRET` abgeleitet. Damit hätte
eine `JWT_SECRET`-Rotation alle verschlüsselten Felder unlesbar gemacht. SEC-4
trennt beide Belange: ein eigener `ENCRYPTION_KEY` verschlüsselt die Felder,
`JWT_SECRET` signiert nur noch Tokens.

## Stand: Stufe 2 ist abgeschlossen (23.08.2026)

Die Umstellung war zweistufig angelegt. **Beide Stufen sind erledigt.**

- `src/api/crypto.ts` verschlüsselt mit `ENCRYPTION_KEY`; ist keiner gesetzt,
  fällt es auf `JWT_SECRET` zurück — und schreibt beim **ersten Verschlüsseln**
  eine Warnung ins Log. Der Rückfall sorgt dafür, dass der Dienst ohne den
  Schlüssel startet; er ist aber genau der Zustand, gegen den SEC-4 gebaut
  wurde.
- **Kein zweiter Entschlüsselungsweg mehr.** Was mit einem anderen Schlüssel
  verschlüsselt wurde, ergibt `null` — und `needsReencrypt()` meldet es, damit
  ein unlesbarer Wert nicht wie ein leeres Feld aussieht.
- **Kein Klartext-Durchgriff mehr.** Ein Wert ohne `enc:v1:`-Prefix in einer
  verschlüsselten Spalte wird verworfen und protokolliert.

::: tip Warum genau jetzt
Nachgemessen am 23.08.2026: **73 Konten, 0 verschlüsselte Felder.** Es gab
nichts umzuschlüsseln — der Migrationszweig hat nie ein einziges Byte
geschützt, und später wäre der Umbau teuer geworden.

Was der Klartext-Durchgriff bedeutet hätte: das einzige Feld, das diese Spalte
je trägt, ist ein TOTP-Geheimnis. Dort ist „irgendetwas kam durch" die
schlechteste denkbare Antwort — ein zweiter Faktor, den jeder mit
Datenbankzugriff lesen kann, und niemand merkt es.
:::

Betroffenes Feld laut `scripts/reencrypt.ts`: **`users.totp_secret_encrypted`**
— und sonst keines. Die drei anderen (`users.telegram_bot_token`,
`user_microsoft_accounts.access_token_encrypted` und `refresh_token_encrypted`)
standen dort noch, obwohl ihre Tabellen und Spalten mit den Migrationen 047 und
056 entfallen sind; der `try/catch` meldete jedes Mal „nicht abfragbar —
übersprungen" und liess eine fehlende Migration vermuten.

::: info Drei der vier Felder sind Altbestand
Der Telegram-Bot und der Outlook-Abgleich sind entfallen. Migration `047`
entfernt `user_microsoft_accounts`, Migration `056` die Spalte
`users.telegram_bot_token` — beide **nur, wenn nichts drinsteht**; sonst
bleiben sie mit einem Hinweis im Migrationsprotokoll stehen.

Die drei Einträge sind aus dem Skript verschwunden: `FIELDS` führt heute genau
eine Zeile (`scripts/reencrypt.ts`, Zeile 47–49). Übersprungene Meldungen zu
Tabellen, die es nicht mehr gibt, sind damit kein Thema mehr.

Praktisch relevant ist heute nur `users.totp_secret_encrypted`.
:::

## Den Schlüssel auf einem bestehenden Server einführen

::: danger Seit Stufe 2 ist der Wechsel ein Einbahnweg
`src/api/crypto.ts` kennt **genau einen** Schlüssel. Sobald `ENCRYPTION_KEY`
gesetzt ist, ist alles, was vorher unter `JWT_SECRET` verschlüsselt wurde, nicht
mehr lesbar — und `npm run db:reencrypt` holt es auch nicht zurück: das Skript
entschlüsselt mit demselben einen Schlüssel, bekommt `null` und schreibt nichts
(`scripts/reencrypt.ts`, Zeile 96–100). Dasselbe gilt für Klartext-Altbestände.

Hier stand, das Skript schlüssele Bestandsdaten um. Das galt für Stufe 1 und
gilt seit dem 23.08.2026 nicht mehr.

Folgenlos ist das nur, weil es nichts umzuschlüsseln gibt: nachgemessen am
23.08.2026 trägt keine Zeile ein verschlüsseltes Feld, und der einzige
Schreiber — der zweite Faktor — ist nicht eingehängt. **Genau deshalb gehört
der Schlüssel jetzt gesetzt und nicht erst, wenn AP17 den zweiten Faktor
zurückbringt.**
:::

1. Starken Key erzeugen: `openssl rand -hex 32`
2. In `/opt/patio/.env` setzen: `ENCRYPTION_KEY=<hex>`
   **Wichtig:** den Key sicher sichern (Passwortmanager/Backup). Ohne ihn ist
   alles, was ab jetzt verschlüsselt wird, verloren.
3. Stack die neue `.env` einlesen lassen (ein `restart` reicht **nicht**):
   ```bash
   cd /opt/patio && docker compose up -d --force-recreate app
   ```
4. Prüfen, ob überhaupt ein verschlüsselter Wert in der Datenbank steht:
   ```bash
   cd /opt/patio && docker compose exec postgres \
     psql -U patio -d patio -tAc \
     "SELECT count(*) FROM users WHERE totp_secret_encrypted IS NOT NULL"
   ```
   Erwartung auf einer Anlage ohne zweiten Faktor: `0`. Dann ist nichts weiter
   zu tun — der neue Schlüssel gilt für alles, was künftig geschrieben wird.
5. Kommt dort eine Zahl **größer als 0** heraus, stammt der Wert von vor der
   Umstellung und ist mit dem neuen Schlüssel nicht mehr lesbar. Dann:
   `ENCRYPTION_KEY` wieder aus der `.env` nehmen, Stack mit `--force-recreate`
   hochziehen — und den Fall einzeln entscheiden. Bei einem TOTP-Geheimnis
   heißt das, den zweiten Faktor für dieses Konto neu einzurichten.

   ::: danger `npm run db:reencrypt` läuft auf dem Server nicht
   Hier stand `docker compose exec app npm run db:reencrypt -- --dry`. **Dieser
   Befehl scheitert**, und zwar auf jedem Firmenserver:

   - Das Laufzeit-Image enthält nur `node_modules`, `dist/` und
     `package.json` (`Dockerfile`, Stufe 2) — `scripts/` ist nicht dabei.
   - `scripts/` wird auch nie nach `dist/` gebaut: `tsconfig.json` führt
     `include: ["src/**/*"]`. Denselben Irrtum hatte `scripts/patio-cli.sh`
     schon einmal, dort steht die Begründung im Kommentar.
   - Das Auslieferungspaket bringt nur Compose, `.env.example`, aus `docker/`
     allein `Caddyfile` und `init/`, dazu `deploy/` und fünf Shell-Skripte mit
     (`scripts/release-offline.sh`, Zeilen 141–167) — das
     Umschlüssel-Skript ist keines davon.

   `npm run db:reencrypt` ist damit ein Werkzeug für den
   Entwicklungsrechner mit Quellbaum und eigener `DATABASE_URL`. Auf dem
   Server bleibt die Abfrage oben.
   :::
6. **Prüfen — aber anders als früher.**

   ::: warning Es gibt derzeit keinen laufenden Verbraucher zum Gegenprüfen
   Hier stand, der 2FA-/OTP-Login sei die Funktionsprobe. **Das geht nicht
   mehr:** die 2FA-Routen sind nicht eingehängt (die `auth2faRoutes`-Zeile in `src/api/server.ts` ist
   auskommentiert), der zweite Faktor kommt erst mit dem VPN zurück. Telegram
   und Outlook gibt es ohnehin nicht mehr.

   Damit hat heute **kein aktiver Anmeldeweg** ein entschlüsseltes Feld nötig —
   eine „funktioniert noch"-Probe ist schlicht nicht möglich.
   :::

   Was stattdessen zählt, ist die Abfrage aus Schritt 4: sie liefert `0` — auf
   einer Anlage, in der nie ein zweiter Faktor eingerichtet war, ist das der
   Normalfall und kein Hinweis auf einen Fehler.

   Der Dienst muss danach normal starten und darf die SEC-4-Warnung nicht mehr
   protokollieren — sie erscheint nur, solange `ENCRYPTION_KEY` leer ist
   (`src/index.ts`, Zeile 106–113).

## Was noch offen ist

Der Start **warnt** nur, wenn `ENCRYPTION_KEY` fehlt oder kürzer als 32 Zeichen
ist; er bricht nicht ab (`src/index.ts`, Zeile 106–120). Ihn in Produktion hart
zu erzwingen — so, wie `JWT_SECRET_OK` es für das Anmelde-Secret tut — ist
bewusst offen geblieben, damit ein Update den Dienst nicht stehen lässt. Solange
kein Feld verschlüsselt wird, ist das vertretbar; mit dem zweiten Faktor (AP17)
gehört es entschieden.

## Rollback

Einen Rückweg gibt es nicht mehr. Wurde ein Feld unter `ENCRYPTION_KEY`
verschlüsselt, ist es ohne diesen Schlüssel verloren — den `ENCRYPTION_KEY`
aus der `.env` zu nehmen, macht die Werte unlesbar, statt sie freizugeben.

Deshalb gilt für den Schlüssel dasselbe wie für den privaten Schlüssel der
internen CA: **er gehört in die Sicherung.** `scripts/backup.sh` nimmt die
`.env` mit auf (siehe [Sicherung](/betrieb/sicherung)); wer ihn zusätzlich im
Passwortmanager hat, kommt auch dann noch heran, wenn die Sicherung selbst
das Problem ist.
