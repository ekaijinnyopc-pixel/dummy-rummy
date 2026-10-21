#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Discriminator: ตรวจว่า play_turn() ที่ deploy จริงใช้ version จาก rooms.version หรือ game.version"""
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


ROOM = "D" + uuid.uuid4().hex[:5].upper()
P1 = "p_aaa"
game = {
    "deck": ["K♠", "Q♠"], "hands": {P1: ["3♥", "4♥", "5♥", "9♣"]},
    "discardPile": ["3♣"], "turnPlayerId": P1, "playerOrder": [P1],
    "phase": "action", "status": "playing", "melds": {P1: []}, "scores": {P1: 0},
    "hasFirstMeld": {P1: False}, "version": 99,          # <-- game.version = 99
    "hasDiscardedThisTurn": {}, "pickedFromDiscard": {}, "deckEmpty": False,
}
players = {P1: {"id": P1, "name": "P1", "isBot": False, "isHost": True}}

st, res = req("POST", "/rest/v1/rooms", {"id": ROOM, "code": ROOM, "players": players,
                                         "status": "playing", "totalplayers": 1,
                                         "game": game, "version": 1})  # <-- rooms.version = 1
print(f"[setup] {st}  (rooms.version=1, game.version=99)")

print("\n--- Discriminator: ส่ง p_expected_version = 1 ---")
st, res = req("POST", "/rest/v1/rpc/play_turn", {
    "p_game_id": ROOM, "p_player_id": P1, "p_action": "MELD",
    "p_meld_codes": ["3♥", "4♥", "5♥"], "p_expected_version": 1})
print(f"  ok={res.get('ok')} error={res.get('error')}")
if res.get("ok"):
    print("  => deploy ใช้ rooms.version (ตรงกับ supabase-schema-fixed.sql)")
else:
    print("  => deploy ใช้ game.version (ตรงกับ supabase-schema.sql)")

print("\n--- Test: ส่ง p_meld_codes เป็น JSON string (ไม่ใช่ array) ---")
st, res = req("GET", f"/rest/v1/rooms?id=eq.{ROOM}&select=version")
v_now = res[0]["version"]
st, res = req("POST", "/rest/v1/rpc/play_turn", {
    "p_game_id": ROOM, "p_player_id": P1, "p_action": "MELD",
    "p_meld_codes": json.dumps(["9♣"]), "p_expected_version": v_now})
print(f"  ok={res.get('ok')} error={res.get('error')}")
if res.get("ok"):
    print("  => param เป็น TEXT (รับ string ได้ → ตรงกับ supabase-schema-fixed.sql)")
else:
    print("  => param เป็น JSONB (ต้องส่งเป็น array → ตรงกับ supabase-schema.sql)")

req("DELETE", f"/rest/v1/rooms?id=eq.{ROOM}")
print("\n[cleanup] done")
