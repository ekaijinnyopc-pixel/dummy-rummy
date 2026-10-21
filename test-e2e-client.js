#!/usr/bin/env node
/**
 * Dummy Rummy — End-to-end client harness
 * รันโค้ด client จริง (game-core.js) ใน Node vm + Supabase REST จริง
 * ทดสอบ: MELD (เกิด) และ LAYOFF (ฝาก) ผ่าน flow เดียวกับที่ผู้เล่นกด
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const DIR = '/data/.openclaw/workspace/dummy-rummy';
const SRC = fs.readFileSync(path.join(DIR, 'game-core.js'), 'utf8');
const BASE = 'https://dbtlbeymrchodloboymr.supabase.co';
const KEY = SRC.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_.-]+/)[0];
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

// ---------- REST helper ----------
async function rest(method, p, body) {
  const r = await fetch(BASE + p, {
    method, headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; }
  return { status: r.status, data: j };
}

// ---------- minimal supabase-js-like query builder ----------
function makeQuery(path, method, body) {
  let filters = [];
  const q = {
    select(cols) { q._sel = cols; return q; },
    eq(a, b) { filters.push([a, b]); return q; },
    order() { return q; },
    limit() { return q; },
    upsert(b) { return makeQuery(path, 'POST', b); },
    insert(b) { return makeQuery(path, 'POST', b); },
    update(b) { return makeQuery(path, 'PATCH', b); },
    delete() { return makeQuery(path, 'DELETE', undefined); },
    single() { return run('GET', undefined, true); },
    maybeSingle() { return run('GET', undefined, false); },
    then(resolve, reject) { return run(method, body, false).then(resolve, reject); },
  };
  async function run(m, b, single) {
    let u = path;
    if (q._sel) u += '?select=' + encodeURIComponent(q._sel);
    const qs = filters.map(([a, v]) => `${a}=eq.${v}`).join('&');
    if (qs) u += (u.includes('?') ? '&' : '?') + qs;
    const r = await rest(m, u, b);
    if (r.status >= 400) return { data: null, error: { message: JSON.stringify(r.data), status: r.status } };
    if (single) {
      const d = Array.isArray(r.data) ? r.data[0] : r.data;
      if (!d) return { data: null, error: { message: 'no rows' } };
      return { data: d, error: null };
    }
    return { data: r.data, error: null };
  }
  return q;
}

const db = {
  from(t) {
    return makeQuery(`/rest/v1/${t}`, 'GET', undefined);
  },
  rpc(name, payload) {
    return (async () => {
      const r = await rest('POST', `/rest/v1/rpc/${name}`, payload);
      if (r.status >= 400) return { data: null, error: { message: JSON.stringify(r.data) } };
      return { data: r.data, error: null };
    })();
  },
  channel() {
    return { on() { return this; }, subscribe: async () => {}, unsubscribe: async () => {} };
  },
};

// ---------- DOM stub ----------
function el() {
  const cls = new Set();
  const e = {
    textContent: '', innerHTML: '', className: '', disabled: false, style: {},
    classList: {
      add(c) { cls.add(c); }, remove(c) { cls.delete(c); },
      contains(c) { return cls.has(c); }, toggle(c) { cls.has(c) ? cls.delete(c) : cls.add(c); },
    },
    getAttribute: () => null, setAttribute() {}, appendChild() {}, removeChild() {},
  };
  return e;
}
const domStore = {};
const document = {
  getElementById(id) { return domStore[id] || (domStore[id] = el()); },
  querySelectorAll() { return []; },
  querySelector() { return el(); },
  createElement() { return el(); },
  head: { appendChild() {} },
  body: { appendChild() {} },
  addEventListener() {},
};
const window = { supabase: undefined, _selectedMeld: null, addEventListener() {} };

// ---------- vm sandbox ----------
const sandbox = {
  document, window, db, console,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  Promise, Math, Date, JSON, Object, Array, String, Number, Boolean,
  Set, Map, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  fetch, URLSearchParams,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox, { filename: 'game-core.js' });

const g = (name) => sandbox[name];
const gset = (name, v) => { sandbox[name] = v; };

// ---------- test room ----------
const ROOM = 'T' + Math.random().toString(36).slice(2, 7).toUpperCase();
const ME = 'p_me';
const OTHER = 'p_other';

const game = {
  deck: ['K♠'], discardPile: ['3♣'],
  hands: { [ME]: ['3♥', '4♥', '5♥', '6♥', 'K♠'], [OTHER]: ['A♠'] },
  turnPlayerId: ME, playerOrder: [ME, OTHER], phase: 'action', status: 'playing',
  melds: { [ME]: [['3♥', '4♥', '5♥']], [OTHER]: [] },
  scores: { [ME]: 0, [OTHER]: 0 },
  round: 1, turnStartTime: Date.now(), headCard: '3♣', headPoints: 50,
  hasFirstMeld: { [ME]: true, [OTHER]: true },
  lastDiscard: null, deckEmpty: false, pickedFromDiscard: {}, version: 1,
};
const players = {
  [ME]: { id: ME, name: 'Me', isBot: false, isHost: true },
  [OTHER]: { id: OTHER, name: 'Bot', isBot: true, isHost: false },
};

function line(t) { console.log(t); }
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; line(`  ✅ ${name}`); }
  else { fail++; line(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
  line('='.repeat(64));
  line('DUMMY RUMMY — E2E CLIENT HARNESS (game-core.js + Supabase จริง)');
  line('='.repeat(64));

  // setup room
  let r = await rest('POST', '/rest/v1/rooms', {
    id: ROOM, code: ROOM, players, status: 'playing', totalplayers: 2, game, version: 1,
  });
  line(`\n[setup] insert room ${ROOM} -> ${r.status}`);
  if (r.status >= 400) { line(JSON.stringify(r.data)); process.exit(1); }

  // inject client state (var decls in vm live on the sandbox global)
  sandbox.roomCode = ROOM;
  sandbox.myPlayerId = ME;
  sandbox.myTurn = true;
  sandbox.currentGame = game;
  sandbox.currentRoomVersion = 1;

  // ---------- TEST A: ลูกค้าเห็นชุดเกิดจากมือ ----------
  line('\n=== TEST A: findMelds() ตรวจชุดเกิดจากมือ ===');
  const hand = g('codesToCards')(sandbox.currentGame.hands[ME]);
  const melds = g('findMelds')(hand);
  line(`  มือ: ${hand.map(c => c.code).join(' ')}`);
  line(`  พบชุดเกิด ${melds.length} ชุด: ${melds.map(m => m.type + '[' + m.cards.map(c => c.code).join(',') + ']').join(' | ')}`);
  check('เจอชุดเกิดอย่างน้อย 1 ชุด', melds.length > 0);

  // ---------- TEST B: renderMeldOptions แสดงชุด ----------
  line('\n=== TEST B: renderMeldOptions() แสดงตัวเลือกเกิด ===');
  g('openMeldModal')([]);
  const section = domStore['meld-section'];
  const hasCards = section && section.innerHTML.includes('ms-card');
  check('meld-section มีตัวเลือกไพ่', !!hasCards,
    hasCards ? '' : 'innerHTML ว่าง');
  if (hasCards) {
    const m = section.innerHTML.match(/<div class="ms-card[^>]*>([^<]*)<br>([^<]*)/g) || [];
    line(`  ตัวเลือกที่แสดง: ${m.map(x => x.replace(/<[^>]*>/g, '')).join(' ')}`);
  }

  // ---------- TEST C: selectMeld + confirmMeld (ฝั่ง client) ----------
  line('\n=== TEST C: selectMeld() → confirmMeld() [เกิดจริง] ===');
  g('selectMeld')(0, []);
  check('selectMeld ตั้ง window._selectedMeld', !!window._selectedMeld,
    window._selectedMeld ? '' : 'ไม่ได้เลือกชุด');
  if (window._selectedMeld) {
    const codes = window._selectedMeld.cards.map(c => c.code);
    line(`  ชุดที่เลือก: ${codes.join(', ')}`);
    const res = await g('confirmMeld')();
    check('confirmMeld() ไม่ throw', true);
    const after = await rest('GET', `/rest/v1/rooms?id=eq.${ROOM}&select=game`);
    const gstate = after.data[0].game;
    const meldsNow = gstate.melds[ME] || [];
    line(`  melds[${ME}] หลังเกิด: ${JSON.stringify(meldsNow)}`);
    check('มอลด์ถูกเพิ่มใน DB', meldsNow.length >= 1);
    check('ไพ่ถูกหักออกจากมือ', !(gstate.hands[ME] || []).includes('3♥'),
      `hands=${JSON.stringify(gstate.hands[ME])}`);
  }

  // ---------- TEST D: LAYOFF — หัวใจของบัก ----------
  line('\n=== TEST D: updateLayoffTargets() → selectLayoff() [ฝาก/เก็บเกิด] ===');
  // รีเซ็ต: ให้ ME มี 6♥ ในมือ และ OTHER มีมอลด์เรียง 3♥4♥5♥ เป็นเป้าหมาย
  const g2 = JSON.parse(JSON.stringify(game));
  g2.hands = { [ME]: ['3♥', '4♥', '5♥', '6♥', 'K♠'], [OTHER]: ['A♠'] };
  g2.melds = { [ME]: [['3♦', '4♦', '5♦']], [OTHER]: [['3♥', '4♥', '5♥']] };
  g2.hasFirstMeld = { [ME]: true, [OTHER]: true };
  g2.version = 2;
  let vr = (await rest('GET', `/rest/v1/rooms?id=eq.${ROOM}&select=version`)).data[0].version;
  await rest('PATCH', `/rest/v1/rooms?id=eq.${ROOM}`, { game: g2, version: vr });
  vr = (await rest('GET', `/rest/v1/rooms?id=eq.${ROOM}&select=version`)).data[0].version;

  gset('currentGame', g2);
  gset('currentRoomVersion', vr);
  g('updateLayoffTargets')();
  const targets = g('layoffTargets');
  line(`  พบเป้าหมายฝาก ${targets.length} รายการ`);
  targets.forEach(t => line(`    - ไพ่ ${t.layoffCard} → ${t.targetPid} meldIndex=${t.meldIndex} (${t.meldType})`));

  check('พบเป้าหมายฝากอย่างน้อย 1 รายการ', targets.length > 0);
  const t0 = targets[0];
  check('target มี field meldIndex (ตัวเลข)', t0 && typeof t0.meldIndex === 'number',
    t0 ? `meldIndex=${JSON.stringify(t0.meldIndex)} (${typeof t0.meldIndex})` : 'ไม่มี target');
  check('ไม่มี field เก่า targetMeld (array) ปนอยู่', t0 && t0.targetMeld === undefined,
    t0 && t0.targetMeld ? 'targetMeld ยังอยู่!' : '');

  if (t0 && typeof t0.meldIndex === 'number') {
    const res = await g('selectLayoff')(t0);
    const after = await rest('GET', `/rest/v1/rooms?id=eq.${ROOM}&select=game`);
    const gstate = after.data[0].game;
    line(`  melds[${t0.targetPid}] หลังฝาก: ${JSON.stringify(gstate.melds[t0.targetPid])}`);
    line(`  hands[${ME}] หลังฝาก: ${JSON.stringify(gstate.hands[ME])}`);
    check('ฝากสำเร็จ — มอลด์เป้าหมายยาวขึ้น',
      (gstate.melds[t0.targetPid][0] || []).length > 3,
      JSON.stringify(gstate.melds[t0.targetPid][0]));
    check('ไพ่ถูกหักออกจากมือผู้ฝาก',
      !(gstate.hands[ME] || []).includes(t0.layoffCard));
  }

  // ---------- TEST E: จำลองบักเดิม (ส่ง meld_idx = undefined) ----------
  line('\n=== TEST E: จำลองบักเดิม — ส่ง meld_idx = undefined ===');
  const st = await rest('POST', '/rest/v1/rpc/play_turn', {
    p_game_id: ROOM, p_player_id: ME, p_action: 'LAYOFF',
    p_card_code: '9♣', p_target_pid: OTHER,
    p_expected_version: (await rest('GET', `/rest/v1/rooms?id=eq.${ROOM}&select=version`)).data[0].version,
  });
  line(`  error = ${st.data && st.data.error}`);
  check('ยืนยันว่าบักเดิมถูก reject (MISSING_PARAMS)',
    st.data && st.data.error === 'MISSING_PARAMS', JSON.stringify(st.data));

  // ---------- cleanup ----------
  await rest('DELETE', `/rest/v1/rooms?id=eq.${ROOM}`);
  line('\n' + '='.repeat(64));
  line(`RESULT: ${pass} passed, ${fail} failed`);
  line('='.repeat(64));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
