#!/usr/bin/env python3
# AUDIT: ตรวจคะแนนที่บันทึกไว้บน live DB ว่าตรงกับกติกาฝั่ง client หรือไม่
# (ยืนยันว่า "น็อคมืด ×2" ที่ยังไม่ apply SQL ยังไม่ทำให้คะแนนบน production ผิด)
import json, re, sys, urllib.request

SRC = open('/data/.openclaw/workspace/dummy-rummy/game-core.js', encoding='utf-8').read()
URL = re.search(r"SUPABASE_URL = '([^']+)'", SRC).group(1)
KEY = re.search(r"SUPABASE_KEY = '([^']+)'", SRC).group(1)

FACE = {'J', 'Q', 'K', '10'}


def is_speto(code):
    # ตรงกับ client: isSpeto() = 2♣ หรือ Q♠ (สเปโต 2 ใบ) — คะแนน 50
    return code.strip() in ('2♣', 'Q♠')


def card_points(code):
    code = code.strip()
    if is_speto(code):
        return 50
    rank = code[:-1] if len(code) > 1 else code
    if rank == 'A':
        return 15
    if rank in FACE:
        return 10
    return 5


def compute(g, ko):
    """คัดลอก computeRoundScoresFor() ฝั่ง client"""
    players = g.get('playerOrder') or list((g.get('hands') or {}).keys())
    penalty = g.get('spettoPenalty') or {}
    hasfm = g.get('hasFirstMeld') or {}
    ever = g.get('everMeld') or {}
    melds = g.get('melds') or {}
    out = {}
    for pid in players:
        meld_pts = 0
        for m in (melds.get(pid) or []):
            codes = m if isinstance(m, list) else (m.get('cards') or [])
            for c in codes:
                meld_pts += card_points(c)
        hand = (g.get('hands') or {}).get(pid) or []
        hand_pts = sum(card_points(c) for c in hand)
        is_ko = (pid == ko)
        has_meld = bool(hasfm.get(pid))
        if is_ko and len(hand) == 0:
            hand_pts = 0
        if not has_meld:
            hand_pts *= 2
        bonus = 0
        if is_ko:
            bonus += 50 if has_meld else 100
            if g.get('headPoints'):
                bonus += g['headPoints']
        pen = penalty.get(pid) or 0
        rnd = meld_pts - hand_pts + bonus - pen
        pid_melds = melds.get(pid) or []
        has_ever = bool(ever.get(pid)) or bool(hasfm.get(pid)) or (len(pid_melds) > 0)
        dark = is_ko and not has_ever
        if dark:
            rnd *= 2
        out[pid] = (rnd, dark)
    return out


def get_rooms():
    req = urllib.request.Request(
        URL + '/rest/v1/rooms?select=id,code,status,game',
        headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY})
    data = json.load(urllib.request.urlopen(req, timeout=30))
    return data if isinstance(data, list) else data.get('data', [])


rooms = get_rooms()
ended = [r for r in rooms if r.get('status') == 'ended' and r.get('game')]
print('ห้องทั้งหมด: %d · ended มี game: %d' % (len(rooms), len(ended)))

bad = 0
for r in ended:
    g = r['game']
    ko = g.get('knockPlayerId')
    stored = g.get('roundScores') or {}
    if not stored:
        print('  ⚠️  %s: ไม่มี roundScores (เล่นก่อน FIX v39?)' % r['id'])
        continue
    exp = compute(g, ko)
    diffs = []
    for pid, (val, dark) in exp.items():
        sv = stored.get(pid)
        if sv is None:
            diffs.append('%s: ไม่มีใน stored' % pid)
        elif int(sv) != int(val):
            diffs.append('%s: stored=%s expected=%s%s' % (
                pid, sv, val, ' (darkKnock)' if dark else ''))
    if diffs:
        bad += 1
        print('  ❌ %s (ko=%s): %s' % (r['id'], ko, '; '.join(diffs)))
    else:
        print('  ✅ %s (ko=%s): ตรงทั้งหมด %s' % (r['id'], ko, stored))

print('\nสรุป: ห้องที่คะแนนไม่ตรง = %d / %d' % (bad, len(ended)))
sys.exit(1 if bad else 0)
