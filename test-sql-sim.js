#!/usr/bin/env node
/**
 * SQL LOGIC SIMULATOR — จำลอง play_turn() ฝั่ง Postgres (plpgsql) เป็น JS
 * เพื่อทดสอบ FIX 3/4/5 (PICK_DISCARD, pickedFromDiscard, MUST_MELD_PICKED)
 * โดยไม่ต้อง apply SQL ลง DB
 *
 * ตรรกะนี้คัดลอกจาก FIX-layoff-2026-10-19.sql ทีละบรรทัด
 */
const fs = require('fs');
const SRC = fs.readFileSync('/data/.openclaw/workspace/dummy-rummy/game-core.js', 'utf8');
const KEY = SRC.split("const SUPABASE_KEY = '")[1].split("'")[0];

let pass = 0, fail = 0;
const check = (n, c, x) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (x ? ' — ' + x : ''))); };

// ---------- ตัวช่วยจำลอง Postgres ----------
const arr = (jsonbArr) => Array.isArray(jsonbArr) ? jsonbArr : [];
// v_discard[1:p_discard_index] → ตัวแรกถึงก่อนหน้า index (0-based)
const sliceBefore = (a, idx) => a.slice(0, idx);
// v_discard[idx+1:n] → ตั้งแต่ index นั้นเป็นต้นไป (0-based)
const sliceFrom = (a, idx) => a.slice(idx);

function playTurn(game, roomsVersion, p) {
  const g = JSON.parse(JSON.stringify(game));
  const v = { game: g, version: roomsVersion + 1 };
  const v_discard = arr(g.discardPile);
  const v_hands = g.hands || {};
  const v_melds = g.melds || {};
  const v_has_fm = g.hasFirstMeld || {};
  const v_current_pid = g.turnPlayerId;

  if (p.p_expected_version > 0 && roomsVersion !== p.p_expected_version) {
    return { ok: false, error: 'VERSION_MISMATCH' };
  }
  if (!['MELD', 'LAYOFF', 'END_TURN'].includes(p.p_action) && v_current_pid !== p.p_player_id) {
    return { ok: false, error: 'NOT_YOUR_TURN' };
  }

  if (p.p_action === 'PICK_DISCARD') {
    if (v_current_pid !== p.p_player_id) return { ok: false, error: 'NOT_YOUR_TURN' };
    if (p.p_discard_index < 0 || p.p_discard_index >= v_discard.length) return { ok: false, error: 'INVALID_INDEX' };
    // FIX 3
    const picked = sliceFrom(v_discard, p.p_discard_index);
    const kept = sliceBefore(v_discard, p.p_discard_index);
    const hand = arr(v_hands[p.p_player_id]);
    const newHand = hand.concat(picked);
    g.hands = { ...v_hands, [p.p_player_id]: newHand };
    g.discardPile = kept;
    // FIX 4
    g.pickedFromDiscard = { ...(g.pickedFromDiscard || {}), [p.p_player_id]: picked };
    g.phase = 'action';
    g.version = v.version;
    return { ok: true, game: g };
  }

  if (p.p_action === 'DISCARD') {
    if (v_current_pid !== p.p_player_id) return { ok: false, error: 'NOT_YOUR_TURN' };
    // FIX 5
    const picked = g.pickedFromDiscard?.[p.p_player_id] || [];
    if (picked.length > 0) return { ok: false, error: 'MUST_MELD_PICKED' };
    const hand = arr(v_hands[p.p_player_id]);
    if (!hand.includes(p.p_card_code)) return { ok: false, error: 'CARD_NOT_IN_HAND' };
    g.hands = { ...v_hands, [p.p_player_id]: hand.filter(c => c !== p.p_card_code) };
    g.discardPile = v_discard.concat([p.p_card_code]);
    g.hasDiscardedThisTurn = { ...(g.hasDiscardedThisTurn || {}), [p.p_player_id]: true };
    g.turnPlayerId = (g.playerOrder[(g.playerOrder.indexOf(v_current_pid) + 1) % g.playerOrder.length]);
    g.phase = 'draw';
    g.version = v.version;
    return { ok: true, game: g };
  }

  if (p.p_action === 'MELD') {
    const meldArr = p.p_meld_codes || [];
    if (!meldArr.length) return { ok: false, error: 'NO_MELD_CODES' };
    const hand = arr(v_hands[p.p_player_id]);
    for (const c of meldArr) if (!hand.includes(c)) return { ok: false, error: 'CARD_NOT_IN_HAND' };
    g.hands = { ...v_hands, [p.p_player_id]: hand.filter(c => !meldArr.includes(c)) };
    g.melds = { ...v_melds, [p.p_player_id]: (v_melds[p.p_player_id] || []).concat([meldArr]) };
    const isFirst = !v_has_fm[p.p_player_id];
    g.hasFirstMeld = { ...v_has_fm, [p.p_player_id]: true };
    // FIX 4 (ต่อ)
    g.pickedFromDiscard = { ...(g.pickedFromDiscard || {}), [p.p_player_id]: [] };
    g.version = v.version;
    return { ok: true, game: g, is_first_meld: isFirst };
  }

  if (p.p_action === 'DRAW_DECK') {
    const deck = arr(g.deck);
    if (!deck.length) { g.deckEmpty = true; g.phase = 'action'; return { ok: true, game: g, deckEmpty: true }; }
    const top = deck[deck.length - 1];
    g.deck = deck.slice(0, -1);
    g.hands = { ...v_hands, [p.p_player_id]: arr(v_hands[p.p_player_id]).concat([top]) };
    g.phase = 'action';
    g.hasDiscardedThisTurn = { ...(g.hasDiscardedThisTurn || {}), [p.p_player_id]: false };
    g.pickedFromDiscard = { ...(g.pickedFromDiscard || {}), [p.p_player_id]: [] };
    g.version = v.version;
    return { ok: true, game: g };
  }
  return { ok: false, error: 'UNKNOWN_ACTION' };
}

// ---------- scenario ----------
const P1 = 'p_aaa';
const base = {
  deck: ['K♠', 'Q♠', 'J♠'],
  hands: { [P1]: ['3♥', '4♥', '8♣'] },
  discardPile: ['7♣', '5♥', '9♦'],
  turnPlayerId: P1, playerOrder: [P1],
  phase: 'draw', status: 'playing',
  melds: { [P1]: [] }, scores: { [P1]: 0 },
  hasFirstMeld: { [P1]: false },
  hasDiscardedThisTurn: {}, pickedFromDiscard: {},
  deckEmpty: false, version: 1,
};

console.log('='.repeat(64));
console.log('SQL LOGIC SIMULATOR — ทดสอบ FIX 3/4/5 (PICK_DISCARD + pickedFromDiscard)');
console.log('='.repeat(64));
console.log('\nสถานการณ์: กองทิ้ง = [7♣, 5♥, 9♦]  | มือ = [3♥, 4♥, 8♣]');
console.log('หยิบใบที่ index 1 (5♥) → ตามกติกาต้องได้ 5♥ + 9♦ เข้ามือ, เหลือ 7♣ ในกองทิ้ง');

const totalBefore = 3 + 3 + 3; // hand + pile + deck

// TEST 1: PICK_DISCARD
console.log('\n--- TEST 1: PICK_DISCARD (index 1) ---');
let r = playTurn(base, 1, { p_player_id: P1, p_action: 'PICK_DISCARD', p_discard_index: 1, p_expected_version: 1 });
console.log(`  ok=${r.ok} error=${r.error || '-'}`);
check('PICK_DISCARD สำเร็จ', r.ok);
if (r.ok) {
  console.log(`  มือหลังหยิบ : ${JSON.stringify(r.game.hands[P1])}`);
  console.log(`  กองทิ้งหลัง : ${JSON.stringify(r.game.discardPile)}`);
  console.log(`  pickedFromDiscard : ${JSON.stringify(r.game.pickedFromDiscard[P1])}`);
  check('ไพ่ที่หยิบ (5♥) เข้ามือ', r.game.hands[P1].includes('5♥'), `มือ=${JSON.stringify(r.game.hands[P1])}`);
  check('ไพ่ที่อยู่บน (9♦) เข้ามือ', r.game.hands[P1].includes('9♦'));
  check('กองทิ้งเหลือเฉพาะ 7♣', JSON.stringify(r.game.discardPile) === '["7♣"]', JSON.stringify(r.game.discardPile));
  const totalAfter = r.game.hands[P1].length + r.game.discardPile.length + r.game.deck.length;
  check('ไพ่ไม่หายจากเกม (รวมคงเดิม = 9)', totalAfter === totalBefore, `ได้ ${totalAfter} จาก ${totalBefore}`);
  check('server บันทึก pickedFromDiscard', JSON.stringify(r.game.pickedFromDiscard[P1]) === '["5♥","9♦"]');
}

// TEST 2: ห้ามทิ้งถ้ายังไม่เกิด
console.log('\n--- TEST 2: บังคับ "ต้องเกิดใบที่หยิบก่อนทิ้ง" ---');
const gAfterPick = r.game;   // เก็บ state ก่อนทิ้งจริง
r = playTurn(gAfterPick, 2, { p_player_id: P1, p_action: 'DISCARD', p_card_code: '8♣', p_expected_version: 2 });
console.log(`  error = ${r.error}`);
check('ห้ามทิ้งก่อนเกิด (MUST_MELD_PICKED)', r.error === 'MUST_MELD_PICKED', r.error);

// TEST 3: เกิดใบที่หยิบ → แล้วทิ้งได้
console.log('\n--- TEST 3: เกิดใบที่หยิบ (5♥9♦ + อีกใบ) แล้วทิ้งได้ ---');
// สมมติมือมี 5♥ เพิ่มเพื่อให้เกิด 5♥ กับ 3♥4♥
const g2 = JSON.parse(JSON.stringify(gAfterPick));
g2.hands[P1] = ['3♥', '4♥', '5♥', '8♣', '5♥', '9♦'];
const r3 = playTurn(g2, 2, { p_player_id: P1, p_action: 'MELD', p_meld_codes: ['3♥', '4♥', '5♥'], p_expected_version: 2 });
console.log(`  MELD ok=${r3.ok} error=${r3.error || '-'} is_first_meld=${r3.is_first_meld}`);
check('เกิดสำเร็จ', r3.ok);
check('is_first_meld = true (บักเดิมเป็น false)', r3.is_first_meld === true, String(r3.is_first_meld));
check('pickedFromDiscard ถูกเคลียร์หลังเกิด', JSON.stringify(r3.game.pickedFromDiscard[P1]) === '[]');

const r4 = playTurn(r3.game, 3, { p_player_id: P1, p_action: 'DISCARD', p_card_code: '8♣', p_expected_version: 3 });
console.log(`  DISCARD ok=${r4.ok} error=${r4.error || '-'}`);
check('ทิ้งได้หลังเกิดแล้ว', r4.ok, r4.error);

// TEST 4: เทียบกับบักเดิม (logic เดิม)
console.log('\n--- TEST 4: จำลองบักเดิม เพื่อเปรียบเทียบ ---');
const oldPick = (game, idx) => {
  const g = JSON.parse(JSON.stringify(game));
  const d = arr(g.discardPile);
  g.discardPile = d.slice(0, idx);                    // เดิม: v_discard[1:idx]
  g.hands[P1] = arr(g.hands[P1]).concat(d.slice(0, idx)); // เดิม: เอา "ที่เหลือ" เข้ามือ
  return g;
};
const old = oldPick(base, 1);
console.log(`  บักเดิม → มือ=${JSON.stringify(old.hands[P1])} กองทิ้ง=${JSON.stringify(old.discardPile)}`);
const oldTotal = old.hands[P1].length + old.discardPile.length + old.deck.length;
check('บักเดิมทำให้ไพ่หาย (9 → ' + oldTotal + ')', oldTotal < totalBefore);
check('บักเดิมไม่ได้เอา 5♥ เข้ามือ', !old.hands[P1].includes('5♥'));
check('บักเดิมเอา 7♣ ซ้ำเข้ามือ (ทั้งที่ยังอยู่ในกองทิ้ง)', old.hands[P1].includes('7♣') && old.discardPile.includes('7♣'));

console.log('\n' + '='.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log('='.repeat(64));
process.exit(fail > 0 ? 1 : 0);
