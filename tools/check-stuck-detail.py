#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ดูรายละเอียดห้องที่ค้างบน live: อัปเดตล่าสุดเมื่อไหร่ · มี client เปิดค้างไว้ไหม"""
import json, re, urllib.request
from datetime import datetime, timezone, timedelta

SRC = "/data/.openclaw/workspace/dummy-rummy/game-core.js"
KEY = re.search(r"const SUPABASE_KEY = '([^']+)'", open(SRC, encoding="utf-8").read()).group(1)
URL = "https://dbtlbeymrchodloboymr.supabase.co"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
TZ = timezone(timedelta(hours=7))

req = urllib.request.Request(URL + "/rest/v1/rooms?select=id,status,version,updated_at,created_at,game,players&status=eq.playing", headers=H)
d = json.load(urllib.request.urlopen(req, timeout=30))
rooms = d if isinstance(d, list) else d.get("data", [])

now = datetime.now(TZ)
print("ห้องที่กำลังเล่น: %d · เวลาตอนนี้ %s" % (len(rooms), now.strftime("%Y-%m-%d %H:%M:%S")))
print()
for r in rooms:
    g = r.get("game") or {}
    up = r.get("updated_at")
    age = "?"
    if up:
        dt = datetime.fromisoformat(up.replace("Z", "+00:00")).astimezone(TZ)
        mins = int((now - dt).total_seconds() // 60)
        age = "%d นาทีที่แล้ว" % mins
    turn = g.get("turnPlayerId")
    players = r.get("players") or {}
    bots = [p for p in players.values() if p.get("isBot")]
    humans = [p for p in players.values() if not p.get("isBot")]
    print("%s  v=%s  turnSeq=%s  phase=%s" % (r["id"], r.get("version"), g.get("turnSeq"), g.get("phase")))
    print("   อัปเดตล่าสุด: %s (%s)" % (up, age))
    print("   คน: %s | บอท: %s" % (
        ", ".join("%s(%s)" % (p.get("name"), pid) for pid, p in players.items() if not p.get("isBot")),
        ", ".join(str(pid) for pid, p in players.items() if p.get("isBot"))))
    print("   ตอนนี้ตาของ: %s (%s)" % (turn, "บอท" if any(turn == b for b in bots) else "คน"))
    print("   ไพ่ในมือคน: %s" % json.dumps((g.get("hands") or {}).get(turn), ensure_ascii=False))
    print()
