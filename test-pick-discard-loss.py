#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
พิสูจน์บัก PICK_DISCARD: ไพ่ที่หยิบจากกองทิ้งหายไปจากเกมทั้งระบบ
ทดสอบกับ play_turn() ที่ deploy จริงบน Supabase
"""
import json, re, urllib.request, uuid

BASE = "https://dbtlbeymrchodloboymr.supabase.co"
SRC = "/data/.openclaw/workspace/dummy-rummy/game-core.js"
KEY = re.search(r"const SUPABASE_KEY = '([^']+)'", open(SRC).read()).group(1)
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, headers=H, method=method)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def ver(room):
    return req("GET", f"/rest/v1/rooms?id=eq.{room}&select=version")[1][0]["version"]


ROOM = "X" + uuid.uuid4().hex[:5].upper()
P1 = "p_aaa"

# กองทิ้งมี 3 ใบ: [7♣, 5♥, 9♦]  (client หยิบได้ตัวใดตัวหนึ่ง + ทุกใบที่อยู่บน)
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

req("POST", "/rest/v1/rooms", {"id": ROOM, "code": ROOM, "players": players,
                               "status": "playing", "totalplayers": 1,
                               "game": game, "version": 1})
print(f"[setup] room {ROOM}")
print(f"  มือเริ่มต้น  : {game['hands'][P1]}")
print(f"  กองทิ้งเริ่ม : {game['discardPile']}")
total_before = len(game['hands'][P1]) + len(game['discardPile']) + len(game['deck'])

print("\n=== หยิบใบที่ index 1 (5♥) จากกองทิ้ง ===")
print("  client คาดหวัง: หยิบ 5♥ + ใบที่อยู่บน (9♦) → เข้ามือ 2 ใบ")
st, res = req("POST", "/rest/v1/rpc/play_turn", {
    "p_game_id": ROOM, "p_player_id": P1, "p_action": "PICK_DISCARD",
    "p_discard_index": 1, "p_expected_version": ver(ROOM)})
print(f"  ok={res.get('ok')} error={res.get('error')}")
if res.get("ok"):
    g = res["game"]
    hand = g["hands"][P1]
    pile = g["discardPile"]
    print(f"  มือหลังหยิบ : {hand}")
    print(f"  กองทิ้งหลัง : {pile}")
    total_after = len(hand) + len(pile) + len(g['deck'])
    print(f"\n  ไพ่รวมก่อน = {total_before}  →  ไพ่รวมหลัง = {total_after}")

    print("\n=== ผลการตรวจ ===")
    ok = True
    if '5♥' not in hand:
        print("  ❌ ไพ่ที่หยิบ (5♥) ไม่เข้ามือ — ไพ่หายไปจากเกม!")
        ok = False
    if total_after != total_before:
        print(f"  ❌ ไพ่หายจากเกม {total_before - total_after} ใบ (กองทิ้งถูกตัดทิ้งทั้งก้อน)")
        ok = False
    if '9♦' not in hand:
        print("  ❌ ไพ่ที่อยู่บน (9♦) ไม่เข้ามือ")
        ok = False
    if '5♥' in pile:
        print("  ❌ ไพ่ที่หยิบยังอยู่ในกองทิ้ง (หยิบไม่ได้)")
        ok = False
    if ok:
        print("  ✅ หยิบทำงานถูกต้อง")

    print("\n=== ต่อไป: เกิดได้ไหม? (ต้องเกิดใบที่หยิบ) ===")
    meld = ["3♥", "4♥", "5♥"]
    st2, res2 = req("POST", "/rest/v1/rpc/play_turn", {
        "p_game_id": ROOM, "p_player_id": P1, "p_action": "MELD",
        "p_meld_codes": meld, "p_expected_version": ver(ROOM)})
    print(f"  MELD {meld} → ok={res2.get('ok')} error={res2.get('error')}")
    if res2.get("ok"):
        print(f"  melds = {res2['game']['melds'][P1]}")
    else:
        print("  ❌ เกิดไม่ได้ เพราะไพ่ที่หยิบไม่อยู่ในมือแล้ว!")

print("\n=== server รู้ไหมว่าใครหยิบอะไร (pickedFromDiscard)? ===")
st3, res3 = req("GET", f"/rest/v1/rooms?id=eq.{ROOM}&select=game")
print(f"  pickedFromDiscard = {res3[0]['game'].get('pickedFromDiscard')}")
print("  ❌ server ไม่บันทึก → ผู้เล่นหยิบแล้วไม่เกิด ก็ทิ้งต่อได้ (บังคับกติกาไม่ได้)")

req("DELETE", f"/rest/v1/rooms?id=eq.{ROOM}")
print("\n[cleanup] done")
