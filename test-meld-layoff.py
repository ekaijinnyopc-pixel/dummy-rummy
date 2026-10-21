#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ทดสอบ flow MELD -> LAYOFF ของ dummy rummy ผ่าน Supabase RPC จริง"""
import json, re, urllib.request, uuid

BASE = "https://dbtlbeymrchodloboymr.supabase.co"
SRC = "/data/.openclaw/workspace/dummy-rummy/game-core.js"
KEY = re.search(r"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_.-]+", open(SRC).read()).group(0)
HEAD = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json",
        "Prefer": "return=representation"}


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, headers=HEAD, method=method)
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


def cur_version(room):
    st, res = req("GET", f"/rest/v1/rooms?id=eq.{room}&select=version")
    if isinstance(res, list) and res:
        return res[0].get("version", 1)
    return 1


def rpc(room, pid, action, **kw):
    payload = {"p_game_id": room, "p_player_id": pid, "p_action": action,
               "p_expected_version": cur_version(room)}
    payload.update(kw)
    st, res = req("POST", "/rest/v1/rpc/play_turn", payload)
    return st, res


ROOM = "T" + uuid.uuid4().hex[:5].upper()
P1, P2 = "p_aaa", "p_bbb"

# --- สร้างห้องพร้อม game state: P1 มีมอลด์เรียง 3♥4♥5♥, P2 มี 6♥ พร้อมฝาก ---
game = {
    "deck": ["K♠", "Q♠"],
    "hands": {P1: ["A♠", "2♠"], P2: ["6♥"]},
    "discardPile": ["3♣"],
    "turnPlayerId": P2,
    "playerOrder": [P1, P2],
    "phase": "action",
    "status": "playing",
    "melds": {P1: [["3♥", "4♥", "5♥"]], P2: []},
    "scores": {P1: 0, P2: 0},
    "round": 1,
    "turnStartTime": 0,
    "headCard": "3♣",
    "headPoints": 50,
    "hasFirstMeld": {P1: True, P2: True},
    "lastDiscard": None,
    "deckEmpty": False,
    "pickedFromDiscard": {},
    "version": 1,
}
players = {P1: {"id": P1, "name": "P1", "isBot": False, "isHost": True},
           P2: {"id": P2, "name": "P2", "isBot": False, "isHost": False}}

st, res = req("POST", "/rest/v1/rooms", {"id": ROOM, "code": ROOM, "players": players,
                                         "status": "playing", "totalplayers": 2,
                                         "game": game, "version": 1})
print(f"[SETUP] insert rooms -> {st} {res if isinstance(res, str) else ''}")

# --- TEST 1: MELD โดย P2 (มี 6♥ แต่มีแค่ 1 ใบ ให้เพิ่มไพ่จำลอง) ---
print("\n=== TEST 1: MELD (first meld ควรเป็น true) ===")
game2 = dict(game)
game2["hands"] = {P1: ["A♠", "2♠"], P2: ["6♥", "7♥", "8♥"]}
game2["melds"] = {P1: [["3♥", "4♥", "5♥"]], P2: []}
game2["hasFirstMeld"] = {P1: True, P2: False}
st, res = req("PATCH", f"/rest/v1/rooms?id=eq.{ROOM}", {"game": game2, "version": cur_version(ROOM)})
print(f"  [setup2] {st}")

st, res = rpc(ROOM, P2, "MELD", p_meld_codes=["6♥", "7♥", "8♥"])
print(f"  status={st}")
if isinstance(res, dict):
    print(f"  ok={res.get('ok')} is_first_meld={res.get('is_first_meld')} error={res.get('error')}")
    if res.get("game"):
        print(f"  melds[P2]={res['game']['melds'].get(P2)}")
        print(f"  hasFirstMeld={res['game'].get('hasFirstMeld')}")

# --- TEST 2: LAYOFF (P2 ฝาก 6♥ เข้ามอลด์เรียง 3♥4♥5♥ ของ P1, meldIndex=0) ---
print("\n=== TEST 2: LAYOFF 6♥ -> P1 meldIndex 0 (ควร ok=true) ===")
# P2 เกิดไปแล้ว เหลือมือ 6♥ 1 ใบสำหรับฝาก
game3 = dict(game2)
game3["hands"] = {P1: ["A♠", "2♠"], P2: ["6♥", "K♠"]}
game3["melds"] = {P1: [["3♥", "4♥", "5♥"]], P2: [["6♥", "7♥", "8♥"]]}
game3["hasFirstMeld"] = {P1: True, P2: True}
st, res = req("PATCH", f"/rest/v1/rooms?id=eq.{ROOM}", {"game": game3, "version": cur_version(ROOM)})
print(f"  [setup3] {st}")
st, res = rpc(ROOM, P2, "LAYOFF", p_card_code="6♥", p_target_pid=P1, p_target_meld_idx=0)
print(f"  status={st}")
if isinstance(res, dict):
    print(f"  ok={res.get('ok')} error={res.get('error')}")
    if res.get("game"):
        print(f"  melds[P1]={res['game']['melds'].get(P1)}")
        print(f"  hands[P2]={res['game']['hands'].get(P2)}")

# --- TEST 3: LAYOFF ด้วย meld_idx = NULL (จำลองบักเดิม targetMeldIdx=undefined) ---
print("\n=== TEST 3: LAYOFF โดยไม่ส่ง meld_idx (จำลองบัก targetMeldIdx=undefined) ===")
st, res = rpc(ROOM, P2, "LAYOFF", p_card_code="A♠", p_target_pid=P1)
print(f"  status={st}  ok={res.get('ok') if isinstance(res,dict) else res} error={res.get('error') if isinstance(res,dict) else ''}")

# cleanup
req("DELETE", f"/rest/v1/rooms?id=eq.{ROOM}")
print("\n[cleanup] done")
