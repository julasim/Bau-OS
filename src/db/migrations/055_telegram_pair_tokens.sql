-- ============================================================
-- 055 — Der letzte Rest der Bot-Aera: telegram_pair_tokens
-- ============================================================
-- Die Tabelle stammt aus 008 und diente dem Self-Pairing eines
-- Telegram-Kontos mit einem PATIO-Benutzer. Den Bot gibt es seit AP0 nicht
-- mehr; in die Tabelle schreibt keine Zeile Code.
--
-- Migration 047 hat sechs Tabellen der Bot- und Outlook-Aera abgeraeumt --
-- diese stand nicht auf der Liste. Der Wartungs-Cron hat sie deshalb bis
-- heute jede Nacht aufgeraeumt: ein DELETE gegen einen Bestand, der nicht
-- mehr waechst.
--
-- Dieselbe Vorsicht wie in 047: sie faellt NUR, wenn sie leer ist. Steht
-- noch eine Zeile drin, bleibt sie stehen und meldet sich. Ein Token in
-- dieser Tabelle ist zwar wertlos, aber "wertlos" ist eine Annahme, und
-- eine Migration, die um drei Uhr nachts durchlaeuft, soll keine Annahmen
-- ueber fremde Daten treffen.
--
-- Dadurch ist die Migration zugleich wiederholbar: ein zweiter Lauf findet
-- nichts mehr vor und tut nichts.
-- ============================================================

DO $$
DECLARE
  n BIGINT;
BEGIN
  IF to_regclass('public.telegram_pair_tokens') IS NULL THEN
    RETURN;  -- schon weg oder nie angelegt
  END IF;

  SELECT count(*) INTO n FROM telegram_pair_tokens;

  IF n = 0 THEN
    DROP TABLE telegram_pair_tokens CASCADE;
    RAISE NOTICE 'Tabelle telegram_pair_tokens entfernt (war leer).';
  ELSE
    RAISE NOTICE
      'telegram_pair_tokens NICHT entfernt: % Zeile(n) vorhanden. Die Tabelle '
      'wird von keiner Zeile Code mehr gelesen. Wer den Inhalt nicht braucht: '
      'DROP TABLE telegram_pair_tokens CASCADE;', n;
  END IF;
END $$;
