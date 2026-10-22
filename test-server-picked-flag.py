#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""เช็คพฤติกรรม server ที่ deploy: pickedFromDiscard หลัง MELD + DISCARD ที่ยังมีไพ่หยิบ"""
import json, re, urllib.request, urllib.error, uuid

BASE = "https://dbtlbeymrchodloboymr.supabase.co"
SRC = "/data/.openclaw/workspace/dummy-rummy/game-core.js"
KEY = re.search(r"const SUPABASE_KEY = '([^']+)'", open(SRC).read()).group(1)
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, headers=H, method=method)
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


def rpc(room, action, pid, **kw):
    payload = {
        "p_game_id": room, "p_player_id": pid, "p_action": action,
        "p_card_code": kw.get("cardCode"), "p_discard_index": kw.get("discardIndex"),
        "p_meld_codes": kw.get("meldCodes"), "p_target_pid": kw.get("targetPid"),
        "p_target_meld_idx": kw.get("targetMeldIdx"),
        "p_expected_version": kw.get("version", 1),
    }
    return req("POST", "/rest/v1/rpc/play_turn", payload)


def setup(room, game, players):
    req("POST", "/rest/v1/rooms", {"id": room, "code": room, "players": players,
                                   "status": "playing", "totalplayers": len(players),
                                   "game": game, "version": game.get("version", 1)})


def get(room):
    s, d = req("GET", f"/rest/v1/rooms?id=eq.{room}&select=game,version")
    return d[0] if d else None


# --- เคส 1: MELD แล้ว pickedFromDiscard ถูกล้างไหม? ---
R1 = "Y" + uuid.uuid4().hex[:5].upper()
P = "p_aaa"
g = {
    "deck": ["K♠", "Q♠", "J♠"],
    "hands": {P: ["3♥", "4♥", "8♣", "5♥"]},
    "discardPile": ["7♣", "9♦"],
    "turnPlayerId": P, "playerOrder": [P],
    "phase": "action", "status": "playing",
    "melds": {P: []}, "scores": {P: 0},
    "hasFirstMeld": {P: False},
    "hasDiscardedThisTurn": {}, "pickedFromDiscard": {P: ["5♥"]},
    "deckEmpty": False, "version": 1,
}
setup(R1, g, {P: {"id": P, "name": "P1", "isBot": False, "isHost": True}})
print("=== เคส 1: MELD แล้ว server ล้าง pickedFromDiscard ไหม? ===")
s, d = rpc(R1, "MELD", P, meldCodes=["3♥", "4♥", "5♥"], version=1)
if d and d.get("ok"):
    print("  pickedFromDiscard หลัง MELD:", d["game"].get("pickedFromDiscard"))
    print("  →", "✅ server ล้างเอง" if not d["game"].get("pickedFromDiscard", {}).get(P)
          else "⚠️ server ไม่ล้าง (client ต้องล้างเอง — โค้ดเราทำแล้ว)")
    v2 = d["game"]["version"]
    print("\n=== เคส 2: DISCARD ทั้งที่ยังมี pickedFromDiscard (server บล็อกไหม?) ===")
    s2, d2 = rpc(R1, "DISCARD", P, cardCode="8♣", version=v2)
    print("  ผล:", json.dumps(d2, ensure_ascii=False)[:220])
else:
    print("  MELD ไม่สำเร็จ:", d)

# --- เคส 3: DISCARD ทั้งที่ pickedFromDiscard ยังมีค่า (ไม่ผ่าน MELD) ---
R3 = "Z" + uuid.uuid4().hex[:5].upper()
g3 = json.loads(json.dumps(g))
g3["hands"][P] = ["3♥", "4♥", "8♣", "5♥"]
g3["pickedFromDiscard"] = {P: ["5♥"]}
g3["version"] = 1
setup(R3, g3, {P: {"id": P, "name": "P1", "isBot": False, "isHost": True}})
print("\n=== เคส 3: DISCARD โดยยังมีไพ่ที่หยิบค้าง (server บล็อกไหม?) ===")
s3, d3 = rpc(R3, "DISCARD", P, cardCode="8♣", version=1)
print("  ผล:", json.dumps(d3, ensure_ascii=False)[:260])
if d3 and d3.get("ok"):
    print("  → server ไม่บล็อก (กติกา 'ต้องเกิดก่อนทิ้ง' บังคับฝั่ง client เท่านั้น — ซึ่งเราทำไว้)")

req("DELETE", f"/rest/v1/rooms?id=eq.{R1}")
req("DELETE", f"/rest/v1/rooms?id=eq.{R3}")
