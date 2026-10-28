-- =====================================================================
-- 🔎 ตรวจสอบหลังรัน FIX-v61 (2026-10-28, พี่เอ)
--   วางใน Supabase SQL Editor → Run (ปลอดภัย · อ่านอย่างเดียว)
-- =====================================================================
SELECT
  position('COALESCE(array_length(v_deck, 1), 0) = 0' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS deck_empty_check,
  position('rummy_end_game_deck_empty' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS deck_end_game,
  position('DECK_EMPTY' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS deck_empty_action,
  (SELECT count(*) FROM pg_proc WHERE proname = 'rummy_end_game_deck_empty') = 1 AS end_game_fn;

SELECT count(*) AS rooms_deck_empty_left
FROM rooms
WHERE status = 'playing' AND jsonb_typeof(game->'deck') = 'array'
  AND jsonb_array_length(game->'deck') = 0;

SELECT id, status, (game->>'endReason') AS end_reason,
       (game->'roundScores')::TEXT AS round_scores,
       (game->'totalScores')::TEXT AS total_scores,
       (game->>'winner') AS winner,
       version
FROM rooms
WHERE game->>'endReason' = 'DECK_EMPTY'
ORDER BY version DESC;

SELECT id, status, (game->>'endReason') AS end_reason,
       (game->>'deckEmpty') AS deck_empty,
       (game->'roundScores')::TEXT AS round_scores,
       (game->>'winner') AS winner
FROM rooms WHERE id = 'XY7QTM';

SELECT
  p.pid,
  COALESCE((r.game->'hasFirstMeld'->>p.pid)::BOOLEAN, false) AS has_meld,
  COALESCE(jsonb_array_length(r.game->'hands'->p.pid), 0) AS hand_cards,
  COALESCE((r.game->'spettoPenalty'->>p.pid)::INT, 0) AS penalty,
  (r.game->'scores'->>p.pid)::INT AS prev_score
FROM rooms r, LATERAL jsonb_array_elements_text(r.game->'playerOrder') AS p(pid)
WHERE r.id = 'XY7QTM';

SELECT count(*) AS rooms_game_null FROM rooms WHERE game IS NULL;
