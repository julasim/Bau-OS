# SEC-4 — Feld-Verschlüsselung auf eigenen `ENCRYPTION_KEY` umstellen

## Warum

Bisher wurde der Schlüssel für die Feld-Verschlüsselung (Telegram-Bot-Token,
TOTP-Secret, Microsoft-OAuth-Token) aus dem `JWT_SECRET` abgeleitet. Damit hätte
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

Betroffene Felder: `users.telegram_bot_token`, `users.totp_secret_encrypted`,
`user_microsoft_accounts.access_token_encrypted` / `refresh_token_encrypted`.

## Migration am VPS (zweistufig)

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
6. Funktions-Check (alle drei nutzen entschlüsselte Secrets):
   - Telegram-Bot antwortet,
   - 2FA-/OTP-Login funktioniert,
   - Outlook-/Microsoft-Sync läuft.

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
