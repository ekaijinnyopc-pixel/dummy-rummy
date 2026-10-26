#!/usr/bin/env bash
# =====================================================================
# 🚀 apply-patch-live.sh — รัน SQL patch บน Supabase live อัตโนมัติ (ถ้ามีรหัสผ่าน DB)
# ---------------------------------------------------------------------
# ปกติพี่เอรันเองใน SQL Editor ได้ (วาง APPLY-ALL-2026-10-25.sql → Run)
# สคริปต์นี้มีไว้สำหรับกรณีอยากให้จินรันให้ — ต้องมีรหัสผ่าน DB
#
# 🔐 รหัสผ่านอ่านจากไฟล์ (ไม่อยู่ใน git, permission 600):
#    /data/.supabase/db-password
#    สร้างด้วย:  install -m 600 /dev/null /data/.supabase/db-password
#                 printf '%s' 'รหัสผ่านของคุณ' > /data/.supabase/db-password
#
# ⚙️ ตัวแปร (ถ้าไม่ใช่ค่าเริ่มต้น):
#    PROJECT_REF   = dbtlbeymrchodloboymr
#    DB_REGION     = ap-southeast-2
#    POOLER_HOST   = aws-0-ap-southeast-2.pooler.supabase.com
#    DB_NAME       = postgres
#    PW_FILE       = /data/.supabase/db-password
#
# วิธีใช้:
#    bash tools/apply-patch-live.sh          # dry-run → แสดงว่าจะทำอะไร
#    bash tools/apply-patch-live.sh --apply  # รันจริง
# =====================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

PROJECT_REF="${PROJECT_REF:-dbtlbeymrchodloboymr}"
DB_REGION="${DB_REGION:-ap-southeast-2}"
POOLER_HOST="${POOLER_HOST:-aws-0-ap-southeast-2.pooler.supabase.com}"
DB_NAME="${DB_NAME:-postgres}"
PW_FILE="${PW_FILE:-/data/.supabase/db-password}"

APPLY_SQL="$ROOT/APPLY-ALL-2026-10-25.sql"
VERIFY_SQL="$ROOT/tools/verify-live-sql.sql"
APPLY="--apply"

[ "${1:-}" = "--apply" ] || APPLY=""

echo "=========================================================="
echo " 🚀 apply-patch-live — Dummy Rummy"
echo "=========================================================="
echo "  project   : $PROJECT_REF"
echo "  region    : $DB_REGION ($POOLER_HOST)"
echo "  patch file: $(basename "$APPLY_SQL") ($(wc -l < "$APPLY_SQL") บรรทัด)"
echo "  verify    : $(basename "$VERIFY_SQL")"
echo "  mode      : ${APPLY:-dry-run (ใส่ --apply เพื่อรันจริง)}"
echo

# --- ตรวจไฟล์ ---
for f in "$APPLY_SQL" "$VERIFY_SQL"; do
  [ -f "$f" ] || { echo "❌ ไม่พบไฟล์: $f"; exit 1; }
done

# --- ตรวจรหัสผ่าน ---
if [ ! -f "$PW_FILE" ]; then
  echo "❌ ไม่พบไฟล์รหัสผ่าน: $PW_FILE"
  echo "   สร้างด้วย:  install -m 600 /dev/null $PW_FILE"
  echo "               printf '%s' 'รหัสผ่าน DB' > $PW_FILE"
  echo "   (หรือให้พี่เอรันเองใน Supabase SQL Editor แทน — ไม่ต้องรีบ)"
  exit 1
fi
PW="$(cat "$PW_FILE")"
[ -n "$PW" ] || { echo "❌ ไฟล์รหัสผ่านว่างเปล่า"; exit 1; }

# PSQL_CONN ใช้ทดสอบกับ DB อื่นได้ (default = pooler ของโปรเจกต์)
CONN="${PSQL_CONN:-host=$POOLER_HOST port=5432 user=postgres.$PROJECT_REF dbname=$DB_NAME sslmode=require connect_timeout=10}"

echo "--- เช็กการเชื่อมต่อ ---"
if ! OUT=$(PGPASSWORD="$PW" psql "$CONN" -tAc "SELECT 'CONNECT_OK';" 2>&1 | head -2); then
  echo "❌ เชื่อมต่อไม่ได้:"
  echo "$OUT" | sed 's/^/   /'
  echo "   ตรวจ: รหัสผ่านถูกไหม · region ถูกไหม (ลอง DB_REGION=ap-southeast-1 ฯลฯ)"
  exit 1
fi
if ! echo "$OUT" | grep -q CONNECT_OK; then
  echo "❌ เชื่อมต่อไม่สำเร็จ: $OUT"
  exit 1
fi
echo "✅ เชื่อมต่อสำเร็จ"

# --- แสดงสถานะก่อน patch ---
echo
echo "--- สถานะก่อน patch ---"
PGPASSWORD="$PW" psql "$CONN" -tAc "
SELECT 'A_num=' || rummy_rank_num('A', false)
    || ' adj(A,Q)=' || rummy_adjacent_rank('A','Q')
    || ' is_run(A-2-3)=' || rummy_is_run(ARRAY['A♥','2♥','3♥'])
    || ' must_pick_guard=' || (position('MUST_PICK_FIRST' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0)
    || ' evermeld_guard=' || (position('everMeld' in pg_get_functiondef('play_turn(text,text,text,text,integer,text,text,integer,integer)'::regprocedure)) > 0);
" 2>&1 | sed 's/^/   /'

if [ -z "$APPLY" ]; then
  echo
  echo "💡 DRY-RUN — ยังไม่ได้รัน (ใส่ --apply เพื่อรันจริง)"
  exit 0
fi

# --- รัน patch ---
echo
echo "--- กำลังรัน patch ---"
if PGPASSWORD="$PW" psql "$CONN" -v ON_ERROR_STOP=1 -f "$APPLY_SQL" > /tmp/apply-live.out 2>&1; then
  echo "✅ patch รันสำเร็จ (ไม่มี error)"
else
  echo "❌ patch มี error — ดู /tmp/apply-live.out"
  tail -20 /tmp/apply-live.out | sed 's/^/   /'
  echo "   ⚠️ ถ้า error กลางคัน ฟังก์ชันอาจอยู่ในสถานะครึ่ง ๆ — ส่งผลมาให้จินดูค่ะ"
  exit 1
fi

# --- verify ---
echo
echo "--- verify ---"
PGPASSWORD="$PW" psql "$CONN" -f "$VERIFY_SQL" 2>&1 | sed 's/^/   /'

echo
echo "✅ เสร็จแล้ว — ค่าที่คาด: A=14 · adj(A,Q)=false · adj(A,K)=true · guard ครบ 4 · flags=0"
echo "   ตรวจเพิ่ม: python3 tools/probe-v55-live.py  → ต้องได้ round_scores = 280"
