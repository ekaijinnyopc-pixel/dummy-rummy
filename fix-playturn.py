import subprocess, json, sys

token = open('/data/.supabase/access-token').read().strip()

# Get anon key from workspace
anon_key = None
for line in open('/data/.openclaw/workspace/dummy-rummy/game.js'):
    if 'SUPABASE_KEY' in line and 'const' in line:
        import re
        m = re.search(r"['\"](eyJ[^'\"]+)['\"]", line)
        if m:
            anon_key = m.group(1)
            break

if not anon_key:
    # Try game-core.js
    for line in open('/data/.openclaw/workspace/dummy-rummy/game-core.js'):
        if 'SUPABASE_KEY' in line:
            import re
            m = re.search(r"['\"](eyJ[^'\"]+)['\"]", line)
            if m:
                anon_key = m.group(1)
                break

print(f"Anon key: {anon_key[:20]}...")

# Check current function
r = subprocess.run(['curl','-s','-X','POST',
    'https://api.supabase.com/v1/projects/dbtlbeymrchodloboymr/database/query',
    '-H', f'Authorization: Bearer {token}',
    '-H', 'Content-Type: application/json',
    '-d', '{"query":"SELECT proname, proargtypes::regtype[] FROM pg_proc WHERE proname = \'play_turn\'"}'
], capture_output=True, text=True, timeout=15)
print("Current functions:", r.stdout)

# Test RPC
r2 = subprocess.run(['curl','-s','-X','POST',
    'https://dbtlbeymrchodloboymr.supabase.co/rest/v1/rpc/play_turn',
    '-H', f'apikey: {anon_key}',
    '-H', f'Authorization: Bearer {anon_key}',
    '-H', 'Content-Type: application/json',
    '-d', '{"p_game_id":"TEST","p_player_id":"TEST","p_action":"DRAW_DECK","p_card_code":null,"p_discard_index":null,"p_meld_codes":null,"p_target_pid":null,"p_target_meld_idx":null,"p_expected_version":1}'
], capture_output=True, text=True, timeout=15)
print("RPC test:", r2.stdout)

# Apply schema SQL
with open('/data/.openclaw/workspace/dummy-rummy/supabase-schema-fixed.sql') as f:
    sql = f.read()

payload = json.dumps({"query": sql})
r3 = subprocess.run(['curl','-s','-X','POST',
    'https://api.supabase.com/v1/projects/dbtlbeymrchodloboymr/database/query',
    '-H', f'Authorization: Bearer {token}',
    '-H', 'Content-Type: application/json',
    '-d', payload
], capture_output=True, text=True, timeout=30)
print("Schema apply result:", r3.stdout[:100] if r3.stdout else "No output", r3.stderr[:100] if r3.stderr else "")

# Check function again
r4 = subprocess.run(['curl','-s','-X','POST',
    'https://api.supabase.com/v1/projects/dbtlbeymrchodloboymr/database/query',
    '-H', f'Authorization: Bearer {token}',
    '-H', 'Content-Type: application/json',
    '-d', '{"query":"SELECT proname, proargtypes::regtype[] FROM pg_proc WHERE proname = \'play_turn\'"}'
], capture_output=True, text=True, timeout=15)
print("After apply:", r4.stdout)
