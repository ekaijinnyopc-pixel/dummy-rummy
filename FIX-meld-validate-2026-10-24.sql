-- =====================================================================
-- FIX v50 — server-side validate ชุดเกิด (MELD)  |  2026-10-24
-- ---------------------------------------------------------------------
-- 🐛 ปัญหา: branch MELD ใน play_turn() เช็คแค่ CARD_NOT_IN_HAND
--    → ผู้เล่นส่งไพ่ 3 ใบที่ไม่ใช่ชุด ก็ "เกิด" (MELD) ได้
--    → server ไม่ได้เป็นเจ้าของกติกาจริง (ขัดกับ FIX v41)
--
-- ✅ การแก้: เพิ่ม rummy_meld_type(v_meld_arr) IS NULL → error 'INVALID_MELD'
--    · ไม่เปลี่ยนกติกาอะไรเลย — ใช้ฟังก์ชันที่มีอยู่แล้วในระบบ
--    · rummy_is_set/rummy_is_run เคยถูกใช้อยู่แล้ว (ฝั่ง LAYOFF)
--      → สเปโตเข้าชุดตองได้ (FIX v39) / ห้ามเข้าชุดเรียง (FIX v39) — ตรงกับ client
--    · ชุดย่อย 3+ ใบก็ผ่าน (เช่น 3 จาก 4 ใบเลขเดียวกัน) → ตรงกับ FIX v50 ฝั่ง client
--
-- ⚠️ ความเสี่ยง: ห้องที่ "เกิดผิด" ไปแล้วก่อนรัน patch นี้ จะยังคงอยู่
--    (patch นี้กันการเกิดผิดใหม่เท่านั้น ไม่ได้ล้างของเก่า)
--
-- 📌 วิธีรัน: เปิด Supabase → SQL Editor → วางทั้งไฟล์นี้ → Run
-- =====================================================================

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
    -- FIX v50 (2026-10-24): ตรวจว่าไพ่ที่ส่งมา "เป็นชุดจริง" ไหม
    --   เดิม branch MELD เช็คแค่ CARD_NOT_IN_HAND → ส่งไพ่ 3 ใบที่ไม่ใช่ชุดก็ "เกิด" ได้
    --   server ต้องเป็นเจ้าของกติกา (FIX v41) → validate ด้วย rummy_meld_type()
    --   rummy_meld_type() = 'set' (ตอง) | 'run' (เรียง) | NULL (ไม่ใช่ชุด)
    --   หมายเหตุ: rummy_is_set/rummy_is_run อนุญาตสเปโตในชุดตอง (FIX v39) แต่ห้ามในชุดเรียง
    IF rummy_meld_type(v_meld_arr) IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_MELD',
        'details', 'ไพ่ที่เลือกไม่ใช่ชุดที่เกิดได้ (ต้องเป็นชุดตองหรือชุดเรียง)');
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

-- =====================================================================
-- ✅ คำสั่งตรวจสอบหลังรัน (วางรันแยกได้)
-- =====================================================================
-- 1) เช็คว่า fix อยู่ใน play_turn แล้ว
SELECT CASE WHEN position('INVALID_MELD' in pg_get_functiondef(oid)) > 0
  THEN '✅ FIX v50 อยู่แล้ว (MELD validate ทำงาน)'
  ELSE '❌ ยังไม่มี fix — รันส่วนบนอีกครั้ง'
END AS fix_status
FROM pg_proc WHERE proname = 'play_turn';

-- 2) เช็คว่า rummy_meld_type ทำงานถูกต้อง (คาดหวัง: set | run | NULL)
SELECT
  rummy_meld_type(ARRAY['5♠','5♥','5♣'])          AS set_ok,      -- set
  rummy_meld_type(ARRAY['7♠','8♠','9♠'])          AS run_ok,      -- run
  rummy_meld_type(ARRAY['5♠','5♥','9♠'])          AS not_a_meld,  -- NULL
  rummy_meld_type(ARRAY['7♠','8♠','Q♠'])          AS speto_run,   -- NULL (สเปโตห้ามเข้าชุดเรียง)
  rummy_meld_type(ARRAY['2♣','2♥','2♦'])          AS speto_set;   -- set (สเปโตเข้าชุดตองได้ FIX v39)

-- 3) ตรวจห้องที่เกิด "ผิด" ไปแล้วก่อนรัน patch (ถ้ามี = ต้องแก้ด้วยมือ)
SELECT r.id AS room_id, r.status,
       m.pid AS player_id, m2.meld_codes, rummy_meld_type(m2.meld_codes) AS actual_type
FROM rooms r
CROSS JOIN LATERAL jsonb_each(COALESCE(r.game->'melds','{}'::JSONB)) AS m(pid, melds)
CROSS JOIN LATERAL jsonb_array_elements(m.melds) AS m2(meld_codes)
WHERE r.game IS NOT NULL
  AND rummy_meld_type(m2.meld_codes) IS NULL
LIMIT 20;
