#!/usr/bin/env python3
"""Test that 3 bugs are fixed in play_turn on Supabase:
  Bug 1: MELD must keep melds structure as {playerId: [meldArray]} dict
  Bug 2: LAYOFF must extend the existing meld (same array, +1 card), not append
  Bug 3: KNOCK with empty hand + own turn must NOT crash
"""
import subprocess, json, re, time, sys

anon_key = None
for line in open('/data/.openclaw/workspace/dummy-rummy/game-core.js'):
    m = re.search(r"['\"](eyJ[a-zA-Z0-9_.-]+)['\"]", line)
    if m:
        anon_key = m.group(1); break

SUPABASE = 'https://dbtlbeymrchodloboymr.supabase.co'

def curl(method, path, body=None):
    args = ['curl', '-s', '-X', method]
    if body is not None:
        args += ['-H', 'Content-Type: application/json', '-d', json.dumps(body)]
    args += [SUPABASE + path,
        '-H', f'apikey: {anon_key}',
        '-H', f'Authorization: Bearer {anon_key}']
    r = subprocess.run(args, capture_output=True, text=True, timeout=20)
    try: return json.loads(r.stdout) if r.stdout.strip() else []
    except: return r.stdout

def setup_room(room_id, game_state):
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
    r = curl('PATCH', f'/rest/v1/rooms?id=eq.{room_id}', payload)
    if not r or (isinstance(r, list) and len(r) == 0):
        return curl('POST', '/rest/v1/rooms', payload)
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

def get_room(room_id):
    return curl('GET', f'/rest/v1/rooms?id=eq.{room_id}')

def fmt(r):
    if not isinstance(r, dict):
        return f"<raw: {str(r)[:120]}>"
    if r.get('ok'):
        g = r.get('game', {})
        return f"OK ver={g.get('version')} phase={g.get('phase')} turn={g.get('turnPlayerId')}"
    err = r.get('error', '?')
    det = str(r.get('details',''))[:120]
    msg = r.get('message', '')
    if err is None and msg:
        return f"💥 SQL ERROR {r.get('code','?')} message={msg[:120]}"
    return f"❌ ERR error={err} details={det}"

# Initial state: p_test has a set of 5s + a run of 7-8-9♦
def base_state(v=1, extra=None):
    gs = {
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
    if extra:
        gs.update(extra)
    return gs

ROOM = f"TEST_BUGS_{int(time.time())}"
print(f"=== Using test room: {ROOM} ===\n")

# ============================================================
# BUG 1: MELD must keep melds as a per-player dict
# ============================================================
print("=" * 70)
print("BUG 1: MELD must keep melds structure as {playerId: [meldArray]} dict")
print("=" * 70)
setup_room(ROOM, base_state(1))

# Initial: melds is {"bot_0": [], "p_test": []}
initial = get_room(ROOM)
init_melds = (initial[0].get('game') if initial else {}).get('melds', {})
print(f"  Initial melds: {init_melds}")
print(f"    type: {type(init_melds).__name__}, is dict: {isinstance(init_melds, dict)}")

# MELD set of 5s
res1 = rpc(ROOM, 'p_test', 'MELD', meld_codes=["5♥","5♠","5♦"])
print(f"  → {fmt(res1)}")

after = get_room(ROOM)
melds_after = (after[0].get('game') if after else {}).get('melds', {})
print(f"  After MELD melds: {json.dumps(melds_after, ensure_ascii=False)}")
print(f"    type: {type(melds_after).__name__}, is dict: {isinstance(melds_after, dict)}")

bug1_pass = False
bug1_detail = ""
if not isinstance(melds_after, dict):
    bug1_detail = f"melds is not a dict (type={type(melds_after).__name__})"
elif 'p_test' not in melds_after:
    bug1_detail = "p_test key missing from melds"
elif 'bot_0' not in melds_after:
    bug1_detail = "bot_0 key missing from melds (other players overwritten)"
elif not isinstance(melds_after['p_test'], list):
    bug1_detail = f"melds['p_test'] is not a list, got {type(melds_after['p_test']).__name__}"
elif len(melds_after['p_test']) != 1:
    bug1_detail = f"expected 1 meld for p_test, got {len(melds_after['p_test'])}"
elif melds_after['p_test'][0] != ["5♥", "5♠", "5♦"]:
    bug1_detail = f"meld cards mismatch: {melds_after['p_test'][0]}"
else:
    bug1_pass = True

print(f"\n  BUG 1 RESULT: {'✅ PASS' if bug1_pass else '❌ FAIL'}")
if bug1_detail: print(f"     Details: {bug1_detail}")
print()

# ============================================================
# BUG 2: LAYOFF must extend the existing meld (same array, +1 card),
#         not append a new meld array
# ============================================================
print("=" * 70)
print("BUG 2: LAYOFF must extend existing meld (4 cards same array), not duplicate")
print("=" * 70)

# State: p_test has 7-8-9♦ melded (idx 0), bot_0 needs to lay off 6♦ or 10♦
# Plus bot_0 needs hasFirstMeld=true (pre-existing meld).
# Setup:
state2 = json.loads(json.dumps(base_state(1)))
state2['melds']['p_test'] = [["7♦","8♦","9♦"]]           # p_test already has a run melded
state2['melds']['bot_0'] = [["K♥","K♠","K♣"]]           # bot_0 has its own meld
state2['hasFirstMeld']['p_test'] = True
state2['hasFirstMeld']['bot_0'] = True                  # bot_0 already laid down, can layoff
# bot_0 turn (so it can act), and has 6♦ in hand to lay off on 7♦-8♦-9♦ run
state2['turnPlayerId'] = 'bot_0'
state2['hands'] = {
    "bot_0": ["6♦", "10♦", "9♣"],                      # 6♦ extends 7-8-9♦ (run-meld index 0 of p_test)
    "p_test": ["5♥","5♠","5♦","10♦","10♣","10♠"],
}
setup_room(ROOM, state2)

before = get_room(ROOM)
melds_before = (before[0].get('game') if before else {}).get('melds', {})
print(f"  Before LAYOFF melds: {json.dumps(melds_before, ensure_ascii=False)}")
print(f"    p_test melds: {len(melds_before.get('p_test', []))}")

# Lay off 6♦ onto p_test's meld index 0 (7♦-8♦-9♦ run)
res2 = rpc(ROOM, 'bot_0', 'LAYOFF', card_code="6♦", target_pid="p_test", target_meld_idx=0)
print(f"  → {fmt(res2)}")

after2 = get_room(ROOM)
melds_after2 = (after2[0].get('game') if after2 else {}).get('melds', {})
print(f"  After LAYOFF melds: {json.dumps(melds_after2, ensure_ascii=False)}")

bug2_pass = False
bug2_detail = ""
p_test_melds = melds_after2.get('p_test', [])
if not res2.get('ok'):
    bug2_detail = f"LAYOFF returned error: {res2.get('error')} {res2.get('message','')[:120]}"
elif len(p_test_melds) != 1:
    bug2_detail = f"expected 1 meld for p_test after LAYOFF, got {len(p_test_melds)}: {p_test_melds}"
elif p_test_melds[0] != ["7♦","8♦","9♦","6♦"]:
    bug2_detail = f"meld[0] = {p_test_melds[0]}, expected [7♦,8♦,9♦,6♦]"
elif "6♦" in (after2[0].get('game') or {}).get('hands', {}).get('bot_0', []):
    bug2_detail = "6♦ still in bot_0 hand (not removed)"
else:
    bug2_pass = True

print(f"\n  BUG 2 RESULT: {'✅ PASS' if bug2_pass else '❌ FAIL'}")
if bug2_detail: print(f"     Details: {bug2_detail}")
print()

# ============================================================
# BUG 3: KNOCK with empty hand + own turn must NOT crash
# ============================================================
print("=" * 70)
print("BUG 3: KNOCK with empty hand + own turn must not crash")
print("=" * 70)

state3 = json.loads(json.dumps(base_state(1)))
state3['hands']['p_test'] = []  # empty hand
state3['turnPlayerId'] = 'p_test'
state3['phase'] = 'action'
# give p_test some melds so scores can be computed
state3['melds']['p_test'] = [["5♥","5♠","5♦"], ["7♦","8♦","9♦"]]
setup_room(ROOM, state3)

res3 = rpc(ROOM, 'p_test', 'KNOCK')
print(f"  → {fmt(res3)}")

bug3_pass = False
bug3_detail = ""
if not isinstance(res3, dict):
    bug3_detail = f"non-dict response: {str(res3)[:120]}"
elif res3.get('message') or res3.get('code'):
    bug3_detail = f"💥 SQL ERROR {res3.get('code','?')}: {res3.get('message','')[:200]}"
elif not res3.get('ok'):
    err = res3.get('error', '?')
    msg = res3.get('message', '')
    # A non-OK error here is acceptable IF it's a legitimate validation error (like HAND_NOT_EMPTY),
    # but NOT a SQL crash.
    if err in ('HAND_NOT_EMPTY', 'NOT_YOUR_TURN', 'ROOM_NOT_FOUND', 'HAND_NOT_FOUND'):
        bug3_detail = f"logic error (not the crash bug): {err}"
    else:
        bug3_detail = f"unexpected error: {err} {msg[:120]}"
else:
    # Check that scores were computed and status changed
    g = res3.get('game', {})
    if g.get('status') == 'ended':
        bug3_pass = True
    else:
        bug3_detail = f"OK but status={g.get('status')}, scores={res3.get('round_scores')}"

print(f"\n  BUG 3 RESULT: {'✅ PASS' if bug3_pass else '❌ FAIL'}")
if bug3_detail: print(f"     Details: {bug3_detail}")
print()

# ============================================================
print("=" * 70)
print("FINAL SUMMARY")
print("=" * 70)
results = [
    ("Bug 1: MELD structure", bug1_pass),
    ("Bug 2: LAYOFF extend", bug2_pass),
    ("Bug 3: KNOCK no crash", bug3_pass),
]
all_pass = True
for name, ok in results:
    print(f"  {'✅' if ok else '❌'} {name}")
    if not ok: all_pass = False
print(f"\nOverall: {'ALL BUGS FIXED ✅' if all_pass else 'SOME BUGS REMAIN ❌'}")

# Cleanup
curl('DELETE', f'/rest/v1/rooms?id=eq.{ROOM}')
print(f"\nCleaned up room {ROOM}")

sys.exit(0 if all_pass else 1)
