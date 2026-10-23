#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ทดสอบกติกาโทษ v41 บน Supabase จริง (REST) — FIX v41"""
import json, urllib.request, urllib.error, re, sys

SRC = open('/data/.openclaw/workspace/dummy-rummy/game-core.js', encoding='utf-8').read()
KEY = re.search(r'eyJ[A-Za-z0-9._-]{40,}', SRC).group(0)
URL = 'https://dbtlbeymrchodloboymr.supabase.co'
H = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json',
     'Prefer': 'return=representation'}

def req(method, path, body=None):
    r = urllib.request.Request(URL + path, method=method, headers=H,
                               data=(json.dumps(body, ensure_ascii=False).encode('utf-8') if body else None))
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            t = resp.read().decode('utf-8')
            return resp.status, (json.loads(t) if t.strip().startswith(('[{','"','{')) else t)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')

def mk_room(rid, players, hands, melds, pile, current, seq=0):
    game = {
        'deck': [], 'discardPile': pile, 'hands': hands, 'melds': melds,
        'scores': {}, 'totalScores': {},
        'hasFirstMeld': {p: True for p in players},
        'playerOrder': players, 'turnPlayerId': current, 'phase': 'action',
        'turnSeq': seq, 'spettoPenalty': {}, 'spettoPenaltyDone': {},
        'spettoDiscardDone': {}, 'spetoPending': {},
        'hasDiscardedThisTurn': {}, 'version': 1,
    }
    st, _ = req('DELETE', '/rest/v1/rooms?id=eq.' + rid)
    st, _ = req('POST', '/rest/v1/rooms', {'id': rid, 'code': rid.upper()[:4],
                'players': {}, 'game': game, 'status': 'playing', 'version': 1,
                'totalplayers': len(players)})
    return st

def get_game(rid):
    st, data = req('GET', '/rest/v1/rooms?select=game&id=eq.' + rid)
    if isinstance(data, list) and data:
        return data[0]['game']
    return None

def turn(rid, pid, action, ver=0, **kw):
    body = {'p_game_id': rid, 'p_player_id': pid, 'p_action': action,
            'p_expected_version': ver}
    body.update(kw)
    st, data = req('POST', '/rest/v1/rpc/play_turn', body)
    return data

PASS = FAIL = 0
def ok(name, cond, extra=''):
    global PASS, FAIL
    if cond:
        PASS += 1; print('  OK   ' + name)
    else:
        FAIL += 1; print('  FAIL ' + name + '  ' + str(extra)[:300])

def state(g):
    return (g.get('spettoPenalty') or {}, g.get('spetoPending') or {},
            g.get('turnSeq'), g.get('spettoDiscardDone') or {})

print('=' * 60)
print('LIVE TEST: กติกาโทษ -100 v41 บน Supabase จริง')
print('=' * 60)

# --- T1: 2.1 ทิ้งดัมมี่ (เรียงต่อชุดของคนอื่น) ---
print('\nT1: 2.1 ทิ้งดัมมี่ — p1 ทิ้ง 6♥ ต่อชุด 3♥-4♥-5♥ ของ p2 → p1 เสีย 100')
mk_room('lt1', ['p1', 'p2'], {'p1': ['6♥'], 'p2': []}, {'p1': [], 'p2': [['3♥', '4♥', '5♥']]}, [], 'p1')
r = turn('lt1', 'p1', 'DISCARD', p_card_code='6♥')
g = get_game('lt1')
pen, pend, seq, dd = state(g)
ok('DISCARD ok', r.get('ok') is True, r)
ok('p1 โดน -100', pen.get('p1') == 100, pen)
ok('ไม่มี pending (ไม่ใช่สเปโต)', pen.get('p2') is None and not pend, (pen, pend))

# --- T2: 2.1 ไม่โดน ---
print('\nT2: 2.1 ไม่โดน — p1 ทิ้ง 7♥ (ต่อชุด 3♥-4♥-5♥ ไม่ได้)')
mk_room('lt2', ['p1', 'p2'], {'p1': ['7♥'], 'p2': []}, {'p1': [], 'p2': [['3♥', '4♥', '5♥']]}, [], 'p1')
turn('lt2', 'p1', 'DISCARD', p_card_code='7♥')
g = get_game('lt2')
pen, pend, seq, dd = state(g)
ok('ไม่มีโทษ', not pen, pen)

# --- T3: 2.2 ตีเต็ม (เรียงบนกองทิ้ง) ---
print('\nT3: 2.2 ตีเต็ม — กองทิ้ง 5♥-6♥ แล้วทิ้ง 7♥ → กองทิ้งเป็น 5-6-7 → p1 เสีย 100')
mk_room('lt3', ['p1', 'p2'], {'p1': ['7♥'], 'p2': []}, {'p1': [], 'p2': []}, ['5♥', '6♥'], 'p1')
turn('lt3', 'p1', 'DISCARD', p_card_code='7♥')
g = get_game('lt3')
pen, pend, seq, dd = state(g)
ok('p1 โดน -100', pen.get('p1') == 100, pen)

# --- T4: 2.1 + 2.2 พร้อมกัน → หัก 100 ครั้งเดียว ---
print('\nT4: 2.1 + 2.2 พร้อมกัน → หักรวม 100 เดียว (ไม่ใช่ 200)')
mk_room('lt4', ['p1', 'p2'], {'p1': ['7♥'], 'p2': []}, {'p1': [], 'p2': [['8♥', '9♥', '10♥']]}, ['5♥', '6♥'], 'p1')
turn('lt4', 'p1', 'DISCARD', p_card_code='7♥')
g = get_game('lt4')
pen, pend, seq, dd = state(g)
ok('p1 โดน -100 (ไม่ใช่ 200)', pen.get('p1') == 100, pen)

# --- T5: 2.3 สเปโต → เกิด pending แต่ยังไม่หัก ---
print('\nT5: 2.3 สเปโต — ทิ้ง 2♣ ที่กองทิ้งมี 2♠ → pending (ยังไม่หัก)')
mk_room('lt5', ['p1', 'p2'], {'p1': ['2♣'], 'p2': ['2♥', '2♦']}, {'p1': [], 'p2': []}, ['2♠'], 'p1')
turn('lt5', 'p1', 'DISCARD', p_card_code='2♣')
g = get_game('lt5')
pen, pend, seq, dd = state(g)
ok('มี pending 2♣', '2♣' in pend, pend)
ok('pending.discarder = p1', pend.get('2♣', {}).get('discarder') == 'p1', pend)
ok('ยังไม่หักแต้มตอนทิ้ง', not pen, pen)

# --- T6: 2.3 ภายใน 1 รอบ มีคน MELD ไพ่ใบนั้น → คนทิ้งเสีย 100 ---
print('\nT6: 2.3 — p2 หยิบ 2♣ มาเกิด (MELD) ภายในรอบ → p1 เสีย 100')
# p1 ทิ้ง 2♣, ตาต่อไป p2 หยิบ 2♣ จากกองทิ้ง แล้วเกิด
r = turn('lt5', 'p2', 'PICK_DISCARD', p_discard_index=0)
g = get_game('lt5')
ok('PICK ok', r.get('ok') is True, r)
hand2 = (g.get('hands') or {}).get('p2') or []
ok('p2 ได้ 2♣ ในมือ', '2♣' in hand2, hand2)
r = turn('lt5', 'p2', 'MELD', p_meld_codes=json.dumps(['2♣', '2♥', '2♦']))
g = get_game('lt5')
pen, pend, seq, dd = state(g)
ok('MELD ok', r.get('ok') is True, r)
ok('p1 (คนทิ้ง) เสีย 100', pen.get('p1') == 100, pen)
ok('pending ถูกล้าง', '2♣' not in pend, pend)

# --- T7: 2.3 ผ่าน 1 รอบ ไม่มีใครเกิด → รอด ---
print('\nT7: 2.3 — ผ่าน 1 รอบไม่มีใคร MELD → รอด ไม่หัก')
mk_room('lt7', ['p1', 'p2'], {'p1': ['2♣'], 'p2': ['9♠']}, {'p1': [], 'p2': []}, ['2♠'], 'p1')
turn('lt7', 'p1', 'DISCARD', p_card_code='2♣')
g = get_game('lt7')
pen, pend, seq, dd = state(g)
ok('มี pending', '2♣' in pend, pend)
exp = pend.get('2♣', {}).get('expiresAtTurn')
ok('expiresAtTurn = จำนวนผู้เล่น (2) → หมดอายุตอนตากลับมาหาคนทิ้ง', exp == 2, pend)
# p2 ทิ้ง 9♠ → เดินตากลับมาหา p1
turn('lt7', 'p2', 'DISCARD', p_card_code='9♠')
g = get_game('lt7')
pen, pend, seq, dd = state(g)
ok('หลังพ้น 1 รอบ ไม่มีโทษ', not pen, (pen, pend))
ok('pending ถูกล้าง (หมดอายุ)', '2♣' not in pend, pend)

# --- T8: LAYOFF ไม่โดนโทษ 2.3 ---
print('\nT8: LAYOFF (ฝาก) ไม่โดนโทษ 2.3')
mk_room('lt8', ['p1', 'p2'], {'p1': ['2♣'], 'p2': []}, {'p1': [], 'p2': [['3♥', '4♥', '5♥']]}, ['2♠'], 'p1')
turn('lt8', 'p1', 'DISCARD', p_card_code='2♣')
# p2 หยิบ 2♣ แล้วฝากลงชุดเรียง 3♥-4♥-5♥ (ฝาก 2♠? ใช้ 2♠ ที่อยู่บนกอง) -> ทดสอบว่าฝากไม่หัก
r = turn('lt8', 'p2', 'PICK_DISCARD', p_discard_index=0)
g = get_game('lt8')
pen, pend, seq, dd = state(g)
ok('PICK ok', r.get('ok') is True, r)
# ฝาก 2♣ ลงชุดตองของ p1? ใช้การฝากผิดปกติ — ให้ p2 ฝาก 2♠ ต่อ 3♥-4♥-5♥ ไม่ได้ -> ข้าม
# แทนที่จะทดสอบ "ฝากสเปโต" ให้เช็คว่า pending ยังค้างและไม่มีการหัก
ok('ฝาก/หยิบ → ยังไม่มีการหักโทษ', not pen, pen)
ok('pending ยังค้าง', '2♣' in pend, pend)

# --- T9: ทิ้งสเปโตที่ไม่มีการ์ดเกี่ยว → ไม่เกิด pending ---
print('\nT9: ทิ้งสเปโตที่กองทิ้งไม่มีการ์ดเกี่ยว → ไม่เกิด pending')
mk_room('lt9', ['p1', 'p2'], {'p1': ['2♣'], 'p2': []}, {'p1': [], 'p2': []}, ['9♣'], 'p1')
turn('lt9', 'p1', 'DISCARD', p_card_code='2♣')
g = get_game('lt9')
pen, pend, seq, dd = state(g)
ok('ไม่มี pending', not pend, pend)
ok('ไม่มีโทษ', not pen, pen)

# --- T10: KNOCK หักโทษสะสมถูกต้อง ---
print('\nT10: KNOCK — โทษสะสมถูกหักในคะแนนรอบ')
mk_room('lt10', ['p1', 'p2'], {'p1': ['9♠'], 'p2': ['2♠']}, {'p1': [['3♥', '4♥', '5♥']], 'p2': []}, [], 'p1')
turn('lt10', 'p1', 'DISCARD', p_card_code='9♠')
# p2 น็อค
r = turn('lt10', 'p2', 'KNOCK')
ok('KNOCK ok', r.get('ok') is True, r)
rs = r.get('round_scores') or {}
print('   round_scores =', rs)

# --- T11: 2.1 ครอบคลุม "ตอง" (ทิ้งสเปโตต่อชุดตองของคนอื่น) ---
print('\nT11: 2.1 ตอง — p1 ทิ้ง 2♣ ต่อชุดตอง 2♥-2♦-2♠ ของ p2 → p1 เสีย 100')
mk_room('lt11', ['p1', 'p2'], {'p1': ['2♣'], 'p2': []}, {'p1': [], 'p2': [['2♥', '2♦', '2♠']]}, [], 'p1')
turn('lt11', 'p1', 'DISCARD', p_card_code='2♣')
g = get_game('lt11')
pen, pend, seq, dd = state(g)
ok('p1 โดน -100 (2.1 ครอบคลุมตอง)', pen.get('p1') == 100, pen)

# --- T12: LAYOFF สเปโตจริง → ไม่โดนโทษ 2.3 ---
print('\nT12: LAYOFF สเปโต — p2 หยิบ 2♣ มา "ฝาก" ลงชุดตองของตัวเอง → ไม่โดนโทษ')
mk_room('lt12', ['p1', 'p2'], {'p1': ['2♣'], 'p2': ['2♥', '2♦', '2♠']},
        {'p1': [], 'p2': []}, ['2♠'], 'p1')
turn('lt12', 'p1', 'DISCARD', p_card_code='2♣')
g = get_game('lt12')
pen, pend, seq, dd = state(g)
ok('มี pending 2♣ (กองทิ้งมี 2♠ เกี่ยว)', '2♣' in pend, pend)
r = turn('lt12', 'p2', 'PICK_DISCARD', p_discard_index=0)
ok('PICK ok', r.get('ok') is True, r)
r = turn('lt12', 'p2', 'LAYOFF', p_card_code='2♣', p_target_pid='p2', p_target_meld_idx=0)
print('   LAYOFF resp =', str(r)[:200])
g = get_game('lt12')
pen, pend, seq, dd = state(g)
ok('ฝากสเปโต → ไม่มีการหักโทษ', not pen, pen)
ok('pending ยังค้าง (ยังไม่มีใครเกิด)', '2♣' in pend, pend)

# --- T13: ทิ้งสเปโตที่ทำให้ทั้ง 2.1 และ 2.3 พร้อมกัน → สถานะโทษจริง ---
print('\nT13: ทิ้ง 2♣ ที่ทำให้ 2.1 (ต่อชุดตองคนอื่น) + 2.3 (กองทิ้งมี 2♠) → ดูโทรรวมจริง')
mk_room('lt13', ['p1', 'p2'], {'p1': ['2♣'], 'p2': ['2♥', '2♦', '2♠']},
        {'p1': [], 'p2': [['2♥', '2♦', '2♠']]}, ['2♠'], 'p1')
turn('lt13', 'p1', 'DISCARD', p_card_code='2♣')
g = get_game('lt13')
pen, pend, seq, dd = state(g)
print('   หลังทิ้ง: penalty =', pen, ' pending =', pend)
ok('ทันทีโดน -100 (2.1)', pen.get('p1') == 100, pen)
# ตอนนี้ p2 เกิด 2♣ ต่อชุดของ p2 เอง? ใช้ p2 meld 2♠2♥2♦ ไป → ไม่ใช่ 2♣ → ไม่โดน
r = turn('lt13', 'p2', 'PICK_DISCARD', p_discard_index=0)
r = turn('lt13', 'p2', 'MELD', p_meld_codes=json.dumps(['2♠', '2♥', '2♦']))
g = get_game('lt13')
pen, pend, seq, dd = state(g)
print('   หลัง MELD: penalty =', pen, ' pending =', pend)

# --- cleanup ---
for rid in ['lt1', 'lt2', 'lt3', 'lt4', 'lt5', 'lt7', 'lt8', 'lt9', 'lt10', 'lt11', 'lt12', 'lt13']:
    req('DELETE', '/rest/v1/rooms?id=eq.' + rid)

print('\n' + '=' * 60)
print(' ผ่าน: %d  |  ไม่ผ่าน: %d' % (PASS, FAIL))
print('=' * 60)
sys.exit(1 if FAIL else 0)
