-- ============================================================
-- Dummy Rummy — Supabase Schema Setup
-- วิธีใช้: ไป Supabase → SQL Editor → วางทั้งหมด → Run
--
-- ⚠️⚠️ FIX v41 (2026-10-23) — กติกาโทษ -100 แบบใหม่ (3 กรณี) ⚠️⚠️
--   👉 ไฟล์นี้ "แทน" FIX-scoring-2026-10-21.sql (ไฟล์เดิมเก็บไว้เป็นประวัติ)
--   👉 รันแค่ไฟล์นี้ไฟล์เดียว (ไม่ต้องรัน FIX-pick-discard / FIX-layoff)
--   👉 client (game-core.js?v=41) ปิดการหักโทษฝั่ง client แล้ว → SERVER เป็นเจ้าของโทษฝั่งเดียว
--   (ผู้เสียโทษ = คนทิ้ง เสมอ)
--   2.1 "ทิ้งดัมมี่" = ทิ้งไพ่ที่ฝากต่อชุดเรียง/ชุดตองของผู้เล่นคนอื่นได้ → -100 ทันที
--   2.2 "ตีเต็ม"   = ทิ้งแล้วกองทิ้งมีชุดเกิดครบ (ตอง3/เรียง3) ที่มีไพ่ที่เพิ่งทิ้ง → -100 ทันที
--   2.3 "สเปโต"   = ทิ้งสเปโต (2♣/Q♠) ทั้งที่กองทิ้งมี "การ์ดเกี่ยวเนื่องสเปโต"
--                   → ตั้ง pending (game.spetoPending) รอ 1 รอบ
--                   → ถ้ามีคน MELD ไพ่สเปโตใบนั้นภายในรอบ → คนทิ้งเสีย -100
--                   → ถ้าผ่าน 1 รอบแล้วไม่มีใครเกิด → รอด (ไม่เสียแต้ม)
--   - 2.1 + 2.2 พร้อมกัน = หักรวม 100 ครั้งเดียว (MAX_PENALTY_PER_DISCARD)
--   - LAYOFF (ฝาก) ไม่นับใน 2.3 (ต้องเป็น MELD เท่านั้น)
--   - "1 รอบ" = จนกลับมาถึงตาคนทิ้งอีกครั้ง (ใช้ game.turnSeq นับ)
--
-- ⚠️ FIX 2026-10-21 — บักคะแนน/จบเกม (รอพี่เอยืนยัน Option A)
--   S1 (KNOCK)  : คำนวณแต้มตามกติกาจริง (มอลด์ - มือคู่แข่ง x2 + โบนัส 50/100 + headPoints)
--   S2 (สเปโต) : (ถูกแทนที่ด้วยกติกา v41 ข้างบนแล้ว — หักตอน MELD/LAYOFF ถูก "ลบ" ออก)
--   S1b (KNOCK): FIX v39 อนุญาตน็อคตอนเหลือ 0 หรือ 1 ใบ (เดิมบังคับ 0 ใบ → HAND_NOT_EMPTY)
--   S3 (จบเกม) : เพิ่ม column winner/totalScores + เขียนลง game JSONB → ทุก client เห็นผู้ชนะ
--   ⚠️ รวม FIX 1-5 ของ 2026-10-19 ไว้ในไฟล์เดียว (run ครั้งเดียวจบ)
--
-- ⚠️ FIX 2026-10-19 — "เก็บเกิดไม่ได้"
--   FIX 1 (MELD)  : is_first_meld คำนวณหลังอัปเดต v_has_fm → false ตลอด
--   FIX 2 (LAYOFF): ตรวจ meld index ของเป้าหมายให้อยู่ในช่วงจริง
--   FIX 3 (PICK)  : ไพ่ที่หยิบจากกองทิ้งเคยหายไปจากเกม (ต้นเหตุหลัก!)
--   FIX 4 (PICK)  : บันทึก pickedFromDiscard ให้ server รู้ว่าใครหยิบอะไร
--   FIX 5 (DISCARD): บังคับให้เกิดใบที่หยิบก่อนทิ้ง (MUST_MELD_PICKED)
--   ฝั่ง client (game-core.js) แก้แล้ว: findAllLayoffs + rpcPlayTurn
-- ============================================================

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS totalPlayers INTEGER NOT NULL DEFAULT 4;
-- FIX S3: เพิ่ม column สำหรับผู้ชนะ/คะแนนสะสม (client อ่าน room.winner, room.totalScores)
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "winner" TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "totalScores" JSONB;

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read" ON rooms;
DROP POLICY IF EXISTS "public_insert" ON rooms;
DROP POLICY IF EXISTS "public_update" ON rooms;
DROP POLICY IF EXISTS "public_delete" ON rooms;

CREATE POLICY "public_read" ON rooms FOR SELECT USING (true);
CREATE POLICY "public_insert" ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "public_update" ON rooms FOR UPDATE USING (true);
CREATE POLICY "public_delete" ON rooms FOR DELETE USING (true);


-- ============================================================
-- FIX S1/S2 — helper: แต้มของไพ่ (ต้องตรงกับ cardPoints() ใน game-core.js)
--   สเปโต (2♣ / Q♠) = 50 | A = 15 | J/Q/K/10 = 10 | อื่นๆ = 5
-- ============================================================
CREATE OR REPLACE FUNCTION rummy_card_points(p_code TEXT)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_rank TEXT;
  v_suit TEXT;
BEGIN
  IF p_code IS NULL OR p_code = '' THEN RETURN 0; END IF;
  IF p_code IN ('2♣', 'Q♠') THEN RETURN 50; END IF;   -- สเปโต
  v_suit := right(p_code, 1);
  v_rank := left(p_code, length(p_code) - 1);
  IF v_rank = 'A' THEN RETURN 15; END IF;
  IF v_rank IN ('J', 'Q', 'K', '10') THEN RETURN 10; END IF;
  RETURN 5;
END;
$$;

-- ============================================================
-- FIX v41 (2026-10-23) — กติกาโทษ -100 แบบใหม่ (3 กรณี) : SERVER เป็นเจ้าของโทษฝั่งเดียว
--   ⚠️ ใช้ไฟล์นี้ "แทน" FIX-scoring-2026-10-21.sql (ไฟล์เดิมเก็บไว้เป็นประวัติ)
--   ผู้เสียโทษ = คนทิ้ง เสมอ
--   2.1 "ทิ้งดัมมี่" = ตอนทิ้งไพ่ใบหนึ่ง ถ้าไพ่ใบนั้นฝากต่อชุดเรียง/ชุดกองไพ่ของ
--       ผู้เล่นคนอื่นได้ → คนทิ้งเสีย -100 ทันที (ตอนทิ้งเลย)
--   2.2 "ตีเต็ม" = ตอนทิ้งไพ่ลงกองทิ้ง ถ้าหลังทิ้ง กองทิ้งมี "ชุดเกิด" ที่ครบ
--       (ตอง 3 ใบพร้อมกัน หรือ เรียง 3 ใบพร้อมกันของสีเดียวกัน) และชุดเกิดนั้นมีไพ่ที่
--       เพิ่งทิ้งอยู่ → คนทิ้งเสีย -100 ทันที
--   2.3 "สเปโต" = ตอนทิ้งสเปโต (2♣ หรือ Q♠) ลงกองทิ้ง ขณะที่กองทิ้งมี "การ์ดเกี่ยว
--       เนื่องสเปโต" → เกิดสถานะค้าง (game.spetoPending) ถ้าภายใน "1 รอบ" มีผู้หยิบสเปโต
--       ใบนั้นไป "เกิด" (MELD) → คนทิ้งเสีย -100 / ถ้าผ่าน 1 รอบแล้วไม่มีใครเกิด → รอด
--
--   คำนิยาม:
--     - "การ์ดเกี่ยวเนื่องสเปโต" = ไพ่บนกองทิ้งที่ (ก) มีตัวเลขเดียวกับสเปโต
--       (2♣ กับ 2♠/2♥/2♦, Q♠ กับ Q♣/Q♥/Q♦) หรือ (ข) สีเดียวกับสเปโตและตัวเลขติดกัน
--       (2♣ กับ 3♣/A♣, Q♠ กับ K♠/J♠/A♠)
--     - "1 รอบ" = ครบ 1 รอบผู้เล่นทั้งโต๊ะ นับจากการทิ้ง (ผู้เล่นคนอื่นทยอยทิ้งไพ่จนกลับมา
--       ถึงตาคนทิ้งอีกครั้ง) → ใช้ game.turnSeq (เพิ่ม 1 ทุกครั้งที่เดินตา)
--     - 2.1 ใช้ตรรกะ layoff ตามเกมนี้: สเปโตฝากได้เฉพาะชุดตอง (ห้ามฝากลงชุดเรียง)
--     - 2.3: LAYOFF (ฝาก) ไม่นับ — ต้องเป็น MELD (เกิด) เท่านั้น
--     - ถ้าการทิ้งใบหนึ่งทำให้ 2.1 และ 2.2 พร้อมกัน → หัก -100 ครั้งเดียว
--       (คนละครั้งหักไม่เกิน 100) = MAX_PENALTY_PER_DISCARD
-- ============================================================

-- ===== helper: ตัวเลข/สีของไพ่ (A=1, 2..10, J=11, Q=12, K=13 ; A สูง = 14 แยก) =====
CREATE OR REPLACE FUNCTION rummy_rank_num(p_rank TEXT, p_a_high BOOLEAN DEFAULT FALSE)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF p_rank IS NULL THEN RETURN NULL; END IF;
  IF p_rank = 'A' THEN RETURN CASE WHEN p_a_high THEN 14 ELSE 1 END; END IF;
  IF p_rank = 'J' THEN RETURN 11; END IF;
  IF p_rank = 'Q' THEN RETURN 12; END IF;
  IF p_rank = 'K' THEN RETURN 13; END IF;
  IF p_rank ~ '^[0-9]{1,2}$' THEN RETURN p_rank::INTEGER; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION rummy_rank(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_last TEXT;
  v_rank TEXT;
BEGIN
  IF p_code IS NULL OR p_code = '' THEN RETURN NULL; END IF;
  v_last := right(p_code, 1);
  IF v_last NOT IN ('♠','♥','♦','♣') THEN RETURN NULL; END IF;
  v_rank := left(p_code, length(p_code) - 1);
  IF v_rank NOT IN ('A','2','3','4','5','6','7','8','9','10','J','Q','K') THEN RETURN NULL; END IF;
  RETURN v_rank;
END;
$$;

CREATE OR REPLACE FUNCTION rummy_suit(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_last TEXT;
BEGIN
  IF p_code IS NULL OR p_code = '' THEN RETURN NULL; END IF;
  v_last := right(p_code, 1);
  IF v_last IN ('♠','♥','♦','♣') THEN RETURN v_last; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION rummy_rank_val(p_code TEXT)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN rummy_rank_num(rummy_rank(p_code), FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION rummy_rank_val_high(p_code TEXT)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN rummy_rank_num(rummy_rank(p_code), TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION rummy_is_speto(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN p_code IN ('2♣','Q♠');
END;
$$;

-- เลขติดกัน (A ต่ำ = 1 / A สูง = 14) — ใช้กับกติกา 2.3
CREATE OR REPLACE FUNCTION rummy_adjacent_rank(p_r1 TEXT, p_r2 TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v1 INTEGER;
  v2 INTEGER;
BEGIN
  IF p_r1 IS NULL OR p_r2 IS NULL THEN RETURN false; END IF;
  v1 := rummy_rank_num(p_r1, FALSE);
  v2 := rummy_rank_num(p_r2, FALSE);
  IF v1 IS NULL OR v2 IS NULL THEN RETURN false; END IF;
  IF abs(v1 - v2) = 1 THEN RETURN true; END IF;                    -- A(1) ติดกับ 2
  IF p_r1 = 'A' AND p_r2 IN ('K','Q') THEN RETURN true; END IF;      -- A สูง (เรียง Q-K-A)
  IF p_r2 = 'A' AND p_r1 IN ('K','Q') THEN RETURN true; END IF;
  RETURN false;
END;
$$;

-- ตอง: ตัวเลขเดียวกัน >= 3 ใบ คนละสำเนา (สเปโตเข้าตองได้)
CREATE OR REPLACE FUNCTION rummy_is_set(p_codes TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_rank_distinct INTEGER;
  v_suit_distinct INTEGER;
  v_code TEXT;
BEGIN
  IF p_codes IS NULL OR array_length(p_codes, 1) < 3 THEN RETURN false; END IF;
  SELECT count(DISTINCT rummy_rank(c)) INTO v_rank_distinct FROM unnest(p_codes) AS t(c);
  SELECT count(DISTINCT rummy_suit(c)) INTO v_suit_distinct FROM unnest(p_codes) AS t(c);
  IF v_rank_distinct <> 1 OR v_suit_distinct <> array_length(p_codes, 1) THEN RETURN false; END IF;
  FOREACH v_code IN ARRAY p_codes LOOP
    IF rummy_rank(v_code) IS NULL OR rummy_suit(v_code) IS NULL THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- ค่าตัวเลขของชุดเรียง (เรียงตามลำดับ) — NULL ถ้ามีสเปโต/ไพ่ผิดรูป
CREATE OR REPLACE FUNCTION rummy_run_values(p_codes TEXT[], p_a_high BOOLEAN DEFAULT FALSE)
RETURNS INTEGER[]
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_vals INTEGER[];
  v_code TEXT;
BEGIN
  IF p_codes IS NULL OR array_length(p_codes, 1) = 0 THEN RETURN NULL; END IF;
  SELECT array_agg(rummy_rank_num(rummy_rank(c), p_a_high) ORDER BY rummy_rank_num(rummy_rank(c), p_a_high))
    INTO v_vals
  FROM unnest(p_codes) AS t(c);
  IF v_vals IS NULL THEN RETURN NULL; END IF;
  FOREACH v_code IN ARRAY p_codes LOOP
    IF rummy_is_speto(v_code) THEN RETURN NULL; END IF;   -- สเปโตห้ามอยู่ในชุดเรียง
  END LOOP;
  RETURN v_vals;
END;
$$;

CREATE OR REPLACE FUNCTION rummy_run_values_ok(p_vals INTEGER[])
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  i INTEGER;
  prev INTEGER := NULL;
BEGIN
  IF p_vals IS NULL OR array_length(p_vals, 1) < 3 THEN RETURN false; END IF;
  FOR i IN 1..array_length(p_vals, 1) LOOP
    IF p_vals[i] IS NULL THEN RETURN false; END IF;
    IF prev IS NOT NULL AND p_vals[i] <> prev + 1 THEN RETURN false; END IF;
    prev := p_vals[i];
  END LOOP;
  RETURN true;
END;
$$;

-- เรียง: สีเดียวกัน เลขติดกัน >= 3 ใบ (A ต่ำ/สูงได้ — K-A-2 ไม่เกิด)
CREATE OR REPLACE FUNCTION rummy_is_run(p_codes TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_suit_distinct INTEGER;
BEGIN
  IF p_codes IS NULL OR array_length(p_codes, 1) < 3 THEN RETURN false; END IF;
  SELECT count(DISTINCT rummy_suit(c)) INTO v_suit_distinct FROM unnest(p_codes) AS t(c);
  IF v_suit_distinct <> 1 THEN RETURN false; END IF;
  IF rummy_run_values_ok(rummy_run_values(p_codes, FALSE)) THEN RETURN true; END IF;
  IF rummy_run_values_ok(rummy_run_values(p_codes, TRUE)) THEN RETURN true; END IF;
  RETURN false;
END;
$$;

-- ชนิดชุด: 'set' | 'run' | NULL
CREATE OR REPLACE FUNCTION rummy_meld_type(p_codes TEXT[])
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF rummy_is_set(p_codes) THEN RETURN 'set'; END IF;
  IF rummy_is_run(p_codes) THEN RETURN 'run'; END IF;
  RETURN NULL;
END;
$$;

-- ===== 2.1 — ไพ่ใบนี้ "ฝากต่อ" ชุดนี้ได้ไหม (เหมือน findAllLayoffs ฝั่ง client) =====
CREATE OR REPLACE FUNCTION rummy_can_layoff(p_card TEXT, p_meld TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_type TEXT;
  v_code TEXT;
  v_suit TEXT;
  v_vals INTEGER[];
  v_min INTEGER;
  v_max INTEGER;
  v_card INTEGER;
  v_i INTEGER;
  v_a_high BOOLEAN;
BEGIN
  IF p_card IS NULL OR p_meld IS NULL OR array_length(p_meld, 1) = 0 THEN RETURN false; END IF;
  v_type := rummy_meld_type(p_meld);
  IF v_type = 'set' THEN
    -- ตอง: ตัวเลขเดียวกัน คนละสำเนา
    IF rummy_rank(p_card) IS NULL OR rummy_rank(p_card) <> rummy_rank(p_meld[1]) THEN RETURN false; END IF;
    FOREACH v_code IN ARRAY p_meld LOOP
      IF v_code = p_card THEN RETURN false; END IF;
      IF rummy_suit(v_code) = rummy_suit(p_card) THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  ELSIF v_type = 'run' THEN
    -- เรียง: สีเดียวกัน และตัวเลข = ต่ำสุด-1 หรือสูงสุด+1 (รองรับ A ต่ำ/สูง)
    IF rummy_suit(p_card) <> rummy_suit(p_meld[1]) THEN RETURN false; END IF;
    IF rummy_is_speto(p_card) THEN RETURN false; END IF;   -- สเปโตฝากลงชุดเรียงไม่ได้
    FOR v_i IN 0..1 LOOP
      v_a_high := (v_i = 1);
      v_vals := rummy_run_values(p_meld, v_a_high);
      IF NOT rummy_run_values_ok(v_vals) THEN CONTINUE; END IF;
      v_min := (SELECT min(x) FROM unnest(v_vals) AS u(x));
      v_max := (SELECT max(x) FROM unnest(v_vals) AS u(x));
      v_card := rummy_rank_num(rummy_rank(p_card), v_a_high);
      IF v_card IS NULL THEN CONTINUE; END IF;
      IF v_card = v_min - 1 OR v_card = v_max + 1 THEN RETURN true; END IF;
    END LOOP;
    RETURN false;
  END IF;
  RETURN false;
END;
$$;

-- ===== 2.2 — ทิ้งแล้วกองทิ้งมี "ชุดเกิด" ครบที่มีไพ่ที่เพิ่งทิ้งอยู่ไหม =====
CREATE OR REPLACE FUNCTION rummy_pile_has_meld_with(p_pile TEXT[], p_card TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_pile TEXT[];
  v_same TEXT[];
  v_suit_cards TEXT[];
  v_vals INTEGER[];
  v_rank TEXT;
  v_suit TEXT;
  v_t INTEGER;
  v_up INTEGER;
  v_down INTEGER;
  v_min INTEGER;
  v_max INTEGER;
  v_i INTEGER;
  v_a_high BOOLEAN;
BEGIN
  IF p_card IS NULL OR rummy_rank(p_card) IS NULL THEN RETURN false; END IF;
  v_pile := COALESCE(p_pile, ARRAY[]::TEXT[]);
  IF NOT (p_card = ANY(v_pile)) THEN v_pile := array_append(v_pile, p_card); END IF;

  -- (ก) ตอง 3 ใบพร้อมกัน (ตัวเลขเดียวกัน คนละสำเนา)
  v_rank := rummy_rank(p_card);
  SELECT array_agg(c) INTO v_same FROM unnest(v_pile) AS t(c) WHERE rummy_rank(c) = v_rank;
  IF rummy_is_set(v_same) THEN RETURN true; END IF;

  -- (ข) เรียง 3 ใบพร้อมกันของสีเดียวกัน (สเปโตห้ามอยู่ในชุดเรียง)
  IF rummy_is_speto(p_card) THEN RETURN false; END IF;
  v_suit := rummy_suit(p_card);
  SELECT array_agg(c) INTO v_suit_cards FROM unnest(v_pile) AS t(c)
    WHERE rummy_suit(c) = v_suit AND NOT rummy_is_speto(c);
  IF v_suit_cards IS NULL OR array_length(v_suit_cards, 1) < 3 THEN RETURN false; END IF;

  FOR v_i IN 0..1 LOOP
    v_a_high := (v_i = 1);
    v_vals := rummy_run_values(v_suit_cards, v_a_high);
    IF v_vals IS NULL THEN CONTINUE; END IF;
    v_t := rummy_rank_num(rummy_rank(p_card), v_a_high);
    IF v_t IS NULL OR NOT (v_t = ANY(v_vals)) THEN CONTINUE; END IF;
    v_min := (SELECT min(x) FROM unnest(v_vals) AS u(x));
    v_max := (SELECT max(x) FROM unnest(v_vals) AS u(x));
    v_up := 0;
    WHILE (v_t + v_up + 1) <= v_max AND ((v_t + v_up + 1) = ANY(v_vals)) LOOP v_up := v_up + 1; END LOOP;
    v_down := 0;
    WHILE (v_t - v_down - 1) >= v_min AND ((v_t - v_down - 1) = ANY(v_vals)) LOOP v_down := v_down + 1; END LOOP;
    IF (v_up + v_down + 1) >= 3 THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END;
$$;

-- ===== 2.3 — กองทิ้งมี "การ์ดเกี่ยวเนื่องสเปโต" ไหม =====
CREATE OR REPLACE FUNCTION rummy_speto_related(p_speto TEXT, p_pile TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_code TEXT;
  v_r TEXT;
  v_s TEXT;
  v_pr TEXT;
  v_ps TEXT;
BEGIN
  IF NOT rummy_is_speto(p_speto) THEN RETURN false; END IF;
  v_pr := rummy_rank(p_speto);
  v_ps := rummy_suit(p_speto);
  IF v_pr IS NULL OR v_ps IS NULL THEN RETURN false; END IF;
  FOREACH v_code IN ARRAY COALESCE(p_pile, ARRAY[]::TEXT[]) LOOP
    IF v_code IS NULL OR v_code = p_speto THEN CONTINUE; END IF;
    v_r := rummy_rank(v_code);
    v_s := rummy_suit(v_code);
    IF v_r IS NULL OR v_s IS NULL THEN CONTINUE; END IF;
    IF v_r = v_pr THEN RETURN true; END IF;                                   -- (ก) ตัวเลขเดียวกัน
    IF v_s = v_ps AND rummy_adjacent_rank(v_r, v_pr) THEN RETURN true; END IF; -- (ข) สีเดียวกัน + เลขติดกัน
  END LOOP;
  RETURN false;
END;
$$;

-- ============================================================
-- play_turn() — p_meld_codes เปลี่ยนเป็น JSONB
-- ============================================================
CREATE OR REPLACE FUNCTION play_turn(
  p_game_id           TEXT,
  p_player_id         TEXT,
  p_action            TEXT,
  p_card_code         TEXT DEFAULT NULL,
  p_discard_index     INTEGER DEFAULT NULL,
  p_meld_codes        TEXT DEFAULT NULL,
  p_target_pid        TEXT DEFAULT NULL,
  p_target_meld_idx   INTEGER DEFAULT NULL,
  p_expected_version  INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_game          JSONB;
  v_locked_game   JSONB;
  v_new_version   INTEGER;
  v_players       TEXT[];
  v_current_pid   TEXT;
  v_next_pid     TEXT;
  v_idx           INTEGER;
  v_next_idx     INTEGER;
  v_deck          TEXT[];
  v_discard       TEXT[];
  v_hands         JSONB;
  v_melds         JSONB;
  v_scores        JSONB;
  v_old_hand      TEXT[];
  v_new_hand      TEXT[];
  v_card_arr      JSONB;
  v_new           TEXT[];
  v_old           TEXT[];
  v_pick          JSONB;
  v_has_fm        JSONB;
  v_pids          TEXT[];
  v_meld_count    INTEGER;
  v_rm            JSONB;
  v_rscore        JSONB;
  v_rhand         TEXT[];
  v_p_meld_idx    INTEGER;
  v_old_meld      TEXT[];
  v_new_meld      TEXT[];
  v_new_melds     JSONB;
  v_new_scores    JSONB;
  v_score_diff    INTEGER;
  v_round_scores  JSONB;
  v_total_scores  JSONB;
  v_meld_pts      INTEGER;
  v_hand_pts      INTEGER;
  v_penalty       INTEGER;
  v_win_pid       TEXT;
  v_min_total     INTEGER;
  v_pm            JSONB;
  v_pm_codes      TEXT[];
  v_card_arr2     JSONB;
  v_mii_penalty   INTEGER;
  v_head_pts      INTEGER;
  v_result        JSONB;
  v_meld_arr      TEXT[];
  v_is_first_meld BOOLEAN;
  v_picked        JSONB;
  v_speto_loser   TEXT;
  v_has_discarded BOOLEAN;
  -- FIX v41 (2026-10-23): กติกาโทษ -100 แบบใหม่ (2.1/2.2/2.3)
  v_turn_seq      INTEGER;   -- ตัวนับรอบ (เพิ่ม 1 ทุกครั้งที่เดินตา) → ตัดสิน "1 รอบ"
  v_max_penalty   INTEGER := 100;   -- MAX_PENALTY_PER_DISCARD (หักรวมต่อการทิ้งไม่เกิน 100)
  v_dumy          BOOLEAN := false; -- 2.1 ทิ้งดัมมี่
  v_full          BOOLEAN := false; -- 2.2 ตีเต็ม
  v_discard_penalty INTEGER := 0;
  v_n_players     INTEGER;
  v_owner_melds   JSONB;
  v_meld_codes2   TEXT[];
  v_pending       JSONB;
  v_pending_info  JSONB;
  v_discarder     TEXT;
  v_expires       INTEGER;
  v_code2         TEXT;
  v_penalty_key   TEXT;
  v_tmp_idx       INTEGER;
  v_tmp_code      TEXT;
  v_old_pile      TEXT[];
  v_pending_keys  TEXT[];
BEGIN
  SELECT game, version INTO v_game, v_new_version FROM rooms WHERE id = p_game_id FOR UPDATE;
  v_new_version := COALESCE(v_new_version, 0);
  IF v_game IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'ROOM_NOT_FOUND'); END IF;
  v_locked_game := v_game;

  IF p_expected_version > 0 AND v_new_version != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_MISMATCH', 'details', 'version mismatch');
  END IF;

  v_current_pid := v_game->>'turnPlayerId';
  IF p_action NOT IN ('MELD','LAYOFF','END_TURN') AND v_current_pid != p_player_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  v_deck    := ARRAY(SELECT jsonb_array_elements_text(v_game->'deck'));
  v_discard := ARRAY(SELECT jsonb_array_elements_text(v_game->'discardPile'));
  v_hands   := v_game->'hands';
  v_melds   := COALESCE(v_game->'melds', '{}'::JSONB);
  v_scores  := COALESCE(v_game->'scores', '{}'::JSONB);
  v_has_fm  := COALESCE(v_game->'hasFirstMeld', '{}'::JSONB);
  v_new_version := v_new_version + 1;

  -- FIX v39.2 (2026-10-23): jsonb_set ที่ path 2 ชั้น (เช่น {'spetoOrigin','2♣'})
  --   จะ "เขียนทับเงียบ ๆ" (ไม่ error, ไม่มีอะไรเกิดขึ้น) ถ้า key ชั้นแรกยังไม่มีอยู่
  --   → ต้องสร้าง parent object ให้ครบก่อนเสมอ
  IF jsonb_typeof(v_game->'hasDiscardedThisTurn') IS DISTINCT FROM 'object' THEN
    v_game := jsonb_set(v_game, '{hasDiscardedThisTurn}', '{}'::JSONB);
  END IF;
  IF jsonb_typeof(v_game->'pickedFromDiscard') IS DISTINCT FROM 'object' THEN
    v_game := jsonb_set(v_game, '{pickedFromDiscard}', '{}'::JSONB);
  END IF;
  IF jsonb_typeof(v_game->'spetoOrigin') IS DISTINCT FROM 'object' THEN
    v_game := jsonb_set(v_game, '{spetoOrigin}', '{}'::JSONB);
  END IF;
  IF jsonb_typeof(v_game->'spettoPenalty') IS DISTINCT FROM 'object' THEN
    v_game := jsonb_set(v_game, '{spettoPenalty}', '{}'::JSONB);
  END IF;
  IF jsonb_typeof(v_game->'spettoPenaltyDone') IS DISTINCT FROM 'object' THEN
    v_game := jsonb_set(v_game, '{spettoPenaltyDone}', '{}'::JSONB);
  END IF;
  -- FIX v41: pending สเปโต (2.3) + ธงกันหักซ้ำตอนทิ้ง
  IF jsonb_typeof(v_game->'spetoPending') IS DISTINCT FROM 'object' THEN
    v_game := jsonb_set(v_game, '{spetoPending}', '{}'::JSONB);
  END IF;
  IF jsonb_typeof(v_game->'spettoDiscardDone') IS DISTINCT FROM 'object' THEN
    v_game := jsonb_set(v_game, '{spettoDiscardDone}', '{}'::JSONB);
  END IF;
  v_turn_seq := COALESCE((v_game->>'turnSeq')::INT, 0);

  -- DRAW_DECK
  IF p_action = 'DRAW_DECK' THEN
    IF v_current_pid != p_player_id THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN'); END IF;
    IF array_length(v_deck, 1) = 0 THEN
      v_game := jsonb_set(v_game, '{deckEmpty}', 'true');
      v_game := jsonb_set(v_game, '{phase}', '"action"');
      v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
      UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;
      RETURN jsonb_build_object('ok', true, 'game', v_game, 'deckEmpty', true);
    END IF;
    v_deck := v_deck[1:array_length(v_deck,1)-1];
    v_card_arr := v_hands->p_player_id;
    IF v_card_arr IS NULL THEN v_card_arr := '[]'::JSONB; END IF;
    v_new := ARRAY(SELECT jsonb_array_elements_text(v_card_arr)) || ARRAY[v_deck[array_upper(v_deck,1)]];
    v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new));
    v_game := jsonb_set(v_game, '{hands}', v_hands);
    v_game := jsonb_set(v_game, '{deck}', to_jsonb(v_deck));
    v_game := jsonb_set(v_game, '{phase}', '"action"');
    -- Reset hasDiscardedThisTurn when starting a fresh turn (draw)
    v_game := jsonb_set(v_game, ARRAY['hasDiscardedThisTurn', p_player_id], 'false');
    -- FIX 4 (ต่อ): จั่วใหม่ = ไม่มีใบที่หยิบค้างไว้
    v_game := jsonb_set(v_game, ARRAY['pickedFromDiscard', p_player_id], '[]'::JSONB);
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game);

  -- PICK_DISCARD
  -- FIX 3: เดิม v_discard[1:p_discard_index] ตัดทิ้งไพ่ที่หยิบ + ใบที่อยู่บนทิ้งหาย
  --        แล้วเอา "ไพ่ที่เหลือ" ไปใส่มือแทน → ไพ่หายจากเกม, เกิดไม่ได้
  --        แก้: หยิบไพ่ที่ index นั้น + ทุกใบที่อยู่บน → เข้ามือ
  ELSIF p_action = 'PICK_DISCARD' THEN
    IF v_current_pid != p_player_id THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN'); END IF;
    IF p_discard_index < 0 OR p_discard_index >= array_length(v_discard, 1) THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_INDEX'); END IF;
    -- ไพ่ที่หยิบ = ตั้งแต่ index นี้ขึ้นไป (ใบที่อยู่บนทั้งหมด)
    v_pick := to_jsonb(v_discard[p_discard_index + 1:array_length(v_discard,1)]);
    -- ไพ่ที่เหลือในกองทิ้ง = ก่อนหน้า index นี้
    v_discard := v_discard[1:p_discard_index];
    v_card_arr := v_hands->p_player_id;
    IF v_card_arr IS NULL THEN v_card_arr := '[]'::JSONB; END IF;
    v_new := ARRAY(SELECT jsonb_array_elements_text(v_card_arr))
             || ARRAY(SELECT jsonb_array_elements_text(v_pick));
    v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new));
    -- FIX 4: บันทึกว่าหยิบอะไร → server บังคับให้เกิดใบที่หยิบก่อนทิ้งได้
    v_game := jsonb_set(v_game, ARRAY['pickedFromDiscard', p_player_id], v_pick);
    v_game := jsonb_set(v_game, '{hands}', v_hands);
    -- FIX S2 (v39): หยิบสเปโต = ยังไม่เสียแต้ม (หักตอนนำไปเกิด/ฝากเท่านั้น)
    -- แต่จดจำ "คนที่ทิ้ง" ไว้ เผื่อผู้หยิบนำไปเกิด/ฝาก → คนทิ้งเป็นผู้เสีย 100 แต้ม
    v_mii_penalty := 0;
    FOR i IN 1..jsonb_array_length(v_pick) LOOP
      IF v_pick->>i IN ('2♣','Q♠') THEN v_mii_penalty := 100; END IF;
    END LOOP;
    v_game := jsonb_set(v_game, '{discardPile}', to_jsonb(v_discard));
    v_game := jsonb_set(v_game, '{phase}', '"action"');
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game, 'mii_penalty', v_mii_penalty);

  -- DISCARD
  ELSIF p_action = 'DISCARD' THEN
    IF v_current_pid != p_player_id THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN'); END IF;
    IF p_card_code IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_CARD'); END IF;
    -- FIX 5: ถ้ายังไม่เกิดใบที่หยิบ → ห้ามทิ้ง (บังคับกติกาฝั่ง server)
    v_picked := COALESCE(v_game->'pickedFromDiscard'->p_player_id, '[]'::JSONB);
    IF jsonb_array_length(v_picked) > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MUST_MELD_PICKED', 'details', 'ต้องเกิดใบที่หยิบจากกองทิ้งก่อน');
    END IF;
    v_card_arr := v_hands->p_player_id;
    IF v_card_arr IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'HAND_NOT_FOUND'); END IF;
    v_old := ARRAY(SELECT jsonb_array_elements_text(v_card_arr));
    IF p_card_code != ALL(v_old) THEN RETURN jsonb_build_object('ok', false, 'error', 'CARD_NOT_IN_HAND'); END IF;
    v_new_hand := array_remove(v_old, p_card_code);
    v_old_pile := v_discard;   -- FIX v41: กองทิ้ง "ก่อนทิ้ง" (ใช้ตรวจการ์ดเกี่ยวสเปโต 2.3)
    v_discard := array_append(v_discard, p_card_code);
    v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new_hand));
    v_game := jsonb_set(v_game, '{hands}', v_hands);
    v_game := jsonb_set(v_game, '{discardPile}', to_jsonb(v_discard));
    -- บันทึกว่าผู้เล่นทิ้งไพ่แล้วในตานี้
    v_game := jsonb_set(v_game, ARRAY['hasDiscardedThisTurn', p_player_id], 'true');
    -- FIX S2 (v39): จดจำผู้ทิ้งสเปโตไว้ใน game.spetoOrigin[code] (ใช้เป็นข้อมูลสำรอง)
    IF p_card_code IN ('2♣','Q♠') THEN
      v_game := jsonb_set(v_game, ARRAY['spetoOrigin', p_card_code], to_jsonb(p_player_id));
    END IF;

    -- =====================================================================
    -- FIX v41 (2026-10-23) — กติกาโทษ -100 แบบใหม่ (3 กรณี) : ผู้เสีย = คนทิ้ง
    --   2.1 "ทิ้งดัมมี่" — ไพ่ที่ทิ้งฝากต่อชุด (เรียง/ตอง) ของผู้เล่นคนอื่นได้ → -100 ทันที
    --   2.2 "ตีเต็ม"   — ทิ้งแล้วกองทิ้งมีชุดเกิดครบ (ที่มีไพ่ที่เพิ่งทิ้งอยู่) → -100 ทันที
    --   2.3 "สเปโต"   — ทิ้งสเปโตทั้งที่กองทิ้งมีการ์ดเกี่ยวเนื่องสเปโต → ตั้ง pending
    --                   (รอ 1 รอบ: ถ้ามีคน MELD ไพ่ใบนั้น → -100 / ไม่มี → รอด)
    --   หักรวมต่อ 1 การทิ้งไม่เกิน MAX_PENALTY_PER_DISCARD (2.1+2.2 พร้อมกัน = 100 เดียว)
    -- =====================================================================
    v_players := ARRAY(SELECT jsonb_array_elements_text(v_game->'playerOrder'));
    v_n_players := array_length(v_players, 1);
    v_dumy := false;
    v_full := false;
    v_discard_penalty := 0;

    -- 2.1: ไพ่ที่ทิ้ง "ฝากต่อชุดของผู้เล่นคนอื่น" ได้ไหม
    IF v_n_players IS NOT NULL AND v_n_players > 0 THEN
      FOR i IN 1..v_n_players LOOP
        IF v_players[i] = p_player_id THEN CONTINUE; END IF;   -- ชุดของตัวเองไม่นับ
        v_owner_melds := COALESCE(v_melds->v_players[i], '[]'::JSONB);
        FOR v_tmp_idx IN 0..jsonb_array_length(v_owner_melds)-1 LOOP
          v_meld_codes2 := ARRAY(SELECT jsonb_array_elements_text(v_owner_melds->v_tmp_idx));
          IF rummy_can_layoff(p_card_code, v_meld_codes2) THEN
            v_dumy := true;
            EXIT;
          END IF;
        END LOOP;
        IF v_dumy THEN EXIT; END IF;
      END LOOP;
    END IF;

    -- 2.2: หลังทิ้ง กองทิ้งมีชุดเกิดครบที่มีไพ่ที่เพิ่งทิ้งอยู่ไหม
    v_full := rummy_pile_has_meld_with(v_discard, p_card_code);

    -- หักโทษตอนทิ้ง (2.1 + 2.2 → รวมไม่เกิน 100)
    v_penalty_key := p_player_id || ':' || v_turn_seq::TEXT;
    IF (v_dumy OR v_full)
       AND NOT COALESCE((v_game->'spettoDiscardDone'->>v_penalty_key)::BOOLEAN, false) THEN
      v_discard_penalty := LEAST(v_max_penalty,
        (CASE WHEN v_dumy THEN 100 ELSE 0 END) + (CASE WHEN v_full THEN 100 ELSE 0 END));
      v_game := jsonb_set(v_game, '{spettoPenalty}', COALESCE(v_game->'spettoPenalty', '{}'::JSONB));
      v_game := jsonb_set(v_game, ARRAY['spettoPenalty', p_player_id],
        to_jsonb(COALESCE((v_game->'spettoPenalty'->>p_player_id)::INT, 0) + v_discard_penalty));
      v_game := jsonb_set(v_game, ARRAY['spettoDiscardDone', v_penalty_key], 'true');
    END IF;

    -- 2.3: ทิ้งสเปโตทั้งที่กองทิ้ง (ก่อนทิ้ง) มีการ์ดเกี่ยวเนื่องสเปโต → ตั้ง pending รอ 1 รอบ
    IF rummy_is_speto(p_card_code) AND rummy_speto_related(p_card_code, v_old_pile) THEN
      v_pending := COALESCE(v_game->'spetoPending', '{}'::JSONB);
      IF jsonb_typeof(v_pending) IS DISTINCT FROM 'object' THEN v_pending := '{}'::JSONB; END IF;
      v_pending := jsonb_set(v_pending, ARRAY[p_card_code], jsonb_build_object(
        'discarder', p_player_id,
        'expiresAtTurn', (v_turn_seq + 1 + (v_n_players - 1))::INTEGER,
        'code', p_card_code));
      v_game := jsonb_set(v_game, '{spetoPending}', v_pending);
    END IF;

    v_idx := 0;
    FOR i IN 1..array_length(v_players,1) LOOP IF v_players[i] = v_current_pid THEN v_idx := i; EXIT; END IF; END LOOP;
    v_next_idx := (v_idx % array_length(v_players,1)) + 1;
    v_next_pid := v_players[v_next_idx];
    -- FIX v41: เดินตา → เพิ่มตัวนับรอบ (ใช้ตัดสิน "1 รอบ" ของ 2.3)
    v_turn_seq := v_turn_seq + 1;
    v_game := jsonb_set(v_game, '{turnSeq}', to_jsonb(v_turn_seq));
    -- ล้าง pending ที่หมดอายุแล้ว (ถึงตาคนทิ้งกลับมา = ผ่าน 1 รอบแล้ว)
    v_pending := COALESCE(v_game->'spetoPending', '{}'::JSONB);
    IF jsonb_typeof(v_pending) = 'object' THEN
      SELECT array_agg(k) INTO v_pending_keys FROM jsonb_object_keys(v_pending) AS k;
      IF v_pending_keys IS NOT NULL THEN
        FOREACH v_tmp_code IN ARRAY v_pending_keys LOOP
          v_expires := COALESCE((v_pending->v_tmp_code->>'expiresAtTurn')::INT, 0);
          IF v_expires <= v_turn_seq THEN
            v_pending := v_pending - v_tmp_code;
          END IF;
        END LOOP;
      END IF;
      v_game := jsonb_set(v_game, '{spetoPending}', v_pending);
    END IF;
    v_game := jsonb_set(v_game, '{turnPlayerId}', to_jsonb(v_next_pid));
    v_game := jsonb_set(v_game, '{phase}', '"draw"');
    v_game := jsonb_set(v_game, '{lastDiscard}', jsonb_build_object('playerId', p_player_id, 'cardCode', p_card_code));
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game,
      'penalty', v_discard_penalty, 'dumy', v_dumy, 'full', v_full);

  -- MELD (JSONB p_meld_codes → TEXT[])
  ELSIF p_action = 'MELD' THEN
    v_meld_arr := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_meld_codes::JSONB)), ARRAY[]::TEXT[]);
    IF v_meld_arr = ARRAY[]::TEXT[] THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_MELD_CODES'); END IF;
    v_card_arr := v_hands->p_player_id;
    IF v_card_arr IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'HAND_NOT_FOUND'); END IF;
    v_old := ARRAY(SELECT jsonb_array_elements_text(v_card_arr));
    FOR i IN 1..array_length(v_meld_arr, 1) LOOP
      IF v_meld_arr[i] != ALL(v_old) THEN RETURN jsonb_build_object('ok', false, 'error', 'CARD_NOT_IN_HAND'); END IF;
    END LOOP;
    SELECT ARRAY(SELECT u FROM unnest(v_old) AS u WHERE NOT (u = ANY(v_meld_arr))) INTO v_new_hand;
    v_melds := COALESCE(v_melds, '{}'::JSONB);
    v_melds := jsonb_set(v_melds, ARRAY[p_player_id], COALESCE(v_melds->p_player_id, '[]'::JSONB) || jsonb_build_array(to_jsonb(v_meld_arr)));
    v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new_hand));
    v_is_first_meld := NOT COALESCE((v_has_fm->>p_player_id)::BOOLEAN, false);
    v_has_fm := v_has_fm || jsonb_build_object(p_player_id, true);
    -- FIX 4 (ต่อ): เกิดแล้ว → ล้างรายการใบที่หยิบ (ทั้งที่เกิดไปแล้วและที่เหลือในมือ)
    v_game := jsonb_set(v_game, ARRAY['pickedFromDiscard', p_player_id], '[]'::JSONB);
    v_game := jsonb_set(v_game, '{hands}', v_hands);
    v_game := jsonb_set(v_game, '{melds}', v_melds);
    v_game := jsonb_set(v_game, '{hasFirstMeld}', v_has_fm);
    -- FIX v41 (2026-10-23): กติกา 2.3 "สเปโต" — โทษเกิดเมื่อมีการ MELD ที่ "ใช้ไพ่สเปโตใบนั้นจริง"
    --   (LAYOFF/ฝาก ไม่นับ) และต้องอยู่ภายใน "1 รอบ" (turnSeq < expiresAtTurn)
    --   - ยังไม่หมดอายุ → คนทิ้งเสีย 100 แล้วลบ pending นั้น
    --   - หมดอายุแล้ว   → ลบ pending โดยไม่หัก (รอด)
    --   โทษเดิมของ v39 (หักตอน MELD/LAYOFF ทันที) ถูก "ลบ" ไปแล้ว → server เป็นเจ้าของโทษฝั่งเดียว
    v_pending := COALESCE(v_game->'spetoPending', '{}'::JSONB);
    IF jsonb_typeof(v_pending) IS DISTINCT FROM 'object' THEN v_pending := '{}'::JSONB; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(v_pending)) > 0 THEN
      FOR i IN 1..array_length(v_meld_arr, 1) LOOP
        v_code2 := v_meld_arr[i];
        IF v_pending ? v_code2 THEN
          v_pending_info := v_pending->v_code2;
          v_discarder := v_pending_info->>'discarder';
          v_expires := COALESCE((v_pending_info->>'expiresAtTurn')::INT, 0);
          IF v_turn_seq < v_expires THEN
            v_game := jsonb_set(v_game, '{spettoPenalty}', COALESCE(v_game->'spettoPenalty', '{}'::JSONB));
            v_game := jsonb_set(v_game, ARRAY['spettoPenalty', v_discarder],
              to_jsonb(COALESCE((v_game->'spettoPenalty'->>v_discarder)::INT, 0) + v_max_penalty));
            v_game := jsonb_set(v_game, ARRAY['spettoPenaltyDone', v_code2], 'true');
          END IF;
          v_pending := v_pending - v_code2;   -- ลบ pending (กันหักซ้ำ)
          v_game := jsonb_set(v_game, '{spetoPending}', v_pending);
        END IF;
      END LOOP;
    END IF;
    -- ล้าง spetoOrigin ของไพ่ที่เพิ่งเกิด (ไม่ต้องเก็บไว้แล้ว)
    FOR i IN 1..array_length(v_meld_arr, 1) LOOP
      IF v_meld_arr[i] IN ('2♣','Q♠') THEN
        v_game := v_game #- ARRAY['spetoOrigin', v_meld_arr[i]];
      END IF;
    END LOOP;
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game, 'is_first_meld', v_is_first_meld);

  -- LAYOFF
  ELSIF p_action = 'LAYOFF' THEN
    IF p_card_code IS NULL OR p_target_pid IS NULL OR p_target_meld_idx IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'MISSING_PARAMS'); END IF;
    v_card_arr := v_hands->p_player_id;
    IF v_card_arr IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'HAND_NOT_FOUND'); END IF;
    v_old := ARRAY(SELECT jsonb_array_elements_text(v_card_arr));
    IF p_card_code != ALL(v_old) THEN RETURN jsonb_build_object('ok', false, 'error', 'CARD_NOT_IN_HAND'); END IF;
    IF NOT COALESCE((v_has_fm->>p_player_id)::BOOLEAN, false) THEN RETURN jsonb_build_object('ok', false, 'error', 'MUST_MELD_FIRST'); END IF;
    v_p_meld_idx := p_target_meld_idx;
    -- FIX 2: กัน meld index หลุด/เกินช่วง (เดิมจะ error ตอน jsonb_array_elements_text)
    IF v_p_meld_idx < 0 OR v_p_meld_idx >= jsonb_array_length(COALESCE(v_melds->p_target_pid, '[]'::JSONB)) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MELD_NOT_FOUND');
    END IF;
    v_old_meld := ARRAY(SELECT jsonb_array_elements_text((v_melds->p_target_pid)->v_p_meld_idx));
    v_new_meld := array_append(v_old_meld, p_card_code);
    DECLARE v_player_meld_arr JSONB;
    BEGIN
      v_player_meld_arr := COALESCE(v_melds->p_target_pid, '[]'::JSONB);
      v_player_meld_arr := jsonb_set(v_player_meld_arr, ARRAY[v_p_meld_idx::TEXT], to_jsonb(v_new_meld));
      v_melds := jsonb_set(v_melds, ARRAY[p_target_pid], v_player_meld_arr);
    END;
    v_new_hand := array_remove(v_old, p_card_code);
    v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new_hand));
    v_game := jsonb_set(v_game, '{hands}', v_hands);
    v_game := jsonb_set(v_game, '{melds}', v_melds);
    -- FIX v41 (2026-10-23): ลบโทษสเปโตตอน "ฝาก" (LAYOFF) ออก
    --   กติกาใหม่: 2.3 โทษเกิดเมื่อมีการ MELD ที่ใช้ไพ่สเปโตใบนั้นจริงเท่านั้น (ฝาก = ไม่นับ)
    --   → ฝากสเปโต = ไม่เสียแต้ม (pending 2.3 ยังค้างรออยู่ ถ้ามี)
    v_game := v_game #- ARRAY['spetoOrigin', p_card_code];
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game);

  -- KNOCK  (FIX S1: คำนวณแต้มตามกติกาจริง)
  ELSIF p_action = 'KNOCK' THEN
    IF v_current_pid != p_player_id THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN'); END IF;
    v_card_arr := v_hands->p_player_id;
    IF v_card_arr IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'HAND_NOT_FOUND'); END IF;
    -- FIX S1b (v39): น็อคได้ตอนเหลือ 0 หรือ 1 ใบ (ไพ่ 1 ใบที่เหลือ = นับเป็นแต้มหัก)
    IF jsonb_array_length(v_card_arr) > 1 THEN RETURN jsonb_build_object('ok', false, 'error', 'HAND_NOT_EMPTY'); END IF;
    v_players := ARRAY(SELECT jsonb_array_elements_text(v_game->'playerOrder'));
    v_scores := COALESCE(v_game->'scores', '{}'::JSONB);
    v_round_scores := '{}'::JSONB;
    v_head_pts := COALESCE((v_game->>'headPoints')::INT, 0);
    -- คำนวณแต้มรอบนี้ของทุกคน
    FOR i IN 1..array_length(v_players, 1) LOOP
      DECLARE
        v_pid      TEXT := v_players[i];
        v_meld_pts INTEGER := 0;
        v_hand_pts INTEGER := 0;
        v_penalty  INTEGER := 0;
        v_pm       JSONB;
      BEGIN
        -- แต้มมอลด์
        v_pm := COALESCE(v_melds->v_pid, '[]'::JSONB);
        FOR j IN 0..jsonb_array_length(v_pm)-1 LOOP
          v_pm_codes := ARRAY(SELECT jsonb_array_elements_text(v_pm->j));
          FOR k IN 1..GREATEST(COALESCE(array_length(v_pm_codes,1),0),1) LOOP
            IF k <= array_length(v_pm_codes,1) THEN
              v_meld_pts := v_meld_pts + rummy_card_points(v_pm_codes[k]);
            END IF;
          END LOOP;
        END LOOP;
        -- แต้มมือ (v39): ผู้น็อคที่เหลือ 0 ใบ = 0 / เหลือ 1 ใบ = นับแต้มจริง · คนที่ยังไม่เกิด = x2
        v_pm := COALESCE(v_hands->v_pid, '[]'::JSONB);
        IF NOT (v_pid = p_player_id AND jsonb_array_length(v_pm) = 0) THEN
          FOR j IN 0..jsonb_array_length(v_pm)-1 LOOP
            v_hand_pts := v_hand_pts + rummy_card_points(v_pm->>j);
          END LOOP;
          IF NOT COALESCE((v_has_fm->>v_pid)::BOOLEAN, false) THEN
            v_hand_pts := v_hand_pts * 2;
          END IF;
        END IF;
        -- โทษสเปโต (สเปโตเข้าชุดเกิด/ฝาก) = -100
        v_penalty := COALESCE((v_game->'spettoPenalty'->>v_pid)::INT, 0);
        v_round_scores := jsonb_set(v_round_scores, ARRAY[v_pid],
          to_jsonb(v_meld_pts - v_hand_pts - v_penalty));
      END;
    END LOOP;
    -- โบนัสคนที่น็อค: เกิดแล้ว 50 / ยังไม่เกิด 100 + headPoints
    v_score_diff := CASE WHEN COALESCE((v_has_fm->>p_player_id)::BOOLEAN, false) THEN 50 ELSE 100 END + v_head_pts;
    v_round_scores := jsonb_set(v_round_scores, ARRAY[p_player_id],
      to_jsonb(COALESCE((v_round_scores->>p_player_id)::INT, 0) + v_score_diff));
    -- คะแนนสะสม = เดิม + รอบนี้
    v_total_scores := '{}'::JSONB;
    FOR i IN 1..array_length(v_players, 1) LOOP
      DECLARE v_tpid TEXT := v_players[i];
      BEGIN
        v_total_scores := jsonb_set(v_total_scores, ARRAY[v_tpid],
          to_jsonb(COALESCE((v_scores->>v_tpid)::INT, 0) + COALESCE((v_round_scores->>v_tpid)::INT, 0)));
      END;
    END LOOP;
    -- ผู้ชนะ: ถ้ามีใครสะสม >= 500 → คนที่สะสมน้อยที่สุดชนะ (เหมือน handleKnockout() ใน client)
    v_win_pid := NULL;
    v_min_total := NULL;
    FOR i IN 1..array_length(v_players, 1) LOOP
      DECLARE v_tpid TEXT := v_players[i]; v_ttot INTEGER;
      BEGIN
        v_ttot := COALESCE((v_total_scores->>v_tpid)::INT, 0);
        IF v_ttot >= 500 THEN
          v_win_pid := 'PENDING';   -- มีคนถึง 500 แล้ว
        END IF;
      END;
    END LOOP;
    IF v_win_pid = 'PENDING' THEN
      v_win_pid := NULL;
      FOR i IN 1..array_length(v_players, 1) LOOP
        DECLARE v_tpid TEXT := v_players[i]; v_ttot INTEGER;
        BEGIN
          v_ttot := COALESCE((v_total_scores->>v_tpid)::INT, 0);
          IF v_min_total IS NULL OR v_ttot < v_min_total THEN
            v_min_total := v_ttot;
            v_win_pid := v_tpid;
          END IF;
        END;
      END LOOP;
    END IF;
    -- FIX S3: เขียนผู้ชนะ + คะแนนสะสมไว้ทั้ง column และ game JSONB
    v_game := jsonb_set(v_game, '{scores}', v_total_scores);
    v_game := jsonb_set(v_game, '{roundScores}', v_round_scores);
    -- FIX v41: jsonb_set(target, path, NULL) → NULL (ลบ game ทิ้งทั้งก้อน!)
    --   → ต้องแปลง NULL ให้เป็น JSON null ก่อน (กรณีไม่มีใครสะสมถึง 500 = ยังไม่จบเกม)
    v_game := jsonb_set(v_game, '{winner}', COALESCE(to_jsonb(v_win_pid), 'null'::JSONB));
    v_game := jsonb_set(v_game, '{totalScores}', v_total_scores);
    v_game := jsonb_set(v_game, '{status}', '"ended"');
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, status = 'ended', version = v_new_version,
                     "winner" = v_win_pid, "totalScores" = v_total_scores
      WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game,
      'round_scores', v_round_scores, 'total_scores', v_total_scores, 'winner', v_win_pid);

  -- END_TURN
  ELSIF p_action = 'END_TURN' THEN
    -- ตรวจสอบว่าทิ้งไพ่แล้วในตานี้ (บังคับตามกติกาดัมมี่)
    v_has_discarded := COALESCE((v_game->'hasDiscardedThisTurn')->>p_player_id, 'false')::BOOLEAN;
    IF NOT v_has_discarded THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MUST_DISCARD', 'details', 'ต้องทิ้งไพ่ 1 ใบก่อนจบตา');
    END IF;
    -- ล้าง hasDiscardedThisTurn ของทุกคนก่อนเริ่มตาใหม่
    v_game := jsonb_set(v_game, '{hasDiscardedThisTurn}', '{}'::JSONB);
    v_players := ARRAY(SELECT jsonb_array_elements_text(v_game->'playerOrder'));
    v_idx := 0;
    FOR i IN 1..array_length(v_players,1) LOOP IF v_players[i] = v_current_pid THEN v_idx := i; EXIT; END IF; END LOOP;
    v_next_idx := (v_idx % array_length(v_players,1)) + 1;
    v_next_pid := v_players[v_next_idx];
    -- FIX v41: เดินตา → เพิ่มตัวนับรอบ + ล้าง pending สเปโตที่หมดอายุ (ผ่าน 1 รอบแล้ว)
    v_turn_seq := v_turn_seq + 1;
    v_game := jsonb_set(v_game, '{turnSeq}', to_jsonb(v_turn_seq));
    v_pending := COALESCE(v_game->'spetoPending', '{}'::JSONB);
    IF jsonb_typeof(v_pending) = 'object' THEN
      SELECT array_agg(k) INTO v_pending_keys FROM jsonb_object_keys(v_pending) AS k;
      IF v_pending_keys IS NOT NULL THEN
        FOREACH v_tmp_code IN ARRAY v_pending_keys LOOP
          v_expires := COALESCE((v_pending->v_tmp_code->>'expiresAtTurn')::INT, 0);
          IF v_expires <= v_turn_seq THEN
            v_pending := v_pending - v_tmp_code;
          END IF;
        END LOOP;
      END IF;
      v_game := jsonb_set(v_game, '{spetoPending}', v_pending);
    END IF;
    v_game := jsonb_set(v_game, '{turnPlayerId}', to_jsonb(v_next_pid));
    v_game := jsonb_set(v_game, '{phase}', '"draw"');
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game);

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_ACTION');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION play_turn TO anon;
GRANT EXECUTE ON FUNCTION play_turn TO authenticated;
