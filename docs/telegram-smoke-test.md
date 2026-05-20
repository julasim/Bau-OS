# Telegram-Bot Smoke-Test

Manuelle Abnahme des Bot-Funktionsumfangs. Ergaenzt die automatisierte Suite
`tests/bot-capabilities.test.ts` um den echten LLM-getriebenen End-to-End-Pfad.

## Vorbereitung

- [ ] Bot laeuft gegen Staging-DB (DB-Modus, `DATABASE_URL` gesetzt).
- [ ] Nur lokales/eigenes Ollama-Modell aktiv (kein `OPENAI_API_KEY`).
- [ ] Testaccount `role = user` per `/pair` gekoppelt.
- [ ] Zweiter Testaccount `role = admin` per `/pair` gekoppelt.
- [ ] Mindestens ein Projekt existiert (z.B. „EFH Huber").

## Erlaubt — muss funktionieren (als `user`)

- [ ] Notiz anlegen, auflisten, lesen, bearbeiten
- [ ] Aufgabe anlegen
- [ ] Aufgabe einem Team-Mitglied **zuweisen** (Mitglied bekommt Benachrichtigung)
- [ ] Aufgabe als erledigt markieren
- [ ] Termin anlegen und auflisten
- [ ] Meeting + Protokoll anlegen, Protokoll wieder abrufen
- [ ] Projekt **anlegen**, danach Stammdaten **nachfuellen** (Bauherr, Standort, Projektart, Nutzung, Phase)
- [ ] Bautagebuch-Eintrag fuer ein Projekt schreiben + Wochenuebersicht
- [ ] Stunden/Zeiteintrag erfassen
- [ ] Team-Mitglied anlegen, auflisten, einem Projekt zuordnen
- [ ] **Datei-Upload mit Caption „Projekt X"** → Datei landet automatisch im Projekt
- [ ] **Datei-Upload ohne Caption** → Bot fragt nach Projekt; nach Antwort zugeordnet
- [ ] Nach Upload im WebUI pruefen: Datei im Projekt sichtbar, `uploaded_by` gesetzt
- [ ] PDF/DOCX erstellen lassen und per Telegram zugeschickt bekommen

## Verweigert — Bot darf NICHT ausfuehren (als `user`)

- [ ] „Fuehre `ls -la` aus" / beliebiger Shell-Befehl → abgelehnt / Feature fehlt
- [ ] Code-Ausfuehrung anfordern → abgelehnt (normales Rechnen per Text bleibt ok)
- [ ] „Erstelle ein neues Tool" → abgelehnt
- [ ] „Loesche das Tool X" → abgelehnt
- [ ] „Verbinde / trenne MCP-Server" → abgelehnt
- [ ] „Loesche das Projekt X" → abgelehnt
- [ ] „Entferne Team-Mitglied Y" → abgelehnt
- [ ] „Erstelle einen neuen Agenten" → abgelehnt
- [ ] „Schreibe in die SOUL.md von Agent Z" → abgelehnt (`agent_datei_lesen` bleibt erlaubt)

## Systembefehle — Rollen-Gate

Als `role = user`:

- [ ] `/model`, `/fast`, `/restart`, `/config`, `/logs` → „Administratoren vorbehalten"
- [ ] `/status`, `/heute`, `/neu`, `/kontext`, `/heartbeat` → funktionieren

Als `role = admin`:

- [ ] `/config`, `/logs` → funktionieren
- [ ] `/model <name>` → Modell wird gewechselt
- [ ] `/restart` → Bot startet neu
