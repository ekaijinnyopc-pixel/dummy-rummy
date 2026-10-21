#!/usr/bin/env node
/**
 * TEST: มุมมองของ "ผู้เล่นคนอื่น" ตอนเกมจบ
 * จำลอง polling path (game-core.js:1448 → 1484) ตอน status === 'ended'
 */
const fs = require('fs');
const BASE = 'https://dbtlbeymrchodloboymr.supabase.co';
const SRC = fs.readFileSync('/data/.openclaw/workspace/dummy-rummy/game-core.js', 'utf8');
const KEY = SRC.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_.-]+/)[0];
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

async function rest(m, p, b) {
  const r = await fetch(BASE + p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; }
  return { status: r.status, data: j };
}

(async () => {
  const ROOM = 'E' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const P1 = 'p_knocker', P2 = 'p_other';

  // P1 เกิดแล้ว น็อค, P2 ไม่เกิด
  const game = {
    deck: ['Q♣'], hands: { [P1]: [], [P2]: ['A♠', 'K♥', '2♣'] },
    discardPile: ['3♣'], turnPlayerId: P1, playerOrder: [P1, P2],
    phase: 'action', status: 'playing',
    melds: { [P1]: [['3♥', '4♥', '5♥']], [P2]: [] },
    scores: { [P1]: 0, [P2]: 0 },
    hasFirstMeld: { [P1]: true, [P2]: false },
    hasDiscardedThisTurn: {}, pickedFromDiscard: {}, deckEmpty: false,
    version: 1, headCard: '3♣', headPoints: 50,
  };
  const players = {
    [P1]: { id: P1, name: 'น็อคเกอร์', isBot: false, isHost: true },
    [P2]: { id: P2, name: 'คนที่2', isBot: true, isHost: false },
  };
  await rest('POST', '/rest/v1/rooms', { id: ROOM, code: ROOM, players, status: 'playing',
    totalplayers: 2, game, version: 1 });

  // P1 น็อค
  const vr = (await rest('GET', `/rest/v1/rooms?id=eq.${ROOM}&select=version`)).data[0].version;
  const knock = await rest('POST', '/rest/v1/rpc/play_turn', {
    p_game_id: ROOM, p_player_id: P1, p_action: 'KNOCK', p_expected_version: vr,
  });
  console.log('=== P1 KNOCK ===');
  console.log('  ok =', knock.data.ok, '| round_scores =', JSON.stringify(knock.data.round_scores));

  // ---- จำลอง polling path ของ P2 (game-core.js:1448 select + 1484 showEndGame) ----
  const sel = 'id,code,players,game,status,version,totalplayers';
  const row = (await rest('GET', `/rest/v1/rooms?id=eq.${ROOM}&select=${sel}`)).data[0];

  console.log('\n=== มุมมองของ P2 (ผู้เล่นคนอื่น) ตอนเกมจบ ===');
  console.log('  room.status        =', row.status);
  console.log('  room.winner        =', row.winner, '  ← undefined?');
  console.log('  room.totalScores   =', row.totalScores, '  ← undefined?');
  console.log('  game.scores (จริง) =', JSON.stringify(row.game.scores));

  // จำลอง showEndGame
  const winner = row.winner;
  const totalScores = row.totalScores || {};
  const roundScores = {};
  console.log('\n  --- สิ่งที่ P2 เห็นบนหน้าจอ ---');
  console.log('  🏆 ' + (players[winner] ? players[winner].name : '??') + ' ชนะ!');
  const rows = Object.keys(totalScores);
  console.log('  ตารางคะแนน: ' + (rows.length === 0
    ? '❌ ว่างเปล่า — ไม่มีแถวให้ดูเลย'
    : rows.join(', ')));

  let pass = 0, fail = 0;
  const check = (n, c, x) => { c ? (pass++, console.log('  ✅ ' + n)) : (fail++, console.log('  ❌ ' + n + (x ? ' — ' + x : ''))); };
  console.log('\n=== ผลการตรวจ ===');
  check('P2 เห็นชื่อผู้ชนะ', !!(players[winner]), 'winner = undefined → แสดง "??"');
  check('P2 เห็นตารางคะแนน', rows.length > 0, 'totalScores = undefined → ตารางว่าง');
  check('มี column rooms.winner ใน DB', false,
    '❌ column rooms.winner does not exist (ยืนยันแล้วด้วย PostgREST 400)');

  await rest('DELETE', `/rest/v1/rooms?id=eq.${ROOM}`);
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
})();
