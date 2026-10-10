import subprocess, json, re

token = open('/data/.supabase/access-token').read().strip()

# Check function signature via Management API
r = subprocess.run(['curl', '-s', '-X', 'POST',
    'https://api.supabase.com/v1/projects/dbtlbeymrchodloboymr/database/query',
    '-H', f'Authorization: Bearer {token}',
    '-H', 'Content-Type: application/json',
    '-d', '{"query":"SELECT proname, proargtypes::regtype[] FROM pg_proc WHERE proname = '\''play_turn'\''"}'],
    capture_output=True, text=True, timeout=15)
print("Function:", r.stdout)

# Get actual game from DB via Management API (avoids replica lag)
r2 = subprocess.run(['curl', '-s', '-X', 'POST',
    'https://api.supabase.com/v1/projects/dbtlbeymrchodloboymr/database/query',
    '-H', f'Authorization: Bearer {token}',
    '-H', 'Content-Type: application/json',
    '-d', '{"query":"SELECT id, (game->>'\'hands\''')::text as hands_str FROM rooms WHERE status = \'playing\' LIMIT 1"}'],
    capture_output=True, text=True, timeout=15)
print("DB hands:", r2.stdout[:400])
