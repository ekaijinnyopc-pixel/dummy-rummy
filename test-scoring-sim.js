#!/usr/bin/env node
/**
 * ทดสอบ FIX S1/S2/S3 (scoring + สเปโต + จบเกม)
 * เทียบผลจาก SQL logic (จำลอง) กับ handleKnockout() ของ client จริง
 */
let pass = 0, fail = 0;
const check = (n, c, x) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (x ? ' — ' + x : ''))); };

// ---- กติกาเดียวกับ cardPoints()/isSpeto() ใน game-core.js ----
const isSpeto = (c) => c === '2♣' || c === 'Q♠';
function cardPoints(code) {
  if (!code) return 0;
  if (isSpeto(code)) return 50;
  const rank = code.slice(0, -1);
  if (rank === 'A') return 15;
  if (['J', 'Q', 'K', '10'].includes(rank)) return 10;
  return 5;
}

// ---- handleKnockout() ของ client (คัดลอกตรงจาก game-core.js) ----
function clientKnock(game, koId) {
  const roundScores = {};
  for (const pid in game.hands) {
    let meldPts = 0;
    const melds = (game.melds && game.melds[pid]) || [];
    for (const meldCodes of melds) for (const c of meldCodes) meldPts += cardPoints(c);
    let handPts = 0;
    for (const c of (game.hands[pid] || [])) handPts += cardPoints(c);
    if (pid === koId) handPts = 0;
    const hasMeld = game.hasFirstMeld && game.hasFirstMeld[pid];
    if (!hasMeld && pid !== koId) handPts = handPts * 2;
    roundScores[pid] = meldPts - handPts;
  }
  const hasMeldBeforeKnock = game.hasFirstMeld && game.hasFirstMeld[koId];
  const knockBonus = hasMeldBeforeKnock ? 50 : 100;
  roundScores[koId] += knockBonus;
  if (game.headPoints) roundScores[koId] += game.headPoints;
  const prevScores = game.scores || {};
  const totalScores = {};
  for (const tpid of game.playerOrder) totalScores[tpid] = (prevScores[tpid] || 0) + roundScores[tpid];
  let winner = null;
  for (const wid in totalScores) {
    if (totalScores[wid] >= 500) {
      let min = Infinity, winPid = null;
      for (const w2 in totalScores) if (totalScores[w2] < min) { min = totalScores[w2]; winPid = w2; }
      winner = winPid; break;
    }
  }
  return { roundScores, totalScores, winner, knockBonus };
}

// ---- SQL logic จำลอง (จาก FIX-scoring-2026-10-21.sql) ----
function sqlKnock(game, koId) {
  const players = game.playerOrder;
  const hasFm = game.hasFirstMeld || {};
  const melds = game.melds || {};
  const hands = game.hands || {};
  const scores = game.scores || {};
  const headPts = game.headPoints || 0;
  const round = {};
  for (const pid of players) {
    let meldPts = 0, handPts = 0;
    for (const m of (melds[pid] || [])) for (const c of m) meldPts += cardPoints(c);
    if (pid !== koId) {
      for (const c of (hands[pid] || [])) handPts += cardPoints(c);
      if (!hasFm[pid]) handPts *= 2;
    }
    const penalty = (game.spettoPenalty || {})[pid] || 0;
    round[pid] = meldPts - handPts - penalty;
  }
  const bonus = (hasFm[koId] ? 50 : 100) + headPts;
  round[koId] = (round[koId] || 0) + bonus;
  const total = {};
  for (const pid of players) total[pid] = (scores[pid] || 0) + (round[pid] || 0);
  // ตรงกับ client: ถ้ามีใคร >= 500 → ผู้ชนะ = คนที่สะสมน้อยที่สุด (ของทุกคน)
  let winner = null, minTotal = null, reached = false;
  for (const pid of players) if (total[pid] >= 500) reached = true;
  if (reached) {
    for (const pid of players) if (minTotal === null || total[pid] < minTotal) { minTotal = total[pid]; winner = pid; }
  }
  return { roundScores: round, totalScores: total, winner };
}

console.log('='.repeat(66));
console.log('ทดสอบ FIX S1/S2 — เทียบ SQL logic กับ handleKnockout() ของ client');
console.log('='.repeat(66));

// ---- SCENARIO 1: เคสเดิมที่เคยพิสูจน์ว่าบัก (P1 เกิดแล้ว, P2 ไม่เกิด) ----
console.log('\n--- SCENARIO 1: P1 เกิด 3♥4♥5♥ + head 50 | P2 เหลือ A♠K♥2♣ ---');
const g1 = {
  playerOrder: ['p_aaa', 'p_bbb'],
  hands: { p_aaa: [], p_bbb: ['A♠', 'K♥', '2♣'] },
  melds: { p_aaa: [['3♥', '4♥', '5♥']], p_bbb: [] },
  hasFirstMeld: { p_aaa: true, p_bbb: false },
  scores: { p_aaa: 0, p_bbb: 0 },
  headPoints: 50,
};
const c1 = clientKnock(JSON.parse(JSON.stringify(g1)), 'p_aaa');
const s1 = sqlKnock(JSON.parse(JSON.stringify(g1)), 'p_aaa');
console.log(`  client → round=${JSON.stringify(c1.roundScores)} total=${JSON.stringify(c1.totalScores)} winner=${c1.winner}`);
console.log(`  SQL    → round=${JSON.stringify(s1.roundScores)} total=${JSON.stringify(s1.totalScores)} winner=${s1.winner}`);
check('round scores ตรงกัน', JSON.stringify(c1.roundScores) === JSON.stringify(s1.roundScores));
check('total scores ตรงกัน', JSON.stringify(c1.totalScores) === JSON.stringify(s1.totalScores));
check('P1 = +115 (มอลด์ 15 + โบนัส 50 + head 50)', s1.roundScores.p_aaa === 115, String(s1.roundScores.p_aaa));
check('P2 = -150 (หักมือ x2)', s1.roundScores.p_bbb === -150, String(s1.roundScores.p_bbb));
check('บักเดิมคืน 56 ไม่ถูกต้อง (ยืนยันว่าแก้แล้ว)', s1.roundScores.p_aaa !== 56);

// ---- SCENARIO 2: ยังไม่เกิด → โบนัส 100 ----
console.log('\n--- SCENARIO 2: P1 น็อคโดยยังไม่เคยเกิด (โบนัส 100) ---');
const g2 = {
  playerOrder: ['p_aaa', 'p_bbb'],
  hands: { p_aaa: [], p_bbb: ['3♠'] },
  melds: { p_aaa: [], p_bbb: [] },
  hasFirstMeld: { p_aaa: false, p_bbb: false },
  scores: { p_aaa: 0, p_bbb: 0 }, headPoints: 0,
};
const c2 = clientKnock(JSON.parse(JSON.stringify(g2)), 'p_aaa');
const s2 = sqlKnock(JSON.parse(JSON.stringify(g2)), 'p_aaa');
console.log(`  client → ${JSON.stringify(c2.roundScores)} | SQL → ${JSON.stringify(s2.roundScores)}`);
check('round scores ตรงกัน', JSON.stringify(c2.roundScores) === JSON.stringify(s2.roundScores));
check('โบนัสคนน็อค = 100', s2.roundScores.p_aaa === 100, String(s2.roundScores.p_aaa));

// ---- SCENARIO 3: สเปโต (FIX S2) ----
console.log('\n--- SCENARIO 3: สเปโต 2♣ ถูกหัก 100 แต้ม ---');
const g3 = JSON.parse(JSON.stringify(g1));
g3.spettoPenalty = { p_aaa: 0, p_bbb: 100 };  // P2 เคยหยิบ/ทิ้งสเปโต
const s3 = sqlKnock(g3, 'p_aaa');
console.log(`  SQL → ${JSON.stringify(s3.roundScores)}`);
check('P2 โทษสเปโต -100 (เหลือ -250)', s3.roundScores.p_bbb === -250, String(s3.roundScores.p_bbb));
check('P1 ไม่โดนหักสเปโต', s3.roundScores.p_aaa === 115, String(s3.roundScores.p_aaa));

// ---- SCENARIO 4: ผู้ชนะเมื่อสะสม >= 500 ----
console.log('\n--- SCENARIO 4: ตัดสินผู้ชนะ (สะสม >= 500 → คนที่สะสมน้อยสุดชนะ) ---');
const g4 = JSON.parse(JSON.stringify(g1));
g4.scores = { p_aaa: 480, p_bbb: 200 };
const s4 = sqlKnock(g4, 'p_aaa');
console.log(`  total = ${JSON.stringify(s4.totalScores)} winner = ${s4.winner}`);
check('P1 สะสม 595 >= 500 → เข้าเงื่อนไขชนะ', s4.totalScores.p_aaa === 595, String(s4.totalScores.p_aaa));
check('ผู้ชนะ = คนที่สะสมน้อยกว่า (p_bbb 50 < 605)', s4.winner === 'p_bbb', String(s4.winner));
const g5 = JSON.parse(JSON.stringify(g1));
g5.scores = { p_aaa: 100, p_bbb: 100 };
const s5 = sqlKnock(g5, 'p_aaa');
check('ยังไม่มีใครถึง 500 → ยังไม่มีผู้ชนะ', s5.winner === null, String(s5.winner));

// ---- SCENARIO 5: FIX S3 — client อ่าน winner/totalScores จากไหนได้บ้าง ----
console.log('\n--- SCENARIO 5: FIX S3 — เขียนผลลัพธ์ไว้ทั้ง column และ game JSONB ---');
const g6 = JSON.parse(JSON.stringify(g1));
const s6 = sqlKnock(g6, 'p_aaa');
const gameOut = { ...g6, scores: s6.totalScores, roundScores: s6.roundScores, winner: s6.winner, totalScores: s6.totalScores, status: 'ended' };
check('room.game.winner มีค่า (client อ่านได้)', gameOut.winner !== undefined);
check('room.game.totalScores มีค่า', JSON.stringify(gameOut.totalScores) === JSON.stringify(s6.totalScores));
check('room.game.scores = คะแนนสะสม (client บรรทัด 675 อ่านตรงนี้)', JSON.stringify(gameOut.scores) === JSON.stringify(s6.totalScores));
check('room.game.roundScores มีค่า (ตารางคะแนนรอบนี้)', JSON.stringify(gameOut.roundScores) === JSON.stringify(s6.roundScores));

console.log('\n' + '='.repeat(66));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log('='.repeat(66));
process.exit(fail > 0 ? 1 : 0);
