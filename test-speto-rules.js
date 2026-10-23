/* ============================================================
 * TEST: กติกาโทษ -100 แบบใหม่ (FIX v41 / 2026-10-23) — ฝั่ง JS
 *   2.1 ทิ้งดัมมี่  = ทิ้งไพ่ที่ฝากต่อชุดของผู้เล่นคนอื่นได้ → -100 ทันที
 *   2.2 ตีเต็ม    = ทิ้งแล้วกองทิ้งมีชุดเกิดครบที่มีไพ่ที่เพิ่งทิ้ง → -100 ทันที
 *   2.3 สเปโต    = ทิ้งสเปโตที่มีการ์ดเกี่ยว → ค้าง 1 รอบ → มีคน MELD = -100 / ไม่มี = รอด
 *
 * วิธีรัน:  node tools/test-speto-rules.js
 * (โค้ดฝั่ง server อยู่ใน FIX-speto-2026-10-23.sql — ต้องตรงกับไฟล์นี้)
 * ============================================================ */
'use strict';
var path = require('path');
var R = require(path.join(__dirname, 'speto-rules.js'));

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), { actual: actual, expected: expected });
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// ---------------------------------------------------------------
section('2.1 "ทิ้งดัมมี่" — ทิ้งไพ่ที่ฝากต่อชุดของผู้เล่นคนอื่นได้ → โดน -100');

var g21 = {
  discardPile: [],
  melds: { p1: [], p2: [['3♥', '4♥', '5♥']] },
  hands: { p1: ['6♥'], p2: [] }
};
var r21 = R.predictDiscardPenalty(g21, 'p1', '6♥');
ok('2.1 เรียง: ทิ้ง 6♥ ต่อชุด 3-4-5 ของ p2 → โดน', r21.dumy === true, r21);
eq('2.1 โทษ 100', r21.penalty, 100);

var g21b = {
  discardPile: [],
  melds: { p1: [], p2: [['3♥', '4♥', '5♥']] },
  hands: { p1: ['7♥'], p2: [] }
};
var r21b = R.predictDiscardPenalty(g21b, 'p1', '7♥');
ok('2.1 เรียง: ทิ้ง 7♥ (ไม่ติดกับ 3-4-5) → ไม่โดน', r21b.dumy === false && r21b.penalty === 0, r21b);

var g21c = {
  discardPile: [],
  melds: { p1: [], p2: [['5♥', '5♦', '5♠']] },
  hands: { p1: ['5♣'], p2: [] }
};
var r21c = R.predictDiscardPenalty(g21c, 'p1', '5♣');
ok('2.1 ตอง: ทิ้ง 5♣ ต่อชุดตอง 5 ของ p2 → โดน', r21c.dumy === true, r21c);

var g21d = {
  discardPile: [],
  melds: { p1: [], p2: [['5♥', '5♦', '5♠']] },
  hands: { p1: ['5♥'], p2: [] }
};
var r21d = R.predictDiscardPenalty(g21d, 'p1', '5♥');
ok('2.1 ตอง: ทิ้งไพ่ที่อยู่ในชุดอยู่แล้ว → ไม่โดน', r21d.dumy === false, r21d);

var g21e = {
  discardPile: [],
  melds: { p1: [['3♥', '4♥', '5♥']], p2: [] },
  hands: { p1: ['6♥'], p2: [] }
};
var r21e = R.predictDiscardPenalty(g21e, 'p1', '6♥');
ok('2.1 ชุดของตัวเอง → ไม่โดน', r21e.dumy === false, r21e);

var g21f = {
  discardPile: [],
  melds: { p1: [], p2: [['2♥', '2♦', '2♠']] },
  hands: { p1: ['2♣'], p2: [] }
};
var r21f = R.predictDiscardPenalty(g21f, 'p1', '2♣');
ok('2.1 สเปโตฝากลงชุดตองได้ → ทิ้งแล้วโดน', r21f.dumy === true, r21f);

var g21g = {
  discardPile: [],
  melds: { p1: [], p2: [['3♥', '4♥', '5♥']] },
  hands: { p1: ['2♣'], p2: [] }
};
var r21g = R.predictDiscardPenalty(g21g, 'p1', '2♣');
ok('2.1 สเปโตฝากลงชุดเรียงไม่ได้ → ไม่โดน', r21g.dumy === false, r21g);

// ---------------------------------------------------------------
section('2.2 "ตีเต็ม" — ทิ้งแล้วกองทิ้งมีชุดเกิดครบ (ที่มีไพ่ที่เพิ่งทิ้ง) → โดน -100');

var g22 = { discardPile: ['5♥', '6♥'], melds: {}, hands: { p1: ['7♥'] } };
var r22 = R.predictDiscardPenalty(g22, 'p1', '7♥');
ok('2.2 เรียง: ทิ้ง 7♥ แล้วกองทิ้งเป็น 5-6-7 → โดน', r22.full === true, r22);
eq('2.2 โทษ 100', r22.penalty, 100);

var g22b = { discardPile: ['5♥', '8♥'], melds: {}, hands: { p1: ['7♥'] } };
var r22b = R.predictDiscardPenalty(g22b, 'p1', '7♥');
ok('2.2 เรียง: ทิ้ง 7♥ แต่กองทิ้งไม่ครบ (5-8-7) → ไม่โดน', r22b.full === false && r22b.penalty === 0, r22b);

var g22c = { discardPile: ['5♥', '5♦'], melds: {}, hands: { p1: ['5♠'] } };
var r22c = R.predictDiscardPenalty(g22c, 'p1', '5♠');
ok('2.2 ตอง: ทิ้ง 5♠ แล้วกองทิ้งเป็นตอง 5 → โดน', r22c.full === true, r22c);

var g22d = { discardPile: ['5♥', '5♦'], melds: {}, hands: { p1: ['7♠'] } };
var r22d = R.predictDiscardPenalty(g22d, 'p1', '7♠');
ok('2.2 ทิ้งไพ่ธรรมดาที่ไม่ทำให้กองทิ้งครบ → ไม่โดน', r22d.full === false, r22d);

var g22e = { discardPile: ['A♠', '2♠'], melds: {}, hands: { p1: ['3♠'] } };
var r22e = R.predictDiscardPenalty(g22e, 'p1', '3♠');
ok('2.2 เรียง A ต่ำ: ทิ้ง 3♠ แล้วกองทิ้งเป็น A-2-3 → โดน', r22e.full === true, r22e);

// ---------------------------------------------------------------
section('2.1 + 2.2 พร้อมกัน → หัก -100 ครั้งเดียว (ไม่เกิน MAX_PENALTY_PER_DISCARD)');

var gBoth = {
  discardPile: ['5♥', '6♥'],
  melds: { p1: [], p2: [['8♥', '9♥', '10♥']] },
  hands: { p1: ['7♥'], p2: [] }
};
var rBoth = R.predictDiscardPenalty(gBoth, 'p1', '7♥');
ok('2.1 + 2.2 ทั้งสองกรณีติด', rBoth.dumy === true && rBoth.full === true, rBoth);
eq('2.1+2.2 หักรวม 100 ครั้งเดียว', rBoth.penalty, 100);
eq('MAX_PENALTY_PER_DISCARD = 100', R.MAX_PENALTY_PER_DISCARD, 100);

// ---------------------------------------------------------------
section('2.3 "สเปโต" — ทิ้งสเปโตที่มีการ์ดเกี่ยว → pending (ค้าง 1 รอบ)');

ok('2.3 การ์ดเกี่ยว: ตัวเลขเดียวกัน (2♣ กับ 2♠)', R.spetoRelated('2♣', ['2♠']) === true);
ok('2.3 การ์ดเกี่ยว: สีเดียวกันเลขติดกัน (2♣ กับ 3♣)', R.spetoRelated('2♣', ['3♣']) === true);
ok('2.3 การ์ดเกี่ยว: A ต่ำ (2♣ กับ A♣)', R.spetoRelated('2♣', ['A♣']) === true);
ok('2.3 การ์ดเกี่ยว: Q♠ กับ K♠', R.spetoRelated('Q♠', ['K♠']) === true);
ok('2.3 การ์ดเกี่ยว: Q♠ กับ J♠', R.spetoRelated('Q♠', ['J♠']) === true);
ok('2.3 การ์ดเกี่ยว: Q♠ กับ A♠', R.spetoRelated('Q♠', ['A♠']) === true);
ok('2.3 การ์ดเกี่ยว: Q♠ กับ Q♥ (ตัวเลขเดียวกัน)', R.spetoRelated('Q♠', ['Q♥']) === true);
ok('2.3 ไม่เกี่ยว: 2♣ กับ 9♣', R.spetoRelated('2♣', ['9♣']) === false);
ok('2.3 ไม่เกี่ยว: 2♣ กับ 2♣ (ใบเดียวกัน)', R.spetoRelated('2♣', ['2♣']) === false);
ok('2.3 ไม่เกี่ยว: ไม่ใช่สเปโต', R.spetoRelated('5♥', ['4♥']) === false);

var g23 = { discardPile: ['2♠'], melds: {}, hands: { p1: ['2♣'] } };
var r23 = R.predictDiscardPenalty(g23, 'p1', '2♣');
ok('2.3 ทิ้ง 2♣ ที่มี 2♠ อยู่กองทิ้ง → เกิด pending', r23.speto === true, r23);
eq('2.3 ยังไม่หักแต้มตอนทิ้ง', r23.penalty, 0);

var g23b = { discardPile: ['9♣'], melds: {}, hands: { p1: ['2♣'] } };
var r23b = R.predictDiscardPenalty(g23b, 'p1', '2♣');
ok('2.3 ทิ้ง 2♣ ที่กองทิ้งไม่มีการ์ดเกี่ยว → ไม่เกิด pending', r23b.speto === false, r23b);

// --- pending: ภายใน 1 รอบมีคน MELD → คนทิ้งโดน -100 ---
var N = 4;                                   // ผู้เล่น 4 คน
var turnSeq = 0;                             // ก่อนทิ้ง
var pending = {};
pending['2♣'] = R.makeSpetoPending('2♣', 'p1', turnSeq, N);
eq('pending หมดอายุที่ turnSeq = 1 + (4-1) = 4', pending['2♣'].expiresAtTurn, 4);

var trig = R.pendingTrigger(pending, '2♣', 1);
ok('2.3 ภายใน 1 รอบ (turnSeq=1) มีคน MELD → คนทิ้ง p1 โดน -100',
   !!trig && trig.discarder === 'p1' && trig.penalty === 100, trig);

trig = R.pendingTrigger(pending, '2♣', 3);
ok('2.3 ยังอยู่ในรอบ (turnSeq=3) → โดน -100', !!trig, trig);

trig = R.pendingTrigger(pending, '2♣', 4);
ok('2.3 ผ่าน 1 รอบแล้ว (turnSeq=4) → รอด ไม่โดนโทษ', trig === null, trig);

var pruned = R.pruneExpiredPending(pending, 4);
eq('2.3 pending หมดอายุถูกลบเมื่อถึงตาคนทิ้ง', Object.keys(pruned).length, 0);

var pruned2 = R.pruneExpiredPending(pending, 3);
eq('2.3 pending ยังอยู่ถ้ายังไม่ครบรอบ', Object.keys(pruned2).length, 1);

// --- 2 คน: หมดอายุเร็วขึ้น ---
var pending2p = {};
pending2p['Q♠'] = R.makeSpetoPending('Q♠', 'p2', 0, 2);
eq('pending 2 คน หมดอายุที่ turnSeq = 1 + 1 = 2', pending2p['Q♠'].expiresAtTurn, 2);
ok('2.3 ภายใน 1 รอบ (2 คน) มีคน MELD → โดน', !!R.pendingTrigger(pending2p, 'Q♠', 1));
ok('2.3 ผ่าน 1 รอบ (2 คน) → รอด', R.pendingTrigger(pending2p, 'Q♠', 2) === null);

// ---------------------------------------------------------------
section('FIX v41.1 — โทษรวมต่อ 1 การทิ้งไม่เกิน 100 (2.3 ซ้อนกับ 2.1/2.2)');

var gStack = {
  discardPile: ['2♠'],
  melds: { p1: [], p2: [['2♥', '2♦', '2♠']] },
  hands: { p1: ['2♣'], p2: [] }
};
var rStack = R.predictDiscardPenalty(gStack, 'p1', '2♣');
ok('ซ้อนกัน: 2.1 (ตอง) + 2.3 (สเปโต) พร้อมกัน', rStack.dumy === true && rStack.speto === true, rStack);
eq('หักทันที 100', rStack.penalty, 100);
eq('2.3 ไม่หักซ้ำ (รวมต่อการทิ้ง = 100)', rStack.spetoPendingPenalty, 0);
eq('รวมทั้งหมด = 100', rStack.totalPenalty, 100);

var gStack2 = {
  discardPile: ['2♠'],
  melds: { p1: [], p2: [] },
  hands: { p1: ['2♣'], p2: [] }
};
var rStack2 = R.predictDiscardPenalty(gStack2, 'p1', '2♣');
eq('2.3 อย่างเดียว (ไม่มี 2.1/2.2) → pending หัก 100', rStack2.spetoPendingPenalty, 100);
eq('รวม = 100', rStack2.totalPenalty, 100);

var pendStack = R.makeSpetoPending('2♣', 'p1', 0, 4, true);
ok('pending จำได้ว่าถูกหักไปแล้ว', pendStack.alreadyPenalized === true, pendStack);
var trigStack = R.pendingTrigger({ '2♣': pendStack }, '2♣', 1);
ok('MELD แล้วไม่หักซ้ำ', trigStack && trigStack.penalty === 0, trigStack);

var pendNo = R.makeSpetoPending('2♣', 'p1', 0, 4, false);
var trigNo = R.pendingTrigger({ '2♣': pendNo }, '2♣', 1);
ok('ยังไม่เคยถูกหัก → MELD แล้วหัก 100', trigNo && trigNo.penalty === 100, trigNo);

// ---------------------------------------------------------------
section('เครื่องมือพื้นฐาน');
eq('rank 10♣', R.rank('10♣'), '10');
eq('suit Q♠', R.suit('Q♠'), '♠');
eq('rankVal A = 1 (ต่ำ)', R.rankVal('A♠', false), 1);
eq('rankVal A = 14 (สูง)', R.rankVal('A♠', true), 14);
ok('isSetOf: 2♣ 2♥ 2♦ = ตอง', R.isSetOf(['2♣', '2♥', '2♦']) === true);
ok('isSetOf: 2♣ 2♥ 3♦ ≠ ตอง', R.isSetOf(['2♣', '2♥', '3♦']) === false);
ok('isRunOf: A♠ 2♠ 3♠ = เรียง (A ต่ำ)', R.isRunOf(['A♠', '2♠', '3♠']) === true);
ok('isRunOf: K♠ A♠ 2♠ ≠ เรียง', R.isRunOf(['K♠', 'A♠', '2♠']) === false);
ok('isRunOf: สเปโตเข้าชุดเรียงไม่ได้', R.isRunOf(['2♣', '3♣', '4♣']) === false);
ok('meldType: ตอง', R.meldType(['5♥', '5♦', '5♠']) === 'set');
ok('meldType: เรียง', R.meldType(['5♥', '6♥', '7♥']) === 'run');
ok('meldType: ไม่ครบ', R.meldType(['5♥', '7♥', '9♥']) === null);
ok('canLayoff: 6♥ ต่อ 3-4-5', R.canLayoff('6♥', ['3♥', '4♥', '5♥']) === true);
ok('canLayoff: 2♥ ต่อ 3-4-5', R.canLayoff('2♥', ['3♥', '4♥', '5♥']) === true);
ok('canLayoff: 7♥ ต่อ 3-4-5', R.canLayoff('7♥', ['3♥', '4♥', '5♥']) === false);
ok('canLayoff: A♠ ต่อ 2-3-4 (A ต่ำ)', R.canLayoff('A♠', ['2♠', '3♠', '4♠']) === true);
ok('canLayoff: สีผิด', R.canLayoff('6♦', ['3♥', '4♥', '5♥']) === false);

// ---------------------------------------------------------------
console.log('\n==========================================');
console.log(' ผ่าน: ' + pass + '  |  ไม่ผ่าน: ' + fail);
console.log('==========================================');
if (fail > 0) process.exit(1);
