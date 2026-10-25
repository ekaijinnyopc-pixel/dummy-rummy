#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ตรวจห้องที่กำลังเล่นบน live ว่ามีห้องค้างหรือเปล่า (เปรียบเทียบ version 2 ครั้ง ห่างกัน 25 วิ)"""
import json, re, time, urllib.request

SRC = "/data/.openclaw/workspace/dummy-rummy/game-core.js"
KEY = re.search(r"const SUPABASE_KEY = '([^']+)'", open(SRC, encoding="utf-8").read()).group(1)
URL = "https://dbtlbeymrchodloboymr.supabase.co"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}


def get():
    req = urllib.request.Request(URL + "/rest/v1/rooms?select=id,status,version,game,players", headers=H)
    d = json.load(urllib.request.urlopen(req, timeout=30))
    return d if isinstance(d, list) else d.get("data", [])


a = get()
print("=== snapshot 1 ===")
for r in a:
    g = r.get("game") or {}
    print("%-8s %-8s v=%-3s turn=%-14s phase=%-7s turnSeq=%-4s players=%s" % (
        r["id"], r["status"], r.get("version"), g.get("turnPlayerId"), g.get("phase"),
        g.get("turnSeq"), ",".join(list((r.get("players") or {}).keys()))))

time.sleep(25)
b = get()
m = {r["id"]: r for r in b}
print("=== snapshot 2 (หลัง 25 วิ) ===")
stuck = []
for r in a:
    if r["status"] != "playing":
        continue
    r2 = m.get(r["id"])
    if not r2:
        continue
    g1 = r.get("game") or {}
    g2 = r2.get("game") or {}
    adv = (r2.get("version") or 0) - (r.get("version") or 0)
    t1, t2 = g1.get("turnPlayerId"), g2.get("turnPlayerId")
    print("%-8s version %s→%s (+%s) · turn %s→%s" % (
        r["id"], r.get("version"), r2.get("version"), adv, t1, t2))
    if adv == 0 and t1 == t2:
        stuck.append((r["id"], t1, g1.get("phase")))

if stuck:
    print("\n⚠️ ห้องที่ไม่ขยับ:")
    for sid, t, ph in stuck:
        print("   %s: turn=%s phase=%s (ถ้าเป็นห้องคนเล่นจริง watchdog จะเล่นแทนใน ~140 วิ)" % (sid, t, ph))
else:
    print("\n✅ ห้องที่กำลังเล่นทุกห้องขยับ (ไม่มีห้องค้าง)")
