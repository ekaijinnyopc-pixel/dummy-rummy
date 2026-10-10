-- ============================================================
-- Dummy Rummy — Supabase Schema Setup
-- วิธีใช้: ไป Supabase → SQL Editor → วางทั้งหมด → Run
-- ============================================================

-- ============================================================
-- 1. เพิ่ม columns ที่ยังไม่มี
-- ============================================================
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS totalPlayers INTEGER NOT NULL DEFAULT 4;

-- ============================================================
-- 2. RLS policies — ต้องมีก่อนใช้งาน
-- ============================================================
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- ลบ policies เก่าถ้ามี (รันซ้ำได้)
DROP POLICY IF EXISTS "public_read" ON rooms;
DROP POLICY IF EXISTS "public_insert" ON rooms;
DROP POLICY IF EXISTS "public_update" ON rooms;
DROP POLICY IF EXISTS "public_delete" ON rooms;

-- ใครก็ได้เลือกดูห้องได้
CREATE POLICY "public_read" ON rooms FOR SELECT USING (true);

-- ใครก็ได้สร้างห้อง
CREATE POLICY "public_insert" ON rooms FOR INSERT WITH CHECK (true);

-- ใครก็ได้อัปเดตห้อง
CREATE POLICY "public_update" ON rooms FOR UPDATE USING (true);

-- ใครก็ได้ลบห้อง
CREATE POLICY "public_delete" ON rooms FOR DELETE USING (true);

-- ============================================================
-- 3. สร้าง play_turn() RPC function
-- ============================================================
CREATE OR REPLACE FUNCTION play_turn(
  p_game_id           TEXT,
  p_player_id         TEXT,
  p_action            TEXT,
  p_card_code         TEXT DEFAULT NULL,
  p_discard_index     INTEGER DEFAULT NULL,
  p_meld_codes        TEXT[] DEFAULT NULL,
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
  v_card_arr      TEXT[];
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
  v_result        JSONB;
BEGIN
  -- ============================================================
  -- 1. LOCK แถวเกม
  -- ============================================================
  SELECT game INTO v_game
  FROM rooms
  WHERE id = p_game_id
  FOR UPDATE;

  IF v_game IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_NOT_FOUND');
  END IF;

  v_locked_game := v_game;

  -- ============================================================
  -- 2. เช็ค version (optimistic concurrency)
  -- ============================================================
  IF p_expected_version > 0 AND (v_game->>'version')::INT != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_MISMATCH', 'details', 'version mismatch');
  END IF;

  -- ============================================================
  -- 3. เช็ค turn
  -- ============================================================
  v_current_pid := v_game->>'turnPlayerId';
  IF p_action NOT IN ('MELD','LAYOFF','END_TURN') AND v_current_pid != p_player_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  -- ============================================================
  -- 4. เตรียมตัวแปร
  -- ============================================================
  v_deck    := ARRAY(SELECT jsonb_array_elements_text(v_game->'deck'));
  v_discard := ARRAY(SELECT jsonb_array_elements_text(v_game->'discardPile'));
  v_hands   := v_game->'hands';
  v_melds   := COALESCE(v_game->'melds', '{}'::JSONB);
  v_scores  := COALESCE(v_game->'scores', '{}'::JSONB);
  v_has_fm  := COALESCE(v_game->'hasFirstMeld', '{}'::JSONB);
  v_new_version := (v_game->>'version')::INT + 1;

  -- ============================================================
  -- 5. กระบวนการตาม action
  -- ============================================================

  -- ===== DRAW_DECK =====
  IF p_action = 'DRAW_DECK' THEN
    IF v_current_pid != p_player_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;
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
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game);

  -- ===== PICK_DISCARD =====
  ELSIF p_action = 'PICK_DISCARD' THEN
    IF v_current_pid != p_player_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;
    IF p_discard_index < 0 OR p_discard_index >= array_length(v_discard, 1) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_INDEX');
    END IF;
    v_discard := v_discard[1:p_discard_index];
    v_card_arr := v_hands->p_player_id;
    IF v_card_arr IS NULL THEN v_card_arr := '[]'::JSONB; END IF;
    v_new := ARRAY(SELECT jsonb_array_elements_text(v_card_arr)) || v_discard;
    v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new));
    v_game := jsonb_set(v_game, '{hands}', v_hands);
    v_game := jsonb_set(v_game, '{discardPile}', to_jsonb(v_discard));
    v_game := jsonb_set(v_game, '{phase}', '"action"');
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game);

  -- ===== DISCARD =====
  ELSIF p_action = 'DISCARD' THEN
    IF v_current_pid != p_player_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;
    IF p_card_code IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'NO_CARD');
    END IF;
    v_card_arr := v_hands->p_player_id;
    IF v_card_arr IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'HAND_NOT_FOUND'); END IF;
    v_old := ARRAY(SELECT jsonb_array_elements_text(v_card_arr));
    IF p_card_code != ALL(v_old) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CARD_NOT_IN_HAND');
    END IF;
    SELECT ARRAY(SELECT unnest(v_old) WHERE unnest != p_card_code) INTO v_new_hand;
    v_discard := array_append(v_discard, p_card_code);
    v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new_hand));
    v_game := jsonb_set(v_game, '{hands}', v_hands);
    v_game := jsonb_set(v_game, '{discardPile}', to_jsonb(v_discard));
    -- Advance turn
    v_players := ARRAY(SELECT jsonb_array_elements_text(v_game->'playerOrder'));
    v_idx := 0;
    FOR i IN 1..array_length(v_players,1) LOOP
      IF v_players[i] = v_current_pid THEN v_idx := i; EXIT; END IF;
    END LOOP;
    v_next_idx := (v_idx % array_length(v_players,1)) + 1;
    v_next_pid := v_players[v_next_idx];
    v_game := jsonb_set(v_game, '{turnPlayerId}', to_jsonb(v_next_pid));
    v_game := jsonb_set(v_game, '{phase}', '"draw"');
    v_game := jsonb_set(v_game, '{lastDiscard}', jsonb_build_object('playerId', p_player_id, 'cardCode', p_card_code));
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game);

  -- ===== MELD =====
  ELSIF p_action = 'MELD' THEN
    IF p_meld_codes IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'NO_MELD_CODES');
    END IF;
    v_card_arr := v_hands->p_player_id;
    IF v_card_arr IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'HAND_NOT_FOUND'); END IF;
    v_old := ARRAY(SELECT jsonb_array_elements_text(v_card_arr));
    FOR i IN 1..array_length(p_meld_codes, 1) LOOP
      IF p_meld_codes[i] != ALL(v_old) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'CARD_NOT_IN_HAND');
      END IF;
    END LOOP;
    SELECT ARRAY(SELECT unnest(v_old) WHERE NOT (unnest = ANY(p_meld_codes))) INTO v_new_hand;
    v_melds := COALESCE(v_melds, '{}'::JSONB);
    v_melds := v_melds || jsonb_build_array(to_jsonb(p_meld_codes));
    v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new_hand));
    v_has_fm := v_has_fm || jsonb_build_object(p_player_id, true);
    v_game := jsonb_set(v_game, '{hands}', v_hands);
    v_game := jsonb_set(v_game, '{melds}', v_melds);
    v_game := jsonb_set(v_game, '{hasFirstMeld}', v_has_fm);
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game, 'is_first_meld', (v_has_fm->p_player_id) IS NULL);

  -- ===== LAYOFF =====
  ELSIF p_action = 'LAYOFF' THEN
    IF p_card_code IS NULL OR p_target_pid IS NULL OR p_target_meld_idx IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MISSING_PARAMS');
    END IF;
    v_card_arr := v_hands->p_player_id;
    IF v_card_arr IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'HAND_NOT_FOUND'); END IF;
    v_old := ARRAY(SELECT jsonb_array_elements_text(v_card_arr));
    IF p_card_code != ALL(v_old) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CARD_NOT_IN_HAND');
    END IF;
    IF NOT ((v_has_fm->p_player_id)::BOOLEAN) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'MUST_MELD_FIRST');
    END IF;
    v_p_meld_idx := p_target_meld_idx;
    v_old_meld := ARRAY(SELECT jsonb_array_elements_text((v_melds->p_target_pid)->v_p_meld_idx));
    v_new_meld := array_append(v_old_meld, p_card_code);
    v_new_melds := JSONB_BUILD_OBJECT(p_target_pid,
      (v_melds->p_target_pid) || jsonb_build_array(to_jsonb(v_new_meld)));
    v_melds := v_melds || v_new_melds;
    SELECT ARRAY(SELECT unnest(v_old) WHERE unnest != p_card_code) INTO v_new_hand;
    v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new_hand));
    v_game := jsonb_set(v_game, '{hands}', v_hands);
    v_game := jsonb_set(v_game, '{melds}', v_melds);
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game);

  -- ===== KNOCK =====
  ELSIF p_action = 'KNOCK' THEN
    IF v_current_pid != p_player_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;
    v_card_arr := v_hands->p_player_id;
    IF v_card_arr IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'HAND_NOT_FOUND'); END IF;
    IF jsonb_array_length(v_card_arr) != 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'HAND_NOT_EMPTY');
    END IF;
    -- คำนวณคะแนน
    v_new_scores := v_scores;
    FOR i IN 1..array_length(v_players, 1) LOOP
      DECLARE
        v_pid TEXT := v_players[i];
        v_pts INTEGER := 0;
        v_pm JSONB;
      BEGIN
        v_pm := COALESCE(v_melds->v_pid, '[]'::JSONB);
        FOR j IN 0..jsonb_array_length(v_pm)-1 LOOP
          v_pts := v_pts + jsonb_array_length(v_pm->j);
        END LOOP;
        v_new_scores := jsonb_set(COALESCE(v_new_scores,'{}'::JSONB), ARRAY[v_pid], to_jsonb(v_pts));
      END;
    END LOOP;
    v_scores := COALESCE(v_scores, '{}'::JSONB);
    v_score_diff := ((v_new_scores->p_player_id)::INT - (v_scores->p_player_id)::INT) +
      CASE WHEN (v_has_fm->p_player_id)::BOOLEAN THEN 50 ELSE 100 END;
    v_new_scores := jsonb_set(v_new_scores, ARRAY[p_player_id],
      to_jsonb(((v_new_scores->p_player_id)::INT) + v_score_diff));
    v_game := jsonb_set(v_game, '{scores}', v_new_scores);
    v_game := jsonb_set(v_game, '{status}', '"ended"');
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, status = 'ended', version = v_new_version WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game, 'round_scores', v_new_scores);

  -- ===== END_TURN =====
  ELSIF p_action = 'END_TURN' THEN
    v_players := ARRAY(SELECT jsonb_array_elements_text(v_game->'playerOrder'));
    v_idx := 0;
    FOR i IN 1..array_length(v_players,1) LOOP
      IF v_players[i] = v_current_pid THEN v_idx := i; EXIT; END IF;
    END LOOP;
    v_next_idx := (v_idx % array_length(v_players,1)) + 1;
    v_next_pid := v_players[v_next_idx];
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

-- ============================================================
-- 4. Grant permission ให้ anon key รัน play_turn
-- ============================================================
GRANT EXECUTE ON FUNCTION play_turn TO anon;
GRANT EXECUTE ON FUNCTION play_turn TO authenticated;
