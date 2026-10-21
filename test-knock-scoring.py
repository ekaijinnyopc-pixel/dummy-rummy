#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ทดสอบ KNOCK scoring + สเปโต (2♣/Q♠) บน server จริง"""
import json, re, urllib.request, uuid

BASE = "https://dbtlbeymrchodloboymr.supabase.co"
SRC = "/data/.openclaw/workspace/dummy-rummy/game-core.js"
KEY = re.search(r"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_.-]+", open(SRC).read()).group(0)
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


ROOM = "K" + uuid.uuid4().hex[:5].upper()
P1, P2 = "p_aaa", "p_bbb"

# P1 เกิดไปแล้ว (มีมอลด์ 3 ใบ) และเหลือมือว่าง → น็อค
# P2 ไม่ได้เกิด เหลือมือ 3 ใบมีแต้ม (A♠=15, K♥=10, 2♣=สเปโต=50)
game = {
    "deck": ["Q♣"], "hands": {P1: [], P2: ["A♠", "K♥", "2♣"]},
    "discardPile": ["3♣"], "turnPlayerId": P1, "playerOrder": [P1, P2],
    "phase": "action", "status": "playing",
    "melds": {P1: [["3♥", "4♥", "5♥"]], P2: []},
    "scores": {P1: 0, P2: 0},
    "hasFirstMeld": {P1: True, P2: False},
    "hasDiscardedThisTurn": {}, "pickedFromDiscard": {}, "deckEmpty": False,
    "version": 1, "headCard": "3♣", "headPoints": 50,
}
players = {P1: {"id": P1, "name": "P1", "isBot": False, "isHost": True},
           P2: {"id": P2, "name": "P2", "isBot": True, "isHost": False}}

st, res = req("POST", "/rest/v1/rooms", {"id": ROOM, "code": ROOM, "players": players,
                                         "status": "playing", "totalplayers": 2,
                                         "game": game, "version": 1})
print(f"[setup] {st}")

print("\n=== TEST K1: KNOCK — server คำนวณแต้มยังไง? ===")
st, res = req("POST", "/rest/v1/rpc/play_turn", {
    "p_game_id": ROOM, "p_player_id": P1, "p_action": "KNOCK",
    "p_expected_version": ver(ROOM)})
print(f"  ok={res.get('ok')} error={res.get('error')}")
if res.get("ok"):
    rs = res.get("round_scores") or {}
    print(f"  round_scores จาก server: {rs}")
    st2, room = req("GET", f"/rest/v1/rooms?id=eq.{ROOM}&select=status,game")
    print(f"  room.status = {room[0]['status']}")
    print(f"  game.scores = {room[0]['game'].get('scores')}")

print("\n  --- คาดหวังตามกติกา (client handleKnockout ซึ่งไม่ถูกเรียก) ---")
print("  P1 (เกิดแล้ว, น็อค): meld 3 ใบ = 15+5+5=25, โบนัส 50, head 50 → +125")
print("  P2 (ไม่เกิด, เหลือมือ A♠15+K♥10+2♣50=75): 0 - 75*2 = -150")
print("  → ค่าที่ server คืนมาต่างจากนี้ = scoring ทำงานไม่ตรงกติกา")

print("\n=== TEST K2: ทิ้งสเปโต แล้วโดนหักแต้มไหม? ===")
ROOM2 = "S" + uuid.uuid4().hex[:5].upper()
game2 = {
    "deck": ["Q♣"], "hands": {P1: ["2♣", "9♣", "K♠"], P2: ["A♠"]},
    "discardPile": ["3♣"], "turnPlayerId": P1, "playerOrder": [P1, P2],
    "phase": "action", "status": "playing",
    "melds": {P1: [], P2: []}, "scores": {P1: 0, P2: 0},
    "hasFirstMeld": {P1: False, P2: False},
    "hasDiscardedThisTurn": {}, "pickedFromDiscard": {}, "deckEmpty": False, "version": 1,
}
req("POST", "/rest/v1/rooms", {"id": ROOM2, "code": ROOM2, "players": players,
                               "status": "playing", "totalplayers": 2,
                               "game": game2, "version": 1})
st, res = req("POST", "/rest/v1/rpc/play_turn", {
    "p_game_id": ROOM2, "p_player_id": P1, "p_action": "DISCARD",
    "p_card_code": "2♣", "p_expected_version": ver(ROOM2)})
print(f"  ok={res.get('ok')} error={res.get('error')}")
print(f"  mii_penalty = {res.get('mii_penalty')}   (client คาดหวัง -100)")
print(f"  scores หลังทิ้งสเปโต = {res.get('game', {}).get('scores') if res.get('ok') else 'n/a'}")

req("DELETE", f"/rest/v1/rooms?id=eq.{ROOM}")
req("DELETE", f"/rest/v1/rooms?id=eq.{ROOM2}")
print("\n[cleanup] done")
