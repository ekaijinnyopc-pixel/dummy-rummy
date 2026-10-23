-- ============================================================
-- TEST: กติกาโทษ -100 แบบใหม่ (FIX v41 / 2026-10-23)
--   2.1 ทิ้งดัมมี่ (ฝากต่อชุดคนอื่นได้) → -100 ทันที
--   2.2 ตีเต็ม (กองทิ้งมีชุดเกิดครบ + ไพ่ที่เพิ่งทิ้งอยู่) → -100 ทันที
--   2.3 สเปโต (ทิ้งสเปโตที่มีการ์ดเกี่ยว → ค้าง 1 รอบ → มีคน MELD = -100 / ไม่มี = รอด)
--   รวม 2.1 + 2.2 พร้อมกัน → หัก 100 ครั้งเดียว (MAX_PENALTY_PER_DISCARD)
--   LAYOFF (ฝาก) ไม่นับใน 2.3
--
-- วิธีรัน:
--   psql -h /tmp -p 55999 -U postgres -d rummy -f test-speto.sql
-- ============================================================
\pset pager off

-- ---------- สร้างห้องจำลอง ----------
CREATE OR REPLACE FUNCTION mk_room(
  p_id TEXT, p_players TEXT[], p_hands JSONB, p_melds JSONB,
  p_pile TEXT[], p_current TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM rooms WHERE id = p_id;
  INSERT INTO rooms (id, code, players, game, status, version, totalplayers)
  VALUES (p_id, upper(left(p_id,4)), '{}'::jsonb,
    jsonb_build_object(
      'deck', '[]'::jsonb,
      'discardPile', to_jsonb(p_pile),
      'hands', p_hands,
      'melds', p_melds,
      'scores', '{}'::jsonb,
      'totalScores', '{}'::jsonb,
      'hasFirstMeld', jsonb_build_object('p1', true, 'p2', true, 'p3', true, 'p4', true),
      'playerOrder', to_jsonb(p_players),
      'turnPlayerId', p_current,
      'phase', 'action',
      'turnSeq', 0,
      'spettoPenalty', '{}'::jsonb,
      'spettoPenaltyDone', '{}'::jsonb,
      'spettoDiscardDone', '{}'::jsonb,
      'spetoPending', '{}'::jsonb,
      'hasDiscardedThisTurn', '{}'::jsonb,
      'version', 1
    ),
    'playing', 1, array_length(p_players,1));
END;
$$;

-- ---------- เครื่องมือแสดงผล ----------
CREATE OR REPLACE FUNCTION show_state(p_id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE g JSONB;
BEGIN
  SELECT game INTO g FROM rooms WHERE id = p_id;
  RAISE NOTICE '  turnSeq=% | penalty=% | pending=% | discardDone=%',
    g->>'turnSeq', g->'spettoPenalty', g->'spetoPending', g->'spettoDiscardDone';
END;
$$;

\echo ''
\echo '=============================================================='
\echo ' T1: 2.1 ทิ้งดัมมี่ — ไพ่ที่ทิ้งฝากต่อชุดเรียงของ p2 ได้ → p1 เสีย 100'
\echo '=============================================================='
SELECT mk_room('t1', ARRAY['p1','p2'],
  jsonb_build_object('p1', '["6♥","9♣"]'::jsonb, 'p2', '["3♣"]'::jsonb),
  jsonb_build_object('p1', '[]'::jsonb, 'p2', '[["3♥","4♥","5♥"]]'::jsonb),
  ARRAY[]::TEXT[], 'p1');
SELECT (r->>'error') AS err, (r->>'dumy') AS dumy, (r->>'full') AS full,
       (r->>'penalty') AS penalty, (r->'game'->'spettoPenalty') AS spetto
FROM (SELECT play_turn('t1','p1','DISCARD', p_card_code => '6♥', p_expected_version => 0) AS r) s;
SELECT show_state('t1');

\echo ''
\echo '=============================================================='
\echo ' T2: 2.1 ไม่โดน — ทิ้งไพ่ที่ฝากต่อชุดไม่ได้ (7♥) → ไม่หัก'
\echo '=============================================================='
SELECT mk_room('t2', ARRAY['p1','p2'],
  jsonb_build_object('p1', '["7♥","9♣"]'::jsonb, 'p2', '["3♣"]'::jsonb),
  jsonb_build_object('p1', '[]'::jsonb, 'p2', '[["3♥","4♥","5♥"]]'::jsonb),
  ARRAY[]::TEXT[], 'p1');
SELECT (r->>'error') AS err, (r->>'dumy') AS dumy, (r->>'penalty') AS penalty,
       (r->'game'->'spettoPenalty') AS spetto
FROM (SELECT play_turn('t2','p1','DISCARD', p_card_code => '7♥', p_expected_version => 0) AS r) s;

\echo ''
\echo '=============================================================='
\echo ' T3: 2.2 ตีเต็ม (เรียง) — ทิ้ง 7♥ แล้วกองทิ้งเป็น 5♥-6♥-7♥ → p1 เสีย 100'
\echo '=============================================================='
SELECT mk_room('t3', ARRAY['p1','p2'],
  jsonb_build_object('p1', '["7♥","9♣"]'::jsonb, 'p2', '["3♣"]'::jsonb),
  jsonb_build_object('p1', '[]'::jsonb, 'p2', '[]'::jsonb),
  ARRAY['5♥','6♥'], 'p1');
SELECT (r->>'error') AS err, (r->>'dumy') AS dumy, (r->>'full') AS full,
       (r->>'penalty') AS penalty, (r->'game'->'spettoPenalty') AS spetto
FROM (SELECT play_turn('t3','p1','DISCARD', p_card_code => '7♥', p_expected_version => 0) AS r) s;

\echo ''
\echo '=============================================================='
\echo ' T4: 2.2 ไม่โดน — ทิ้ง 7♥ แต่กองทิ้งเป็น 5♥-8♥ → ไม่ครบ → ไม่หัก'
\echo '=============================================================='
SELECT mk_room('t4', ARRAY['p1','p2'],
  jsonb_build_object('p1', '["7♥","9♣"]'::jsonb, 'p2', '["3♣"]'::jsonb),
  jsonb_build_object('p1', '[]'::jsonb, 'p2', '[]'::jsonb),
  ARRAY['5♥','8♥'], 'p1');
SELECT (r->>'error') AS err, (r->>'full') AS full, (r->>'penalty') AS penalty,
       (r->'game'->'spettoPenalty') AS spetto
FROM (SELECT play_turn('t4','p1','DISCARD', p_card_code => '7♥', p_expected_version => 0) AS r) s;

\echo ''
\echo '=============================================================='
\echo ' T5: 2.2 ตีเต็ม (ตอง) — ทิ้ง 5♠ แล้วกองทิ้งเป็นตอง 5 → p1 เสีย 100'
\echo '=============================================================='
SELECT mk_room('t5', ARRAY['p1','p2'],
  jsonb_build_object('p1', '["5♠","9♣"]'::jsonb, 'p2', '["3♣"]'::jsonb),
  jsonb_build_object('p1', '[]'::jsonb, 'p2', '[]'::jsonb),
  ARRAY['5♥','5♦'], 'p1');
SELECT (r->>'error') AS err, (r->>'full') AS full, (r->>'penalty') AS penalty,
       (r->'game'->'spettoPenalty') AS spetto
FROM (SELECT play_turn('t5','p1','DISCARD', p_card_code => '5♠', p_expected_version => 0) AS r) s;

\echo ''
\echo '=============================================================='
\echo ' T6: 2.1 + 2.2 พร้อมกัน → หัก 100 ครั้งเดียว (ไม่ใช่ 200)'
\echo '=============================================================='
SELECT mk_room('t6', ARRAY['p1','p2'],
  jsonb_build_object('p1', '["7♥","9♣"]'::jsonb, 'p2', '["3♣"]'::jsonb),
  jsonb_build_object('p1', '[]'::jsonb, 'p2', '[["8♥","9♥","10♥"]]'::jsonb),
  ARRAY['5♥','6♥'], 'p1');
SELECT (r->>'error') AS err, (r->>'dumy') AS dumy, (r->>'full') AS full,
       (r->>'penalty') AS penalty, (r->'game'->'spettoPenalty') AS spetto
FROM (SELECT play_turn('t6','p1','DISCARD', p_card_code => '7♥', p_expected_version => 0) AS r) s;

\echo ''
\echo '=============================================================='
\echo ' T7: 2.3 สเปโต — ทิ้ง 2♣ ที่มี 2♠ อยู่กองทิ้ง → เกิด pending (ยังไม่หัก)'
\echo '=============================================================='
SELECT mk_room('t7', ARRAY['p1','p2','p3','p4'],
  jsonb_build_object('p1', '["2♣","9♣"]'::jsonb, 'p2', '["6♣","7♣"]'::jsonb,
                     'p3', '["8♣"]'::jsonb, 'p4', '["K♠"]'::jsonb),
  jsonb_build_object('p1', '[]'::jsonb, 'p2', '[]'::jsonb, 'p3', '[]'::jsonb, 'p4', '[]'::jsonb),
  ARRAY['2♠'], 'p1');
SELECT (r->>'error') AS err, (r->>'penalty') AS penalty,
       (r->'game'->'spettoPenalty') AS spetto, (r->'game'->'spetoPending') AS pending,
       (r->'game'->>'turnSeq') AS turn_seq
FROM (SELECT play_turn('t7','p1','DISCARD', p_card_code => '2♣', p_expected_version => 0) AS r) s;

\echo ''
\echo '--- T7b: p2 เกิด (MELD) 2♣ ภายใน 1 รอบ → คนทิ้ง (p1) เสีย 100 ---'
UPDATE rooms SET game = jsonb_set(game, ARRAY['hands','p2'], '["2♣","6♣","7♣"]'::jsonb) WHERE id = 't7';
SELECT (r->>'error') AS err, (r->'game'->'spettoPenalty') AS spetto,
       (r->'game'->'spetoPending') AS pending
FROM (SELECT play_turn('t7','p2','MELD', p_meld_codes => '["2♣","6♣","7♣"]', p_expected_version => 0) AS r) s;

\echo ''
\echo '=============================================================='
\echo ' T8: 2.3 รอด — ทิ้ง 2♣ แล้วผ่านไปครบ 1 รอบ ไม่มีใคร MELD → ไม่หัก'
\echo '=============================================================='
SELECT mk_room('t8', ARRAY['p1','p2','p3','p4'],
  jsonb_build_object('p1', '["2♣","9♣"]'::jsonb, 'p2', '["6♣"]'::jsonb,
                     'p3', '["8♣"]'::jsonb, 'p4', '["K♠"]'::jsonb),
  jsonb_build_object('p1', '[]'::jsonb, 'p2', '[]'::jsonb, 'p3', '[]'::jsonb, 'p4', '[]'::jsonb),
  ARRAY['2♠'], 'p1');
SELECT (r->>'error') AS err, (r->'game'->'spetoPending') AS pending, (r->'game'->>'turnSeq') AS turn_seq
FROM (SELECT play_turn('t8','p1','DISCARD', p_card_code => '2♣', p_expected_version => 0) AS r) s;
-- p2/p3/p4 ทิ้งไพ่ (ครบ 1 รอบ = ตากลับมาที่ p1)
SELECT (r->>'error') AS err, (r->'game'->'spetoPending') AS pending, (r->'game'->>'turnSeq') AS turn_seq,
       (r->'game'->'spettoPenalty') AS spetto
FROM (SELECT play_turn('t8','p2','DISCARD', p_card_code => '6♣', p_expected_version => 0) AS r) s;
SELECT (r->>'error') AS err, (r->'game'->'spetoPending') AS pending, (r->'game'->>'turnSeq') AS turn_seq
FROM (SELECT play_turn('t8','p3','DISCARD', p_card_code => '8♣', p_expected_version => 0) AS r) s;
SELECT (r->>'error') AS err, (r->'game'->'spetoPending') AS pending, (r->'game'->>'turnSeq') AS turn_seq,
       (r->'game'->'spettoPenalty') AS spetto
FROM (SELECT play_turn('t8','p4','DISCARD', p_card_code => 'K♠', p_expected_version => 0) AS r) s;
SELECT show_state('t8');

\echo ''
\echo '=============================================================='
\echo ' T9: LAYOFF ไม่นับ (2.3) — p2 หยิบ 2♣ ไป "ฝาก" → ไม่หัก (pending ยังค้าง)'
\echo '      (หมายเหตุ: ใช้กองทิ้งที่มี 3♣ เพื่อไม่ให้ติด 2.1 ทิ้งดัมมี่)'
\echo '=============================================================='
SELECT mk_room('t9', ARRAY['p1','p2'],
  jsonb_build_object('p1', '["2♣","9♣"]'::jsonb, 'p2', '["3♣"]'::jsonb),
  jsonb_build_object('p1', '[]'::jsonb, 'p2', '[["3♥","4♥","5♥"]]'::jsonb),
  ARRAY['3♣'], 'p1');
SELECT (r->>'error') AS err, (r->>'dumy') AS dumy, (r->>'full') AS full,
       (r->'game'->'spettoPenalty') AS spetto, (r->'game'->'spetoPending') AS pending
FROM (SELECT play_turn('t9','p1','DISCARD', p_card_code => '2♣', p_expected_version => 0) AS r) s;
UPDATE rooms SET game = jsonb_set(game, ARRAY['hands','p2'], '["2♣"]'::jsonb) WHERE id = 't9';
SELECT (r->>'error') AS err, (r->'game'->'spettoPenalty') AS spetto,
       (r->'game'->'spetoPending') AS pending
FROM (SELECT play_turn('t9','p2','LAYOFF', p_card_code => '2♣',
        p_target_pid => 'p2', p_target_meld_idx => 0, p_expected_version => 0) AS r) s;

\echo ''
\echo '=============================================================='
\echo ' T10: KNOCK — ต้องหักโทษสะสมจาก game.spettoPenalty ให้ถูกต้อง'
\echo '=============================================================='
SELECT mk_room('t10', ARRAY['p1','p2'],
  jsonb_build_object('p1', '[]'::jsonb, 'p2', '["9♣"]'::jsonb),
  jsonb_build_object('p1', '[]'::jsonb, 'p2', '[]'::jsonb),
  ARRAY[]::TEXT[], 'p1');
UPDATE rooms SET game = jsonb_set(game, '{spettoPenalty}', '{"p1":100,"p2":100}'::jsonb) WHERE id = 't10';
UPDATE rooms SET game = jsonb_set(game, '{hasFirstMeld}', '{"p1":true,"p2":true}'::jsonb) WHERE id = 't10';
SELECT (r->>'error') AS err, (r->'round_scores') AS round_scores, (r->>'winner') AS winner
FROM (SELECT play_turn('t10','p1','KNOCK', p_expected_version => 0) AS r) s;

\echo ''
\echo '=============================================================='
\echo ' T11: ทิ้งสเปโตที่ไม่มีการ์ดเกี่ยว → ไม่เกิด pending'
\echo '=============================================================='
SELECT mk_room('t11', ARRAY['p1','p2'],
  jsonb_build_object('p1', '["Q♠","9♣"]'::jsonb, 'p2', '["3♣"]'::jsonb),
  jsonb_build_object('p1', '[]'::jsonb, 'p2', '[]'::jsonb),
  ARRAY['9♣'], 'p1');
SELECT (r->>'error') AS err, (r->'game'->'spetoPending') AS pending, (r->'game'->'spettoPenalty') AS spetto
FROM (SELECT play_turn('t11','p1','DISCARD', p_card_code => 'Q♠', p_expected_version => 0) AS r) s;

\echo ''
\echo '=============================================================='
\echo ' T12: ลำดับจริง DISCARD → MELD → DISCARD → KNOCK (ห้องเดียว)'
\echo '      p1 ทิ้ง 2♣ (มี 2♠ อยู่กองทิ้ง = เกี่ยว) → p2 เกิด 2♣ ภายใน 1 รอบ'
\echo '      → คนทิ้ง (p1) เสีย 100 → ตอนน็อคต้องเห็น -100 ในคะแนนรอบ'
\echo '=============================================================='
SELECT mk_room('t12', ARRAY['p1','p2'],
  jsonb_build_object('p1', '["2♣"]'::jsonb, 'p2', '["2♥","2♦","5♣"]'::jsonb),
  jsonb_build_object('p1', '[]'::jsonb, 'p2', '[]'::jsonb),
  ARRAY['2♠'], 'p1');
UPDATE rooms SET game = jsonb_set(game, '{hasFirstMeld}', '{"p1":false,"p2":true}'::jsonb) WHERE id = 't12';

\echo '--- 1) p1 DISCARD 2♣ → เกิด pending (ยังไม่หัก) ---'
SELECT (r->>'error') AS err, (r->>'penalty') AS penalty, (r->'game'->'spettoPenalty') AS spetto,
       (r->'game'->'spetoPending') AS pending, (r->'game'->>'turnPlayerId') AS next_turn,
       (r->'game'->>'turnSeq') AS turn_seq
FROM (SELECT play_turn('t12','p1','DISCARD', p_card_code => '2♣', p_expected_version => 0) AS r) s;

\echo '--- 2) p2 หยิบ 2♣ จากกองทิ้งแล้ว MELD (ตอง 2) → คนทิ้ง p1 เสีย 100 ---'
UPDATE rooms SET game = jsonb_set(game, ARRAY['hands','p2'], '["2♥","2♦","5♣","2♣"]'::jsonb) WHERE id = 't12';
SELECT (r->>'error') AS err, (r->'game'->'spettoPenalty') AS spetto,
       (r->'game'->'spetoPending') AS pending, (r->'game'->>'turnSeq') AS turn_seq
FROM (SELECT play_turn('t12','p2','MELD', p_meld_codes => '["2♣","2♥","2♦"]', p_expected_version => 0) AS r) s;

\echo '--- 3) p2 DISCARD 5♣ → เดินตา (turnSeq++) ---'
SELECT (r->>'error') AS err, (r->'game'->>'turnPlayerId') AS next_turn,
       (r->'game'->>'turnSeq') AS turn_seq, (r->'game'->'spettoPenalty') AS spetto
FROM (SELECT play_turn('t12','p2','DISCARD', p_card_code => '5♣', p_expected_version => 0) AS r) s;

\echo '--- 4) p1 KNOCK (มือว่าง) → ต้องหักโทษ 100 อยู่ในคะแนนรอบ ---'
SELECT (r->>'error') AS err, (r->'round_scores') AS round_scores,
       (r->'game'->'spettoPenalty') AS spetto, (r->>'winner') AS winner
FROM (SELECT play_turn('t12','p1','KNOCK', p_expected_version => 0) AS r) s;
SELECT show_state('t12');

DROP FUNCTION IF EXISTS show_state(TEXT);
DROP FUNCTION IF EXISTS mk_room(TEXT, TEXT[], JSONB, JSONB, TEXT[], TEXT);