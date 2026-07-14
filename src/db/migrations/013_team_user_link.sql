-- ============================================================
-- PATIO — Team-Member → User-Account Verknuepfung
-- ============================================================
-- Bisherige Architektur:
--   - users:        Login-Konten (Admin / regulaerer User)
--   - team_members: Personen aus dem Bauprojekt — Polier, Architekt,
--                   Bauherr, Subunternehmer. Manche davon haben System-
--                   Konten (Mitarbeiter), andere nicht (externe Planer).
--
-- Tasks/Termine/Meetings referenzieren team_members (assignee_id /
-- assignee_ids / attendee_ids). Fuer Notifications brauchen wir aber den
-- User-Account, weil nur der eine telegram_chat_id hat.
--
-- Diese Migration ergaenzt team_members.user_id als nullable FK auf
-- users.id. ON DELETE SET NULL — wenn ein User-Account geloescht wird,
-- bleibt das Team-Mitglied erhalten (Bauakt-Doku darf nicht zerbroeseln),
-- nur die Verknuepfung verschwindet.
--
-- Best-Effort-Backfill per Name-Match: wenn team_members.name exakt
-- (case-insensitive) einem users.username oder users.display_name
-- entspricht, verlinken wir automatisch. Mehrdeutige Treffer werden
-- nicht verlinkt (Admin muss manuell setzen). Konservativ — falsche
-- Verknuepfung waere schlechter als keine.
-- ============================================================

ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_team_members_user_id
  ON team_members(user_id);

-- Eindeutiger Index — ein User darf maximal mit einem Team-Mitglied
-- verknuepft sein. Sonst wuerden Notifications doppelt rausgehen.
-- Partial: nur fuer NOT NULL, damit mehrere team_members ohne
-- user-Link weiter erlaubt sind.
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_members_user_id
  ON team_members(user_id) WHERE user_id IS NOT NULL;

-- Best-Effort-Backfill — exact case-insensitive name match, nur wenn
-- eindeutig (1:1). Mehrfache Treffer bleiben unverlinkt.
WITH single_matches AS (
  SELECT u.id AS uid, tm.id AS mid
    FROM users u
    JOIN team_members tm
      ON LOWER(TRIM(u.username)) = LOWER(TRIM(tm.name))
      OR LOWER(TRIM(COALESCE(u.display_name,''))) = LOWER(TRIM(tm.name))
   WHERE tm.user_id IS NULL
   GROUP BY u.id, tm.id
  HAVING (SELECT COUNT(*) FROM users u2
            WHERE LOWER(TRIM(u2.username)) = LOWER(TRIM(tm.name))
               OR LOWER(TRIM(COALESCE(u2.display_name,''))) = LOWER(TRIM(tm.name))) = 1
     AND (SELECT COUNT(*) FROM team_members tm2
            WHERE LOWER(TRIM(tm2.name)) = LOWER(TRIM(u.username))
               OR LOWER(TRIM(tm2.name)) = LOWER(TRIM(COALESCE(u.display_name,'')))) = 1
)
UPDATE team_members tm
   SET user_id = sm.uid
  FROM single_matches sm
 WHERE tm.id = sm.mid;
