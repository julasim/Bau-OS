-- ============================================================
-- PATIO — Projekt Budget-Felder
-- ============================================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget NUMERIC(15,2);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget_used NUMERIC(15,2);

COMMENT ON COLUMN projects.budget      IS 'Geplantes Projektbudget in EUR (NULL = nicht gesetzt).';
COMMENT ON COLUMN projects.budget_used IS 'Bereits verwendetes / fakturiertes Budget in EUR.';
