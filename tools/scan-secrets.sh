#!/usr/bin/env bash
# =====================================================================
# 🔐 scan-secrets.sh — ตรวจว่าไฟล์ที่ track ใน git มี secret หลุดไหม
# ---------------------------------------------------------------------
# ใช้: bash tools/scan-secrets.sh
# ตรวจ:
#   · service_role key (จริงจัง — ไม่ใช่แค่คำพูดถึง)
#   · รหัสผ่าน DB / token / api key ที่ hardcode
#   · ไฟล์ credential ที่อาจถูก commit
# หมายเหตุ: anon key ของ Supabase เป็น public by design (อยู่ใน game-core.js บน browser) → ไม่ถือว่า leak
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

FILES=$(git ls-files)
echo "=========================================================="
echo " 🔐 สแกน secret ในไฟล์ที่ track ใน git ($(echo "$FILES" | wc -l) ไฟล์)"
echo "=========================================================="

found=0

# 1) service_role key จริง (JWT ที่ role=service_role)
echo "--- 1) service_role key (JWT) ---"
hit=$(echo "$FILES" | xargs grep -lE "eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}" 2>/dev/null | while read f; do
  if grep -qE "service_role" "$f" 2>/dev/null && grep -qE "eyJ[A-Za-z0-9_-]{20,}" "$f" 2>/dev/null; then echo "$f"; fi
done)
if [ -n "$hit" ]; then echo "❌ พบไฟล์ที่อาจมี service_role key:"; echo "$hit" | sed 's/^/   /'; found=1
else echo "✅ ไม่พบ"; fi

# 2) รหัสผ่าน / token hardcode
echo "--- 2) รหัสผ่าน / token ที่ hardcode ---"
hit=$(echo "$FILES" | xargs grep -nE "(PGPASSWORD=|password=|api_key=|apikey=)[\"'][^\"']{6,}[\"']" 2>/dev/null | grep -vE "PGPASSWORD=\"\\*|PW_FILE|db-password" | head -5)
if [ -n "$hit" ]; then echo "⚠️  พบ:"; echo "$hit" | sed 's/^/   /'; found=1
else echo "✅ ไม่พบ"; fi

# 3) ไฟล์ credential ที่ไม่ควรอยู่ใน repo
echo "--- 3) ไฟล์ credential ในโฟลเดอร์ ---"
hit=$(find . -maxdepth 2 \( -name "*.env" -o -name ".env*" -o -name "*credential*" -o -name "*password*" -o -name "*.pem" -o -name "*.key" \) -not -path "./.git/*" 2>/dev/null | head -5)
if [ -n "$hit" ]; then echo "⚠️  พบไฟล์ (ต้องไม่ถูก track):"; echo "$hit" | sed 's/^/   /'
  for f in $hit; do git ls-files --error-unmatch "$f" >/dev/null 2>&1 && { echo "   ❌ ถูก track อยู่: $f"; found=1; }; done
else echo "✅ ไม่พบ"; fi

# 4) ไฟล์ credential ที่อยู่นอก repo (ตำแหน่งที่ถูกต้อง)
echo "--- 4) credential นอก repo (ตำแหน่งที่ถูกต้อง) ---"
for f in /data/.supabase/access-token /data/.supabase/db-password; do
  if [ -f "$f" ]; then printf "   ✅ %s (perm %s)\n" "$f" "$(stat -c '%a' "$f")"
  else echo "   –  $f (ยังไม่มี — จะมีตอนพี่เอให้รหัสผ่าน DB)"; fi
done

echo
if [ "$found" = "1" ]; then echo "❌ พบประเด็นที่ควรตรวจ — ดูรายละเอียดข้างบน"; exit 1
else echo "✅ ไม่พบ secret ที่หลุด"; exit 0; fi
