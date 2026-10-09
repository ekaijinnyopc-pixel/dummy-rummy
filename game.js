// ============================================================
// 🃏 DUMMY RUMMY — game.js
// Supabase Realtime + Game Logic
// ============================================================

// --- SUPABASE CONFIG ---
const SUPABASE_URL = 'https://dbtlbeymrchodloboymr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_m72xxY53a8lHIHplk8jLRg_es5hrjWf';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- CONSTANTS ---
const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const JOKER_RANK = '🃏';
const SPETO_SIGMA = '♠2';
const SPETO_KING = '♠Q';

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, code: `${rank}${suit}` });
    }
  }
  // 2♣ + Q♠ = สเปโต
  deck.push({ suit: '♣', rank: '2', code: '2♣', isSpeto: true, spetoPair: 'Q♠' });
  deck.push({ suit: '♠', rank: 'Q', code: 'Q♠', isSpeto: true, spetoPair: '2♣' });
  // Jokers
  deck.push({ suit: '🃏', rank: 'JOKER', code: 'JOKER1', isJoker: true });
  deck.push({ suit: '🃏', rank: 'JOKER', code: 'JOKER2', isJoker: true });
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardPoints(card) {
  if (card.isJoker || card.isSpeto) return 50;
  const r = card.rank;
  if (r === 'A') return 15;
  if (['J','Q','K'].includes(r)) return 10;
  if (['2','3','4','5','6','7','8','9'].includes(r)) return 5;
  return 0;
}

function cardColor(card) {
  return (card.suit === '♥' || card.suit === '♦') ? 'red' : 'black';
}

function sortHand(hand) {
  return hand.slice().sort((a, b) => {
    if (a.isJoker && !b.isJoker) return 1;
    if (!a.isJoker && b.isJoker) return -1;
    if (a.isSpeto && !b.isSpeto) return 1;
    if (!a.isSpeto && b.isSpeto) return -1;
    const suitOrder = { '♠':0, '♥':1, '♦':2, '♣':3 };
    const s1 = suitOrder[a.suit] ?? 4;
    const s2 = suitOrder[b.suit] ?? 4;
    if (s1 !== s2) return s1 - s2;
    const rankOrder = {'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13};
    return (rankOrder[a.rank]||14) - (rankOrder[b.rank]||14);
  });
}

// Detect melds: runs (same suit, consecutive) and sets (same rank, different suits)
function findMelds(hand) {
  const melds = [];
  const normals = hand.filter(c => !c.isJoker && !c.isSpeto);
  const spetos = hand.filter(c => c.isSpeto);
  const jokers = hand.filter(c => c.isJoker);

  // --- SETS (3-4 of a kind same rank) ---
  const byRank = {};
  for (const c of normals) {
    if (!byRank[c.rank]) byRank[c.rank] = [];
    byRank[c.rank].push(c);
  }
  for (const [rank, cards] of Object.entries(byRank)) {
    if (cards.length >= 3) {
      melds.push({ type: 'set', cards, rank });
    }
  }

  // --- RUNS (3+ same suit, consecutive) ---
  const bySuit = {};
  for (const c of normals) {
    if (!bySuit[c.suit]) bySuit[c.suit] = [];
    bySuit[c.suit].push(c);
  }
  const rankOrder = {'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13};
  for (const [suit, cards] of Object.entries(bySuit)) {
    const sorted = cards.slice().sort((a,b) => rankOrder[a.rank]-rankOrder[b.rank]);
    let run = [];
    for (let i = 0; i < sorted.length; i++) {
      const cur = rankOrder[sorted[i].rank];
      const prev = run.length > 0 ? rankOrder[run[run.length-1].rank] : null;
      if (prev !== null && cur === prev + 1) {
        run.push(sorted[i]);
      } else if (prev !== null && cur === prev) {
        // same rank skip
      } else {
        if (run.length >= 3) melds.push({ type: 'run', cards: [...run], suit });
        run = [sorted[i]];
      }
    }
    if (run.length >= 3) melds.push({ type: 'run', cards: [...run], suit });
  }

  // --- JOKER HELPED SETS ---
  if (jokers.length > 0 && normals.length > 0) {
    for (const [rank, cards] of Object.entries(byRank)) {
      if (cards.length === 2 && jokers.length >= 1) {
        melds.push({ type: 'set', cards: [...cards, ...jokers.splice(0,1)], rank, jokerUsed: true });
      }
    }
    // joker helped run
    for (const [suit, cards] of Object.entries(bySuit)) {
      const sorted = cards.slice().sort((a,b) => rankOrder[a.rank]-rankOrder[b.rank]);
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = rankOrder[sorted[i+1].rank] - rankOrder[sorted[i].rank];
        if (gap === 2 && jokers.length >= 1) {
          const jokerCard = jokers.shift();
          const runCards = [sorted[i], jokerCard, sorted[i+1]];
          melds.push({ type: 'run', cards: runCards, suit, jokerUsed: true });
        }
      }
    }
  }

  return melds;
}

// ============================================================
// GAME STATE (client-side)
// ============================================================
let myPlayerId = null;
let myName = '';
let roomCode = null;
let roomSubscription = null;
let gameSubscription = null;
let currentGame = null;
let gameState = 'home'; // home | lobby | playing
let selectedCards = [];
let pendingMeld = null;
let myTurn = false;
let turnTimer = null;
let TURN_TIME = 30; // seconds

// ============================================================
// UTILITY
// ============================================================
function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
}

function playerRef(roomId) {
  return db.ref(`rooms/${roomId}/players`);
}

function gameRef(roomId) {
  return db.ref(`rooms/${roomId}/game`);
}

function notify(msg, duration = 3000) {
  const el = document.getElementById('notification');
  el.textContent = msg;
  el.className = 'notification show';
  setTimeout(() => el.className = 'notification', duration);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function renderCard(card, small = false) {
  if (!card) return '';
  const w = small ? 50 : 80;
  const h = small ? 70 : 112;
  const isJoker = card.isJoker;
  const isSpeto = card.isSpeto;
  let bg, border, color;
  if (isJoker) {
    bg = 'linear-gradient(135deg, #ffd700, #ff8f00)'; border = '#ffd700'; color = '#fff';
  } else if (isSpeto) {
    bg = '#1a1a2e'; border = '#ffd700'; color = '#ffd700';
  } else if (card.suit === '♥' || card.suit === '♦') {
    bg = '#fff5f5'; border = '#ef9a9a'; color = '#c62828';
  } else {
    bg = '#f5f5ff'; border = '#9fa8da'; color = '#1a237e';
  }
  const rank = isJoker ? 'JKR' : card.rank;
  const suit = isJoker ? '★' : card.suit;
  return `<div class="card" style="width:${w}px;height:${h}px;background:${bg};border-color:${border};color:${color};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-radius:8px;border:2px solid ${border};font-weight:700">
    <span style="font-size:${small?'0.8rem':'1.1rem'};line-height:1">${rank}</span>
    <span style="font-size:${small?'1rem':'1.4rem'};line-height:1">${suit}</span>
    ${isSpeto ? '<span style="font-size:0.5rem;color:#ffd700">สเปโต</span>' : ''}
    ${isJoker ? '<span style="font-size:0.5rem;color:#fff">โจ๊กเกอร์</span>' : ''}
  </div>`;
}

function renderCardBack(w = 78, h = 110) {
  return `<div style="width:${w}px;height:${h}px;background:linear-gradient(135deg,#c62828,#8b0000);border-radius:8px;border:2px solid #ffd700;display:flex;align-items:center;justify-content:center">
    <span style="color:#ffd700;font-size:1.5rem">🂠</span>
  </div>`;
}

function confetti() {
  const c = document.getElementById('confetti');
  c.innerHTML = '';
  const colors = ['#ffd700','#e94560','#4caf50','#2196f3','#ff9800','#9c27b0'];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random()*100+'%';
    piece.style.background = colors[Math.floor(Math.random()*colors.length)];
    piece.style.animationDelay = Math.random()*2+'s';
    piece.style.borderRadius = Math.random()>0.5?'50%':'0';
    c.appendChild(piece);
  }
  setTimeout(() => c.innerHTML = '', 5000);
}

// ============================================================
// SUPABASE REAL-TIME LISTENERS
// ============================================================
async function subscribeToRoom(roomId) {
  if (roomSubscription) roomSubscription.unsubscribe();
  if (gameSubscription) gameSubscription.unsubscribe();

  // Listen to players
  roomSubscription = db.ref(`rooms/${roomId}/players`).on('value', snap => {
    const players = snap.val() || {};
    renderLobby(players);
  });

  // Listen to game state
  gameSubscription = db.ref(`rooms/${roomId}/game`).on('value', snap => {
    const game = snap.val();
    if (!game) return;
    currentGame = game;
    renderGame(game);
  });
}

function unsubscribeAll() {
  if (roomSubscription) { roomSubscription.unsubscribe(); roomSubscription = null; }
  if (gameSubscription) { gameSubscription.unsubscribe(); gameSubscription = null; }
}

// ============================================================
// HOME SCREEN ACTIONS
// ============================================================
async function createRoom() {
  const name = document.getElementById('create-name').value.trim();
  if (!name) { notify('กรุณาใส่ชื่อของคุณ'); return; }
  const botCount = parseInt(document.getElementById('bot-count').value);
  
  roomCode = genRoomCode();
  myName = name;
  myPlayerId = 'p_' + Math.random().toString(36).substr(2,9);
  
  const roomData = {
    code: roomCode,
    createdAt: Date.now(),
    status: 'lobby',
    players: {},
    game: null
  };
  roomData.players[myPlayerId] = { id: myPlayerId, name, isBot: false, isHost: true };
  
  // Add bots if needed
  const botNames = ['🤖 บอทแดง', '🤖 บอทน้ำเงิน', '🤖 บอทเขียว'];
  for (let i = 0; i < botCount; i++) {
    const botId = 'bot_' + i;
    roomData.players[botId] = { id: botId, name: botNames[i], isBot: true, isHost: false };
  }
  
  await db.ref(`rooms/${roomCode}`).set(roomData);
  
  showScreen('lobby-screen');
  document.getElementById('display-room-code').textContent = roomCode;
  await subscribeToRoom(roomCode);
  notify('✅ สร้างห้องสำเร็จ!');
}

async function joinRoom() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  const name = document.getElementById('join-name').value.trim();
  if (!code) { notify('กรุณาใส่รหัสห้อง'); return; }
  if (!name) { notify('กรุณาใส่ชื่อของคุณ'); return; }
  
  myName = name;
  myPlayerId = 'p_' + Math.random().toString(36).substr(2,9);
  
  const snap = await db.ref(`rooms/${code}`).once('value');
  const room = snap.val();
  if (!room) { notify('❌ ไม่พบห้องนี้'); return; }
  if (room.status === 'playing') { notify('❌ เกมเริ่มแล้ว'); return; }
  
  const playerCount = Object.keys(room.players || {}).length;
  if (playerCount >= 4) { notify('❌ ห้องเต็มแล้ว'); return; }
  
  roomCode = code;
  await db.ref(`rooms/${code}/players/${myPlayerId}`).set({ id: myPlayerId, name, isBot: false, isHost: false });
  
  showScreen('lobby-screen');
  document.getElementById('display-room-code').textContent = code;
  await subscribeToRoom(code);
  notify('✅ เข้าห้องสำเร็จ!');
}

async function leaveRoom() {
  if (!roomCode || !myPlayerId) return;
  await db.ref(`rooms/${roomCode}/players/${myPlayerId}`).remove();
  unsubscribeAll();
  roomCode = null;
  myPlayerId = null;
  showScreen('home-screen');
}

async function startGame() {
  if (!roomCode) return;
  const snap = await db.ref(`rooms/${roomCode}/players`).once('value');
  const players = snap.val() || {};
  const playerCount = Object.keys(players).length;
  if (playerCount < 2) { notify('ต้องมีอย่างน้อย 2 คน'); return; }
  
  await db.ref(`rooms/${roomCode}/status`).set('playing');
  await initGame(roomCode, players);
}

async function initGame(roomId, players) {
  const deck = shuffle(makeDeck());
  const playerIds = Object.keys(players);
  
  // Deal 7 cards each
  const hands = {};
  for (const pid of playerIds) {
    hands[pid] = sortHand(deck.splice(0, 7));
  }
  
  const discardPile = [deck.pop()];
  
  const gameData = {
    deck: deck.map(c => c.code),
    hands,
    discardPile: discardPile.map(c => c.code),
    turnIndex: 0,
    turnPlayerId: playerIds[0],
    phase: 'draw', // draw | meld | discard
    playerOrder: playerIds,
    status: 'playing',
    melds: {}, // playerId -> array of meld arrays
    canLayoff: {}, // playerId -> array of valid layoff targets
    scores: {},
    totalScores: {},
    round: 1,
    drawCount: 0,
    turnStartTime: Date.now()
  };
  
  // Init scores
  for (const pid of playerIds) {
    gameData.totalScores[pid] = 0;
    gameData.melds[pid] = [];
  }
  
  await db.ref(`rooms/${roomId}/game`).set(gameData);
  await db.ref(`rooms/${roomId}/status`).set('playing');
  currentGame = gameData;
  showScreen('game-screen');
}

// ============================================================
// GAME ACTIONS
// ============================================================
async function drawCard() {
  if (!currentGame || !myTurn) return;
  if (currentGame.phase !== 'draw') return;
  
  const deck = [...currentGame.deck];
  if (deck.length === 0) { notify('กองจั่วหมดแล้ว!'); return; }
  
  const drawn = deck.pop();
  const newHands = { ...currentGame.hands };
  newHands[myPlayerId] = sortHand([...newHands[myPlayerId], drawn]);
  
  await db.ref(`rooms/${roomCode}/game`).update({
    deck,
    hands: newHands,
    phase: 'action',
    turnStartTime: Date.now()
  });
  
  notify(`📦 จั่วได้: ${drawn.rank}${drawn.suit}`);
}

async function pickDiscard() {
  if (!currentGame || !myTurn) return;
  if (currentGame.phase !== 'draw') return;
  
  const discard = currentGame.discardPile;
  if (discard.length === 0) return;
  
  const topDiscardCode = discard[discard.length - 1];
  const topDiscard = codeToCard(topDiscardCode);
  
  const newHands = { ...currentGame.hands };
  newHands[myPlayerId] = sortHand([...newHands[myPlayerId], topDiscard]);
  const newDiscard = discard.slice(0, -1);
  
  await db.ref(`rooms/${roomCode}/game`).update({
    hands: newHands,
    discardPile: newDiscard,
    phase: 'action',
    turnStartTime: Date.now()
  });
  
  notify(`🗑️ หยิบ: ${topDiscard.rank}${topDiscard.suit}`);
}

async function discardSelected() {
  if (!currentGame || !myTurn) return;
  if (selectedCards.length !== 1) { notify('เลือกไพ่ 1 ใบที่จะทิ้ง'); return; }
  
  const card = selectedCards[0];
  const hand = currentGame.hands[myPlayerId];
  const newHand = hand.filter(c => c.code !== card.code);
  
  const newDiscard = [...currentGame.discardPile, card];
  const newHands = { ...currentGame.hands };
  newHands[myPlayerId] = newHand;
  
  selectedCards = [];
  
  await db.ref(`rooms/${roomCode}/game`).update({
    hands: newHands,
    discardPile: newDiscard,
    phase: 'draw',
    turnStartTime: Date.now()
  });
  
  // Check knockout
  if (newHand.length === 0) {
    await handleKnockout(myPlayerId);
    return;
  }
  
  await advanceTurn();
}

async function advanceTurn() {
  const order = currentGame.playerOrder;
  const idx = order.indexOf(currentGame.turnPlayerId);
  const nextIdx = (idx + 1) % order.length;
  const nextPlayerId = order[nextIdx];
  
  await db.ref(`rooms/${roomCode}/game`).update({
    turnPlayerId: nextPlayerId,
    phase: 'draw',
    turnStartTime: Date.now()
  });
  
  // If next player is bot, trigger bot turn
  const playerSnap = await db.ref(`rooms/${roomCode}/players/${nextPlayerId}').once('value');
  const player = playerSnap.val();
  if (player && player.isBot) {
    setTimeout(() => botPlay(nextPlayerId), 1500);
  }
}

async function handleKnockout(koPlayerId) {
  const players = (await db.ref(`rooms/${roomCode}/players`).once('value')).val() || {};
  
  // Calculate scores for all players
  const scores = {};
  const codeToCardMap = {};
  const fullDeck = makeDeck();
  fullDeck.forEach(c => codeToCardMap[c.code] = c);
  
  for (const [pid, hand] of Object.entries(currentGame.hands)) {
    let pts = 0;
    const isKnocker = pid === koPlayerId;
    const knockerHandSize = isKnocker ? 0 : currentGame.hands[pid].length;
    
    for (const cardCode of hand) {
      const c = codeToCardMap[cardCode];
      if (!c) continue;
      let p = cardPoints(c);
      if (!isKnocker && knockerHandSize === 0) {
        // knocker knocked (empty hand) - no penalty
      } else if (isKnocker) {
        p = p; // knocker gets 0 for their cards
      } else {
        p = p;
      }
      scores[pid] = (scores[pid]||0) + p;
    }
  }
  
  // Apply knockout multiplier
  // Simplified: knocker gets 0, others get their card points
  for (const pid of Object.keys(scores)) {
    if (pid !== koPlayerId) {
      scores[pid] = scores[pid]; // already calculated
    } else {
      scores[pid] = 0;
    }
  }
  
  // Update total scores
  const totalScores = { ...currentGame.totalScores };
  for (const [pid, s] of Object.entries(scores)) {
    totalScores[pid] = (totalScores[pid]||0) + s;
  }
  
  // Check if any player reached +500
  let gameOver = false;
  let winner = null;
  for (const [pid, total] of Object.entries(totalScores)) {
    if (total >= 500) {
      gameOver = true;
      // Winner is lowest score
      winner = pid;
    }
  }
  
  if (gameOver) {
    // Find lowest score
    let minScore = Infinity;
    for (const [pid, total] of Object.entries(totalScores)) {
      if (total < minScore) { minScore = total; winner = pid; }
    }
    await db.ref(`rooms/${roomCode}/game`).update({
      status: 'ended',
      winner: winner,
      scores,
      totalScores,
      turnPlayerId: null
    });
    showEndGame(winner, totalScores, scores, players);
  } else {
    // Next round
    await initGame(roomCode, players);
  }
}

async function endTurn() {
  if (!currentGame || !myTurn) return;
  if (currentGame.phase === 'draw') {
    notify('ต้องจั่วไพ่ก่อน!');
    return;
  }
  await advanceTurn();
}

// ============================================================
// MELD / LAYOFF
// ============================================================
function openMeldModal() {
  if (!currentGame || !myTurn) return;
  pendingMeld = null;
  document.getElementById('meld-modal').classList.add('active');
  showMeldTab('meld');
  renderMeldOptions();
}

function closeMeldModal() {
  document.getElementById('meld-modal').classList.remove('active');
}

function showMeldTab(tab) {
  document.getElementById('meld-section').style.display = tab === 'meld' ? 'block' : 'none';
  document.getElementById('layoff-section').style.display = tab === 'layoff' ? 'block' : 'none';
  document.getElementById('tab-meld').className = tab === 'meld' ? 'btn btn-primary' : 'btn btn-secondary';
  document.getElementById('tab-layoff').className = tab === 'layoff' ? 'btn btn-primary' : 'btn btn-secondary';
  document.getElementById('btn-confirm-meld').disabled = true;
  if (tab === 'layoff') renderLayoffOptions();
}

function renderMeldOptions() {
  const hand = currentGame.hands[myPlayerId] || [];
  const melds = findMelds(hand);
  
  const container = document.getElementById('meld-section');
  if (melds.length === 0) {
    container.innerHTML = '<div style="color:#aaa;text-align:center;padding:20px">ไม่พบชุดไพ่ที่เกิดได้ในมือ<br><small>ลองเลือกไพ่เอง (อย่างน้อย 3 ใบ)</small></div>';
    // Allow manual selection
    container.innerHTML += `<div style="margin-top:12px"><small style="color:#888">เลือกไพ่ในมือที่ต้องการเกิด แล้วกด "ยืนยัน"</small></div>`;
    return;
  }
  
  let html = `<div style="color:#aaa;font-size:0.9rem;margin-bottom:12px">เลือกชุดไพ่ที่จะเกิด:</div>`;
  html += '<div class="meld-sets">';
  melds.forEach((meld, i) => {
    const cardHtml = meld.cards.map(c => renderSmallCard(c)).join('');
    html += `<div class="meld-set" data-meld="${i}" onclick="selectMeld(${i})">
      ${cardHtml}
      <div style="width:100%;font-size:0.7rem;color:#888;text-align:center">${meld.type === 'set' ? 'ตอง' : 'เรียง'} ${meld.jokerUsed ? '(ใช้โจ๊กเกอร์)' : ''}</div>
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderSmallCard(card) {
  const isJoker = card.isJoker;
  const isSpeto = card.isSpeto;
  let bg, border, color;
  if (isJoker) {
    bg = 'linear-gradient(135deg, #ffd700, #ff8f00)'; border = '#ffd700'; color = '#fff';
  } else if (isSpeto) {
    bg = '#1a1a2e'; border = '#ffd700'; color = '#ffd700';
  } else if (card.suit === '♥' || card.suit === '♦') {
    bg = '#fff5f5'; border = '#ef9a9a'; color = '#c62828';
  } else {
    bg = '#f5f5ff'; border = '#9fa8da'; color = '#1a237e';
  }
  const rank = isJoker ? 'J' : card.rank;
  const suit = isJoker ? '★' : card.suit;
  return `<div class="c" style="background:${bg};border-color:${border};color:${color};border:1px solid ${border}">
    <span style="font-size:0.7rem">${rank}</span>
    <span style="font-size:1rem">${suit}</span>
  </div>`;
}

let selectedMeldIndex = null;
function selectMeld(idx) {
  selectedMeldIndex = idx;
  document.querySelectorAll('.meld-set').forEach((el, i) => {
    el.style.borderColor = i === idx ? '#ffd700' : '#0f3460';
    el.style.boxShadow = i === idx ? '0 0 10px rgba(255,215,0,0.5)' : 'none';
  });
  document.getElementById('btn-confirm-meld').disabled = false;
}

async function confirmMeld() {
  if (selectedMeldIndex === null) return;
  const hand = currentGame.hands[myPlayerId] || [];
  const melds = findMelds(hand);
  const meld = melds[selectedMeldIndex];
  if (!meld) return;
  
  // Remove melded cards from hand
  const meldedCodes = meld.cards.map(c => c.code);
  const newHand = hand.filter(c => !meldedCodes.includes(c.code));
  
  // Save meld
  const allMelds = currentGame.melds[myPlayerId] || [];
  allMelds.push(meld.cards.map(c => c.code));
  
  const newMelds = { ...currentGame.melds };
  newMelds[myPlayerId] = allMelds;
  
  await db.ref(`rooms/${roomCode}/game`).update({
    hands: { ...currentGame.hands, [myPlayerId]: newHand },
    melds: newMelds
  });
  
  notify(`🃏 เกิดสำเร็จ! (${meld.type})`);
  closeMeldModal();
}

function renderLayoffOptions() {
  // Show cards in hand that can be laid off onto existing melds
  const hand = currentGame.hands[myPlayerId] || [];
  const melds = currentGame.melds || {};
  const container = document.getElementById('layoff-section');
  
  // Get all opponent melds
  let html = '<div style="color:#aaa;font-size:0.9rem;margin-bottom:12px">ฝากไพ่ลงชุดของคนอื่น:</div>';
  let found = false;
  
  for (const [pid, playerMelds] of Object.entries(melds)) {
    if (pid === myPlayerId) continue;
    for (const meldCards of playerMelds) {
      // Determine meld type
      const firstCard = meldCards[0];
      if (!firstCard) continue;
      // For now, show all hand cards as layoff options
    }
  }
  
  if (!found) {
    html += '<div style="color:#888;text-align:center;padding:20px">ยังไม่มีชุดไพ่ของคนอื่นที่ฝากได้</div>';
  }
  container.innerHTML = html;
}

// ============================================================
// BOT LOGIC
// ============================================================
async function botPlay(botId) {
  if (!currentGame || currentGame.status !== 'playing') return;
  if (currentGame.turnPlayerId !== botId) return;
  
  const botHand = currentGame.hands[botId] || [];
  
  // Check for melds first
  const melds = findMelds(botHand);
  if (melds.length > 0 && Math.random() > 0.3) {
    // Auto-meld
    const meld = melds[0];
    const meldedCodes = meld.cards.map(c => c.code);
    const newHand = botHand.filter(c => !meldedCodes.includes(c.code));
    const allBotMelds = currentGame.melds[botId] || [];
    allBotMelds.push(meld.cards.map(c => c.code));
    const newMelds = { ...currentGame.melds, [botId]: allBotMelds };
    await db.ref(`rooms/${roomCode}/game`).update({
      hands: { ...currentGame.hands, [botId]: newHand },
      melds: newMelds
    });
    await delay(800);
  }
  
  // Draw
  const deck = [...currentGame.deck];
  if (deck.length > 0) {
    const drawn = deck.pop();
    const newBotHand = sortHand([...currentGame.hands[botId], drawn]);
    await db.ref(`rooms/${roomCode}/game`).update({
      deck,
      hands: { ...currentGame.hands, [botId]: newBotHand }
    });
    await delay(600);
    
    // Try meld again
    const newMelds = findMelds(newBotHand);
    if (newMelds.length > 0 && Math.random() > 0.4) {
      const meld = newMelds[0];
      const meldedCodes = meld.cards.map(c => c.code);
      const finalHand = newBotHand.filter(c => !meldedCodes.includes(c.code));
      const allBotMelds = currentGame.melds[botId] || [];
      allBotMelds.push(meld.cards.map(c => c.code));
      await db.ref(`rooms/${roomCode}/game`).update({
        hands: { ...currentGame.hands, [botId]: finalHand },
        melds: { ...currentGame.melds, [botId]: allBotMelds }
      });
      await delay(600);
    }
  }
  
  // Discard (lowest value card)
  const currentHand = currentGame.hands[botId] || [];
  let discardCard = currentHand[currentHand.length - 1]; // last sorted = lowest value
  if (!discardCard) return;
  
  const newHandAfterDiscard = currentHand.filter(c => c.code !== discardCard.code);
  const newDiscard = [...currentGame.discardPile, discardCard];
  
  if (newHandAfterDiscard.length === 0) {
    // Bot knocked out!
    await db.ref(`rooms/${roomCode}/game`).update({
      hands: { ...currentGame.hands, [botId]: newHandAfterDiscard },
      discardPile: newDiscard,
      turnPlayerId: botId
    });
    await handleKnockout(botId);
    return;
  }
  
  // Advance turn
  const order = currentGame.playerOrder;
  const idx = order.indexOf(botId);
  const nextIdx = (idx + 1) % order.length;
  const nextPlayerId = order[nextIdx];
  
  await db.ref(`rooms/${roomCode}/game`).update({
    hands: { ...currentGame.hands, [botId]: newHandAfterDiscard },
    discardPile: newDiscard,
    turnPlayerId: nextPlayerId,
    phase: 'draw',
    turnStartTime: Date.now()
  });
  
  // Check if next is bot
  const nextSnap = await db.ref(`rooms/${roomCode}/players/${nextPlayerId}`).once('value');
  const nextPlayer = nextSnap.val();
  if (nextPlayer && nextPlayer.isBot) {
    setTimeout(() => botPlay(nextPlayerId), 1500);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// RENDERING
// ============================================================
async function renderLobby(players) {
  const list = document.getElementById('player-list');
  const status = document.getElementById('lobby-status');
  const btnStart = document.getElementById('btn-start');
  
  const playerArray = Object.values(players || {});
  list.innerHTML = playerArray.map(p => {
    const isYou = p.id === myPlayerId;
    const cls = `player-slot filled ${isYou ? 'you' : ''} ${p.isBot ? 'bot' : ''}`;
    return `<div class="${cls}">
      <div class="pemoji">${p.isBot ? '🤖' : '👤'}</div>
      <div class="pname">${p.name}</div>
      <div class="ptype">${isYou ? 'คุณ' : p.isBot ? 'บอท' : 'ผู้เล่น'}</div>
    </div>`;
  }).join('');
  
  // Add empty slots
  for (let i = playerArray.length; i < 4; i++) {
    list.innerHTML += `<div class="player-slot">
      <div class="pemoji">❓</div>
      <div class="pname">รอผู้เล่น...</div>
      <div class="ptype">เหลือ ${4 - playerArray.length} คน</div>
    </div>`;
  }
  
  const canStart = playerArray.filter(p => !p.isBot).length >= 1;
  status.style.display = 'none';
  btnStart.style.display = canStart ? 'block' : 'none';
}

function renderGame(game) {
  if (!game) return;
  
  const players = Object.values((db.ref(`rooms/${roomCode}/players`).once('value') && {}) || {});
  const order = game.playerOrder || [];
  
  // Turn indicator
  const turnPlayer = game.turnPlayerId;
  myTurn = turnPlayerId === myPlayerId;
  
  document.getElementById('turn-indicator').textContent = myTurn ? '🎯 ตาของคุณ!' : `⏳ ${turnPlayerId ? (order[order.indexOf(turnPlayerId)] || '...') : '...'}`;
  document.getElementById('round-info').textContent = `รอบ: ${game.round || 1} | ทิ้ง: ${game.discardPile?.length || 0}`;
  
  // Opponents
  renderOpponents(game, order);
  
  // Deck count
  document.getElementById('deck-count').textContent = `${game.deck?.length || 0} ใบ`;
  
  // Discard pile
  renderDiscardPile(game);
  
  // Your hand
  renderYourHand(game);
  
  // Scoreboard
  renderScoreboard(game);
  
  // Action bar
  renderActionBar(game);
}

async function renderOpponents(game, order) {
  const container = document.getElementById('opponents-row');
  container.innerHTML = '';
  
  for (const pid of order) {
    if (pid === myPlayerId) continue;
    const hand = game.hands?.[pid] || [];
    const isActive = game.turnPlayerId === pid;
    const playerSnap = await db.ref(`rooms/${roomCode}/players/${pid}`).once('value');
    const player = playerSnap?.val() || {};
    
    container.innerHTML += `<div class="opponent-card ${isActive ? 'active-turn' : ''}">
      <div style="font-size:1.2rem">${player.isBot ? '🤖' : '👤'}</div>
      <div class="oname">${player.name || '??'}</div>
      <div class="ocard-count">${hand.length} ใบ</div>
      ${player.isBot ? '<div class="obot">AI</div>' : ''}
    </div>`;
  }
}

function renderDiscardPile(game) {
  const pile = document.getElementById('discard-pile');
  const discard = game.discardPile || [];
  if (discard.length === 0) {
    pile.innerHTML = renderCardBack(78, 110);
    return;
  }
  const topCode = discard[discard.length - 1];
  const card = codeToCard(topCode);
  pile.innerHTML = renderCard(card);
}

function renderYourHand(game) {
  const handContainer = document.getElementById('your-hand');
  const hand = game.hands[myPlayerId] || [];
  const sorted = sortHand(hand);
  
  handContainer.innerHTML = sorted.map(card => {
    const isSelected = selectedCards.some(c => c.code === card.code);
    return `<div class="card ${isSelected ? 'selected' : ''}" 
      style="width:60px;height:84px;border-radius:6px;cursor:pointer;
        ${card.suit==='♥'||card.suit==='♦' ? 'background:#fff5f5;border-color:#ef9a9a;color:#c62828' : 
          card.suit==='♠'||card.suit==='♣' ? 'background:#f5f5ff;border-color:#9fa8da;color:#1a237e' : 
          card.isJoker ? 'background:linear-gradient(135deg,#ffd700,#ff8f00);border-color:#ffd700;color:#fff' :
          'background:#1a1a2e;border-color:#ffd700;color:#ffd700'}"
      onclick="toggleCardSelection('${card.code}')">
      <span style="font-size:0.9rem;font-weight:700">${card.isJoker ? 'J' : card.rank}</span>
      <span style="font-size:1.2rem">${card.isJoker ? '★' : card.suit}</span>
    </div>`;
  }).join('');
}

function toggleCardSelection(code) {
  if (!myTurn) return;
  const hand = currentGame.hands[myPlayerId] || [];
  const card = hand.find(c => c.code === code);
  if (!card) return;
  
  const idx = selectedCards.findIndex(c => c.code === code);
  if (idx >= 0) {
    selectedCards.splice(idx, 1);
  } else {
    selectedCards.push(card);
  }
  renderYourHand(currentGame);
  updateDiscardBtn();
}

function updateDiscardBtn() {
  const btn = document.getElementById('btn-discard');
  btn.disabled = !(myTurn && selectedCards.length === 1);
}

function renderScoreboard(game) {
  const row = document.getElementById('score-row');
  const total = game.totalScores || {};
  const melds = game.melds || {};
  
  const order = game.playerOrder || [];
  row.innerHTML = order.map(async pid => {
    const playerSnap = await db.ref(`rooms/${roomCode}/players/${pid}`).once('value');
    const player = playerSnap?.val() || {};
    const isYou = pid === myPlayerId;
    const pts = total[pid] || 0;
    const meldCount = (melds[pid] || []).length;
    return `<div class="score-item ${isYou ? 'highlight' : ''}">
      <div class="sname">${player.name || '??'}</div>
      <div class="spoint" style="color:${isYou?'#ffd700':'#fff'}">${pts}</div>
      <div style="font-size:0.7rem;color:#888">เกิด ${meldCount}</div>
    </div>`;
  }).join('');
}

function renderActionBar(game) {
  const btnDraw = document.getElementById('btn-draw');
  const btnMeld = document.getElementById('btn-meld');
  const btnDiscard = document.getElementById('btn-discard');
  const btnEnd = document.getElementById('btn-end');
  const handStatus = document.getElementById('hand-status');
  
  if (myTurn) {
    const phase = game.phase || 'draw';
    btnDraw.disabled = phase !== 'draw';
    btnMeld.disabled = false;
    btnDiscard.disabled = selectedCards.length !== 1;
    btnEnd.disabled = false;
    handStatus.textContent = phase === 'draw' ? 'จั่วหรือหยิบทิ้ง' : 'เลือกไพ่ทิ้ง หรือเกิด';
  } else {
    btnDraw.disabled = true;
    btnMeld.disabled = true;
    btnDiscard.disabled = true;
    btnEnd.disabled = true;
    handStatus.textContent = 'รอตาคนอื่น...';
  }
}

// ============================================================
// CODE TO CARD conversion
// ============================================================
function codeToCard(code) {
  if (!code) return null;
  if (code === 'JOKER1') return { suit: '🃏', rank: 'JOKER', code: 'JOKER1', isJoker: true };
  if (code === 'JOKER2') return { suit: '🃏', rank: 'JOKER', code: 'JOKER2', isJoker: true };
  if (code === '2♣') return { suit: '♣', rank: '2', code: '2♣', isSpeto: true, spetoPair: 'Q♠' };
  if (code === 'Q♠') return { suit: '♠', rank: 'Q', code: 'Q♠', isSpeto: true, spetoPair: '2♣' };
  
  const suits = ['♠','♥','♦','♣'];
  for (const suit of suits) {
    if (code.endsWith(suit)) {
      const rank = code.slice(0, -1);
      return { suit, rank, code };
    }
  }
  return null;
}

// ============================================================
// END GAME
// ============================================================
async function showEndGame(winnerId, totalScores, roundScores, players) {
  confetti();
  
  const modal = document.getElementById('endgame-modal');
  const table = document.getElementById('endgame-table');
  const winnerName = document.getElementById('winner-name');
  
  const winnerSnap = await db.ref(`rooms/${roomCode}/players/${winnerId}`).once('value');
  const winner = winnerSnap?.val() || {};
  winnerName.textContent = `🏆 ${winner.name || '??'} ชนะ!`;
  
  const order = currentGame?.playerOrder || Object.keys(totalScores || {});
  table.innerHTML = `<tr><th>ผู้เล่น</th><th>แต้มรอบนี้</th><th>รวม</th></tr>`;
  for (const pid of order) {
    const playerSnap = await db.ref(`rooms/${roomCode}/players/${pid}`).once('value');
    const player = playerSnap?.val() || {};
    const isWinner = pid === winnerId;
    const rs = roundScores?.[pid] || 0;
    const ts = totalScores?.[pid] || 0;
    table.innerHTML += `<tr class="${isWinner ? 'winner-row' : ''}">
      <td>${player.isBot ? '🤖' : '👤'} ${player.name || '??'}</td>
      <td>${rs}</td>
      <td>${ts}</td>
    </tr>`;
  }
  
  modal.classList.add('active');
}

async function playAgain() {
  document.getElementById('endgame-modal').classList.remove('active');
  const snap = await db.ref(`rooms/${roomCode}/players').once('value');
  const players = snap.val() || {};
  await initGame(roomCode, players);
}

function goHome() {
  document.getElementById('endgame-modal').classList.remove('active');
  leaveRoom();
}

// ============================================================
// TURN TIMER
// ============================================================
function startTurnTimer() {
  if (turnTimer) clearInterval(turnTimer);
  let remaining = TURN_TIME;
  turnTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(turnTimer);
      if (myTurn) {
        // Auto discard lowest card
        const hand = currentGame?.hands?.[myPlayerId] || [];
        if (hand.length > 0) {
          const sorted = sortHand(hand);
          selectedCards = [sorted[sorted.length - 1]];
          discardSelected();
        }
      }
    }
  }, 1000);
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMeldModal();
  if (e.key === 'Enter') {
    if (gameState === 'lobby') startGame();
  }
});

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  // Check for room code in URL
  const params = new URLSearchParams(window.location.search);
  if (params.has('room')) {
    document.getElementById('join-code').value = params.get('room');
  }
});
