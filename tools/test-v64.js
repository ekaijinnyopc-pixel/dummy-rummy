// FIX v64 (2026-10-28, พี่เอ) — เทสต์บั๊ก 2 ข้อที่พี่เอเจอเล่นจริง
//   ① "ฝาก" กลุ่มไพ่ที่ตัวเองเกิดไม่ได้ → ทางเลือก A (อนุญาตฝากลงชุดของตัวเองได้)
//      · server เดิมมี guard LAYOFF_OWN_MELD (ตัวเลือก B = ห้าม) → ต้องไม่มีแล้วใน FIX-v64 SQL
//      · client ไม่เคยกรอง targetPid → ต้องมีเป้าหมาย "ชุดของตัวเอง"
//   ② หลัง "ฝาก" สำเร็จ ปุ่ม "🗑️ ทิ้ง" กลายเป็น disabled สีเทา จนกว่าจะ F5
//      · สาเหตุ: selectedCards ยังเก็บไพ่ที่ฝากไปแล้ว (ไม่อยู่บนมือ) → selStillInHand = false
//        → กดไพ่ใบอื่นก็ยังเทา (selectedCards.length = 2) → ต้อง F5 (ล้าง selectedCards)
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

// ---- โหลด speto-rules.js ----
var sr = fs.readFileSync(path.join(ROOT, 'speto-rules.js'), 'utf8');
(0, eval)(sr + '\n;globalThis.SpetoRules = (typeof SpetoRules !== "undefined" ? SpetoRules : globalThis.SpetoRules);');
var SpetoRulesGlobal = global.SpetoRules;
if (!SpetoRulesGlobal) { console.log('❌ โหลด speto-rules.js ไม่สำเร็จ'); process.exit(1); }

// ---- stub DOM ----
var els = {};
function el(id) {
  if (!els[id]) {
    els[id] = { id: id, innerHTML: '', textContent: '', value: '', disabled: false,
      style: {}, className: '', classList: { add: function(){}, remove: function(){} },
      addEventListener: function(){}, appendChild: function(){}, removeAttribute: function(){},
      getAttribute: function(){ return ''; }, querySelectorAll: function(){ return []; },
      getElementsByClassName: function(){ return []; } };
  }
  return els[id];
}
global.document = {
  getElementById: function(id){ return el(id); },
  querySelector: function(){ return el('_qs'); },
  querySelectorAll: function(){ return []; },
  createElement: function(){ return el('_new'); },
  body: el('_body'), head: el('_head'), documentElement: el('_de'),
  addEventListener: function(){}, readyState: 'complete'
};
global.window = global;
global.localStorage = {
  _s: {},
  getItem: function(k){ return this._s[k] === undefined ? null : this._s[k]; },
  setItem: function(k, v){ this._s[k] = String(v); },
  removeItem: function(k){ delete this._s[k]; }
};
global.sessionStorage = global.localStorage;
global.navigator = { userAgent: 'node' };
global.alert = function(){}; global.confirm = function(){ return true; };
global.fetch = function(){ return Promise.reject(new Error('no net')); };
global.supabase = { createClient: function(){ return {}; } };

var vm = require('vm');
var ctx = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Date: Date,
  Math: Math, JSON: JSON, Promise: Promise, document: global.document, window: global,
  localStorage: global.localStorage, sessionStorage: global.sessionStorage,
  navigator: global.navigator, alert: global.alert, confirm: global.confirm,
  fetch: global.fetch, supabase: global.supabase };
ctx.global = ctx; ctx.globalThis = ctx;
ctx.SpetoRules = SpetoRulesGlobal;
vm.createContext(ctx);
try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'game-core.js'), 'utf8'), ctx, { filename: 'game-core.js' }); }
catch (e) { console.log('⚠️ load game-core.js: ' + e.message); }

var G = ctx;
var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra ? ' → ' + extra : '')); }
}

function setup(hand, melds, picked, phase) {
  G.myPlayerId = 'me';
  G.roomCode = 'TEST64';
  G.currentGame = {
    phase: phase || 'action',
    hands: { me: hand.slice(), other: ['9♣'] },
    melds: melds || {},
    hasFirstMeld: { me: true },
    pickedFromDiscard: { me: picked || [] },
    discardPile: [],
    turnPlayerId: 'me',
    everMeld: { me: true }, everPick: { me: true }
  };
  G.selectedCards = [];
  G.pendingPickedCodes = [];
  G.myTurn = true;
  G.layoffTargets = [];
  G.hasDiscardedThisTurn = false;
}

console.log('==========================================');
console.log(' FIX v64 — ฝากลงชุดตัวเองได้ + ปุ่มทิ้งไม่ค้างหลังฝาก');
console.log('==========================================');

// ============================================================
// ข้อ 1: "ฝาก" ลงชุดของตัวเองได้ (ตัวเลือก A)
// ============================================================
// ชุดเรียงของตัวเอง (5-6-7♥) + ชุดเรียงของคนอื่น (5-6-7♠) + ไพ่ 4♥ / 4♠ ในมือ
setup(['4♥', '4♠', 'K♠'], { me: [['5♥', '6♥', '7♥']], other: [['5♠', '6♠', '7♠']] }, [], 'action');
var los = G.findAllLayoffs(['4♥', '4♠', 'K♠'], G.currentGame);
var ownRun = los.filter(function(l){ return l.targetPid === 'me' && l.layoffCard === '4♥'; });
ok('T1: ฝาก 4♥ ลงชุดเรียงของตัวเองได้ (client ไม่กรอง targetPid)',
  ownRun.length === 1, JSON.stringify(los));
ok('T2: ยังฝากลงชุดของคนอื่นได้ด้วย (ไม่กรองเฉพาะของตัวเอง)',
  los.some(function(l){ return l.targetPid === 'other' && l.layoffCard === '4♠'; }), JSON.stringify(los));
// ชุดตองของตัวเอง: มี 5♠ ในมือ → ฝากลงชุดตอง 5♠-6♠-7♠ ไม่ได้ (คนละหน้า) → ใช้ชุดตองจริง
setup(['7♣'], { me: [['7♠', '7♥', '7♦']], other: [] }, [], 'action');
var los2 = G.findAllLayoffs(['7♣'], G.currentGame);
ok('T3: ฝากลงชุดตองของตัวเองได้ (ตัวเลขเดียวกัน คนละสำเนา)',
  los2.some(function(l){ return l.targetPid === 'me' && l.layoffCard === '7♣'; }), JSON.stringify(los2));

// --- server: ต้องไม่มี guard LAYOFF_OWN_MELD ในไฟล์ SQL ที่จะรันบน live ---
var sqlV64 = fs.readFileSync(path.join(ROOT, 'FIX-v64-2026-10-28.sql'), 'utf8');
ok('T4: FIX-v64 SQL ไม่มี guard LAYOFF_OWN_MELD แล้ว',
  sqlV64.indexOf("'error', 'LAYOFF_OWN_MELD'") < 0);
ok('T5: FIX-v64 SQL ยังมี guard เดิมของ LAYOFF (anchor + must pick + meld first)',
  sqlV64.indexOf('CANNOT_LAYOFF_ANCHOR') > 0 &&
  sqlV64.indexOf('MUST_PICK_FIRST') > 0 &&
  sqlV64.indexOf('MUST_MELD_FIRST') > 0);
var sqlV61 = fs.readFileSync(path.join(ROOT, 'FIX-v61-2026-10-28.sql'), 'utf8');
ok('T6: FIX-v61 SQL (ไฟล์ค้างของพี่เอ) ถูกแก้ guard ออกแล้วด้วย',
  sqlV61.indexOf("'error', 'LAYOFF_OWN_MELD'") < 0);
// client ต้องมีตัวจัด error LAYOFF_OWN_MELD (ช่วงก่อนรัน SQL บน live)
var coreSrc = fs.readFileSync(path.join(ROOT, 'game-core.js'), 'utf8');
ok('T7: client มีตัวจัด error LAYOFF_OWN_MELD + ข้อความแนะนำ',
  coreSrc.indexOf("data.error === 'LAYOFF_OWN_MELD'") > 0);

// ============================================================
// ข้อ 2: หลังฝากสำเร็จ ปุ่ม "ทิ้ง" ต้องใช้ได้ต่อทันที (ไม่ต้อง F5)
// ============================================================
// เคสจริง: ผู้เล่นเลือกไพ่ที่จะทิ้งไว้ในมือ แล้วกด "ฝาก" ไพ่ใบเดียวกัน
//   → ไพ่นั้นหลุดจากมือ → selectedCards ยังเก็บไพ่ใบเก่า → ปุ่มทิ้งเทาค้าง
setup(['4♠', '9♥', '10♥'], { me: [['5♠', '6♠', '7♠']] }, [], 'action');
G.selectedCards = ['4♠'];
G.updateActionBtns();
ok('T8: ก่อนฝาก — เลือกไพ่ 1 ใบในมือ → ปุ่มทิ้งใช้ได้',
  el('btn-discard').disabled === false, 'disabled=' + el('btn-discard').disabled);

// จำลอง server: LAYOFF สำเร็จ → ไพ่ 4♠ ออกจากมือ (client จะได้ game state ใหม่)
var layoffCalls = [];
G.rpcPlayTurn = async function(action, opts) {
  layoffCalls.push({ action: action, opts: opts });
  var g = JSON.parse(JSON.stringify(G.currentGame));
  g.hands.me = g.hands.me.filter(function(c){ return c !== opts.cardCode; });
  g.version = (g.version || 1) + 1;
  G.currentGame = g;                     // เหมือน rpcPlayTurn จริง (currentGame = data.game)
  return { ok: true, game: g };
};
G.resetPlayerTimer = function(){};        // ไม่ให้ timer ค้างในเทสต์
G.closeLayoffModal = function(){};
G.notify = function(){};

var layoffTargets = [{ layoffCard: '4♠', meldIndex: 0, targetPid: 'me', meldType: 'เรียง' }];
G.layoffTargets = layoffTargets;

(async function main() {
  await G.selectLayoff(layoffTargets[0]);

  ok('T9: RPC ถูกเรียกด้วย action LAYOFF', layoffCalls.length === 1 && layoffCalls[0].action === 'LAYOFF',
    JSON.stringify(layoffCalls));
  ok('T10: เป้าหมายคือชุดของตัวเอง (targetPid = me) — client ส่งได้เลย',
    layoffCalls[0] && layoffCalls[0].opts.targetPid === 'me' && layoffCalls[0].opts.targetMeldIdx === 0,
    JSON.stringify(layoffCalls[0] && layoffCalls[0].opts));
  ok('T11: ไพ่ที่ฝากไปแล้วถูกตัดออกจาก "ที่เลือก" (ไม่ค้างให้กด F5)',
    Array.isArray(G.selectedCards) && G.selectedCards.indexOf('4♠') < 0,
    JSON.stringify(G.selectedCards));
  ok('T12: เลือกไพ่ใบใหม่ในมือ → ปุ่มทิ้งใช้ได้ทันที (ไม่ต้อง F5)',
    (function(){
      G.toggleSelect('9♥');
      return el('btn-discard').disabled === false;
    })(), 'disabled=' + el('btn-discard').disabled + ' sel=' + JSON.stringify(G.selectedCards));

  // เคส 2: เลือกไพ่ที่จะทิ้งไว้ แล้วฝากไพ่ใบอื่น → ปุ่มทิ้งต้องยังใช้ได้
  setup(['4♠', '9♥', '10♥'], { me: [['5♠', '6♠', '7♠']] }, [], 'action');
  G.selectedCards = ['9♥'];
  G.updateActionBtns();
  ok('T13: เลือกไพ่ที่จะทิ้งไว้ (9♥) → ปุ่มทิ้งใช้ได้',
    el('btn-discard').disabled === false, 'disabled=' + el('btn-discard').disabled);
  await G.selectLayoff({ layoffCard: '4♠', meldIndex: 0, targetPid: 'me', meldType: 'เรียง' });
  ok('T14: ฝากไพ่ใบอื่นแล้ว → ปุ่มทิ้งยังใช้ได้ทันที (ไม่หาย/ไม่เทา)',
    el('btn-discard').disabled === false && G.selectedCards.indexOf('9♥') >= 0,
    'disabled=' + el('btn-discard').disabled + ' sel=' + JSON.stringify(G.selectedCards));

  // เคส 3: ไม่ค้างเมื่อมือเปลี่ยน (เกิดชุด/คืนไพ่) — pruneSelectedCards ต้องตัดไพ่ที่หลุด
  setup(['4♠', '9♥', '10♥'], { me: [['5♠', '6♠', '7♠']] }, [], 'action');
  G.selectedCards = ['4♠', '9♥'];
  G.currentGame.hands.me = ['9♥'];            // 4♠ ถูกเกิด/ฝากไปแล้ว
  G.pruneSelectedCards();
  ok('T15: pruneSelectedCards ตัดไพ่ที่หลุดจากมือออก (เหลือเฉพาะที่ยังอยู่บนมือ)',
    JSON.stringify(G.selectedCards) === JSON.stringify(['9♥']), JSON.stringify(G.selectedCards));

  // เคส 4: กติกาเดิมยังอยู่ — เลือก 2 ใบ → ปุ่มทิ้ง disabled
  setup(['4♠', '9♥', '10♥'], {}, [], 'action');
  G.selectedCards = ['4♠', '9♥'];
  G.updateActionBtns();
  ok('T16: เลือก 2 ใบ → ปุ่มทิ้งยัง disabled (ต้องเลือก 1 ใบ) — ไม่ใช่บั๊ก',
    el('btn-discard').disabled === true, 'disabled=' + el('btn-discard').disabled);

  // เวอร์ชัน
  var vtxt = fs.readFileSync(path.join(ROOT, 'version.txt'), 'utf8').trim().split(/\s+/)[0];
  ok('T17: version.txt = ' + G.CLIENT_VERSION, vtxt === G.CLIENT_VERSION, 'version.txt=' + vtxt);
  var idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var vnum = String(G.CLIENT_VERSION).replace(/^v/, '');
  ok('T18: index.html cache-buster = ?v=' + vnum,
    idx.indexOf('game-core.js?v=' + vnum) >= 0, 'ไม่พบ cache-buster ที่ตรงกัน');

  console.log('==========================================');
  console.log(' ผล: ' + pass + ' ผ่าน / ' + fail + ' ไม่ผ่าน');
  console.log('==========================================');
  process.exit(fail > 0 ? 1 : 0);
})();
