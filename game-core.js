// ============================================================
// 🃏 DUMMY RUMMY — game-core.js
// Revised with correct Supabase v2 Realtime API
// ============================================================

// --- SUPABASE CONFIG ---
const SUPABASE_URL = 'https://dbtlbeymrchodloboymr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRidGxiZXltcmNob2Rsb2JveW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MTIxNTksImV4cCI6MjEwNzA4ODE1OX0.HHqLCDj3_rEAeGQxs-Yz8eX-xJG0VbMbYWIELC6LYbc'; // sb_publishable_m72xxY53a8lHIHplk8jLRg_es5hrjWf
const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- CONSTANTS ---
const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, code: `${rank}${suit}` });
    }
  }
  // สเปโต: 2♣ + Q♠
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

function codeToCard(code) {
  if (!code) return null;
  if (code === 'JOKER1') return { suit: '🃏', rank: 'JOKER', code: 'JOKER1', isJoker: true };
  if (code === 'JOKER2') return { suit: '🃏', rank: 'JOKER', code: 'JOKER2', isJoker: true };
  if (code === '2♣') return { suit: '♣', rank: '2', code: '2♣', isSpeto: true, spetoPair: 'Q♠' };
  if (code === 'Q♠') return { suit: '♠', rank: 'Q', code: 'Q♠', isSpeto: true, spetoPair: '2♣' };
  for (const suit of SUITS) {
    if (code.endsWith(suit)) {
      const rank = code.slice(0, -1);
      return { suit, rank, code };
    }
  }
  return null;
}

function cardsToCodes(cards) {
  return cards.map(c => c.code);
}

function codesToCards(codes) {
  return codes.map(codeToCard).filter(Boolean);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// GAME STATE
// ============================================================
let myPlayerId = null;
let myName = '';
let roomCode = null;
let realtimeChannel = null;
let currentGame = null;
let selectedCards = [];
let myTurn = false;
let turnPlayerId = null;
let turnTimer = null;
const TURN_TIME = 30;

// ============================================================
// UTILITY
// ============================================================
function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
}

function notify(msg) {
  const el = document.getElementById('notification');
  el.textContent = msg;
  el.className = 'notification show';
  setTimeout(() => el.className = 'notification', 3500);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function renderCardSmall(card) {
  if (!card) return '';
  let bg, border, color;
  if (card.isJoker) { bg='linear-gradient(135deg,#ffd700,#ff8f00)'; border='#ffd700'; color='#fff'; }
  else if (card.isSpeto) { bg='#1a1a2e'; border='#ffd700'; color='#ffd700'; }
  else if (card.suit==='♥'||card.suit==='♦') { bg='#fff5f5'; border='#ef9a9a'; color='#c62828'; }
  else { bg='#f5f5ff'; border='#9fa8da'; color='#1a237e'; }
  const rank = card.isJoker ? 'J' : card.rank;
  const suit = card.isJoker ? '★' : card.suit;
  return `<div style="width:46px;height:64px;background:${bg};border:1px solid ${border};color:${color};border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px">
    <span style="font-size:0.7rem;font-weight:700">${rank}</span>
    <span style="font-size:1rem">${suit}</span>
  </div>`;
}

function renderCardEl(card, selectable=true) {
  if (!card) return '';
  let bg, border, color;
  if (card.isJoker) { bg='linear-gradient(135deg,#ffd700,#ff8f00)'; border='#ffd700'; color='#fff'; }
  else if (card.isSpeto) { bg='#1a1a2e'; border='#ffd700'; color='#ffd700'; }
  else if (card.suit==='♥'||card.suit==='♦') { bg='#fff5f5'; border='#ef9a9a'; color='#c62828'; }
  else { bg='#f5f5ff'; border='#9fa8da'; color='#1a237e'; }
  const rank = card.isJoker ? 'J' : card.rank;
  const suit = card.isJoker ? '★' : card.suit;
  const sel = selectedCards.some(c=>c.code===card.code);
  const selStyle = sel ? 'box-shadow:0 0 14px rgba(255,215,0,0.7);transform:translateY(-12px)' : '';
  const cursor = selectable && myTurn ? 'cursor:pointer' : 'cursor:default';
  return `<div class="card-el" data-code="${card.code}" onclick="${selectable&&myTurn?`toggleSelect('${card.code}')`:''}" style="width:60px;height:84px;background:${bg};border:2px solid ${sel?'#ffd700':border};color:${color};border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;transition:all 0.15s;${selStyle};${cursor}">
    <span style="font-size:1rem;font-weight:700">${rank}</span>
    <span style="font-size:1.3rem">${suit}</span>
    ${card.isSpeto?'<span style="font-size:0.5rem;color:#ffd700">สเปโต</span>':''}
    ${card.isJoker?'<span style="font-size:0.5rem;color:#fff">โจ๊กเกอร์</span>':''}
  </div>`;
}

function toggleSelect(code) {
  const hand = currentGame?.hands?.[myPlayerId] || [];
  const card = hand.find(c=>c.code===code);
  if (!card) return;
  const idx = selectedCards.findIndex(c=>c.code===code);
  if (idx>=0) selectedCards.splice(idx,1); else selectedCards.push(card);
  renderYourHand();
  updateActionBtns();
}

function confetti() {
  const c = document.getElementById('confetti');
  c.innerHTML='';
  const colors=['#ffd700','#e94560','#4caf50','#2196f3','#ff9800','#9c27b0'];
  for(let i=0;i<80;i++){
    const p=document.createElement('div');
    p.className='confetti-piece';
    p.style.left=Math.random()*100+'%';
    p.style.background=colors[Math.floor(Math.random()*colors.length)];
    p.style.animationDelay=Math.random()*2+'s';
    c.appendChild(p);
  }
  setTimeout(()=>c.innerHTML='',5000);
}

// ============================================================
// SUPABASE REAL-TIME (v2 API)
// ============================================================
function setupRealtime(roomId) {
  if (realtimeChannel) realtimeChannel.unsubscribe();
  
  realtimeChannel = db.channel(`room-${roomId}`)
    .on('broadcast', { event: 'players_update' }, (payload) => {
      renderLobby(payload.players || {});
    })
    .on('broadcast', { event: 'game_update' }, (payload) => {
      currentGame = payload.game;
      renderGame(payload.game);
    })
    .on('broadcast', { event: 'game_start' }, (payload) => {
      currentGame = payload.game;
      showScreen('game-screen');
    })
    .on('broadcast', { event: 'game_end' }, (payload) => {
      showEndGame(payload);
    })
    .subscribe();
}

async function broadcast(event, data) {
  if (!realtimeChannel || !roomCode) return;
  await realtimeChannel.send({
    type: 'broadcast',
    event,
    payload: data
  });
}

// ============================================================
// HOME SCREEN
// ============================================================
async function createRoom() {
  const name = document.getElementById('create-name').value.trim();
  if (!name) { notify('กรุณาใส่ชื่อ'); return; }
  const botCount = parseInt(document.getElementById('bot-count').value);
  
  roomCode = genRoomCode();
  myName = name;
  myPlayerId = 'p_' + Math.random().toString(36).substr(2,9);
  
  const players = {};
  players[myPlayerId] = { id: myPlayerId, name, isBot: false, isHost: true };
  
  const botNames = ['🤖 บอทซ้าย','🤖 บอทกลาง','🤖 บอทขวา'];
  for (let i = 0; i < botCount; i++) {
    const bid = 'bot_' + i + '_' + Date.now();
    players[bid] = { id: bid, name: botNames[i], isBot: true, isHost: false, botLevel: i };
  }
  
  // Save to Supabase
  const { error } = await db.from('rooms').upsert({
    id: roomCode,
    code: roomCode,
    players,
    status: 'lobby',
    created_at: new Date().toISOString()
  });
  
  if (error) {
    // Try alternative: insert
    const { error: err2 } = await db.from('rooms').insert({
      id: roomCode, code: roomCode, players, status: 'lobby'
    });
  }
  
  showScreen('lobby-screen');
  document.getElementById('display-room-code').textContent = roomCode;
  setupRealtime(roomCode);
  await broadcast('players_update', { players });
  notify('✅ สร้างห้องสำเร็จ!');
  renderLobby(players);
}

async function joinRoom() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  const name = document.getElementById('join-name').value.trim();
  if (!code) { notify('กรุณาใส่รหัสห้อง'); return; }
  if (!name) { notify('กรุณาใส่ชื่อ'); return; }
  
  myName = name;
  myPlayerId = 'p_' + Math.random().toString(36).substr(2,9);
  
  const { data: room, error } = await db.from('rooms').select('*').eq('id', code).single();
  if (error || !room) { notify('❌ ไม่พบห้องนี้'); return; }
  if (room.status === 'playing') { notify('❌ เกมเริ่มแล้ว'); return; }
  
  const players = { ...room.players };
  const count = Object.keys(players).length;
  if (count >= 4) { notify('❌ ห้องเต็มแล้ว'); return; }
  
  players[myPlayerId] = { id: myPlayerId, name, isBot: false, isHost: false };
  
  await db.from('rooms').update({ players }).eq('id', code);
  
  roomCode = code;
  showScreen('lobby-screen');
  document.getElementById('display-room-code').textContent = code;
  setupRealtime(code);
  await broadcast('players_update', { players });
  notify('✅ เข้าห้องสำเร็จ!');
  renderLobby(players);
}

async function leaveRoom() {
  if (!roomCode || !myPlayerId) return;
  const { data: room } = await db.from('rooms').select('players,id').eq('id', roomCode).single();
  if (room) {
    const players = { ...room.players };
    delete players[myPlayerId];
    if (Object.keys(players).length === 0) {
      await db.from('rooms').delete().eq('id', roomCode);
    } else {
      await db.from('rooms').update({ players }).eq('id', roomCode);
    }
  }
  if (realtimeChannel) { realtimeChannel.unsubscribe(); realtimeChannel = null; }
  roomCode = null; myPlayerId = null; currentGame = null;
  showScreen('home-screen');
}

async function startGame() {
  if (!roomCode) return;
  const { data: room } = await db.from('rooms').select('players').eq('id', roomCode).single();
  if (!room) return;
  const players = room.players || {};
  const playerIds = Object.keys(players);
  if (playerIds.length < 2) { notify('ต้องมีอย่างน้อย 2 คน'); return; }
  
  const deck = shuffle(makeDeck());
  const hands = {};
  for (const pid of playerIds) hands[pid] = shuffle(deck.splice(0, 7));
  const discardPile = [deck.pop()];
  
  const gameData = {
    deck: deck.map(c=>c.code),
    hands,
    discardPile: discardPile.map(c=>c.code),
    turnPlayerId: playerIds[0],
    playerOrder: playerIds,
    phase: 'draw',
    status: 'playing',
    melds: Object.fromEntries(playerIds.map(pid=>[pid,[]])),
    scores: Object.fromEntries(playerIds.map(pid=>[pid,0])),
    round: 1,
    turnStartTime: Date.now()
  };
  
  await db.from('rooms').update({ status: 'playing', game: gameData }).eq('id', roomCode);
  await broadcast('game_start', { game: gameData });
  currentGame = gameData;
  showScreen('game-screen');
  renderGame(gameData);
}

// ============================================================
// GAME ACTIONS
// ============================================================
async function drawCard() {
  if (!currentGame || !myTurn || currentGame.phase !== 'draw') return;
  const deck = [...currentGame.deck];
  if (deck.length === 0) { notify('กองจั่วหมดแล้ว!'); return; }
  const drawn = deck.pop();
  const newHands = {...currentGame.hands};
  newHands[myPlayerId] = sortHand([...(newHands[myPlayerId]||[]), drawn]);
  
  const updates = { deck, hands: newHands, phase: 'action', turnStartTime: Date.now() };
  currentGame = { ...currentGame, ...updates };
  await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
  await broadcast('game_update', { game: currentGame });
  notify(`📦 จั่วได้: ${drawn.rank}${drawn.suit}`);
}

async function pickDiscard() {
  if (!currentGame || !myTurn || currentGame.phase !== 'draw') return;
  const discard = [...currentGame.discardPile];
  if (discard.length === 0) return;
  const top = discard.pop();
  const newHands = {...currentGame.hands};
  newHands[myPlayerId] = sortHand([...(newHands[myPlayerId]||[]), top]);
  
  const updates = { hands: newHands, discardPile: discard, phase: 'action', turnStartTime: Date.now() };
  currentGame = { ...currentGame, ...updates };
  await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
  await broadcast('game_update', { game: currentGame });
  notify(`🗑️ หยิบ: ${top.rank}${top.suit}`);
}

async function discardSelected() {
  if (!currentGame || !myTurn || selectedCards.length !== 1) { notify('เลือกไพ่ 1 ใบที่จะทิ้ง'); return; }
  const card = selectedCards[0];
  const hand = [...(currentGame.hands[myPlayerId]||[])];
  const newHand = hand.filter(c=>c.code!==card.code);
  const newDiscard = [...currentGame.discardPile, card.code];
  selectedCards = [];
  
  if (newHand.length === 0) {
    await handleKnockout(myPlayerId);
    return;
  }
  
  const newHands = {...currentGame.hands, [myPlayerId]: newHand};
  const updates = { hands: newHands, discardPile: newDiscard, phase: 'draw' };
  currentGame = { ...currentGame, ...updates };
  await db.from('rooms').update({ game: currentGame }).eq('id', roomCode });
  await advanceTurn();
}

async function advanceTurn() {
  const order = currentGame.playerOrder;
  const idx = order.indexOf(currentGame.turnPlayerId);
  const nextIdx = (idx+1) % order.length;
  const nextPid = order[nextIdx];
  const updates = { turnPlayerId: nextPid, phase: 'draw', turnStartTime: Date.now() };
  currentGame = { ...currentGame, ...updates };
  await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
  await broadcast('game_update', { game: currentGame });
  
  // Check if next is bot
  const { data: room } = await db.from('rooms').select('players').eq('id', roomCode).single();
  const nextPlayer = room?.players?.[nextPid];
  if (nextPlayer?.isBot) setTimeout(()=>botPlay(nextPid), 1200);
}

async function endTurn() {
  if (!currentGame || !myTurn) return;
  if (currentGame.phase === 'draw') { notify('ต้องจั่วหรือหยิบก่อน!'); return; }
  await advanceTurn();
}

async function handleKnockout(koId) {
  const { data: room } = await db.from('rooms').select('*').eq('id', roomCode).single();
  if (!room) return;
  const players = room.players || {};
  const game = currentGame;
  
  const allCodes = {};
  makeDeck().forEach(c=>allCodes[c.code]=c);
  
  const roundScores = {};
  for (const [pid, handCodes] of Object.entries(game.hands)) {
    let pts = 0;
    for (const code of handCodes) {
      const c = allCodes[code];
      if (c) pts += cardPoints(c);
    }
    roundScores[pid] = pts;
  }
  roundScores[koId] = 0;
  
  const prevScores = room.game?.scores || {};
  const totalScores = {};
  for (const pid of game.playerOrder) {
    totalScores[pid] = (prevScores[pid]||0) + (roundScores[pid]||0);
  }
  
  let winner = null;
  for (const [pid, total] of Object.entries(totalScores)) {
    if (total >= 500) {
      let min = Infinity, winPid = null;
      for (const [p, t] of Object.entries(totalScores)) { if (t<min) {min=t; winPid=p;} }
      winner = winPid;
    }
  }
  
  const endData = { winner, roundScores, totalScores, players };
  await broadcast('game_end', endData);
  await db.from('rooms').update({ status: 'ended' }).eq('id', roomCode);
  showEndGame(endData);
}

// ============================================================
// BOT LOGIC
// ============================================================
async function botPlay(botId) {
  if (!currentGame || currentGame.status !== 'playing') return;
  if (currentGame.turnPlayerId !== botId) return;
  
  const handCodes = currentGame.hands[botId] || [];
  let hand = codesToCards(handCodes);
  
  // Draw phase
  const deck = [...currentGame.deck];
  if (deck.length > 0) {
    const drawn = deck.pop();
    hand = sortHand([...hand, drawn]);
    await db.from('rooms').update({ game: { ...currentGame, deck, hands: { ...currentGame.hands, [botId]: hand.map(c=>c.code) }, phase: 'action' } }).eq('id', roomCode);
    await delay(600);
  }
  
  // Discard lowest point card
  if (hand.length > 0) {
    const discard = hand[hand.length-1]; // lowest after sort
    const newHand = hand.filter(c=>c.code!==discard.code);
    const newDiscard = [...currentGame.discardPile, discard.code];
    
    if (newHand.length === 0) {
      await db.from('rooms').update({ game: { ...currentGame, hands: { ...currentGame.hands, [botId]: [] }, discardPile: newDiscard, turnPlayerId: botId } }).eq('id', roomCode);
      await handleKnockout(botId);
      return;
    }
    
    await db.from('rooms').update({ game: { ...currentGame, hands: { ...currentGame.hands, [botId]: newHand.map(c=>c.code) }, discardPile: newDiscard } }).eq('id', roomCode);
    await delay(500);
  }
  
  await advanceTurn();
}

// ============================================================
// MELD
// ============================================================
function findMelds(hand) {
  const melds = [];
  const normals = hand.filter(c=>!c.isJoker&&!c.isSpeto);
  const jokers = hand.filter(c=>c.isJoker);
  
  // SETS
  const byRank = {};
  for (const c of normals) { if (!byRank[c.rank]) byRank[c.rank]=[]; byRank[c.rank].push(c); }
  for (const [rank, cards] of Object.entries(byRank)) {
    if (cards.length >= 3) melds.push({ type:'set', cards });
  }
  // Joker-helped sets
  for (const [rank, cards] of Object.entries(byRank)) {
    if (cards.length === 2 && jokers.length > 0) {
      melds.push({ type:'set', cards:[...cards, jokers.shift()], jokerUsed:true });
    }
  }
  
  // RUNS
  const bySuit = {};
  for (const c of normals) { if (!bySuit[c.suit]) bySuit[c.suit]=[]; bySuit[c.suit].push(c); }
  const rOrd = {'A':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13};
  for (const [suit, cards] of Object.entries(bySuit)) {
    const sorted = cards.slice().sort((a,b)=>rOrd[a.rank]-rOrd[b.rank]);
    let run = [];
    for (let i=0; i<sorted.length; i++) {
      const cur = rOrd[sorted[i].rank];
      const prev = run.length ? rOrd[run[run.length-1].rank] : null;
      if (prev!==null && cur===prev+1) { run.push(sorted[i]); }
      else {
        if (run.length>=3) melds.push({type:'run', cards:[...run], suit});
        run = [sorted[i]];
      }
    }
    if (run.length>=3) melds.push({type:'run', cards:[...run], suit});
  }
  return melds;
}

let selectedMeldIndex = null;
function openMeldModal() {
  if (!currentGame || !myTurn) return;
  selectedMeldIndex = null;
  document.getElementById('meld-modal').classList.add('active');
  document.getElementById('meld-section').style.display = 'block';
  document.getElementById('layoff-section').style.display = 'none';
  document.getElementById('tab-meld').className = 'btn btn-primary';
  document.getElementById('tab-layoff').className = 'btn btn-secondary';
  document.getElementById('btn-confirm-meld').disabled = true;
  renderMeldOptions();
}
function closeMeldModal() { document.getElementById('meld-modal').classList.remove('active'); }

function renderMeldOptions() {
  const handCodes = currentGame.hands[myPlayerId] || [];
  const hand = codesToCards(handCodes);
  const melds = findMelds(hand);
  const container = document.getElementById('meld-section');
  
  if (melds.length === 0) {
    container.innerHTML = '<div style="color:#aaa;text-align:center;padding:20px">ไม่พบชุดไพ่ที่เกิดได้<br><small>ต้องมีไพ่ 3 ใบขึ้นไป</small></div>';
    return;
  }
  
  let html = '<div style="color:#aaa;font-size:0.9rem;margin-bottom:12px">เลือกชุดไพ่ที่จะเกิด:</div><div class="meld-sets">';
  melds.forEach((meld, i) => {
    const cardsHtml = meld.cards.map(c=>renderCardSmall(c)).join('');
    html += `<div class="meld-set" onclick="selectMeld(${i})">${cardsHtml}<div style="width:100%;font-size:0.7rem;color:#888;text-align:center;margin-top:4px">${meld.type==='set'?'ตอง':'เรียง'}${meld.jokerUsed?' (ใช้โจ๊ก)':''}</div></div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

function selectMeld(idx) {
  selectedMeldIndex = idx;
  document.querySelectorAll('.meld-set').forEach((el,i)=>{
    el.style.borderColor = i===idx ? '#ffd700' : '#0f3460';
    el.style.boxShadow = i===idx ? '0 0 12px rgba(255,215,0,0.5)' : 'none';
  });
  document.getElementById('btn-confirm-meld').disabled = false;
}

async function confirmMeld() {
  if (selectedMeldIndex === null) return;
  const handCodes = currentGame.hands[myPlayerId] || [];
  const hand = codesToCards(handCodes);
  const melds = findMelds(hand);
  const meld = melds[selectedMeldIndex];
  if (!meld) return;
  
  const meldedCodes = meld.cards.map(c=>c.code);
  const newHandCodes = handCodes.filter(code=>!meldedCodes.includes(code));
  
  const allMelds = [...(currentGame.melds?.[myPlayerId]||[]), meldedCodes];
  const newHands = { ...currentGame.hands, [myPlayerId]: newHandCodes };
  const newMelds = { ...currentGame.melds, [myPlayerId]: allMelds };
  
  currentGame = { ...currentGame, hands: newHands, melds: newMelds };
  await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
  await broadcast('game_update', { game: currentGame });
  notify(`🃏 เกิด ${meld.type==='set'?'ตอง':'เรียง'}สำเร็จ!`);
  closeMeldModal();
  renderYourHand();
}

// ============================================================
// RENDERING
// ============================================================
async function renderLobby(players) {
  const list = document.getElementById('player-list');
  const btnStart = document.getElementById('btn-start');
  const status = document.getElementById('lobby-status');
  
  const arr = Object.values(players || {});
  list.innerHTML = arr.map(p => {
    const isYou = p.id === myPlayerId;
    return `<div class="player-slot filled ${isYou?'you':''} ${p.isBot?'bot':''}">
      <div class="pemoji">${p.isBot?'🤖':'👤'}</div>
      <div class="pname">${p.name}</div>
      <div class="ptype">${isYou?'(คุณ)':p.isBot?'AI':'ผู้เล่น'}</div>
    </div>`;
  }).join('');
  
  for (let i = arr.length; i < 4; i++) {
    list.innerHTML += `<div class="player-slot"><div class="pemoji">❓</div><div class="pname">รอผู้เล่น...</div><div class="ptype">เหลือ ${4-i} คน</div></div>`;
  }
  
  const humanCount = arr.filter(p=>!p.isBot).length;
  btnStart.style.display = humanCount >= 1 ? 'block' : 'none';
  status.style.display = 'none';
}

async function renderGame(game) {
  if (!game) return;
  turnPlayerId = game.turnPlayerId;
  myTurn = turnPlayerId === myPlayerId;
  
  document.getElementById('turn-indicator').textContent = myTurn ? '🎯 ตาของคุณ!' : '⏳ รอ...';
  document.getElementById('round-info').textContent = `รอบ: ${game.round||1} | ทิ้ง: ${game.discardPile?.length||0}`;
  
  await renderOpponents(game);
  renderDiscardPile(game);
  renderYourHand();
  renderScoreboard(game);
  updateActionBtns();
}

async function renderOpponents(game) {
  const container = document.getElementById('opponents-row');
  container.innerHTML = '';
  const { data: room } = await db.from('rooms').select('players').eq('id', roomCode).single();
  const players = room?.players || {};
  
  for (const pid of game.playerOrder) {
    if (pid === myPlayerId) continue;
    const handSize = (game.hands?.[pid]||[]).length;
    const isActive = game.turnPlayerId === pid;
    const p = players[pid] || {};
    container.innerHTML += `<div class="opponent-card ${isActive?'active-turn':''}">
      <div style="font-size:1.2rem">${p.isBot?'🤖':'👤'}</div>
      <div class="oname">${p.name||'??'}</div>
      <div class="ocard-count">${handSize} ใบ</div>
    </div>`;
  }
}

function renderDiscardPile(game) {
  const pile = document.getElementById('discard-pile');
  const discard = game.discardPile || [];
  if (discard.length === 0) { pile.innerHTML = ''; return; }
  const topCard = codeToCard(discard[discard.length-1]);
  pile.innerHTML = `<div style="width:80px;height:112px;border-radius:8px;overflow:hidden;border:2px solid ${topCard?.isJoker?'#ffd700':topCard?.suit==='♥'||topCard?.suit==='♦'?'#ef9a9a':'#9fa8da'};background:${topCard?.isJoker?'linear-gradient(135deg,#ffd700,#ff8f00)':topCard?.suit==='♥'||topCard?.suit==='♦'?'#fff5f5':'#f5f5ff'};color:${topCard?.isJoker?'#fff':topCard?.suit==='♥'||topCard?.suit==='♦'?'#c62828':'#1a237e'};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">
    <span style="font-size:1.1rem;font-weight:700">${topCard?.isJoker?'J':topCard?.rank}</span>
    <span style="font-size:1.4rem">${topCard?.isJoker?'★':topCard?.suit}</span>
  </div>`;
}

function renderYourHand() {
  const container = document.getElementById('your-hand');
  const handCodes = currentGame?.hands?.[myPlayerId] || [];
  const hand = codesToCards(handCodes);
  const sorted = sortHand(hand);
  container.innerHTML = sorted.map(c => renderCardEl(c, true)).join('');
}

function renderScoreboard(game) {
  const row = document.getElementById('score-row');
  const { data: room } = await db.from('rooms').select('players').eq('id', roomCode).single();
  const players = room?.players || {};
  const scores = game?.scores || {};
  const melds = game?.melds || {};
  
  row.innerHTML = (game.playerOrder||[]).map(pid => {
    const p = players[pid]||{};
    const isYou = pid===myPlayerId;
    const pts = scores[pid]||0;
    const meldCount = (melds[pid]||[]).length;
    return `<div class="score-item ${isYou?'highlight':''}">
      <div class="sname">${p.name||'??'}</div>
      <div class="spoint" style="color:${isYou?'#ffd700':'#fff'}">${pts}</div>
      <div style="font-size:0.7rem;color:#888">เกิด ${meldCount}</div>
    </div>`;
  }).join('');
}

function updateActionBtns() {
  const btnDraw = document.getElementById('btn-draw');
  const btnMeld = document.getElementById('btn-meld');
  const btnDiscard = document.getElementById('btn-discard');
  const btnEnd = document.getElementById('btn-end');
  const handStatus = document.getElementById('hand-status');
  
  if (myTurn && currentGame) {
    const phase = currentGame.phase || 'draw';
    btnDraw.disabled = phase !== 'draw';
    btnMeld.disabled = false;
    btnDiscard.disabled = selectedCards.length !== 1;
    btnEnd.disabled = phase === 'draw';
    handStatus.textContent = phase === 'draw' ? '📦 จั่วหรือหยิบทิ้ง' : '🃏 เลือกไพ่ทิ้ง หรือเกิด';
  } else {
    btnDraw.disabled = btnMeld.disabled = btnDiscard.disabled = btnEnd.disabled = true;
    handStatus.textContent = '⏳ รอตาคนอื่น...';
  }
}

// ============================================================
// END GAME
// ============================================================
function showEndGame(data) {
  confetti();
  const { winner, roundScores, totalScores, players } = data;
  const modal = document.getElementById('endgame-modal');
  const table = document.getElementById('endgame-table');
  document.getElementById('winner-name').textContent = `🏆 ${players?.[winner]?.name||'??'} ชนะ!`;
  
  table.innerHTML = '<tr><th>ผู้เล่น</th><th>แต้มรอบ</th><th>รวม</th></tr>';
  for (const [pid, total] of Object.entries(totalScores||{})) {
    const p = players?.[pid]||{};
    const rs = roundScores?.[pid]||0;
    table.innerHTML += `<tr class="${pid===winner?'winner-row':''}">
      <td>${p.isBot?'🤖':'👤'} ${p.name||'??'}</td><td>${rs}</td><td>${total}</td>
    </tr>`;
  }
  modal.classList.add('active');
}

async function playAgain() {
  document.getElementById('endgame-modal').classList.remove('active');
  const { data: room } = await db.from('rooms').select('players').eq('id', roomCode).single();
  if (room) {
    const players = room.players || {};
    const pids = Object.keys(players);
    if (pids.length >= 2) {
      const deck = shuffle(makeDeck());
      const hands = {};
      for (const pid of pids) hands[pid] = shuffle(deck.splice(0,7)).map(c=>c.code);
      const gameData = {
        deck: deck.map(c=>c.code), hands,
        discardPile: [deck.pop().code],
        turnPlayerId: pids[0], playerOrder: pids,
        phase:'draw', status:'playing',
        melds: Object.fromEntries(pids.map(p=>[p,[]])),
        scores: Object.fromEntries(pids.map(p=>[p,0])),
        round: (currentGame?.round||1)+1,
        turnStartTime: Date.now()
      };
      await db.from('rooms').update({ status:'playing', game:gameData }).eq('id', roomCode);
      currentGame = gameData;
      await broadcast('game_start', { game: gameData });
      showScreen('game-screen');
      renderGame(gameData);
    }
  }
}

function goHome() {
  document.getElementById('endgame-modal').classList.remove('active');
  leaveRoom();
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('room')) {
    document.getElementById('join-code').value = params.get('room');
  }
});
