# Bug Fix Verification Report

**Date:** 2026-10-10 22:35 GMT+8
**Test room:** `TEST_BUGS_<timestamp>` (created fresh per run)
**Test script:** `/data/.openclaw/workspace/dummy-rummy/test-bug-fixes.py`

## Results

### Bug 1 — MELD structure: ✅ PASS
- **Setup**: `melds={"bot_0": [], "p_test": []}`, MELD `["5♥","5♠","5♦"]` as `p_test`.
- **Expected**: `melds` stays a per-player dict; `melds["p_test"]` becomes a 1-element list containing the meld.
- **Actual**: `melds = {"bot_0": [], "p_test": [["5♥","5♠","5♦"]]}` — correct shape, correct content, `is_dict=True`.
- The fix `jsonb_set(v_melds, ARRAY[p_player_id], ...)` properly updates the per-player slot instead of concat-ing onto the whole object.

### Bug 2 — LAYOFF extends existing meld: ❌ FAIL (new bug in the fix)
- **Setup**: `melds["p_test"] = [["7♦","8♦","9♦"]]`, `bot_0` has `6♦` in hand + `hasFirstMeld=true`, `target_meld_idx=0`.
- **Expected**: `melds["p_test"][0]` becomes `["7♦","8♦","9♦","6♦"]`; still one meld; `6♦` removed from hand.
- **Actual**: SQL error `42846: cannot cast type jsonb to text[]`. No state change.
- **Root cause** (in the deployed `supabase-schema-fixed.sql` line 194):
  ```sql
  v_player_meld_arr := jsonb_set(
      v_player_meld_arr,
      to_jsonb(v_p_meld_idx)::TEXT[],   -- ❌ to_jsonb(0) returns the scalar "0", not an array
      to_jsonb(v_new_meld));
  ```
  PostgreSQL rejects `to_jsonb(integer)::TEXT[]` because the scalar JSONB `0` cannot be cast to a text array.
- **Suggested patch** (in `supabase-schema-fixed.sql`):
  ```sql
  v_player_meld_arr := jsonb_set(
      v_player_meld_arr,
      ARRAY[v_p_meld_idx::TEXT],        -- ✅ wrap in ARRAY[]
      to_jsonb(v_new_meld));
  ```
  After patching, re-run `test-bug-fixes.py` to confirm green.

### Bug 3 — KNOCK no SQL crash: ✅ PASS
- **Setup**: `hands["p_test"] = []`, `turnPlayerId="p_test"`, `phase="action"`, `melds["p_test"]` has 2 melds for score computation.
- **Expected**: KNOCK returns `{ok:true, game:{status:"ended",...}, round_scores:{...}}`, no `22004` upper-bound-NULL error.
- **Actual**: `OK ver=2 phase=action turn=p_test`, game status moved to `ended`.
- The fix `v_players := ARRAY(SELECT jsonb_array_elements_text(v_game->'playerOrder'));` (added at the top of the KNOCK block) correctly populates the loop bound.

## Summary table

| Bug | Status | Notes |
|-----|--------|-------|
| 1 — MELD structure | ✅ fixed | Per-player dict preserved |
| 2 — LAYOFF extend   | ❌ regressed | `to_jsonb(scalar)::TEXT[]` cast fails; needs `ARRAY[v_p_meld_idx::TEXT]` |
| 3 — KNOCK crash     | ✅ fixed | `v_players` now initialized at KNOCK block start |

## Repro harness
Run `python3 test-bug-fixes.py` after applying any fix. Exit code 0 = all green, 1 = at least one bug remains.
