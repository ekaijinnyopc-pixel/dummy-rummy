-- =============================================================
-- FIX v54 (2026-10-25) — A = สูงสุด (14) เสมอ
-- -------------------------------------------------------------
-- กติกาพี่เอยืนยัน: "มอง A เป็นแต้มสูงสุด"
--   · A-2-3, K-A-2 เกิดไม่ได้
--   · เกิดชุดเรียง A ได้แค่ ...Q-K-A
--   · A ฝากต่อชุดเรียงได้แค่ด้านบน K
--   · A ติดกับ K เท่านั้น (ใช้กับกติกาโทษสเปโต 2.3)
--   · A = 14 แต้ม (เพิ่มจาก 1 → 14)
--
-- วิธีแก้: เปลี่ยน rummy_rank_num ให้คืน 14 สำหรับ A เสมอ
--   → ทุก function ที่เรียกใช้ (is_run, can_layoff, pile_has_meld,
--     adjacent_rank, rank_val) ได้ค่าถูกต้องโดยอัตโนมัติ
-- =============================================================

-- 1. rummy_rank_num — A = 14 เสมอ (ตัด branch A-low ออก)
CREATE OR REPLACE FUNCTION rummy_rank_num(p_rank TEXT, p_a_high BOOLEAN DEFAULT FALSE)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  -- FIX v54: A = 14 เสมอ (ไม่มี A-low อีกแล้ว — กติกาพี่เอ)
  IF p_rank = 'A' THEN RETURN 14; END IF;
  CASE p_rank
    WHEN '2'  THEN RETURN 2;
    WHEN '3'  THEN RETURN 3;
    WHEN '4'  THEN RETURN 4;
    WHEN '5'  THEN RETURN 5;
    WHEN '6'  THEN RETURN 6;
    WHEN '7'  THEN RETURN 7;
    WHEN '8'  THEN RETURN 8;
    WHEN '9'  THEN RETURN 9;
    WHEN '10' THEN RETURN 10;
    WHEN 'J'  THEN RETURN 11;
    WHEN 'Q'  THEN RETURN 12;
    WHEN 'K'  THEN RETURN 13;
    ELSE RETURN NULL;
  END CASE;
END;
$$;

-- 2. rummy_is_run — ลบ branch A-low (FALSE) ออก, เหลือแค่ A-high (TRUE)
--    (function นี้เรียก rummy_rank_num ที่ fix แล้ว → ไม่จำเป็นต้องแก้ logic)
--    แต่ลบ branch ซ้ำออกเพื่อความชัดเจน
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
  -- FIX v54: A = 14 เสมอ → เรียก TRUE อย่างเดียว (FALSE ก็คืน 14 เหมือนกันแล้ว)
  RETURN rummy_run_values_ok(rummy_run_values(p_codes, TRUE));
END;
$$;

-- 3. ยืนยัน: probe สดหลัง deploy
-- SELECT rummy_is_run(ARRAY['A♥','2♥','3♥']);  -- คาด false
-- SELECT rummy_is_run(ARRAY['Q♥','K♥','A♥']);  -- คาด true
-- SELECT rummy_rank_num('A', false);            -- คาด 14
-- SELECT rummy_rank_num('A', true);             -- คาด 14
-- SELECT rummy_rank_val('A♠');                  -- คาด 14 (แต้มสูงสุด)
