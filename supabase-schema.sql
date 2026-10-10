-- ============================================================
-- Dummy Rummy — Supabase Schema Setup
-- วิธีใช้: ไป Supabase → SQL Editor → วางทั้งหมด → Run
-- ============================================================

-- ============================================================
-- 1. เพิ่ม version column สำหรับ optimistic concurrency
-- ============================================================
ALTER TABLE rooms
ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- ============================================================
-- 2. สร้าง play_turn() RPC function
-- ทุก action ต้องผ่านฟังก์ชันนี้เพื่อ lock + เช็ค turn ก่อนอัปเดต
-- ============================================================
CREATE OR REPLACE FUNCTION play_turn(
  p_game_id           TEXT,
  p_player_id         TEXT,
  p_action            TEXT,
  p_card_code         TEXT DEFAULT NULL,
  p_discard_index     INTEGER DEFAULT NULL,
  p_meld_codes       TEXT[] DEFAULT NULL,
  p_target_pid        TEXT DEFAULT NULL,
  p_target_meld_idx   INTEGER DEFAULT NULL,
  p_expected_version  INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_game         JSONB;
  v_players      JSONB;
  v_version      INTEGER;
  v_turn_pid     TEXT;
  v_new_version  INTEGER;
  v_result       JSONB;
  -- game fields
  v_deck         JSONB;
  v_hands        JSONB;
  v_discard      JSONB;
  v_melds        JSONB;
  v_scores       JSONB;
  v_has_first    JSONB;
  v_picked       JSONB;
  v_player_order JSONB;
  v_cur_idx      INTEGER;
  v_next_pid     TEXT;
  v_card_arr     TEXT[];
  v_new_hand     TEXT[];
  v_taken_card   TEXT;
  v_i            INTEGER;
BEGIN
  -- 1) LOCK แถวเกมนี้
  SELECT game, players, version
    INTO v_game, v_players, v_version
    FROM rooms
   WHERE id = p_game_id
     AND status = 'playing'
    FOR UPDATE;

  -- 2) เช็ค version
  IF v_version IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROOM_NOT_FOUND');
  END IF;
  IF p_expected_version > 0 AND v_version != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_MISMATCH',
                               'current_version', v_version);
  END IF;

  -- 3) เช็ค turn
  v_turn_pid := (v_game->>'turnPlayerId');
  IF v_turn_pid != p_player_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN',
                               'turn_player_id', v_turn_pid);
  END IF;

  -- init
  v_deck        := COALESCE(v_game->'deck',            '[]'::JSONB);
  v_hands       := COALESCE(v_game->'hands',           '{}'::JSONB);
  v_discard     := COALESCE(v_game->'discardPile',     '[]'::JSONB);
  v_melds       := COALESCE(v_game->'melds',           '{}'::JSONB);
  v_scores      := COALESCE(v_game->'scores',           '{}'::JSONB);
  v_has_first   := COALESCE(v_game->'hasFirstMeld',    '{}'::JSONB);
  v_picked      := COALESCE(v_game->'pickedFromDiscard','{}'::JSONB);
  v_player_order:= COALESCE(v_game->'playerOrder',     '[]'::JSONB);
  v_cur_idx     := array_position(v_player_order::TEXT[], p_player_id) - 1;
  v_next_pid    := v_player_order->>((v_cur_idx + 1) % jsonb_array_length(v_player_order));
  v_new_version := v_version + 1;
  v_result      := jsonb_build_object('ok', true, 'new_version', v_new_version);

  -- ================================================================
  -- DRAW_DECK
  -- ================================================================
  IF p_action = 'DRAW_DECK' THEN
    IF jsonb_array_length(v_deck) = 0 THEN
      v_game := jsonb_set(jsonb_set(v_game, ARRAY['deckEmpty'], 'true'::JSONB),
                           ARRAY['phase'], '"action"'::JSONB);
    ELSE
      v_taken_card := (v_deck->(jsonb_array_length(v_deck)-1)->>'code');
      v_deck := v_deck - (jsonb_array_length(v_deck)-1);
      v_card_arr := ARRAY(SELECT jsonb_array_elements_text(v_hands->p_player_id));
      v_card_arr := v_card_arr || ARRAY[v_taken_card];
      v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_card_arr));
      v_game := jsonb_set(jsonb_set(jsonb_set(v_game, ARRAY['deck'], v_deck),
                                     ARRAY['hands'], v_hands),
                           ARRAY['phase'], '"action"'::JSONB);
    END IF;

  -- ================================================================
  -- PICK_DISCARD
  -- ================================================================
  ELSIF p_action = 'PICK_DISCARD' THEN
    IF p_discard_index IS NOT NULL AND p_discard_index < jsonb_array_length(v_discard) THEN
      -- หยิบตั้งแต่ index ถึง บนสุด
      DECLARE
        v_pick JSONB := '[]'::JSONB;
        v_keep JSONB := '[]'::JSONB;
        v_old  TEXT[];
        v_new  TEXT[];
        v_ldp  TEXT;
      BEGIN
        FOR v_i IN p_discard_index .. (jsonb_array_length(v_discard)-1) LOOP
          v_pick := v_pick || jsonb_build_array(v_discard->v_i);
        END LOOP;
        FOR v_i IN 0 .. (p_discard_index-1) LOOP
          v_keep := v_keep || jsonb_build_array(v_discard->v_i);
        END LOOP;

        v_old := ARRAY(SELECT jsonb_array_elements_text(v_hands->p_player_id));
        v_new := v_old || ARRAY(SELECT jsonb_array_elements_text(v_pick)::TEXT);
        v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new));

        -- ทิ้งมี่ penalty
        v_ldp := COALESCE(v_game->'lastDiscard'->>'playerId', p_player_id);
        IF v_ldp != p_player_id THEN
          v_scores := jsonb_set(v_scores, ARRAY[v_ldp],
            to_jsonb(COALESCE((v_scores->>v_ldp)::INT, 0) - 100));
          v_result := jsonb_set(v_result, ARRAY['mii_penalty'],
            jsonb_build_object('player', v_ldp, 'penalty', -100));
        END IF;

        v_game := jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(v_game, ARRAY['hands'], v_hands),
              ARRAY['discardPile'], v_keep),
            ARRAY['phase'], '"action"'::JSONB),
            ARRAY['lastDiscard'], 'null'::JSONB);
        -- track picked
        v_picked := jsonb_set(v_picked, ARRAY[p_player_id], v_pick);
        v_game := jsonb_set(v_game, ARRAY['pickedFromDiscard'], v_picked);
      END;
    END IF;

  -- ================================================================
  -- DISCARD
  -- ================================================================
  ELSIF p_action = 'DISCARD' THEN
    DECLARE
      v_old_hand TEXT[];
      v_new_hand TEXT[];
    BEGIN
      v_old_hand := ARRAY(SELECT jsonb_array_elements_text(v_hands->p_player_id));
      SELECT ARRAY(SELECT unnest(v_old_hand) WHERE unnest != p_card_code) INTO v_new_hand;
      v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new_hand));
      v_discard := v_discard || jsonb_build_array(jsonb_build_object('code', p_card_code));

      -- clear pickedFromDiscard for this player
      v_picked := v_picked - p_player_id;

      v_game := jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(v_game, ARRAY['hands'], v_hands),
              ARRAY['discardPile'], v_discard),
            ARRAY['phase'], '"draw"'::JSONB),
            ARRAY['turnPlayerId'], jsonb_build_text(v_next_pid)),
            ARRAY['turnStartTime'], to_jsonb(EXTRACT(EPOCH FROM NOW())::BIGINT));
      v_game := jsonb_set(v_game, ARRAY['pickedFromDiscard'], v_picked);
    END;

  -- ================================================================
  -- MELD
  -- ================================================================
  ELSIF p_action = 'MELD' THEN
    IF p_meld_codes IS NOT NULL THEN
      DECLARE
        v_old_hand   TEXT[];
        v_new_hand   TEXT[];
        v_is_first   BOOLEAN;
        v_pm         JSONB;
      BEGIN
        v_old_hand := ARRAY(SELECT jsonb_array_elements_text(v_hands->p_player_id));
        SELECT ARRAY(SELECT unnest(v_old_hand) WHERE NOT (unnest = ANY(p_meld_codes))) INTO v_new_hand;
        v_is_first := NOT ((v_has_first->>p_player_id) = 'true');
        v_pm := COALESCE(v_melds->p_player_id, '[]'::JSONB) || to_jsonb(p_meld_codes);
        v_hands    := jsonb_set(v_hands,    ARRAY[p_player_id], to_jsonb(v_new_hand));
        v_melds    := jsonb_set(v_melds,    ARRAY[p_player_id], v_pm);
        v_has_first:= jsonb_set(v_has_first,ARRAY[p_player_id], 'true'::JSONB);
        v_picked   := v_picked - p_player_id;
        v_game := jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(v_game, ARRAY['hands'],        v_hands),
              ARRAY['melds'],          v_melds),
            ARRAY['hasFirstMeld'],    v_has_first),
            ARRAY['pickedFromDiscard'], v_picked);
        v_result := jsonb_set(v_result, ARRAY['is_first_meld'], to_jsonb(v_is_first));
      END;
    END IF;

  -- ================================================================
  -- LAYOFF
  -- ================================================================
  ELSIF p_action = 'LAYOFF' THEN
    IF p_card_code IS NOT NULL AND p_target_pid IS NOT NULL AND p_target_meld_idx IS NOT NULL THEN
      DECLARE
        v_old_hand   TEXT[];
        v_new_hand   TEXT[];
        v_old_meld   TEXT[];
        v_new_meld   TEXT[];
      BEGIN
        v_old_hand := ARRAY(SELECT jsonb_array_elements_text(v_hands->p_player_id));
        SELECT ARRAY(SELECT unnest(v_old_hand) WHERE unnest != p_card_code) INTO v_new_hand;
        v_old_meld := ARRAY(SELECT jsonb_array_elements_text((v_melds->p_target_pid)->p_target_meld_idx));
        v_new_meld := v_old_meld || ARRAY[p_card_code];
        v_hands    := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new_hand));
        v_melds    := jsonb_set(v_melds, ARRAY[p_target_pid, p_target_meld_idx::TEXT], to_jsonb(v_new_meld));
        v_game := jsonb_set(
          jsonb_set(v_game, ARRAY['hands'], v_hands),
          ARRAY['melds'], v_melds);
      END;
    END IF;

  -- ================================================================
  -- KNOCK
  -- ================================================================
  ELSIF p_action = 'KNOCK' THEN
    DECLARE
      v_pids    TEXT[];
      v_pid     TEXT;
      v_hpts    INTEGER;
      v_mpts    INTEGER;
      v_tot     INTEGER;
      v_rs      JSONB := '{}'::JSONB;
      v_ts      JSONB := COALESCE(v_scores, '{}'::JSONB);
    BEGIN
      v_pids := ARRAY(SELECT jsonb_object_keys(v_hands));
      FOREACH v_pid IN ARRAY v_pids LOOP
        v_hpts := 10 * jsonb_array_length(v_hands->v_pid);
        v_mpts := 0;
        v_tot  := v_hpts + v_mpts;
        IF v_pid = p_player_id THEN
          v_tot := v_tot - 50;
          IF NOT ((v_has_first->>v_pid) = 'true') THEN
            v_tot := v_tot - 100;
          END IF;
        END IF;
        v_rs := jsonb_set(v_rs, ARRAY[v_pid], to_jsonb(v_tot));
        v_ts := jsonb_set(v_ts, ARRAY[v_pid],
          to_jsonb(COALESCE((v_ts->>v_pid)::INT, 0) + v_tot));
      END LOOP;
      v_game := jsonb_set(jsonb_set(v_game, ARRAY['scores'], v_rs),
                           ARRAY['status'], '"ended"'::JSONB);
      v_scores := v_ts;
      v_result := jsonb_set(
        jsonb_set(v_result, ARRAY['round_scores'], v_rs),
        ARRAY['winner'], to_jsonb(p_player_id));
    END;

  -- ================================================================
  -- END_TURN
  -- ================================================================
  ELSIF p_action = 'END_TURN' THEN
    v_game := jsonb_set(
      jsonb_set(
        jsonb_set(v_game,
          ARRAY['turnPlayerId'], jsonb_build_text(v_next_pid)),
          ARRAY['phase'], '"draw"'::JSONB),
        ARRAY['turnStartTime'], to_jsonb(EXTRACT(EPOCH FROM NOW())::BIGINT));
  END IF;

  -- ================================================================
  -- FINAL: update DB
  -- ================================================================
  UPDATE rooms
     SET game    = v_game,
         scores  = v_scores,
         version = v_new_version,
         status  = CASE WHEN (v_game->>'status') = 'ended' THEN 'ended' ELSE status END,
         winner  = CASE WHEN (v_game->>'status') = 'ended' THEN p_player_id ELSE winner END
   WHERE id = p_game_id;

  RETURN jsonb_set(v_result, ARRAY['game'],
    jsonb_set(v_game,
      ARRAY['version'], to_jsonb(v_new_version)));

END;
$$;

-- ============================================================
-- 3. Grant permission ให้ anon key รัน play_turn
-- ============================================================
GRANT EXECUTE ON FUNCTION play_turn TO anon;
GRANT EXECUTE ON FUNCTION play_turn TO authenticated;
