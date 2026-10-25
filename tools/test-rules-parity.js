// ============================================================
// 🔬 PARITY TEST — กติกาฝั่ง client (JS) ต้องตรงกับ server (SQL) 100%
//   เทียบ 2 อย่างที่ผิดพลาดแล้วเกมพังได้ทันที:
//     1) detectMeldType(codes)      vs  rummy_meld_type(codes)
//     2) SpetoRules.canLayoff(card, meld) vs rummy_can_layoff(card, meld)
//   สุ่มการ์ดจากสำรับ 52 ใบจริง (รวมสเปโต 2♣ / Q♠) หลายพันเคส
//   รัน: node tools/test-rules-parity.js
// ============================================================
var fs = require('fs');
var path = require('path');
var os = require('os');
var { execFileSync } = require('child_process');
var ROOT = path.join(__dirname, '..');

// ---------- โหลดกติกาฝั่ง client ----------
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

// ---------- สำรับจริง 52 ใบ ----------
var RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
var SUITS = ['♠','♥','♦','♣'];
var DECK = [];
RANKS.forEach(function(r){ SUITS.forEach(function(s){ DECK.push(r + s); }); });
if (DECK.length !== 52) throw new Error('deck ไม่ใช่ 52 ใบ');

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function sample(arr, n) {
  var c = arr.slice(), out = [];
  n = Math.min(n, c.length);
  for (var i = 0; i < n; i++) out.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]);
  return out;
}

// ---------- edge cases แบบกำหนด (ไม่สุ่ม — ใช้กัน regress) ----------
var EDGE = [
  // meld
  { type:'meld', codes:['A♥','2♥','3♥'] },        // ❌ A ต่ำต้องไม่เกิด
  { type:'meld', codes:['K♠','A♠','2♠'] },        // ❌ K-A-2 ไม่เกิด
  { type:'meld', codes:['Q♥','K♥','A♥'] },        // ✅ A สูงสุด
  { type:'meld', codes:['J♥','Q♥','K♥','A♥'] },    // ✅ 4 ใบ
  { type:'meld', codes:['10♥','J♥','Q♥','K♥','A♥'] }, // ✅ 5 ใบ
  { type:'meld', codes:['5♥','5♦','5♣'] },        // ✅ ตอง
  { type:'meld', codes:['5♥','5♦','5♣','5♠'] },    // ✅ ตอง 4 ใบ
  { type:'meld', codes:['2♠','2♠','2♠'] },        // ❌ ไพ่ซ้ำ
  { type:'meld', codes:['5♥','7♣','K♠'] },        // ❌ ไม่ใช่ชุด
  { type:'meld', codes:['Q♠','K♠','A♠'] },        // ✅ A สูงสุด (Q♠ ยังเป็นตองได้)
  { type:'meld', codes:['2♣','3♣','4♣'] },        // ✅ 2♣ = สเปโต แต่เป็นการ์ดปกติในชุดเรียง
  { type:'meld', codes:['Q♠','J♠','10♠'] },       // ✅ เรียง Q♠
  { type:'meld', codes:['2♣','2♥','2♦'] },        // ✅ ตองรวมสเปโต
  // layoff
  { type:'layoff', card:'A♥', meld:['Q♥','K♥'] },       // ✅ A ต่อบน K
  { type:'layoff', card:'2♥', meld:['Q♥','K♥'] },       // ❌ 2 ไม่ติด K
  { type:'layoff', card:'4♥', meld:['Q♥','K♥'] },       // ✅ 4 ไม่ใช่ ... ข้ามไป (ไม่ติด)
  { type:'layoff', card:'Q♠', meld:['J♥','K♥'] },       // ❌ สีไม่เหมือน
  { type:'layoff', card:'Q♠', meld:['J♠','K♠'] },       // ✅ สเปโตต่อชุดเรียง? (ไม่อนุญาต)
  { type:'layoff', card:'5♥', meld:['5♠','5♦','5♣'] },  // ✅ ตอง
  { type:'layoff', card:'5♥', meld:['5♠','5♦','5♥'] },  // ❌ ซ้ำสำเนาในชุด
  { type:'layoff', card:'2♣', meld:['3♠','3♦','3♣'] },  // ✅ สเปโตต่อชุดตอง
  { type:'layoff', card:'2♣', meld:['4♠','5♠','6♠'] },  // ❌ สเปโตต่อชุดเรียง
];

// ---------- เคสทดสอบ ----------
var N = Number(process.argv[2] || 1500);
var cases = [];   // {type:'meld'|'layoff', codes:[], card}
EDGE.forEach(function(e) {
  cases.push(e.type === 'meld' ? { type:'meld', codes:e.codes } : { type:'layoff', codes:e.meld, card:e.card });
});
for (var i = 0; i < N; i++) {
  var kind = i % 2 === 0 ? 'meld' : 'layoff';
  var n = 3 + Math.floor(Math.random() * 3);        // 3..5 ใบ
  var codes = sample(DECK, n);
  if (kind === 'meld') {
    cases.push({ type: 'meld', codes: codes });
  } else {
    var meld = sample(DECK, 3);
    var card = pick(DECK);
    cases.push({ type: 'layoff', codes: meld, card: card });
  }
}

// ---------- ผลจาก client ----------
var clientOut = cases.map(function(c, idx) {
  if (c.type === 'meld') {
    var t = G.detectMeldType(c.codes);
    return { idx: idx, type: 'meld', client: (t === 'ตอง' ? 'set' : t === 'เรียง' ? 'run' : null) };
  }
  var can = SR.canLayoff(c.card, c.codes);
  return { idx: idx, type: 'layoff', client: !!can };
});

// ---------- ผลจาก server (SQL) ----------
function q(arr) {
  return "ARRAY[" + arr.map(function(c){ return "'" + c.replace(/'/g, "''") + "'"; }).join(',') + "]";
}
var sel = cases.map(function(c, idx) {
  if (c.type === 'meld') {
    return "SELECT " + idx + " AS idx, COALESCE(rummy_meld_type(" + q(c.codes) + "), 'NULL') AS r";
  }
  return "SELECT " + idx + " AS idx, rummy_can_layoff('" + c.card.replace(/'/g,"''") + "', " + q(c.codes) + ")::text AS r";
}).join("\n UNION ALL ");

var sqlFile = path.join(os.tmpdir(), 'parity-' + Date.now() + '.sql');
fs.writeFileSync(sqlFile, sel + "\n", 'utf8');
var out = execFileSync('psql', ['-d', (process.env.RUMMY_TEST_DB || 'rummytest'), '-A', '-t', '-F', '|', '-f', sqlFile], {
  env: Object.assign({}, process.env, { PGHOST: '/tmp/pgtest', PGPORT: '55432', PGUSER: 'postgres' }),
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
});
fs.unlinkSync(sqlFile);

// ---------- มิติที่ 3: สเปโตเกี่ยวกัน (2.3) ----------
var SPETO_CASES = [];
for (var si = 0; si < 400; si++) {
  var sp = (si % 2 === 0) ? '2♣' : 'Q♠';
  var pile = sample(DECK.filter(function(c){ return c !== sp; }), 2 + Math.floor(Math.random() * 5));
  SPETO_CASES.push({ speto: sp, pile: pile, client: !!SR.spetoRelated(sp, pile) });
}
var ssel = SPETO_CASES.map(function(c, i) {
  return "SELECT " + i + " AS idx, rummy_speto_related('" + c.speto + "', " + q(c.pile) + ")::text AS r";
}).join("\n UNION ALL ");
var sfile2 = path.join(os.tmpdir(), 'parity-sp-' + Date.now() + '.sql');
fs.writeFileSync(sfile2, ssel + "\n", 'utf8');
var sout = execFileSync('psql', ['-d', (process.env.RUMMY_TEST_DB || 'rummytest'), '-A', '-t', '-F', '|', '-f', sfile2], {
  env: Object.assign({}, process.env, { PGHOST: '/tmp/pgtest', PGPORT: '55432', PGUSER: 'postgres' }),
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
});
fs.unlinkSync(sfile2);
var spServer = {};
sout.split('\n').forEach(function(line) {
  line = line.trim(); if (!line) return;
  var pp = line.split('|'); spServer[Number(pp[0])] = pp[1] === 'true';
});
var mismSpeto = SPETO_CASES.filter(function(c, i) { return spServer[i] !== c.client; });

var serverMap = {};
out.split('\n').forEach(function(line) {
  line = line.trim();
  if (!line) return;
  var p = line.split('|');
  serverMap[Number(p[0])] = p[1];
});

// ---------- เทียบ ----------
var mismMeld = [], mismLayoff = [];
for (var j = 0; j < cases.length; j++) {
  var c = cases[j], co = clientOut[j];
  var sv = serverMap[co.idx];
  if (co.type === 'meld') {
    var cn = co.client === null ? 'NULL' : co.client;
    if (cn !== sv) mismMeld.push({ codes: c.codes, client: cn, server: sv });
  } else {
    var svb = (sv === 'true');
    if (svb !== co.client) mismLayoff.push({ card: c.card, meld: c.codes, client: co.client, server: svb });
  }
}

console.log('==========================================');
console.log(' 🔬 PARITY: client (JS) vs server (SQL) — ' + cases.length + ' เคส');
console.log('==========================================');
console.log('🔸 เกิดชุด (detectMeldType vs rummy_meld_type): ' + cases.filter(function(c){return c.type==='meld';}).length + ' เคส → ไม่ตรง ' + mismMeld.length);
console.log('🔸 ฝาก (canLayoff vs rummy_can_layoff): ' + cases.filter(function(c){return c.type==='layoff';}).length + ' เคส → ไม่ตรง ' + mismLayoff.length);
console.log('🔸 สเปโตเกี่ยว (spetoRelated vs rummy_speto_related): ' + SPETO_CASES.length + ' เคส → ไม่ตรง ' + mismSpeto.length);

function show(list, max) {
  list.slice(0, max || 12).forEach(function(m) {
    if (m.codes) console.log('   ❌ ' + JSON.stringify(m.codes) + ' → client=' + m.client + ' server=' + m.server);
    else console.log('   ❌ ฝาก ' + m.card + ' ลง ' + JSON.stringify(m.meld) + ' → client=' + m.client + ' server=' + m.server);
  });
  if (list.length > (max || 12)) console.log('   ... อีก ' + (list.length - (max || 12)) + ' เคส');
}
if (mismSpeto.length) {
  console.log('\n— สเปโตเกี่ยวไม่ตรง —');
  mismSpeto.slice(0, 12).forEach(function(m) {
    console.log('   ❌ ' + m.speto + ' + ' + JSON.stringify(m.pile) + ' → client=' + m.client + ' server=' + spServer[SPETO_CASES.indexOf(m)]);
  });
}
if (mismMeld.length) { console.log('\n— เกิดชุดไม่ตรง —'); show(mismMeld); }
if (mismLayoff.length) { console.log('\n— ฝากไม่ตรง —'); show(mismLayoff); }

var total = mismMeld.length + mismLayoff.length + mismSpeto.length;
if (total === 0) {
  console.log('\n✅ กติกาฝั่ง client ตรงกับ server 100% — ไม่มีจุดที่ client อนุญาตแต่ server ปฏิเสธ');
  process.exit(0);
} else {
  console.log('\n❌ พบ ' + total + ' จุดที่ client กับ server ไม่ตรงกัน');
  process.exit(1);
}
