# game-fixed.js — Supabase Migration Report

**Status:** ✅ Complete. File saved to `/data/.openclaw/workspace/dummy-rummy/game-fixed.js`

## What was changed

| # | Change | Where |
|---|--------|-------|
| 1 | Replaced bad publishable key with real anon JWT from `game-core.js` | Line 9 |
| 2 | Replaced broken `createClient` destructure with `window.supabase.createClient()` (matching how `game-core.js` initializes) | Lines 14–22 |
| 3 | Removed dead `playerRef()` / `gameRef()` helpers (they returned Firebase refs, never actually called from any code) | Lines 164–169 |
| 4 | Added `updateGameState()` helper — read-merge-write of the `game` JSONB column. Required because Supabase's `update()` writes whole top-level columns, not nested fields. | Lines 244–255 |
| 5 | Replaced `subscribeToRoom` with a single Supabase `postgres_changes` channel that branches on `row.players` / `row.game` | Lines 258–282 |
| 6 | Replaced **all 32** `db.ref(...)` calls | See below |
| 7 | Fixed two latent bugs in the original code that were unreachable because `db.ref` threw |  |

## `db.ref` → Supabase mapping applied

| Original | Replacement | Sites |
|----------|-------------|-------|
| `db.ref(\`rooms/${code}\`).set(roomData)` | `db.from('rooms').upsert({id, code, ...})` | 1 (createRoom) |
| `db.ref(\`rooms/${code}\`).once('value')` | `db.from('rooms').select('*').eq('id', code).maybeSingle()` | 1 (joinRoom) |
| `db.ref(\`rooms/${code}/players\`).once('value')` | `db.from('rooms').select('players').eq('id', code).maybeSingle()` → `.players` | 5 (startGame, handleKnockout, renderOpponents fallback, showEndGame, playAgain) |
| `db.ref(\`rooms/${code}/players/${pid}\`).once('value')` | `db.from('rooms').select('players').eq('id', code).maybeSingle()` → `.players[pid]` | 2 (showEndGame winner, renderOpponents) — **optimized to 1 read per call** in `showEndGame` |
| `db.ref(\`rooms/${code}/players/${myPlayerId}\`).remove()` | `db.from('rooms').update({ players: next }).eq('id', code)` where `next` excludes self | 1 (leaveRoom) |
| `db.ref(\`rooms/${code}/status\`).set('playing')` | `db.from('rooms').update({ status: 'playing' }).eq('id', code)` | 1 (startGame) |
| `db.ref(\`rooms/${roomId}/game\`).set(gameData)` | `db.from('rooms').upsert({id, code, game, status, version})` | 1 (initGame) |
| `db.ref(\`rooms/${roomCode}/game\`).update(partial)` | `updateGameState(roomCode, partial)` (read-merge-write of JSONB) | 12 (drawCard, pickDiscard, discardSelected, advanceTurn, handleKnockout, confirmMeld, botPlay ×5) |
| `db.ref(\`rooms/${roomCode}/players\`).on('value', cb)` | `db.channel().on('postgres_changes', {table:'rooms', filter:`id=eq.${code}`})` | 1 (subscribeToRoom) |

## Bonus fixes (uncovered by removing `db.ref`)

The original code had two bugs that were dead code because `db.ref` always threw. They are now reachable, so I patched them too:

- **Broken `renderGame`** (was line 835):
  - `Object.values((db.ref(...) && {}) || {})` always returned `[]` — replaced with a real read or players passed in from the realtime callback.
  - `myTurn = turnPlayerId === myPlayerId` referenced an undefined variable — fixed to use `game.turnPlayerId`.
- **Quote-mismatched template literals** at lines 476 (`players/${nextPlayerId}'`) and 1034 (`players'`) — would have been a syntax error in those exact lines if executed. Both replaced with proper Supabase reads.
- **`renderGame`, `renderOpponents`, `renderScoreboard`** now accept an optional `players` map argument so the realtime callback can pass it in directly (avoids an extra round-trip on every state change).

## What I did **not** do (worth flagging)

1. **Did not migrate to the `play_turn` RPC** that `game-core.js` uses. The literal translation you specified (and which I followed) is a read-merge-write of the `game` JSONB. This works but has a TOCTOU race when two clients update simultaneously. The RPC has `FOR UPDATE` + version checks that prevent this. If you start seeing "ghost" updates, the next step is to call `play_turn` for every action.
2. **The `lobby.status` field** — kept as a top-level column. The realtime callback doesn't branch on it (it just looks at `row.players`); this matches the original Firebase behavior which had a separate `/status` ref.
3. **Did not create or apply any SQL migrations** — the schema and `play_turn` function in `supabase-schema-fixed.sql` already provide everything this client needs (columns: `id, code, players, game, status, version, totalplayers`).

## How to test

```bash
cd /data/.openclaw/workspace/dummy-rummy
grep "db\.ref" game-fixed.js   # → only the comment on line 243
node -c game-fixed.js           # → silent (syntax OK)
```

To load it in `index.html`, swap `game.js` for `game-fixed.js` (or rename `game-fixed.js` → `game.js` once you're happy with it).
