#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""เช็คว่า SQL fix ของ dummy-rummy ถูก apply แล้วหรือยัง"""
import json, re, urllib.request

SRC = "/data/.openclaw/workspace/dummy-rummy/game-core.js"
KEY = re.search(r"SUPABASE_KEY\s*=\s*'([^']+)'", open(SRC, encoding="utf-8").read()).group(1)
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
BASE = "https://dbtlbeymrchodloboymr.supabase.co"

def get(path):
    r = urllib.request.Request(BASE + path, headers=H)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)

st, body = get("/rest/v1/rooms?select=winner,totalScores&limit=1")
if st == 200:
    print("✅ ALTER TABLE rooms ADD winner/totalScores → อยู่แล้ว (SQL fix ถูก apply)")
    print("   sample:", body[:200])
else:
    print("❌ ยังไม่มี column winner/totalScores → SQL fix ยังไม่ถูก apply")
    print("   ", body[:160])

st2, body2 = get("/rest/v1/rooms?select=game&limit=3")
if st2 == 200:
    rooms = json.loads(body2)
    for r in rooms:
        g = r.get("game") or {}
        if g.get("spettoPenalty") is not None or g.get("roundScores") is not None or g.get("pickedFromDiscard") is not None:
            print("   🔎 game JSONB มี field ใหม่แล้ว:", list(g.keys())[:12])
            break
    else:
        print("   (ยังไม่เห็น field ใหม่ใน game JSONB ของห้องที่มีอยู่)")
