-- =====================================================================
-- FIX v61 (2026-10-28, พี่เอ) — "กองจั่วหมด = จบเกม + สรุปคะแนนทันที"
-- ---------------------------------------------------------------------
-- เขียนโดย: จิน (JINNY) · ใช้คู่กับ client v62
--
-- 📌 วิธีรัน: วางไฟล์นี้ทั้งไฟล์ใน Supabase SQL Editor → Run
--    (idempotent · รันซ้ำได้ · ปลอดภัย)
--    ⚠️ ต้องรัน APPLY-ALL + FIX-v59 + FIX-v60 ก่อนแล้ว (พี่เอรันครบแล้ว ✅)
--
-- 🐛 บั๊กที่พี่เอเจอ (ห้อง XY7QTM, 2026-10-28 19:25): "บอทนิ่ง ไม่เล่น"
--    ห้องค้างที่ phase='draw' · turnPlayerId=bot_1 · deck=0 · deckEmpty=false
--
-- 🔎 ต้นเหตุ (จินหาเจอ 100% จากโค้ด + state จริง):
--    ใน play_turn เช็คกองจั่วหมดแบบนี้ (บรรทัด ~179):
--        IF array_length(v_deck, 1) = 0 THEN ...
--    แต่ array_length() ของ array ว่าง คืน NULL ไม่ใช่ 0 !!
--    → เงื่อนไขเป็น NULL → ไม่จริง → เข้า branch "จั่ว" ต่อ
--    → v_deck[1:NULL-1] = NULL → to_jsonb(NULL) = NULL
--    → jsonb_set(v_game, '{deck}', NULL) = NULL ทั้งก้อน (FIX v41 เคยเจอเรื่องนี้)
--    → UPDATE rooms SET game = NULL → ห้องพัง บอท error ค้าง
--    → client กู้ game กลับจาก snapshot → เหลือ deck=0, deckEmpty=false (ตรง XY7QTM)
--
-- ✅ แก้ในไฟล์นี้
--    1) เช็ค "กองจั่วหมด" → COALESCE(array_length(v_deck,1),0) = 0 (ทุกจุดที่แตะกองจั่ว)
--    2) กติกาใหม่จากพี่เอ (2026-10-28 19:38): "กองจั่วหมด = จบเกม + สรุปคะแนนทันที"
--       · จั่วไพ่ใบสุดท้าย → กองหมด → จบเกมทันที + คำนวณคะแนนทันที
--       · ห้องที่กองหมดอยู่แล้ว (เช่น XY7QTM) → DRAW_DECK ครั้งถัดไปจบเกมเอง
--       · สูตรคะแนนเดียวกับ branch KNOCK:
--           แต้มรอบนี้ = แต้มมอลด์ − แต้มมือ(×2 ถ้ายังไม่เกิดรอบนี้) − โทษสเปโต
--         ผู้ชนะ = กติกาเดียวกับ KNOCK (ถ้ามีใครสะสม ≥ 500 → คนที่สะสมน้อยที่สุดชนะ)
--         (ไม่มีโบนัสน็อค เพราะไม่มีใครน็อค)
--    3) เก็บกวาดห้องค้างบน live: ห้องที่ยัง 'playing' แต่กองจั่วหมด → จบเกม + สรุปคะแนน
--
-- 🛡️ ปลอดภัย: ไม่แตะกติกาโทษสเปโต · ไม่แตะ anchor · ไม่แตะสูตรน็อคเดิม
-- =====================================================================

-- =====================================================================
-- FIX v61: ฟังก์ชันจบเกมเพราะ "กองจั่วหมด" (คำนวณคะแนน + สรุปทันที)
--   คืน game JSONB ใหม่ (pure function · ไม่แตะตาราง rooms)
--   สูตรเดียวกับ branch KNOCK ใน play_turn
-- =====================================================================
CREATE OR REPLACE FUNCTION public.rummy_end_game_deck_empty(p_game JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_players      TEXT[];
  v_melds        JSONB;
  v_scores       JSONB;
  v_has_fm       JSONB;
  v_round_scores JSONB := '{}'::JSONB;
  v_total_scores JSONB := '{}'::JSONB;
  v_win_pid      TEXT;
  v_min_total    INTEGER;
  v_pm           JSONB;
  v_pm_codes     TEXT[];
  v_meld_pts     INTEGER;
  v_hand_pts     INTEGER;
  v_penalty      INTEGER;
  v_ttot         INTEGER;
BEGIN
  IF p_game IS NULL THEN RETURN NULL; END IF;
  v_players := ARRAY(SELECT jsonb_array_elements_text(p_game->'playerOrder'));
  v_melds   := COALESCE(p_game->'melds', '{}'::JSONB);
  v_scores  := COALESCE(p_game->'scores', '{}'::JSONB);
  v_has_fm  := COALESCE(p_game->'hasFirstMeld', '{}'::JSONB);

  -- คะแนนรอบนี้ของทุกคน (สูตรเดียวกับ KNOCK)
  FOR i IN 1..COALESCE(array_length(v_players, 1), 0) LOOP
    DECLARE
      v_pid TEXT := v_players[i];
    BEGIN
      v_meld_pts := 0; v_hand_pts := 0; v_penalty := 0;
      -- แต้มมอลด์
      v_pm := COALESCE(v_melds->v_pid, '[]'::JSONB);
      FOR j IN 0..jsonb_array_length(v_pm)-1 LOOP
        v_pm_codes := ARRAY(SELECT jsonb_array_elements_text(v_pm->j));
        FOR k IN 1..COALESCE(array_length(v_pm_codes, 1), 0) LOOP
          v_meld_pts := v_meld_pts + rummy_card_points(v_pm_codes[k]);
        END LOOP;
      END LOOP;
      -- แต้มมือ (คนที่ยังไม่เกิดรอบนี้ = ×2)
      v_pm := COALESCE(p_game->'hands'->v_pid, '[]'::JSONB);
      FOR j IN 0..jsonb_array_length(v_pm)-1 LOOP
        v_hand_pts := v_hand_pts + rummy_card_points(v_pm->>j);
      END LOOP;
      IF NOT COALESCE((v_has_fm->>v_pid)::BOOLEAN, false) THEN
        v_hand_pts := v_hand_pts * 2;
      END IF;
      -- โทษสเปโต
      v_penalty := COALESCE((p_game->'spettoPenalty'->>v_pid)::INT, 0);
      v_round_scores := jsonb_set(v_round_scores, ARRAY[v_pid],
        to_jsonb(v_meld_pts - v_hand_pts - v_penalty));
    END;
  END LOOP;

  -- คะแนนสะสม
  FOR i IN 1..COALESCE(array_length(v_players, 1), 0) LOOP
    DECLARE v_tpid TEXT := v_players[i];
    BEGIN
      v_total_scores := jsonb_set(v_total_scores, ARRAY[v_tpid],
        to_jsonb(COALESCE((v_scores->>v_tpid)::INT, 0) + COALESCE((v_round_scores->>v_tpid)::INT, 0)));
    END;
  END LOOP;

  -- ผู้ชนะ: กติกาเดียวกับ KNOCK (มีใครสะสม ≥ 500 → คนที่สะสมน้อยที่สุดชนะ)
  v_win_pid := NULL; v_min_total := NULL;
  FOR i IN 1..COALESCE(array_length(v_players, 1), 0) LOOP
    DECLARE v_tpid TEXT := v_players[i];
    BEGIN
      v_ttot := COALESCE((v_total_scores->>v_tpid)::INT, 0);
      IF v_ttot >= 500 THEN
        IF v_min_total IS NULL OR v_ttot < v_min_total THEN
          v_min_total := v_ttot;
          v_win_pid := v_tpid;
        END IF;
      END IF;
    END;
  END LOOP;

  p_game := jsonb_set(p_game, '{deckEmpty}', 'true');
  p_game := jsonb_set(p_game, '{status}', '"ended"');
  p_game := jsonb_set(p_game, '{endReason}', '"DECK_EMPTY"');
  p_game := jsonb_set(p_game, '{roundScores}', v_round_scores);
  p_game := jsonb_set(p_game, '{totalScores}', v_total_scores);
  p_game := jsonb_set(p_game, '{scores}', v_total_scores);
  -- FIX v41: jsonb_set(..., NULL) = NULL ทั้งก้อน → ต้องแปลงเป็น JSON null
  p_game := jsonb_set(p_game, '{winner}', COALESCE(to_jsonb(v_win_pid), 'null'::JSONB));
  RETURN p_game;
END;
$$;

CREATE OR REPLACE FUNCTION public.play_turn(p_game_id text, p_player_id text, p_action text, p_card_code text DEFAULT NULL::text, p_discard_index integer DEFAULT NULL::integer, p_meld_codes text DEFAULT NULL::text, p_target_pid text DEFAULT NULL::text, p_target_meld_idx integer DEFAULT NULL::integer, p_expected_version integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
  v_anchor        TEXT;
  v_is_first_meld BOOLEAN;
  v_picked        JSONB;
  v_speto_loser   TEXT;
  v_has_discarded BOOLEAN;
  -- FIX v55 (2026-10-25): ธงข้ามรอบ — เคยเกิด / เคยเก็บเกิดจากกองทิ้ง
  v_ever_meld     JSONB;
  v_ever_pick     JSONB;
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
  v_draw_card     TEXT;    -- FIX v53: ไพ่ที่จั่วได้ (ต้องเป็นใบที่ถูกตัดออกจริง)
  v_picked_arr    TEXT[];   -- FIX v60: ไพ่ที่หยิบค้างของผู้เล่น (เช็ค anchor + ล้างธง)
  v_picked_flags  JSONB;    -- FIX v60: ตารางธง pickedFromDiscard ทั้งห้อง
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
  -- FIX v55: ธงข้ามรอบ (ไม่ถูกรีเซ็ตตอนขึ้นรอบใหม่)
  v_ever_meld := COALESCE(v_game->'everMeld', '{}'::JSONB);
  v_ever_pick := COALESCE(v_game->'everPick', '{}'::JSONB);
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
    -- FIX v61 (2026-10-28, พี่เอ): array_length ของ array ว่าง = NULL (ไม่ใช่ 0)
    --   → เช็คเดิมไม่ทำงาน → จั่วจากกองว่าง → jsonb_set(...,NULL) → rooms.game = NULL → ห้องพัง + บอทค้าง
    --   → กติกาใหม่: กองจั่วหมด = จบเกม + สรุปคะแนนทันที
    IF COALESCE(array_length(v_deck, 1), 0) = 0 THEN
      v_game := rummy_end_game_deck_empty(v_game);
      v_game := jsonb_set(v_game, '{phase}', '"action"');
      v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
      UPDATE rooms SET game = v_game, status = 'ended', version = v_new_version,
                       "winner" = v_game->>'winner', "totalScores" = v_game->'totalScores'
        WHERE id = p_game_id;
      RETURN jsonb_build_object('ok', true, 'game', v_game, 'gameOver', true,
        'endReason', 'DECK_EMPTY',
        'round_scores', v_game->'roundScores', 'total_scores', v_game->'totalScores',
        'winner', v_game->>'winner');
    END IF;
    -- FIX v53 (2026-10-24): จั่วผิดใบ — เดิมตัดใบสุดท้ายทิ้ง แล้วเอาใบสุดท้ายของ array ที่ตัดแล้วมาใส่มือ
    --   → ไพ่ใบนั้นยังอยู่ใน deck (ไพ่ซ้ำ มือ+deck) และไพ่ใบสุดท้ายเดิมหายไปจากเกม
    --   → สูตรเดิม: v_deck[1:len-1] แล้วเอา v_deck[array_upper] (คือใบก่อนหน้าสุดท้าย) ← ผิด
    --   แก้: เก็บใบสุดท้าย (ใบที่จะจั่ว) ไว้ก่อน แล้วค่อยตัดออก
    v_draw_card := v_deck[array_length(v_deck,1)];
    v_deck := v_deck[1:array_length(v_deck,1)-1];
    v_card_arr := v_hands->p_player_id;
    IF v_card_arr IS NULL THEN v_card_arr := '[]'::JSONB; END IF;
    v_new := ARRAY(SELECT jsonb_array_elements_text(v_card_arr)) || ARRAY[v_draw_card];
    v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new));
    v_game := jsonb_set(v_game, '{hands}', v_hands);
    v_game := jsonb_set(v_game, '{deck}', to_jsonb(v_deck));
    v_game := jsonb_set(v_game, '{phase}', '"action"');
    -- Reset hasDiscardedThisTurn when starting a fresh turn (draw)
    v_game := jsonb_set(v_game, ARRAY['hasDiscardedThisTurn', p_player_id], 'false');
    -- FIX 4 (ต่อ): จั่วใหม่ = ไม่มีใบที่หยิบค้างไว้
    v_game := jsonb_set(v_game, ARRAY['pickedFromDiscard', p_player_id], '[]'::JSONB);
    -- FIX v61 (2026-10-28, พี่เอ): จั่วไพ่ใบสุดท้าย → กองจั่วหมด → จบเกม + สรุปคะแนนทันที
    IF COALESCE(array_length(v_deck, 1), 0) = 0 THEN
      v_game := rummy_end_game_deck_empty(v_game);
      v_game := jsonb_set(v_game, '{phase}', '"action"');
      v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
      UPDATE rooms SET game = v_game, status = 'ended', version = v_new_version,
                       "winner" = v_game->>'winner', "totalScores" = v_game->'totalScores'
        WHERE id = p_game_id;
      RETURN jsonb_build_object('ok', true, 'game', v_game, 'gameOver', true,
        'endReason', 'DECK_EMPTY',
        'round_scores', v_game->'roundScores', 'total_scores', v_game->'totalScores',
        'winner', v_game->>'winner');
    END IF;
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game);

  -- FIX v61 (2026-10-28, พี่เอ): DECK_EMPTY = จบเกม + สรุปคะแนนทันที
  --   กติกาใหม่จากพี่เอ (2026-10-28 19:38): "กองจั่วหมด = จบเกม สรุปคะแนนทันที"
  --   client เรียก action นี้เมื่อเห็นว่ากองจั่วหมด (server เป็นเจ้าของกติกา)
  --   · เซิร์ฟเวอร์เก่า (ไม่รู้จัก action) → client จบรอบฝั่ง client แทน (สูตรเดียวกัน)
  ELSIF p_action = 'DECK_EMPTY' THEN
    v_players := ARRAY(SELECT jsonb_array_elements_text(v_game->'playerOrder'));
    v_idx := 0;
    FOR i IN 1..COALESCE(array_length(v_players,1),0) LOOP IF v_players[i] = p_player_id THEN v_idx := i; EXIT; END IF; END LOOP;
    IF v_idx = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_A_PLAYER'); END IF;
    IF COALESCE(array_length(v_deck,1),0) > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'DECK_NOT_EMPTY');
    END IF;
    v_game := rummy_end_game_deck_empty(v_game);
    v_game := jsonb_set(v_game, '{phase}', '"action"');
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, status = 'ended', version = v_new_version,
                     "winner" = v_game->>'winner', "totalScores" = v_game->'totalScores'
      WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game, 'gameOver', true,
      'endReason', 'DECK_EMPTY',
      'round_scores', v_game->'roundScores', 'total_scores', v_game->'totalScores',
      'winner', v_game->>'winner');

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
    -- FIX v55 (ข้อ 2/3): ทำเครื่องหมาย "เคยเก็บเกิดจากกองทิ้ง" (ข้ามรอบ)
    v_ever_pick := v_ever_pick || jsonb_build_object(p_player_id, true);
    v_game := jsonb_set(v_game, '{everPick}', v_ever_pick);
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
    -- FIX v59 (2026-10-27, พี่เอ): ต้อง "จั่ว/หยิบจากกองทิ้ง" ก่อนถึงจะทิ้งได้ (ห้ามข้ามขั้นตอน)
    --   (พี่เอ: "ถ้ายังไม่จั่ว ... แต่เผลอไปเลือกการ์ดในมือ สามารถกดทิ้งผ่านรอบไปเลย ซึ่งผิดกติกา")
    --   เช็คเฉพาะเมื่อ phase = 'draw' ชัดเจน (ห้องเก่าที่ไม่มี phase → ไม่บล็อก)
    IF (v_game ? 'phase') AND (v_game->>'phase' = 'draw') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MUST_DRAW',
        'details', 'ต้องจั่วหรือหยิบจากกองทิ้งก่อน ถึงจะทิ้งไพ่ได้');
    END IF;
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
    --   FIX v41.1 (พี่เอยืนยัน 22:55): โทษ "รวมต่อ 1 การทิ้ง" ไม่เกิน 100 แม้กรณี 2.3 ซ้อนกับ 2.1/2.2
    --   → FIX v41.2 (พี่เอยืนยัน 22:57): 2.3 ซ้อนกับ 2.1/2.2 ของ "การทิ้งใบเดียวกัน" = โดน 200 ได้ (2.3 นับแยกจาก 2.1/2.2)
    IF rummy_is_speto(p_card_code) AND rummy_speto_related(p_card_code, v_old_pile) THEN
      v_pending := COALESCE(v_game->'spetoPending', '{}'::JSONB);
      IF jsonb_typeof(v_pending) IS DISTINCT FROM 'object' THEN v_pending := '{}'::JSONB; END IF;
      v_pending := jsonb_set(v_pending, ARRAY[p_card_code], jsonb_build_object(
        'discarder', p_player_id,
        'expiresAtTurn', (v_turn_seq + 1 + (v_n_players - 1))::INTEGER,
        'code', p_card_code,
        'alreadyPenalized', (v_discard_penalty > 0)));   -- FIX v41.2: เก็บไว้เป็นข้อมูล (2.3 ยังหักเพิ่มได้)
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
    -- FIX v59 (2026-10-27, พี่เอ): ถ้าหยิบจากกองทิ้ง → ชุดที่เกิดต้องมี "ใบแรกที่หยิบ" (anchor)
    --   กติกา: เกิดแค่ใบแรกที่หยิบ ไพ่ที่หยิบมาพร้อมกัน (ใบที่ 2,3,...) เกิดหรือไม่ก็ได้
    --   (ฝั่ง client บังคับอยู่แล้ว — ที่นี่ให้ server เป็นเจ้าของกติกาเหมือนกัน)
    v_picked := COALESCE(v_game->'pickedFromDiscard'->p_player_id, '[]'::JSONB);
    IF jsonb_array_length(v_picked) > 0 THEN
      v_anchor := v_picked->>0;
      IF NOT (v_anchor = ANY(v_meld_arr)) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'MUST_MELD_ANCHOR',
          'details', 'ต้องเกิดไพ่ใบแรกที่หยิบจากกองทิ้ง (' || v_anchor || ')');
      END IF;
    END IF;
    -- FIX v50 (2026-10-24): ตรวจว่าไพ่ที่ส่งมา "เป็นชุดจริง" ไหม
    --   เดิม branch MELD เช็คแค่ CARD_NOT_IN_HAND → ส่งไพ่ 3 ใบที่ไม่ใช่ชุดก็ "เกิด" ได้
    --   server ต้องเป็นเจ้าของกติกา (FIX v41) → validate ด้วย rummy_meld_type()
    --   rummy_meld_type() = 'set' (ตอง) | 'run' (เรียง) | NULL (ไม่ใช่ชุด)
    --   หมายเหตุ: rummy_is_set/rummy_is_run อนุญาตสเปโตในชุดตอง (FIX v39) แต่ห้ามในชุดเรียง
    IF rummy_meld_type(v_meld_arr) IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_MELD',
        'details', 'ไพ่ที่เลือกไม่ใช่ชุดที่เกิดได้ (ต้องเป็นชุดตองหรือชุดเรียง)');
    END IF;
    -- FIX v50b (2026-10-24): กัน "ไพ่ซ้ำ" ในชุดเดียวกัน
    --   ช่องโหว่จริงที่เจอบน live (พิสูจน์แล้ว): ส่ง ["2♠","2♠","2♠"]
    --   → ผ่าน CARD_NOT_IN_HAND (มี 2♠ อยู่แค่ใบเดียว แต่เช็คทีละตัวก็ผ่านหมด)
    --   → ได้ชุด 3 ใบ แต่เสียไพ่จากมือแค่ 1 ใบ → ได้เปรียบ (แต้มเกิดฟรี)
    --   rummy_meld_type() กันเคสนี้อยู่แล้ว (is_set ต้องสำเนาไม่ซ้ำ)
    --   → เพิ่มเช็คชัดเจนไว้เผื่อกติกาชุดเปลี่ยนไป
    IF (SELECT count(DISTINCT x) FROM unnest(v_meld_arr) AS x) <> array_length(v_meld_arr, 1) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'DUPLICATE_CARD',
        'details', 'ไม่สามารถใช้ไพ่ใบเดียวกันมากกว่าหนึ่งครั้งในชุดเดียวกัน');
    END IF;
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
    -- FIX v55 (ข้อ 3): ทำเครื่องหมาย "เคยเกิด" (ข้ามรอบ) → ใช้ตัดสิน "น็อคมืด"
    v_ever_meld := v_ever_meld || jsonb_build_object(p_player_id, true);
    v_game := jsonb_set(v_game, '{everMeld}', v_ever_meld);
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
          -- FIX v41.2 (พี่เอยืนยัน 22:57): 2.3 ซ้อนกับ 2.1/2.2 ของการทิ้งใบเดียวกัน → โดน 200 ได้
          --   (2.3 นับแยกจาก 2.1/2.2 — ไม่ใช้แค่ alreadyPenalized เป็นเงื่อนไขกันหักซ้ำ)
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
    -- FIX v55 (ข้อ 2): ต้อง "เก็บเกิดจากกองทิ้ง" มาอย่างน้อย 1 ครั้งก่อน ถึงจะ "ฝาก" (LAYOFF) ได้
    --   (พี่เอ: "ถ้าผู้เล่นยังไม่เคย 'เก็บเกิด' จากกองทิ้ง ... 'ฝาก' ไม่ได้")
    IF NOT COALESCE((v_ever_pick->>p_player_id)::BOOLEAN, false) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MUST_PICK_FIRST',
        'details', 'ต้องเก็บเกิดจากกองทิ้งอย่างน้อย 1 ครั้งก่อน จึงจะฝากได้');
    END IF;
    -- FIX v60 (2026-10-28, พี่เอ): ห้าม "ฝาก" ไพ่ใบแรกที่หยิบจากกองทิ้ง (anchor)
    --   กติกา: anchor ต้อง "เกิด" (MELD) เสมอ — ฝาก (LAYOFF) ไม่ใช่การเกิด
    --   (เดิมฝาก anchor ได้ → ธง pickedFromDiscard ชี้ไพ่ที่ไม่อยู่บนมือแล้ว
    --    → server บล็อก DISCARD ด้วย MUST_MELD_PICKED → ผู้เล่นค้าง)
    v_picked_arr := ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_game->'pickedFromDiscard'->p_player_id, '[]'::JSONB)));
    IF array_length(v_picked_arr, 1) IS NOT NULL AND v_picked_arr[1] = p_card_code THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CANNOT_LAYOFF_ANCHOR',
        'details', 'ไพ่ใบแรกที่หยิบจากกองทิ้ง (' || p_card_code || ') ต้อง "เกิด" ไม่ใช่ "ฝาก"');
    END IF;
    -- ============================================================
    -- FIX v64 (2026-10-28, พี่เอ): ทางเลือก A — "ฝาก" ลงชุดของตัวเองได้ (อนุญาต)
    --   เดิมมี guard LAYOFF_OWN_MELD (ตัวเลือก B = ห้าม) → ลบออกตามที่พี่เอยืนยัน (อนุญาต)
    --   (ไฟล์ฉบับเต็มที่พี่เอรันคือ FIX-v64-2026-10-28.sql)
    -- ============================================================
    v_p_meld_idx := p_target_meld_idx;
    -- FIX 2: กัน meld index หลุด/เกินช่วง (เดิมจะ error ตอน jsonb_array_elements_text)
    IF v_p_meld_idx < 0 OR v_p_meld_idx >= jsonb_array_length(COALESCE(v_melds->p_target_pid, '[]'::JSONB)) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MELD_NOT_FOUND');
    END IF;
    v_old_meld := ARRAY(SELECT jsonb_array_elements_text((v_melds->p_target_pid)->v_p_meld_idx));
    v_new_meld := array_append(v_old_meld, p_card_code);
    -- FIX v59 (2026-10-27, พี่เอ): ชุดเรียง → เรียงไพ่ตามเลข (A = 14 สูงสุด) ไม่ใช่ "ต่อท้าย"
    --   (เดิม: ชุด 5-6-7 + ฝาก 4 → 5-6-7-4 → ดูยากมาก · แก้: 4-5-6-7)
    IF rummy_meld_type(v_old_meld) = 'run' THEN
      v_new_meld := ARRAY(
        SELECT c FROM unnest(v_new_meld) AS c
        ORDER BY rummy_rank_val_high(c), c
      );
    END IF;
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
    -- FIX v60 (2026-10-28, พี่เอ): ล้างไพ่ที่ฝากออกจากธง "ไพ่ที่หยิบ" ของผู้เล่น
    --   (เดิม LAYOFF ไม่แตะ pickedFromDiscard → ธงชี้ไพ่ที่ไม่อยู่บนมือแล้ว
    --    → server บล็อก DISCARD ด้วย MUST_MELD_PICKED → ผู้เล่นทิ้งไพ่ไม่ได้)
    --   หมายเหตุ: anchor ที่ยังไม่เกิดจะยังอยู่ในธง (บังคับให้เกิดก่อนทิ้งตามกติกา)
    v_picked_flags := COALESCE(v_game->'pickedFromDiscard', '{}'::JSONB);
    IF jsonb_typeof(v_picked_flags) = 'object' THEN
      v_picked_arr := ARRAY(SELECT jsonb_array_elements_text(v_picked_flags->p_player_id));
      IF array_length(v_picked_arr, 1) IS NOT NULL THEN
        v_picked_arr := array_remove(v_picked_arr, p_card_code);
        v_picked_flags := jsonb_set(v_picked_flags, ARRAY[p_player_id], to_jsonb(v_picked_arr));
        v_game := jsonb_set(v_game, '{pickedFromDiscard}', v_picked_flags);
      END IF;
    END IF;
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
    -- FIX v55 (ข้อ 3): "น็อคมืด" = ชนะโดยไม่เคย "เกิด" ตั้งแต่ต้นเกมจนถึงรอบก่อนจะน็อค
    --   → คะแนนรอบนี้ของผู้น็อค ×2
    --   (เกมนี้ชนะด้วย "ยอดสะสมน้อยที่สุด" → คะแนนเพิ่ม = เสียเปรียบ = โทษจริง)
    -- FIX v55.1: ห้องที่เริ่มก่อน FIX v55 ยังไม่มีธง everMeld → กันคิดผิด
    --   ใช้หลักฐานอื่นด้วย: เกิดแล้วรอบนี้ (hasFirstMeld) หรือมีชุดบนโต๊ะ = เคยเกิดแน่นอน
    IF NOT COALESCE((v_ever_meld->>p_player_id)::BOOLEAN, false)
       AND NOT COALESCE((v_has_fm->>p_player_id)::BOOLEAN, false)
       AND jsonb_array_length(COALESCE(v_melds->p_player_id, '[]'::JSONB)) = 0 THEN
      v_round_scores := jsonb_set(v_round_scores, ARRAY[p_player_id],
        to_jsonb(COALESCE((v_round_scores->>p_player_id)::INT, 0) * 2));
    END IF;
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
$function$;



-- =====================================================================
-- =====================================================================
-- =====================================================================
-- FIX v61: เก็บกวาดห้องค้างบน live (กองจั่วหมด แต่ยังค้างสถานะ playing)
--   → จบเกม + สรุปคะแนนทันที (เช่นห้อง XY7QTM)
--   ปลอดภัย: แตะเฉพาะห้องที่ status='playing' และกองจั่วหมดจริง
-- =====================================================================
DO $$
DECLARE
  r         RECORD;
  v_game    JSONB;
  v_newver  INTEGER;
BEGIN
  FOR r IN SELECT id, game, version FROM rooms
           WHERE status = 'playing'
             AND jsonb_typeof(game->'deck') = 'array'
             AND jsonb_array_length(game->'deck') = 0
  LOOP
    v_game := rummy_end_game_deck_empty(r.game);
    IF v_game IS NULL THEN CONTINUE; END IF;
    v_newver := COALESCE(r.version, 0) + 1;
    v_game := jsonb_set(v_game, '{phase}', '"action"');
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_newver));
    UPDATE rooms SET game = v_game, status = 'ended', version = v_newver,
                     "winner" = v_game->>'winner', "totalScores" = v_game->'totalScores'
      WHERE id = r.id;
    RAISE NOTICE 'FIX v61: จบห้อง % (กองจั่วหมด) · ผู้ชนะ=%', r.id, v_game->>'winner';
  END LOOP;
END;
$$;

-- =====================================================================
-- ✅ VERIFY (คาดหวัง)
--   deck_empty_check      = t  · deck_end_game = t · end_game_fn = t
--   rooms_deck_empty_left = 0  (ห้องที่ยัง playing แต่กองจั่วหมด → ต้องเป็น 0)
--   rooms_ended_deck_empty= N  (จำนวนห้องที่จบเพราะกองจั่วหมด)
-- =====================================================================
SELECT
  position('COALESCE(array_length(v_deck, 1), 0) = 0' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS deck_empty_check,
  position('rummy_end_game_deck_empty' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS deck_end_game,
  position('DECK_EMPTY' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0 AS deck_empty_action,
  (SELECT count(*) FROM pg_proc WHERE proname = 'rummy_end_game_deck_empty') = 1 AS end_game_fn,
  (SELECT count(*) FROM rooms WHERE status = 'playing' AND jsonb_typeof(game->'deck') = 'array' AND jsonb_array_length(game->'deck') = 0) AS rooms_deck_empty_left,
  (SELECT count(*) FROM rooms WHERE status = 'ended' AND game->>'endReason' = 'DECK_EMPTY') AS rooms_ended_deck_empty;
