#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""🔍 CLEANUP ห้องที่ค้าง (abandoned) — ตรวจห้องที่ 'คนเล่น' ไม่ขยับ + เสนอลบ

ทำไมต้องมี:
  watchdog (เล่นแทนคนที่หลุดเน็ต) อยู่ **ฝั่ง client** เท่านั้น
  → ถ้าคนเล่นปิดเบราว์เซอร์ ไม่มี client ไหน poll ห้องนั้น → ห้องค้างถาวร
  → ต้องมีการกวาดห้องทิ้งเป็นระยะ

ใช้:
  python3 tools/cleanup-abandoned-rooms.py            # แค่ดรายการ (dry-run)
  python3 tools/cleanup-abandoned-rooms.py --apply    # ลบจริง (ต้องพี่เออนุมัติ)

⚠️ ข้อควรระวังสำคัญ:
  · เกณฑ์ "ไม่ขยับ" ตรวจจาก version ไม่เปลี่ยน → **แท็บมือถือที่พับไว้ (background) ก็นับเป็นค้าง**
    เพราะ browser มือถือ throttle timer → poll หยุด → ห้องดูเหมือนค้างทั้งที่คนยังเล่นอยู่
  · ห้องของพี่เอเองอาจโผล่ในลิสต์นี้ได้ → **ห้ามลบอัตโนมัติ** ต้องให้พี่เอยืนยันก่อน
  · ห้องที่ยัง"มีคนอยู่" (มี client poll อยู่) จะขยับ version → ไม่เข้าเกณฑ์ค้าง

เกณฑ์ห้องค้าง:
  · status = 'playing'
  · ตาปัจจุบันเป็น "คน" (ไม่ใช่บอท)
  · version ไม่ขยับเลยตลอดช่วงที่สังเกต (default 90 วิ)  → คนไม่ได้เล่นจริง
  · และห้องเก่ากว่า --min-age นาที (default 30)  → ไม่ไปลบห้องที่เพิ่งเปิด
"""
import argparse, json, re, time, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta

SRC = "/data/.openclaw/workspace/dummy-rummy/game-core.js"
KEY = re.search(r"const SUPABASE_KEY = '([^']+)'", open(SRC, encoding="utf-8").read()).group(1)
URL = "https://dbtlbeymrchodloboymr.supabase.co"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}
TZ = timezone(timedelta(hours=7))


def get_rooms():
    req = urllib.request.Request(URL + "/rest/v1/rooms?select=id,status,version,created_at,game,players", headers=H)
    d = json.load(urllib.request.urlopen(req, timeout=30))
    return d if isinstance(d, list) else d.get("data", [])


def is_bot_turn(room):
    g = room.get("game") or {}
    turn = g.get("turnPlayerId")
    players = room.get("players") or {}
    return any(turn == pid for pid, p in players.items() if p.get("isBot"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="ลบจริง (ไม่ใส่ = แค่ดู)")
    ap.add_argument("--watch", type=int, default=90, help="วินาทีที่ต้องไม่ขยับ (default 90)")
    ap.add_argument("--min-age", type=int, default=30, help="อายุห้องขั้นต่ำ (นาที, default 30)")
    args = ap.parse_args()

    a = get_rooms()
    time.sleep(args.watch)
    b = {r["id"]: r for r in get_rooms()}

    now = datetime.now(TZ)
    stuck, ok_rooms = [], []
    for r in a:
        if r["status"] != "playing":
            continue
        r2 = b.get(r["id"])
        if not r2:
            continue
        created = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")).astimezone(TZ)
        age_min = int((now - created).total_seconds() // 60)
        adv = (r2.get("version") or 0) - (r.get("version") or 0)
        human_turn = not is_bot_turn(r)
        if adv == 0 and human_turn and age_min >= args.min_age:
            stuck.append((r, age_min))
        else:
            ok_rooms.append((r, age_min, adv, human_turn))

    print("=" * 62)
    print("🔍 ตรวจห้องค้างบน live (ดู %d วิ)" % args.watch)
    print("=" * 62)
    print("ห้องที่เล่นอยู่/ปกติ: %d ห้อง" % len(ok_rooms))
    for r, age, adv, human_turn in ok_rooms:
        print("   %s · อายุ %d นาที · version +%s · ตา=%s" % (
            r["id"], age, adv, "คน" if human_turn else "บอท"))

    print("\n⚠️  ห้องที่ค้าง (คนไม่ขยับ + อายุ ≥ %d นาที): %d ห้อง" % (args.min_age, len(stuck)))
    for r, age in stuck:
        g = r.get("game") or {}
        print("   %s · สร้าง %s (%d นาที) · v=%s turnSeq=%s phase=%s · ตาของ %s" % (
            r["id"], datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")).astimezone(TZ).strftime("%d/%m %H:%M"),
            age, r.get("version"), g.get("turnSeq"), g.get("phase"), g.get("turnPlayerId")))

    if not stuck:
        print("\n✅ ไม่มีห้องค้าง")
        return
    if not args.apply:
        print("\n💡 นี่คือ DRY-RUN — ยังไม่ได้ลบอะไร")
        print("   ถ้าต้องการลบจริง: python3 tools/cleanup-abandoned-rooms.py --apply")
        print("   ⚠️ เช็คก่อนว่าห้องที่จะลบไม่ใช่ห้องที่พี่เอกำลังเล่นค้างไว้")
        return

    for r, age in stuck:
        req = urllib.request.Request(URL + "/rest/v1/rooms?id=eq." + r["id"], headers=H, method="DELETE")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                print("   🗑️ ลบ %s: HTTP %s" % (r["id"], resp.status))
        except urllib.error.HTTPError as e:
            print("   ❌ ลบ %s ไม่สำเร็จ: HTTP %s" % (r["id"], e.code))


if __name__ == "__main__":
    main()
