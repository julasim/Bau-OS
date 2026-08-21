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

## Zustand nach diesem Commit (Stufe 1)

- `src/api/crypto.ts` nutzt `ENCRYPTION_KEY` als **Primärschlüssel**; solange
  keiner gesetzt ist, fällt es auf `JWT_SECRET` zurück (nichts ändert sich, der
  Start loggt eine SEC-4-Warnung).
- `decryptString` probiert erst den Primär-, dann den `JWT_SECRET`-Schlüssel →
  Bestandsdaten bleiben lesbar.
- Legacy-Plaintext (Felder ohne `enc:v1:`-Prefix) wird noch durchgereicht.

Betroffene Felder laut `scripts/reencrypt.ts`: `users.telegram_bot_token`,
`users.totp_secret_encrypted`, `user_microsoft_accounts.access_token_encrypted`
und `refresh_token_encrypted`.

::: info Drei der vier Felder sind Altbestand
Der Telegram-Bot und der Outlook-Abgleich sind entfallen. Migration `047`
entfernt `user_microsoft_accounts` — **aber nur, wenn die Tabelle leer ist**;
sonst bleibt sie mit einem Hinweis im Protokoll stehen. Ist sie weg, überspringt
`reencrypt.ts` die beiden Felder mit einer Meldung und läuft weiter
(`scripts/reencrypt.ts`, Zeile 62–70). Das ist kein Fehler.

Praktisch relevant ist heute nur `users.totp_secret_encrypted`.
:::

## Migration auf dem Firmenserver (zweistufig)

### Stufe 1 — Schlüssel einführen + umschlüsseln

1. Starken Key erzeugen: `openssl rand -hex 32`
2. In `/opt/patio/.env` setzen: `ENCRYPTION_KEY=<hex>`
   **Wichtig:** den Key sicher sichern (Passwortmanager/Backup). Ohne ihn sind
   die Felder nach dem Umschlüsseln nicht mehr lesbar.
3. Stack die neue `.env` einlesen lassen (ein `restart` reicht **nicht**):
   ```bash
   cd /opt/patio && docker compose up -d --force-recreate app
   ```
4. Trockenlauf (schreibt nichts):
   ```bash
   docker compose exec app npm run db:reencrypt -- --dry
   ```
5. Echt umschlüsseln:
   ```bash
   docker compose exec app npm run db:reencrypt
   ```
   Erwartung: alle Felder auf `ENCRYPTION_KEY` umgeschlüsselt, `fehlgeschlagen=0`.
6. **Prüfen — aber anders als früher.**

   ::: warning Es gibt derzeit keinen laufenden Verbraucher zum Gegenprüfen
   Hier stand, der 2FA-/OTP-Login sei die Funktionsprobe. **Das geht nicht
   mehr:** die 2FA-Routen sind nicht eingehängt (`src/api/server.ts:486` ist
   auskommentiert), der zweite Faktor kommt erst mit dem VPN zurück. Telegram
   und Outlook gibt es ohnehin nicht mehr.

   Damit hat heute **kein aktiver Anmeldeweg** ein entschlüsseltes Feld nötig —
   eine „funktioniert noch"-Probe ist schlicht nicht möglich.
   :::

   Was stattdessen zählt, ist die Ausgabe des Laufs selbst:

   - `fehlgeschlagen=0`
   - Die Zahl umgeschlüsselter Felder entspricht dem, was der Trockenlauf
     angekündigt hat.
   - Übersprungene Felder sind erklärt (Tabelle durch Migration `047`
     entfernt), nicht stumm ausgeblieben.

   Der Dienst muss danach normal starten und darf die SEC-4-Warnung nicht mehr
   protokollieren — sie erscheint nur, solange `ENCRYPTION_KEY` leer ist.

### Stufe 2 — Rückfälle entfernen (später, eigener Commit)

Erst **nachdem** Stufe 1 gelaufen ist und der Betrieb stabil läuft:

- In `src/api/crypto.ts` den `JWT_SECRET`-Fallback in `decryptString` sowie den
  Legacy-Plaintext-Durchgriff (`return stored`) entfernen. Danach müssen alle
  Werte `enc:v1:` + Primärschlüssel sein.
- Optional `ENCRYPTION_KEY` in Produktion hart erzwingen (analog `JWT_SECRET_OK`
  in `startApi`).

## Rollback

Solange Stufe 2 nicht gelaufen ist, entschlüsselt der `JWT_SECRET`-Fallback alte
Werte weiter. **Achtung:** Nach `db:reencrypt` sind die Werte mit
`ENCRYPTION_KEY` verschlüsselt — ohne diesen Key sind sie dann nicht mehr lesbar.
Deshalb den Key aufbewahren; ein Rollback bedeutet, den `ENCRYPTION_KEY` in der
`.env` zu belassen, nicht ihn zu entfernen.
