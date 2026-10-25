// FIX v55 (2026-10-25) — ทดสอบกติกา "ต้องเก็บเกิดจากกองทิ้งก่อน" (ข้อ 2) + "น็อคมืด ×2" (ข้อ 3)
// จำลอง browser ใน Node (vm context + stub DOM) เหมือน tools/test-meld-flow.js
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

// ---- โหลด speto-rules.js ----
var sr = fs.readFileSync(path.join(ROOT, 'speto-rules.js'), 'utf8');
var srSrc = sr + '\n;globalThis.SpetoRules = (typeof SpetoRules !== "undefined" ? SpetoRules : globalThis.SpetoRules);';
(0, eval)(srSrc);
var SpetoRulesGlobal = global.SpetoRules;
if (!SpetoRulesGlobal) { console.log('❌ โหลด speto-rules.js ไม่สำเร็จ'); process.exit(1); }

// ---- stub DOM: แยก element ตาม id (ต้องการเช็คปุ่มแยกกัน) ----
var els = {};
function mkEl(id) {
  return {
    id: id, innerHTML: '', textContent: '', style: {}, className: '', disabled: false, value: '',
    classList: { add: function(){}, remove: function(){} },
    addEventListener: function(){}, appendChild: function(){}, removeAttribute: function(){},
    querySelectorAll: function(){ return []; }, getAttribute: function(){ return ''; },
  };
}
global.document = {
  getElementById: function(id){ if (!els[id]) els[id] = mkEl(id); return els[id]; },
  querySelector: function(){ return mkEl('q'); },
  querySelectorAll: function(){ return []; },
  createElement: function(){ return mkEl('new'); },
  body: mkEl('body'), head: mkEl('head'), documentElement: mkEl('de'),
  addEventListener: function(){}, readyState: 'complete',
};
global.window = global;
global.localStorage = { getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} };
global.sessionStorage = global.localStorage;
global.navigator = { userAgent: 'node', clipboard: { writeText: function(){} } };
global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;
global.alert = function(){};
global.confirm = function(){ return true; };
global.fetch = function(){ return Promise.reject(new Error('no net')); };
global.supabase = { createClient: function(){ return {}; } };

var vm = require('vm');
var ctx = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Date: Date, Math: Math, JSON: JSON, Promise: Promise, document: global.document, window: global, localStorage: global.localStorage, sessionStorage: global.sessionStorage, navigator: global.navigator, alert: global.alert, confirm: global.confirm, fetch: global.fetch, supabase: global.supabase };
ctx.global = ctx; ctx.globalThis = ctx;
ctx.SpetoRules = SpetoRulesGlobal;
vm.createContext(ctx);
try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'game-core.js'), 'utf8'), ctx, { filename: 'game-core.js' }); }
catch (e) { console.log('⚠️ load game-core.js: ' + e.message); }

var G = ctx;

// ================= TEST =================
var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra ? ' → ' + extra : '')); }
}

console.log('==========================================');
console.log(' FIX v55 — ข้อ 2 (เก็บเกิดจากกองทิ้งก่อน) + ข้อ 3 (น็อคมืด ×2)');
console.log('==========================================');

// ---------- ส่วนที่ 1: helper flags ----------
ok('T1: hasEverMeld คืน false เมื่อไม่มี flag', G.hasEverMeld({ everMeld: {} }, 'me') === false);
ok('T2: hasEverMeld คืน true เมื่อเคยเกิด', G.hasEverMeld({ everMeld: { me: true } }, 'me') === true);
ok('T3: hasEverPick คืน false เมื่อไม่เคยหยิบจากกองทิ้ง', G.hasEverPick({ everPick: {} }, 'me') === false);
ok('T4: hasEverPick คืน true เมื่อเคยหยิบจากกองทิ้ง', G.hasEverPick({ everPick: { me: true } }, 'me') === true);

// ---------- ส่วนที่ 2: น็อคมืด → คะแนน ×2 ----------
// สร้างเกม: ผู้เล่น 'me' น็อค เหลือ 0 ใบ ไม่เคยเกิด (no meld, no everMeld)
//   meld = 0, hand = 0 → round = 0 - 0 + bonus(100 น็อค + 50 head) = 150 → น็อคมืด → ×2 = 300
var gDark = {
  hands: { me: [], other: ['K♠'] },
  melds: { me: [], other: [] },
  playerOrder: ['me', 'other'],
  hasFirstMeld: { me: false, other: false },
  everMeld: { me: false, other: false },
  everPick: { me: false, other: false },
  scores: { me: 0, other: 0 },
  headPoints: 50,
  spettoPenalty: {},
};
var rDark = G.computeRoundScoresFor(gDark, 'me');
ok('T5: น็อคมืด → คะแนนรอบถูกคูณ 2 (150 → 300)', rDark.roundScores.me === 300, 'ได้ ' + rDark.roundScores.me);
ok('T6: breakdown มีธง darkKnock', rDark.breakdown.me.darkKnock === true);
ok('T7: ผู้เล่นอื่นไม่โดน ×2', rDark.roundScores.other === -(G.cardPoints({ rank: 'K', suit: '♠' }) * 2), 'ได้ ' + rDark.roundScores.other);

// เคยเกิดแล้ว → ไม่ใช่น็อคมืด → ไม่คูณ 2
var gNormal = JSON.parse(JSON.stringify(gDark));
gNormal.everMeld.me = true;
gNormal.hasFirstMeld.me = true;
gNormal.melds.me = [['5♠','5♥','5♣']];
var rNormal = G.computeRoundScoresFor(gNormal, 'me');
ok('T8: เคยเกิดแล้ว → ไม่คูณ 2 (darkKnock = false)', rNormal.breakdown.me.darkKnock === false);
ok('T9: เคยเกิดแล้ว → คะแนนรอบไม่ถูกคูณ 2', rNormal.roundScores.me === 115, 'ได้ ' + rNormal.roundScores.me + ' (meld 15 + น็อค 50 + head 50 = 115)');

// ---------- ส่วนที่ 3: ปุ่ม UI ข้อ 2 ----------
function setupUI(opts) {
  opts = opts || {};
  G.myPlayerId = 'me';
  G.myTurn = true;
  G.selectedCards = [];
  G.pendingPickedCodes = [];
  G.layoffTargets = [];
  G.currentGame = {
    phase: 'action',
    hands: { me: ['9♠','10♠','J♠','K♠'], other: ['2♥'] },
    melds: { me: [], other: [['5♥','5♦','5♣']] },
    playerOrder: ['me', 'other'],
    turnPlayerId: 'me',
    hasFirstMeld: { me: true, other: false },
    everMeld: { me: true, other: false },
    everPick: { me: !!opts.everPick, other: false },
    pickedFromDiscard: {},
    discardPile: ['3♦'],
    scores: { me: 0, other: 0 },
  };
  // ล้าง element เดิม
  Object.keys(els).forEach(function(k){ delete els[k]; });
}

// ยังไม่เคยหยิบจากกองทิ้ง → ปุ่ม "วาง" ต้องถูกซ่อน
setupUI({ everPick: false });
G.updateLayoffTargets();
G.updateActionBtns();
ok('T10: ยังไม่เคยเก็บเกิดจากกองทิ้ง → ปุ่ม "วาง (เกิดในมือ)" ถูกซ่อน',
   els['btn-meld'] && els['btn-meld'].style.display === 'none', 'display=' + (els['btn-meld'] && els['btn-meld'].style.display));
ok('T11: ยังไม่เคยเก็บเกิดจากกองทิ้ง → ปุ่ม "ฝาก" ถูกซ่อน',
   els['btn-layoff'] && els['btn-layoff'].style.display === 'none', 'display=' + (els['btn-layoff'] && els['btn-layoff'].style.display));
ok('T12: ยังไม่เคยเก็บเกิดจากกองทิ้ง → มีคำอธิบาย (action-hint)',
   els['action-hint'] && /เก็บเกิด/.test(els['action-hint'].textContent), els['action-hint'] && els['action-hint'].textContent);

// เคยหยิบจากกองทิ้งแล้ว → ปุ่ม "วาง" ต้องแสดง
setupUI({ everPick: true });
G.updateLayoffTargets();
G.updateActionBtns();
ok('T13: เคยเก็บเกิดจากกองทิ้งแล้ว → ปุ่ม "วาง (เกิดในมือ)" แสดง',
   els['btn-meld'] && els['btn-meld'].style.display === 'inline-block', 'display=' + (els['btn-meld'] && els['btn-meld'].style.display));
ok('T14: เคยเก็บเกิดแล้ว + เกิดแล้ว → ปุ่ม "ฝาก" แสดง',
   els['btn-layoff'] && els['btn-layoff'].style.display === 'inline-block', 'display=' + (els['btn-layoff'] && els['btn-layoff'].style.display));

// ยังไม่เคยหยิบ + ยังไม่เกิด → ปุ่มฝากซ่อน (เดิมก็ซ่อนอยู่แล้ว)
setupUI({ everPick: false });
G.currentGame.hasFirstMeld.me = false;
G.updateLayoffTargets();
G.updateActionBtns();
ok('T15: ยังไม่เคยหยิบ + ยังไม่เกิด → ปุ่ม "ฝาก" ซ่อน',
   els['btn-layoff'] && els['btn-layoff'].style.display === 'none');

console.log('==========================================');
console.log(' ผ่าน: ' + pass + '  |  ไม่ผ่าน: ' + fail);
console.log('==========================================');
process.exit(fail > 0 ? 1 : 0);
