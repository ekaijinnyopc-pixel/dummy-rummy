// TEST v55 (2026-10-25) — ฝั่ง client: น็อคมืด ×2 + กติกาฝาก/เกิดในมือ (ข้อ 2/3)
// ใช้ harness เดียวกับ test-meld-flow.js
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

var sr = fs.readFileSync(path.join(ROOT, 'speto-rules.js'), 'utf8');
var srSrc = sr + '\n;globalThis.SpetoRules = (typeof SpetoRules !== "undefined" ? SpetoRules : globalThis.SpetoRules);';
(0, eval)(srSrc);
var SpetoRulesGlobal = global.SpetoRules;

var src = fs.readFileSync(path.join(ROOT, 'game-core.js'), 'utf8');
var stubEl = { innerHTML: '', textContent: '', style: {}, classList: { add: function(){}, remove: function(){} }, className: '', disabled: false, value: '', addEventListener: function(){}, appendChild: function(){}, querySelectorAll: function(){ return []; }, getAttribute: function(){ return ''; }, removeAttribute: function(){} };
global.document = { getElementById: function(){ return stubEl; }, querySelector: function(){ return stubEl; }, querySelectorAll: function(){ return []; }, createElement: function(){ return stubEl; }, body: stubEl, head: stubEl, documentElement: stubEl, addEventListener: function(){}, readyState: 'complete' };
global.window = global;
global.localStorage = { getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} };
global.sessionStorage = global.localStorage;
global.navigator = { userAgent: 'node', clipboard: { writeText: function(){} } };
global.alert = function(){}; global.confirm = function(){ return true; };
global.setInterval = function(){ return 0; }; global.clearInterval = function(){};
global.fetch = function(){ return Promise.reject(new Error('no net')); };
global.supabase = { createClient: function(){ return {}; } };

var vm = require('vm');
var ctx = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Date: Date, Math: Math, JSON: JSON, Promise: Promise, document: global.document, window: global, localStorage: global.localStorage, sessionStorage: global.sessionStorage, navigator: global.navigator, alert: global.alert, confirm: global.confirm, fetch: global.fetch, supabase: global.supabase };
ctx.setInterval = global.setInterval; ctx.clearInterval = global.clearInterval;
ctx.global = ctx; ctx.globalThis = ctx;
ctx.SpetoRules = SpetoRulesGlobal;
vm.createContext(ctx);
try { vm.runInContext(src, ctx, { filename: 'game-core.js' }); } catch (e) { console.log('⚠️ load: ' + e.message); }
var G = ctx;

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}

function mkGame(o) {
  return Object.assign({
    playerOrder: ['p1', 'p2'],
    hands: { p1: [], p2: [] },
    melds: { p1: [], p2: [] },
    scores: { p1: 0, p2: 0 },
    hasFirstMeld: { p1: false, p2: false },
    everMeld: { p1: false, p2: false },
    everPick: { p1: false, p2: false },
    headPoints: 50,
    spettoPenalty: {}
  }, o);
}

// ---------- ข้อ 3: น็อคมืด → คะแนนรอบ ×2 ----------
var g1 = mkGame({ hands: { p1: ['7♠'], p2: ['9♣'] }, everMeld: { p1: false, p2: false } });
var r1 = G.computeRoundScoresFor(g1, 'p1');
// p1: meld 0 - hand (5×2=10) + (100+50) = 140 → ×2 = 280
ok('น็อคมืด (ไม่เคยเกิด) → คะแนน ×2 = 280', r1.roundScores.p1 === 280, r1.roundScores);
ok('น็อคมืด มีธง darkKnock = true', r1.breakdown.p1.darkKnock === true);
ok('คนอื่นไม่โดน ×2', r1.roundScores.p2 === -(5 * 2), r1.roundScores);

var g2 = mkGame({ hands: { p1: ['7♠'], p2: ['9♣'] }, everMeld: { p1: true, p2: false } });
var r2 = G.computeRoundScoresFor(g2, 'p1');
// p1: meld 0 - hand 10 + 150 = 140 (ไม่ ×2)
ok('เคยเกิดแล้ว → ไม่ ×2 = 140', r2.roundScores.p1 === 140, r2.roundScores);
ok('เคยเกิดแล้ว → darkKnock = false', r2.breakdown.p1.darkKnock === false);

// ---------- FIX v55.1: ห้องเก่า (ไม่มี everMeld) ต้องไม่ถูกคิด ×2 ผิด ----------
var g3 = mkGame({ hands: { p1: ['7♠'], p2: ['9♣'] } });
delete g3.everMeld;
g3.hasFirstMeld = { p1: true, p2: false };
g3.melds = { p1: [['5♥', '5♦', '5♣']], p2: [] };
var r3 = G.computeRoundScoresFor(g3, 'p1');
ok('ห้องเก่า (ไม่มี everMeld) + เกิดแล้วรอบนี้ → ไม่ ×2 = 110', r3.roundScores.p1 === 110, r3.roundScores);
ok('ห้องเก่า → darkKnock = false', r3.breakdown.p1.darkKnock === false);

var g4 = mkGame({ hands: { p1: ['7♠'], p2: ['9♣'] } });
delete g4.everMeld;
g4.hasFirstMeld = { p1: false, p2: false };
g4.melds = { p1: [], p2: [] };
var r4 = G.computeRoundScoresFor(g4, 'p1');
ok('ห้องเก่า + ไม่เคยเกิดเลย → ×2 = 280', r4.roundScores.p1 === 280, r4.roundScores);

// ---------- ข้อ 2: ฝากต้องเคยเก็บเกิดจากกองทิ้ง ----------
G.myPlayerId = 'p1';
G.myTurn = true;
G.currentGame = mkGame({
  hands: { p1: ['9♣', '5♥', '5♦'], p2: ['9♠', '9♥', '9♦'] },
  melds: { p1: [], p2: [['9♠', '9♥', '9♦']] },
  hasFirstMeld: { p1: true, p2: true },
  everMeld: { p1: true, p2: true },
  everPick: { p1: false, p2: false }
});
G.layoffTargets = [];
G.updateLayoffTargets();
ok('ยังไม่เคยเก็บเกิดจากกองทิ้ง → ไม่มีเป้าหมายฝาก', (G.layoffTargets || []).length === 0, G.layoffTargets);
var layBtn = stubEl;
G.updateLayoffBtn();
ok('ปุ่มฝาก disabled (ยังไม่เคยเก็บเกิด)', layBtn.disabled === true, { disabled: layBtn.disabled, display: layBtn.style.display });
ok('ปุ่มฝากยังมองเห็น (เทา ๆ) เพื่อบอกว่ากดไม่ได้', layBtn.style.display === 'inline-block', layBtn.style.display);

// หยิบจากกองทิ้งแล้ว → ฝากได้
G.currentGame.everPick = { p1: true, p2: false };
G.updateLayoffTargets();
ok('เคยเก็บเกิดจากกองทิ้ง → มีเป้าหมายฝาก', (G.layoffTargets || []).length > 0, G.layoffTargets);
G.updateLayoffBtn();
ok('ปุ่มฝากกดได้', layBtn.disabled === false, { disabled: layBtn.disabled });

// ---------- ปุ่ม "เกิดในมือ" ต้องแสดงเสมอ ----------
var meldBtn = { style: {}, disabled: false };
var realGet = global.document.getElementById;
global.document.getElementById = function(id) {
  if (id === 'btn-meld') return meldBtn;
  if (id === 'btn-layoff') return layBtn;
  return stubEl;
};
G.currentGame.phase = 'action';
G.currentGame.hands.p1 = ['5♥', '5♦', '5♣'];
G.currentGame.everPick = { p1: false, p2: false };
G.updateActionBtns();
ok('ปุ่ม "เกิดในมือ" แสดงเสมอ แม้ยังไม่เคยเก็บเกิดจากกองทิ้ง', meldBtn.style.display === 'inline-block', meldBtn.style);
ok('ปุ่ม "เกิดในมือ" กดได้เมื่อมีชุดในมือ', meldBtn.disabled === false, meldBtn.disabled);
global.document.getElementById = realGet;

// ---------- ข้ามรอบ: ธง everMeld/everPick ต้องไม่ถูกรีเซ็ต (ข้อ 3: "ตั้งแต่ต้นเกมจนถึงรอบก่อนจะน็อค") ----------
var captured = [];
G.db = {
  from: function() {
    return {
      select: function() {
        return { eq: function() { return { single: function() { return Promise.resolve({ data: { players: { p1: {}, p2: {} } } }); } }; } };
      },
      update: function(obj) { captured.push(obj); return { eq: function() { return Promise.resolve({}); } }; }
    };
  }
};
G.roomCode = 'TESTROOM';
G.currentGame = {
  playerOrder: ['p1', 'p2'],
  round: 2,
  totalScores: { p1: 100, p2: 50 },
  scores: { p1: 100, p2: 50 },
  hands: { p1: [], p2: [] },
  melds: { p1: [], p2: [] },
  hasFirstMeld: { p1: true, p2: false },
  everMeld: { p1: true, p2: false },
  everPick: { p1: true, p2: false }
};
G.playAgain().then(function() {
  var ng = (captured[0] && captured[0].game) || {};
  ok('ข้ามรอบ → everMeld สืบทอด (p1 เคยเกิด = true)', ng.everMeld && ng.everMeld.p1 === true, ng.everMeld);
  ok('ข้ามรอบ → everMeld สืบทอด (p2 ไม่เคยเกิด = false)', ng.everMeld && ng.everMeld.p2 === false, ng.everMeld);
  ok('ข้ามรอบ → everPick สืบทอด (p1 = true)', ng.everPick && ng.everPick.p1 === true, ng.everPick);
  ok('ข้ามรอบ → hasFirstMeld รีเซ็ต (เกิดรอบนี้ = false)', ng.hasFirstMeld && ng.hasFirstMeld.p1 === false, ng.hasFirstMeld);
  ok('ข้ามรอบ → ยอดสะสมยังอยู่', ng.totalScores && ng.totalScores.p1 === 100, ng.totalScores);
  ok('ข้ามรอบ → เลขรอบถูกบวก', ng.round === 3, ng.round);

  // ต่อไป: ผู้เล่นที่ไม่เคยเกิด (p2) น็อคในรอบ 3 → ต้อง ×2
  var gR3 = Object.assign({}, ng, { hands: { p1: ['7♠'], p2: ['7♠'] } });
  var r3 = G.computeRoundScoresFor(gR3, 'p2');
  ok('รอบ 3: p2 ที่ไม่เคยเกิด → น็อคมืด ×2 = 280', r3.roundScores.p2 === 280, r3.roundScores);
  var r3b = G.computeRoundScoresFor(gR3, 'p1');
  ok('รอบ 3: p1 ที่เคยเกิด → ไม่ ×2 = 140', r3b.roundScores.p1 === 140, r3b.roundScores);

  console.log('\n📊 ผล: ' + pass + ' ผ่าน / ' + fail + ' ไม่ผ่าน');
  process.exit(fail > 0 ? 1 : 0);
}).catch(function(e) {
  console.log('❌ playAgain error:', e && e.message);
  console.log('\n📊 ผล: ' + pass + ' ผ่าน / ' + (fail + 1) + ' ไม่ผ่าน');
  process.exit(1);
});
