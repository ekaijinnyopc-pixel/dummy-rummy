-- ============================================================
-- TEST v55 (2026-10-25): ข้อ 2 (ฝากต้องเคยเก็บเกิดจากกองทิ้ง) + ข้อ 3 (น็อคมืด ×2)
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

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

-- ============================================================
-- TEST 1: น็อคมืด — ไม่เคยเกิดเลย → คะแนนรอบ ×2
--   p1: เหลือ 7♠ (10 แต้ม) → hand ×2 (ยังไม่เกิด) = 20 · bonus = 100 + 50 = 150
--   คาดหวัง: (0 - 20 + 150) × 2 = 260
-- ============================================================
SELECT t_new_room('T1', ARRAY['7♠'], ARRAY['9♣','9♦'], ARRAY['2♥','3♥','4♥','5♥','6♥'], ARRAY['K♣']);
SELECT r.ok, r.err FROM (SELECT play_turn('T1','p1','KNOCK') AS res) x, LATERAL (SELECT res->>'ok' AS ok, res->>'error' AS err) r;
SELECT round_scores->>'p1' AS t1_score,
       (round_scores->>'p1')::INT = 280 AS t1_pass  -- 7♠=5แต้ม ×2=10 · (0-10+150)×2=280
FROM (SELECT (game->'roundScores') AS round_scores FROM rooms WHERE id='T1') r;

-- ============================================================
-- TEST 2: เกิดแล้ว → น็อค → ไม่ ×2
--   p1 เกิด 5♥5♦5♣ (15 แต้ม) + เหลือ 7♠ (10 แต้ม) · bonus = 50 + 50 = 100
--   คาดหวัง: 15 - 10 + 100 = 105 (ไม่คูณ 2)
-- ============================================================
SELECT t_new_room('T2', ARRAY['5♥','5♦','5♣','7♠'], ARRAY['9♣','9♦'], ARRAY['2♥','3♥','4♥','6♥'], ARRAY['K♣']);
SELECT r.ok, r.err FROM (SELECT play_turn('T2','p1','MELD', NULL, NULL, '["5♥","5♦","5♣"]', NULL, NULL, 1) AS res) x, LATERAL (SELECT res->>'ok' AS ok, res->>'error' AS err) r;
SELECT r.ok, r.err FROM (SELECT play_turn('T2','p1','KNOCK', NULL, NULL, NULL, NULL, NULL, 2) AS res) x, LATERAL (SELECT res->>'ok' AS ok, res->>'error' AS err) r;
SELECT round_scores->>'p1' AS t2_score,
       (round_scores->>'p1')::INT = 110 AS t2_pass  -- meld15 - hand5 + (50+50)=110
FROM (SELECT (game->'roundScores') AS round_scores FROM rooms WHERE id='T2') r;

-- ============================================================
-- TEST 3: ฝากโดยยังไม่เคย "เก็บเกิดจากกองทิ้ง" → MUST_PICK_FIRST
--   p1 เกิดชุดตอง 5♥5♦5♣ แล้ว → p2 ฝาก 9♣ ลงชุดของ p1 → ต้องถูกบล็อก
-- ============================================================
SELECT t_new_room('T3', ARRAY['9♠','9♥','9♦'], ARRAY['9♣','5♥','5♦','5♣'], ARRAY['2♥','3♥','4♥','6♥'], ARRAY['K♣']);
SELECT r.ok, r.err FROM (SELECT play_turn('T3','p1','MELD', NULL, NULL, '["9♠","9♥","9♦"]', NULL, NULL, 1) AS res) x, LATERAL (SELECT res->>'ok' AS ok, res->>'error' AS err) r;
SELECT r.ok, r.err FROM (SELECT play_turn('T3','p2','MELD', NULL, NULL, '["5♥","5♦","5♣"]', NULL, NULL, 2) AS res) x, LATERAL (SELECT res->>'ok' AS ok, res->>'error' AS err) r;
SELECT r.ok, r.err FROM (SELECT play_turn('T3','p2','LAYOFF', '9♣', NULL, NULL, 'p1', 0, 3) AS res) x, LATERAL (SELECT res->>'ok' AS ok, res->>'error' AS err) r;

-- ============================================================
-- TEST 4: เก็บเกิดจากกองทิ้งแล้ว → ฝากได้ (ผ่านเงื่อนไข everPick)
--   p2 เป็นเจ้าของตา → PICK_DISCARD (index 0) → everPick[p2]=true
--   p2 เกิดชุดตอง 9♣9♦9♥ → ฝาก 9♠? ไม่มีในมือ → ใช้ 2♠ ฝากลงชุดตอง 5 → ต้องผ่านเงื่อนไขแล้วไปติดเงื่อนไข "การ์ดต้องเข้ากับชุด"
-- ============================================================
SELECT t_new_room('T4', ARRAY['9♠','9♥','9♦'], ARRAY['9♣','5♥','5♦','5♣'], ARRAY['3♥','4♥','6♥'], ARRAY['K♣'], 'p2');
SELECT r.ok, r.err, (SELECT game->'everPick' FROM rooms WHERE id='T4') AS everpick
FROM (SELECT play_turn('T4','p2','PICK_DISCARD', NULL, 0, NULL, NULL, NULL, 1) AS res) x, LATERAL (SELECT res->>'ok' AS ok, res->>'error' AS err) r;
SELECT r.ok, r.err FROM (SELECT play_turn('T4','p1','MELD', NULL, NULL, '["9♠","9♥","9♦"]', NULL, NULL, 2) AS res) x, LATERAL (SELECT res->>'ok' AS ok, res->>'error' AS err) r;
SELECT r.ok, r.err FROM (SELECT play_turn('T4','p2','MELD', NULL, NULL, '["5♥","5♦","5♣"]', NULL, NULL, 3) AS res) x, LATERAL (SELECT res->>'ok' AS ok, res->>'error' AS err) r;
-- p2 ฝาก 9♣ ลงชุดตอง 9♠9♥9♦ ของ p1 → ผ่านทุกเงื่อนไข (เคยเก็บเกิดจากกองทิ้งแล้ว)
SELECT r.ok, r.err FROM (SELECT play_turn('T4','p2','LAYOFF', '9♣', NULL, NULL, 'p1', 0, 4) AS res) x, LATERAL (SELECT res->>'ok' AS ok, res->>'error' AS err) r;

-- ============================================================
-- TEST 5: ธงข้ามรอบ — everMeld/everPick ถูกเซ็ตอัตโนมัติ
-- ============================================================
SELECT (game->'everMeld'->>'p1') AS t5_evermeld_p1,
       (game->'everPick'->>'p2') AS t5_everpick_p2
FROM rooms WHERE id='T4';


-- ============================================================
-- TEST 6 (FIX v55.1): ห้องเก่า (ไม่มี everMeld) แต่ผู้เล่นเกิดแล้ว → ต้องไม่ ×2
--   p1 เกิดชุด 5♥5♦5♣ (hasFirstMeld=true, ไม่มีธง everMeld) + เหลือ 7♠
--   คาดหวัง: meld 15 - hand 5 + (50+50) = 110 (ไม่ ×2)
-- ============================================================
SELECT t_new_room('T6', ARRAY['5♥','5♦','5♣','7♠'], ARRAY['9♣','9♦'], ARRAY['2♥','3♥','4♥','6♥'], ARRAY['K♣']);
UPDATE rooms SET game = (game - 'everMeld') - 'everPick' WHERE id = 'T6';
SELECT r.ok, r.err FROM (SELECT play_turn('T6','p1','MELD', NULL, NULL, '["5♥","5♦","5♣"]', NULL, NULL, 1) AS res) x, LATERAL (SELECT res->>'ok' AS ok, res->>'error' AS err) r;
SELECT r.ok, r.err FROM (SELECT play_turn('T6','p1','KNOCK', NULL, NULL, NULL, NULL, NULL, 2) AS res) x, LATERAL (SELECT res->>'ok' AS ok, res->>'error' AS err) r;
SELECT round_scores->>'p1' AS t6_score,
       (round_scores->>'p1')::INT = 110 AS t6_pass
FROM (SELECT (game->'roundScores') AS round_scores FROM rooms WHERE id='T6') r;

-- ============================================================
-- TEST 7 (FIX v55.1): backfill ห้องเก่า → เติมธงให้อัตโนมัติ
-- ============================================================
SELECT t_new_room('T7', ARRAY['7♠'], ARRAY['9♣'], ARRAY['2♥','3♥'], ARRAY['K♣']);
UPDATE rooms SET game = (game - 'everMeld') - 'everPick' WHERE id = 'T7';
SELECT (game->'everMeld') IS NOT NULL AS t7_had_flags FROM rooms WHERE id='T7';

ROLLBACK;
