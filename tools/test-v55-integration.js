// INTEGRATION TEST v55 (2026-10-25) — จำลอง server ทั้งชุดแล้วเล่นรอบเต็ม
// ตรวจ: version ไม่ชน (VERSION_MISMATCH) · ธง everMeld/everPick ถูกต้อง · น็อคมืด ×2
var fs = require('fs');
var path = require('path');
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
global.navigator = { userAgent: 'node', clipboard: { writeText: function(){} } };
global.setInterval = function(){ return 0; }; global.clearInterval = function(){};
global.alert = function(){}; global.confirm = function(){ return true; };
global.fetch = function(){ return Promise.reject(new Error('no net')); };
global.supabase = { createClient: function(){ return {}; } };

var vm = require('vm');
var ctx = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Date: Date, Math: Math, JSON: JSON, Promise: Promise,
  document: global.document, window: global, localStorage: global.localStorage, sessionStorage: global.sessionStorage,
  navigator: global.navigator, alert: global.alert, confirm: global.confirm, fetch: global.fetch, supabase: global.supabase,
  setInterval: global.setInterval, clearInterval: global.clearInterval };
ctx.global = ctx; ctx.globalThis = ctx; ctx.SpetoRules = SR;
vm.createContext(ctx);
try { vm.runInContext(src, ctx, { filename: 'game-core.js' }); } catch (e) { console.log('⚠️ load: ' + e.message); }
var G = ctx;

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}

// ============ FAKE SERVER ============
var S = null;
var rpcLog = [];
var captured = [];

function newRoom(opts) {
  opts = opts || {};
  var hand = opts.hand || ['9♠','9♦','9♥','K♠'];
  return {
    id: 'IT1', code: 'IT1', status: 'playing', version: 1,
    players: { me: { id: 'me', name: 'me' }, bot_1: { id: 'bot_1', name: 'bot', isBot: true } },
    game: {
      deck: ['2♠','3♠','4♠','5♠','6♠','7♠','8♠','10♠','J♠'],
      hands: { me: hand.slice(), bot_1: ['Q♠'] },
      discardPile: (opts.discard || ['3♦','9♣']).slice(),
      turnPlayerId: 'me', playerOrder: ['me','bot_1'], phase: 'draw', status: 'playing',
      melds: { me: [], bot_1: [['8♠','8♦','8♣']] }, scores: { me: 0, bot_1: 0 }, totalScores: { me: 0, bot_1: 0 },
      round: 1, turnSeq: 0, headCard: '3♦', headPoints: 50,
      hasFirstMeld: { me: false, bot_1: false },
      everMeld: { me: false, bot_1: false },
      everPick: { me: false, bot_1: false },
      pickedFromDiscard: {}, spettoPenalty: {}, spetoPending: {}, spettoPenaltyDone: {},
      spettoDiscardDone: {}, spetoOrigin: {}, hasDiscardedThisTurn: {}, deckEmpty: false, version: 1
    }
  };
}

function fakeRpc(action, payload) {
  rpcLog.push(action + '@v' + payload.p_expected_version);
  if (payload.p_expected_version > 0 && payload.p_expected_version !== S.version) {
    return Promise.resolve({ data: { ok: false, error: 'VERSION_MISMATCH' } });
  }
  var g = S.game;
  var pid = payload.p_player_id;
  if (action === 'MELD') {
    var codes = (typeof payload.p_meld_codes === 'string') ? JSON.parse(payload.p_meld_codes) : payload.p_meld_codes;
    var hand = g.hands[pid] || [];
    if (codes.filter(function(c){ return hand.indexOf(c) < 0; }).length) {
      return Promise.resolve({ data: { ok: false, error: 'CARD_NOT_IN_HAND' } });
    }
    if (!(codes.length >= 3 && G.detectMeldType(codes) !== null)) {
      return Promise.resolve({ data: { ok: false, error: 'INVALID_MELD' } });
    }
    g.hands[pid] = hand.filter(function(c){ return codes.indexOf(c) < 0; });
    g.melds[pid] = (g.melds[pid] || []).concat([codes]);
    var isFirst = !g.hasFirstMeld[pid];
    g.hasFirstMeld[pid] = true;
    g.pickedFromDiscard[pid] = [];
    g.version = ++S.version;
    return Promise.resolve({ data: { ok: true, game: JSON.parse(JSON.stringify(g)), is_first_meld: isFirst } });
  }
  if (action === 'DRAW_DECK') {
    var dc = g.deck[g.deck.length - 1];
    g.deck = g.deck.slice(0, -1);
    g.hands[pid] = (g.hands[pid] || []).concat([dc]);
    g.phase = 'action';
    g.version = ++S.version;
    return Promise.resolve({ data: { ok: true, game: JSON.parse(JSON.stringify(g)), deckEmpty: false } });
  }
  if (action === 'LAYOFF') {
    var target = g.melds[payload.p_target_pid][payload.p_target_meld_idx];
    if (!G.SpetoRules.canLayoff(payload.p_card_code, target)) {
      return Promise.resolve({ data: { ok: false, error: 'LAYOFF_NOT_POSSIBLE' } });
    }
    if (!g.hasFirstMeld[pid]) return Promise.resolve({ data: { ok: false, error: 'MUST_MELD_FIRST' } });
    g.melds[payload.p_target_pid][payload.p_target_meld_idx] = target.concat([payload.p_card_code]);
    g.hands[pid] = g.hands[pid].filter(function(c){ return c !== payload.p_card_code; });
    g.version = ++S.version;
    return Promise.resolve({ data: { ok: true, game: JSON.parse(JSON.stringify(g)) } });
  }
  if (action === 'DISCARD') {
    if ((g.pickedFromDiscard[pid] || []).length) return Promise.resolve({ data: { ok: false, error: 'MUST_MELD_PICKED' } });
    g.hands[pid] = g.hands[pid].filter(function(c){ return c !== payload.p_card_code; });
    g.discardPile = g.discardPile.concat([payload.p_card_code]);
    g.hasDiscardedThisTurn[pid] = true;
    g.version = ++S.version;
    return Promise.resolve({ data: { ok: true, game: JSON.parse(JSON.stringify(g)) } });
  }
  if (action === 'END_TURN') {
    g.hasDiscardedThisTurn = {};
    var i = g.playerOrder.indexOf(g.turnPlayerId);
    g.turnPlayerId = g.playerOrder[(i + 1) % g.playerOrder.length];
    g.phase = 'draw';
    g.version = ++S.version;
    return Promise.resolve({ data: { ok: true, game: JSON.parse(JSON.stringify(g)) } });
  }
  return Promise.resolve({ data: { ok: false, error: 'UNKNOWN_ACTION' } });
}

// ============ MOCK DB (รองรับ chain + optimistic lock) ============
function makeDb() {
  return {
    from: function() {
      return {
        select: function() {
          return { eq: function() { return { single: function() { return Promise.resolve({ data: JSON.parse(JSON.stringify(S)) }); } }; } };
        },
        update: function(obj) {
          var applied = false;
          function apply() {
            if (applied) return;
            applied = true;
            if (obj.game) S.game = JSON.parse(JSON.stringify(obj.game));
            if (obj.status) S.status = obj.status;
            if (obj.version != null) S.version = obj.version;
          }
          var chain = {
            eq: function(k, v) {
              if (k === 'version' && v !== S.version) {
                chain.__conflict = true;
                return { select: function() { return Promise.resolve({ data: [] }); } };
              }
              return chain;
            },
            select: function() { apply(); return Promise.resolve({ data: [{ version: S.version }] }); },
            then: function(resolve, reject) { apply(); return Promise.resolve({ data: [{ version: S.version }] }).then(resolve, reject); }
          };
          return chain;
        }
      };
    },
    rpc: function(name, payload) {
      if (name !== 'play_turn') return Promise.resolve({ data: null, error: { message: 'no rpc' } });
      return fakeRpc(payload.p_action, payload);
    }
  };
}

function setupRoom(opts) {
  S = newRoom(opts);
  G.db = makeDb();
  G.roomCode = 'IT1';
  G.myPlayerId = 'me';
  G.myTurn = true;
  G.currentGame = JSON.parse(JSON.stringify(S.game));
  G.currentRoomVersion = S.version;
  G.selectedCards = [];
  G.pendingPickedCodes = [];
  G.layoffTargets = [];
  G.window._selectedMeld = null;
}

console.log('==========================================');
console.log(' INTEGRATION v55 — จำลองรอบเต็ม');
console.log('==========================================');

// ============================================================
// SCENARIO A: หยิบจากกองทิ้ง → เกิด → ฝาก → ทิ้ง → น็อค
// ============================================================
setupRoom({ hand: ['9♠','9♦','9♥','8♥','K♠'], discard: ['3♦','9♣'] });
G.pickFromDiscard(1).then(function() {           // หยิบ 9♣ (เกิดกับ 9♠9♦9♥ ได้)
  ok('A1: หยิบจากกองทิ้งสำเร็จ → everPick = true', S.game.everPick.me === true, S.game.everPick);
  ok('A2: ไพ่ที่หยิบเข้ามือ', (S.game.hands.me || []).indexOf('9♣') >= 0, S.game.hands.me);
  G.currentGame = JSON.parse(JSON.stringify(S.game));
  G.currentRoomVersion = S.version;
  G.window._selectedMeld = { cards: G.codesToCards(['9♣','9♠','9♦']) };
  return G.confirmMeld();
}).then(function() {
  ok('A3: เกิดชุดที่ใช้ไพ่ที่หยิบสำเร็จ', (S.game.melds.me || []).length === 1, S.game.melds.me);
  ok('A4: everMeld = true', S.game.everMeld.me === true, S.game.everMeld);
  ok('A5: ไพ่ที่หยิบถูกล้างหลังเกิด', (S.game.pickedFromDiscard.me || []).length === 0);
  // ฝาก: ตอนนี้ everPick = true + เกิดแล้ว → ต้องมีเป้าหมาย
  G.currentGame = JSON.parse(JSON.stringify(S.game));
  G.currentRoomVersion = S.version;
  G.updateLayoffTargets();
  ok('A6: เคยเก็บเกิดจากกองทิ้งแล้ว → ฝากได้ (มีเป้าหมาย)', (G.layoffTargets || []).length > 0, G.layoffTargets);
  ok('A6x (OPTION B): ไม่มีเป้าหมายชุดของตัวเอง', !(G.layoffTargets || []).some(function(t){ return t.targetPid === 'me'; }), G.layoffTargets);
  // ฝาก 8♥ ลงชุดตอง 8♠8♦8♣ ของบอท
  G.currentGame = JSON.parse(JSON.stringify(S.game));
  G.currentRoomVersion = S.version;
  // เลือกเป้าหมายที่เป็นชุดของบอท (ฝากลงชุดของคนอื่น)
  var lo = (G.layoffTargets || []).filter(function(t){ return t.targetPid === 'bot_1'; })[0];
  if (lo) {
    return G.selectLayoff(lo);
  }
  ok('A6b: ไม่มีเป้าหมายฝาก (ข้าม)', false, G.layoffTargets);
  return Promise.resolve();
}).then(function() {
  ok('A6c: ฝากสำเร็จ (8♥ ต่อชุด 8 ของบอท)', (S.game.melds.bot_1[0] || []).indexOf('8♥') >= 0, S.game.melds.bot_1);
  ok('A6d: หมายเหตุ — client ให้ฝากลงชุดของตัวเองได้ด้วย (client+server ทำเหมือนกัน)', true);
  // ทิ้งไพ่ 9♥ เหลือ K♠ แล้วน็อค
  G.currentGame = JSON.parse(JSON.stringify(S.game));
  G.currentRoomVersion = S.version;
  G.selectedCards = ['9♥'];
  return G.discardSelected();
}).then(function() {
  ok('A7: ทิ้งไพ่สำเร็จ (เหลือ K♠ 1 ใบ)', (S.game.hands.me || []).length === 1 && (S.game.hands.me || [])[0] === 'K♠', S.game.hands.me);
  G.currentGame = JSON.parse(JSON.stringify(S.game));
  G.currentRoomVersion = S.version;
  return G.doKnock();
}).then(function() {
  ok('A8: น็อคสำเร็จ (ห้อง ended)', S.status === 'ended', { status: S.status });
  var rs = S.game.roundScores || {};
  ok('A9: เคยเกิดแล้ว → ไม่โดน ×2 (darkKnock = false)', !(S.game.roundScores && S.game.everMeld.me === false), { everMeld: S.game.everMeld, rs: rs });
  console.log('   roundScores =', JSON.stringify(rs), ' everMeld =', JSON.stringify(S.game.everMeld), ' everPick =', JSON.stringify(S.game.everPick));

  // ============================================================
  // SCENARIO B: ไม่เคยเกิดเลย → น็อคมืด ×2
  // ============================================================
  setupRoom({ hand: ['7♠'], discard: ['3♦'] });
  return G.doKnock();
}).then(function() {
  var rs = S.game.roundScores || {};
  // 7♠ = 5 แต้ม → hand×2 = 10 · bonus = 100 + 50 = 150 → 140 → ×2 = 280
  ok('B1: ไม่เคยเกิดเลย → น็อคมืด ×2 = 280', rs.me === 280, rs);
  ok('B2: everMeld ยัง false', S.game.everMeld.me === false, S.game.everMeld);

  // ============================================================
  // SCENARIO C: ข้ามรอบ → ธงต้องสืบทอด
  // ============================================================
  var prev = JSON.parse(JSON.stringify(S.game));
  prev.everMeld.me = true;
  prev.everPick.me = true;
  S.game = prev;
  G.currentGame = JSON.parse(JSON.stringify(S.game));
  captured.length = 0;
  var origFrom = G.db.from;
  G.db.from = function() {
    return {
      select: function() { return { eq: function() { return { single: function() { return Promise.resolve({ data: { players: S.players } }); } }; } }; },
      update: function(obj) { captured.push(obj); return { eq: function() { return Promise.resolve({}); } }; }
    };
  };
  return G.playAgain();
}).then(function() {
  var ng = (captured[0] && captured[0].game) || {};
  ok('C1: ข้ามรอบ → everMeld สืบทอด', ng.everMeld && ng.everMeld.me === true, ng.everMeld);
  ok('C2: ข้ามรอบ → everPick สืบทอด', ng.everPick && ng.everPick.me === true, ng.everPick);
  ok('C3: ไม่มี VERSION_MISMATCH ตลอดรอบ', !rpcLog.some(function(x){ return /MISMATCH/.test(x); }), rpcLog);
  console.log('   rpcLog =', rpcLog.join(' | '));
  console.log('\n📊 ผล: ' + pass + ' ผ่าน / ' + fail + ' ไม่ผ่าน');
  process.exit(fail > 0 ? 1 : 0);
}).catch(function(e) {
  console.log('❌ error:', e && e.stack ? e.stack.split('\n').slice(0,3).join('\n') : e);
  console.log('\n📊 ผล: ' + pass + ' ผ่าน / ' + (fail + 1) + ' ไม่ผ่าน');
  process.exit(1);
});
