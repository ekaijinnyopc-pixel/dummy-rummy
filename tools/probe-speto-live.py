#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PROBE กติกาสเปโต 2.3: server คิดโทษตอนทิ้งสเปโตต่างจาก client ไหม
ใช้: python3 tools/probe-speto-live.py
- ทิ้ง Q♠ (สเปโต) เมื่อกองทิ้งมี A♠  → client บอก "ไม่โทษ" (A ติดกับ K เท่านั้น)
  → ถ้า server เก็บโทษ = บั๊ก (client ไม่เตือน แต่โดนหัก)
- ทิ้ง Q♠ เมื่อกองทิ้งมี K♠ → ทั้งคู่ต้องโทษ (ตรวจว่า probe ทำงานจริง)
- ทิ้ง 7♠ (ไม่ใช่สเปโต) → ต้องไม่มีโทษ
ลบห้องทดสอบทิ้งเสมอ
"""
import json, re, urllib.request, urllib.error, uuid, sys

BASE = "https://dbtlbeymrchodloboymr.supabase.co"
SRC = "/data/.openclaw/workspace/dummy-rummy/game-core.js"
KEY = re.search(r"const SUPABASE_KEY = '([^']+)'", open(SRC, encoding="utf-8").read()).group(1)
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}
P = "p_probe"
P2 = "p2"   # ต้องมีผู้เล่นอย่างน้อย 2 คน ไม่งั้น pending 2.3 จะหมดอายุทันที (expiresAtTurn)


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, headers=H, method=method)
    try:
        with urllib.request.urlopen(r, timeout=25) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)


def make_room(pile):
    room = "P" + uuid.uuid4().hex[:5].upper()
    g = {
        "deck": ["K♠", "J♠", "10♠", "9♠", "8♠", "7♠", "6♠", "5♠", "4♠", "3♠"],
        "hands": {P: ["Q♠", "7♠"], P2: ["3♥", "4♥"]},
        "discardPile": list(pile),
        "turnPlayerId": P, "playerOrder": [P, P2],
        "phase": "action", "status": "playing",
        "melds": {P: [], P2: []}, "scores": {P: 0, P2: 0},
        "hasFirstMeld": {P: False, P2: False},
        "headCard": pile[0], "headPoints": 50,
        "hasDiscardedThisTurn": {}, "pickedFromDiscard": {},
        "spettoPenalty": {}, "spetoPending": {}, "spettoPenaltyDone": {},
        "spettoDiscardDone": {}, "spetoOrigin": {},
        "turnSeq": 1, "deckEmpty": False, "version": 1,
    }
    players = {P: {"id": P, "name": "probe", "isBot": False, "isHost": True},
               P2: {"id": P2, "name": "p2", "isBot": False, "isHost": False}}
    s, d = req("POST", "/rest/v1/rooms", {"id": room, "code": room, "players": players,
                                          "status": "playing", "totalplayers": 2,
                                          "game": g, "version": 1})
    return room, s, d


def discard(room, card):
    s, d = req("POST", "/rest/v1/rpc/play_turn", {
        "p_game_id": room, "p_player_id": P, "p_action": "DISCARD",
        "p_card_code": card, "p_expected_version": 1})
    return s, d


rooms = []
try:
    # --- เคส 1: ทิ้ง Q♠ เมื่อกองทิ้งมี A♠ (client = ไม่โทษ) ---
    r1, s1, _ = make_room(["A♠", "9♥"])
    rooms.append(r1)
    st, res = discard(r1, "Q♠")
    gg = (res or {}).get("game") or {} if isinstance(res, dict) else {}
    pen = gg.get("spettoPenalty") or {}
    pend = gg.get("spetoPending") or {}
    ok = (res or {}).get("ok") if isinstance(res, dict) else None
    v1 = (pen or {}).get(P, 0)
    print("[1] ทิ้ง Q♠ ทั้งที่กองทิ้งมี A♠  → ok=%s โทษ=%s pending=%s" % (ok, v1, json.dumps(pend, ensure_ascii=False)))
    print("    client คาดว่า: 0 (A=14 ติดกับ K เท่านั้น → A♠ ไม่เกี่ยวกับ Q♠)")
    print("    server ให้:   %s %s" % (v1, "✅ ตรงกัน" if v1 == 0 else "❌ บั๊ก! server เก็บโทษเกินกติกา"))

    # --- เคส 2: ทิ้ง Q♠ เมื่อกองทิ้งมี K♠ (ทั้งคู่ต้องโทษ) ---
    r2, s2, _ = make_room(["K♠", "9♥"])
    rooms.append(r2)
    st, res = discard(r2, "Q♠")
    gg = (res or {}).get("game") or {} if isinstance(res, dict) else {}
    pen = gg.get("spettoPenalty") or {}
    pend = gg.get("spetoPending") or {}
    v2 = (pen or {}).get(P, 0)
    has_pend = bool(pend)
    print("[2] ทิ้ง Q♠ ทั้งที่กองทิ้งมี K♠  → โทษ=%s pending=%s %s" % (v2, json.dumps(pend, ensure_ascii=False), "✅ มี pending (ทั้งคู่โทษ)" if has_pend else "❌ ไม่มี pending — probe ไม่ทำงาน"))

    # --- เคส 3: ทิ้งไพ่ธรรมดา ---
    r3, s3, _ = make_room(["A♠", "9♥"])
    rooms.append(r3)
    st, res = discard(r3, "7♠")
    gg = (res or {}).get("game") or {} if isinstance(res, dict) else None
    pend = (gg or {}).get("spetoPending") or {}
    v3 = ((gg or {}).get("spettoPenalty") or {}).get(P, 0)
    print("[3] ทิ้ง 7♠ (ไม่ใช่สเปโต)      → โทษ=%s pending=%s %s" % (v3, json.dumps(pend, ensure_ascii=False), "✅ ถูกต้อง" if not pend else "❌ แปลก"))
finally:
    for r in rooms:
        st, _ = req("DELETE", "/rest/v1/rooms?id=eq." + r)
        print("[cleanup] ลบห้องทดสอบ %s: HTTP %s" % (r, st))
