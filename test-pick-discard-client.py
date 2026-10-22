#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ทดสอบ flow ใหม่ (FIX v36): หยิบไพ่จากกองทิ้งแบบ atomic ฝั่ง client
จำลอง logic เดียวกับ pickDiscardClientSide() ใน game-core.js
แล้วเรียก play_turn('MELD') ของ server จริง เพื่อยืนยันว่า:
  1) ไพ่ที่หยิบเข้ามือจริง (ไม่หาย)
  2) ไพ่ที่เหลืออยู่กองทิ้งครบ (ไม่หาย)
  3) จำนวนไพ่รวมคงที่
  4) เกิด (MELD) ผ่าน และ pickedFromDiscard ถูกล้าง
  5) version ตรงกัน
"""
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


def rpc(action, pid, **kw):
    payload = {
        "p_game_id": ROOM, "p_player_id": pid, "p_action": action,
        "p_card_code": kw.get("cardCode"), "p_discard_index": kw.get("discardIndex"),
        "p_meld_codes": kw.get("meldCodes"), "p_target_pid": kw.get("targetPid"),
        "p_target_meld_idx": kw.get("targetMeldIdx"),
        "p_expected_version": kw.get("version", 1),
    }
    return req("POST", "/rest/v1/rpc/play_turn", payload)


def get_room():
    s, d = req("GET", f"/rest/v1/rooms?id=eq.{ROOM}&select=game,version")
    return d[0] if d else None


def pick_client_side(idx, pid):
    """จำลอง pickDiscardClientSide()"""
    row = get_room()
    g = row["game"]
    row_ver = row["version"] or 0
    ver = max(row_ver, g.get("version", 0))
    discard = g.get("discardPile", [])
    taken = discard[idx:]
    remaining = discard[:idx]
    ng = json.loads(json.dumps(g))
    ng["hands"][pid] = ng["hands"].get(pid, []) + taken
    ng["discardPile"] = remaining
    ng.setdefault("pickedFromDiscard", {})[pid] = taken
    ng["phase"] = "action"
    ng["version"] = ver + 1
    s, d = req("PATCH", f"/rest/v1/rooms?id=eq.{ROOM}",
               {"game": ng, "version": ng["version"]},
               {"Prefer": "return=representation"})
    # optimistic lock จำลอง: ตรวจว่า version เดิมยังตรง (server จะปฏิเสธถ้าชน)
    cur = get_room()
    if cur["version"] != ng["version"]:
        return None, cur
    return {"taken": taken, "remaining": remaining, "game": ng, "version": ng["version"]}, cur


def check(label, cond, extra=""):
    print(("  ✅ " if cond else "  ❌ ") + label + ((" → " + str(extra)) if extra else ""))
    return cond


ok_all = True
ROOM = "X" + uuid.uuid4().hex[:5].upper()
P1 = "p_aaa"

game = {
    "deck": ["K♠", "Q♠", "J♠"],
    "hands": {P1: ["3♥", "4♥", "8♣"]},
    "discardPile": ["7♣", "5♥", "9♦"],
    "turnPlayerId": P1, "playerOrder": [P1],
    "phase": "draw", "status": "playing",
    "melds": {P1: []}, "scores": {P1: 0},
    "hasFirstMeld": {P1: False},
    "hasDiscardedThisTurn": {}, "pickedFromDiscard": {},
    "deckEmpty": False, "version": 1,
}
players = {P1: {"id": P1, "name": "P1", "isBot": False, "isHost": True}}
s, d = req("POST", "/rest/v1/rooms", {"id": ROOM, "code": ROOM, "players": players,
                                      "status": "playing", "totalplayers": 1,
                                      "game": game, "version": 1})
print(f"[setup] room {ROOM}  status={s}")

total_before = len(game["hands"][P1]) + len(game["discardPile"]) + len(game["deck"])
print(f"  มือเริ่มต้น  : {game['hands'][P1]}")
print(f"  กองทิ้งเริ่ม : {game['discardPile']}")
print(f"  ไพ่รวม      : {total_before}")

print("\n=== หยิบใบที่ index 1 (5♥) จากกองทิ้ง (แบบ client-side atomic) ===")
res, cur = pick_client_side(1, P1)
if not res:
    print("  ❌ หยิบไม่สำเร็จ"); ok_all = False
else:
    print(f"  หยิบได้      : {res['taken']}")
    print(f"  กองทิ้งเหลือ  : {res['remaining']}")
    print(f"  มือใหม่      : {res['game']['hands'][P1]}")
    ok_all &= check("ไพ่ที่หยิบ (5♥, 9♦) อยู่บนมือ",
                    all(c in res["game"]["hands"][P1] for c in ["5♥", "9♦"]))
    ok_all &= check("กองทิ้งเหลือ 7♣ ครบ (ไม่หาย)", res["remaining"] == ["7♣"], res["remaining"])
    ok_all &= check("ไพ่รวมคงที่", len(res["game"]["hands"][P1]) + len(res["game"]["discardPile"]) + len(res["game"]["deck"]) == total_before)
    ok_all &= check("pickedFromDiscard ถูกบันทึก", res["game"]["pickedFromDiscard"].get(P1) == ["5♥", "9♦"])
    ok_all &= check("phase = action", res["game"]["phase"] == "action")
    ok_all &= check("version sync (rooms == game)", cur["version"] == res["game"]["version"], f'{cur["version"]} vs {res["game"]["version"]}')

    print("\n=== เกิด (MELD) ไพ่ที่หยิบ: 3♥ 4♥ 5♥ ===")
    s, d = rpc("MELD", P1, meldCodes=["3♥", "4♥", "5♥"], version=res["version"])
    print(f"  server: {json.dumps(d, ensure_ascii=False)[:300]}")
    ok_all &= check("MELD สำเร็จ", bool(d and d.get("ok")), d.get("error") if d else None)
    if d and d.get("ok"):
        g2 = d["game"]
        print(f"  มือหลังเกิด : {g2['hands'][P1]}")
        print(f"  melds        : {g2.get('melds')}")
        ok_all &= check("ไพ่ที่เกิดถูกลบจากมือ", not any(c in g2["hands"][P1] for c in ["3♥", "4♥", "5♥"]))
        ok_all &= check("9♦ (ไพ่ที่หยิบแต่ไม่ได้เกิด) ยังอยู่บนมือ", "9♦" in g2["hands"][P1], g2["hands"][P1])
        ok_all &= check("กองทิ้งยังมี 7♣", g2["discardPile"] == ["7♣"], g2["discardPile"])
        ok_all &= check("hasFirstMeld ตั้งแล้ว", g2.get("hasFirstMeld", {}).get(P1) is True)

        print("\n=== ทิ้งไพ่ (DISCARD) ต่อ ===")
        s, d = rpc("DISCARD", P1, cardCode="8♣", version=g2["version"])
        print(f"  server: {json.dumps(d, ensure_ascii=False)[:300]}")
        ok_all &= check("DISCARD สำเร็จ", bool(d and d.get("ok")), d.get("error") if d else None)
        if d and d.get("ok"):
            g3 = d["game"]
            print(f"  มือหลังทิ้ง  : {g3['hands'][P1]}")
            print(f"  กองทิ้ง      : {g3['discardPile']}")
            ok_all &= check("กองทิ้งมีครบ 7♣ + 8♣", sorted(g3["discardPile"]) == sorted(["7♣", "8♣"]), g3["discardPile"])
            meld_count = sum(len(m) for m in g3.get("melds", {}).get(P1, []))
            ok_all &= check("ไพ่รวมยังคงที่ (นับรวมไพ่ที่เกิดแล้ว)",
                            len(g3["hands"][P1]) + len(g3["discardPile"]) + len(g3["deck"]) + meld_count == total_before,
                            f'มือ{len(g3["hands"][P1])} + กองทิ้ง{len(g3["discardPile"])} + deck{len(g3["deck"])} + melds{meld_count}')
            ok_all &= check("9♦ ไม่หาย (ยังบนมือ)", "9♦" in g3["hands"][P1])

print("\n=== สรุป ===")
print("  ผลรวม: " + ("ผ่านทั้งหมด ✅" if ok_all else "มีข้อผิดพลาด ❌"))

# cleanup
req("DELETE", f"/rest/v1/rooms?id=eq.{ROOM}")
