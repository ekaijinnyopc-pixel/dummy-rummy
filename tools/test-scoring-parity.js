// ============================================================
// 🔬 SCORING PARITY — คะแนนฝั่ง client ต้องตรงกับ server (KNOCK branch)
//   client: computeRoundScoresFor(game, koId).roundScores
//   server: play_turn(..., 'KNOCK') → game.roundScores
//   สุ่มสถานะเกมหลายแบบ (มือ 0-5 ใบ · ชุดตอง/เรียง · โทษสเปโต · เกิด/ไม่เกิด)
//   รัน: node tools/test-scoring-parity.js
// ============================================================
var fs = require('fs');
var path = require('path');
var os = require('os');
var { execFileSync } = require('child_process');
var ROOT = path.join(__dirname, '..');

var sr = fs.readFileSync(path.join(ROOT, 'speto-rules.js'), 'utf8');
(0, eval)(sr + '\n;globalThis.SpetoRules = (typeof SpetoRules !== "undefined" ? SpetoRules : globalThis.SpetoRules);');
var SR = global.SpetoRules;

var src = fs.readFileSync(path.join(ROOT, 'game-core.js'), 'utf8');
var els = {};
function mkEl(id) {
  return { id: id, innerHTML: '', textContent: '', style: {}, className: '', disabled: false, value: '',
    classList: { add: function(){}, remove: function(){} }, addEventListener: function(){}, appendChild: function(){},
    querySelectorAll: function(){ return []; }, getAttribute: function(){ return ''; }, removeAttribute: function(){} };
}
global.document = { getElementById: function(id){ if(!els[id]) els[id]=mkEl(id); return els[id]; },
  querySelector: function(){ return mkEl('q'); }, querySelectorAll: function(){ return []; },
  createElement: function(){ return mkEl('new'); }, body: mkEl('b'), head: mkEl('h'), documentElement: mkEl('de'),
  addEventListener: function(){}, readyState: 'complete' };
global.window = global;
global.localStorage = { getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} };
global.sessionStorage = global.localStorage;
global.navigator = { userAgent: 'node' };
global.setInterval = function(){ return 0; }; global.clearInterval = function(){};
global.alert = function(){}; global.confirm = function(){ return true; };
global.fetch = function(){ return Promise.reject(new Error('no net')); };
global.supabase = { createClient: function(){ return {}; } };

var vm = require('vm');
var ctx = { console: { log: function(){}, warn: function(){}, error: function(){} }, setTimeout: setTimeout, clearTimeout: clearTimeout,
  Date: Date, Math: Math, JSON: JSON, Promise: Promise, document: global.document, window: global,
  localStorage: global.localStorage, sessionStorage: global.sessionStorage, navigator: global.navigator,
  alert: global.alert, confirm: global.confirm, fetch: global.fetch, supabase: global.supabase,
  setInterval: global.setInterval, clearInterval: global.clearInterval };
ctx.global = ctx; ctx.globalThis = ctx; ctx.SpetoRules = SR;
vm.createContext(ctx);
try { vm.runInContext(src, ctx, { filename: 'game-core.js' }); } catch (e) { console.log('⚠️ load: ' + e.message); }
var G = ctx;

// ---------- สร้างการ์ด ----------
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
function randSet() {
  var r = RANKS[rnd(13)], s = sample(SUITS, 3);
  return [r + s[0], r + s[1], r + s[2]];
}
function randRun() {
  var start = rnd(10);                    // เริ่มที่ 2..A
  var suit = SUITS[rnd(4)];
  var len = 3 + rnd(3);
  var codes = [];
  for (var i = 0; i < len; i++) {
    var idx = start + i;
    codes.push((idx >= 13 ? 'A' : String(idx + 2)) + suit);
  }
  return codes;
}

// ---------- เคสสุ่ม ----------
var N = Number(process.argv[2] || 120);
var cases = [];
for (var ci = 0; ci < N; ci++) {
  var nPlayers = 2 + rnd(2);                     // 2-3 คน
  var pids = [];
  for (var p = 0; p < nPlayers; p++) pids.push('p' + (p + 1));
  var koIdx = rnd(nPlayers);
  var hands = {}, melds = {}, hasFM = {}, everMeld = {}, everPick = {}, penalty = {};
  var deckLeft = DECK.slice();
  pids.forEach(function(pid, i) {
    var ko = (i === koIdx);
    var hsize = ko ? rnd(2) : rnd(6);            // ผู้น็อคเหลือ 0-1 ใบ
    var hand = sample(deckLeft, hsize);
    deckLeft = deckLeft.filter(function(c){ return hand.indexOf(c) < 0; });
    hands[pid] = hand;
    var nm = rnd(3);                             // 0-2 ชุด
    var ms = [];
    for (var m = 0; m < nm; m++) {
      var codes = (rnd(2) === 0) ? randSet() : randRun();
      codes = codes.filter(function(c){ return deckLeft.indexOf(c) >= 0; });
      deckLeft = deckLeft.filter(function(c){ return codes.indexOf(c) < 0; });
      if (codes.length >= 3) ms.push(codes);
    }
    melds[pid] = ms;
    var didMeld = ms.length > 0 || rnd(2) === 0;
    hasFM[pid] = didMeld && rnd(2) === 0;
    everMeld[pid] = didMeld;
    everPick[pid] = rnd(2) === 0;
    penalty[pid] = rnd(3) === 0 ? 100 : 0;
  });
  cases.push({
    id: 'SP' + ci,
    game: {
      deck: deckLeft, hands: hands, discardPile: [],
      turnPlayerId: pids[koIdx], playerOrder: pids,
      phase: 'action', status: 'playing',
      melds: melds, scores: {}, totalScores: {},
      headCard: 'K♣', headPoints: 50,
      hasFirstMeld: hasFM, everMeld: everMeld, everPick: everPick,
      spettoPenalty: penalty, spetoPending: {}, spettoPenaltyDone: {},
      spettoDiscardDone: {}, spetoOrigin: {}, hasDiscardedThisTurn: {},
      pickedFromDiscard: {}, turnSeq: 1, deckEmpty: false, version: 1
    },
    ko: pids[koIdx],
    pids: pids
  });
}

// ---------- ผลฝั่ง client ----------
var clientRes = cases.map(function(c) {
  var r = G.computeRoundScoresFor(c.game, c.ko);
  return r.roundScores;
});

// ---------- ผลฝั่ง server ----------
function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function arrJson(a) { return "'" + JSON.stringify(a).replace(/'/g, "''") + "'::jsonb"; }
var sql = '';
cases.forEach(function(c) {
  sql += "INSERT INTO rooms (id, code, status, version, game) VALUES (" + lit(c.id) + ", " + lit(c.id) +
         ", 'playing', 1, " + arrJson(c.game) + ") ON CONFLICT (id) DO UPDATE SET game = EXCLUDED.game, version = 1, status = 'playing';\n";
  sql += "SELECT " + lit(c.id) + " || '|' || COALESCE((play_turn(" + lit(c.id) + ", " + lit(c.ko) +
         ", 'KNOCK', NULL, NULL, NULL, NULL, NULL, 1)->'game'->'roundScores')::text, 'ERR') AS line;\n";
});
sql += "DELETE FROM rooms WHERE id LIKE 'SP%';\n";

var f = path.join(os.tmpdir(), 'scoreparity-' + Date.now() + '.sql');
fs.writeFileSync(f, sql, 'utf8');
var out = execFileSync('psql', ['-d', (process.env.RUMMY_TEST_DB || 'rummytest'), '-A', '-t', '-F', '@@', '-f', f], {
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
  var val = p.slice(1).join('|').trim();
  if (key.indexOf('SP') !== 0) return;
  serverMap[key] = val;
});

// ---------- เทียบ ----------
var bad = [];
cases.forEach(function(c, i) {
  var svRaw = serverMap[c.id];
  if (svRaw === undefined || svRaw === 'ERR') {
    bad.push({ id: c.id, why: 'server error', ko: c.ko, client: clientRes[i] });
    return;
  }
  var sv;
  try { sv = JSON.parse(svRaw); } catch (e) { bad.push({ id: c.id, why: 'parse: ' + svRaw.slice(0,80), client: clientRes[i] }); return; }
  var diffs = [];
  c.pids.forEach(function(pid) {
    var a = clientRes[i][pid], b = sv[pid];
    if (a === undefined || b === undefined) { diffs.push(pid + ': client=' + a + ' server=' + b); return; }
    if (Number(a) !== Number(b)) diffs.push(pid + ': client=' + a + ' server=' + b);
  });
  if (diffs.length) {
    bad.push({ id: c.id, ko: c.ko, diffs: diffs, client: clientRes[i], server: sv,
               hands: c.game.hands, melds: c.game.melds, hasFM: c.game.hasFirstMeld, everMeld: c.game.everMeld,
               penalty: c.game.spettoPenalty });
  }
});

// สถิติเพื่อยืนยันว่าเทสต์ครอบคลุมกรณีสำคัญจริง
var stats = { darkKnock: 0, koZeroHand: 0, koOneHand: 0, withPenalty: 0, noMeldPlayer: 0 };
cases.forEach(function(c) {
  var koHand = c.game.hands[c.ko] || [];
  if (koHand.length === 0) stats.koZeroHand++;
  if (koHand.length === 1) stats.koOneHand++;
  var koMelds = c.game.melds[c.ko] || [];
  var ever = c.game.everMeld[c.ko] || c.game.hasFirstMeld[c.ko] || koMelds.length > 0;
  if (!ever) stats.darkKnock++;
  c.pids.forEach(function(pid){ if ((c.game.spettoPenalty[pid] || 0) > 0) stats.withPenalty++; });
  c.pids.forEach(function(pid){
    if (!c.game.hasFirstMeld[pid] && (c.game.melds[pid]||[]).length === 0) stats.noMeldPlayer++;
  });
});
console.log('==========================================');
console.log(' 🔬 SCORING PARITY: client vs server (KNOCK) — ' + cases.length + ' เคส');
console.log('==========================================');
console.log('   ครอบคลุม: น็อคมืด(×2) ' + stats.darkKnock + ' · มือ 0 ใบ ' + stats.koZeroHand +
            ' · มือ 1 ใบ ' + stats.koOneHand + ' · มีโทษสเปโต ' + stats.withPenalty +
            ' · ผู้เล่นไม่เกิด ' + stats.noMeldPlayer);
if (!bad.length) {
  console.log('✅ คะแนนฝั่ง client ตรงกับ server ทุกเคส (ไม่มีจุดที่ต่างกัน)');
  process.exit(0);
}
console.log('❌ ไม่ตรง ' + bad.length + ' / ' + cases.length + ' เคส');
bad.slice(0, 8).forEach(function(b) {
  console.log('--- ' + b.id + (b.why ? ' (' + b.why + ')' : ' ko=' + b.ko));
  if (b.diffs) b.diffs.forEach(function(d){ console.log('     ' + d); });
  if (b.hands) console.log('     hands=' + JSON.stringify(b.hands) + ' melds=' + JSON.stringify(b.melds));
  if (b.hasFM) console.log('     hasFirstMeld=' + JSON.stringify(b.hasFM) + ' everMeld=' + JSON.stringify(b.everMeld) + ' penalty=' + JSON.stringify(b.penalty));
});
process.exit(1);
