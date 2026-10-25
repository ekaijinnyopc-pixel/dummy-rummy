#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PROBE v55: เช็คว่า SQL patch (น็อคมืด ×2 + MUST_PICK_FIRST) ถูก apply บน live แล้วหรือยัง
ใช้: python3 tools/probe-v55-live.py
- สร้างห้องทดสอบ 1 ห้อง (ผู้เล่น 1 คน) → KNOCK → ดู roundScores
- 280 = patch แล้ว (×2 ทำงาน) · 140 = ยังไม่ได้ apply
- ลบห้องทดสอบทิ้งเสมอ (ไม่ทิ้งขยะไว้บน live)
"""
import json, re, urllib.request, urllib.error, uuid, sys

BASE = "https://dbtlbeymrchodloboymr.supabase.co"
SRC = "/data/.openclaw/workspace/dummy-rummy/game-core.js"
KEY = re.search(r"const SUPABASE_KEY = '([^']+)'", open(SRC, encoding="utf-8").read()).group(1)
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}
ROOM = "P" + uuid.uuid4().hex[:5].upper()
P = "p_probe"


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


def cleanup():
    s, _ = req("DELETE", "/rest/v1/rooms?id=eq." + ROOM)
    print(f"[cleanup] ลบห้องทดสอบ {ROOM}: HTTP {s}")


try:
    # มือเหลือ 7♠ (5 แต้ม) · ไม่เคยเกิด · ไม่มีธง everMeld (เหมือนห้องเก่า)
    g = {
        "deck": ["K♠", "Q♠", "J♠", "10♠", "9♠", "8♠", "7♠", "6♠", "5♠", "4♠"],
        "hands": {P: ["7♠"]},
        "discardPile": ["K♣"],
        "turnPlayerId": P, "playerOrder": [P],
        "phase": "action", "status": "playing",
        "melds": {P: []}, "scores": {P: 0},
        "hasFirstMeld": {P: False},
        "headCard": "K♣", "headPoints": 50,
        "hasDiscardedThisTurn": {}, "pickedFromDiscard": {},
        "spettoPenalty": {}, "spetoPending": {}, "spettoPenaltyDone": {},
        "spettoDiscardDone": {}, "spetoOrigin": {},
        "turnSeq": 0, "deckEmpty": False, "version": 1,
    }
    players = {P: {"id": P, "name": "probe", "isBot": False, "isHost": True}}
    s, d = req("POST", "/rest/v1/rooms", {"id": ROOM, "code": ROOM, "players": players,
                                         "status": "playing", "totalplayers": 1,
                                         "game": g, "version": 1})
    print(f"[1] สร้างห้องทดสอบ {ROOM}: HTTP {s}")
    if s not in (200, 201):
        print("สร้างห้องไม่สำเร็จ:", str(d)[:300]); sys.exit(1)

    # เรียก RPC play_turn KNOCK
    body = {"p_game_id": ROOM, "p_player_id": P, "p_action": "KNOCK",
            "p_card_code": None, "p_discard_index": None, "p_meld_codes": None,
            "p_target_pid": None, "p_target_meld_idx": None, "p_expected_version": 1}
    s, d = req("POST", "/rest/v1/rpc/play_turn", body)
    print(f"[2] RPC KNOCK: HTTP {s}")
    if s != 200:
        print("RPC ล้มเหลว:", str(d)[:400]); sys.exit(1)
    rs = (d.get("round_scores") or {})
    score = rs.get(P)
    print(f"[3] round_scores[{P}] = {score}")
    print(f"    คาดหวัง: 280 = SQL patch แล้ว (×2 ทำงาน) · 140 = ยังไม่ได้ apply")
    print("    ✅ PATCH APPLIED" if score == 280 else "    ⏳ PATCH ยังไม่ APPLY")
finally:
    cleanup()
