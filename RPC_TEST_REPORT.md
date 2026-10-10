# Dummy Rummy — RPC Action Test Report

## Test Environment
- **Supabase Project**: `dbtlbeymrchodloboymr`
- **Test Method**: Created a deterministic test room with controlled game state
- **Approach**: `p_expected_version=0` to skip optimistic version check
- **Test Script**: `/data/.openclaw/workspace/dummy-rummy/test-all-actions.py`

## Test Results (Summary)

| Action | Test Case | Result | Notes |
|--------|-----------|--------|-------|
| **MELD** | set of 5s | ✅ OK | Returns `is_first_meld` flag |
| **MELD** | run 7-8-9♦ | ✅ OK | |
| **MELD** | empty codes `[]` | ❌ NO_MELD_CODES | Expected |
| **MELD** | null codes | ❌ NO_MELD_CODES | Treated as empty |
| **MELD** | cards not in hand | ❌ CARD_NOT_IN_HAND | Expected |
| **MELD** | 2 cards (not 3) | ✅ OK | ⚠️ Schema doesn't enforce 3-card minimum |
| **PICK_DISCARD** | valid index 0 | ✅ OK | Card added to hand |
| **PICK_DISCARD** | invalid index 9999 | ❌ INVALID_INDEX | Expected |
| **LAYOFF** | no hasFirstMeld | ❌ MUST_MELD_FIRST | Expected |
| **LAYOFF** | missing params | ❌ MISSING_PARAMS | Expected |
| **LAYOFF** | actor has hasFirstMeld=true | ✅ OK | ⚠️ **BUG**: appends new meld entry instead of extending |
| **KNOCK** | non-empty hand | ❌ HAND_NOT_EMPTY | Expected |
| **KNOCK** | not turn | ❌ NOT_YOUR_TURN | Expected |
| **KNOCK** | empty hand + turn | 💥 **SQL ERROR** | ⚠️ **BUG**: `22004: upper bound of FOR loop cannot be null` |
| **END_TURN** | normal | ✅ OK | |
| **DRAW_DECK** | wrong player | ❌ NOT_YOUR_TURN | Expected |
| **DRAW_DECK** | valid | ✅ OK | |
| **DISCARD** | wrong player | ❌ NOT_YOUR_TURN | Expected |
| **DISCARD** | bad card | ❌ CARD_NOT_IN_HAND | Expected |
| **DISCARD** | no card_code | ❌ NO_CARD | Expected |

## ❌ No `malformed array literal` Error
Confirmed — all `p_meld_codes` calls work correctly (passed as JSON array string).

## 🐛 Bugs Found

### Bug #1: MELD corrupts `melds` structure (CRITICAL)

**Symptom**: When `melds` is stored as a per-player object (`{"bot_0":[], "p_test":[]}`), after a successful MELD the structure becomes:
```
{"bot_0":[], "p_test":[]}  →  [{"bot_0":[], "p_test":[]}, ["5♥","5♠","5♦"]]
```

**Root cause** in `play_turn` SQL:
```sql
v_melds := COALESCE(v_melds, '{}'::JSONB);
v_melds := v_melds || jsonb_build_array(to_jsonb(v_meld_arr));
```

The `||` operator on `object || array` in PostgreSQL JSONB concatenates them, converting the per-player object into a global array. The MELD should be appended to `v_melds->p_player_id`, not to the whole `v_melds`.

**Fix needed**:
```sql
v_melds := jsonb_set(
  COALESCE(v_melds, '{}'::JSONB),
  ARRAY[p_player_id],
  to_jsonb(COALESCE(v_melds->p_player_id, '[]'::JSONB) || to_jsonb(v_meld_arr))
);
```

### Bug #2: LAYOFF appends new meld instead of extending (CRITICAL)

**Symptom**: When LAYOFF succeeds, instead of extending the existing meld at `p_target_meld_idx`, it creates a duplicate meld entry.

**Example**: target melds are `[["5♥","5♠","5♦"], ["7♦","8♦","9♦"]]`. After LAYOFF `6♦` onto meld index 1, result becomes:
```
[..., ["5♥","5♠","5♦"], ["7♦","8♦","9♦"], ["7♦","8♦","9♦","6♦"]]
```

**Root cause** in `play_turn` SQL:
```sql
v_new_melds := JSONB_BUILD_OBJECT(p_target_pid, (v_melds->p_target_pid) || jsonb_build_array(to_jsonb(v_new_meld)));
v_melds := v_melds || v_new_melds;
```

`(v_melds->p_target_pid)` is the player's array of melds (e.g., `[["7♦","8♦","9♦"]]`). The `|| jsonb_build_array(...)` appends `v_new_meld` as a NEW element in that array, instead of replacing the meld at `p_target_meld_idx`.

**Fix needed**: replace the array element at index `p_target_meld_idx` with the extended meld:
```sql
-- use jsonb_set with array index or splice
v_old_meld_array := ARRAY(SELECT jsonb_array_elements_text(v_melds->p_target_pid));
v_new_meld_array := array_append(v_old_meld_array, p_card_code);
-- but we'd need to replace at specific index, not append
```

### Bug #3: KNOCK crashes with SQL error 22004

**Symptom**: When a player with empty hand tries to KNOCK, returns:
```
22004: upper bound of FOR loop cannot be null
```

**Root cause** in `play_turn` SQL:
```sql
FOR i IN 1..array_length(v_players, 1) LOOP  -- v_players is NULL here!
```

The KNOCK block uses `v_players` but never sets it (unlike DISCARD and END_TURN blocks which do `v_players := ARRAY(SELECT jsonb_array_elements_text(v_game->'playerOrder'))`).

**Fix needed**: add at the top of KNOCK block:
```sql
v_players := ARRAY(SELECT jsonb_array_elements_text(v_game->'playerOrder'));
```

### Minor Issue: MELD doesn't enforce 3-card minimum

A 2-card "meld" passes MELD successfully (no `MALFORMED_MELD` or similar error). Schema accepts any non-empty array.

## ✅ Working Correctly
- `p_meld_codes` accepts JSON arrays (no `malformed array literal`)
- PICK_DISCARD adds card to hand and clears discardPile correctly
- DRAW_DECK draws from deck and adds to hand
- DISCARD removes from hand and adds to discardPile
- END_TURN switches turn and resets phase to draw
- NOT_YOUR_TURN checks for DRAW_DECK, PICK_DISCARD, DISCARD, KNOCK
- hasFirstMeld is set per-player correctly
- HAND_NOT_EMPTY, CARD_NOT_IN_HAND, MISSING_PARAMS errors work

## Recommendation
The MELD/LAYOFF/KNOCK bugs should be fixed before the game is playable end-to-end. Without these fixes, no real game can complete because:
- After any MELD, the melds structure is broken (subsequent LAYOFF won't work correctly)
- KNOCK (the win condition) crashes the database with a SQL error
- Even LAYOFF succeeding corrupts the melds structure further