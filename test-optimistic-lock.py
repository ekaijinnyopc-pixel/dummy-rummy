#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ทดสอบ optimistic lock pattern ที่ pickDiscardClientSide() ใช้: PATCH ... eq(version) + select"""
import json, re, urllib.request, urllib.error, uuid

BASE = "https://dbtlbeymrchodloboymr.supabase.co"
SRC = "/data/.openclaw/workspace/dummy-rummy/game-core.js"
KEY = re.search(r"const SUPABASE_KEY = '([^']+)'", open(SRC).read()).group(1)
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}


def req(method, path, body=None, extra=None):
    headers = dict(H)
    if extra:
        headers.update(extra)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=25) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


ROOM = "L" + uuid.uuid4().hex[:5].upper()
P = "p_aaa"
g = {"deck": ["K♠"], "hands": {P: ["3♥", "4♥"]}, "discardPile": ["7♣", "5♥"],
     "turnPlayerId": P, "playerOrder": [P], "phase": "draw", "status": "playing",
     "melds": {P: []}, "scores": {P: 0}, "hasFirstMeld": {P: False},
     "hasDiscardedThisTurn": {}, "pickedFromDiscard": {}, "deckEmpty": False, "version": 1}
req("POST", "/rest/v1/rooms", {"id": ROOM, "code": ROOM, "players": {P: {"id": P, "name": "P", "isBot": False, "isHost": True}},
                               "status": "playing", "totalplayers": 1, "game": g, "version": 1})

print("=== PATCH แบบมีเงื่อนไข version (เหมือน supabase-js .eq('version', v)) ===")
ng = json.loads(json.dumps(g))
ng["hands"][P] = ["3♥", "4♥", "5♥"]
ng["discardPile"] = ["7♣"]
ng["version"] = 2
s, d = req("PATCH", f"/rest/v1/rooms?id=eq.{ROOM}&version=eq.1",
           {"game": ng, "version": 2}, {"Prefer": "return=representation"})
print(f"  version ตรง (eq.1) → status={s} data={d}")
ok = s == 200 and isinstance(d, list) and len(d) == 1

print("\n=== PATCH ที่ version ไม่ตรง (ชน) → ต้องได้ empty array ไม่ error ===")
ng2 = json.loads(json.dumps(ng))
ng2["hands"][P] = ["3♥"]
ng2["version"] = 3
s2, d2 = req("PATCH", f"/rest/v1/rooms?id=eq.{ROOM}&version=eq.1",
             {"game": ng2, "version": 3}, {"Prefer": "return=representation"})
print(f"  version ไม่ตรง (eq.1) → status={s2} data={d2}")
ok2 = s2 == 200 and isinstance(d2, list) and len(d2) == 0

print("\n=== ยืนยัน state จริงหลังชน (ต้องยังเป็น version 2 / มือเดิม) ===")
s3, d3 = req("GET", f"/rest/v1/rooms?id=eq.{ROOM}&select=game,version")
row = d3[0]
print(f"  rooms.version={row['version']} game.version={row['game']['version']} hands={row['game']['hands'][P]}")
ok3 = row["version"] == 2 and row["game"]["hands"][P] == ["3♥", "4♥", "5♥"]

req("DELETE", f"/rest/v1/rooms?id=eq.{ROOM}")
print("\nผลรวม:", "ผ่านทั้งหมด ✅" if (ok and ok2 and ok3) else "มีปัญหา ❌")
