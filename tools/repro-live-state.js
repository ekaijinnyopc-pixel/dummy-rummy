// 🔍 จำลองสถานะห้องจริงจาก live (5QP4JC) → ดูว่าทำไมผู้เล่นค้าง
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

var sr = fs.readFileSync(path.join(ROOT, 'speto-rules.js'), 'utf8');
(0, eval)(sr + '\n;globalThis.SpetoRules = (typeof SpetoRules !== "undefined" ? SpetoRules : globalThis.SpetoRules);');
var SpetoRulesGlobal = global.SpetoRules;

var src = fs.readFileSync(path.join(ROOT, 'game-core.js'), 'utf8');
var stubEl = { innerHTML: '', textContent: '', style: {}, classList: { add: function(){}, remove: function(){} }, className: '', disabled: false, value: '', addEventListener: function(){}, appendChild: function(){}, querySelectorAll: function(){ return []; }, getAttribute: function(){ return ''; }, removeAttribute: function(){} };
global.document = { getElementById: function(){ return stubEl; }, querySelector: function(){ return stubEl; }, querySelectorAll: function(){ return []; }, createElement: function(){ return stubEl; }, body: stubEl, head: stubEl, documentElement: stubEl, addEventListener: function(){}, readyState: 'complete' };
global.window = global;
global.localStorage = { getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} };
global.sessionStorage = global.localStorage;
global.navigator = { userAgent: 'node' };
global.alert = function(){}; global.confirm = function(){ return true; };
global.fetch = function(){ return Promise.reject(new Error('no net')); };
global.supabase = { createClient: function(){ return {}; } };

var vm = require('vm');
var ctx = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Date: Date, Math: Math, JSON: JSON, Promise: Promise, document: global.document, window: global, localStorage: global.localStorage, sessionStorage: global.sessionStorage, navigator: global.navigator, alert: global.alert, confirm: global.confirm, fetch: global.fetch, supabase: global.supabase };
ctx.global = ctx; ctx.globalThis = ctx;
ctx.SpetoRules = SpetoRulesGlobal;
vm.createContext(ctx);
try { vm.runInContext(src, ctx, { filename: 'game-core.js' }); } catch (e) { console.log('⚠️ load: ' + e.message); }
var G = ctx;

// ===== สถานะจริงจากห้อง 5QP4JC =====
G.myPlayerId = 'p_y6rvb4x2e';
G.currentGame = {
  phase: 'action',
  turnPlayerId: 'p_y6rvb4x2e',
  playerOrder: ['bot_1', 'p_y6rvb4x2e'],
  hands: {
    'bot_1': ['2♠', '6♠'],
    'p_y6rvb4x2e': ['Q♠', 'A♠', 'Q♦', 'K♦', '3♠', '3♦', '3♣', '4♣', '4♠', '9♥']
  },
  melds: {
    'bot_1': [['J♦','J♥','J♠','J♣'],['6♦','7♦','8♦','9♦','5♦','10♦','4♦'],['2♥','3♥','4♥'],['7♣','8♣','9♣'],['10♥','10♣','10♠'],['A♦','A♣','A♥'],['K♠','K♣','K♥']],
    'p_y6rvb4x2e': [['5♥','5♣','5♠']]
  },
  hasFirstMeld: { 'bot_1': true, 'p_y6rvb4x2e': true },
  pickedFromDiscard: { 'bot_1': [], 'p_y6rvb4x2e': ['3♦','3♣','4♣','4♠','9♥'] },
  discardPile: [],
  deck: []
};
G.selectedCards = [];
G.pendingPickedCodes = [];
G.myTurn = true;

console.log('=== สถานะ ===');
console.log('myPickedCodes()   =', JSON.stringify(G.myPickedCodes()));
console.log('mustMeldPickedCode=', G.mustMeldPickedCode());
console.log('selectedCards     =', JSON.stringify(G.selectedCards));

var pool = G.currentGame.hands['p_y6rvb4x2e'].slice();
var picked = G.myPickedCodes();
for (var i = 0; i < picked.length; i++) if (pool.indexOf(picked[i]) < 0) pool.push(picked[i]);
console.log('\npool =', JSON.stringify(pool));
console.log('findMelds(pool) =', JSON.stringify(G.findMelds(G.codesToCards(pool)).map(function(m){
  return { type: m.type, cards: m.cards.map(function(c){ return c.code; }) };
})));
console.log('canMeldWithPicked =', JSON.stringify((function(){
  var m = G.canMeldWithPicked(picked, G.currentGame.hands['p_y6rvb4x2e']);
  return m ? m.cards.map(function(c){ return c.code; }) : null;
})()));

var opts = G.getMeldOptions(picked, []);
console.log('\ngetMeldOptions(picked, []) →');
console.log('  melds      =', JSON.stringify(opts.melds.map(function(m){ return m.cards.map(function(c){ return c.code; }); })));
console.log('  emptyReason=', opts.emptyReason);

console.log('\n--- เคสที่ผู้เล่นเลือกไพ่เอง (3 ใบ = ตอง 3) ---');
G.selectedCards = ['3♠','3♦','3♣'];
var opts2 = G.getMeldOptions(picked, G.selectedCards);
console.log('  melds      =', JSON.stringify(opts2.melds.map(function(m){ return m.cards.map(function(c){ return c.code; }); })));
console.log('  emptyReason=', opts2.emptyReason);

console.log('\n--- เคสผู้เล่นเลือก 4 ใบ (A+3 ใบที่หยิบ) ---');
G.selectedCards = ['3♦','3♣','4♣','4♠'];
var opts3 = G.getMeldOptions(picked, G.selectedCards);
console.log('  melds      =', JSON.stringify(opts3.melds.map(function(m){ return m.cards.map(function(c){ return c.code; }); })));
console.log('  emptyReason=', opts3.emptyReason);
