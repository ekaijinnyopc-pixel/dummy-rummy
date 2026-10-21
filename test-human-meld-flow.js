#!/usr/bin/env node
/**
 * TEST: flow "เกิด" ของผู้เล่นมนุษย์แบบสมจริง
 *  1) จั่ว → 2) หยิบจากกองทิ้ง → 3) เกิดใบที่หยิบ → 4) ทิ้ง → 5) จบตา
 * ตรวจว่า server บังคับให้เกิดใบที่หยิบจริงหรือไม่
 */
const fs = require('fs');
const vm = require('vm');
const BASE = 'https://dbtlbeymrchodloboymr.supabase.co';
const SRC = fs.readFileSync('/data/.openclaw/workspace/dummy-rummy/game-core.js', 'utf8');
const KEY = SRC.split("const SUPABASE_KEY = '")[1].split("'")[0];
const H = { apikey: KEY, Authorization: '***' + KEY, 'Content-Type': 'application/json' };

async function rest(m, p, b) {
  const r = await fetch(BASE + p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; }
  return { status: r.status, data: j };
}

function makeQuery(path, method, body) {
  let filters = [];
  const q = {
    select(c) { q._sel = c; return q; },
    eq(a, b) { filters.push([a, b]); return q; },
    order() { return q; }, limit() { return q; },
    upsert(b) { return makeQuery(path, 'POST', b); },
    insert(b) { return makeQuery(path, 'POST', b); },
    update(b) { return makeQuery(path, 'PATCH', b); },
    delete() { return makeQuery(path, 'DELETE', undefined); },
    single() { return run('GET', undefined, true); },
    maybeSingle() { return run('GET', undefined, false); },
    then(res, rej) { return run(method, body, false).then(res, rej); },
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
      return d ? { data: d, error: null } : { data: null, error: { message: 'no rows' } };
    }
    return { data: r.data, error: null };
  }
  return q;
}

const db = {
  from: (t) => makeQuery(`/rest/v1/${t}`, 'GET', undefined),
  rpc: (name, payload) => (async () => {
    const r = await rest('POST', `/rest/v1/rpc/${name}`, payload);
    if (r.status >= 400) return { data: null, error: { message: JSON.stringify(r.data) } };
    return { data: r.data, error: null };
  })(),
  channel: () => ({ on() { return this; }, subscribe: async () => {}, unsubscribe: async () => {} }),
};

function el() {
  const cls = new Set();
  return {
    textContent: '', innerHTML: '', className: '', disabled: false, style: {},
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) },
    getAttribute: () => null, setAttribute() {}, appendChild() {}, removeChild() {},
  };
}
const dom = {};
const document = {
  getElementById: id => dom[id] || (dom[id] = el()),
  querySelectorAll: () => [], querySelector: () => el(),
  createElement: () => el(), head: { appendChild() {} }, body: { appendChild() {} },
  addEventListener() {},
};
const window = { supabase: undefined, addEventListener() {} };

const sandbox = {
  document, window, db, console, setTimeout, clearTimeout,
  setInterval: () => 0, clearInterval: () => {},
  Promise, Math, Date, JSON, Object, Array, String, Number, Boolean, Set, Map,
  parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, fetch, URLSearchParams,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox, { filename: 'game-core.js' });

(async () => {
  const ROOM = 'F' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const ME = 'p_me', BOT = 'p_bot';

  // กองทิ้งมี 5♥ ที่หยิบแล้วเกิดกับ 3♥4♥ ในมือได้
  const game = {
    deck: ['K♠', 'Q♠', 'J♠'],
    hands: { [ME]: ['3♥', '4♥', '9♣'], [BOT]: ['A♠', '2♠', '3♠'] },
    discardPile: ['5♥'],
    turnPlayerId: ME, playerOrder: [ME, BOT],
    phase: 'draw', status: 'playing',
    melds: { [ME]: [], [BOT]: [] },
    scores: { [ME]: 0, [BOT]: 0 },
    hasFirstMeld: { [ME]: false, [BOT]: false },
    hasDiscardedThisTurn: {}, pickedFromDiscard: {},
    deckEmpty: false, version: 1, headCard: '5♥', headPoints: 50,
  };
  const players = {
    [ME]: { id: ME, name: 'Me', isBot: false, isHost: true },
    [BOT]: { id: BOT, name: 'Bot', isBot: true, isHost: false },
  };
  await rest('POST', '/rest/v1/rooms', { id: ROOM, code: ROOM, players, status: 'playing',
    totalplayers: 2, game, version: 1 });

  sandbox.roomCode = ROOM;
  sandbox.myPlayerId = ME;
  sandbox.myTurn = true;
  sandbox.currentGame = game;
  sandbox.currentRoomVersion = 1;
  sandbox.pendingPickedCodes = [];

  let pass = 0, fail = 0;
  const check = (n, c, x) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (x ? ' — ' + x : ''))); };

  console.log('='.repeat(62));
  console.log('TEST: flow "เกิด" ของผู้เล่นมนุษย์ (หยิบจากกองทิ้ง → เกิด → ทิ้ง → จบตา)');
  console.log('='.repeat(62));

  // --- ขั้น 1: หยิบจากกองทิ้ง (5♥) ---
  console.log('\n--- ขั้นที่ 1: หยิบ 5♥ จากกองทิ้ง ---');
  await sandbox.pickFromDiscard(0);
  const picked = sandbox.pendingPickedCodes;
  console.log('  pendingPickedCodes =', JSON.stringify(picked));
  check('หยิบได้และบันทึก pendingPickedCodes', picked && picked.length === 1, JSON.stringify(picked));

  // --- ขั้น 2: เกิดต้องใช้ใบที่หยิบ ---
  console.log('\n--- ขั้นที่ 2: เกิด (ต้องใช้ 5♥ ที่หยิบมา) ---');
  sandbox.openMeldModal(picked);
  const section = dom['meld-section'];
  const html = section ? section.innerHTML : '';
  const shown = (html.match(/<div class="ms-card[^>]*>([^<]*)<br>([^<]*)/g) || [])
    .map(x => x.replace(/<[^>]*>/g, '').replace(/\s+/g, ''));
  console.log('  ตัวเลือกที่แสดง:', shown.join(' ') || '(ไม่มี)');
  check('แสดงชุดที่มีใบที่หยิบ', html.includes('5♥'), 'ไม่เจอ 5♥ ในตัวเลือก');

  // เลือกชุดแรก
  sandbox.selectMeld(0, picked);
  const sel = window._selectedMeld;
  console.log('  ชุดที่เลือก:', sel ? sel.cards.map(c => c.code).join(', ') : 'ไม่ได้เลือก');
  check('เลือกชุดที่มีใบที่หยิบ', sel && sel.cards.some(c => picked.includes(c.code)));

  // --- ขั้น 3: confirmMeld ---
  console.log('\n--- ขั้นที่ 3: ยืนยันการเกิด ---');
  await sandbox.confirmMeld();
  const row = (await rest('GET', `/rest/v1/rooms?id=eq.${ROOM}&select=game`)).data[0];
  const g = row.game;
  console.log('  melds[me] =', JSON.stringify(g.melds[ME]));
  console.log('  hands[me] =', JSON.stringify(g.hands[ME]));
  console.log('  hasFirstMeld =', JSON.stringify(g.hasFirstMeld));
  check('มอลด์ถูกบันทึก', (g.melds[ME] || []).length > 0);
  check('ไพ่หยิบ (5♥) ถูกหักจากมือ', !(g.hands[ME] || []).includes('5♥'));
  check('hasFirstMeld ตั้งเป็น true', g.hasFirstMeld && g.hasFirstMeld[ME] === true);
  check('pendingPickedCodes ถูกเคลียร์', sandbox.pendingPickedCodes.length === 0);

  // --- ขั้น 4: เลือก + ทิ้งไพ่ ---
  console.log('\n--- ขั้นที่ 4: เลือก 1 ใบแล้วทิ้ง ---');
  sandbox.selectedCards = ['9♣'];
  await sandbox.discardSelected();
  const row2 = (await rest('GET', `/rest/v1/rooms?id=eq.${ROOM}&select=game`)).data[0];
  console.log('  hands[me] =', JSON.stringify(row2.game.hands[ME]));
  console.log('  discardPile =', JSON.stringify(row2.game.discardPile));
  check('ทิ้งไพ่สำเร็จ (ไพ่หักจากมือ)', !(row2.game.hands[ME] || []).includes('9♣'));
  check('ไพ่เข้ากองทิ้ง', (row2.game.discardPile || []).includes('9♣'));
  check('hasDiscardedThisTurn = true', row2.game.hasDiscardedThisTurn && row2.game.hasDiscardedThisTurn[ME] === true);

  // --- ขั้น 5: จบตา ---
  console.log('\n--- ขั้นที่ 5: จบตา ---');
  sandbox.currentGame = row2.game;
  sandbox.currentRoomVersion = (await rest('GET', `/rest/v1/rooms?id=eq.${ROOM}&select=version`)).data[0].version;
  sandbox.myTurn = true;
  const before = row2.game.turnPlayerId;
  await sandbox.endTurn();
  const row3 = (await rest('GET', `/rest/v1/rooms?id=eq.${ROOM}&select=game`)).data[0];
  console.log('  turnPlayerId: ' + before + ' → ' + row3.game.turnPlayerId);
  console.log('  phase =', row3.game.phase);
  check('ตาเปลี่ยนไปคนอื่น', row3.game.turnPlayerId !== before);
  check('phase กลับเป็น draw', row3.game.phase === 'draw');

  // --- ขั้น 6: ทิ้งไม่ได้ถ้ายังไม่ทิ้ง (MUST_DISCARD) ---
  console.log('\n--- ขั้นที่ 6: server บังคับให้ทิ้งไพ่ก่อนจบตาไหม? ---');
  const v = (await rest('GET', `/rest/v1/rooms?id=eq.${ROOM}&select=version`)).data[0].version;
  const r6 = await rest('POST', '/rest/v1/rpc/play_turn', {
    p_game_id: ROOM, p_player_id: row3.game.turnPlayerId, p_action: 'END_TURN',
    p_expected_version: v });
  console.log('  error =', r6.data && r6.data.error);
  check('บังคับ MUST_DISCARD', r6.data && r6.data.error === 'MUST_DISCARD');

  await rest('DELETE', `/rest/v1/rooms?id=eq.${ROOM}`);
  console.log('\n' + '='.repeat(62));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  console.log('='.repeat(62));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(2); });
