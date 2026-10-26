-- =====================================================================
-- ✅ VERIFY หลังรัน APPLY-ALL-2026-10-25.sql (2026-10-26)
-- ---------------------------------------------------------------------
-- 📌 วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์นี้ → Run
--    คัดลอกผลลัพธ์มาให้จินเช็คได้เลยค่ะ (ส่ง screenshot ก็ได้)
--    ⚠️ ไฟล์นี้เป็น read-only (มีแค่ SELECT) — รันซ้ำกี่ครั้งก็ปลอดภัย
-- =====================================================================

-- 1) A = 14 เสมอ + ไม่มี A ต่ำ → คาด 14 / 14 / 14
SELECT rummy_rank_num('A', false) AS a_low_expect_14,
       rummy_rank_num('A', true)  AS a_high_expect_14,
       rummy_rank_val('A♠')       AS a_val_expect_14;

-- 2) กติกา A สูงสุด → คาด false / true
SELECT rummy_is_run(ARRAY['A♥','2♥','3♥']) AS a23_expect_false,
       rummy_is_run(ARRAY['K♠','A♠','2♠']) AS ka2_expect_false,
       rummy_is_run(ARRAY['Q♥','K♥','A♥']) AS qka_expect_true,
       rummy_is_run(ARRAY['J♥','Q♥','K♥','A♥']) AS jqka_expect_true;

-- 3) FIX v54.1 — A ติดกับ K เท่านั้น → คาด true / false / false
SELECT rummy_adjacent_rank('A','K') AS a_k_expect_true,
       rummy_adjacent_rank('A','Q') AS a_q_expect_false,
       rummy_adjacent_rank('A','2') AS a_2_expect_false;

-- 4) สเปโตเกี่ยว: Q♠ กับ K♠ = เกี่ยว ✅ · Q♠ กับ A♠ = ไม่เกี่ยว ✅
SELECT rummy_speto_related('Q♠', ARRAY['K♠','9♥']) AS ks_expect_true,
       rummy_speto_related('Q♠', ARRAY['A♠','9♥']) AS as_expect_false,
       rummy_speto_related('2♣', ARRAY['3♣','9♥']) AS c3_expect_true;

-- 5) play_turn มี guard ครบ → คาด true ทั้ง 4
SELECT position('INVALID_MELD' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS guard_invalid_meld,
       position('DUPLICATE_CARD' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS guard_dup_card,
       position('MUST_PICK_FIRST' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS guard_must_pick,
       position('everMeld' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS flag_ever_meld;

-- 6) backfill ธงเสร็จแล้ว → คาด 0
SELECT count(*) AS rooms_missing_flags_expect_0
FROM rooms
WHERE status = 'playing'
  AND game IS NOT NULL
  AND (jsonb_typeof(game->'everMeld') IS DISTINCT FROM 'object'
       OR jsonb_typeof(game->'everPick') IS DISTINCT FROM 'object');

-- 7) สุขภาพห้องบน live → ไม่มีห้อง game=NULL / ไพ่ซ้ำ
SELECT count(*) AS rooms_total,
       count(*) FILTER (WHERE status = 'playing') AS rooms_playing,
       count(*) FILTER (WHERE status = 'ended')   AS rooms_ended,
       count(*) FILTER (WHERE status = 'playing' AND game IS NULL) AS rooms_game_null_expect_0
FROM rooms;

-- 8) เช็คไพ่ซ้ำทั้งระบบ (ต้องได้ 0 แถว = ไม่มีห้องไหนไพ่ซ้ำ)
--    (ห้องที่ไพ่ไม่ครบ 52 ใบ = ห้องทดสอบ ไม่ใช่บั๊ก — เช็คเฉพาะไพ่ซ้ำ)
SELECT r.id AS room_id,
       count(*) AS cards_total_expect_52,
       count(DISTINCT c) AS cards_unique_expect_52
FROM rooms r
CROSS JOIN LATERAL (
  SELECT jsonb_array_elements_text(COALESCE(r.game->'deck','[]'::JSONB)) AS c
  UNION ALL
  SELECT jsonb_array_elements_text(v.h) FROM jsonb_each(COALESCE(r.game->'hands','{}'::JSONB)) AS v(pid, h)
  UNION ALL
  SELECT jsonb_array_elements_text(m.meld)
  FROM jsonb_each(COALESCE(r.game->'melds','{}'::JSONB)) AS v(pid, melds)
  CROSS JOIN LATERAL jsonb_array_elements(v.melds) AS m(meld)
  UNION ALL
  SELECT jsonb_array_elements_text(COALESCE(r.game->'discardPile','[]'::JSONB))
) x
WHERE r.game IS NOT NULL
GROUP BY r.id
HAVING count(*) <> count(DISTINCT c);   -- ❌ ไพ่ซ้ำเท่านั้นที่ผิด (ห้องที่ไพ่ไม่ครบ 52 = ห้องทดสอบ)

-- 9) ตรวจว่ามีห้องที่ "เกิดผิด" (ชุดที่ไม่ใช่ชุดจริง) หลัง patch → ควรได้ 0 แถว
SELECT r.id AS room_id, m.pid AS player_id, m2.meld_codes,
       rummy_meld_type(ARRAY(SELECT jsonb_array_elements_text(m2.meld_codes))) AS actual_type
FROM rooms r
CROSS JOIN LATERAL jsonb_each(
  CASE WHEN jsonb_typeof(r.game->'melds') = 'object' THEN r.game->'melds' ELSE '{}'::JSONB END
) AS m(pid, melds)
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(m.melds) = 'array' THEN m.melds ELSE '[]'::JSONB END
) AS m2(meld_codes)
WHERE r.game IS NOT NULL
  AND rummy_meld_type(ARRAY(SELECT jsonb_array_elements_text(m2.meld_codes))) IS NULL;
