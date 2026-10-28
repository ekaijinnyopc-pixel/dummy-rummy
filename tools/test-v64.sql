-- ============================================================
-- TEST v64 (2026-10-28) — "ฝาก" ลงชุดของตัวเองได้ (ตัวเลือก A) + กติกา LAYOFF เดิมยังอยู่
--   ต้องรันหลังโหลด: FIX-speto, APPLY-ALL, FIX-v59, FIX-v60, FIX-v64
--   (มี helper t_new_room จาก test-v60/v61)
-- ============================================================
\set ON_ERROR_STOP on
\pset pager off

\echo '=== A) ฝากลงชุดของตัวเอง → ต้องสำเร็จ (เดิมได้ LAYOFF_OWN_MELD)'
SELECT t_new_room('V64A', ARRAY['4♠','9♥','8♥'], ARRAY['9♣','7♦'], ARRAY['K♣'], ARRAY['2♣'],
                   'p1', jsonb_build_object('phase','action',
                     'hasFirstMeld', jsonb_build_object('p1', true),
                     'everMeld', jsonb_build_object('p1', true),
                     'everPick', jsonb_build_object('p1', true),
                     'melds', jsonb_build_object('p1', jsonb_build_array(jsonb_build_array('5♠','6♠','7♠')))));
SELECT res->>'ok' AS a_ok, COALESCE(res->>'error','') AS a_err
FROM (SELECT play_turn('V64A','p1','LAYOFF', p_card_code => '4♠', p_target_pid => 'p1',
                       p_target_meld_idx => 0, p_expected_version => 0) AS res) x;
SELECT (game->'melds'->'p1'->0)::TEXT AS a_meld,
       (game->'hands'->'p1')::TEXT AS a_hand
FROM rooms WHERE id = 'V64A';
\echo '   คาดหวัง: a_ok = t · a_err = ว่าง · a_meld = 4♠ 5♠ 6♠ 7♠ (เรียงตามเลข) · 4♠ ออกจากมือ'

\echo '=== B) ฝากลงชุดของคนอื่น → ต้องสำเร็จ (กติกาเดิมไม่เปลี่ยน)'
SELECT t_new_room('V64B', ARRAY['4♠','9♥','8♥'], ARRAY['9♣','7♦'], ARRAY['K♣'], ARRAY['2♣'],
                   'p1', jsonb_build_object('phase','action',
                     'hasFirstMeld', jsonb_build_object('p1', true),
                     'everMeld', jsonb_build_object('p1', true),
                     'everPick', jsonb_build_object('p1', true),
                     'melds', jsonb_build_object('p2', jsonb_build_array(jsonb_build_array('5♠','6♠','7♠')))));
SELECT res->>'ok' AS b_ok, COALESCE(res->>'error','') AS b_err
FROM (SELECT play_turn('V64B','p1','LAYOFF', p_card_code => '4♠', p_target_pid => 'p2',
                       p_target_meld_idx => 0, p_expected_version => 0) AS res) x;
SELECT (game->'melds'->'p2'->0)::TEXT AS b_meld FROM rooms WHERE id = 'V64B';
\echo '   คาดหวัง: b_ok = t · b_meld = 4♠ 5♠ 6♠ 7♠'

\echo '=== C) ฝาก anchor (ใบแรกที่หยิบ) → ต้องโดน CANNOT_LAYOFF_ANCHOR (กติกาเดิม)'
SELECT t_new_room('V64C', ARRAY['4♠','9♥','8♥'], ARRAY['9♣','7♦'], ARRAY['K♣'], ARRAY['2♣'],
                   'p1', jsonb_build_object('phase','action',
                     'hasFirstMeld', jsonb_build_object('p1', true),
                     'everMeld', jsonb_build_object('p1', true),
                     'everPick', jsonb_build_object('p1', true),
                     'pickedFromDiscard', jsonb_build_object('p1', jsonb_build_array('4♠')),
                     'melds', jsonb_build_object('p1', jsonb_build_array(jsonb_build_array('5♠','6♠','7♠')))));
SELECT res->>'ok' AS c_ok, COALESCE(res->>'error','') AS c_err
FROM (SELECT play_turn('V64C','p1','LAYOFF', p_card_code => '4♠', p_target_pid => 'p1',
                       p_target_meld_idx => 0, p_expected_version => 0) AS res) x;
\echo '   คาดหวัง: c_ok = f · c_err = CANNOT_LAYOFF_ANCHOR'

\echo '=== D) ยังไม่เคยเก็บเกิดจากกองทิ้ง → ต้องโดน MUST_PICK_FIRST (กติกาเดิม)'
SELECT t_new_room('V64D', ARRAY['4♠','9♥','8♥'], ARRAY['9♣','7♦'], ARRAY['K♣'], ARRAY['2♣'],
                   'p1', jsonb_build_object('phase','action',
                     'hasFirstMeld', jsonb_build_object('p1', true),
                     'everMeld', jsonb_build_object('p1', true),
                     'melds', jsonb_build_object('p1', jsonb_build_array(jsonb_build_array('5♠','6♠','7♠')))));
SELECT res->>'ok' AS d_ok, COALESCE(res->>'error','') AS d_err
FROM (SELECT play_turn('V64D','p1','LAYOFF', p_card_code => '4♠', p_target_pid => 'p1',
                       p_target_meld_idx => 0, p_expected_version => 0) AS res) x;
\echo '   คาดหวัง: d_ok = f · d_err = MUST_PICK_FIRST'

\echo '=== E) ยังไม่เคยเกิดชุดในรอบนี้ → ต้องโดน MUST_MELD_FIRST (กติกาเดิม)'
SELECT t_new_room('V64E', ARRAY['4♠','9♥','8♥'], ARRAY['9♣','7♦'], ARRAY['K♣'], ARRAY['2♣'],
                   'p1', jsonb_build_object('phase','action',
                     'everPick', jsonb_build_object('p1', true),
                     'melds', jsonb_build_object('p1', jsonb_build_array(jsonb_build_array('5♠','6♠','7♠')))));
SELECT res->>'ok' AS e_ok, COALESCE(res->>'error','') AS e_err
FROM (SELECT play_turn('V64E','p1','LAYOFF', p_card_code => '4♠', p_target_pid => 'p1',
                       p_target_meld_idx => 0, p_expected_version => 0) AS res) x;
\echo '   คาดหวัง: e_ok = f · e_err = MUST_MELD_FIRST'

\echo '=== F) FIX v61 (กองจั่วหมด) ยังอยู่ครบ + guard LAYOFF_OWN_MELD หายไป'
SELECT
  position('LAYOFF_OWN_MELD''' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) = 0 AS f_own_guard_gone,
  position('CANNOT_LAYOFF_ANCHOR' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS f_anchor_guard,
  position('MUST_PICK_FIRST'   in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS f_must_pick,
  position('MUST_MELD_FIRST'   in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS f_must_meld,
  position('COALESCE(array_length(v_deck, 1), 0) = 0' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS f_deck_empty_fix,
  (SELECT count(*) FROM pg_proc WHERE proname = 'rummy_end_game_deck_empty') = 1 AS f_end_game_fn;
\echo '   คาดหวัง: ทุกช่อง = t'
