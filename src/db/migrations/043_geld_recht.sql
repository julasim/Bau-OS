-- ============================================================
-- 043 — Das Geld-Recht
-- ============================================================
-- Bis hierher konnte jeder angemeldete Nutzer jeden Betrag lesen: Stundensaetze
-- der Kolleginnen und Kollegen (`team_members.hourly_rate`, Migration 037),
-- Rechnungsbetraege, Budgets, Deckungsbeitraege. In einem Buero, in dem der
-- Zeichensaal und die Geschaeftsfuehrung dieselbe Anwendung benutzen, ist das
-- die heikelste Offenlegung ueberhaupt — sie betrifft Gehaltsniveaus.
--
-- Das Geld-Recht ist bewusst NICHT an die Rolle gebunden. „Admin" heisst hier
-- „verwaltet die Anwendung" (Konten, Vorlagen, Sicherung); wer die Zahlen des
-- Bueros sehen darf, ist eine andere Frage — das kann die Buchhaltung sein,
-- ohne dass sie Konten anlegen soll, und umgekehrt.
--
-- **Voreinstellung geschlossen.** Neue Konten sehen keine Betraege, bis es
-- jemand ausdruecklich freigibt. Ein Recht, das man aktiv wegnehmen muss,
-- wird vergessen; eines, das man aktiv geben muss, nicht.
--
-- Der Admin bleibt implizit berechtigt (im Code, nicht in der Spalte) — sonst
-- sperrte sich die Person aus, die das Recht ueberhaupt vergibt, beim ersten
-- Start selbst aus.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS can_see_money BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.can_see_money IS
  'Darf Betraege sehen (Stundensaetze, Rechnungen, Budgets, Deckungsbeitrag). Admins implizit ja.';
