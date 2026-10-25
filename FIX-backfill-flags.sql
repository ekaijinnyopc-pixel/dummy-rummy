-- =====================================================================
-- 🔧 FIX backfill ธง everMeld/everPick (2026-10-25) — รันซ้ำได้ (idempotent)
-- ---------------------------------------------------------------------
-- 📌 ใช้เมื่อ: ห้องเก่าที่ยังไม่มีธง → ตอนน็อคจะคิด "น็อคมืด ×2" ผิด
--    (ธง everMeld = เคยเกิดชุดมาก่อนหรือยัง · everPick = เคยเก็บเกิดจากกองทิ้ง)
--
-- ✅ ปลอดภัย: เป็น idempotent — รันกี่ครั้งก็ได้ผลเหมือนเดิม
--    · เติมเฉพาะห้องที่ "ยังไม่มี" ธง (ไม่ทับธงที่ถูกต้องแล้ว)
--    · everMeld = hasFirstMeld (เกิดแล้วรอบนี้ = เคยเกิดแน่นอน → ไม่ใช่น็อคมืด)
--    · everPick = true ทุกคน (ไม่ล็อกปุ่ม "ฝาก" ของห้องที่กำลังเล่นอยู่)
--
-- 📌 วิธีรัน: Supabase → SQL Editor → วางทั้งไฟล์นี้ → Run
-- =====================================================================

UPDATE rooms r
SET game = jsonb_set(
      jsonb_set(COALESCE(r.game, '{}'::JSONB), '{everMeld}', COALESCE(r.game->'hasFirstMeld', '{}'::JSONB)),
      '{everPick}',
      COALESCE((SELECT jsonb_object_agg(p, true)
                FROM jsonb_array_elements_text(COALESCE(r.game->'playerOrder', '[]'::JSONB)) AS p), '{}'::JSONB)
    )
WHERE r.game IS NOT NULL
  AND (jsonb_typeof(r.game->'everMeld') IS DISTINCT FROM 'object'
       OR jsonb_typeof(r.game->'everPick') IS DISTINCT FROM 'object');

-- ✅ ยืนยัน: ต้องได้ 0 (ไม่มีห้องไหนค้างธงว่าง)
SELECT count(*) AS rooms_missing_flags
FROM rooms
WHERE status = 'playing'
  AND game IS NOT NULL
  AND (jsonb_typeof(game->'everMeld') IS DISTINCT FROM 'object'
       OR jsonb_typeof(game->'everPick') IS DISTINCT FROM 'object');

-- ✅ ยืนยัน: ห้องเก่าที่ยังไม่มีธง → ตอนนี้ต้องมีแล้ว
SELECT id, status,
       game->'everMeld' AS ever_meld,
       game->'everPick' AS ever_pick
FROM rooms
WHERE game IS NOT NULL
  AND (game->'hasFirstMeld' IS NOT NULL OR game->'playerOrder' IS NOT NULL)
ORDER BY id
LIMIT 10;
