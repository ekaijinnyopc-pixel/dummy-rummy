#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ทดสอบ flow หยิบไพ่จากกองทิ้ง v36 (client-side atomic) กับ Supabase จริง
จำลอง logic เดียวกับ game-core.js: pickDiscardClientSide() / clearPickedFlag()
เพื่อยืนยันว่า:
  1. ไพ่ไม่หาย (จำนวนไพ่คงที่ตลอด)
  2. ไพ่ที่หยิบอยู่บนมือจริง
  3. pickedFromDiscard ถูกบันทึก
  4. optimistic lock กันเขียนทับ
  5. MELD ของไพ่ที่หยิบผ่าน
  6. คืนไพ่กลับกองทิ้งได้ ไม่หาย
"""
import json, re, urllib.request, urllib.error, uuid, sys

BASE = "https://dbtlbeymrchodloboymr.supabase.co"
SRC = "/data/.openclaw/workspace/dummy-rummy/game-core.js"
KEY = re.search(r"const SUPABASE_KEY = '([^']+)'", open(SRC).read()).group(1)
H = {"apikey": KEY, "Authorization": "Bearer " + KEY,
     "Content-Type": "application/json", "Prefer": "return=representation"}
OK, FAIL = 0, 0


def req(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    h = dict(H)
    if headers:
        h.update(headers)
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
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
        OK += 1
        print(f"  ✅ {label}")
    else:
        FAIL += 1
        print(f"  ❌ {label} {extra}")


def get_room(rid):
    return req("GET", f"/rest/v1/rooms?id=eq.{rid}&select=id,game,version")[1][0]


def total_cards(g):
    n = len(g.get("deck") or [])
    for h in (g.get("hands") or {}).values():
        n += len(h)
    n += len(g.get("discardPile") or [])
    for ms in (g.get("melds") or {}).values():
        for m in ms:
            n += len(m)
    return n


def pick_client_side(rid, idx, pid):
    """จำลอง pickDiscardClientSide() ของ game-core.js"""
    row = get_room(rid)
    g = row["game"]
    row_ver = row.get("version") or 0
    ver = max(row_ver, g.get("version") or 0)
    discard = g.get("discardPile") or []
    if not discard or idx < 0 or idx >= len(discard):
        return None
    if g.get("turnPlayerId") and g["turnPlayerId"] != pid:
        return None
    if g.get("phase") and g["phase"] != "draw":
        return None
    taken = discard[idx:]
    remaining = discard[:idx]
    ng = json.loads(json.dumps(g))
    ng.setdefault("hands", {})
    ng["hands"][pid] = (ng["hands"].get(pid) or []) + taken
    ng["discardPile"] = remaining
    ng.setdefault("pickedFromDiscard", {})
    ng["pickedFromDiscard"][pid] = taken
    ng["phase"] = "action"
    ng["version"] = ver + 1
    st, res = req("PATCH", f"/rest/v1/rooms?id=eq.{rid}&version=eq.{row_ver}",
                  {"game": ng, "version": ng["version"]})
    if st != 200 or not res:
        return None
    return {"ok": True, "taken": taken, "game": ng}


def clear_pick(rid, pid):
    row = get_room(rid)
    g = row["game"]
    row_ver = row.get("version") or 0
    pfd = g.get("pickedFromDiscard") or {}
    if not pfd.get(pid):
        return True
    ng = json.loads(json.dumps(g))
    ng.setdefault("pickedFromDiscard", {})
    ng["pickedFromDiscard"][pid] = []
    ng["version"] = max(row_ver, g.get("version") or 0) + 1
    st, res = req("PATCH", f"/rest/v1/rooms?id=eq.{rid}&version=eq.{row_ver}",
                  {"game": ng, "version": ng["version"]})
    return st == 200 and bool(res)


def make_room(label, hands, discard, deck, turn=None):
    rid = "T" + uuid.uuid4().hex[:6]
    p1 = "p_test1"
    players = [{"id": p1, "name": "ทดสอบ", "isBot": False, "avatar": "T",
                "roomLevel": 1, "seat": 0}]
    game = {
        "deck": deck, "hands": hands, "discardPile": discard,
        "melds": {}, "phase": "draw", "currentPlayerId": turn or p1,
        "turnPlayerId": turn or p1, "hasFirstMeld": {}, "pickedFromDiscard": {},
        "lastDraw": None, "version": 1,
    }
    st, res = req("POST", "/rest/v1/rooms", [{
        "id": rid, "code": rid, "status": "playing", "version": 1,
        "players": players, "game": game, "totalplayers": 1,
    }])
    if st != 201:
        print(f"  ❌ สร้างห้อง {label} ไม่สำเร็จ: {st} {res}")
        return None, None
    return rid, p1


def rpc(rid, pid, action, opts, version):
    body = {"p_game_id": rid, "p_player_id": pid, "p_action": action,
            "p_expected_version": version}
    body.update(opts)
    st, res = req("POST", "/rest/v1/rpc/play_turn", body)
    return st, res


# ============================ TEST 1 ============================
print("\n[TEST 1] หยิบไพ่กลางกองทิ้ง → ไพ่ต้องอยู่บนมือ ไม่หาย")
P1 = "p_test1"
rid, pid = make_room("T1",
                     {P1: ["3♥", "4♥", "8♣", "5♥", "6♥"]},
                     ["7♣", "5♥", "9♦"],
                     ["K♠", "Q♠", "J♠", "A♣"])
if rid:
    before = get_room(rid)
    n0 = total_cards(before["game"])
    res = pick_client_side(rid, 1, pid)
    check("หยิบสำเร็จ", res is not None)
    if res:
        after = get_room(rid)
        g = after["game"]
        n1 = total_cards(g)
        check(f"จำนวนไพ่คงที่ ({n0} → {n1})", n0 == n1, f"หาย {n0-n1} ใบ")
        check("ไพ่ที่หยิบ (5♥,9♦) อยู่บนมือ",
              "5♥" in g["hands"][pid] and "9♦" in g["hands"][pid],
              f"hand={g['hands'][pid]}")
        check("ไพ่ที่อยู่ใต้ (7♣) ยังอยู่ในกองทิ้ง",
              g["discardPile"] == ["7♣"], f"pile={g['discardPile']}")
        check("pickedFromDiscard ถูกบันทึก",
              g["pickedFromDiscard"].get(pid) == ["5♥", "9♦"],
              f"pfd={g.get('pickedFromDiscard')}")
        check("phase = action", g["phase"] == "action", g.get("phase"))
        check("version เพิ่มขึ้น", after["version"] > before["version"],
              f"{before['version']} → {after['version']}")

        # MELD ไพ่ที่หยิบ → ต้องผ่าน
        st, r = rpc(rid, pid, "MELD", {"p_meld_codes": ["5♥", "6♥"]},
                    after["version"])
        print(f"     rpc MELD → {st} {str(r)[:200]}")
        check("MELD ไพ่ที่หยิบผ่าน (ไม่ตอบ CARD_NOT_IN_HAND)",
              not (isinstance(r, dict) and r.get("error") == "CARD_NOT_IN_HAND"),
              str(r)[:120])

# ============================ TEST 2 ============================
print("\n[TEST 2] optimistic lock — เขียนทับข้อมูลที่เวอร์ชันเก่าไม่ได้")
rid2, pid2 = make_room("T2", {pid: ["3♥", "4♥", "5♥"]}, ["9♦"], ["K♠"])
if rid2:
    r0 = get_room(rid2)
    res = pick_client_side(rid2, 0, pid2)
    check("หยิบครั้งแรกสำเร็จ", res is not None)
    # จำลอง client ที่อ่าน state เก่าแล้วพยายามเขียน
    stale = r0["version"]
    row = get_room(rid2)
    ng = json.loads(json.dumps(row["game"]))
    ng["hands"][pid2] = ng["hands"][pid2] + ["ZZZ"]
    st, res2 = req("PATCH", f"/rest/v1/rooms?id=eq.{rid2}&version=eq.{stale}",
                   {"game": ng, "version": stale + 1})
    check("เขียนด้วยเวอร์ชันเก่าไม่ได้ (ถูกปฏิเสธ)",
          st == 200 and len(res2) == 0, f"status={st} rows={res2}")
    g2 = get_room(rid2)["game"]
    check("ไม่มีไพ่แปลกปลอมหลุดเข้ามา", "ZZZ" not in (g2["hands"].get(pid2) or []))

# ============================ TEST 3 ============================
print("\n[TEST 3] คืนไพ่ที่หยิบกลับกองทิ้ง → ไพ่ต้องไม่หาย")
rid3, pid3 = make_room("T3", {pid: ["3♥", "4♥", "8♣"]},
                       ["7♣", "5♥", "9♦"], ["K♠", "Q♠"])
if rid3:
    b = get_room(rid3)
    n0 = total_cards(b["game"])
    res = pick_client_side(rid3, 1, pid3)
    check("หยิบสำเร็จ", res is not None)
    if res:
        taken = res["taken"]
        row = get_room(rid3)
        ng = json.loads(json.dumps(row["game"]))
        ng["hands"][pid3] = [c for c in ng["hands"][pid3] if c not in taken]
        ng["discardPile"] = ng["discardPile"] + taken
        ng["pickedFromDiscard"][pid3] = []
        ng["version"] = max(row["version"], row["game"].get("version") or 0) + 1
        st, _ = req("PATCH", f"/rest/v1/rooms?id=eq.{rid3}&version=eq.{row['version']}",
                    {"game": ng, "version": ng["version"]})
        check("คืนไพ่สำเร็จ", st == 200)
        g3 = get_room(rid3)["game"]
        n1 = total_cards(g3)
        check(f"จำนวนไพ่คงที่ ({n0} → {n1})", n0 == n1, f"หาย {n0-n1}")
        check("กองทิ้งได้ไพ่คืนกลับมา",
              set(g3["discardPile"]) == {"7♣", "5♥", "9♦"}, f"pile={g3['discardPile']}")
        check("มือกลับเป็นของเดิม",
              g3["hands"][pid3] == ["3♥", "4♥", "8♣"], f"hand={g3['hands'][pid3]}")
        check("ธงหยิบถูกล้าง", g3["pickedFromDiscard"].get(pid3) == [],
              f"pfd={g3['pickedFromDiscard']}")

# ============================ TEST 4 ============================
print("\n[TEST 4] หยิบใบบนสุดของกองทิ้ง (ไม่มีไพ่อยู่เหนือ)")
rid4, pid4 = make_room("T4", {pid: ["3♥", "4♥", "5♥"]}, ["7♣", "9♦"], ["K♠"])
if rid4:
    b = get_room(rid4)
    n0 = total_cards(b["game"])
    res = pick_client_side(rid4, 1, pid4)
    check("หยิบสำเร็จ", res is not None)
    if res:
        g4 = get_room(rid4)["game"]
        check(f"จำนวนไพ่คงที่ ({n0} → {total_cards(g4)})",
              total_cards(g4) == n0)
        check("ได้ไพ่ที่หยิบบนมือ", "9♦" in g4["hands"][pid4], f"hand={g4['hands'][pid4]}")
        check("กองทิ้งเหลือใบที่อยู่ใต้", g4["discardPile"] == ["7♣"],
              f"pile={g4['discardPile']}")

# ============================ TEST 5 ============================
print("\n[TEST 5] clearPickedFlag หลังเกิด → ปุ่มทิ้งไพ่ใช้ได้ต่อ")
rid5, pid5 = make_room("T5", {pid: ["3♥", "4♥", "5♥"]}, ["7♣", "9♦"], ["K♠"])
if rid5:
    res = pick_client_side(rid5, 1, pid5)
    check("หยิบสำเร็จ", res is not None)
    if res:
        check("clearPickedFlag ทำงาน", clear_pick(rid5, pid5))
        g5 = get_room(rid5)["game"]
        check("ธงหยิบว่างเปล่า", g5["pickedFromDiscard"].get(pid5) == [],
              f"pfd={g5['pickedFromDiscard']}")
        check("ไพ่ที่หยิบยังอยู่บนมือ (ไม่หาย)",
              "9♦" in g5["hands"][pid5], f"hand={g5['hands'][pid5]}")

# ============================ cleanup ============================
for r in [rid, rid2, rid3, rid4, rid5]:
    if r:
        req("DELETE", f"/rest/v1/rooms?id=eq.{r}")

print(f"\n{'='*50}\nผล: ผ่าน {OK} / ไม่ผ่าน {FAIL}")
sys.exit(1 if FAIL else 0)
