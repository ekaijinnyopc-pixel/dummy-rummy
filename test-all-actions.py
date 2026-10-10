#!/usr/bin/env python3
"""Test all RPC actions on a fresh test room with deterministic state.
Uses p_expected_version=0 to skip version check.
Sets up custom room state via PATCH so each test scenario is guaranteed.
"""
import subprocess, json, re, sys

anon_key = None
for line in open('/data/.openclaw/workspace/dummy-rummy/game-core.js'):
    m = re.search(r"['\"](eyJ[a-zA-Z0-9_.-]+)['\"]", line)
    if m:
        anon_key = m.group(1)
        break

SUPABASE = 'https://dbtlbeymrchodloboymr.supabase.co'

def curl(method, path, body=None):
    args = ['curl', '-s', '-X', method]
    if body is not None:
        args += ['-H', 'Content-Type: application/json', '-d', json.dumps(body)]
    args += [SUPABASE + path,
        '-H', f'apikey: {anon_key}',
        '-H', f'Authorization: Bearer {anon_key}']
    r = subprocess.run(args, capture_output=True, text=True, timeout=15)
    try: return json.loads(r.stdout) if r.stdout.strip() else []
    except: return r.stdout

def setup_room(room_id, game_state):
    """Create or update a test room with given game state."""
    payload = {
        "id": room_id,
        "code": room_id,
        "status": "playing",
        "version": game_state.get('version', 1),
        "totalplayers": 2,
        "players": {
            "bot_0": {"id": "bot_0", "name": "Bot", "isBot": True, "isHost": True},
            "p_test": {"id": "p_test", "name": "Test", "isBot": False, "isHost": False},
        },
        "game": game_state,
    }
    # Try PATCH first (faster for existing room); if 0 rows, POST to create
    r = curl('PATCH', f'/rest/v1/rooms?id=eq.{room_id}', payload)
    # PATCH returns [] when no rows updated; check
    if not r or (isinstance(r, list) and len(r) == 0):
        # Create via POST
        result = curl('POST', '/rest/v1/rooms', payload)
        return result
    return r

def rpc(room_id, player_id, action, **opts):
    payload = {
        "p_game_id": room_id,
        "p_player_id": player_id,
        "p_action": action,
        "p_card_code": opts.get('card_code'),
        "p_discard_index": opts.get('discard_index'),
        "p_meld_codes": opts.get('meld_codes'),
        "p_target_pid": opts.get('target_pid'),
        "p_target_meld_idx": opts.get('target_meld_idx'),
        "p_expected_version": 0,
    }
    return curl('POST', '/rest/v1/rpc/play_turn', payload)

def fmt(r):
    if not isinstance(r, dict):
        return f"<raw: {str(r)[:120]}>"
    if r.get('ok'):
        g = r.get('game', {})
        extra = {k: str(r[k])[:60] for k in r if k not in ('ok','game')}
        return f"✅ OK ver={g.get('version')} phase={g.get('phase')} turn={g.get('turnPlayerId')} extra={extra}"
    err = r.get('error', '?')
    det = str(r.get('details',''))[:120]
    msg = r.get('message', '')
    if err is None and msg:
        return f"💥 SQL ERROR {r.get('code','?')} message={msg[:120]}"
    return f"❌ ERR error={err} details={det}"

# Default game state: p_test has set of 5s and run of diamonds 7-8-9
BASE_STATE = lambda v=1: {
    "deck": ["A♠", "2♠"],
    "hands": {
        "bot_0": ["K♥", "K♠", "9♣", "6♦", "10♦"],
        "p_test": ["5♥", "5♠", "5♦", "7♦", "8♦", "9♦", "10♦"],
    },
    "discardPile": ["3♦"],
    "melds": {"bot_0": [], "p_test": []},
    "hasFirstMeld": {"bot_0": False, "p_test": False},
    "scores": {"bot_0": 0, "p_test": 0},
    "playerOrder": ["bot_0", "p_test"],
    "turnPlayerId": "p_test",
    "phase": "action",
    "round": 1,
    "status": "playing",
    "headCard": "3♦",
    "headPoints": 50,
    "deckEmpty": False,
    "lastDiscard": {"playerId": "bot_0", "cardCode": "3♦"},
    "pickedFromDiscard": {},
    "version": v,
}

# Create test room
import time
ROOM = f"TEST_RPC_{int(time.time())}"
print(f"Creating test room: {ROOM}")
setup_room(ROOM, BASE_STATE(1))

results = {}

def run_test(name, game_state, action, player, **opts):
    setup_room(ROOM, game_state)
    res = rpc(ROOM, player, action, **opts)
    print(f"  → {fmt(res)}")
    results[name] = res
    return res

# ============================================================
print()
print("="*70)
print("TEST SUITE: All RPC actions")
print("="*70)

# ===== MELD =====
print()
print("--- TEST: MELD set of 5s ---")
run_test('MELD_SET', BASE_STATE(1), 'MELD', 'p_test', meld_codes=["5♥","5♠","5♦"])

print()
print("--- TEST: MELD run 7-8-9 diamonds ---")
run_test('MELD_RUN', BASE_STATE(1), 'MELD', 'p_test', meld_codes=["7♦","8♦","9♦"])

print()
print("--- TEST: MELD empty codes → NO_MELD_CODES ---")
run_test('MELD_EMPTY', BASE_STATE(1), 'MELD', 'p_test', meld_codes=[])

print()
print("--- TEST: MELD null codes → NO_MELD_CODES ---")
run_test('MELD_NULL', BASE_STATE(1), 'MELD', 'p_test', meld_codes=None)

print()
print("--- TEST: MELD cards not in hand → CARD_NOT_IN_HAND ---")
run_test('MELD_BAD_CARDS', BASE_STATE(1), 'MELD', 'p_test', meld_codes=["A♠","A♥","A♦"])

print()
print("--- TEST: MELD with 2 cards (no meld, BUT schema accepts any) ---")
run_test('MELD_2_CARDS', BASE_STATE(1), 'MELD', 'p_test', meld_codes=["5♥","5♠"])

# ===== PICK_DISCARD =====
print()
print("--- TEST: PICK_DISCARD (discard=3♦) ---")
run_test('PICK_DISCARD_OK', BASE_STATE(1), 'PICK_DISCARD', 'p_test', discard_index=0)

print()
print("--- TEST: PICK_DISCARD invalid index → INVALID_INDEX ---")
run_test('PICK_DISCARD_BAD', BASE_STATE(1), 'PICK_DISCARD', 'p_test', discard_index=9999)

# ===== LAYOFF =====
print()
print("--- TEST: LAYOFF (no hasFirstMeld for actor) → MUST_MELD_FIRST ---")
run_test('LAYOFF_NO_FM', BASE_STATE(1), 'LAYOFF', 'bot_0',
        card_code="K♥", target_pid="p_test", target_meld_idx=0)

print()
print("--- TEST: LAYOFF missing params → MISSING_PARAMS ---")
run_test('LAYOFF_MISSING', BASE_STATE(1), 'LAYOFF', 'p_test')

print()
print("--- TEST: LAYOFF after MELD (set hasFirstMeld for actor) ---")
state_with_fm = json.loads(json.dumps(BASE_STATE(1)))
state_with_fm['hasFirstMeld']['bot_0'] = True
run_test('LAYOFF_OK', state_with_fm, 'LAYOFF', 'bot_0',
        card_code="K♥", target_pid="p_test", target_meld_idx=0)

# ===== KNOCK =====
print()
print("--- TEST: KNOCK with non-empty hand → HAND_NOT_EMPTY ---")
run_test('KNOCK_NOT_EMPTY', BASE_STATE(1), 'KNOCK', 'p_test')

print()
print("--- TEST: KNOCK NOT_YOUR_TURN ---")
state2 = json.loads(json.dumps(BASE_STATE(1)))
state2['hands']['p_test'] = []  # empty hand
run_test('KNOCK_WRONG_TURN', state2, 'KNOCK', 'bot_0')

print()
print("--- TEST: KNOCK success (empty hand + turn) — KNOWN SQL BUG ---")
state3 = json.loads(json.dumps(BASE_STATE(1)))
state3['hands']['p_test'] = []  # p_test is turn player with empty hand
state3['phase'] = 'action'
state3['turnPlayerId'] = 'p_test'
run_test('KNOCK_SUCCESS', state3, 'KNOCK', 'p_test')

# ===== END_TURN =====
print()
print("--- TEST: END_TURN ---")
run_test('END_TURN', BASE_STATE(1), 'END_TURN', 'p_test')

# ===== NOT_YOUR_TURN =====
print()
print("--- TEST: DRAW_DECK from wrong player → NOT_YOUR_TURN ---")
run_test('DRAW_DECK_WRONG', BASE_STATE(1), 'DRAW_DECK', 'bot_0')

print()
print("--- TEST: DISCARD from wrong player → NOT_YOUR_TURN ---")
run_test('DISCARD_WRONG', BASE_STATE(1), 'DISCARD', 'bot_0', card_code="K♥")

# ===== DISCARD =====
print()
print("--- TEST: DISCARD non-existent card → CARD_NOT_IN_HAND ---")
run_test('DISCARD_BAD', BASE_STATE(1), 'DISCARD', 'p_test', card_code="ZZZZ")

print()
print("--- TEST: DISCARD no card_code → NO_CARD ---")
run_test('DISCARD_NO_CARD', BASE_STATE(1), 'DISCARD', 'p_test')

# ===== DRAW_DECK =====
print()
print("--- TEST: DRAW_DECK success ---")
state4 = json.loads(json.dumps(BASE_STATE(1)))
state4['phase'] = 'draw'
state4['turnPlayerId'] = 'p_test'
run_test('DRAW_DECK_OK', state4, 'DRAW_DECK', 'p_test')

# ============================================================
print()
print("="*70)
print("SUMMARY")
print("="*70)
for name, res in results.items():
    if isinstance(res, dict):
        if res.get('ok'):
            print(f"  ✅ {name}: OK")
        elif res.get('error'):
            print(f"  ❌ {name}: {res.get('error')}")
        elif res.get('message'):
            print(f"  💥 {name}: SQL {res.get('code','?')}: {res.get('message','')[:80]}")
        else:
            print(f"  ? {name}: {res}")
    else:
        print(f"  ? {name}: {res}")
print()

# Cleanup: delete test room
curl('DELETE', f'/rest/v1/rooms?id=eq.{ROOM}')
print(f"Cleaned up test room {ROOM}")