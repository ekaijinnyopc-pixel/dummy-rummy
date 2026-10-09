// ============================================================
// 🃏 DUMMY RUMMY — game-core.js v3
// ============================================================

// --- SUPABASE CONFIG ---
const SUPABASE_URL = 'https://dbtlbeymrchodloboymr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRidGxiZXltcmNob2Rsb2JveW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MTIxNTksImV4cCI6MjEwNzA4ODE1OX0.HHqLCDj3_rEAeGQxs-Yz8eX-xJG0VbMbYWIELC6LYbc';

var db;

function initDb() {
  try {
    if (typeof window.supabase !== 'undefined') {
      db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      console.log('[Supabase] Connected! URL:', SUPABASE_URL);
    } else {
      console.error('[Supabase] CDN not loaded!');
      alert('ไม่สามารถโหลด Supabase ได้ กรุณารีเฟรชหน้า');
    }
  } catch(e) {
    console.error('[Supabase] Init error:', e);
  }
}

// Load supabase then init
(function() {
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/dist/umd/index.js';
  script.onload = initDb;
  script.onerror = function() { console.error('[Supabase] CDN failed!'); };
  document.head.appendChild(script);
})();

// --- CONSTANTS ---
var SUITS = ['♠','♥','♦','♣'];
var RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function makeDeck() {
  var deck = [];
  for (var si = 0; si < SUITS.length; si++) {
    for (var ri = 0; ri < RANKS.length; ri++) {
      deck.push({ suit: SUITS[si], rank: RANKS[ri], code: RANKS[ri] + SUITS[si] });
    }
  }
  deck.push({ suit: '♣', rank: '2', code: '2♣', isSpeto: true });
  deck.push({ suit: '♠', rank: 'Q', code: 'Q♠', isSpeto: true });
  deck.push({ suit: '🃏', rank: 'JOKER', code: 'JOKER1', isJoker: true });
  deck.push({ suit: '🃏', rank: 'JOKER', code: 'JOKER2', isJoker: true });
  return deck;
}

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function cardPoints(card) {
  if (card.isJoker || card.isSpeto) return 50;
  if (card.rank === 'A') return 15;
  if (['J','Q','K'].indexOf(card.rank) >= 0) return 10;
  if (['2','3','4','5','6','7','8','9'].indexOf(card.rank) >= 0) return 5;
  return 0;
}

function sortHand(hand) {
  return hand.slice().sort(function(a, b) {
    if (a.isJoker && !b.isJoker) return 1;
    if (!a.isJoker && b.isJoker) return -1;
    if (a.isSpeto && !b.isSpeto) return 1;
    if (!a.isSpeto && b.isSpeto) return -1;
    var suitOrder = { '♠':0, '♥':1, '♦':2, '♣':3 };
    var s1 = suitOrder[a.suit] !== undefined ? suitOrder[a.suit] : 4;
    var s2 = suitOrder[b.suit] !== undefined ? suitOrder[b.suit] : 4;
    if (s1 !== s2) return s1 - s2;
    var rankOrder = {'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13};
    var rv = rankOrder[a.rank] || 14;
    var rv2 = rankOrder[b.rank] || 14;
    return rv - rv2;
  });
}

function codeToCard(code) {
  if (!code) return null;
  if (code === 'JOKER1') return { suit: '🃏', rank: 'JOKER', code: 'JOKER1', isJoker: true };
  if (code === 'JOKER2') return { suit: '🃏', rank: 'JOKER', code: 'JOKER2', isJoker: true };
  if (code === '2♣') return { suit: '♣', rank: '2', code: '2♣', isSpeto: true };
  if (code === 'Q♠') return { suit: '♠', rank: 'Q', code: 'Q♠', isSpeto: true };
  for (var si = 0; si < SUITS.length; si++) {
    if (code.indexOf(SUITS[si], code.length - SUITS[si].length) !== -1) {
      var rank = code.substring(0, code.length - 1);
      return { suit: SUITS[si], rank: rank, code: code };
    }
  }
  return null;
}

function codesToCards(codes) {
  if (!codes) return [];
  var result = [];
  for (var i = 0; i < codes.length; i++) {
    var card = codeToCard(codes[i]);
    if (card) result.push(card);
  }
  return result;
}

function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// --- GAME STATE ---
var myPlayerId = null;
var myName = '';
var roomCode = null;
var realtimeChannel = null;
var currentGame = null;
var selectedCards = [];
var myTurn = false;
var turnPlayerId = null;
var selectedMeldIndex = null;

// --- UTILITY ---
function genRoomCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function notify(msg) {
  try {
    var el = document.getElementById('notification');
    if (el) { el.textContent = msg; el.className = 'notification show'; setTimeout(function() { el.className = 'notification'; }, 3500); }
  } catch(e) { console.log('notify:', msg); }
}

function showScreen(id) {
  try {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
    var target = document.getElementById(id);
    if (target) target.classList.add('active');
  } catch(e) { console.error('showScreen error:', e); }
}

function renderCardEl(card) {
  if (!card) return '';
  var bg, border, color;
  if (card.isJoker) { bg = 'linear-gradient(135deg,#ffd700,#ff8f00)'; border = '#ffd700'; color = '#fff'; }
  else if (card.isSpeto) { bg = '#1a1a2e'; border = '#ffd700'; color = '#ffd700'; }
  else if (card.suit === '♥' || card.suit === '♦') { bg = '#fff5f5'; border = '#ef9a9a'; color = '#c62828'; }
  else { bg = '#f5f5ff'; border = '#9fa8da'; color = '#1a237e'; }
  var rank = card.isJoker ? 'J' : card.rank;
  var suit = card.isJoker ? '★' : card.suit;
  var sel = false;
  for (var i = 0; i < selectedCards.length; i++) { if (selectedCards[i] === card.code) { sel = true; break; } }
  var selStyle = sel ? 'box-shadow:0 0 14px rgba(255,215,0,0.7);transform:translateY(-12px)' : '';
  var cursor = myTurn ? 'cursor:pointer' : '';
  return '<div onclick="' + (myTurn ? "toggleSelect('" + card.code + '")" : '') + '" style="width:60px;height:84px;background:' + bg + ';border:2px solid ' + (sel ? '#ffd700' : border) + ';color:' + color + ';border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;transition:all 0.15s;' + selStyle + ';' + cursor + '">' +
    '<span style="font-size:1rem;font-weight:700">' + rank + '</span>' +
    '<span style="font-size:1.3rem">' + suit + '</span>' +
    (card.isSpeto ? '<span style="font-size:0.5rem;color:#ffd700">สเปโต</span>' : '') +
    (card.isJoker ? '<span style="font-size:0.5rem;color:#fff">โจ๊กเกอร์</span>' : '') +
    '</div>';
}

function toggleSelect(code) {
  try {
    var hand = currentGame && currentGame.hands ? (currentGame.hands[myPlayerId] || []) : [];
    if (hand.indexOf(code) === -1) return;
    var idx = selectedCards.indexOf(code);
    if (idx >= 0) selectedCards.splice(idx, 1); else selectedCards.push(code);
    renderYourHand();
    updateActionBtns();
  } catch(e) { console.error('toggleSelect error:', e); }
}

function confetti() {
  try {
    var c = document.getElementById('confetti');
    if (!c) return;
    c.innerHTML = '';
    var colors = ['#ffd700','#e94560','#4caf50','#2196f3','#ff9800','#9c27b0'];
    for (var i = 0; i < 80; i++) {
      var p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.left = (Math.random() * 100) + '%';
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDelay = (Math.random() * 2) + 's';
      p.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
      c.appendChild(p);
    }
    setTimeout(function() { if (c) c.innerHTML = ''; }, 5000);
  } catch(e) {}
}

// --- SUPABASE ---
async function setupRealtime(rid) {
  try {
    if (realtimeChannel) { realtimeChannel.unsubscribe(); realtimeChannel = null; }
    realtimeChannel = db.channel('room-' + rid);
    realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: 'id=eq.' + rid }, function(payload) {
      try {
        var room = payload.new;
        if (!room) return;
        if (room.status === 'lobby') renderLobby(room.players || {});
        else if (room.status === 'playing' && room.game) {
          currentGame = room.game;
          showScreen('game-screen');
          renderGame(room.game);
        } else if (room.status === 'ended') {
          showEndGame({ winner: room.winner, totalScores: room.totalScores, players: room.players });
        }
      } catch(e) { console.error('realtime callback error:', e); }
    });
    await realtimeChannel.subscribe();
    console.log('[Realtime] Subscribed to room:', rid);
  } catch(e) { console.error('[Realtime] Setup error:', e); notify('❌ เชื่อมต่อ realtime ไม่ได้'); }
}

// --- HOME ---
async function createRoom() {
  try {
    var name = document.getElementById('create-name').value.trim();
    if (!name) { notify('กรุณาใส่ชื่อ'); return; }
    if (!db) { notify('กรุณารอสักครู่... กดอีกครั้ง'); return; }
    var botCount = parseInt(document.getElementById('bot-count').value) || 0;
    roomCode = genRoomCode();
    myName = name;
    myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
    var players = {};
    players[myPlayerId] = { id: myPlayerId, name: name, isBot: false, isHost: true };
    var botNames = ['🤖 บอทซ้าย', '🤖 บอทกลาง', '🤖 บอทขวา'];
    for (var i = 0; i < botCount; i++) {
      players['bot_' + i] = { id: 'bot_' + i, name: botNames[i], isBot: true, isHost: false };
    }
    var _data = await db.from('rooms').upsert({ id: roomCode, code: roomCode, players: players, status: 'lobby' });
    if (_data.error) { notify('❌ สร้างห้องไม่สำเร็จ: ' + _data.error.message); return; }
    showScreen('lobby-screen');
    document.getElementById('display-room-code').textContent = roomCode;
    await setupRealtime(roomCode);
    renderLobby(players);
    notify('✅ สร้างห้องสำเร็จ!');
  } catch(e) { console.error('createRoom error:', e); notify('❌ ผิดพลาด: ' + e.message); }
}

async function joinRoom() {
  try {
    var code = (document.getElementById('join-code').value || '').trim().toUpperCase();
    var name = (document.getElementById('join-name').value || '').trim();
    if (!code) { notify('กรุณาใส่รหัสห้อง'); return; }
    if (!name) { notify('กรุณาใส่ชื่อ'); return; }
    if (!db) { notify('กรุณารอสักครู่... กดอีกครั้ง'); return; }
    myName = name;
    myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
    var _data = await db.from('rooms').select('*').eq('id', code).single();
    if (_data.error || !_data.data) { notify('❌ ไม่พบห้องนี้'); return; }
    var room = _data.data;
    if (room.status === 'playing') { notify('❌ เกมเริ่มแล้ว'); return; }
    var players = Object.assign({}, room.players || {});
    var keys = Object.keys(players);
    if (keys.length >= 4) { notify('❌ ห้องเต็มแล้ว'); return; }
    players[myPlayerId] = { id: myPlayerId, name: name, isBot: false, isHost: false };
    await db.from('rooms').update({ players: players }).eq('id', code);
    roomCode = code;
    showScreen('lobby-screen');
    document.getElementById('display-room-code').textContent = code;
    await setupRealtime(code);
    renderLobby(players);
    notify('✅ เข้าห้องสำเร็จ!');
  } catch(e) { console.error('joinRoom error:', e); notify('❌ ผิดพลาด: ' + e.message); }
}

async function leaveRoom() {
  try {
    if (!roomCode || !myPlayerId) return;
    var _data = await db.from('rooms').select('players').eq('id', roomCode).single();
    if (_data.data) {
      var players = Object.assign({}, _data.data.players || {});
      delete players[myPlayerId];
      var keys = Object.keys(players);
      if (keys.length === 0) await db.from('rooms').delete().eq('id', roomCode);
      else await db.from('rooms').update({ players: players }).eq('id', roomCode);
    }
    if (realtimeChannel) { realtimeChannel.unsubscribe(); realtimeChannel = null; }
    roomCode = null; myPlayerId = null; currentGame = null; selectedCards = [];
    showScreen('home-screen');
  } catch(e) { console.error('leaveRoom error:', e); }
}

async function startGame() {
  try {
    if (!roomCode) return;
    var _data = await db.from('rooms').select('players').eq('id', roomCode).single();
    if (!_data.data) return;
    var players = _data.data.players || {};
    var playerIds = Object.keys(players);
    if (playerIds.length < 2) { notify('ต้องมีอย่างน้อย 2 คน'); return; }
    var deck = shuffle(makeDeck());
    var hands = {};
    for (var pi = 0; pi < playerIds.length; pi++) {
      var handCards = [];
      for (var di = 0; di < 7; di++) handCards.push(deck.pop().code);
      hands[playerIds[pi]] = handCards;
    }
    var discardPile = [deck.pop().code];
    var gameData = {
      deck: deck.map(function(c) { return c.code; }),
      hands: hands,
      discardPile: discardPile,
      turnPlayerId: playerIds[0],
      playerOrder: playerIds,
      phase: 'draw',
      status: 'playing',
      melds: {},
      scores: {},
      round: 1,
      turnStartTime: Date.now()
    };
    for (var mi = 0; mi < playerIds.length; mi++) {
      gameData.melds[playerIds[mi]] = [];
      gameData.scores[playerIds[mi]] = 0;
    }
    await db.from('rooms').update({ status: 'playing', game: gameData }).eq('id', roomCode);
    currentGame = gameData;
    showScreen('game-screen');
    renderGame(gameData);
  } catch(e) { console.error('startGame error:', e); notify('❌ ผิดพลาด: ' + e.message); }
}

// --- GAME ACTIONS ---
async function drawCard() {
  try {
    if (!currentGame || !myTurn || currentGame.phase !== 'draw') return;
    var deck = currentGame.deck.slice();
    if (deck.length === 0) { notify('กองจั่วหมดแล้ว!'); return; }
    var drawn = deck.pop();
    var newHands = Object.assign({}, currentGame.hands);
    newHands[myPlayerId] = (newHands[myPlayerId] || []).concat([drawn.code]);
    currentGame = Object.assign({}, currentGame, { deck: deck, hands: newHands, phase: 'action', turnStartTime: Date.now() });
    await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
    renderYourHand();
    updateActionBtns();
    notify('📦 จั่วได้: ' + drawn.rank + drawn.suit);
  } catch(e) { console.error('drawCard error:', e); }
}

async function pickDiscard() {
  try {
    if (!currentGame || !myTurn || currentGame.phase !== 'draw') return;
    var discard = currentGame.discardPile.slice();
    if (discard.length === 0) return;
    var top = discard.pop();
    var newHands = Object.assign({}, currentGame.hands);
    newHands[myPlayerId] = (newHands[myPlayerId] || []).concat([top]);
    currentGame = Object.assign({}, currentGame, { hands: newHands, discardPile: discard, phase: 'action', turnStartTime: Date.now() });
    await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
    renderYourHand();
    updateActionBtns();
    var topCard = codeToCard(top);
    notify('🗑️ หยิบ: ' + (topCard ? topCard.rank + topCard.suit : top));
  } catch(e) { console.error('pickDiscard error:', e); }
}

async function discardSelected() {
  try {
    if (!currentGame || !myTurn || selectedCards.length !== 1) { notify('เลือกไพ่ 1 ใบที่จะทิ้ง'); return; }
    var card = selectedCards[0];
    var hand = (currentGame.hands[myPlayerId] || []).slice();
    var newHand = hand.filter(function(c) { return c !== card; });
    var newDiscard = currentGame.discardPile.concat([card]);
    selectedCards = [];
    if (newHand.length === 0) { await handleKnockout(myPlayerId); return; }
    var newHands = Object.assign({}, currentGame.hands);
    newHands[myPlayerId] = newHand;
    currentGame = Object.assign({}, currentGame, { hands: newHands, discardPile: newDiscard, phase: 'draw' });
    await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
    await advanceTurn();
  } catch(e) { console.error('discardSelected error:', e); }
}

async function advanceTurn() {
  try {
    var order = currentGame.playerOrder;
    var idx = order.indexOf(currentGame.turnPlayerId);
    var nextIdx = (idx + 1) % order.length;
    var nextPid = order[nextIdx];
    currentGame = Object.assign({}, currentGame, { turnPlayerId: nextPid, phase: 'draw', turnStartTime: Date.now() });
    await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
    renderGame(currentGame);
    var _data = await db.from('rooms').select('players').eq('id', roomCode).single();
    var nextPlayer = _data.data && _data.data.players ? _data.data.players[nextPid] : null;
    if (nextPlayer && nextPlayer.isBot) setTimeout(function() { botPlay(nextPid); }, 1200);
  } catch(e) { console.error('advanceTurn error:', e); }
}

async function endTurn() {
  try {
    if (!currentGame || !myTurn) return;
    if (currentGame.phase === 'draw') { notify('ต้องจั่วหรือหยิบก่อน!'); return; }
    await advanceTurn();
  } catch(e) { console.error('endTurn error:', e); }
}

async function handleKnockout(koId) {
  try {
    var _data = await db.from('rooms').select('*').eq('id', roomCode).single();
    if (!_data.data) return;
    var players = _data.data.players || {};
    var game = currentGame;
    var allDeck = makeDeck();
    var allCodes = {};
    for (var di = 0; di < allDeck.length; di++) allCodes[allDeck[di].code] = allDeck[di];
    var roundScores = {};
    for (var pid in game.hands) {
      var pts = 0;
      for (var ci = 0; ci < game.hands[pid].length; ci++) {
        var c = allCodes[game.hands[pid][ci]];
        if (c) pts += cardPoints(c);
      }
      roundScores[pid] = pts;
    }
    roundScores[koId] = 0;
    var prevScores = (_data.data.game && _data.data.game.scores) || {};
    var totalScores = {};
    for (var ti = 0; ti < game.playerOrder.length; ti++) {
      var tpid = game.playerOrder[ti];
      totalScores[tpid] = (prevScores[tpid] || 0) + (roundScores[tpid] || 0);
    }
    var winner = null;
    for (var wid in totalScores) {
      if (totalScores[wid] >= 500) {
        var min = Infinity, winPid = null;
        for (var w2 in totalScores) { if (totalScores[w2] < min) { min = totalScores[w2]; winPid = w2; } }
        winner = winPid; break;
      }
    }
    await db.from('rooms').update({ status: 'ended', winner: winner, totalScores: totalScores }).eq('id', roomCode);
    showEndGame({ winner: winner, totalScores: totalScores, roundScores: roundScores, players: players });
  } catch(e) { console.error('handleKnockout error:', e); }
}

// --- BOT ---
async function botPlay(botId) {
  try {
    if (!currentGame || currentGame.status !== 'playing') return;
    if (currentGame.turnPlayerId !== botId) return;
    var hand = codesToCards(currentGame.hands[botId] || []);
    var deck = currentGame.deck.slice();
    if (deck.length > 0) {
      var drawn = deck.pop();
      hand = sortHand(hand.concat([drawn]));
      var newHands = Object.assign({}, currentGame.hands);
      newHands[botId] = hand.map(function(c) { return c.code; });
      currentGame = Object.assign({}, currentGame, { deck: deck, hands: newHands, phase: 'action' });
      await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
      await delay(800);
    }
    if (hand.length > 0) {
      var discard = hand[hand.length - 1];
      var newHand = hand.filter(function(c) { return c.code !== discard.code; });
      var newDiscard = currentGame.discardPile.concat([discard.code]);
      if (newHand.length === 0) {
        await db.from('rooms').update({ game: Object.assign({}, currentGame, { hands: Object.assign({}, currentGame.hands, { botId: [] }), discardPile: newDiscard }) }).eq('id', roomCode);
        await handleKnockout(botId); return;
      }
      var newHands2 = Object.assign({}, currentGame.hands);
      newHands2[botId] = newHand.map(function(c) { return c.code; });
      currentGame = Object.assign({}, currentGame, { hands: newHands2, discardPile: newDiscard });
      await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
      await delay(600);
    }
    await advanceTurn();
  } catch(e) { console.error('botPlay error:', e); }
}

// --- MELD ---
function findMelds(hand) {
  var normals = hand.filter(function(c) { return !c.isJoker && !c.isSpeto; });
  var jokers = hand.filter(function(c) { return c.isJoker; });
  var melds = [];
  var byRank = {};
  for (var ni = 0; ni < normals.length; ni++) {
    var nc = normals[ni];
    if (!byRank[nc.rank]) byRank[nc.rank] = [];
    byRank[nc.rank].push(nc);
  }
  for (var r in byRank) { if (byRank[r].length >= 3) melds.push({ type: 'set', cards: byRank[r].slice() }); }
  for (var r2 in byRank) {
    if (byRank[r2].length === 2 && jokers.length > 0) {
      melds.push({ type: 'set', cards: byRank[r2].concat([jokers.shift()]), jokerUsed: true });
    }
  }
  var bySuit = {};
  for (var si = 0; si < normals.length; si++) {
    var ns = normals[si].suit;
    if (!bySuit[ns]) bySuit[ns] = [];
    bySuit[ns].push(normals[si]);
  }
  var rOrd = {'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13};
  for (var suit in bySuit) {
    var sc = bySuit[suit].slice().sort(function(a, b) { return (rOrd[a.rank] || 14) - (rOrd[b.rank] || 14); });
    var run = [];
    for (var sci = 0; sci < sc.length; sci++) {
      var cur = rOrd[sc[sci].rank] || 14;
      var prev = run.length ? rOrd[run[run.length - 1].rank] : null;
      if (prev !== null && cur === prev + 1) { run.push(sc[sci]); }
      else {
        if (run.length >= 3) melds.push({ type: 'run', cards: run.slice(), suit: suit });
        run = [sc[sci]];
      }
    }
    if (run.length >= 3) melds.push({ type: 'run', cards: run.slice(), suit: suit });
  }
  return melds;
}

function openMeldModal() {
  if (!currentGame || !myTurn) return;
  selectedMeldIndex = null;
  try {
    document.getElementById('meld-modal').classList.add('active');
    document.getElementById('meld-section').style.display = 'block';
    document.getElementById('layoff-section').style.display = 'none';
    document.getElementById('tab-meld').className = 'btn btn-primary';
    document.getElementById('tab-layoff').className = 'btn btn-secondary';
    document.getElementById('btn-confirm-meld').disabled = true;
    renderMeldOptions();
  } catch(e) { console.error('openMeldModal error:', e); }
}
function closeMeldModal() { try { document.getElementById('meld-modal').classList.remove('active'); } catch(e) {} }

function renderCardSmall(card) {
  if (!card) return '';
  var bg, border, color;
  if (card.isJoker) { bg = 'linear-gradient(135deg,#ffd700,#ff8f00)'; border = '#ffd700'; color = '#fff'; }
  else if (card.isSpeto) { bg = '#1a1a2e'; border = '#ffd700'; color = '#ffd700'; }
  else if (card.suit === '♥' || card.suit === '♦') { bg = '#fff5f5'; border = '#ef9a9a'; color = '#c62828'; }
  else { bg = '#f5f5ff'; border = '#9fa8da'; color = '#1a237e'; }
  return '<div style="width:46px;height:64px;background:' + bg + ';border:1px solid ' + border + ';color:' + color + ';border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px">' +
    '<span style="font-size:0.7rem;font-weight:700">' + (card.isJoker ? 'J' : card.rank) + '</span>' +
    '<span style="font-size:1rem">' + (card.isJoker ? '★' : card.suit) + '</span></div>';
}

function renderMeldOptions() {
  try {
    var handCodes = currentGame && currentGame.hands ? (currentGame.hands[myPlayerId] || []) : [];
    var hand = codesToCards(handCodes);
    var melds = findMelds(hand);
    var container = document.getElementById('meld-section');
    if (melds.length === 0) {
      container.innerHTML = '<div style="color:#aaa;text-align:center;padding:20px">ไม่พบชุดไพ่ที่เกิดได้<br><small>ต้องมีไพ่ 3 ใบขึ้นไป</small></div>';
      return;
    }
    var html = '<div style="color:#aaa;font-size:0.9rem;margin-bottom:12px">เลือกชุดไพ่ที่จะเกิด:</div><div class="meld-sets">';
    for (var mi = 0; mi < melds.length; mi++) {
      var meld = melds[mi];
      var cardsHtml = '';
      for (var ci = 0; ci < meld.cards.length; ci++) cardsHtml += renderCardSmall(meld.cards[ci]);
      html += '<div class="meld-set" onclick="selectMeld(' + mi + ')">' + cardsHtml + '<div style="width:100%;font-size:0.7rem;color:#888;text-align:center;margin-top:4px">' + (meld.type === 'set' ? 'ตอง' : 'เรียง') + (meld.jokerUsed ? ' (ใช้โจ๊ก)' : '') + '</div></div>';
    }
    html += '</div>';
    container.innerHTML = html;
  } catch(e) { console.error('renderMeldOptions error:', e); }
}

function selectMeld(idx) {
  selectedMeldIndex = idx;
  try {
    var sets = document.querySelectorAll('.meld-set');
    for (var si = 0; si < sets.length; si++) {
      sets[si].style.borderColor = si === idx ? '#ffd700' : '#0f3460';
      sets[si].style.boxShadow = si === idx ? '0 0 12px rgba(255,215,0,0.5)' : 'none';
    }
    document.getElementById('btn-confirm-meld').disabled = false;
  } catch(e) {}
}

async function confirmMeld() {
  try {
    if (selectedMeldIndex === null) return;
    var handCodes = currentGame && currentGame.hands ? (currentGame.hands[myPlayerId] || []) : [];
    var hand = codesToCards(handCodes);
    var melds = findMelds(hand);
    var meld = melds[selectedMeldIndex];
    if (!meld) return;
    var meldedCodes = meld.cards.map(function(c) { return c.code; });
    var newHandCodes = handCodes.filter(function(c) { return meldedCodes.indexOf(c) === -1; });
    var allMelds = (currentGame.melds && currentGame.melds[myPlayerId] ? currentGame.melds[myPlayerId] : []).concat([meldedCodes]);
    var newMelds = Object.assign({}, currentGame.melds || {});
    newMelds[myPlayerId] = allMelds;
    var newHands = Object.assign({}, currentGame.hands);
    newHands[myPlayerId] = newHandCodes;
    currentGame = Object.assign({}, currentGame, { hands: newHands, melds: newMelds });
    await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
    notify('🃏 เกิด ' + (meld.type === 'set' ? 'ตอง' : 'เรียง') + 'สำเร็จ!');
    closeMeldModal();
    renderYourHand();
    renderScoreboard(currentGame);
  } catch(e) { console.error('confirmMeld error:', e); }
}

// --- RENDERING ---
async function renderLobby(players) {
  try {
    var list = document.getElementById('player-list');
    var btnStart = document.getElementById('btn-start');
    var arr = Object.values(players || {});
    var html = '';
    for (var ai = 0; ai < arr.length; ai++) {
      var p = arr[ai];
      var isYou = p.id === myPlayerId;
      html += '<div class="player-slot filled ' + (isYou ? 'you' : '') + ' ' + (p.isBot ? 'bot' : '') + '">' +
        '<div class="pemoji">' + (p.isBot ? '🤖' : '👤') + '</div>' +
        '<div class="pname">' + p.name + '</div>' +
        '<div class="ptype">' + (isYou ? '(คุณ)' : p.isBot ? 'AI' : 'ผู้เล่น') + '</div></div>';
    }
    for (var ei = arr.length; ei < 4; ei++) {
      html += '<div class="player-slot"><div class="pemoji">❓</div><div class="pname">รอผู้เล่น...</div><div class="ptype">เหลือ ' + (4 - ei) + ' คน</div></div>';
    }
    list.innerHTML = html;
    var humanCount = arr.filter(function(p) { return !p.isBot; }).length;
    btnStart.style.display = humanCount >= 1 ? 'block' : 'none';
    document.getElementById('lobby-status').style.display = 'none';
  } catch(e) { console.error('renderLobby error:', e); }
}

async function renderGame(game) {
  try {
    if (!game) return;
    turnPlayerId = game.turnPlayerId;
    myTurn = turnPlayerId === myPlayerId;
    document.getElementById('turn-indicator').textContent = myTurn ? '🎯 ตาของคุณ!' : '⏳ รอตาคนอื่น...';
    document.getElementById('round-info').textContent = 'รอบ: ' + (game.round || 1) + ' | ทิ้ง: ' + (game.discardPile ? game.discardPile.length : 0);
    document.getElementById('deck-count').textContent = (game.deck ? game.deck.length : 0) + ' ใบ';
    document.getElementById('your-name').textContent = myName;
    await renderOpponents(game);
    renderDiscardPile(game);
    renderYourHand();
    renderScoreboard(game);
    updateActionBtns();
  } catch(e) { console.error('renderGame error:', e); }
}

async function renderOpponents(game) {
  try {
    var container = document.getElementById('opponents-row');
    container.innerHTML = '';
    var _data = await db.from('rooms').select('players').eq('id', roomCode).single();
    var players = (_data.data && _data.data.players) || {};
    for (var oi = 0; oi < game.playerOrder.length; oi++) {
      var pid = game.playerOrder[oi];
      if (pid === myPlayerId) continue;
      var handSize = game.hands && game.hands[pid] ? game.hands[pid].length : 0;
      var isActive = game.turnPlayerId === pid;
      var p = players[pid] || {};
      container.innerHTML += '<div class="opponent-card ' + (isActive ? 'active-turn' : '') + '">' +
        '<div style="font-size:1.2rem">' + (p.isBot ? '🤖' : '👤') + '</div>' +
        '<div class="oname">' + (p.name || '??') + '</div>' +
        '<div class="ocard-count">' + handSize + ' ใบ</div></div>';
    }
  } catch(e) { console.error('renderOpponents error:', e); }
}

function renderDiscardPile(game) {
  try {
    var pile = document.getElementById('discard-pile');
    var discard = game.discardPile || [];
    if (discard.length === 0) { pile.innerHTML = ''; return; }
    var card = codeToCard(discard[discard.length - 1]);
    var bg, border, color;
    if (card && card.isJoker) { bg = 'linear-gradient(135deg,#ffd700,#ff8f00)'; border = '#ffd700'; color = '#fff'; }
    else if (card && (card.suit === '♥' || card.suit === '♦')) { bg = '#fff5f5'; border = '#ef9a9a'; color = '#c62828'; }
    else { bg = '#f5f5ff'; border = '#9fa8da'; color = '#1a237e'; }
    pile.innerHTML = '<div style="width:80px;height:112px;background:' + bg + ';border:2px solid ' + border + ';color:' + color + ';border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">' +
      '<span style="font-size:1.1rem;font-weight:700">' + (card && card.isJoker ? 'J' : (card ? card.rank : '?')) + '</span>' +
      '<span style="font-size:1.4rem">' + (card && card.isJoker ? '★' : (card ? card.suit : '?')) + '</span></div>';
  } catch(e) { console.error('renderDiscardPile error:', e); }
}

function renderYourHand() {
  try {
    var container = document.getElementById('your-hand');
    var handCodes = currentGame && currentGame.hands ? (currentGame.hands[myPlayerId] || []) : [];
    var hand = codesToCards(handCodes);
    var sorted = sortHand(hand);
    var html = '';
    for (var hi = 0; hi < sorted.length; hi++) html += renderCardEl(sorted[hi]);
    container.innerHTML = html;
  } catch(e) { console.error('renderYourHand error:', e); }
}

async function renderScoreboard(game) {
  try {
    var row = document.getElementById('score-row');
    var _data = await db.from('rooms').select('players').eq('id', roomCode).single();
    var players = (_data.data && _data.data.players) || {};
    var scores = game.scores || {};
    var melds = game.melds || {};
    var html = '';
    for (var si = 0; si < game.playerOrder.length; si++) {
      var pid = game.playerOrder[si];
      var p = players[pid] || {};
      var isYou = pid === myPlayerId;
      var pts = scores[pid] || 0;
      var meldCount = melds[pid] ? melds[pid].length : 0;
      html += '<div class="score-item ' + (isYou ? 'highlight' : '') + '">' +
        '<div class="sname">' + (p.name || '??') + '</div>' +
        '<div class="spoint" style="color:' + (isYou ? '#ffd700' : '#fff') + '">' + pts + '</div>' +
        '<div style="font-size:0.7rem;color:#888">เกิด ' + meldCount + '</div></div>';
    }
    row.innerHTML = html;
  } catch(e) { console.error('renderScoreboard error:', e); }
}

function updateActionBtns() {
  try {
    var btnDraw = document.getElementById('btn-draw');
    var btnMeld = document.getElementById('btn-meld');
    var btnDiscard = document.getElementById('btn-discard');
    var btnEnd = document.getElementById('btn-end');
    var handStatus = document.getElementById('hand-status');
    if (myTurn && currentGame) {
      var phase = currentGame.phase || 'draw';
      if (btnDraw) btnDraw.disabled = phase !== 'draw';
      if (btnMeld) btnMeld.disabled = false;
      if (btnDiscard) btnDiscard.disabled = selectedCards.length !== 1;
      if (btnEnd) btnEnd.disabled = phase === 'draw';
      if (handStatus) handStatus.textContent = phase === 'draw' ? '📦 จั่วหรือหยิบทิ้ง' : '🃏 เลือกไพ่ทิ้ง หรือเกิด';
    } else {
      [btnDraw, btnMeld, btnDiscard, btnEnd].forEach(function(b) { if (b) b.disabled = true; });
      if (handStatus) handStatus.textContent = '⏳ รอตาคนอื่น...';
    }
  } catch(e) {}
}

// --- END GAME ---
function showEndGame(data) {
  try {
    confetti();
    var winner = data.winner;
    var totalScores = data.totalScores || {};
    var roundScores = data.roundScores || {};
    var players = data.players || {};
    document.getElementById('winner-name').textContent = '🏆 ' + (players[winner] ? players[winner].name : '??') + ' ชนะ!';
    var table = document.getElementById('endgame-table');
    table.innerHTML = '<tr><th>ผู้เล่น</th><th>แต้มรอบ</th><th>รวม</th></tr>';
    for (var pid in totalScores) {
      var p = players[pid] || {};
      table.innerHTML += '<tr class="' + (pid === winner ? 'winner-row' : '') + '">' +
        '<td>' + (p.isBot ? '🤖' : '👤') + ' ' + (p.name || '??') + '</td>' +
        '<td>' + (roundScores[pid] || 0) + '</td><td>' + totalScores[pid] + '</td></tr>';
    }
    document.getElementById('endgame-modal').classList.add('active');
  } catch(e) { console.error('showEndGame error:', e); }
}

async function playAgain() {
  try {
    document.getElementById('endgame-modal').classList.remove('active');
    var _data = await db.from('rooms').select('players').eq('id', roomCode).single();
    if (!_data.data) return;
    var players = _data.data.players || {};
    var pids = Object.keys(players);
    if (pids.length < 2) return;
    var deck = shuffle(makeDeck());
    var hands = {};
    for (var pi = 0; pi < pids.length; pi++) {
      var h = [];
      for (var di = 0; di < 7; di++) h.push(deck.pop().code);
      hands[pids[pi]] = h;
    }
    var gameData = {
      deck: deck.map(function(c) { return c.code; }),
      hands: hands,
      discardPile: [deck.pop().code],
      turnPlayerId: pids[0],
      playerOrder: pids,
      phase: 'draw',
      status: 'playing',
      melds: {},
      scores: {},
      round: (currentGame ? (currentGame.round || 1) : 1) + 1,
      turnStartTime: Date.now()
    };
    for (var mi = 0; mi < pids.length; mi++) { gameData.melds[pids[mi]] = []; gameData.scores[pids[mi]] = 0; }
    await db.from('rooms').update({ status: 'playing', game: gameData }).eq('id', roomCode);
    currentGame = gameData;
    showScreen('game-screen');
    renderGame(gameData);
  } catch(e) { console.error('playAgain error:', e); }
}

function goHome() {
  try { document.getElementById('endgame-modal').classList.remove('active'); } catch(e) {}
  leaveRoom();
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', function() {
  var params = new URLSearchParams(window.location.search);
  if (params.has('room')) document.getElementById('join-code').value = params.get('room');
  console.log('[DummyRummy] Loaded! DB:', db ? 'OK' : 'NOT YET');
});

console.log('[DummyRummy] Script parsing OK!');
