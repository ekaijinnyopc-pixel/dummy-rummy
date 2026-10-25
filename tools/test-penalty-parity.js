// ============================================================
// 🔬 PENALTY PARITY — กติกาโทษ 2.1 / 2.2 / 2.3 ฝั่ง client ต้องตรง server
//   client: SpetoRules.predictDiscardPenalty(game, pid, cardCode)
//   server: play_turn(..., 'DISCARD') → {penalty, dumy, full} + game.spetoPending
//   🔒 กติกาที่ห้ามแตะ (พี่เอยืนยัน):
//     2.1 ทิ้งดัมมี่ = -100 · 2.2 ตีเต็ม = -100 · 2.1+2.2 = -100 เดียว
//     2.3 สเปโต = -100 เพิ่ม (ซ้อนกับ 2.1/2.2 = รวม 200)
//   รัน: node tools/test-penalty-parity.js
// ============================================================
var fs = require('fs');
var path = require('path');
var os = require('os');
var { execFileSync } = require('child_process');
var ROOT = path.join(__dirname, '..');

var sr = fs.readFileSync(path.join(ROOT, 'speto-rules.js'), 'utf8');
(0, eval)(sr + '\n;globalThis.SpetoRules = (typeof SpetoRules !== "undefined" ? SpetoRules : globalThis.SpetoRules);');
var SR = global.SpetoRules;

var RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
var SUITS = ['♠','♥','♦','♣'];
var DECK = [];
RANKS.forEach(function(r){ SUITS.forEach(function(s){ DECK.push(r + s); }); });

function rnd(n) { return Math.floor(Math.random() * n); }
function sample(arr, n) {
  var c = arr.slice(), out = [];
  n = Math.min(n, c.length);
  for (var i = 0; i < n; i++) out.push(c.splice(rnd(c.length), 1)[0]);
  return out;
}
function randSet(pool) {
  var r = RANKS[rnd(13)], s = sample(SUITS, 3);
  return [r + s[0], r + s[1], r + s[2]];
}
function randRun(pool) {
  var start = rnd(10), suit = SUITS[rnd(4)], len = 3 + rnd(3), codes = [];
  for (var i = 0; i < len; i++) {
    var idx = start + i;
    codes.push((idx >= 13 ? 'A' : String(idx + 2)) + suit);
  }
  return codes;
}

// ---------- สร้างเคส (เจาะจงให้เกิดโทษจริง ไม่ใช่สุ่มเปล่า ๆ) ----------
var N = Number(process.argv[2] || 150);
var cases = [];
for (var ci = 0; ci < N; ci++) {
  var kind = ci % 5;            // 0=2.1 ดัมมี่ · 1=2.2 ตีเต็ม · 2=2.3 สเปโต · 3=2.1+2.2 ซ้อน · 4=ธรรมดา
  var nPlayers = 2 + rnd(2);
  var pids = [];
  for (var p = 0; p < nPlayers; p++) pids.push('p' + (p + 1));
  var ko = pids[0], other = pids[1];
  var pool = DECK.slice();
  var melds = {}, hands = {}, pile = [], card = null;

  function take(codes) {
    var ok = codes.filter(function(c){ return pool.indexOf(c) >= 0; });
    pool = pool.filter(function(c){ return ok.indexOf(c) < 0; });
    return ok;
  }
  function newPile(codes) { pile = codes.slice(); }

  // สร้างชุดบนโต๊ะของ "other" (ตอง 3 ใบ) — ใช้ทั้งเป็นเป้าหมาย 2.1 และเป็นตัวช่วย 2.2
  var baseRank = RANKS[rnd(12) + 1];      // ไม่ใช่ A (ให้เลขที่ต่อกันได้)
  // ตอง 3 ใบ (เหลือสำเนา 1 ใบไว้เป็น "ไพ่ที่ฝากต่อได้" → 2.1)
  var allSuits = SUITS.slice();
  var spareSuit = allSuits.splice(rnd(4), 1)[0];
  var setCodes = take(allSuits.map(function(s){ return baseRank + s; }));
  var otherMelds = setCodes.length >= 3 ? [setCodes] : [];
  var candSuit = spareSuit;

  if (kind === 0 || kind === 3) {
    // 2.1: ไพ่ที่ทิ้งฝากต่อชุดของ other ได้ → ต้องเป็นเลขเดียวกับชุด (คนละสำเนา)
    var cand = baseRank + candSuit;
    card = take([cand])[0] || null;
  } else {
    // เตรียมชุดเรียงของ other เพิ่ม เพื่อให้ 2.1 มีโอกาส (ฝากต่อบน/ล่าง)
    var r2 = RANKS[rnd(10) + 2], s2 = SUITS[rnd(4)];
    var runCodes = take([r2 + s2, RANKS[RANKS.indexOf(r2) + 1] + s2, RANKS[RANKS.indexOf(r2) + 2] + s2]);
    if (runCodes.length >= 3) otherMelds.push(runCodes);
  }

  if (kind === 1 || kind === 3) {
    // 2.2: กองทิ้งมีไพ่ตัวเดียวกันอีก 2 ใบ → ทิ้งใบที่ 3 แล้วกองทิ้งเป็นตองครบ
    var r3 = RANKS[rnd(12) + 1], s3 = SUITS[rnd(4)];
    var two = take(SUITS.filter(function(s){ return s !== s3; }).slice(0, 2).map(function(s){ return r3 + s; }));
    newPile(two);
    var cand3 = take([r3 + s3])[0] || null;
    if (!card) card = cand3;
  } else if (kind === 2) {
    // 2.3: ทิ้งสเปโตทั้งที่กองทิ้งมีการ์ดเกี่ยว (Q♠ กับ K♠ / 2♣ กับ 3♣)
    if (rnd(2) === 0) {
      newPile(take(['K♠', '9♥']));
      card = take(['Q♠'])[0] || null;
    } else {
      newPile(take(['3♣', '9♥']));
      card = take(['2♣'])[0] || null;
    }
  } else {
    newPile(take(sample(pool, rnd(4))));
  }

  // มือ: ใส่ไพ่ที่จะทิ้ง + ไพ่อื่น
  var koHand = [];
  if (card) koHand.push(card);
  var extra = take(sample(pool, 1 + rnd(3)));
  koHand = koHand.concat(extra);
  pool = pool.filter(function(c){ return koHand.indexOf(c) < 0; });
  if (!koHand.length) { koHand = take(['7♠']); pool = pool.filter(function(c){ return koHand.indexOf(c) < 0; }); }
  card = koHand[rnd(koHand.length)];

  pids.forEach(function(pid) {
    melds[pid] = (pid === other) ? otherMelds : [];
    hands[pid] = (pid === ko) ? koHand.slice() : take(sample(pool, 1 + rnd(3)));
    pool = pool.filter(function(c){ return hands[pid].indexOf(c) < 0; });
  });

  cases.push({
    id: 'PP' + ci,
    game: {
      deck: pool, hands: hands, discardPile: pile,
      turnPlayerId: ko, playerOrder: pids, phase: 'action', status: 'playing',
      melds: melds, scores: {}, totalScores: {}, headCard: pile[0] || 'K♣', headPoints: 50,
      hasFirstMeld: {}, everMeld: {}, everPick: {},
      spettoPenalty: {}, spetoPending: {}, spettoPenaltyDone: {},
      spettoDiscardDone: {}, spetoOrigin: {}, hasDiscardedThisTurn: {},
      pickedFromDiscard: {}, turnSeq: 1, deckEmpty: false, version: 1
    },
    ko: ko, card: card, pids: pids
  });
}

// ---------- ผลฝั่ง client ----------
var clientRes = cases.map(function(c) {
  var r = SR.predictDiscardPenalty(c.game, c.ko, c.card);
  return { dumy: !!r.dumy, full: !!r.full, speto: !!r.speto, penalty: r.penalty, total: r.totalPenalty };
});

// ---------- ผลฝั่ง server ----------
function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function arrJson(a) { return "'" + JSON.stringify(a).replace(/'/g, "''") + "'::jsonb"; }
var sql = '';
cases.forEach(function(c) {
  sql += "INSERT INTO rooms (id, code, status, version, game) VALUES (" + lit(c.id) + ", " + lit(c.id) +
         ", 'playing', 1, " + arrJson(c.game) + ") ON CONFLICT (id) DO UPDATE SET game = EXCLUDED.game, version = 1, status = 'playing';\n";
  sql += "SELECT " + lit(c.id) + " || '|' || COALESCE((play_turn(" + lit(c.id) + ", " + lit(c.ko) +
         ", 'DISCARD', " + lit(c.card) + ", NULL, NULL, NULL, NULL, 1))::text, 'ERR') AS line;\n";
});
sql += "DELETE FROM rooms WHERE id LIKE 'PP%';\n";

var f = path.join(os.tmpdir(), 'penparity-' + Date.now() + '.sql');
fs.writeFileSync(f, sql, 'utf8');
var out = execFileSync('psql', ['-d', 'rummytest', '-A', '-t', '-F', '@@', '-f', f], {
  env: Object.assign({}, process.env, { PGHOST: '/tmp/pgtest', PGPORT: '55432', PGUSER: 'postgres' }),
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
});
fs.unlinkSync(f);

var serverMap = {};
out.split('\n').forEach(function(line) {
  line = line.trim();
  if (!line || line.indexOf('|') < 0) return;
  var p = line.split('|');
  var key = p[0].trim();
  if (key.indexOf('PP') !== 0) return;
  try { serverMap[key] = JSON.parse(p.slice(1).join('|')); } catch (e) { serverMap[key] = { error: p.slice(1).join('|') }; }
});

// ---------- เทียบ ----------
var bad = [], stats = { dumy: 0, full: 0, speto: 0, both: 0 };
cases.forEach(function(c, i) {
  var cl = clientRes[i];
  var sv = serverMap[c.id];
  if (!sv || sv.ok === false) {
    bad.push({ id: c.id, why: 'server: ' + JSON.stringify(sv), client: cl });
    return;
  }
  if (cl.dumy) stats.dumy++;
  if (cl.full) stats.full++;
  if (cl.speto) stats.speto++;
  if (cl.dumy && cl.full) stats.both++;
  var diffs = [];
  if (!!sv.dumy !== cl.dumy) diffs.push('2.1 ดัมมี่: client=' + cl.dumy + ' server=' + !!sv.dumy);
  if (!!sv.full !== cl.full) diffs.push('2.2 ตีเต็ม: client=' + cl.full + ' server=' + !!sv.full);
  if (Number(sv.penalty) !== Number(cl.penalty)) diffs.push('โทษ: client=' + cl.penalty + ' server=' + sv.penalty);
  // 2.3: server ต้องตั้ง spetoPending เมื่อ (และเฉพาะเมื่อ) client ทายว่า speto
  var svPending = (sv.game && sv.game.spetoPending) || {};
  var svHasPending = !!svPending[c.card];
  if (svHasPending !== cl.speto) {
    diffs.push('2.3 pending: client=' + cl.speto + ' server=' + svHasPending);
  }
  if (diffs.length) {
    bad.push({ id: c.id, card: c.card, diffs: diffs, client: cl, server: sv,
               pile: c.game.discardPile, melds: c.game.melds, ko: c.ko });
  }
});

console.log('==========================================');
console.log(' 🔬 PENALTY PARITY: 2.1 / 2.2 / 2.3 — ' + cases.length + ' เคส');
console.log('==========================================');
console.log('   ครอบคลุม: 2.1 ดัมมี่ ' + stats.dumy + ' · 2.2 ตีเต็ม ' + stats.full +
            ' · 2.3 สเปโต ' + stats.speto + ' · 2.1+2.2 ซ้อน ' + stats.both);
if (!bad.length) {
  console.log('✅ กติกาโทษฝั่ง client ตรงกับ server ทุกเคส');
  process.exit(0);
}
console.log('❌ ไม่ตรง ' + bad.length + ' / ' + cases.length + ' เคส');
bad.slice(0, 8).forEach(function(b) {
  console.log('--- ' + b.id + (b.card ? ' (ทิ้ง ' + b.card + ')' : ''));
  if (b.diffs) b.diffs.forEach(function(d){ console.log('     ' + d); });
  if (b.why) console.log('     ' + b.why);
  if (b.pile) console.log('     pile=' + JSON.stringify(b.pile) + ' melds=' + JSON.stringify(b.melds));
});
process.exit(1);
