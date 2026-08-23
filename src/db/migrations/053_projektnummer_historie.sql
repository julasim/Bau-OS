-- ============================================================
-- 053 — Frühere Projektnummern aufheben
-- ============================================================
-- Ergänzung zu Migration 052. Die Projektnummer ist von Hand vergeben, also
-- wird sie irgendwann korrigiert — ein Zahlendreher, ein falsches Jahr, eine
-- vom Sekretariat nachgereichte Nummer.
--
-- ── Warum eine Korrektur ohne diese Spalte teuer ist ────────────────────────
--
-- Jede Ausgabe des Hauses zieht die Nummer LIVE aus `projects`: Word-Export,
-- Markdown-Dossier, Dateiname, Suchtreffer, jede Liste. Kein Kind-Datensatz
-- haelt einen Schnappschuss.
--
-- Die Folge einer Korrektur ist damit: das bereits versendete Protokoll traegt
-- `SAZTG-2026-014`, und im Programm findet man unter dieser Nummer NICHTS
-- mehr. Der Nachdruck desselben Dokuments traegt eine andere Aktennummer als
-- das Original beim Bauherrn. Genau das macht eine Korrektur zu etwas, das man
-- lieber unterlaesst — und dann steht dauerhaft die falsche Nummer im System.
--
-- Mit dieser Spalte ist die Korrektur harmlos: die alte Nummer bleibt
-- auffindbar und steht im Projektkopf als „frueher: …".
--
-- ── Warum frühere Nummern NICHT blockieren ─────────────────────────────────
--
-- Sie gehen bewusst NICHT in den eindeutigen Index aus 052. Sonst waere jeder
-- Tippfehler eine dauerhaft verbrannte Nummer: wer sich einmal bei
-- `SAZTG-2026-014` vertippt und auf `-015` korrigiert, koennte `-014` nie
-- mehr vergeben — obwohl sie nie in Gebrauch war.
--
-- Der Preis ist eine Mehrdeutigkeit: wird `-014` spaeter einem anderen Projekt
-- gegeben, findet die Suche danach zwei Treffer. Das ist die ehrlichere
-- Auskunft — beide Projekte haben mit dieser Nummer wirklich zu tun — und die
-- Oberflaeche beschriftet den historischen Treffer als solchen.
-- ============================================================

-- Leeres Feld statt NULL: so braucht keine Abfrage eine Fallunterscheidung,
-- und `array_append` funktioniert vom ersten Aufruf an.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS projektnummer_frueher TEXT[] NOT NULL DEFAULT '{}';

-- ── Index fuer die Suche nach einer frueheren Nummer ───────────────────────
--
-- GIN auf dem Feld selbst. Das unterstuetzt „enthaelt" (`@>`, `&&`), also den
-- realistischen Fall: jemand hat ein versendetes Dokument in der Hand und
-- tippt die darauf gedruckte Nummer VOLLSTAENDIG ab.
--
-- Ein Trigramm-Index auf `array_to_string(...)` waere der elegantere Weg
-- gewesen und die erste Fassung dieser Datei hat ihn versucht. Postgres lehnt
-- ihn ab:
--
--     functions in index expression must be marked IMMUTABLE
--
-- `array_to_string` ist STABLE, nicht IMMUTABLE — der Ausdruck haengt an der
-- Ausgabefunktion des Elementtyps. Eine eigene IMMUTABLE-Huelle waere machbar,
-- aber eine Funktion im Schema fuer einen Suchfall, den es selten gibt: die
-- Teilstueck-Suche auf einer FRUEHEREN Nummer. Die Tabelle hat einige hundert
-- Zeilen; dafuer genuegt der Durchlauf, den die Suche ohnehin macht.
CREATE INDEX IF NOT EXISTS idx_projects_projektnummer_frueher
  ON projects USING GIN (projektnummer_frueher);
