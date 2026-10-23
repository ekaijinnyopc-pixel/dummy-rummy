#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ทดสอบบั๊ก v36.1: ธง pickedFromDiscard ที่ค้างหลังเกิด + ปุ่มคืนไพ่ทำไพ่ซ้ำ
จำลอง logic ใหม่ใน game-core.js:
  - myPickedCodes(): กรองเฉพาะไพ่ที่ "ยังอยู่บนมือ"
  - returnPickedCardsFor(): คืนเฉพาะไพ่ที่ยังอยู่บนมือ (ไม่คืนไพ่ที่เกิดแล้ว)
"""
import json, re, urllib.request, urllib.error, uuid, sys

BASE = "https://dbtlbeymrchodloboymr.supabase.co"
SRC = "/data/.openclaw/workspace/dummy-rummy/game-core.js"
KEY = re.search(r"const SUPABASE_KEY = '([^']+)'", open(SRC).read()).group(1)
H = {"apikey": KEY, "Authorization": "Bearer " + KEY,
     "Content-Type": "application/json", "Prefer": "return=representation"}
OK, FAIL = 0, 0


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


def check(label, cond, extra=""):
    global OK, FAIL
    if cond:
        OK += 1; print(f"  ✅ {label}")
    else:
        FAIL += 1; print(f"  ❌ {label} {extra}")


def get_room(rid):
    return req("GET", f"/rest/v1/rooms?id=eq.{rid}&select=id,game,version")[1][0]


def count_cards(g):
    n = len(g.get("deck") or [])
    for h in (g.get("hands") or {}).values():
        n += len(h)
    n += len(g.get("discardPile") or [])
    for ms in (g.get("melds") or {}).values():
        for m in ms:
            n += len(m)
    return n


def my_picked_codes(g, pid, pending=None):
    """จำลอง myPickedCodes() ใหม่ (v36.1):
       - ถ้าไพ่ที่หยิบสักใบหลุดจากมือ (เกิดไปแล้ว) → ถือว่าครบ ไม่ค้าง
       - ไม่งั้นคืนเฉพาะไพ่ที่ยังอยู่บนมือ"""
    hand = (g.get("hands") or {}).get(pid) or []
    from_game = (g.get("pickedFromDiscard") or {}).get(pid) or []
    still = [c for c in from_game if c in hand]
    if from_game and len(still) < len(from_game):
        return []
    out = list(still)
    for c in (pending or []):
        if c not in out:
            out.append(c)
    return out


def return_picked(g, pid):
    """จำลอง returnPickedCardsFor() ใหม่ (v36.1): คืนเฉพาะไพ่ที่ยังอยู่บนมือ"""
    taken = ((g.get("pickedFromDiscard") or {}).get(pid) or [])[:]
    if not taken:
        return g, False
    ng = json.loads(json.dumps(g))
    hand_now = (ng.get("hands") or {}).get(pid) or []
    to_return = [c for c in taken if c in hand_now]
    ng.setdefault("pickedFromDiscard", {})
    ng["pickedFromDiscard"][pid] = []
    if to_return:
        ng["hands"][pid] = [c for c in hand_now if c not in to_return]
        ng["discardPile"] = (ng.get("discardPile") or []) + to_return
    return ng, True


def make_room(hands, discard, deck):
    rid = "V3" + uuid.uuid4().hex[:6]
    p1 = "p_test1"
    players = [{"id": p1, "name": "ทดสอบ", "isBot": False, "avatar": "T",
                "roomLevel": 1, "seat": 0}]
    game = {"deck": deck, "hands": hands, "discardPile": discard, "melds": {},
            "phase": "draw", "currentPlayerId": p1, "turnPlayerId": p1,
            "hasFirstMeld": {}, "pickedFromDiscard": {}, "lastDraw": None,
            "version": 1}
    st, res = req("POST", "/rest/v1/rooms", [{
        "id": rid, "code": rid, "status": "playing", "version": 1,
        "players": players, "game": game, "totalplayers": 1}])
    return (rid, p1) if st == 201 else (None, None)


def patch_game(rid, ng, row_ver):
    st, res = req("PATCH", f"/rest/v1/rooms?id=eq.{rid}&version=eq.{row_ver}",
                  {"game": ng, "version": ng.get("version", row_ver + 1)})
    return st == 200 and bool(res)


P1 = "p_test1"

# ============ TEST A: หยิบ → เกิด → server ไม่ล้างธง → ผู้เล่นต้องไม่ค้าง ============
print("\n[A] หยิบ → เกิด → server ไม่ล้าง pickedFromDiscard → ต้องไม่ค้าง")
rid, pid = make_room({P1: ["5♥", "6♥", "8♣"]}, ["7♥", "4♠"], ["K♠", "Q♠"])
if rid:
    g = get_room(rid)["game"]
    # จำลอง client-side pick
    g["hands"][pid] = g["hands"][pid] + ["7♥", "4♠"]
    g["discardPile"] = []
    g["pickedFromDiscard"][pid] = ["7♥", "4♠"]
    g["phase"] = "action"
    g["version"] = 2
    patch_game(rid, g, 1)
    # เกิดผ่าน server (server ไม่ล้าง pfd)
    row = get_room(rid)
    st, res = req("POST", "/rest/v1/rpc/play_turn", {
        "p_game_id": rid, "p_player_id": pid, "p_action": "MELD",
        "p_meld_codes": ["5♥", "6♥", "7♥"], "p_expected_version": row["version"]})
    g = get_room(rid)["game"]
    check("MELD ผ่าน", res and res.get("ok"), str(res)[:100])
    check("server ไม่ล้างธง (ยืนยันปัญหาที่พบ)", len(g["pickedFromDiscard"].get(pid) or []) > 0,
          f"pfd={g.get('pickedFromDiscard')}")
    # logic ใหม่: กรองเฉพาะไพ่ที่ยังอยู่บนมือ
    mp = my_picked_codes(g, pid)
    check("myPickedCodes() = [] (ไม่ค้าง ไม่ล็อกผู้เล่น)", mp == [], f"ได้ {mp}")
    check("ไพ่ที่เกิดแล้วไม่อยู่บนมือ", "7♥" not in g["hands"][pid], f"hand={g['hands'][pid]}")
    req("DELETE", f"/rest/v1/rooms?id=eq.{rid}")

# ============ TEST B: ปุ่มคืนไพ่หลังเกิดแล้ว → ห้ามเกิดไพ่ซ้ำ ============
print("\n[B] กดคืนไพ่ทั้งที่ไพ่ถูกเกิดไปแล้ว → ต้องไม่มีไพ่ซ้ำ")
rid, pid = make_room({P1: ["5♥", "6♥", "8♣"]}, ["7♥", "4♠"], ["K♠", "Q♠"])
if rid:
    g = get_room(rid)["game"]
    g["hands"][pid] = g["hands"][pid] + ["7♥", "4♠"]
    g["discardPile"] = []
    g["pickedFromDiscard"][pid] = ["7♥", "4♠"]
    g["phase"] = "action"
    g["version"] = 2
    patch_game(rid, g, 1)
    row = get_room(rid)
    req("POST", "/rest/v1/rpc/play_turn", {
        "p_game_id": rid, "p_player_id": pid, "p_action": "MELD",
        "p_meld_codes": ["5♥", "6♥", "7♥"], "p_expected_version": row["version"]})
    g = get_room(rid)["game"]
    n_before = count_cards(g)
    # ผู้เล่นกดคืนไพ่ (ธงยังค้างใน DB)
    ng, changed = return_picked(g, pid)
    ng["version"] = g["version"] + 1
    patch_game(rid, ng, get_room(rid)["version"])
    g2 = get_room(rid)["game"]
    n_after = count_cards(g2)
    check("จำนวนไพ่ไม่เพิ่ม (ไม่มีไพ่ซ้ำ)", n_after == n_before, f"{n_before} → {n_after}")
    check("ไพ่ที่เกิดแล้วไม่กลับมาอยู่กองทิ้ง", "7♥" not in g2["discardPile"],
          f"pile={g2['discardPile']}")
    check("ไพ่ที่ยังอยู่บนมือถูกคืนกองทิ้ง", g2["discardPile"] == ["4♠"], f"pile={g2['discardPile']}")
    check("ธงหยิบถูกล้าง", g2["pickedFromDiscard"].get(pid) == [], f"pfd={g2['pickedFromDiscard']}")
    check("มือถูกต้อง", g2["hands"][pid] == ["8♣"], f"hand={g2['hands'][pid]}")
    req("DELETE", f"/rest/v1/rooms?id=eq.{rid}")

# ============ TEST C: กรณีปกติ หยิบแล้วยังไม่เกิด → คืนไพ่ได้ครบ ============
print("\n[C] หยิบแล้วยังไม่เกิด → กดคืนไพ่ → ไพ่ครบ ไม่หาย")
rid, pid = make_room({P1: ["5♥", "6♥", "8♣"]}, ["7♥", "4♠", "2♣"], ["K♠", "Q♠", "J♠"])
if rid:
    g = get_room(rid)["game"]
    g["hands"][pid] = g["hands"][pid] + ["7♥", "4♠", "2♣"]
    g["discardPile"] = []
    g["pickedFromDiscard"][pid] = ["7♥", "4♠", "2♣"]
    g["phase"] = "action"
    g["version"] = 2
    patch_game(rid, g, 1)
    g = get_room(rid)["game"]
    n_before = count_cards(g)
    ng, _ = return_picked(g, pid)
    ng["version"] = g["version"] + 1
    patch_game(rid, ng, get_room(rid)["version"])
    g2 = get_room(rid)["game"]
    check("จำนวนไพ่คงที่", count_cards(g2) == n_before, f"{n_before} → {count_cards(g2)}")
    check("กองทิ้งได้ไพ่คืนครบ", g2["discardPile"] == ["7♥", "4♠", "2♣"], f"pile={g2['discardPile']}")
    check("มือกลับเป็นของเดิม", g2["hands"][pid] == ["5♥", "6♥", "8♣"], f"hand={g2['hands'][pid]}")
    check("ธงหยิบว่าง", g2["pickedFromDiscard"].get(pid) == [])
    req("DELETE", f"/rest/v1/rooms?id=eq.{rid}")

print(f"\n{'='*50}\nผล: ผ่าน {OK} / ไม่ผ่าน {FAIL}")
sys.exit(1 if FAIL else 0)
