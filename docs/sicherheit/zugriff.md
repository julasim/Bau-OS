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

::: tip Der Alt-Konten-Rückfallpfad
Konten aus `data/users.json` melden sich weiterhin an. Der Pfad existiert für
Erstinbetriebnahme und Wiederherstellung; beim Start zieht PATIO solche
Konten idempotent in die Datenbank nach. Er entfällt mit dem Arbeitspaket
„Konten und Sitzungen". Auf einem produktiven System sollte die Datei leer
sein.
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

Die gesamte Logik liegt in `src/data/access.ts`. Die Repositories bauen ihre
WHERE-Klauseln daraus, statt sie sich selbst zusammenzusetzen — genau diese
eine Stelle ist deshalb prüfbar.

Projekt-Zugriff vergeben und entziehen: `POST` und `DELETE` auf
`/api/projects/:name/access`.

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
| Content-Security-Policy | Eigene Richtlinie, derzeit im **Report-Only**-Modus |
| CORS | Ohne `CORS_ORIGINS` nur `http://localhost:<API_PORT>` |
| Fehlerantworten | Zentral in JSON, ohne Stack-Trace nach außen |

::: warning CSP meldet, blockiert aber nicht
Der Header heißt `Content-Security-Policy-Report-Only`. Verstöße erscheinen
in der Browser-Konsole, werden aber nicht unterbunden. Der Schritt auf
Durchsetzung ist bewusst noch nicht getan.
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
| Anmelde-Link | `login.magic_link.sent`, `.success`, `.fail` |
| E-Mail-Einrichtung | `email_setup.code_sent`, `.success`, `.code_fail` |
| Passwort | `password_reset.request`, `.success`, `password.admin_reset` |
| Benutzer | `user.create`, `user.update`, `user.role`, `user.delete` |

Jeder Eintrag hält IP und User-Agent (auf 256 Zeichen gekürzt).
Aufbewahrung: `AUDIT_RETENTION_DAYS`, Standard 365 Tage; der Wartungs-Cron
räumt nachts auf.

## Was nicht mehr existiert

Die frühere Zugriffskontrolle über Telegram-Chat-IDs (`ALLOWED_CHAT_IDS`,
Auto-Owner), die Whitelist für Agenten-Dateien, die Shell-Allowlist und der
SSRF-Schutz für den Webabruf sind ersatzlos entfallen — mit dem Code, den
sie abgesichert haben. PATIO ruft im Betrieb keine externen Adressen mehr
auf und führt keine Shell-Befehle aus.
