// TEST v62 (2026-10-28, พี่เอ) — กองจั่วหมด = จบเกม + สรุปคะแนนทันที (ฝั่ง client)
//   ① client เรียก action DECK_EMPTY เมื่อเห็นกองจั่วหมด
//   ② แสดงหน้าสรุปคะแนนเมื่อ server ตอบ gameOver
//   ③ checkStalledTurn เช็คกองจั่วหมดก่อนเช็คบอท (กันห้องค้างแบบ XY7QTM)
//   ④ version.txt + cache-buster = v62
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

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
vm.createContext(ctx);
try { vm.runInContext(src, ctx, { filename: 'game-core.js' }); } catch (e) { console.log('⚠️ load: ' + e.message); }
var G = ctx;

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}

// ---- T1: CLIENT_VERSION = เวอร์ชันปัจจุบัน (ไม่ hardcode — ให้ทุกเวอร์ชันรันได้) ----
ok('T1: CLIENT_VERSION = ' + G.CLIENT_VERSION, /^v\d+$/.test(String(G.CLIENT_VERSION)), G.CLIENT_VERSION);

// ---- T2: version.txt = CLIENT_VERSION ----
var vt = fs.readFileSync(path.join(ROOT, 'version.txt'), 'utf8').trim();
ok('T2: version.txt = ' + G.CLIENT_VERSION, vt === G.CLIENT_VERSION, vt);

// ---- T3: index.html cache-buster ตรงกับ CLIENT_VERSION ----
var ih = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var _vnum = String(G.CLIENT_VERSION).replace(/^v/, '');
ok('T3: index.html game-core.js?v=' + _vnum, ih.indexOf('game-core.js?v=' + _vnum) >= 0);
ok('T3b: index.html speto-rules.js?v=' + _vnum, ih.indexOf('speto-rules.js?v=' + _vnum) >= 0);

// ---- T4: มี helper showEndGameFromRpc + endGameByDeckEmpty ----
ok('T4: มีฟังก์ชัน showEndGameFromRpc', typeof G.showEndGameFromRpc === 'function');
ok('T4b: มีฟังก์ชัน endGameByDeckEmpty', typeof G.endGameByDeckEmpty === 'function');

// ---- T5: drawCard ตรวจ gameOver ----
var dc = src.match(/async function drawCard\(\)[\s\S]*?\n}/);
ok('T5: drawCard เช็ค r.gameOver', !!(dc && dc[0].indexOf('r.gameOver') >= 0));

// ---- T6: bot เช็คกองจั่วหมดก่อนหยิบจากกองทิ้ง ----
var bp = src.match(/async function botPlay\([\s\S]*?\n}/);
ok('T6: botPlay เช็ค deck.length === 0', !!(bp && bp[0].indexOf("currentGame.deck.length === 0") >= 0));
ok('T6b: botPlay เรียก DECK_EMPTY', !!(bp && bp[0].indexOf("'DECK_EMPTY'") >= 0));

// ---- T7: checkStalledTurn เช็คกองจั่วหมดก่อนเช็คบอท ----
var cs = src.match(/function checkStalledTurn\(\)[\s\S]*?\n}/);
ok('T7: checkStalledTurn เช็ค deck ว่าง', !!(cs && cs[0].indexOf('endGameByDeckEmpty') >= 0));
if (cs) {
  var iDeck = cs[0].indexOf('endGameByDeckEmpty');
  var iBot  = cs[0].indexOf("pid.indexOf('bot_')");
  ok('T7b: เช็คกองจั่วหมดมาก่อนเช็คบอท', iDeck >= 0 && iBot >= 0 && iDeck < iBot, { iDeck: iDeck, iBot: iBot });
}

// ---- T8: showEndGame แสดงเหตุผล DECK_EMPTY ----
var se = src.match(/function showEndGame\([\s\S]*?\n}/);
ok('T8: showEndGame แสดงหัว "กองจั่วหมด"', !!(se && se[0].indexOf("endReason === 'DECK_EMPTY'") >= 0));

// ---- T9: SQL v61 มี action DECK_EMPTY + COALESCE ----
var sql = fs.readFileSync(path.join(ROOT, 'FIX-v61-2026-10-28.sql'), 'utf8');
ok('T9: SQL มี ELSIF p_action = DECK_EMPTY', sql.indexOf("ELSIF p_action = 'DECK_EMPTY'") >= 0);
ok('T9b: SQL ใช้ COALESCE(array_length(v_deck, 1), 0) = 0', sql.indexOf('COALESCE(array_length(v_deck, 1), 0) = 0') >= 0);
ok('T9c: SQL มีฟังก์ชัน rummy_end_game_deck_empty', sql.indexOf('CREATE OR REPLACE FUNCTION public.rummy_end_game_deck_empty') >= 0);
ok('T9d: SQL เก็บกวาดห้องค้าง', sql.indexOf('FIX v61: จบห้อง') >= 0);

// ---- T10: ไม่มีการเขียน game=null (FIX v42 ยังอยู่) ----
ok('T10: FIX v42 กัน game=null ยังอยู่', src.indexOf('FIX v42') >= 0);

console.log('==========================================');
console.log('ผล: ผ่าน ' + pass + ' · ไม่ผ่าน ' + fail);
console.log('==========================================');
process.exit(fail > 0 ? 1 : 0);
