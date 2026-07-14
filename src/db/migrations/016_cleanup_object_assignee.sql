-- ============================================================
-- PATIO — Cleanup: assignee = '[object Object]'
-- ============================================================
-- Bug aus alter API-Version: TasksView typte /team als string[],
-- bekam aber TeamMember-Objects. Beim Speichern via Edit-Mode
-- wurde das ganze Object als assignee uebermittelt → in der DB
-- als String "[object Object]" gespeichert. Frontend zeigte das
-- woertlich an statt eines Namens.
--
-- Diese Migration setzt alle solchen Eintraege auf NULL — die
-- Aufgaben bleiben erhalten, nur die kaputte Zuweisung wird
-- entfernt. Falls assignee_id (UUID) gesetzt war, bleibt das
-- daraus abgeleitet via Join verfuegbar; wenn nicht, wird "—"
-- angezeigt.
-- ============================================================

UPDATE tasks
   SET assignee = NULL
 WHERE assignee = '[object Object]';
