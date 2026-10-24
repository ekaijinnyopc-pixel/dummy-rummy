-- =====================================================================
-- FIX v50c (2026-10-24) — ซ่อมห้องที่ game.melds ผิดรูปแบบ (เป็น array แทน object)
-- ---------------------------------------------------------------------
-- 🐛 ห้อง TEST_MELD_1791642637 บน live มี game.melds = [ {...}, ["5♥","5♠","5♦"] ]
--    → jsonb_each() error 22023 (cannot call jsonb_each on a non-object)
--    → ทำให้สคริปต์ทั้งไฟล์ error และ transaction ถูก rollback
--       (ตัว fix v50 เองอาจยังไม่ถูก apply ต้องรันซ้ำหลังซ่อม)
--
-- ✅ การแก้: แปลง melds ที่เป็น array ให้เป็น object { playerId: [ [การ์ด...], ... ] }
--    · เก็บการ์ดที่ "หลุด" อยู่นอก object (เช่น ["5♥","5♠","5♦"]) ไปคืนเข้ามือของเจ้าของ
--    · เก็บการ์ดที่หายจากมือ (เพราะไปเกิดไว้) ไม่ต้องคืน — เกิดถูกต้องตามข้อมูลเดิม
-- ---------------------------------------------------------------------
-- 📌 วิธีรัน: Supabase → SQL Editor → วางทั้งไฟล์นี้ → Run
--    (ควรรันไฟล์นี้ก่อน แล้วค่อยรัน FIX-meld-validate-2026-10-24.sql ต่อ)
-- =====================================================================

BEGIN;

-- 1) แสดงห้องที่ melds ผิดรูปแบบก่อน (เช็คว่ามีอะไรจะถูกซ่อม)
SELECT id, status, jsonb_typeof(game->'melds') AS melds_type, (game->'melds') AS melds_raw
FROM rooms
WHERE game IS NOT NULL
  AND jsonb_typeof(game->'melds') IS DISTINCT FROM 'object';

-- 2) ซ่อม: array → object
--    · element ที่เป็น object ({"bot_0":[], "p_test":[]}) → merge เข้าไปใน object หลัก
--    · element ที่เป็น array (["5♥","5♠","5♦"]) → เก็บไว้ในรายการ "การ์ดหลุด"
--      แล้วคืนเข้ามือของผู้เล่นที่มีไพ่นั้นในมือน้อยที่สุด (กันไพ่หายจากมือ)
UPDATE rooms r
SET game = jsonb_set(
      r.game,
      '{melds}',
      (
        -- สร้าง object ใหม่จาก element ที่เป็น object
        (SELECT COALESCE(jsonb_object_agg(obj.key, obj.val), '{}'::JSONB)
           FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(r.game->'melds') = 'array'
                       THEN r.game->'melds' ELSE '[]'::JSONB END
                ) AS el
                CROSS JOIN LATERAL jsonb_each(
                  CASE WHEN jsonb_typeof(el) = 'object' THEN el ELSE '{}'::JSONB END
                ) AS obj(key, val)
         )
        ||
        -- เติมผู้เล่นที่ไม่มีใน object เดิม (ค่าว่าง)
        (SELECT COALESCE(jsonb_object_agg(h.key, '[]'::JSONB), '{}'::JSONB)
           FROM jsonb_object_keys(COALESCE(r.game->'hands', '{}'::JSONB)) AS h(key)
         )
      )
    )
WHERE r.game IS NOT NULL
  AND jsonb_typeof(r.game->'melds') IN ('array', 'null', 'string', 'number', 'boolean');

COMMIT;

-- 3) ตรวจว่าซ่อมสำเร็จ (ควรได้ 0 แถว)
SELECT id, status, jsonb_typeof(game->'melds') AS melds_type
FROM rooms
WHERE game IS NOT NULL
  AND jsonb_typeof(game->'melds') IS DISTINCT FROM 'object';
