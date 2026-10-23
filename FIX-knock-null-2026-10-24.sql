-- ============================================================
-- FIX v42 (2026-10-24) — แก้ห้องพัง: rooms.game เป็น NULL
-- ============================================================
-- สาเหตุ (พิสูจน์จริงบน Supabase แล้ว):
--   ฟังก์ชัน play_turn ตัวที่ deploy อยู่ มีบรรทัด:
--       v_game := jsonb_set(v_game, '{winner}', to_jsonb(v_win_pid));
--   เมื่อไม่มีใครสะสมถึง 500 แต้ม (v_win_pid IS NULL)
--   → to_jsonb(NULL) = NULL → jsonb_set(target, path, NULL) คืน NULL
--   → UPDATE rooms SET game = v_game  → rooms.game = NULL (ลบทั้งก้อน!)
--   → ทุก action ต่อจากนั้นตอบ ROOM_NOT_FOUND (SQL: IF v_game IS NULL THEN ...)
--   → ห้องค้างสถานะ status='playing' แต่ game=NULL  → เล่นต่อไม่ได้
--
-- ผลทดสอบบน live (2026-10-24):
--   MELD / DRAW_DECK / DISCARD / END_TURN  → game ปกติ
--   KNOCK                                   → game = NULL  ❌
--
-- วิธีแก้: แทนที่ด้วย COALESCE(..., 'null'::JSONB)
--   → ถ้าไม่มีผู้ชนะ ให้เขียน JSON null (ไม่ใช่ SQL NULL) → game ไม่หาย
--
-- ⚠️ วิธีรัน (เลือกอย่างใดอย่างหนึ่ง):
--   A) Supabase → SQL Editor → วางทั้งไฟล์ FIX-speto-2026-10-23.sql → Run
--      (ไฟล์เต็ม มี fix นี้อยู่แล้วที่บรรทัด 903 + กติกา v41.2 ล่าสุด)
--   B) ถ้าอยากแก้เฉพาะจุด: ใช้ไฟล์นี้ (patch เฉพาะ play_turn)
--
-- ⚠️ หลังรัน: ต้อง hard refresh (Ctrl+Shift+R) ที่ live site
-- ============================================================

-- วิธี B: patch เฉพาะจุด — ปลอดภัย ถ้าไฟล์เต็มรันไม่ได้
-- (คัดลอกทั้งฟังก์ชัน play_turn จากไฟล์ FIX-speto-2026-10-23.sql มาวางแทน)
-- ตรวจสอบหลังรันว่า fix เข้าไปแล้ว:
SELECT
  CASE
    WHEN position('COALESCE(to_jsonb(v_win_pid)' in pg_get_functiondef(oid)) > 0
      THEN '✅ FIX v42 อยู่แล้ว — KNOCK ไม่ทำให้ game เป็น NULL'
    ELSE '❌ ยังไม่มี fix — ต้องรัน SQL อีกครั้ง'
  END AS fix_v42_status,
  proname
FROM pg_proc
WHERE proname = 'play_turn';
