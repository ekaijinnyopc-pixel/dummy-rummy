#!/usr/bin/env python3
import subprocess, json, re

anon_key = None
for line in open('/data/.openclaw/workspace/dummy-rummy/game-core.js'):
    m = re.search(r"['\"](eyJ[a-zA-Z0-9_.-]+)['\"]", line)
    if m:
        anon_key = m.group(1)
        break

# Get room info (playing status only)
r = subprocess.run(['curl', '-s',
    'https://dbtlbeymrchodloboymr.supabase.co/rest/v1/rooms?status=eq.playing&limit=1',
    '-H', f'apikey: {anon_key}',
    '-H', f'Authorization: Bearer {anon_key}'],
    capture_output=True, text=True, timeout=10)
rooms = json.loads(r.stdout)
if not rooms:
    print("No rooms with status=playing"); exit(1)
room = rooms[0]
game_id = room['id']
version = room.get('version', 1)
game = room.get('game', {})
turn_player = game.get('turnPlayerId', '')
hands = game.get('hands', {})

print(f"Room: {game_id}, turn: {turn_player}, version: {version}")
print(f"Cards ({turn_player}): {hands.get(turn_player, [])}")

def rpc(payload):
    r = subprocess.run(['curl', '-s', '-X', 'POST',
        'https://dbtlbeymrchodloboymr.supabase.co/rest/v1/rpc/play_turn',
        '-H', f'apikey: {anon_key}',
        '-H', f'Authorization: Bearer {anon_key}',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps(payload)],
        capture_output=True, text=True, timeout=15)
    try:
        return json.loads(r.stdout)
    except Exception:
        return {'raw': r.stdout}

# Test 1: DRAW_DECK
print("\n--- DRAW_DECK ---")
r1 = rpc({"p_game_id": game_id, "p_player_id": turn_player, "p_action": "DRAW_DECK",
           "p_card_code": None, "p_discard_index": None, "p_meld_codes": None,
           "p_target_pid": None, "p_target_meld_idx": None, "p_expected_version": version})
print(r1)
if r1.get('ok'): print("✅ DRAW_DECK OK")
else: print(f"❌ {r1.get('error')}: {str(r1.get('details',''))[:120]}")

# Get new version
new_ver = r1.get('game', {}).get('version', version+1) if r1.get('ok') else version+1

# Test 2: DISCARD
print("\n--- DISCARD ---")
cards = hands.get(turn_player, [])
if cards:
    discard_card = cards[0]
    r2 = rpc({"p_game_id": game_id, "p_player_id": turn_player, "p_action": "DISCARD",
               "p_card_code": discard_card, "p_discard_index": None, "p_meld_codes": None,
               "p_target_pid": None, "p_target_meld_idx": None, "p_expected_version": new_ver})
    print(r2)
    if r2.get('ok'): print("✅ DISCARD OK")
    else: print(f"❌ {r2.get('error')}: {str(r2.get('details',''))[:120]}")
else:
    print("(no cards to discard)")

print("\n=== All RPC tests done ===")
