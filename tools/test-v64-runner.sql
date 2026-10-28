-- RUNNER (2026-10-28) — สรุปผล regression SQL ของ FIX v64 เป็นตัวเลข pass/fail
\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on
\pset format unaligned

CREATE TEMP TABLE r64_results (name text, passed boolean, detail text);

DO $$
DECLARE
  v_res  JSONB;
  v_ok   BOOLEAN;
  v_err  TEXT;
  v_meld TEXT;
BEGIN
  -- A) ฝากลงชุดของตัวเอง → ต้องสำเร็จ
  PERFORM t_new_room('V64A', ARRAY['4♠','9♥','8♥'], ARRAY['9♣','7♦'], ARRAY['K♣'], ARRAY['2♣'],
                     'p1', jsonb_build_object('phase','action',
                       'hasFirstMeld', jsonb_build_object('p1', true),
                       'everMeld', jsonb_build_object('p1', true),
                       'everPick', jsonb_build_object('p1', true),
                       'melds', jsonb_build_object('p1', jsonb_build_array(jsonb_build_array('5♠','6♠','7♠')))));
  SELECT play_turn('V64A','p1','LAYOFF', p_card_code => '4♠', p_target_pid => 'p1',
                   p_target_meld_idx => 0, p_expected_version => 0) INTO v_res;
  SELECT (game->'melds'->'p1'->0)::TEXT INTO v_meld FROM rooms WHERE id='V64A';
  INSERT INTO r64_results VALUES ('A ฝากลงชุดของตัวเองสำเร็จ',
    (v_res->>'ok')::BOOLEAN AND v_meld = '["4♠", "5♠", "6♠", "7♠"]',
    'ok=' || (v_res->>'ok') || ' err=' || COALESCE(v_res->>'error','') || ' meld=' || v_meld);

  -- B) ฝากลงชุดของคนอื่น → ต้องสำเร็จ
  PERFORM t_new_room('V64B', ARRAY['4♠','9♥','8♥'], ARRAY['9♣','7♦'], ARRAY['K♣'], ARRAY['2♣'],
                     'p1', jsonb_build_object('phase','action',
                       'hasFirstMeld', jsonb_build_object('p1', true),
                       'everMeld', jsonb_build_object('p1', true),
                       'everPick', jsonb_build_object('p1', true),
                       'melds', jsonb_build_object('p2', jsonb_build_array(jsonb_build_array('5♠','6♠','7♠')))));
  SELECT play_turn('V64B','p1','LAYOFF', p_card_code => '4♠', p_target_pid => 'p2',
                   p_target_meld_idx => 0, p_expected_version => 0) INTO v_res;
  INSERT INTO r64_results VALUES ('B ฝากลงชุดของคนอื่นสำเร็จ (กติกาเดิม)',
    (v_res->>'ok')::BOOLEAN, 'ok=' || (v_res->>'ok') || ' err=' || COALESCE(v_res->>'error',''));

  -- C) anchor → CANNOT_LAYOFF_ANCHOR
  PERFORM t_new_room('V64C', ARRAY['4♠','9♥','8♥'], ARRAY['9♣','7♦'], ARRAY['K♣'], ARRAY['2♣'],
                     'p1', jsonb_build_object('phase','action',
                       'hasFirstMeld', jsonb_build_object('p1', true),
                       'everMeld', jsonb_build_object('p1', true),
                       'everPick', jsonb_build_object('p1', true),
                       'pickedFromDiscard', jsonb_build_object('p1', jsonb_build_array('4♠')),
                       'melds', jsonb_build_object('p1', jsonb_build_array(jsonb_build_array('5♠','6♠','7♠')))));
  SELECT play_turn('V64C','p1','LAYOFF', p_card_code => '4♠', p_target_pid => 'p1',
                   p_target_meld_idx => 0, p_expected_version => 0) INTO v_res;
  INSERT INTO r64_results VALUES ('C anchor ยังถูกบล็อก (CANNOT_LAYOFF_ANCHOR)',
    v_res->>'error' = 'CANNOT_LAYOFF_ANCHOR', 'err=' || COALESCE(v_res->>'error',''));

  -- D) ไม่เคยเก็บเกิดจากกองทิ้ง → MUST_PICK_FIRST
  PERFORM t_new_room('V64D', ARRAY['4♠','9♥','8♥'], ARRAY['9♣','7♦'], ARRAY['K♣'], ARRAY['2♣'],
                     'p1', jsonb_build_object('phase','action',
                       'hasFirstMeld', jsonb_build_object('p1', true),
                       'everMeld', jsonb_build_object('p1', true),
                       'melds', jsonb_build_object('p1', jsonb_build_array(jsonb_build_array('5♠','6♠','7♠')))));
  SELECT play_turn('V64D','p1','LAYOFF', p_card_code => '4♠', p_target_pid => 'p1',
                   p_target_meld_idx => 0, p_expected_version => 0) INTO v_res;
  INSERT INTO r64_results VALUES ('D ยังไม่เคยเก็บเกิด (MUST_PICK_FIRST)',
    v_res->>'error' = 'MUST_PICK_FIRST', 'err=' || COALESCE(v_res->>'error',''));

  -- E) ยังไม่เคยเกิดชุดในรอบนี้ → MUST_MELD_FIRST
  PERFORM t_new_room('V64E', ARRAY['4♠','9♥','8♥'], ARRAY['9♣','7♦'], ARRAY['K♣'], ARRAY['2♣'],
                     'p1', jsonb_build_object('phase','action',
                       'everPick', jsonb_build_object('p1', true),
                       'melds', jsonb_build_object('p1', jsonb_build_array(jsonb_build_array('5♠','6♠','7♠')))));
  SELECT play_turn('V64E','p1','LAYOFF', p_card_code => '4♠', p_target_pid => 'p1',
                   p_target_meld_idx => 0, p_expected_version => 0) INTO v_res;
  INSERT INTO r64_results VALUES ('E ยังไม่เคยเกิดชุด (MUST_MELD_FIRST)',
    v_res->>'error' = 'MUST_MELD_FIRST', 'err=' || COALESCE(v_res->>'error',''));
END $$;

-- F) ตรวจตัว guard ใน play_turn
INSERT INTO r64_results
SELECT 'F guard LAYOFF_OWN_MELD หายจาก play_turn',
       position('LAYOFF_OWN_MELD''' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) = 0,
       'position=' || position('LAYOFF_OWN_MELD''' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure));

INSERT INTO r64_results
SELECT 'G เงื่อนไข LAYOFF เดิมยังอยู่ (anchor + must pick + must meld + meld not found)',
       position('CANNOT_LAYOFF_ANCHOR' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0
   AND position('MUST_PICK_FIRST'    in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0
   AND position('MUST_MELD_FIRST'    in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0
   AND position('MELD_NOT_FOUND'     in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0,
       'guards ok';

INSERT INTO r64_results
SELECT 'H FIX v61 (กองจั่วหมด = จบเกม) ยังอยู่ครบ',
       (SELECT count(*) FROM pg_proc WHERE proname = 'rummy_end_game_deck_empty') = 1
   AND position('rummy_end_game_deck_empty' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0,
       'v61 ok';

SELECT name || ' | ' || CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END || ' | ' || detail
FROM r64_results ORDER BY name;

SELECT 'TOTAL | ผ่าน ' || count(*) FILTER (WHERE passed) || ' / ไม่ผ่าน ' || count(*) FILTER (WHERE NOT passed)
FROM r64_results;
