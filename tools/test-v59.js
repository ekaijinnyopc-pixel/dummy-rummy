// FIX v59 (2026-10-27, พี่เอ) — เทสต์บั๊ก 4 ข้อที่พี่เอเจอเล่นจริง
//   ① เกิด "ใบแรกที่หยิบ" (anchor) เท่านั้น — ไพ่ที่หยิบมาพร้อมกันไม่ต้องเกิด
//   ② ฝากลงชุดเรียงแล้วไพ่เรียงตามเลข (ไม่ต่อท้าย)
//   ③ ธง everMeld/everPick ไม่หายเมื่อ server ส่ง state ใหม่ (ปุ่ม "ฝาก" ถูกปิดเองหลังจั่ว)
//   ④ ทิ้งไพ่ได้ก็ต่อเมื่อจั่ว/หยิบแล้ว (ห้ามข้ามขั้นตอน)
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

// ---- โหลด speto-rules.js ----
var sr = fs.readFileSync(path.join(ROOT, 'speto-rules.js'), 'utf8');
(0, eval)(sr + '\n;globalThis.SpetoRules = (typeof SpetoRules !== "undefined" ? SpetoRules : globalThis.SpetoRules);');
var SpetoRulesGlobal = global.SpetoRules;
if (!SpetoRulesGlobal) { console.log('❌ โหลด speto-rules.js ไม่สำเร็จ'); process.exit(1); }

// ---- stub DOM (แยก element ต่อ id เพื่อเช็ค disabled ของแต่ละปุ่ม) ----
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
function codes(m) { return m.cards.map(function(c){ return c.code; }); }

function setup(hand, melds, picked, phase) {
  G.myPlayerId = 'me';
  G.roomCode = 'TEST59';
  G.currentGame = {
    phase: phase || 'action',
    hands: { me: hand.slice() },
    melds: melds || {},
    hasFirstMeld: { me: true },
    pickedFromDiscard: { me: picked || [] },
    discardPile: [],
    turnPlayerId: 'me',
    everMeld: {}, everPick: {}
  };
  G.selectedCards = [];
  G.pendingPickedCodes = [];
  G.myTurn = true;
  G.layoffTargets = [];
}

console.log('==========================================');
console.log(' FIX v59 — เกิดใบแรก / ฝากเรียง / ธงหาย / ทิ้งก่อนจั่ว');
console.log('==========================================');

// ============================================================
// ข้อ 1: เกิด "ใบแรกที่หยิบ" เท่านั้น (เคสจริงของพี่เอ: กองทิ้ง K-A-2-6-7)
// ============================================================
// เลือก A จากกองทิ้ง [K,A,2,6,7] → ได้ A,2,6,7 (4 ใบ) · มือมี A♠ A♥ อยู่แล้ว
var picked1 = ['A♦', '2♠', '6♠', '7♠'];
// ตอนหยิบจากกองทิ้ง ไพ่ที่หยิบถูก "เพิ่มเข้ามือ" (pickDiscardClientSide) → มือต้องมีครบ
var hand1 = ['A♠', 'A♥', '3♠', '4♠', '5♠'].concat(picked1);
setup(hand1, {}, picked1, 'action');
var o1 = G.getMeldOptions(picked1, []);
var aaa = o1.melds.filter(function(m){ return codes(m).indexOf('A♦') >= 0; });
ok('T1: หยิบ A (พร้อม 2,6,7) → เจอชุดตอง A-A-A', aaa.length >= 1, JSON.stringify(o1.melds));
ok('T1b: ชุดที่เสนอมีแค่ 3 ใบ (ไม่ลาก 2,6,7 มาด้วย)',
  aaa.length >= 1 && codes(aaa[0]).length === 3, aaa.length ? JSON.stringify(codes(aaa[0])) : 'none');
ok('T1c: ทุกชุดที่เสนอมี anchor (A♦)',
  o1.melds.every(function(m){ return codes(m).indexOf('A♦') >= 0; }), JSON.stringify(o1.melds));
ok('T1d: mustMeldPickedCode = ใบแรกที่หยิบ (A♦)', G.mustMeldPickedCode() === 'A♦', String(G.mustMeldPickedCode()));

// anchor เกิดไม่ได้ → ต้องบอกให้คืนไพ่ (ไม่ใช่ไปเกิดอย่างอื่น)
setup(['K♠','Q♠','10♠','9♠'], {}, ['7♥'], 'action');
var o2 = G.getMeldOptions(['7♥'], []);
ok('T2: anchor เกิดไม่ได้ → ไม่มีชุด + ข้อความบอกคืนไพ่',
  o2.melds.length === 0 && /คืนไพ่/.test(o2.emptyReason), JSON.stringify(o2.melds) + ' | ' + o2.emptyReason);

// ผู้เล่นเลือกเอง (3 ใบ = ตอง) → ต้องได้ชุดที่เลือก
setup(hand1, {}, picked1, 'action');
G.selectedCards = ['A♠', 'A♥', 'A♦'];
var o3 = G.getMeldOptions(picked1, G.selectedCards);
ok('T3: ผู้เล่นเลือก A-A-A เอง → ได้ชุดตอง 3 ใบ',
  o3.melds.length === 1 && codes(o3.melds[0]).length === 3, JSON.stringify(o3.melds.map(codes)));

// ============================================================
// ข้อ 2: ฝากลงชุดเรียง → เรียงไพ่ตามเลข (ไม่ต่อท้าย)
// ============================================================
ok('T4: ชุดเรียง 5-6-7 + ฝาก 4 → เรียงเป็น 4-5-6-7',
  JSON.stringify(G.sortedMeldCodes(['5♠','6♠','7♠','4♠'])) === JSON.stringify(['4♠','5♠','6♠','7♠']),
  JSON.stringify(G.sortedMeldCodes(['5♠','6♠','7♠','4♠'])));
ok('T5: ชุดเรียง Q-K-A → เรียงตามเลข (A=14 สูงสุด)',
  JSON.stringify(G.sortedMeldCodes(['A♥','Q♥','K♥'])) === JSON.stringify(['Q♥','K♥','A♥']),
  JSON.stringify(G.sortedMeldCodes(['A♥','Q♥','K♥'])));
ok('T6: ชุดตอง (เลขเดียวกัน) คงลำดับเดิม',
  JSON.stringify(G.sortedMeldCodes(['A♦','A♠','A♥'])) === JSON.stringify(['A♦','A♠','A♥']),
  JSON.stringify(G.sortedMeldCodes(['A♦','A♠','A♥'])));
// เคสจริงของพี่เอ: ฝาก 4, 8, 3, 9 ลงชุด 5-6-7
var run = ['5♠','6♠','7♠'];
['4♠','8♠','3♠','9♠'].forEach(function(c){ run = G.sortedMeldCodes(run.concat([c])); });
ok('T7: ฝาก 4,8,3,9 ลงชุด 5-6-7 → เรียง 3-4-5-6-7-8-9',
  JSON.stringify(run) === JSON.stringify(['3♠','4♠','5♠','6♠','7♠','8♠','9♠']), JSON.stringify(run));

// ============================================================
// ข้อ 3: ธง everMeld/everPick ต้องไม่หายเมื่อ server ส่ง state ใหม่
// ============================================================
setup(['A♠','5♠'], {}, [], 'action');
G.currentGame.everPick = { me: true };
G.currentGame.everMeld = { me: true };
// เลียนแบบ: server ส่ง game state ใหม่ (ไม่มีธง) → client ทับ
var serverGame = { phase: 'action', hands: { me: ['A♠','5♠'] }, melds: {}, turnPlayerId: 'me', version: 9 };
G.currentGame = G.preserveEverFlags(serverGame, G.currentGame);
ok('T8: server ส่ง state ใหม่ (ไม่มีธง) → everPick ยังอยู่',
  G.hasEverPick(G.currentGame, 'me') === true, JSON.stringify(G.currentGame.everPick));
ok('T9: everMeld ยังอยู่เหมือนกัน',
  G.hasEverMeld(G.currentGame, 'me') === true, JSON.stringify(G.currentGame.everMeld));
// localStorage สำรอง (จำลอง: เคยเล่นมาก่อนในเครื่องนี้ → localStorage มีธง · แต่ DB ไม่มี)
G.localStorage._s = { 'dr_everflags_TEST59': JSON.stringify({ everPick: { me: true }, everMeld: { me: true } }) };
G.currentGame = { phase: 'action', hands: { me: [] }, version: 1 };
G.currentGame = G.restoreEverFlags(G.currentGame);
ok('T10: รีเฟรชหน้าเว็บ (โหลด state จาก DB ที่ไม่มีธง) → กู้จาก localStorage ได้',
  G.hasEverPick(G.currentGame, 'me') === true, JSON.stringify(G.currentGame.everPick));

// ============================================================
// ข้อ 4: ทิ้งไพ้ได้ก็ต่อเมื่อจั่ว/หยิบแล้ว
// ============================================================
setup(['A♠','5♠'], {}, [], 'draw');   // ยังไม่ได้จั่ว
G.selectedCards = ['A♠'];
G.updateActionBtns();
ok('T11: ยังไม่จั่ว (phase=draw) + เผลอเลือกไพ่ → ปุ่มทิ้งต้อง disabled',
  el('btn-discard').disabled === true, 'disabled=' + el('btn-discard').disabled);
setup(['A♠','5♠'], {}, [], 'action'); // จั่วแล้ว
G.selectedCards = ['A♠'];
G.updateActionBtns();
ok('T12: จั่วแล้ว (phase=action) + เลือกไพ่ → ปุ่มทิ้งใช้ได้',
  el('btn-discard').disabled === false, 'disabled=' + el('btn-discard').disabled);
setup(['A♠','5♠'], {}, [], 'action');
G.selectedCards = ['A♠','5♠'];
G.updateActionBtns();
ok('T13: เลือก 2 ใบ → ปุ่มทิ้ง disabled (ต้องเลือก 1 ใบ)',
  el('btn-discard').disabled === true, 'disabled=' + el('btn-discard').disabled);

// ============================================================
// ข้อ 5: เวอร์ชัน client + version.txt ตรงกัน (กัน client เก่าค้าง)
// ============================================================
var vtxt = fs.readFileSync(path.join(ROOT, 'version.txt'), 'utf8').trim().split(/\s+/)[0];
ok('T14: version.txt = ' + G.CLIENT_VERSION, vtxt === G.CLIENT_VERSION, 'version.txt=' + vtxt);
var idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var vnum = String(G.CLIENT_VERSION).replace(/^v/, '');
ok('T15: index.html cache-buster = ?v=' + vnum,
  idx.indexOf('game-core.js?v=' + vnum) >= 0, 'ไม่พบ cache-buster ที่ตรงกัน');

console.log('==========================================');
console.log(' ผล: ' + pass + ' ผ่าน / ' + fail + ' ไม่ผ่าน');
console.log('==========================================');
process.exit(fail > 0 ? 1 : 0);
