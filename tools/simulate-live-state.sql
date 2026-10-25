-- จำลองสถานะ "live ปัจจุบัน" (ก่อน apply APPLY-ALL) — ใช้เฉพาะกับ DB ทดสอบเท่านั้น
-- rummy_rank_num แบบเก่า (A = 1 เมื่อ p_a_high=false) + adjacent_rank แบบเก่า (A ติดกับ Q)
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
  IF abs(v1 - v2) = 1 THEN RETURN true; END IF;
  IF p_r1 = 'A' AND p_r2 IN ('K','Q') THEN RETURN true; END IF;
  IF p_r2 = 'A' AND p_r1 IN ('K','Q') THEN RETURN true; END IF;
  RETURN false;
END;
$$;

-- rummy_is_run แบบเก่า (รับทั้ง A ต่ำและ A สูง) — ให้สถานะก่อน patch ตรงกับ live จริง
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
