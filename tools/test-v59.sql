-- ============================================================
-- TEST v59 (2026-10-27) — ฝั่ง server (Postgres)
--   เตรียม: CREATE DATABASE rummytest; CREATE TABLE rooms (...);
--            psql -d rummytest -f APPLY-ALL-2026-10-25.sql
--            psql -d rummytest -f FIX-v59-2026-10-27.sql
--            psql -d rummytest -f tools/test-v59.sql
--
--   เคสที่ทดสอบ:
--     A) DISCARD ทั้งที่ phase='draw'            → ต้องได้ MUST_DRAW
--     B) MELD ที่ไม่รวม anchor (ใบแรกที่หยิบ)   → ต้องได้ MUST_MELD_ANCHOR
--     C) LAYOFF: ชุด 5-6-7 + ฝาก 4               → meld ต้องกลายเป็น 4-5-6-7
--     D) A = 14 เสมอ (rummy_is_run / rummy_rank_num)
--     E) กติกาโทษ 2.1 / 2.2 / 2.3 ยังอยู่ครบ
-- ============================================================
\set ON_ERROR_STOP on
\pset pager off

-- ------------------------------------------------------------
-- helper: สร้างห้องทดสอบ
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION t_new_room(p_id TEXT, p_hand1 TEXT[], p_hand2 TEXT[], p_deck TEXT[], p_discard TEXT[], p_turn TEXT DEFAULT 'p1', p_extra JSONB DEFAULT '{}'::JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_game JSONB;
BEGIN
  v_game := jsonb_build_object(
    'deck', to_jsonb(p_deck),
    'hands', jsonb_build_object('p1', to_jsonb(p_hand1), 'p2', to_jsonb(p_hand2)),
    'discardPile', to_jsonb(p_discard),
    'turnPlayerId', p_turn,
    'playerOrder', to_jsonb(ARRAY['p1','p2']),
    'phase', 'action',
    'status', 'playing',
    'melds', '{}'::JSONB,
    'scores', jsonb_build_object('p1', 0, 'p2', 0),
    'round', 1,
    'turnSeq', 0,
    'headCard', p_discard[1],
    'headPoints', 50,
    'hasFirstMeld', '{}'::JSONB,
    'everMeld', '{}'::JSONB,
    'everPick', '{}'::JSONB,
    'pickedFromDiscard', '{}'::JSONB,
    'spettoPenalty', '{}'::JSONB,
    'spetoPending', '{}'::JSONB,
    'spettoPenaltyDone', '{}'::JSONB,
    'spettoDiscardDone', '{}'::JSONB,
    'spetoOrigin', '{}'::JSONB,
    'hasDiscardedThisTurn', '{}'::JSONB,
    'version', 1
  ) || p_extra;
  INSERT INTO rooms (id, code, players, game, status, version)
  VALUES (p_id, p_id, to_jsonb(ARRAY['p1','p2']), v_game, 'playing', 1)
  ON CONFLICT (id) DO UPDATE SET game = EXCLUDED.game, status = 'playing', version = 1;
END;
$$;

\echo ''
\echo '===== CASE A: DISCARD ทั้งที่ยังไม่จั่ว (phase=draw) → MUST_DRAW ====='
-- A1: phase = 'draw' (ยังไม่จั่ว) → ทิ้งไม่ได้
SELECT t_new_room('VA1', ARRAY['7♠','8♠','9♠'], ARRAY['9♣','9♦'], ARRAY['2♥','3♥','4♥','5♥'], ARRAY['K♣'],
                   'p1', jsonb_build_object('phase','draw'));
SELECT res->>'error' AS a1_error,
       (res->>'error' = 'MUST_DRAW') AS a1_pass
FROM (SELECT play_turn('VA1','p1','DISCARD','7♠', p_expected_version => 0) AS res) x;

-- A2 (control): phase = 'action' (จั่วแล้ว) → ทิ้งได้
SELECT t_new_room('VA2', ARRAY['7♠','8♠','9♠'], ARRAY['9♣','9♦'], ARRAY['2♥','3♥','4♥','5♥'], ARRAY['K♣'],
                   'p1', jsonb_build_object('phase','action'));
SELECT res->>'error' AS a2_error,
       (res->>'ok' = 'true') AS a2_pass
FROM (SELECT play_turn('VA2','p1','DISCARD','7♠', p_expected_version => 0) AS res) x;

-- A3 (control): ห้องเก่าไม่มี phase → ไม่ถูกบล็อก
SELECT t_new_room('VA3', ARRAY['7♠','8♠','9♠'], ARRAY['9♣','9♦'], ARRAY['2♥','3♥','4♥','5♥'], ARRAY['K♣'],
                   'p1', jsonb_build_object('phase', NULL));
SELECT res->>'error' AS a3_error,
       (res->>'ok' = 'true') AS a3_pass
FROM (SELECT play_turn('VA3','p1','DISCARD','7♠', p_expected_version => 0) AS res) x;

\echo ''
\echo '===== CASE B: MELD ที่ไม่รวม anchor (ใบแรกที่หยิบ) → MUST_MELD_ANCHOR ====='
-- B1: หยิบจากกองทิ้ง (anchor = '5♠' = ใบแรกที่หยิบ) แล้วเกิดชุดที่ไม่มี 5♠
SELECT t_new_room('VB1', ARRAY['7♥','8♥','9♥'], ARRAY['9♣','9♦'], ARRAY['2♥','3♥','4♥'], ARRAY['5♠','2♣']);
SELECT res->>'ok' AS b1_pick_ok
FROM (SELECT play_turn('VB1','p1','PICK_DISCARD', p_discard_index => 0, p_expected_version => 0) AS res) x;
SELECT res->>'error' AS b1_error,
       (res->>'error' = 'MUST_MELD_ANCHOR') AS b1_pass
FROM (SELECT play_turn('VB1','p1','MELD', p_meld_codes => '["7♥","8♥","9♥"]', p_expected_version => 0) AS res) x;

-- B2 (control): เกิดชุดที่ "มี" anchor → ต้องผ่าน
SELECT t_new_room('VB2', ARRAY['7♥','8♥'], ARRAY['9♣','9♦'], ARRAY['2♥','3♥','4♥'], ARRAY['9♥']);
SELECT res->>'ok' AS b2_pick_ok
FROM (SELECT play_turn('VB2','p1','PICK_DISCARD', p_discard_index => 0, p_expected_version => 0) AS res) x;
SELECT res->>'error' AS b2_error,
       (res->>'ok' = 'true') AS b2_pass
FROM (SELECT play_turn('VB2','p1','MELD', p_meld_codes => '["7♥","8♥","9♥"]', p_expected_version => 0) AS res) x;

\echo ''
\echo '===== CASE C: LAYOFF ลงชุดเรียง → เรียงตามเลข (5-6-7 + ฝาก 4 = 4-5-6-7) ====='
-- C1: ชุด 5-6-7 (p2) + ฝาก 4 (p1) → ต้องได้ 4-5-6-7
SELECT t_new_room('VC1', ARRAY['4♠'], ARRAY['9♣','9♦'], ARRAY['2♥','3♥','4♥'], ARRAY['K♣'],
                   'p1', jsonb_build_object(
                     'melds', jsonb_build_object('p2', jsonb_build_array(jsonb_build_array('5♠','6♠','7♠'))),
                     'hasFirstMeld', jsonb_build_object('p1', true),
                     'everMeld', jsonb_build_object('p1', true),
                     'everPick', jsonb_build_object('p1', true)));
SELECT res->>'error' AS c1_error
FROM (SELECT play_turn('VC1','p1','LAYOFF', p_card_code => '4♠', p_target_pid => 'p2', p_target_meld_idx => 0, p_expected_version => 0) AS res) x;
SELECT (game->'melds'->'p2'->0) AS c1_meld,
       ((game->'melds'->'p2'->0) = '["4♠","5♠","6♠","7♠"]'::jsonb) AS c1_pass
FROM rooms WHERE id = 'VC1';

-- C2: ฝากลงชุดที่ "ไม่ใช่ชุดเรียง" → ไม่เรียง (คงลำดับเดิม + ต่อท้าย)
SELECT t_new_room('VC2', ARRAY['4♠'], ARRAY['9♣','9♦'], ARRAY['2♥','3♥','4♥'], ARRAY['K♣'],
                   'p1', jsonb_build_object(
                     'melds', jsonb_build_object('p2', jsonb_build_array(jsonb_build_array('5♠','5♥','5♣'))),
                     'hasFirstMeld', jsonb_build_object('p1', true),
                     'everMeld', jsonb_build_object('p1', true),
                     'everPick', jsonb_build_object('p1', true)));
SELECT res->>'error' AS c2_error
FROM (SELECT play_turn('VC2','p1','LAYOFF', p_card_code => '4♠', p_target_pid => 'p2', p_target_meld_idx => 0, p_expected_version => 0) AS res) x;
SELECT (game->'melds'->'p2'->0) AS c2_meld,
       ((game->'melds'->'p2'->0) = '["5♠","5♥","5♣","4♠"]'::jsonb) AS c2_pass
FROM rooms WHERE id = 'VC2';

-- C3: A = 14 สูงสุด → ชุด Q-K-A ฝาก J → ต้องได้ J-Q-K-A (J ขึ้นก่อน Q)
--     (ใช้หัวใจ เพราะ Q♠ เป็นสเปโต → เข้าชุดเรียงไม่ได้)
SELECT t_new_room('VC3', ARRAY['J♥'], ARRAY['9♣','9♦'], ARRAY['2♥','3♥','4♥'], ARRAY['K♣'],
                   'p1', jsonb_build_object(
                     'melds', jsonb_build_object('p2', jsonb_build_array(jsonb_build_array('Q♥','K♥','A♥'))),
                     'hasFirstMeld', jsonb_build_object('p1', true),
                     'everMeld', jsonb_build_object('p1', true),
                     'everPick', jsonb_build_object('p1', true)));
SELECT res->>'error' AS c3_error
FROM (SELECT play_turn('VC3','p1','LAYOFF', p_card_code => 'J♥', p_target_pid => 'p2', p_target_meld_idx => 0, p_expected_version => 0) AS res) x;
SELECT (game->'melds'->'p2'->0) AS c3_meld,
       ((game->'melds'->'p2'->0) = '["J♥","Q♥","K♥","A♥"]'::jsonb) AS c3_pass
FROM rooms WHERE id = 'VC3';

\echo ''
\echo '===== CASE D: A = 14 เสมอ ====='
SELECT
  rummy_rank_num('A', false) = 14                 AS d1_a_is_14,
  rummy_rank_num('A', true)  = 14                 AS d2_a_is_14_high,
  rummy_is_run(ARRAY['A♥','2♥','3♥']) = false     AS d3_a23_not_run,
  rummy_is_run(ARRAY['Q♥','K♥','A♥']) = true      AS d4_qka_is_run,
  rummy_rank_val_high('A♠') = 14                  AS d5_rank_val_high_a,
  rummy_rank_val_high('K♠') = 13                  AS d6_rank_val_high_k,
  rummy_rank_val_high('2♠') = 2                   AS d7_rank_val_high_2;

\echo ''
\echo '===== CASE E: กติกาโทษ 2.1 / 2.2 / 2.3 ยังอยู่ครบ ====='
SELECT
  position('spettoPenalty'      in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS e1_penalty_field,
  position('spetoOrigin'        in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS e2_speto_origin,
  position('rummy_can_layoff'   in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS e3_can_layoff,
  position('rummy_pile_has_meld_with' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS e4_pile_has_meld,
  position('MUST_MELD_FIRST'    in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS e5_must_meld_first,
  position('everMeld'           in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS e6_ever_meld,
  position('everPick'           in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS e7_ever_pick,
  position('spettoPenaltyDone'  in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS e8_penalty_done,
  position('spetoPending'       in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS e9_pending;

-- E2 (functional): 2.1 "ทิ้งดัมมี่" — ทิ้งไพ่ที่ฝากต่อชุดเรียงของ p2 ได้ → คนทิ้งโดน -100
SELECT t_new_room('VE1', ARRAY['6♥'], ARRAY['3♣'], ARRAY['2♥','3♥','4♥','5♥'], ARRAY[]::TEXT[],
                   'p1', jsonb_build_object(
                     'melds', jsonb_build_object('p2', jsonb_build_array(jsonb_build_array('3♥','4♥','5♥')))));
SELECT res->>'dumy' AS e2_dumy,
       (res->>'penalty')::INT AS e2_penalty,
       ((res->>'penalty')::INT = 100) AS e2_pass
FROM (SELECT play_turn('VE1','p1','DISCARD', p_card_code => '6♥', p_expected_version => 0) AS res) x;
SELECT (game->'spettoPenalty'->>'p1')::INT AS e2_spetto_penalty,
       ((game->'spettoPenalty'->>'p1')::INT = 100) AS e2_pass2
FROM rooms WHERE id = 'VE1';

-- E3 (functional): 2.3 "สเปโต" — ทิ้ง 2♣ ทั้งที่กองทิ้งมีไพ่เกี่ยว → pending → คนเกิดไพ่ใบนั้น → คนทิ้งโดน -100
SELECT t_new_room('VE3', ARRAY['2♣'], ARRAY['2♠','2♥'], ARRAY['3♥','4♥','5♥'], ARRAY['2♦'],
                   'p1', jsonb_build_object('phase','action'));
SELECT res->>'error' AS e3_discard_err
FROM (SELECT play_turn('VE3','p1','DISCARD', p_card_code => '2♣', p_expected_version => 0) AS res) x;
SELECT (game->'spetoPending' ? '2♣') AS e3_pending_ok,
       (game->'spetoPending'->'2♣'->>'discarder') AS e3_discarder
FROM rooms WHERE id = 'VE3';
-- p2 หยิบ 2♣ จากกองทิ้ง (index 1 ของ ['2♦','2♣']) แล้วเกิดตอง 2
SELECT res->>'ok' AS e3_pick_ok
FROM (SELECT play_turn('VE3','p2','PICK_DISCARD', p_discard_index => 1, p_expected_version => 0) AS res) x;
SELECT res->>'error' AS e3_meld_err
FROM (SELECT play_turn('VE3','p2','MELD', p_meld_codes => '["2♣","2♠","2♥"]', p_expected_version => 0) AS res) x;
SELECT (game->'spettoPenalty'->>'p1')::INT AS e3_penalty,
       ((game->'spettoPenalty'->>'p1')::INT = 100) AS e3_pass
FROM rooms WHERE id = 'VE3';

-- E4 (functional): 2.1/2.2 — ไม่เคยเกิด → น็อคมืด ×2 (dark knock)
SELECT t_new_room('VE4', ARRAY['7♠'], ARRAY['9♣','9♦'], ARRAY['2♥','3♥','4♥','5♥','6♥'], ARRAY['K♣'],
                   'p1', jsonb_build_object('phase','action','hasFirstMeld', jsonb_build_object('p1', false)));
SELECT res->>'ok' AS e4_knock_ok
FROM (SELECT play_turn('VE4','p1','KNOCK', p_expected_version => 0) AS res) x;
SELECT (game->'roundScores'->>'p1') AS e4_p1_score,
       ((game->'roundScores'->>'p1')::INT = 280) AS e4_pass
FROM rooms WHERE id = 'VE4';

-- E5 (functional): 2.1/2.2 — เกิดแล้ว → น็อคมืด ไม่ ×2
SELECT t_new_room('VE5', ARRAY['5♥','5♦','5♣','7♠'], ARRAY['9♣','9♦'], ARRAY['2♥','3♥','4♥'], ARRAY['K♣'],
                   'p1', jsonb_build_object('phase','action','hasFirstMeld', jsonb_build_object('p1', true)));
SELECT res->>'error' AS e5_meld_err
FROM (SELECT play_turn('VE5','p1','MELD', p_meld_codes => '["5♥","5♦","5♣"]', p_expected_version => 0) AS res) x;
SELECT res->>'ok' AS e5_knock_ok
FROM (SELECT play_turn('VE5','p1','KNOCK', p_expected_version => 0) AS res) x;
-- เกิด 5♥5♦5♣ (15 แต้ม) + เหลือ 7♠ (5 แต้ม) + โบนัส 50 + headPoints 50 = 15-5+100 = 110
SELECT (game->'roundScores'->>'p1') AS e5_p1_score,
       ((game->'roundScores'->>'p1')::INT = 110) AS e5_pass
FROM rooms WHERE id = 'VE5';

\echo ''
\echo '===== สรุป ====='
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname='rummy_rank_val_high') = 1 AS rummy_rank_val_high_exists,
  (SELECT count(*) FROM pg_proc WHERE proname='play_turn') = 1               AS play_turn_exists;
