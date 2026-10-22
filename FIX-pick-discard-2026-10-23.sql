-- ============================================================
-- Dummy Rummy — FIX 2026-10-23: "เก็บจากกองทิ้งเพื่อมาเกิด" ไม่ได้ + ไพ่หาย
--
-- สาเหตุ (พิสูจน์แล้วด้วย live test):
--   ฟังก์ชัน play_turn() ที่ deploy อยู่ใช้โค้ด PICK_DISCARD เวอร์ชันเก่า:
--       v_discard := v_discard[1:p_discard_index];
--       v_new := hand || v_discard;   -- ❌ เอา "ไพ่ที่เหลือ" ไปใส่มือ ไม่ใช่ "ไพ่ที่หยิบ"
--   → ไพ่ที่หยิบ (และไพ่ที่อยู่เหนือ) หายจากเกม, มือได้ไพ่ผิดใบ
--   → โมดั� "ไม่พบชุดไพ่ที่เกิดได้" + ไพ่ในกองทิ้งหายไปโดยไม่อยู่บนมือ
--
-- วิธีแก้ในไฟล์นี้ (ปลอดภัย / idempotent / ไม่ต้องแตะ logic อื่น):
--   1) เปลี่ยนชื่อ play_turn() เดิม เป็น play_turn_legacy()
--   2) สร้าง play_turn() ใหม่ = wrapper
--        - ถ้า action = 'PICK_DISCARD' → จัดการเองด้วย logic ที่ถูกต้อง
--        - action อื่นทั้งหมด → ส่งต่อให้ play_turn_legacy() ทำ (ไม่เปลี่ยนพฤติกรรมเดิม)
--
-- วิธีใช้: Supabase → SQL Editor → วางทั้งไม้นี้ → Run (รันซ้ำได้ ไม่พัง)
--
-- ⚠️ หมายเหตุ: client (game-core.js v36) มี workaround ฝั่ง client อยู่แล้ว
--    (ทำ atomic pick เอง + optimistic lock) → เกมเล่นได้ปกติแม้ยังไม่รันไฟล์นี้
--    ไฟล์นี้คือ "แก้ที่ต้นเหตุ" เพื่อให้ logic ฝั่ง server ถูกต้องถาวร
-- ============================================================

-- ------------------------------------------------------------
-- 1) เก็บฟังก์ชันเดิมไว้ (idempotent: รันซ้ำได้)
--    - ครั้งแรก: play_turn → play_turn_legacy
--    - ครั้งที่สอง+: play_turn คือ wrapper ของเรา → ลบทิ้งแล้วสร้างใหม่
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'play_turn_legacy' AND n.nspname = 'public'
  ) THEN
    -- รันมาแล้ว → ล้าง wrapper เดิม (ถ้ามี) เพื่อสร้างใหม่
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'play_turn' AND n.nspname = 'public'
    ) THEN
      EXECUTE 'DROP FUNCTION IF EXISTS public.play_turn(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,INTEGER,INTEGER)';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'play_turn' AND n.nspname = 'public'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.play_turn(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,INTEGER,INTEGER) RENAME TO play_turn_legacy';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2) wrapper ใหม่
--    - PICK_DISCARD → ทำเอง (ถูกต้อง)
--    - อื่น ๆ        → delegate ให้ play_turn_legacy
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.play_turn(
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
  v_game        JSONB;
  v_row         RECORD;
  v_discard     TEXT[];
  v_hands       JSONB;
  v_card_arr    JSONB;
  v_old         TEXT[];
  v_new         TEXT[];
  v_pick        JSONB;
  v_taken       TEXT[];
  v_new_version INTEGER;
  v_current_pid TEXT;
BEGIN
  -- ===== ทุก action ยกเว้น PICK_DISCARD → ส่งต่อให้ฟังก์ชันเดิมทำตามปกติ =====
  IF p_action IS DISTINCT FROM 'PICK_DISCARD' THEN
    RETURN public.play_turn_legacy(
      p_game_id, p_player_id, p_action, p_card_code, p_discard_index,
      p_meld_codes, p_target_pid, p_target_meld_idx, p_expected_version
    );
  END IF;

  -- ===== PICK_DISCARD (เขียนใหม่) =====
  SELECT r.game, r.version INTO v_row
  FROM rooms r WHERE r.id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_NOT_FOUND');
  END IF;
  v_game := v_row.game;
  IF v_game IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_GAME');
  END IF;

  -- version check (optimistic concurrency)
  IF p_expected_version > 0 AND (v_game->>'version')::INT != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_MISMATCH', 'details', 'version mismatch');
  END IF;

  v_current_pid := v_game->>'turnPlayerId';
  IF v_current_pid <> p_player_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  v_discard := ARRAY(SELECT jsonb_array_elements_text(v_game->'discardPile'));
  IF p_discard_index IS NULL OR p_discard_index < 0 OR p_discard_index >= array_length(v_discard, 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_INDEX');
  END IF;

  -- ไพ่ที่หยิบ = ใบที่คลิก + ทุกใบที่อยู่เหนือ (index 0-based ตาม client)
  v_pick  := to_jsonb(v_discard[p_discard_index + 1:array_length(v_discard, 1)]);
  v_taken := ARRAY(SELECT jsonb_array_elements_text(v_pick));
  -- ไพ่ที่เหลือในกองทิ้ง = ก่อนหน้า index นี้ (ไม่หาย!)
  v_discard := v_discard[1:p_discard_index];

  v_hands := v_game->'hands';
  v_card_arr := v_hands->p_player_id;
  IF v_card_arr IS NULL THEN v_card_arr := '[]'::JSONB; END IF;
  v_old := ARRAY(SELECT jsonb_array_elements_text(v_card_arr));
  v_new := v_old || v_taken;

  v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new));
  v_game  := jsonb_set(v_game, '{hands}', v_hands);
  v_game  := jsonb_set(v_game, '{discardPile}', to_jsonb(v_discard));
  -- บันทึกว่าหยิบอะไร → server บังคับให้เกิดใบที่หยิบก่อนทิ้งได้
  v_game  := jsonb_set(v_game, ARRAY['pickedFromDiscard', p_player_id], v_pick);
  v_game  := jsonb_set(v_game, '{phase}', '"action"');

  -- โทษสเปโต (2♣ / Q♠) ถ้าหยิบสเปโต → -100 แต้ม (ตรงกับ FIX-scoring-2026-10-21.sql)
  IF EXISTS (SELECT 1 FROM unnest(v_taken) t WHERE t IN ('2♣','Q♠')) THEN
    v_game := jsonb_set(v_game, ARRAY['spettoPenalty', p_player_id],
      to_jsonb(COALESCE((v_game->'spettoPenalty'->p_player_id)::INT,0) + 100));
  END IF;

  v_new_version := (v_game->>'version')::INT + 1;
  v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
  UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;

  RETURN jsonb_build_object('ok', true, 'game', v_game,
                             'picked', v_taken,
                             'mii_penalty', CASE WHEN EXISTS (SELECT 1 FROM unnest(v_taken) t WHERE t IN ('2♣','Q♠')) THEN 100 ELSE 0 END);
END;
$$;

-- ------------------------------------------------------------
-- 3) ให้สิทธิ์เรียกได้ (anon key)
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.play_turn(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,INTEGER,INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION public.play_turn(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,INTEGER,INTEGER) TO authenticated;

-- ============================================================
-- 4) คำสั่งตรวจสอบหลังรัน (รันทีละบรรทัดใน SQL Editor)
-- ============================================================
-- 4.1) ดูว่ามีทั้ง 2 ฟังก์ชันแล้ว
-- SELECT proname FROM pg_proc WHERE proname LIKE 'play_turn%';
--
-- 4.2) ดูว่า play_turn ใหม่มี logic PICK_DISCARD ถูกต้อง (ควรเจอ pickedFromDiscard)
-- SELECT prosrc FROM pg_proc WHERE proname = 'play_turn';
--
-- 4.3) ทดสอบจริง: สร้างห้องทดสอบ → หยิบ → เช็คว่าไพ่ไม่หาย
--   (ดูตัวอย่างใน test-pick-discard-client.py)

-- ============================================================
-- 5) ถ้าต้องการย้อนกลับ (rollback) ให้รัน:
-- ============================================================
-- DROP FUNCTION IF EXISTS public.play_turn(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,INTEGER,INTEGER);
-- ALTER FUNCTION public.play_turn_legacy(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,INTEGER,INTEGER) RENAME TO play_turn;
