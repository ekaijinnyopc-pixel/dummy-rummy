// ============================================================
// 🃏 DUMMY RUMMY — game-core.js v11
// Fix: bot freeze (remove double botPlay), add ฝาก layoff system
// ============================================================

const SUPABASE_URL = 'https://dbtlbeymrchodloboymr.supabase.co';
const SUPABASE_KEY = 'eyJhbG…LYbc';

var db;
function initDb() {
  try {
    if (typeof window.supabase !== 'undefined') {
      db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      console.log('[Supabase] Connected!');
    } else {
      console.error('[Supabase] CDN not loaded!');
    }
  } catch(e) { console.error('[Supabase] Init error:', e); }
}
(function() {
  var script = document.createElement('script');
  script.src = 'supabase.js?v=1';
  script.onload = initDb;
  script.onerror = function() { console.error('[Supabase] Local file failed!'); };
  document.head.appendChild(script);
})();

// --- CONSTANTS ---
var SUITS = ['♠','♥','♦','♣'];
var RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
var RANK_ORDER = {'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13};
var RANK_ORDER_AHIGH = {'A':14,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13};

// --- DECK ---
function makeDeck() {
  var deck = [];
  for (var si = 0; si < SUITS.length; si++)
    for (var ri = 0; ri < RANKS.length; ri++)
      deck.push({ suit: SUITS[si], rank: RANKS[ri], code: RANKS[ri] + SUITS[si] });
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

// --- CARD UTILS ---
function isSpeto(card) { return card && (card.code === '2♣' || card.code === 'Q♠'); }
function cardPoints(card) {
  if (!card) return 0;
  if (isSpeto(card)) return 50;
  if (card.rank === 'A') return 15;
  if (['J','Q','K','10'].indexOf(card.rank) >= 0) return 10;
  return 5;
}
function handCardClass(card) {
  if (!card) return 'black';
  if (isSpeto(card)) return 'speto';
  if (card.suit === '♥' || card.suit === '♦') return 'red';
  return 'black';
}
function sortHand(hand) {
  return hand.slice().sort(function(a, b) {
    if (isSpeto(a) && !isSpeto(b)) return 1;
    if (!isSpeto(a) && isSpeto(b)) return -1;
    var s1 = {'♠':0,'♥':1,'♦':2,'♣':3}[a.suit] ?? 4;
    var s2 = {'♠':0,'♥':1,'♦':2,'♣':3}[b.suit] ?? 4;
    if (s1 !== s2) return s1 - s2;
    return (RANK_ORDER[a.rank]||14) - (RANK_ORDER[b.rank]||14);
  });
}
function codeToCard(code) {
  if (!code) return null;
  if (typeof code === 'object') return code;
  if (code === '2♣') return { suit:'♣', rank:'2', code:'2♣' };
  if (code === 'Q♠') return { suit:'♠', rank:'Q', code:'Q♠' };
  for (var si = 0; si < SUITS.length; si++) {
    var s = SUITS[si];
    if (code.endsWith(s)) return { suit:s, rank:code.substring(0,code.length-1), code:code };
  }
  return null;
}
function codesToCards(codes) {
  if (!codes) return [];
  var result = [];
  for (var i = 0; i < codes.length; i++) { var c = codeToCard(codes[i]); if (c) result.push(c); }
  return result;
}

// --- MELD FINDING ---
function findMelds(hand) {
  var melds = [];
  var normals = hand.filter(function(c){ return !isSpeto(c); });

  // SETS (ตอง)
  var byRank = {};
  for (var ni = 0; ni < normals.length; ni++) {
    if (!byRank[normals[ni].rank]) byRank[normals[ni].rank] = [];
    byRank[normals[ni].rank].push(normals[ni]);
  }
  for (var r in byRank) {
    if (byRank[r].length >= 3) melds.push({ type:'set', cards: byRank[r].slice() });
  }

  // RUNS — A can be low (A-2-3) OR high (Q-K-A). K-A-2 = INVALID.
  var bySuit = {};
  for (var si = 0; si < normals.length; si++) {
    if (!bySuit[normals[si].suit]) bySuit[normals[si].suit] = [];
    bySuit[normals[si].suit].push(normals[si]);
  }

  for (var suit in bySuit) {
    var sc = bySuit[suit].slice().sort(function(a,b){
      return (RANK_ORDER[a.rank]||14) - (RANK_ORDER[b.rank]||14);
    });

    // Runs WITHOUT Aces
    var aces = sc.filter(function(c){ return c.rank === 'A'; });
    var nonAces = sc.filter(function(c){ return c.rank !== 'A'; });
    var run = [];
    for (var i = 0; i < nonAces.length; i++) {
      var cur = RANK_ORDER[nonAces[i].rank] || 14;
      var prev = run.length > 0 ? RANK_ORDER[run[run.length-1].rank] : null;
      if (prev !== null && cur === prev + 1) { run.push(nonAces[i]); }
      else {
        if (run.length >= 3) melds.push({ type:'run', cards: run.slice(), suit:suit });
        run = [nonAces[i]];
      }
    }
    if (run.length >= 3) melds.push({ type:'run', cards: run.slice(), suit:suit });

    // A as LOW: A-2-3...
    if (aces.length > 0 && nonAces.length >= 2) {
      var sortedNon = nonAces.slice().sort(function(a,b){ return (RANK_ORDER[a.rank]||14) - (RANK_ORDER[b.rank]||14); });
      if (RANK_ORDER[sortedNon[0].rank] === 2) {
        var lowRun = [aces[0], sortedNon[0]];
        for (var j = 1; j < sortedNon.length; j++) {
          var curr = RANK_ORDER[sortedNon[j].rank] || 14;
          var prevR = RANK_ORDER[lowRun[lowRun.length-1].rank] || 14;
          if (curr === prevR + 1) lowRun.push(sortedNon[j]); else break;
        }
        if (lowRun.length >= 3) melds.push({ type:'run', cards: lowRun.slice(), suit:suit });
      }
    }

    // A as HIGH: Q-K-A
    if (aces.length > 0 && nonAces.length >= 2) {
      var hiCards = nonAces.filter(function(c){ var rv = RANK_ORDER[c.rank]||14; return rv >= 11; }); // J,Q,K
      if (hiCards.length >= 2) {
        hiCards.sort(function(a,b){ return (RANK_ORDER[a.rank]||14) - (RANK_ORDER[b.rank]||14); });
        var lastRank = RANK_ORDER[hiCards[hiCards.length-1].rank] || 14;
        if (lastRank === 12 || lastRank === 13) { // ends in Q or K
          var highRun = hiCards.concat(aces);
          // Verify consecutive
          var allSorted = highRun.slice().sort(function(a,b){
            return (RANK_ORDER[b.rank]||14) - (RANK_ORDER[a.rank]||14);
          });
          var valid = true;
          for (var m = 1; m < allSorted.length; m++) {
            if ((RANK_ORDER[allSorted[m-1].rank]||14) - (RANK_ORDER[allSorted[m].rank]||14) !== 1) { valid = false; break; }
          }
          var hasTwo = highRun.some(function(c){ return c.rank === '2'; });
          if (valid && !hasTwo && highRun.length >= 3) melds.push({ type:'run', cards: highRun.slice(), suit:suit });
        }
      }
    }
  }
  return melds;
}

// Check if picked cards can form a valid meld using at least one picked card
function canMeldWithPicked(pickedCodes, handCodes) {
  var allCards = codesToCards(handCodes.concat(pickedCodes));
  var melds = findMelds(allCards);
  for (var i = 0; i < melds.length; i++) {
    var meldCodes = melds[i].cards.map(function(c){ return c.code; });
    var usesPicked = pickedCodes.some(function(pc){ return meldCodes.indexOf(pc) >= 0; });
    if (usesPicked) return melds[i];
  }
  return null;
}

function detectMeldType(codes) {
  if (!codes || codes.length < 3) return 'ไพ่';
  var cards = codesToCards(codes);
  if (cards.length === 0) return 'ไพ่';
  var ranks = cards.map(function(c){ return c.rank; });
  if (new Set(ranks).size === 1) return 'ตอง';
  var bySuit = {};
  for (var i = 0; i < cards.length; i++) {
    if (!bySuit[cards[i].suit]) bySuit[cards[i].suit] = [];
    bySuit[cards[i].suit].push(cards[i]);
  }
  for (var s in bySuit) {
    var sc = bySuit[s].sort(function(a,b){ return (RANK_ORDER[a.rank]||14) - (RANK_ORDER[b.rank]||14); });
    if (sc.length >= 3) {
      var ok = true;
      for (var j = 1; j < sc.length; j++) {
        if ((RANK_ORDER[sc[j].rank]||14) - (RANK_ORDER[sc[j-1].rank]||14) !== 1) { ok = false; break; }
      }
      if (ok) return 'เรียง';
    }
  }
  return 'ไพ่';
}

// Find all valid layoff targets for player's hand against ALL melds on table
// Returns array of { layoffCard, targetMeld, targetPid }
function findAllLayoffs(handCodes, game) {
  var results = [];
  var handCards = codesToCards(handCodes);
  for (var pid in (game.melds || {})) {
    var melds = game.melds[pid] || [];
    for (var mi = 0; mi < melds.length; mi++) {
      var meldCodes = melds[mi];
      var meldCards = codesToCards(meldCodes);
      var meldType = detectMeldType(meldCodes);
      if (meldType !== 'เรียง' && meldType !== 'ตอง') continue;

      for (var hi = 0; hi < handCards.length; hi++) {
        var hCard = handCards[hi];
        if (isSpeto(hCard)) continue; // speto can't be laid off

        if (meldType === 'set') {
          // Same rank as existing set
          if (hCard.rank === meldCards[0].rank && hCard.suit !== meldCards[0].suit) {
            // Check not already in meld
            var alreadyIn = meldCodes.some(function(c){ return codeToCard(c).suit === hCard.suit; });
            if (!alreadyIn) results.push({ layoffCard: hCard.code, targetMeld: meldCodes, targetPid: pid, meldType: meldType });
          }
        } else if (meldType === 'run') {
          // Check if hCard can extend the run (low or high)
          var suit = meldCards[0].suit;
          if (hCard.suit !== suit) continue;
          var ranks = meldCodes.map(function(c){ return RANK_ORDER[codeToCard(c).rank]||14; });
          var minR = Math.min.apply(null, ranks);
          var maxR = Math.max.apply(null, ranks);
          var hR = RANK_ORDER[hCard.rank] || 14;

          // Check if hCard is exactly one below min or one above max
          if (hR === minR - 1 || hR === maxR + 1) {
            // For A-high runs, make sure it's valid
            if (hR === 1 && maxR === 14) continue; // A already high, can't go lower
            if (hR === 14 && minR === 1) continue; // A already low, can't go higher
            results.push({ layoffCard: hCard.code, targetMeld: meldCodes, targetPid: pid, meldType: meldType });
          }
        }
      }
    }
  }
  return results;
}

// --- GAME STATE ---
var myPlayerId = null;
var myName = '';
var roomCode = null;
var realtimeChannel = null;
var currentGame = null;
var selectedCards = [];
var myTurn = false;
var pendingPickedCodes = [];   // codes picked from discard this turn (must meld)
var layoffTargets = [];        // valid layoff options found for current hand
var pollInterval = null;
var botRunning = {};           // prevent double-bot: pid -> true while bot is playing

// --- UTILS ---
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
    var t = document.getElementById(id);
    if (t) t.classList.add('active');
  } catch(e) { console.error('showScreen error:', e); }
}
function delay(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

// --- SUPABASE ---
async function setupRealtime(rid) {
  try {
    if (realtimeChannel) { realtimeChannel.unsubscribe(); realtimeChannel = null; }
    stopPolling();
    realtimeChannel = db.channel('room-' + rid);
    realtimeChannel.on('postgres_changes', { event:'*', schema:'public', table:'rooms', filter:'id=eq.'+rid }, function(payload) {
      try {
        var room = payload.new;
        if (!room) return;
        if (room.status === 'lobby') renderLobby(room.players || {});
        else if (room.status === 'playing' && room.game) {
          currentGame = room.game;
          showScreen('game-screen');
          renderGame(room.game);
          // Trigger bot from realtime callback ONLY (not from advanceTurn)
          if (currentGame.status === 'playing' && currentGame.turnPlayerId.indexOf('bot_') === 0) {
            var pid = currentGame.turnPlayerId;
            if (!botRunning[pid]) {
              botRunning[pid] = true;
              setTimeout(function() {
                botPlay(pid);
              }, 800);
            }
          }
        } else if (room.status === 'ended') {
          showEndGame({ winner: room.winner, totalScores: room.totalScores, players: room.players });
        }
      } catch(e) { console.error('realtime callback error:', e); }
    });
    await realtimeChannel.subscribe();
    startPolling(rid);
  } catch(e) { console.error('[Realtime] Setup error:', e); notify('❌ เชื่อม realtime ไม่ได้'); }
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
    for (var i = 0; i < botCount; i++) players['bot_' + i] = { id:'bot_'+i, name:botNames[i], isBot:true, isHost:false };
    var _data = await db.from('rooms').upsert({ id: roomCode, code: roomCode, players: players, status: 'lobby' });
    if (_data.error) { notify('❌ สร้างห้องไม่สำเร็จ'); return; }
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
    stopPolling();
    roomCode = null; myPlayerId = null; currentGame = null; selectedCards = []; pendingPickedCodes = []; layoffTargets = [];
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
    var firstCard = deck.pop();
    var hp = 50;
    if (firstCard.code === '2♣' || firstCard.code === 'Q♠') hp = 100;
    var gameData = {
      deck: deck.map(function(c){ return c.code; }),
      hands: hands,
      discardPile: [firstCard.code],
      turnPlayerId: playerIds[0],
      playerOrder: playerIds,
      phase: 'draw',
      status: 'playing',
      melds: {},
      scores: {},
      round: 1,
      turnStartTime: Date.now(),
      headCard: firstCard.code,
      headPoints: hp,
      hasFirstMeld: {},
      lastDiscard: null,
      deckEmpty: false,
      pickedFromDiscard: {}
    };
    for (var mi = 0; mi < playerIds.length; mi++) {
      gameData.melds[playerIds[mi]] = [];
      gameData.scores[playerIds[mi]] = 0;
      gameData.hasFirstMeld[playerIds[mi]] = false;
    }
    await db.from('rooms').update({ status: 'playing', game: gameData }).eq('id', roomCode);
    currentGame = gameData;
    showScreen('game-screen');
    renderGame(gameData);
    setTimeout(function() {
      if (currentGame && currentGame.status === 'playing' && currentGame.turnPlayerId.indexOf('bot_') === 0) {
        var pid = currentGame.turnPlayerId;
        if (!botRunning[pid]) {
          botRunning[pid] = true;
          setTimeout(function(){ botPlay(pid); }, 800);
        }
      }
    }, 1200);
  } catch(e) { console.error('startGame error:', e); notify('❌ ผิดพลาด: ' + e.message); }
}

// --- GAME ACTIONS ---
async function drawCard() {
  try {
    if (!currentGame || !myTurn || currentGame.phase !== 'draw') return;
    var deck = currentGame.deck.slice();
    if (deck.length === 0) {
      currentGame = Object.assign({}, currentGame, { phase: 'action', deckEmpty: true, turnStartTime: Date.now() });
      await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
      renderGame(currentGame);
      notify('📦 กองจั่วหมดแล้ว! ทิ้งไพ่ได้เลย');
      return;
    }
    var drawnCode = deck.pop();
    var drawnCard = codeToCard(drawnCode);
    var newHands = Object.assign({}, currentGame.hands);
    newHands[myPlayerId] = (newHands[myPlayerId] || []).concat([drawnCode]);
    pendingPickedCodes = [];
    currentGame = Object.assign({}, currentGame, { deck: deck, hands: newHands, phase: 'action', turnStartTime: Date.now() });
    await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
    renderYourHand();
    updateLayoffTargets();
    updateActionBtns();
    notify('📦 จั่วได้: ' + (drawnCard ? drawnCard.rank + drawnCard.suit : drawnCode));
  } catch(e) { console.error('drawCard error:', e); }
}

async function pickFromDiscard(idx) {
  try {
    if (!currentGame || !myTurn) return;
    if (currentGame.phase !== 'draw') { notify('ต้องจั่วหรือหยิบจากกองทิ้งก่อน!'); return; }
    var discard = currentGame.discardPile.slice();
    if (discard.length === 0 || idx < 0 || idx >= discard.length) return;

    var taken = discard.slice(idx);       // [card_i ... card_last]
    var remaining = discard.slice(0, idx);  // [card_0 ... card_i-1]
    var handCodes = currentGame.hands[myPlayerId] || [];
    var meldable = canMeldWithPicked(taken, handCodes);

    if (!meldable) {
      notify('❌ หยิบใบนี้ต้องเกิดได้ทันที! ลองใบอื่น');
      return;
    }

    // Track ทิ้งมี่: whoever discarded the card we're picking
    var discardOwner = currentGame.lastDiscard ? currentGame.lastDiscard.playerId : null;

    pendingPickedCodes = taken;
    var newHands = Object.assign({}, currentGame.hands);
    newHands[myPlayerId] = handCodes.concat(taken);
    var newPicked = Object.assign({}, currentGame.pickedFromDiscard || {});
    newPicked[myPlayerId] = taken;

    // Apply ทิ้งมี่ penalty
    if (discardOwner && discardOwner !== myPlayerId) {
      var scores = Object.assign({}, currentGame.scores || {});
      scores[discardOwner] = (scores[discardOwner] || 0) - 100;
      currentGame = Object.assign(currentGame, { scores: scores });
    }

    currentGame = Object.assign({}, currentGame, {
      hands: newHands,
      discardPile: remaining,
      phase: 'action',
      turnStartTime: Date.now(),
      pickedFromDiscard: newPicked,
      lastDiscard: null
    });
    await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
    renderYourHand();
    // Open meld modal — player MUST meld with picked cards
    openMeldModal(taken);
    notify('🗑️ หยิบได้แล้ว! ต้องเกิดใบที่หยิบทันที');
  } catch(e) { console.error('pickFromDiscard error:', e); }
}

async function discardSelected() {
  try {
    if (!currentGame || !myTurn) return;
    if (currentGame.phase === 'action' && pendingPickedCodes.length > 0) {
      notify('❌ ต้องเกิดใบที่หยิบจากกองทิ้งก่อนทิ้ง!'); return;
    }
    if (selectedCards.length !== 1) { notify('เลือกไพ่ 1 ใบที่จะทิ้ง'); return; }
    var cardCode = selectedCards[0];
    var handCodes = currentGame.hands[myPlayerId] || [];
    if (handCodes.indexOf(cardCode) === -1) { notify('❌ ไม่สามารถทิ้งไพ่ที่หยิบจากกองทิ้งมาได้'); return; }

    var card = codeToCard(cardCode);
    var newHand = handCodes.filter(function(c){ return c !== cardCode; });
    selectedCards = [];
    pendingPickedCodes = [];

    // Speto discard penalty
    if (isSpeto(card)) {
      var scores = Object.assign({}, currentGame.scores || {});
      scores[myPlayerId] = (scores[myPlayerId] || 0) - 100;
      currentGame = Object.assign(currentGame, { scores: scores });
    }

    if (newHand.length === 0) {
      await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
      await handleKnockout(myPlayerId);
      return;
    }

    var newDiscard = currentGame.discardPile.concat([cardCode]);
    var newHands = Object.assign({}, currentGame.hands);
    newHands[myPlayerId] = newHand;
    var newLastDiscard = { playerId: myPlayerId, cardCode: cardCode };

    currentGame = Object.assign({}, currentGame, {
      hands: newHands,
      discardPile: newDiscard,
      phase: 'draw',
      turnStartTime: Date.now(),
      lastDiscard: newLastDiscard
    });
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
    // DON'T call botPlay here — let realtime callback handle it to avoid double-trigger
    currentGame = Object.assign({}, currentGame, { turnPlayerId: nextPid, phase: 'draw', turnStartTime: Date.now() });
    await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
    renderGame(currentGame);
    // Bot will be triggered by realtime callback
  } catch(e) { console.error('advanceTurn error:', e); }
}

async function endTurn() {
  try {
    if (!currentGame || !myTurn) return;
    if (currentGame.phase === 'draw') { notify('ต้องจั่วหรือหยิบจากกองทิ้งก่อน!'); return; }
    if (pendingPickedCodes.length > 0) { notify('❌ ต้องเกิดใบที่หยิบจากกองทิ้งก่อน!'); return; }
    await advanceTurn();
  } catch(e) { console.error('endTurn error:', e); }
}

async function handleKnockout(koId) {
  try {
    var _data = await db.from('rooms').select('*').eq('id', roomCode).single();
    if (!_data.data) return;
    var players = _data.data.players || {};
    var game = currentGame;

    var roundScores = {};
    for (var pid in game.hands) {
      var meldPts = 0;
      var melds = game.melds && game.melds[pid] ? game.melds[pid] : [];
      for (var mi = 0; mi < melds.length; mi++) {
        var meldCodes = melds[mi];
        for (var ci = 0; ci < meldCodes.length; ci++) { var c = codeToCard(meldCodes[ci]); if (c) meldPts += cardPoints(c); }
      }
      var handPts = 0;
      var handCodes = game.hands[pid] || [];
      for (var ci2 = 0; ci2 < handCodes.length; ci2++) { var c2 = codeToCard(handCodes[ci2]); if (c2) handPts += cardPoints(c2); }
      if (pid === koId) handPts = 0;
      var hasMeld = game.hasFirstMeld && game.hasFirstMeld[pid];
      if (!hasMeld && pid !== koId) handPts = handPts * 2;
      roundScores[pid] = meldPts - handPts;
    }

    var hasMeldBeforeKnock = game.hasFirstMeld && game.hasFirstMeld[koId];
    var knockBonus = hasMeldBeforeKnock ? 50 : 100;
    roundScores[koId] += knockBonus;
    if (game.headPoints) roundScores[koId] += game.headPoints;

    var prevScores = (_data.data.game && _data.data.game.scores) || {};
    var totalScores = {};
    for (var ti = 0; ti < game.playerOrder.length; ti++) {
      var tpid = game.playerOrder[ti];
      totalScores[tpid] = (prevScores[tpid] || 0) + roundScores[tpid];
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
    showEndGame({ winner: winner, totalScores: totalScores, roundScores: roundScores, players: players, knockBonus: knockBonus });
  } catch(e) { console.error('handleKnockout error:', e); }
}

// --- BOT ---
async function botPlay(botId) {
  try {
    console.log('[Bot] botPlay START', botId);
    if (!currentGame || currentGame.status !== 'playing') { botRunning[botId] = false; return; }
    if (currentGame.turnPlayerId !== botId) { botRunning[botId] = false; return; }

    await delay(700);
    // Re-read current game state before acting
    var _data = await db.from('rooms').select('game').eq('id', roomCode).single();
    if (_data.data && _data.data.game) currentGame = _data.data.game;
    if (!currentGame || currentGame.turnPlayerId !== botId) { botRunning[botId] = false; return; }

    var handCodes = currentGame.hands[botId] || [];
    var hand = codesToCards(handCodes);
    var pickedThisTurn = false;

    // --- DRAW PHASE: try pick from discard ---
    if (currentGame.discardPile && currentGame.discardPile.length > 0) {
      var discard = currentGame.discardPile;
      for (var di = discard.length - 1; di >= 0; di--) {
        var taken = discard.slice(di);
        var meldable = canMeldWithPicked(taken, handCodes);
        if (meldable) {
          var remaining = discard.slice(0, di);
          var newHandCodes = handCodes.concat(taken);
          var newPicked = Object.assign({}, currentGame.pickedFromDiscard || {});
          newPicked[botId] = taken;

          // ทิ้งมี่ penalty
          var discardOwner = currentGame.lastDiscard ? currentGame.lastDiscard.playerId : null;
          if (discardOwner && discardOwner !== botId) {
            var sc = Object.assign({}, currentGame.scores || {});
            sc[discardOwner] = (sc[discardOwner] || 0) - 100;
            currentGame = Object.assign(currentGame, { scores: sc });
          }

          currentGame = Object.assign(currentGame, {
            hands: Object.assign({}, currentGame.hands, { [botId]: newHandCodes }),
            discardPile: remaining,
            phase: 'action',
            turnStartTime: Date.now(),
            pickedFromDiscard: newPicked,
            lastDiscard: null
          });
          await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
          hand = codesToCards(newHandCodes);
          handCodes = newHandCodes;
          pickedThisTurn = true;

          // Bot must meld picked cards immediately
          var hasFirstMeld = currentGame.hasFirstMeld && currentGame.hasFirstMeld[botId];
          if (!hasFirstMeld) {
            var botMelds = findMelds(hand);
            var validBotMelds = botMelds.filter(function(m) {
              return m.cards.some(function(c){ return taken.indexOf(c.code) >= 0; });
            });
            if (validBotMelds.length > 0) {
              var bm = validBotMelds[0];
              var bmCodes = bm.cards.map(function(c){ return c.code; });
              var newBotHand = hand.filter(function(c){ return bmCodes.indexOf(c.code) === -1; });
              var botMeldList = Object.assign({}, currentGame.melds || {});
              botMeldList[botId] = (botMeldList[botId] || []).concat([bmCodes]);
              var newBotHasMeld = Object.assign({}, currentGame.hasFirstMeld || {});
              newBotHasMeld[botId] = true;
              var newP2 = Object.assign({}, currentGame.pickedFromDiscard || {});
              delete newP2[botId];
              currentGame = Object.assign(currentGame, {
                hands: Object.assign({}, currentGame.hands, { [botId]: newBotHand.map(function(c){ return c.code; }) }),
                melds: botMeldList,
                hasFirstMeld: newBotHasMeld,
                pickedFromDiscard: newP2
              });
              await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
              hand = newBotHand;
              handCodes = newBotHand.map(function(c){ return c.code; });
            }
          }
          break;
        }
      }
    }

    // --- DRAW: if didn't pick, draw from deck ---
    if (!pickedThisTurn && currentGame.deck.length > 0) {
      var deck2 = currentGame.deck.slice();
      var drawn = deck2.pop();
      hand = sortHand(hand.concat([codeToCard(drawn)]));
      handCodes = hand.map(function(c){ return c.code; });
      currentGame = Object.assign(currentGame, {
        deck: deck2,
        hands: Object.assign({}, currentGame.hands, { [botId]: handCodes }),
        phase: 'action',
        turnStartTime: Date.now()
      });
      await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
      await delay(400);
    } else if (!pickedThisTurn && currentGame.deck.length === 0) {
      currentGame = Object.assign(currentGame, { phase: 'action', deckEmpty: true });
      await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
    }

    // --- ACTION PHASE: meld (first meld) ---
    var hasFirstMeld2 = currentGame.hasFirstMeld && currentGame.hasFirstMeld[botId];
    if (!hasFirstMeld2) {
      var validM = findMelds(hand);
      if (validM.length > 0) {
        var m0 = validM[0];
        var m0Codes = m0.cards.map(function(c){ return c.code; });
        var newH = hand.filter(function(c){ return m0Codes.indexOf(c.code) === -1; });
        currentGame = Object.assign(currentGame, {
          melds: Object.assign({}, currentGame.melds || {}, { [botId]: (currentGame.melds[botId]||[]).concat([m0Codes]) }),
          hasFirstMeld: Object.assign({}, currentGame.hasFirstMeld || {}, { [botId]: true }),
          hands: Object.assign({}, currentGame.hands, { [botId]: newH.map(function(c){ return c.code; }) })
        });
        await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
        hand = newH;
        handCodes = newH.map(function(c){ return c.code; });
        await delay(400);
      }
    } else {
      // --- LAYOFF (ฝาก) ---
      var layoffs = findAllLayoffs(handCodes, currentGame);
      if (layoffs.length > 0) {
        // Lay off the first valid option
        var lo = layoffs[0];
        var loCard = codeToCard(lo.layoffCard);
        var newLH = hand.filter(function(c){ return c.code !== lo.layoffCard; });
        var targetMeld = currentGame.melds[lo.targetPid] || [];
        var meldIdx = -1;
        for (var mi = 0; mi < targetMeld.length; mi++) {
          if (JSON.stringify(targetMeld[mi]) === JSON.stringify(lo.targetMeld)) { meldIdx = mi; break; }
        }
        var newTargetMeld = targetMeld.slice();
        if (meldIdx >= 0) newTargetMeld[meldIdx] = targetMeld[meldIdx].concat([lo.layoffCard]);
        var newMelds = Object.assign({}, currentGame.melds || {});
        newMelds[lo.targetPid] = newTargetMeld;
        currentGame = Object.assign(currentGame, {
          melds: newMelds,
          hands: Object.assign({}, currentGame.hands, { [botId]: newLH.map(function(c){ return c.code; }) })
        });
        await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
        hand = newLH;
        handCodes = newLH.map(function(c){ return c.code; });
        await delay(400);
      }
    }

    // --- DISCARD ---
    if (hand.length > 0) {
      var pickedCodes = (currentGame.pickedFromDiscard && currentGame.pickedFromDiscard[botId]) || [];
      var canD = hand.filter(function(c){ return pickedCodes.indexOf(c.code) === -1; });
      if (canD.length === 0) canD = hand;
      var spetoD = canD.filter(function(c){ return isSpeto(c); });
      var discardCard = spetoD.length > 0 ? spetoD[0] : canD[canD.length - 1];
      var newH3 = hand.filter(function(c){ return c.code !== discardCard.code; });
      var newP3 = Object.assign({}, currentGame.pickedFromDiscard || {});
      delete newP3[botId];
      var newLastD = { playerId: botId, cardCode: discardCard.code };

      if (newH3.length === 0) {
        await db.from('rooms').update({
          game: Object.assign({}, currentGame, {
            hands: Object.assign({}, currentGame.hands, { [botId]: [] }),
            discardPile: currentGame.discardPile.concat([discardCard.code]),
            pickedFromDiscard: newP3,
            lastDiscard: newLastD
          })
        }).eq('id', roomCode);
        botRunning[botId] = false;
        await handleKnockout(botId);
        return;
      }

      currentGame = Object.assign(currentGame, {
        hands: Object.assign({}, currentGame.hands, { [botId]: newH3.map(function(c){ return c.code; }) }),
        discardPile: currentGame.discardPile.concat([discardCard.code]),
        phase: 'draw',
        turnStartTime: Date.now(),
        pickedFromDiscard: newP3,
        lastDiscard: newLastD
      });
      await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
      await delay(300);
    }

    botRunning[botId] = false;
    await advanceTurn();
  } catch(e) {
    console.error('botPlay error:', e);
    botRunning[botId] = false;
  }
}

// --- MELD MODAL ---
function openMeldModal(pickedCodes) {
  selectedMeldIndex = null;
  window._selectedMeld = null;
  try {
    document.getElementById('meld-modal').classList.add('active');
    renderMeldOptions(pickedCodes || []);
    document.getElementById('btn-confirm-meld').disabled = true;
  } catch(e) { console.error('openMeldModal error:', e); }
}

function closeMeldModal() {
  try { document.getElementById('meld-modal').classList.remove('active'); } catch(e) {}
}

function renderMeldOptions(pickedCodes) {
  try {
    var handCodes = currentGame && currentGame.hands ? (currentGame.hands[myPlayerId] || []) : [];
    var hand = codesToCards(handCodes);
    var melds = findMelds(hand);
    if (pickedCodes && pickedCodes.length > 0) {
      melds = melds.filter(function(m){ return m.cards.some(function(c){ return pickedCodes.indexOf(c.code) >= 0; }); });
    }
    var container = document.getElementById('meld-section');
    if (!container) return;
    if (melds.length === 0) {
      container.innerHTML = '<div style="color:#aaa;text-align:center;padding:20px">ไม่พบชุดไพ่ที่เกิดได้<br><small>ต้องมีไพ่ 3 ใบขึ้นไป</small></div>' +
        ((pickedCodes && pickedCodes.length > 0) ? '<div style="color:#e94560;text-align:center;padding:10px">⚠️ ต้องเกิดใบที่หยิบ!</div>' : '');
      return;
    }
    var html = '<div style="color:#aaa;font-size:0.9rem;margin-bottom:12px;text-align:center">เลือกชุดไพ่ที่จะเกิด:</div><div class="meld-sets">';
    for (var mi = 0; mi < melds.length; mi++) {
      var meld = melds[mi];
      var cardsHtml = '';
      for (var ci = 0; ci < meld.cards.length; ci++) {
        var c = meld.cards[ci];
        var highlighted = pickedCodes && pickedCodes.indexOf(c.code) >= 0;
        cardsHtml += '<div class="ms-card ' + handCardClass(c) + '" style="' + (highlighted ? 'border:2px solid #ffd700;box-shadow:0 0 8px rgba(255,215,0,0.6)' : '') + '">' + c.rank + '<br>' + c.suit + '</div>';
      }
      html += '<div class="meld-set" onclick="selectMeld(' + mi + ', ' + JSON.stringify(pickedCodes||[]).replace(/"/g,'&quot;') + ')">' + cardsHtml + '<div style="width:100%;font-size:0.7rem;color:#888;text-align:center;margin-top:4px">' + (meld.type==='set'?'ตอง':'เรียง') + '</div></div>';
    }
    html += '</div>';
    if (pickedCodes && pickedCodes.length > 0) html += '<div style="color:#ffd700;font-size:0.85rem;text-align:center;margin-top:10px">✨ ต้องเลือกชุดที่ใช้ใบที่หยิบ</div>';
    container.innerHTML = html;
  } catch(e) { console.error('renderMeldOptions error:', e); }
}

function selectMeld(idx, pickedCodes) {
  var handCodes = currentGame && currentGame.hands ? (currentGame.hands[myPlayerId] || []) : [];
  var hand = codesToCards(handCodes);
  var melds = findMelds(hand);
  if (pickedCodes && pickedCodes.length > 0) melds = melds.filter(function(m){ return m.cards.some(function(c){ return pickedCodes.indexOf(c.code) >= 0; }); });
  var meld = melds[idx];
  if (!meld) return;
  if (pickedCodes && pickedCodes.length > 0) {
    var usesPicked = meld.cards.some(function(c){ return pickedCodes.indexOf(c.code) >= 0; });
    if (!usesPicked) { notify('❌ ต้องใช้ใบที่หยิบจากกองทิ้ง!'); return; }
  }
  try {
    var sets = document.querySelectorAll('.meld-set');
    for (var si = 0; si < sets.length; si++) {
      sets[si].style.borderColor = si === idx ? '#ffd700' : '#0f3460';
      sets[si].style.boxShadow = si === idx ? '0 0 12px rgba(255,215,0,0.5)' : 'none';
    }
    document.getElementById('btn-confirm-meld').disabled = false;
    window._selectedMeld = meld;
  } catch(e) {}
}

async function confirmMeld() {
  try {
    var meld = window._selectedMeld;
    if (!meld) return;
    var handCodes = currentGame && currentGame.hands ? (currentGame.hands[myPlayerId] || []) : [];
    var meldedCodes = meld.cards.map(function(c){ return c.code; });
    var newHandCodes = handCodes.filter(function(c){ return meldedCodes.indexOf(c) === -1; });
    var allMelds = (currentGame.melds && currentGame.melds[myPlayerId] ? currentGame.melds[myPlayerId] : []).concat([meldedCodes]);
    var newMelds = Object.assign({}, currentGame.melds || {});
    newMelds[myPlayerId] = allMelds;
    var newHasFirstMeld = Object.assign({}, currentGame.hasFirstMeld || {});
    var isFirstMeld = !newHasFirstMeld[myPlayerId];
    if (isFirstMeld) newHasFirstMeld[myPlayerId] = true;
    var newPicked = Object.assign({}, currentGame.pickedFromDiscard || {});
    delete newPicked[myPlayerId];
    pendingPickedCodes = [];

    currentGame = Object.assign(currentGame, {
      hands: Object.assign({}, currentGame.hands, { [myPlayerId]: newHandCodes }),
      melds: newMelds,
      hasFirstMeld: newHasFirstMeld,
      pickedFromDiscard: newPicked
    });
    await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
    closeMeldModal();
    notify(isFirstMeld ? '🎉 เกิดสำเร็จ! ต่อไปสามารถฝากไพ่ได้!' : '🃏 เกิดสำเร็จ!');
    renderYourHand();
    renderPlayerMeldRow();
    renderScoreboard(currentGame);
    updateLayoffTargets();
    updateActionBtns();
  } catch(e) { console.error('confirmMeld error:', e); }
}

// --- LAYOFF (ฝาก) ---
function updateLayoffTargets() {
  if (!currentGame || !myTurn) { layoffTargets = []; return; }
  var handCodes = currentGame.hands[myPlayerId] || [];
  var hasMeld = currentGame.hasFirstMeld && currentGame.hasFirstMeld[myPlayerId];
  if (!hasMeld) { layoffTargets = []; updateLayoffBtn(); return; }
  layoffTargets = findAllLayoffs(handCodes, currentGame);
  updateLayoffBtn();
}

function updateLayoffBtn() {
  var btn = document.getElementById('btn-layoff');
  if (!btn) return;
  var hasMeld = currentGame && currentGame.hasFirstMeld && currentGame.hasFirstMeld[myPlayerId];
  var hasTargets = layoffTargets && layoffTargets.length > 0;
  btn.disabled = !myTurn || !hasMeld || !hasTargets;
  btn.style.display = hasMeld ? 'inline-block' : 'none';
}

function openLayoffModal() {
  if (layoffTargets.length === 0) { notify('ไม่มีไพ่ที่ฝากได้'); return; }
  try {
    document.getElementById('layoff-modal').classList.add('active');
    renderLayoffOptions();
  } catch(e) { console.error('openLayoffModal error:', e); }
}

function closeLayoffModal() {
  try { document.getElementById('layoff-modal').classList.remove('active'); } catch(e) {}
}

function renderLayoffOptions() {
  try {
    var container = document.getElementById('layoff-section');
    if (!container) return;
    var handCodes = currentGame.hands[myPlayerId] || [];

    // Group layoff targets by target player
    var byTarget = {};
    for (var i = 0; i < layoffTargets.length; i++) {
      var lt = layoffTargets[i];
      var key = lt.targetPid;
      if (!byTarget[key]) byTarget[key] = [];
      byTarget[key].push(lt);
    }

    var _data = db ? null : null;
    (async function() {
      try {
        var rd = await db.from('rooms').select('players').eq('id', roomCode).single();
        var players = (rd.data && rd.data.players) || {};
        var html = '<div style="color:#aaa;font-size:0.9rem;margin-bottom:12px;text-align:center">เลือกไพ่ที่จะฝาก:</div>';
        for (var pid in byTarget) {
          var p = players[pid] || {};
          html += '<div style="margin-bottom:16px">';
          html += '<div style="color:#ffd700;font-size:0.85rem;margin-bottom:8px">' + (p.name||'??') + ' ฝากไพ่:</div>';
          var group = byTarget[pid];
          for (var gi = 0; gi < group.length; gi++) {
            var lt = group[gi];
            var card = codeToCard(lt.layoffCard);
            var pts = cardPoints(card);
            html += '<div class="layoff-option" onclick="selectLayoff(' + JSON.stringify(lt).replace(/"/g,'&quot;') + ')">' +
              '<div class="ms-card ' + handCardClass(card) + '">' + card.rank + '<br>' + card.suit + '</div>' +
              '<div style="font-size:0.75rem;color:#aaa;margin-left:8px">→ ฝาก (' + pts + ' แต้ม)</div></div>';
          }
          html += '</div>';
        }
        container.innerHTML = html;
      } catch(e) { container.innerHTML = '<div style="color:#aaa;text-align:center">กำลังโหลด...</div>'; }
    })();
  } catch(e) { console.error('renderLayoffOptions error:', e); }
}

async function selectLayoff(lt) {
  try {
    var handCodes = currentGame.hands[myPlayerId] || [];
    var newHandCodes = handCodes.filter(function(c){ return c !== lt.layoffCard; });
    var targetMeld = currentGame.melds[lt.targetPid] || [];
    var meldIdx = -1;
    for (var mi = 0; mi < targetMeld.length; mi++) {
      if (JSON.stringify(targetMeld[mi]) === JSON.stringify(lt.targetMeld)) { meldIdx = mi; break; }
    }
    var newTargetMeld = targetMeld.slice();
    if (meldIdx >= 0) newTargetMeld[meldIdx] = targetMeld[meldIdx].concat([lt.layoffCard]);
    var newMelds = Object.assign({}, currentGame.melds || {});
    newMelds[lt.targetPid] = newTargetMeld;
    currentGame = Object.assign(currentGame, {
      hands: Object.assign({}, currentGame.hands, { [myPlayerId]: newHandCodes }),
      melds: newMelds
    });
    await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
    closeLayoffModal();
    var card = codeToCard(lt.layoffCard);
    notify('💚 ฝาก ' + (card ? card.rank + card.suit : lt.layoffCard) + ' สำเร็จ! +' + cardPoints(card) + ' แต้ม');
    renderYourHand();
    renderPlayerMeldRow();
    updateLayoffTargets();
    updateActionBtns();
  } catch(e) { console.error('selectLayoff error:', e); }
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
      html += '<div class="player-slot ' + (isYou ? 'you' : '') + '">' +
        '<div class="pemoji">' + (p.isBot ? '🤖' : '👤') + '</div>' +
        '<div class="pname">' + p.name + '</div>' +
        '<div class="ptype">' + (isYou ? '(คุณ)' : p.isBot ? 'AI' : 'ผู้เล่น') + '</div></div>';
    }
    for (var ei = arr.length; ei < 4; ei++) html += '<div class="player-slot"><div class="pemoji">❓</div><div class="pname">รอผู้เล่น...</div><div class="ptype">เหลือ ' + (4-ei) + ' คน</div></div>';
    list.innerHTML = html;
    var humanCount = arr.filter(function(p){ return !p.isBot; }).length;
    if (btnStart) btnStart.style.display = humanCount >= 1 ? 'block' : 'none';
  } catch(e) { console.error('renderLobby error:', e); }
}

async function renderGame(game) {
  try {
    if (!game) return;
    window._currentGame = game;
    var turnPlayerId = game.turnPlayerId;
    myTurn = turnPlayerId === myPlayerId;
    var ti = document.getElementById('turn-indicator');
    if (ti) ti.textContent = myTurn ? '🎯 ตาของคุณ!' : '⏳ รอตาคนอื่น...';
    var ri = document.getElementById('round-info');
    if (ri) ri.textContent = 'รอบ: ' + (game.round || 1) + ' | ทิ้ง: ' + (game.discardPile ? game.discardPile.length : 0);
    var dc = document.getElementById('deck-count');
    if (dc) dc.textContent = (game.deck ? game.deck.length : 0) + ' ใบ' + (game.deckEmpty ? ' 🔻หมด' : '');
    var yn = document.getElementById('your-name');
    if (yn) yn.textContent = myName;
    await renderOpponents(game);
    renderDiscardPile(game);
    renderYourHand();
    renderPlayerMeldRow();
    renderScoreboard(game);
    updateLayoffTargets();
    updateActionBtns();
  } catch(e) { console.error('renderGame error:', e); }
}

async function renderOpponents(game) {
  try {
    var _data = await db.from('rooms').select('players').eq('id', roomCode).single();
    var players = (_data.data && _data.data.players) || {};
    var order = game.playerOrder || [];
    var opponents = order.filter(function(pid){ return pid !== myPlayerId; });
    var top = opponents.slice(0, 2);
    while (top.length < 2) top.push(null);
    var bot = opponents.slice(2, 3);
    while (bot.length < 1) bot.push(null);
    var topRow = document.getElementById('row-opponents-top');
    var botRow = document.getElementById('row-opponents-bottom');
    if (topRow) topRow.innerHTML = top.map(function(pid){ return opponentCardHtml(pid, game, players); }).join('');
    if (botRow) botRow.innerHTML = bot.map(function(pid){ return opponentCardHtml(pid, game, players); }).join('');
  } catch(e) { console.error('renderOpponents error:', e); }
}

function opponentCardHtml(pid, game, players) {
  if (!pid) return '<div class="opponent-card" style="opacity:0.3"><div class="oheader"><span class="oemoji">❓</span><span class="oname">---</span></div><div class="ocard-mini"><span style="color:#555;font-size:0.75rem">รอผู้เล่น</span></div></div>';
  var handSize = game.hands && game.hands[pid] ? game.hands[pid].length : 0;
  var isActive = game.turnPlayerId === pid;
  var p = players[pid] || {};
  var melds = game.melds && game.melds[pid] ? game.melds[pid] : [];
  var meldChips = '';
  for (var mi = 0; mi < melds.length; mi++) {
    var meldCodes = Array.isArray(melds[mi]) ? melds[mi] : (melds[mi].cards || []);
    var meldName = detectMeldType(meldCodes);
    var cardsHtml = '';
    for (var ci = 0; ci < meldCodes.length; ci++) {
      var c = codeToCard(meldCodes[ci]);
      if (c) cardsHtml += '<div class="mini-card ' + handCardClass(c) + '" style="width:22px;height:30px;font-size:0.5rem;gap:0;flex-shrink:0">' + c.rank + '<br>' + c.suit + '</div>';
    }
    meldChips += '<div class="meld-chip" style="display:flex;align-items:center;gap:2px;flex-wrap:nowrap;overflow:hidden">' + cardsHtml + ' <span style="font-size:0.6rem;white-space:nowrap"> ' + meldName + '</span></div>';
  }
  var activeLabel = isActive ? '<span class="oactive">▶ ตาคนี้</span>' : '';
  return '<div class="opponent-card' + (isActive ? ' active-turn' : '') + '">' +
    '<div class="oheader"><span class="oemoji">' + (p.isBot ? '🤖' : '👤') + '</span><span class="oname">' + (p.name || '??') + '</span>' + activeLabel + '</div>' +
    '<div style="text-align:center;padding:8px 0"><div style="font-size:2rem;font-weight:700;color:var(--gold)">' + handSize + '</div><div style="font-size:0.75rem;color:#888">ใบ</div></div>' +
    (meldChips ? '<div class="omeld-list">' + meldChips + '</div>' : '') + '</div>';
}

function renderDiscardPile(game) {
  try {
    var pile = document.getElementById('discard-pile');
    var discard = game.discardPile || [];
    if (!pile) return;
    if (discard.length === 0) { pile.innerHTML = '<span style="color:#555;font-size:0.8rem">ว่าง</span>'; return; }
    var html = '';
    for (var i = 0; i < discard.length; i++) {
      var card = codeToCard(discard[i]);
      if (!card) continue;
      var cls = handCardClass(card);
      html += '<div class="dp-card ' + cls + '" onclick="pickFromDiscard(' + i + ')" style="cursor:pointer;flex-shrink:0" title="หยิบใบนี้และทุกใบที่อยู่บน">' + card.rank + '<br>' + card.suit + '</div>';
    }
    pile.innerHTML = html;
  } catch(e) { console.error('renderDiscardPile error:', e); }
}

function renderYourHand() {
  try {
    var container = document.getElementById('your-hand');
    if (!container) return;
    var handCodes = currentGame && currentGame.hands ? (currentGame.hands[myPlayerId] || []) : [];
    var hand = codesToCards(handCodes);
    var sorted = sortHand(hand);
    var pickedCodes = (currentGame && currentGame.pickedFromDiscard && currentGame.pickedFromDiscard[myPlayerId]) || [];
    var html = '';
    for (var hi = 0; hi < sorted.length; hi++) {
      var card = sorted[hi];
      var cls = handCardClass(card);
      var isPicked = pickedCodes.indexOf(card.code) >= 0;
      var isSelected = selectedCards.indexOf(card.code) >= 0;
      var selClass = isSelected ? ' selected' : '';
      var pickedStyle = isPicked ? 'border-color:#ffd700;box-shadow:0 0 8px rgba(255,215,0,0.7)' : '';
      var clickAttr = myTurn ? 'onclick="toggleSelect(\'' + card.code + '\')"' : '';
      var extraTag = isPicked ? '<span class="ctag" style="color:#ffd700">หยิบมา</span>' : (isSpeto(card) ? '<span class="ctag">สเปโต</span>' : '');
      html += '<div class="hand-card ' + cls + selClass + '" ' + clickAttr + ' style="' + pickedStyle + '">' +
        '<span class="cr">' + card.rank + '</span><span class="cs">' + card.suit + '</span>' + extraTag + '</div>';
    }
    container.innerHTML = html;
  } catch(e) { console.error('renderYourHand error:', e); }
}

function renderPlayerMeldRow() {
  try {
    var row = document.getElementById('player-meld-row');
    if (!row || !currentGame) return;
    var melds = currentGame.melds && currentGame.melds[myPlayerId] ? currentGame.melds[myPlayerId] : [];
    if (melds.length === 0) { row.innerHTML = ''; return; }
    var html = '';
    for (var mi = 0; mi < melds.length; mi++) {
      var meldCodes = melds[mi];
      var meldHtml = '<div class="meld-set-display">';
      for (var ci = 0; ci < meldCodes.length; ci++) { var card = codeToCard(meldCodes[ci]); if (card) meldHtml += '<div class="ms-card ' + handCardClass(card) + '">' + card.rank + '<br>' + card.suit + '</div>'; }
      meldHtml += '</div>';
      html += meldHtml;
    }
    row.innerHTML = html;
  } catch(e) { console.error('renderPlayerMeldRow error:', e); }
}

async function renderScoreboard(game) {
  try {
    var row = document.getElementById('score-row');
    if (!row) return;
    var _data = await db.from('rooms').select('players').eq('id', roomCode).single();
    var players = (_data.data && _data.data.players) || {};
    var scores = game.scores || {};
    var html = '';
    for (var si = 0; si < game.playerOrder.length; si++) {
      var pid = game.playerOrder[si];
      var p = players[pid] || {};
      var isYou = pid === myPlayerId;
      var pts = scores[pid] || 0;
      var meldCount = (game.melds && game.melds[pid]) ? game.melds[pid].length : 0;
      html += '<div class="score-item' + (isYou ? ' highlight' : '') + '">' +
        '<div class="sname">' + (p.isBot ? '🤖 ' : '') + (p.name || '??') + '</div>' +
        '<div class="spoint" style="color:' + (isYou ? '#ffd700' : '#fff') + '">' + (pts > 0 ? '+' : '') + pts + '</div>' +
        '<div style="font-size:0.7rem;color:#888">เกิด ' + meldCount + '</div></div>';
    }
    row.innerHTML = html;
  } catch(e) { console.error('renderScoreboard error:', e); }
}

function toggleSelect(code) {
  try {
    var hand = currentGame && currentGame.hands ? (currentGame.hands[myPlayerId] || []) : [];
    if (hand.indexOf(code) === -1) return;
    var pickedCodes = (currentGame && currentGame.pickedFromDiscard && currentGame.pickedFromDiscard[myPlayerId]) || [];
    if (pickedCodes.indexOf(code) >= 0) { notify('❌ ไม่สามารถทิ้งไพ่ที่หยิบจากกองทิ้งมาได้'); return; }
    var idx = selectedCards.indexOf(code);
    if (idx >= 0) selectedCards.splice(idx, 1); else selectedCards.push(code);
    renderYourHand();
    updateActionBtns();
  } catch(e) { console.error('toggleSelect error:', e); }
}

function updateActionBtns() {
  try {
    var btnDraw = document.getElementById('btn-draw');
    var btnMeld = document.getElementById('btn-meld');
    var btnDiscard = document.getElementById('btn-discard');
    var btnEnd = document.getElementById('btn-end');
    var handStatus = document.getElementById('hand-status');
    if (!currentGame) return;

    var hasMeld = currentGame.hasFirstMeld && currentGame.hasFirstMeld[myPlayerId];
    var picked = pendingPickedCodes.length > 0;
    var canLayoff = layoffTargets && layoffTargets.length > 0 && hasMeld;

    if (myTurn) {
      var phase = currentGame.phase || 'draw';
      if (btnDraw) btnDraw.disabled = phase !== 'draw';
      if (btnMeld) btnMeld.disabled = false;
      if (btnDiscard) btnDiscard.disabled = !(selectedCards.length === 1 && !picked);
      if (btnEnd) btnEnd.disabled = !(phase === 'action' && !picked);

      if (picked) handStatus.textContent = '⚠️ ต้องเกิดใบที่หยิบจากกองทิ้งก่อน!';
      else if (phase === 'draw') handStatus.textContent = '📦 จั่วหรือหยิบจากกองทิ้ง';
      else handStatus.textContent = '🃏 เลือกไพ่ 1 ใบที่จะทิ้ง แล้วกดปุ่ม 🗑️ ทิ้ง';
    } else {
      [btnDraw, btnMeld, btnDiscard, btnEnd].forEach(function(b){ if(b) b.disabled = true; });
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
    var winnerEl = document.getElementById('winner-name');
    if (winnerEl) winnerEl.textContent = '🏆 ' + (players[winner] ? players[winner].name : '??') + ' ชนะ!';
    var table = document.getElementById('endgame-table');
    if (table) {
      table.innerHTML = '<tr><th>ผู้เล่น</th><th>แต้มรอบนี้</th><th>รวมสะสม</th></tr>';
      for (var pid in totalScores) {
        var p = players[pid] || {};
        var rs = roundScores[pid] || 0;
        table.innerHTML += '<tr class="' + (pid === winner ? 'winner-row' : '') + '">' +
          '<td>' + (p.isBot ? '🤖 ' : '👤 ') + (p.name || '??') + (pid === winner ? ' 👑' : '') + '</td>' +
          '<td>' + (rs > 0 ? '+' : '') + rs + '</td><td>' + (totalScores[pid] > 0 ? '+' : '') + totalScores[pid] + '</td></tr>';
      }
    }
    var modal = document.getElementById('endgame-modal');
    if (modal) modal.classList.add('active');
  } catch(e) { console.error('showEndGame error:', e); }
}

async function playAgain() {
  try {
    var modal = document.getElementById('endgame-modal');
    if (modal) modal.classList.remove('active');
    var _data = await db.from('rooms').select('players').eq('id', roomCode).single();
    if (!_data.data) return;
    var players = _data.data.players || {};
    var pids = Object.keys(players);
    if (pids.length < 2) return;
    var deck = shuffle(makeDeck());
    var hands = {};
    for (var pi = 0; pi < pids.length; pi++) { var h = []; for (var di = 0; di < 7; di++) h.push(deck.pop().code); hands[pids[pi]] = h; }
    var fc = deck.pop();
    var hp = (fc.code === '2♣' || fc.code === 'Q♠') ? 100 : 50;
    var gameData = {
      deck: deck.map(function(c){ return c.code; }),
      hands: hands,
      discardPile: [fc.code],
      turnPlayerId: pids[0],
      playerOrder: pids,
      phase: 'draw',
      status: 'playing',
      melds: {},
      scores: {},
      round: (currentGame ? (currentGame.round || 1) : 1) + 1,
      turnStartTime: Date.now(),
      headCard: fc.code,
      headPoints: hp,
      hasFirstMeld: {},
      lastDiscard: null,
      deckEmpty: false,
      pickedFromDiscard: {}
    };
    for (var mi = 0; mi < pids.length; mi++) { gameData.melds[pids[mi]] = []; gameData.scores[pids[mi]] = 0; gameData.hasFirstMeld[pids[mi]] = false; }
    await db.from('rooms').update({ status: 'playing', game: gameData }).eq('id', roomCode);
    currentGame = gameData;
    selectedCards = []; pendingPickedCodes = []; layoffTargets = [];
    showScreen('game-screen');
    renderGame(gameData);
  } catch(e) { console.error('playAgain error:', e); }
}

function goHome() {
  try { var modal = document.getElementById('endgame-modal'); if (modal) modal.classList.remove('active'); } catch(e) {}
  leaveRoom();
}

// --- POLLING ---
function startPolling(rid) {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async function() {
    if (!roomCode) { clearInterval(pollInterval); return; }
    try {
      var _data = await db.from('rooms').select('*').eq('id', rid).single();
      if (_data.data && _data.data.game) {
        var remoteGame = _data.data;
        if (JSON.stringify(remoteGame.game) !== JSON.stringify(currentGame)) {
          currentGame = remoteGame.game;
          if (remoteGame.status === 'playing') renderGame(currentGame);
          else if (remoteGame.status === 'ended') showEndGame({ winner: remoteGame.winner, totalScores: remoteGame.totalScores, players: remoteGame.players });
        }
      }
    } catch(e) {}
  }, 1000);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', function() {
  var params = new URLSearchParams(window.location.search);
  if (params.has('room')) {
    var codeEl = document.getElementById('join-code');
    if (codeEl) codeEl.value = params.get('room');
  }
  console.log('[DummyRummy] v11 Loaded!');
  if (db) {
    (async function() {
      try {
        var thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        await db.from('rooms').delete().lt('updated_at', thirtyMinAgo).neq('status', 'playing');
      } catch(e) {}
    })();
  }
});

function confetti() {
  try {
    var colors = ['#ffd700','#e94560','#4ecdc4','#ff6b6b','#a855f7'];
    for (var i = 0; i < 60; i++) {
      var el = document.createElement('div');
      el.style.cssText = 'position:fixed;width:10px;height:10px;background:' + colors[i%colors.length] + ';left:' + (Math.random()*100) + 'vw;top:-10px;border-radius:50%;animation:confetti-fall ' + (1.5 + Math.random()*2) + 's linear forwards;z-index:9999;pointer-events:none';
      el.style.setProperty('--tx', (Math.random()-0.5)*200 + 'px');
      document.body.appendChild(el);
      setTimeout(function(e){ document.body.removeChild(e); }, 4000, el);
    }
    var style = document.createElement('style');
    style.textContent = '@keyframes confetti-fall{0%{transform:translateY(0) translateX(0) rotate(0)}100%{transform:translateY(100vh) translateX(var(--tx)) rotate(720deg)}}';
    document.head.appendChild(style);
  } catch(e) {}
}

console.log('[DummyRummy] Script parsing OK!');
