-- ============================================================
-- Dummy Rummy — Supabase Schema Setup
-- วิธีใช้: ไป Supabase → SQL Editor → วางทั้งหมด → Run
--
-- ⚠️ FIX 2026-10-21 — บักคะแนน/จบเกม (รอพี่เอยืนยัน Option A)
--   S1 (KNOCK)  : คำนวณแต้มตามกติกาจริง (มอลด์ - มือคู่แข่ง x2 + โบนัส 50/100 + headPoints)
--   S2 (สเปโต) : FIX v39 (2026-10-23) หัก 100 แต้มเมื่อสเปโตถูกนำไปอยู่ใน "ชุดเกิด/ฝาก" เท่านั้น
--                  (เดิมหักตอนหยิบ/ทิ้ง → ผิดกติกา)  และผู้เสีย = คนที่ทิ้งสเปโตล่าสุด (ถ้าไม่มี → คนที่เกิด/ฝาก)
--   S1b (KNOCK): FIX v39 อนุญาตน็อคตอนเหลือ 0 หรือ 1 ใบ (เดิมบังคับ 0 ใบ → HAND_NOT_EMPTY)
--   S3 (จบเกม) : เพิ่ม column winner/totalScores + เขียนลง game JSONB → ทุก client เห็นผู้ชนะ
--   ⚠️ รวม FIX 1-5 ของ 2026-10-19 ไว้ในไฟล์เดียว (run ครั้งเดียวจบ)
--
-- ⚠️ FIX 2026-10-19 — "เก็บเกิดไม่ได้"
--   FIX 1 (MELD)  : is_first_meld คำนวณหลังอัปเดต v_has_fm → false ตลอด
--   FIX 2 (LAYOFF): ตรวจ meld index ของเป้าหมายให้อยู่ในช่วงจริง
--   FIX 3 (PICK)  : ไพ่ที่หยิบจากกองทิ้งเคยหายไปจากเกม (ต้นเหตุหลัก!)
--   FIX 4 (PICK)  : บันทึก pickedFromDiscard ให้ server รู้ว่าใครหยิบอะไร
--   FIX 5 (DISCARD): บังคับให้เกิดใบที่หยิบก่อนทิ้ง (MUST_MELD_PICKED)
--   ฝั่ง client (game-core.js) แก้แล้ว: findAllLayoffs + rpcPlayTurn
-- ============================================================

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS totalPlayers INTEGER NOT NULL DEFAULT 4;
-- FIX S3: เพิ่ม column สำหรับผู้ชนะ/คะแนนสะสม (client อ่าน room.winner, room.totalScores)
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "winner" TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS "totalScores" JSONB;

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read" ON rooms;
DROP POLICY IF EXISTS "public_insert" ON rooms;
DROP POLICY IF EXISTS "public_update" ON rooms;
DROP POLICY IF EXISTS "public_delete" ON rooms;

CREATE POLICY "public_read" ON rooms FOR SELECT USING (true);
CREATE POLICY "public_insert" ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "public_update" ON rooms FOR UPDATE USING (true);
CREATE POLICY "public_delete" ON rooms FOR DELETE USING (true);


-- ============================================================
-- FIX S1/S2 — helper: แต้มของไพ่ (ต้องตรงกับ cardPoints() ใน game-core.js)
--   สเปโต (2♣ / Q♠) = 50 | A = 15 | J/Q/K/10 = 10 | อื่นๆ = 5
-- ============================================================
CREATE OR REPLACE FUNCTION rummy_card_points(p_code TEXT)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_rank TEXT;
  v_suit TEXT;
BEGIN
  IF p_code IS NULL OR p_code = '' THEN RETURN 0; END IF;
  IF p_code IN ('2♣', 'Q♠') THEN RETURN 50; END IF;   -- สเปโต
  v_suit := right(p_code, 1);
  v_rank := left(p_code, length(p_code) - 1);
  IF v_rank = 'A' THEN RETURN 15; END IF;
  IF v_rank IN ('J', 'Q', 'K', '10') THEN RETURN 10; END IF;
  RETURN 5;
END;
$$;

-- ============================================================
-- play_turn() — p_meld_codes เปลี่ยนเป็น JSONB
-- ============================================================
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
    v_discard := array_append(v_discard, p_card_code);
    v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new_hand));
    v_game := jsonb_set(v_game, '{hands}', v_hands);
    v_game := jsonb_set(v_game, '{discardPile}', to_jsonb(v_discard));
    -- บันทึกว่าผู้เล่นทิ้งไพ่แล้วในตานี้
    v_game := jsonb_set(v_game, ARRAY['hasDiscardedThisTurn', p_player_id], 'true');
    -- FIX S2 (v39): ทิ้งสเปโต = ยังไม่เสียแต้ม → จดจำผู้ทิ้งไว้ใน game.spetoOrigin[code]
    IF p_card_code IN ('2♣','Q♠') THEN
      v_game := jsonb_set(v_game, ARRAY['spetoOrigin', p_card_code], to_jsonb(p_player_id));
    END IF;
    v_players := ARRAY(SELECT jsonb_array_elements_text(v_game->'playerOrder'));
    v_idx := 0;
    FOR i IN 1..array_length(v_players,1) LOOP IF v_players[i] = v_current_pid THEN v_idx := i; EXIT; END IF; END LOOP;
    v_next_idx := (v_idx % array_length(v_players,1)) + 1;
    v_next_pid := v_players[v_next_idx];
    v_game := jsonb_set(v_game, '{turnPlayerId}', to_jsonb(v_next_pid));
    v_game := jsonb_set(v_game, '{phase}', '"draw"');
    v_game := jsonb_set(v_game, '{lastDiscard}', jsonb_build_object('playerId', p_player_id, 'cardCode', p_card_code));
    v_game := jsonb_set(v_game, '{version}', to_jsonb(v_new_version));
    UPDATE rooms SET game = v_game, version = v_new_version WHERE id = p_game_id;
    RETURN jsonb_build_object('ok', true, 'game', v_game);

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
    SELECT ARRAY(SELECT u FROM unnest(v_old) AS u WHERE NOT (u = ANY(v_meld_arr))) INTO v_new_hand;
    v_melds := COALESCE(v_melds, '{}'::JSONB);
    v_melds := jsonb_set(v_melds, ARRAY[p_player_id], COALESCE(v_melds->p_player_id, '[]'::JSONB) || jsonb_build_array(to_jsonb(v_meld_arr)));
    v_hands := jsonb_set(v_hands, ARRAY[p_player_id], to_jsonb(v_new_hand));
    v_is_first_meld := NOT COALESCE((v_has_fm->p_player_id)::BOOLEAN, false);
    v_has_fm := v_has_fm || jsonb_build_object(p_player_id, true);
    -- FIX 4 (ต่อ): เกิดแล้ว → ล้างรายการใบที่หยิบ (ทั้งที่เกิดไปแล้วและที่เหลือในมือ)
    v_game := jsonb_set(v_game, ARRAY['pickedFromDiscard', p_player_id], '[]'::JSONB);
    v_game := jsonb_set(v_game, '{hands}', v_hands);
    v_game := jsonb_set(v_game, '{melds}', v_melds);
    v_game := jsonb_set(v_game, '{hasFirstMeld}', v_has_fm);
    -- FIX S2 (v39): สเปโตเข้า "ชุดเกิด" → หัก 100 แต้ม
    --   ผู้เสีย = คนที่ทิ้งสเปโตนี้มาก่อน (game.spetoOrigin) ถ้าไม่มี → คนที่เกิดเอง
    v_game := jsonb_set(v_game, '{spettoPenalty}', COALESCE(v_game->'spettoPenalty', '{}'::JSONB));
    FOR i IN 1..array_length(v_meld_arr, 1) LOOP
      IF v_meld_arr[i] IN ('2♣','Q♠') THEN
        v_speto_loser := COALESCE(v_game->'spetoOrigin'->v_meld_arr[i], p_player_id);
        v_game := jsonb_set(v_game, ARRAY['spettoPenalty', v_speto_loser],
          to_jsonb(COALESCE((v_game->'spettoPenalty'->v_speto_loser)::INT,0) + 100));
        v_game := jsonb_set(v_game, ARRAY['spetoOrigin', v_meld_arr[i]], 'null');
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
    IF NOT ((v_has_fm->p_player_id)::BOOLEAN) THEN RETURN jsonb_build_object('ok', false, 'error', 'MUST_MELD_FIRST'); END IF;
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
    -- FIX S2 (v39): สเปโตถูก "ฝาก" ลงชุด → หัก 100 แต้ม (ผู้เสีย = คนที่ทิ้ง ถ้าไม่มี → คนที่ฝาก)
    IF p_card_code IN ('2♣','Q♠') THEN
      v_speto_loser := COALESCE(v_game->'spetoOrigin'->p_card_code, p_player_id);
      v_game := jsonb_set(v_game, ARRAY['spettoPenalty', v_speto_loser],
        to_jsonb(COALESCE((v_game->'spettoPenalty'->v_speto_loser)::INT,0) + 100));
      v_game := jsonb_set(v_game, ARRAY['spetoOrigin', p_card_code], 'null');
    END IF;
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
    v_head_pts := COALESCE((v_game->'headPoints')::INT, 0);
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
            v_hand_pts := v_hand_pts + rummy_card_points(v_pm->j);
          END LOOP;
          IF NOT COALESCE((v_has_fm->v_pid)::BOOLEAN, false) THEN
            v_hand_pts := v_hand_pts * 2;
          END IF;
        END IF;
        -- โทษสเปโต (หยิบหรือทิ้ง 2♣/Q♠) = -100
        v_penalty := COALESCE((v_game->'spettoPenalty'->v_pid)::INT, 0);
        v_round_scores := jsonb_set(v_round_scores, ARRAY[v_pid],
          to_jsonb(v_meld_pts - v_hand_pts - v_penalty));
      END;
    END LOOP;
    -- โบนัสคนที่น็อค: เกิดแล้ว 50 / ยังไม่เกิด 100 + headPoints
    v_score_diff := CASE WHEN COALESCE((v_has_fm->p_player_id)::BOOLEAN, false) THEN 50 ELSE 100 END + v_head_pts;
    v_round_scores := jsonb_set(v_round_scores, ARRAY[p_player_id],
      to_jsonb(COALESCE((v_round_scores->p_player_id)::INT, 0) + v_score_diff));
    -- คะแนนสะสม = เดิม + รอบนี้
    v_total_scores := '{}'::JSONB;
    FOR i IN 1..array_length(v_players, 1) LOOP
      DECLARE v_tpid TEXT := v_players[i];
      BEGIN
        v_total_scores := jsonb_set(v_total_scores, ARRAY[v_tpid],
          to_jsonb(COALESCE((v_scores->v_tpid)::INT, 0) + COALESCE((v_round_scores->v_tpid)::INT, 0)));
      END;
    END LOOP;
    -- ผู้ชนะ: ถ้ามีใครสะสม >= 500 → คนที่สะสมน้อยที่สุดชนะ (เหมือน handleKnockout() ใน client)
    v_win_pid := NULL;
    v_min_total := NULL;
    FOR i IN 1..array_length(v_players, 1) LOOP
      DECLARE v_tpid TEXT := v_players[i]; v_ttot INTEGER;
      BEGIN
        v_ttot := COALESCE((v_total_scores->v_tpid)::INT, 0);
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
          v_ttot := COALESCE((v_total_scores->v_tpid)::INT, 0);
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
    v_game := jsonb_set(v_game, '{winner}', to_jsonb(v_win_pid));
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

GRANT EXECUTE ON FUNCTION play_turn TO anon;
GRANT EXECUTE ON FUNCTION play_turn TO authenticated;
