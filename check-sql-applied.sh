#!/bin/sh
# เช็คว่า SQL fix ถูก apply แล้วหรือยัง (column winner = สัญญาณว่า S3 ถูกรัน)
cd /data/.openclaw/workspace/dummy-rummy || exit 1
KEY=$(grep -oE "SUPABASE_KEY[[:space:]]*=[[:space:]]*'[^']+'" game-core.js | head -1 | sed -E "s/.*'([^']+)'.*/\1/")
if [ -z "$KEY" ]; then echo "KEY_NOT_FOUND"; exit 1; fi
echo -n "winner column: "
curl -s --max-time 20 "https://dbtlbeymrchodloboymr.supabase.co/rest/v1/rooms?select=winner&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" | head -c 160
echo
