// FIX v49 — ทดสอบ flow การเกิดชุดฝั่ง client (จำลอง browser)
// ใช้ตรวจว่า "เกิดชุดที่สองไม่ได้" เกิดจากอะไร
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

// ---- โหลด speto-rules.js ----
var sr = fs.readFileSync(path.join(ROOT, 'speto-rules.js'), 'utf8');
var srSrc = sr + '\n;globalThis.SpetoRules = (typeof SpetoRules !== "undefined" ? SpetoRules : globalThis.SpetoRules);';
(0, eval)(srSrc);
var SpetoRulesGlobal = global.SpetoRules;
if (!SpetoRulesGlobal) { console.log('❌ โหลด speto-rules.js ไม่สำเร็จ'); process.exit(1); }

// ---- โหลด game-core.js (มี side effect ที่ DOM แต่จะ catch ได้) ----
var src = fs.readFileSync(path.join(ROOT, 'game-core.js'), 'utf8');
// stub DOM + browser globals
var stubEl = { innerHTML: '', textContent: '', style: {}, classList: { add: function(){}, remove: function(){} }, className: '', disabled: false, value: '', addEventListener: function(){}, appendChild: function(){}, querySelectorAll: function(){ return []; }, getAttribute: function(){ return ''; }, removeAttribute: function(){} };
global.document = {
  getElementById: function(){ return stubEl; },
  querySelector: function(){ return stubEl; },
  querySelectorAll: function(){ return []; },
  createElement: function(){ return stubEl; },
  body: stubEl,
  head: stubEl,
  documentElement: stubEl,
  addEventListener: function(){},
  readyState: 'complete',
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
ctx.SpetoRules = SpetoRulesGlobal;   // FIX: game-core.js ต้องเห็น SpetoRules ใน vm context
vm.createContext(ctx);
try { vm.runInContext(src, ctx, { filename: 'game-core.js' }); }
catch (e) { console.log('⚠️ load game-core.js: ' + e.message); }

var G = ctx;

// ================= TEST =================
var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra ? ' → ' + extra : '')); }
}

function setup(hand, melds, picked) {
  G.myPlayerId = 'me';
  G.currentGame = {
    phase: 'action',
    hands: { me: hand.slice() },
    melds: melds || {},
    hasFirstMeld: { me: true },
    pickedFromDiscard: { me: picked || [] },
    discardPile: [],
    turnPlayerId: 'me',
  };
  G.selectedCards = [];
  G.myTurn = true;
  G.layoffTargets = [];
}

console.log('==========================================');
console.log(' FIX v49 — ทดสอบ flow เกิดชุดฝั่ง client');
console.log('==========================================');

// --- Test 1: เกิดชุดตอง 3 ใบจากมือ (เลือกเอง) ---
setup(['5♠','5♥','5♣','K♠','Q♠'], {});
G.selectedCards = ['5♠','5♥','5♣'];
var o1 = G.getMeldOptions([], G.selectedCards);
ok('T1: เลือก 5♠5♥5♣ แล้วเจอชุดตอง', o1.melds.length === 1, JSON.stringify(o1.melds));

// --- Test 2: ชุดเรียง 3 ใบ ---
setup(['7♠','8♠','9♠','K♠'], {});
G.selectedCards = ['7♠','8♠','9♠'];
var o2 = G.getMeldOptions([], G.selectedCards);
ok('T2: เลือก 7♠8♠9♠ แล้วเจอชุดเรียง', o2.melds.length === 1 && o2.melds[0].type === 'run', JSON.stringify(o2.melds));

// --- Test 3: เลือก 3 ใบจาก 4 ใบเลขเดียวกัน (4-of-a-kind) ---
setup(['5♠','5♥','5♣','5♦','K♠'], {});
G.selectedCards = ['5♠','5♥','5♣'];
var o3 = G.getMeldOptions([], G.selectedCards);
ok('T3: 4 ใบเลขเดียวกัน → เลือกเกิด 3 ใบได้', o3.melds.length === 1, JSON.stringify(o3.melds) + ' reason=' + o3.emptyReason);

// --- Test 4: สเปโต Q♠ เข้าชุดเรียงไม่ได้ ---
setup(['7♠','8♠','9♠','Q♠'], {});
G.selectedCards = ['7♠','8♠','Q♠'];
var o4 = G.getMeldOptions([], G.selectedCards);
ok('T4: สเปโต Q♠ เข้าชุดเรียงไม่ได้', o4.melds.length === 0 && /สเปโต/.test(o4.emptyReason), 'reason=' + o4.emptyReason);

// --- Test 5: สเปโต 2♣ เข้าชุดตองได้ ---
setup(['2♣','2♥','2♦','K♠'], {});
G.selectedCards = ['2♣','2♥','2♦'];
var o5 = G.getMeldOptions([], G.selectedCards);
ok('T5: สเปโต 2♣ เข้าชุดตองได้', o5.melds.length === 1, JSON.stringify(o5.melds));

// --- Test 6: ไพ่ที่หยิบจากกองทิ้ง ต้องใช้ครบทุกใบ ---
setup(['9♠','10♠','J♠','K♠','Q♠'], {}, ['Q♠']);
var o6 = G.getMeldOptions(['Q♠'], []);
ok('T6: หยิบ Q♠ → ชุด J-Q-K ต้องมี Q♠', o6.melds.length === 0 || o6.melds[0].cards.indexOf('Q♠') >= 0, JSON.stringify(o6.melds));

// --- Test 7: หยิบ 2 ใบ แต่ชุดใช้แค่ 1 → ไม่ผ่าน ---
setup(['9♠','10♠','J♠','K♠','Q♠'], {}, ['Q♠','K♠']);
var o7 = G.getMeldOptions(['Q♠','K♠'], []);
ok('T7: หยิบ 2 ใบ ชุดต้องใช้ครบ 2 ใบ', o7.melds.length === 0, JSON.stringify(o7.melds));

// --- Test 8: ไม่เลือกอะไร → แสดงทุกชุดที่เกิดได้ ---
setup(['5♠','5♥','5♣','7♠','8♠','9♠','K♠'], {});
G.selectedCards = [];
var o8 = G.getMeldOptions([], []);
ok('T8: ไม่เลือก → เจอ 2 ชุด (ตอง+เรียง)', o8.melds.length === 2, JSON.stringify(o8.melds.map(function(m){return m.type;})));

// --- Test 9: เกิดชุดที่สอง — หลังเกิดชุดแรก เหลือไพ่ที่เกิดได้อีกชุด ---
setup(['5♠','5♥','5♣','7♠','8♠','9♠'], {});
G.selectedCards = ['5♠','5♥','5♣'];
var o9a = G.getMeldOptions([], G.selectedCards);
ok('T9a: ชุดแรก (ตอง) เจอ', o9a.melds.length === 1);
// จำลองเกิดชุดแรกแล้ว → เหลือ 7♠8♠9♠
setup(['7♠','8♠','9♠'], {});
G.selectedCards = ['7♠','8♠','9♠'];
var o9b = G.getMeldOptions([], G.selectedCards);
ok('T9b: ชุดที่สอง (เรียง) เจอ', o9b.melds.length === 1 && o9b.melds[0].type === 'run', JSON.stringify(o9b.melds));

// --- Test 10: ชุดย่อยจาก 4 ใบเลขเดียวกัน (ผู้เล่นเลือกเอง 3 จาก 4) ---
setup(['5♠','5♥','5♣','5♦','K♠'], {});
G.selectedCards = ['5♠','5♥','5♣'];
var o10 = G.getMeldOptions([], G.selectedCards);
ok('T10: เลือกเกิด 3 จาก 4 ใบเลขเดียวกันได้ (ชุดย่อย)', o10.melds.length === 1 && o10.melds[0].cards.length === 3, JSON.stringify(o10.melds));

// --- Test 11: run ย่อยจาก 4 ใบเรียง (เลือก 8-9-10 ทิ้ง 7) ---
setup(['7♠','8♠','9♠','10♠','K♠'], {});
G.selectedCards = ['8♠','9♠','10♠'];
var o11 = G.getMeldOptions([], G.selectedCards);
ok('T11: เลือกเกิด run ย่อย 3 จาก 4 เรียงได้', o11.melds.length === 1 && o11.melds[0].cards.length === 3, JSON.stringify(o11.melds));

// --- Test 12: เลือกผิด → ต้องไม่มีชุด + มีเหตุผล (ไม่ใช่แสดงทุกชุดในมือ) ---
setup(['5♠','5♥','5♣','7♠','8♠','9♠'], {});
G.selectedCards = ['5♠','7♠','8♠'];
var o12 = G.getMeldOptions([], G.selectedCards);
ok('T12: เลือกผิด → ไม่มีชุด + มีเหตุผล', o12.melds.length === 0 && o12.emptyReason.length > 0, JSON.stringify(o12.melds) + ' reason=' + o12.emptyReason);

console.log('==========================================');
console.log(' ผ่าน: ' + pass + '  |  ไม่ผ่าน: ' + fail);
console.log('==========================================');
process.exit(fail > 0 ? 1 : 0);
