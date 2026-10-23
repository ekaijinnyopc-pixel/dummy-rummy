// ============================================================
// 🃏 DUMMY RUMMY — game-core.js v33
// - hotfix: เปลี่ยน select('*') → explicit columns เพื่อหลีก schema cache 406 error
// - รอพี่เอรัน SQL schema เพิ่ม column
// ============================================================

const SUPABASE_URL = 'https://dbtlbeymrchodloboymr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRidGxiZXltcmNob2Rsb2JveW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MTIxNTksImV4cCI6MjEwNzA4ODE1OX0.HHqLCDj3_rEAeGQxs-Yz8eX-xJG0VbMbYWIELC6LYbc';

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
  var spetos  = hand.filter(function(c){ return isSpeto(c); });

  // SETS (ตอง) — FIX v39: สเปโตเข้าชุดกองไพ่หน้าเดียวกันได้ (2♣ → กอง 2, Q♠ → กอง Q)
  // แต่เข้าชุดเรียง (run) ไม่ได้
  var byRank = {};
  for (var ni = 0; ni < normals.length; ni++) {
    if (!byRank[normals[ni].rank]) byRank[normals[ni].rank] = [];
    byRank[normals[ni].rank].push(normals[ni]);
  }
  for (var spi = 0; spi < spetos.length; spi++) {
    var spc = spetos[spi];
    if (!byRank[spc.rank]) byRank[spc.rank] = [];
    byRank[spc.rank].push(spc);
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
// Returns array of { layoffCard, meldIndex, targetPid, meldType }
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
        // FIX v39: สเปโตฝากได้เฉพาะลงชุดกองไพ่หน้าเดียวกัน (ตอง) เท่านั้น ห้ามฝากลงชุดเรียง
        if (isSpeto(hCard) && meldType !== 'ตอง') continue;

        if (meldType === 'ตอง') {
          // Same rank as existing set
          if (hCard.rank === meldCards[0].rank && hCard.suit !== meldCards[0].suit) {
            // Check not already in meld
            var alreadyIn = meldCodes.some(function(c){ return codeToCard(c).suit === hCard.suit; });
            if (!alreadyIn) results.push({ layoffCard: hCard.code, meldIndex: mi, targetPid: pid, meldType: meldType });
          }
        } else if (meldType === 'เรียง') {
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
            results.push({ layoffCard: hCard.code, meldIndex: mi, targetPid: pid, meldType: meldType });
          }
        }
      }
    }
  }
  return results;
}

// ===== FIX v39: สูตรกลางคำนวณคะแนน (ใช้ร่วมกันทุกทาง: มนุษย์/บอท/หน้าจบเกม) =====
function computeRoundScoresFor(game, koId) {
  var res = { roundScores: {}, totalScores: {}, breakdown: {}, winner: null, knockBonus: 0 };
  if (!game || !game.hands) return res;
  var penalty = game.spettoPenalty || {};
  var players = game.playerOrder || Object.keys(game.hands);
  for (var i = 0; i < players.length; i++) {
    var pid = players[i];
    var meldPts = 0, meldCards = [];
    var melds = (game.melds && game.melds[pid]) ? game.melds[pid] : [];
    for (var mi = 0; mi < melds.length; mi++) {
      var mc = Array.isArray(melds[mi]) ? melds[mi] : (melds[mi].cards || []);
      for (var ci = 0; ci < mc.length; ci++) { var c = codeToCard(mc[ci]); if (c) { meldPts += cardPoints(c); meldCards.push(mc[ci]); } }
    }
    var handPts = 0, handCards = [];
    var hc = game.hands[pid] || [];
    for (var hi = 0; hi < hc.length; hi++) { var c2 = codeToCard(hc[hi]); if (c2) { handPts += cardPoints(c2); handCards.push(hc[hi]); } }
    var isKo = (pid === koId);
    var hasMeld = !!(game.hasFirstMeld && game.hasFirstMeld[pid]);
    // ผู้น็อคที่เหลือ 0 ใบ = ไม่มีแต้มมือ / เหลือ 1 ใบ = นับเป็นแต้มมือ (×2 ถ้ายังไม่เกิดแรก)
    if (isKo && hc.length === 0) handPts = 0;
    if (!hasMeld) handPts = handPts * 2;
    var bonus = 0, knockBonus = 0;
    if (isKo) {
      knockBonus = hasMeld ? 50 : 100;
      bonus += knockBonus;
      if (game.headPoints) bonus += game.headPoints;
      res.knockBonus = knockBonus;
    }
    var pen = penalty[pid] || 0;
    var round = meldPts - handPts + bonus - pen;
    res.roundScores[pid] = round;
    res.breakdown[pid] = {
      meld: meldPts, meldCards: meldCards,
      hand: handPts, handCards: handCards,
      bonus: bonus, knockBonus: knockBonus, isKnock: isKo,
      penalty: pen, round: round
    };
  }
  var prev = game.scores || {};
  for (var pi = 0; pi < players.length; pi++) {
    var tpid = players[pi];
    res.totalScores[tpid] = (prev[tpid] || 0) + (res.roundScores[tpid] || 0);
  }
  // ผู้ชนะ: ถ้ามีใครสะสมถึง 500 แต้ม → คนที่สะสมน้อยที่สุดชนะ
  for (var wid in res.totalScores) {
    if (res.totalScores[wid] >= 500) {
      var min = Infinity, winPid = null;
      for (var w2 in res.totalScores) { if (res.totalScores[w2] < min) { min = res.totalScores[w2]; winPid = w2; } }
      res.winner = winPid; break;
    }
  }
  return res;
}

// ===== FIX v39: จบรอบฝั่ง client (รองรับน็อคตอนเหลือไพ่ 1 ใบ ที่ server เดิมตอบ HAND_NOT_EMPTY) =====
async function finishRoundClientSide(koId, attempt) {
  attempt = attempt || 0;
  try {
    var rowRes = await db.from('rooms').select('id,code,players,game,version').eq('id', roomCode).single();
    if (rowRes.error || !rowRes.data || !rowRes.data.game) return null;
    var row = rowRes.data;
    var g = row.game;
    var rowVer = row.version || 0;
    var ver = Math.max(rowVer, g.version || 0);
    var calc = computeRoundScoresFor(g, koId);
    var ng = JSON.parse(JSON.stringify(g));
    ng.status = 'ended';
    ng.knockPlayerId = koId;
    ng.roundScores = calc.roundScores;
    ng.totalScores = calc.totalScores;
    ng.scores = calc.totalScores;   // ยอดสะสมข้ามรอบ
    ng.winner = calc.winner;
    ng.version = ver + 1;
    var upd = await db.from('rooms')
      .update({ status: 'ended', game: ng, version: ng.version })
      .eq('id', roomCode)
      .eq('version', rowVer)
      .select('version');
    if (upd.error || !upd.data || upd.data.length === 0) {
      if (attempt < 2) { await delay(250); return finishRoundClientSide(koId, attempt + 1); }
      console.warn('[FINISH] version conflict → resync');
      await resyncGame();
      return null;
    }
    currentGame = ng;
    currentRoomVersion = ng.version;
    return {
      winner: calc.winner,
      totalScores: calc.totalScores,
      roundScores: calc.roundScores,
      players: row.players || {},
      knockId: koId,
      knockBonus: calc.knockBonus
    };
  } catch(e) { console.error('finishRoundClientSide error:', e); return null; }
}

// --- GAME STATE ---
var myPlayerId = null; var totalPlayers = 4;
var myName = '';
var roomCode = null;
var realtimeChannel = null;
var currentGame = null;
var currentRoomVersion = 0; // rooms.version — แยกจาก currentGame เพราะ version อยู่ที่ row level ไม่ใช่ใน game JSONB
// Helper: deep-copy currentGame and apply patch, so JSON.stringify comparison always detects changes
function setGame(patch) { var ng = JSON.parse(JSON.stringify(currentGame)); Object.assign(ng, patch); currentGame = ng; }

// --- RPC PLAY TURN: all game actions go through this atomic function ---
// Returns {ok, game, error, ...} from PostgreSQL play_turn()
// Pass explicit `playerId` when called from botPlay; otherwise uses myPlayerId
async function rpcPlayTurn(action, opts) {
  opts = opts || {};
  var version = currentRoomVersion || 1;
  var playerId = opts.playerId || myPlayerId;
  var payload = {
    p_game_id:          roomCode,
    p_player_id:        playerId,
    p_action:           action,
    p_card_code:        opts.cardCode     != null ? opts.cardCode     : null,
    p_discard_index:   opts.discardIndex != null ? opts.discardIndex : null,
    p_meld_codes:       opts.meldCodes    != null ? opts.meldCodes    : null,
    p_target_pid:       opts.targetPid    != null ? opts.targetPid    : null,
    p_target_meld_idx:  opts.targetMeldIdx != null ? opts.targetMeldIdx : null,
    p_expected_version: version
  };
  try {
    var result = await db.rpc('play_turn', payload);
    if (result.error) {
      console.warn('[RPC]', action, 'error:', result.error.message);
      if (result.error.message === 'VERSION_MISMATCH' ||
          (result.error.details && result.error.details.includes('version'))) {
        notify('❌ มีคนเล่นไปแล้ว! กำลังโหลดใหม่...');
        // Force resync
        var fresh = await db.from('rooms').select('id,code,players,game,status,version,totalplayers').eq('id', roomCode).single();
        if (fresh.data && fresh.data.game) {
          currentGame = fresh.data.game;
          currentRoomVersion = fresh.data.version || currentRoomVersion;
          renderGame(currentGame);
        }
      }
      return null;
    }
    var data = result.data;
    if (!data || !data.ok) {
      console.warn('[RPC]', action, 'failed:', data ? data.error : 'unknown');
      if (data && data.error === 'NOT_YOUR_TURN') {
        notify('ไม่ใช่ตาของคุณ!');
      } else if (data && data.error === 'MUST_DISCARD') {
        notify('❌ ต้องทิ้งไพ่ 1 ใบก่อนจบตา!');
      }
      return null;
    }
    // Update currentGame from server response
    if (data.game) {
      currentGame = data.game;
      currentRoomVersion = (data.game.version || currentRoomVersion + 1);
      await db.from('rooms').update({ game: currentGame, version: currentRoomVersion }).eq('id', roomCode);
    }
    return data;
  } catch(e) {
    console.error('[RPC]', action, 'exception:', e.message);
    return null;
  }
}
// ============================================================
// FIX v36 — หยิบไพ่จากกองทิ้ง (atomic ฝั่ง client)
// ปัญหา: RPC play_turn PICK_DISCARD ที่ deploy อยู่ใช้โค้ดเก่า ซึ่ง
//   "เอาไพ่ที่เหลือในกองทิ้ง" ไปใส่มือ แทนที่จะใส่ "ไพ่ที่หยิบ"
//   → ไพ่ที่หยิบหายจากเกม, มือได้ไพ่ผิดใบ → เกิดไม่ได้ + กองทิ้งหาย
// แก้: ทำ PICK_DISCARD เองฝั่ง client แบบ atomic พร้อม optimistic lock
//   (อัปเดตแบบมีเงื่อนไข version → กันเขียนทับข้อมูลผู้เล่นอื่น)
// ============================================================
async function resyncGame() {
  try {
    var r = await db.from('rooms').select('id,code,game,version').eq('id', roomCode).single();
    if (r.data && r.data.game) {
      currentGame = r.data.game;
      currentRoomVersion = r.data.version || (r.data.game.version || currentRoomVersion);
      renderGame(currentGame);
    }
  } catch(e) { console.warn('resyncGame error:', e.message); }
}

// หยิบไพ่จากกองทิ้ง: ย้ายไพ่ที่หยิบ (ตั้งแต่ใบนี้ขึ้นไป) เข้ามือ + ตัดกองทิ้งที่เหลือ
// คืน {ok, game, taken} หรือ null (มีคนเล่นไปแล้ว)
async function pickDiscardClientSide(idx, pid) {
  try {
    var rowRes = await db.from('rooms').select('id,game,version').eq('id', roomCode).single();
    if (rowRes.error || !rowRes.data || !rowRes.data.game) { console.warn('[PICK] อ่านห้องไม่ได้'); return null; }
    var g = rowRes.data.game;
    var rowVer = rowRes.data.version || 0;
    var gameVer = g.version || 0;
    var ver = Math.max(rowVer, gameVer);
    var discard = g.discardPile || [];
    if (discard.length === 0 || idx < 0 || idx >= discard.length) return null;
    // เทียบเท่า NOT_YOUR_TURN / phase ของ server
    if (g.turnPlayerId && g.turnPlayerId !== pid) { console.warn('[PICK] ไม่ใช่ตาของผู้เล่นนี้'); return null; }
    if (g.phase && g.phase !== 'draw') { console.warn('[PICK] เฟสไม่ใช่ draw'); return null; }

    var taken = discard.slice(idx);        // ไพ่ที่หยิบ + ทุกใบที่อยู่บน
    var remaining = discard.slice(0, idx);  // ไพ่ที่เหลือในกองทิ้ง (ไม่หาย!)

    var ng = JSON.parse(JSON.stringify(g));
    ng.hands = ng.hands || {};
    var hand = (ng.hands[pid] || []).slice();
    ng.hands[pid] = hand.concat(taken);
    ng.discardPile = remaining;
    ng.pickedFromDiscard = ng.pickedFromDiscard || {};
    ng.pickedFromDiscard[pid] = taken;
    ng.phase = 'action';
    // FIX v37: หยิบสเปโตไม่หักแต้มทันที
    // กติกาจริง: โทษ -100 เกิดเมื่อ "นำสเปโตไปอยู่ในชุดเกิด/ฝาก" เท่านั้น
    // (ทิ้งสเปโตลอย ๆ โดยยังไม่มีใครเก็บไปเกิด → ยังไม่เสียแต้ม)
    var hasSpeto = taken.some(function(c){ return c === '2♣' || c === 'Q♠'; });
    var speto = hasSpeto ? 1 : 0;
    ng.version = ver + 1;

    var upd = await db.from('rooms')
      .update({ game: ng, version: ng.version })
      .eq('id', roomCode)
      .eq('version', rowVer)                // ← optimistic lock: เขียนได้ก็ต่อเมื่อยังเป็นเวอร์ชันเดิม
      .select('version');
    if (upd.error || !upd.data || upd.data.length === 0) {
      console.warn('[PICK] version conflict → resync');
      await resyncGame();
      return null;
    }
    currentGame = ng;
    currentRoomVersion = ng.version;
    return { ok: true, game: ng, taken: taken, speto: speto };
  } catch(e) { console.error('pickDiscardClientSide error:', e); return null; }
}

// ล้างธง "ไพ่ที่หยิบ" ของผู้เล่น (หลังเกิดแล้ว หรือ คืนไพ่แล้ว)
// server เวอร์ชันเก่าไม่ล้าง pickedFromDiscard ให้ → ต้องล้างเอง
// มี retry เพราะถ้าเขียนไม่สำเร็จ (version conflict) ผู้เล่นจะค้างที่ "ต้องเกิดก่อน"
async function clearPickedFlag(pid, attempt) {
  attempt = attempt || 0;
  try {
    var rowRes = await db.from('rooms').select('id,game,version').eq('id', roomCode).single();
    if (rowRes.error || !rowRes.data || !rowRes.data.game) return false;
    var g = rowRes.data.game;
    var rowVer = rowRes.data.version || 0;
    var ver = Math.max(rowVer, g.version || 0);
    var pfd = g.pickedFromDiscard || {};
    if (!pfd[pid] || pfd[pid].length === 0) return true;
    var ng = JSON.parse(JSON.stringify(g));
    ng.pickedFromDiscard = ng.pickedFromDiscard || {};
    ng.pickedFromDiscard[pid] = [];
    ng.version = ver + 1;
    var upd = await db.from('rooms')
      .update({ game: ng, version: ng.version })
      .eq('id', roomCode)
      .eq('version', rowVer)
      .select('version');
    if (upd.error || !upd.data || upd.data.length === 0) {
      // version ชน → อ่านใหม่แล้วลองอีกรอบ (สูงสุด 3 ครั้ง)
      if (attempt < 2) { await delay(150); return clearPickedFlag(pid, attempt + 1); }
      await resyncGame();
      return false;
    }
    currentGame = ng;
    currentRoomVersion = ng.version;
    return true;
  } catch(e) { console.error('clearPickedFlag error:', e); return false; }
}

// ============================================================
// FIX v39 — โทษสเปโต (2♣ / Q♠)
// กติกา: หัก 100 แต้มเมื่อสเปโตถูก "ใช้" (นำไปเกิดในชุด หรือฝาก)
//   - ทิ้งสเปโตลอย ๆ (ยังไม่มีใครหยิบไปใช้)  → ยังไม่เสียแต้ม
//   - สเปโตที่ถูกทิ้ง แล้วมีคนหยิบไปเกิด        → คนที่ทิ้งเป็นผู้เสียแต้ม
//   - สเปโตในมือตัวเองถูกนำไปเกิด/ฝาก          → คนที่นำไปใช้เป็นผู้เสียแต้ม
// เก็บผลไว้ที่: game.spetoOrigin = { '2♣': playerId } และ game.spettoPenalty = { playerId: 100*n }
// (client เป็นเจ้าของโทษฝั่งเดียว → ไม่หักซ้ำกับ server)
// ============================================================
function isSpetoCode(code) { return code === '2♣' || code === 'Q♠'; }

// จดจำว่าใครเป็นคนทิ้งสเปโตใบนี้ (เผื่อมีคนหยิบไปเกิด → คนทิ้งเสียแต้ม)
async function markSpetoDiscarded(pid, code, attempt) {
  attempt = attempt || 0;
  if (!isSpetoCode(code)) return false;
  try {
    var rowRes = await db.from('rooms').select('id,game,version').eq('id', roomCode).single();
    if (rowRes.error || !rowRes.data || !rowRes.data.game) return false;
    var g = rowRes.data.game;
    var rowVer = rowRes.data.version || 0;
    var ver = Math.max(rowVer, g.version || 0);
    var ng = JSON.parse(JSON.stringify(g));
    ng.spetoOrigin = ng.spetoOrigin || {};
    ng.spetoOrigin[code] = pid;
    ng.version = ver + 1;
    var upd = await db.from('rooms')
      .update({ game: ng, version: ng.version })
      .eq('id', roomCode)
      .eq('version', rowVer)
      .select('version');
    if (upd.error || !upd.data || upd.data.length === 0) {
      if (attempt < 2) { await delay(150); return markSpetoDiscarded(pid, code, attempt + 1); }
      await resyncGame();
      return false;
    }
    currentGame = ng;
    currentRoomVersion = ng.version;
    return true;
  } catch(e) { console.error('markSpetoDiscarded error:', e); return false; }
}

// หักโทษสเปโต -100 ให้ผู้ที่ "ใช้" สเปโต (เกิด/ฝาก) หรือผู้ที่ทิ้งมันไว้ให้คนอื่นหยิบไปเกิด
async function applySpetoPenalty(pid, codes, attempt) {
  attempt = attempt || 0;
  var spetos = (codes || []).filter(isSpetoCode);
  if (spetos.length === 0) return false;
  try {
    var rowRes = await db.from('rooms').select('id,game,version').eq('id', roomCode).single();
    if (rowRes.error || !rowRes.data || !rowRes.data.game) return false;
    var g = rowRes.data.game;
    var rowVer = rowRes.data.version || 0;
    var ver = Math.max(rowVer, g.version || 0);
    var ng = JSON.parse(JSON.stringify(g));
    ng.spetoOrigin = ng.spetoOrigin || {};
    ng.spettoPenalty = ng.spettoPenalty || {};
    var loserSet = {};
    for (var i = 0; i < spetos.length; i++) {
      var code = spetos[i];
      var origin = ng.spetoOrigin[code] || null;
      var loser = origin || pid;          // ถ้าไม่มีคนทิ้ง → คนที่นำไปใช้เสีย
      loserSet[loser] = (loserSet[loser] || 0) + 100;
      delete ng.spetoOrigin[code];        // กันหักซ้ำ
    }
    var changed = false;
    for (var l in loserSet) {
      ng.spettoPenalty[l] = (ng.spettoPenalty[l] || 0) + loserSet[l];
      changed = true;
    }
    if (!changed) return false;
    ng.version = ver + 1;
    var upd = await db.from('rooms')
      .update({ game: ng, version: ng.version })
      .eq('id', roomCode)
      .eq('version', rowVer)
      .select('version');
    if (upd.error || !upd.data || upd.data.length === 0) {
      if (attempt < 2) { await delay(150); return applySpetoPenalty(pid, codes, attempt + 1); }
      await resyncGame();
      return false;
    }
    currentGame = ng;
    currentRoomVersion = ng.version;
    return true;
  } catch(e) { console.error('applySpetoPenalty error:', e); return false; }
}

// คืนไพ่ที่หยิบกลับกองทิ้ง (กันผู้เล่นค้าง ถ้าไม่มีชุดเกิด)
async function returnPickedCardsFor(pid) {
  try {
    var taken = (currentGame && currentGame.pickedFromDiscard && currentGame.pickedFromDiscard[pid]) ? currentGame.pickedFromDiscard[pid].slice() : [];
    if (taken.length === 0) return false;
    var rowRes = await db.from('rooms').select('id,game,version').eq('id', roomCode).single();
    if (rowRes.error || !rowRes.data || !rowRes.data.game) return false;
    var g = rowRes.data.game;
    var rowVer = rowRes.data.version || 0;
    var ver = Math.max(rowVer, g.version || 0);
    var ng = JSON.parse(JSON.stringify(g));

    // FIX v36: คืนเฉพาะไพ่ที่ "ยังอยู่บนมือ" เท่านั้น
    // (ถ้าเกิดไปแล้วไพ่นั้นไม่อยู่บนมืออีก → ห้ามย้ายกลับมา จะได้ไพ่ซ้ำในเกม)
    var handNow = (ng.hands && ng.hands[pid]) ? ng.hands[pid] : [];
    var toReturn = taken.filter(function(c){ return handNow.indexOf(c) >= 0; });
    if (toReturn.length === 0) {
      // ไพ่ที่หยิบถูกเกิดไปหมดแล้ว → ล้างธงเฉยๆ (ไม่ต้องคืนไพ่)
      ng.pickedFromDiscard = ng.pickedFromDiscard || {};
      ng.pickedFromDiscard[pid] = [];
      ng.version = ver + 1;
      var upd0 = await db.from('rooms')
        .update({ game: ng, version: ng.version })
        .eq('id', roomCode)
        .eq('version', rowVer)
        .select('version');
      if (upd0.error || !upd0.data || upd0.data.length === 0) { await resyncGame(); return false; }
      currentGame = ng;
      currentRoomVersion = ng.version;
      return true;
    }

    ng.hands[pid] = handNow.filter(function(c){ return toReturn.indexOf(c) === -1; });
    ng.discardPile = (ng.discardPile || []).concat(toReturn);
    ng.pickedFromDiscard = ng.pickedFromDiscard || {};
    ng.pickedFromDiscard[pid] = [];
    ng.phase = 'action';
    ng.version = ver + 1;
    var upd = await db.from('rooms')
      .update({ game: ng, version: ng.version })
      .eq('id', roomCode)
      .eq('version', rowVer)
      .select('version');
    if (upd.error || !upd.data || upd.data.length === 0) { await resyncGame(); return false; }
    currentGame = ng;
    currentRoomVersion = ng.version;
    return true;
  } catch(e) { console.error('returnPickedCardsFor error:', e); return false; }
}

// ธงหยิบใน DB "ค้างเปล่า"? (ไพ่ที่หยิบไม่อยู่บนมือแล้ว = เกิดไปแล้ว หรือ state เพี้ยน)
// ถ้าค้าง → ต้องล้าง ไม่งั้น (ถ้าพี่เอรัน SQL fix ทีหลัง) server จะบล็อกการทิ้งไพ่
// ด้วย MUST_MELD_PICKED ตลอดไป → ผู้เล่นเล่นต่อไม่ได้
function hasStalePickedFlag(pid) {
  try {
    var g = window._currentGame || currentGame;
    if (!g) return false;
    var flags = (g.pickedFromDiscard && g.pickedFromDiscard[pid]) || [];
    if (!flags.length) return false;
    var hand = (g.hands && g.hands[pid]) || [];
    for (var i = 0; i < flags.length; i++) {
      if (hand.indexOf(flags[i]) < 0) return true;
    }
    return false;
  } catch(e) { return false; }
}

var _cleaningStaleFlag = false;
async function autoCleanStalePickedFlag() {
  if (_cleaningStaleFlag) return;
  if (!hasStalePickedFlag(myPlayerId)) return;
  _cleaningStaleFlag = true;
  try {
    console.warn('[PICK] พบธงหยิบค้าง (ไพ่ไม่อยู่บนมือ) → ล้างให้อัตโนมัติ');
    await clearPickedFlag(myPlayerId);
  } catch(e) { /* ignore */ }
  _cleaningStaleFlag = false;
}

async function returnPickedCards() {
  try {
    var pid = myPlayerId;
    var taken = myPickedCodes();
    if (taken.length === 0) {
      // ไม่มีไพ่ที่หยิบอยู่บนมือ → ถ้าธงใน DB ค้างอยู่ให้ล้างทิ้ง
      if (hasStalePickedFlag(pid)) { await clearPickedFlag(pid); }
      pendingPickedCodes = []; closeMeldModal(); renderYourHand(); updateActionBtns(); return;
    }
    var ok = await returnPickedCardsFor(pid);
    if (!ok) { notify('❌ คืนไพ่ไม่สำเร็จ ลองใหม่'); return; }
    pendingPickedCodes = [];
    closeMeldModal();
    renderYourHand();
    updateActionBtns();
    notify('↩️ คืนไพ่ที่หยิบกลับกองทิ้งแล้ว');
  } catch(e) { console.error('returnPickedCards error:', e); }
}

var selectedCards = [];
var myHandOrder = null;   // ลำดับการแสดงไพ่ (ปุ่มจัดไพ่อัตโนมัติ)
var roomLevel = 1;          // ระดับห้อง (0.5 / 0.75 / 1 / 3) — เก็บใน game JSONB
var myTurn = false;
var hasDiscardedThisTurn = false;  // ต้องทิ้งไพ่ 1 ใบก่อนจบตา (บังคับจาก server ด้วย)
var pendingPickedCodes = [];   // codes picked from discard this turn (must meld)
var layoffTargets = [];        // valid layoff options found for current hand
var pollInterval = null;
var currentLobbyPlayers = null; // last-seen lobby players from polling (for diff render)
var botRunning = {};           // prevent double-bot: pid -> true while bot is playing
var turnTimerInterval = null;
var PLAYER_TIMEOUT = 120000;    // 120s per turn (any action resets)
var playerTimeLeft = 120;       // seconds remaining
var modalOpen = false;          // pause timer while modal is open
var turnPhase = null;           // track current phase for timer

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

// --- PLAYER TURN TIMER: 120s total, resets on any action ---
var TIMER_MAX = 120;
var TIMER_CIRC = 119.4; // 2*PI*19

function updateTimerRing() {
  try {
    var ring = document.getElementById('timer-ring');
    var arc = document.getElementById('timer-arc');
    var txt = document.getElementById('timer-text');
    if (!ring || !arc || !txt) return;
    var left = Math.max(0, playerTimeLeft);
    // เต็มวง = เวลาเต็ม, ว่าง = หมดเวลา
    arc.style.strokeDashoffset = String(TIMER_CIRC * (1 - (left / TIMER_MAX)));
    txt.textContent = left > 0 ? String(left) : '0';
    ring.classList.remove('warn', 'crit');
    if (left <= 10) ring.classList.add('crit');
    else if (left <= 30) ring.classList.add('warn');
  } catch(e) {}
}

function startPlayerTimer() {
  stopPlayerTimer();
  playerTimeLeft = TIMER_MAX;
  updateTimerRing();
  turnTimerInterval = setInterval(function() {
    if (modalOpen) return; // pause while modal open
    playerTimeLeft--;
    updateTimerRing();
    var ti = document.getElementById('turn-indicator');
    if (ti && myTurn) {
      ti.textContent = '🎯 ตาของคุณ! ⏱ ' + playerTimeLeft + 's';
    }
    if (playerTimeLeft <= 0) {
      stopPlayerTimer();
      if (myTurn && currentGame) {
        autoDiscard();
      }
    }
  }, 1000);
}

function stopPlayerTimer() {
  if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
  var txt = document.getElementById('timer-text');
  var arc = document.getElementById('timer-arc');
  if (txt) txt.textContent = '--';
  if (arc) arc.style.strokeDashoffset = String(TIMER_CIRC);
}

function resetPlayerTimer() {
  if (myTurn) startPlayerTimer();
}

function autoDiscard() {
  var handCodes = currentGame.hands[myPlayerId] || [];
  var hand = codesToCards(handCodes);
  var picked = myPickedCodes();
  var allMelds = findAllSetsAndRuns(hand);
  var usedCodes = {};
  allMelds.forEach(function(m) { m.cards.forEach(function(c) { usedCodes[c.code] = true; }); });
  var canD = hand.filter(function(c) { return picked.indexOf(c.code) === -1; });
  if (canD.length === 0) canD = hand;
  var safe = canD.filter(function(c) { return !usedCodes[c.code]; });
  var targets = safe.length > 0 ? safe : canD;
  var nonSpeto = targets.filter(function(c) { return !isSpeto(c); });
  var list = nonSpeto.length > 0 ? nonSpeto : targets;
  list.sort(function(a, b) { return cardPts(b) - cardPts(a); });
  var toDiscard = list[0] || canD[0];
  if (toDiscard) {
    pendingDiscardCode = toDiscard.code;
    doDiscard();
  }
}

function cardPts(c) {
  var v = c.rank;
  if (v === 'A') return 1;
  if (['J','Q','K'].indexOf(v) >= 0) return 10;
  return parseInt(v) || 0;
}

// --- SUPABASE ---
async function setupRealtime(rid) {
  try {
    if (realtimeChannel) { realtimeChannel.unsubscribe(); realtimeChannel = null; }
    stopPolling();
    realtimeChannel = db.channel('room-' + rid);
    realtimeChannel.on('postgres_changes', { event:'*', schema:'public', table:'rooms', filter:'id=eq.'+rid }, function(payload) {
      try {
        var room = payload.new;
        if (!room) { console.log('[RT] no room data'); return; }
        console.log('[RT] received:', room.status, '| turn:', room.game ? room.game.turnPlayerId : 'no game');
        if (room.status === 'lobby') {
          totalPlayers = room.totalplayers || 4;
          renderLobby(room.players || {}, totalPlayers);
        }
        else if (room.status === 'playing' && room.game) {
          currentGame = room.game;
          currentRoomVersion = room.version || currentRoomVersion;
          showScreen('game-screen');
          renderGame(room.game);
          // Trigger bot from realtime callback ONLY
          if (currentGame.status === 'playing' && currentGame.turnPlayerId && currentGame.turnPlayerId.indexOf('bot_') === 0) {
            var pid = currentGame.turnPlayerId;
            console.log('[RT] BOT TURN:', pid, '| botRunning:', botRunning[pid]);
            if (!botRunning[pid]) {
              botRunning[pid] = true;
              console.log('[RT] Starting botWithTimeout for', pid);
              setTimeout(function() {
                botWithTimeout(pid);
              }, 800);
            }
          } else {
            console.log('[RT] Not bot turn, myTurn=', currentGame.turnPlayerId);
          }
        } else if (room.status === 'ended') {
          showEndGame(resolveEndGame(room));
        }
      } catch(e) { console.error('[RT] callback error:', e); }
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
    var totalPlayers = parseInt(document.getElementById('player-count').value) || 4;
    var lvlEl = document.getElementById('room-level');
    roomLevel = lvlEl ? (parseFloat(lvlEl.value) || 1) : 1;
    roomCode = genRoomCode();
    myName = name;
    myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
    var players = {};
    players[myPlayerId] = { id: myPlayerId, name: name, isBot: false, isHost: true };
    var _data = await db.from('rooms').upsert({ id: roomCode, code: roomCode, players: players, status: 'lobby', totalplayers: totalPlayers });
    if (_data.error) { notify('❌ สร้างห้องไม่สำเร็จ'); return; }
    showScreen('lobby-screen');
    document.getElementById('display-room-code').textContent = roomCode;
    await setupRealtime(roomCode);
    renderLobby(players, totalPlayers);
    updateLobbyLevelLabel();
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
    var _data = await db.from('rooms').select('id,code,players,status,version,totalplayers').eq('id', code).single();
    if (_data.error || !_data.data) { notify('❌ ไม่พบห้องนี้'); return; }
    var room = _data.data;
    if (room.status === 'playing') { notify('❌ เกมเริ่มแล้ว'); return; }
    var _fresh = await db.from('rooms').select('id,players,version,totalplayers').eq('id', code).single();
    if (!_fresh.data) { notify('❌ ไม่พบห้อง'); return; }
    var currentPlayers = _fresh.data.players || {};
    if (currentPlayers[myPlayerId]) { notify('คุณอยู่ในห้องแล้ว'); return; }
    var currentKeys = Object.keys(currentPlayers);
    if (currentKeys.length >= (_fresh.data.totalplayers || 4)) { notify('❌ ห้องเต็มแล้ว'); return; }
    var newPlayers = Object.assign({}, currentPlayers);
    newPlayers[myPlayerId] = { id: myPlayerId, name: name, isBot: false, isHost: false };
    var updated = await db.from('rooms').update({
      players: newPlayers,
      version: _fresh.data.version + 1
    }).eq('id', code).eq('version', _fresh.data.version).select('id');
    if (updated.error) {
      notify('❌ ห้องเต็มหรือมีคนเข้าแล้ว — ลองใหม่');
      return;
    }
    roomCode = code;
    totalPlayers = _fresh.data.totalplayers || 4;
    showScreen('lobby-screen');
    document.getElementById('display-room-code').textContent = code;
    await setupRealtime(code);
    renderLobby(newPlayers, totalPlayers);
    updateLobbyLevelLabel();
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
    roomCode = null; myPlayerId = null; currentGame = null; currentLobbyPlayers = null; selectedCards = []; pendingPickedCodes = []; layoffTargets = [];
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
    // 2 players → 11 cards, 3 → 9 cards, 4 → 7 cards
    var HAND_SIZE = playerIds.length === 2 ? 11 : playerIds.length === 3 ? 9 : 7;
    var deck = shuffle(makeDeck());
    var hands = {};
    for (var pi = 0; pi < playerIds.length; pi++) {
      var handCards = [];
      for (var di = 0; di < HAND_SIZE; di++) handCards.push(deck.pop().code);
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
      pickedFromDiscard: {},
      level: roomLevel,
      version: 1
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
          setTimeout(function(){ botWithTimeout(pid); }, 800);
        }
      }
    }, 1200);
  } catch(e) { console.error('startGame error:', e); notify('❌ ผิดพลาด: ' + e.message); }
}

// --- GAME ACTIONS ---
async function drawCard() {
  try {
    if (!currentGame || !myTurn || currentGame.phase !== 'draw') return;
    var r = await rpcPlayTurn('DRAW_DECK');
    if (!r) return;
    if (r.deckEmpty) notify('📦 กองจั่วหมดแล้ว! ทิ้งไพ่ได้เลย');
    pendingPickedCodes = [];
    renderYourHand();
    updateLayoffTargets();
    updateActionBtns();
    resetPlayerTimer();
  } catch(e) { console.error('drawCard error:', e); }
}

// ไพ่ที่หยิบจากกองทิ้ง (รวมทั้ง state ฝั่ง client และที่บันทึกไว้ใน DB)
// รวมสองที่ไว้ เพื่อให้รีเฟรชหน้าเว็บแล้วกติกา "ต้องเกิดก่อนทิ้ง" ยังบังคับอยู่
// FIX v36: กรองไพ่ที่ "ยังอยู่บนมือ" เท่านั้น — ถ้า server ไม่ล้าง pickedFromDiscard
// หลังเกิด (server เวอร์ชันเก่าไม่ล้างให้) ไพ่ที่เกิดแล้วจะไม่อยู่บนมือ
// → ถ้าไม่กรอง ผู้เล่นจะถูกล็อก "ต้องเกิดก่อน" ทิ้งไพ่ไม่ได้เลย
function myPickedCodes() {
  var fromGame = (currentGame && currentGame.pickedFromDiscard && currentGame.pickedFromDiscard[myPlayerId]) || [];
  var hand = (currentGame && currentGame.hands && currentGame.hands[myPlayerId]) || [];
  var pending = pendingPickedCodes || [];

  // FIX v36.1: server เวอร์ชันเก่าไม่ล้าง pickedFromDiscard หลังเกิด (เวอร์ชัน FIX ที่
  // ยังไม่ได้ apply จะล้างทั้งก้อน) → ถ้า "ไพ่ที่หยิบสักใบหลุดจากมือไปแล้ว" แปลว่า
  // ผู้เล่นเกิดไปแล้ว (มือเดียวกับเซิร์ฟเวอร์ที่ใช้เกิด) → ถือว่าครบถ้วน ไม่ค้าง
  var stillOnHand = [];
  for (var i = 0; i < fromGame.length; i++) {
    if (hand.indexOf(fromGame[i]) >= 0) stillOnHand.push(fromGame[i]);
  }
  if (fromGame.length > 0 && stillOnHand.length < fromGame.length) return [];

  var out = stillOnHand.slice();
  for (var j = 0; j < pending.length; j++) {
    if (out.indexOf(pending[j]) < 0) out.push(pending[j]);
  }
  return out;
}

async function pickFromDiscard(idx) {
  try {
    if (!currentGame || !myTurn) return;
    if (currentGame.phase !== 'draw') { notify('ต้องจั่วหรือหยิบจากกองทิ้งก่อน!'); return; }
    var discard = (currentGame.discardPile || []).slice();
    if (discard.length === 0 || idx < 0 || idx >= discard.length) return;

    var taken = discard.slice(idx);
    var handCodes = currentGame.hands[myPlayerId] || [];
    var meldable = canMeldWithPicked(taken, handCodes);
    if (!meldable) {
      notify('❌ หยิบใบนี้ต้องเกิดได้ทันที! ลองใบอื่น');
      return;
    }

    // FIX v36: ทำหยิบไพ่เองฝั่ง client แบบ atomic (RPC PICK_DISCARD ฝั่ง server ตัดไพ่ผิดจนไพ่หาย)
    var res = await pickDiscardClientSide(idx, myPlayerId);
    if (!res) { notify('❌ หยิบไพ่ไม่สำเร็จ (มีคนเล่นไปแล้ว) ลองใหม่'); return; }

    pendingPickedCodes = res.taken;
    renderYourHand();
    renderDiscardPile(currentGame);
    openMeldModal(res.taken);
    if (res.speto > 0) {
      notify('⚠️ หยิบสเปโต! ถ้านำไปเกิด/ฝาก ผู้ที่ทิ้งไพ่นี้จะเสีย 100 แต้ม');
    } else {
      notify('🗑️ หยิบได้แล้ว! ต้องเกิดใบที่หยิบทันที');
    }
  } catch(e) { console.error('pickFromDiscard error:', e); }
}

async function discardSelected() {
  try {
    if (!currentGame || !myTurn) return;
    if (currentGame.phase === 'action' && myPickedCodes().length > 0) {
      notify('❌ ต้องเกิดใบที่หยิบจากกองทิ้งก่อนทิ้ง!'); return;
    }
    if (selectedCards.length !== 1) { notify('เลือกไพ่ 1 ใบที่จะทิ้ง'); return; }
    var cardCode = selectedCards[0];
    var handCodes = currentGame.hands[myPlayerId] || [];
    if (handCodes.indexOf(cardCode) === -1) { notify('❌ ไม่สามารถทิ้งไพ่ที่หยิบจากกองทิ้งมาได้'); return; }

    var card = codeToCard(cardCode);
    selectedCards = [];
    pendingPickedCodes = [];

    var r = await rpcPlayTurn('DISCARD', { cardCode: cardCode });
    if (!r) return;
    hasDiscardedThisTurn = true; // บันทึกว่าทิ้งแล้ว ถึงจะจบตาได้

    // FIX v39: จดจำว่าใครเป็นคนทิ้งสเปโต (ถ้ามีคนหยิบไปเกิด/ฝาก → คนทิ้งเสีย 100 แต้ม)
    if (isSpeto(card)) {
      await markSpetoDiscarded(myPlayerId, cardCode);
      notify('⚠️ ทิ้งสเปโต! (ยังไม่เสียแต้ม — ถ้ามีคนหยิบไปเกิด คุณจะเสีย 100 แต้ม)');
    }

    // Check for knockout
    if (r.game && r.game.status === 'ended') {
      var _pk = await db.from('rooms').select('players').eq('id', roomCode).single();
      var _pl = (_pk && _pk.data && _pk.data.players) || {};
      showEndGame(resolveEndGame({ players: _pl, game: r.game }, {
        winner: (r.winner !== undefined && r.winner !== null) ? r.winner : (r.game.winner || myPlayerId),
        totalScores: r.total_scores || r.game.totalScores || r.game.scores,
        roundScores: r.round_scores || r.game.roundScores || {}
      }));
      return;
    }

    renderYourHand();
    updateActionBtns();
    resetPlayerTimer();
  } catch(e) { console.error('discardSelected error:', e); }
}

async function advanceTurn() {
  try {
    stopPlayerTimer();
    var order = currentGame.playerOrder;
    var idx = order.indexOf(currentGame.turnPlayerId);
    var nextIdx = (idx + 1) % order.length;
    var nextPid = order[nextIdx];
    console.log('[Turn] advancing from', currentGame.turnPlayerId, 'to', nextPid);
    setGame({ turnPlayerId: nextPid, phase: 'draw', turnStartTime: Date.now() });
    await db.from('rooms').update({ game: currentGame }).eq('id', roomCode);
    renderGame(currentGame);
    // Bot will be triggered by realtime callback
  } catch(e) { console.error('advanceTurn error:', e); }
}

async function doKnock() {
  try {
    if (!currentGame || !myTurn) return;
    var myHand = currentGame.hands[myPlayerId] || [];
    // FIX v39: น็อคได้ตอนเหลือ 0 หรือ 1 ใบ (server เดิมตอบ HAND_NOT_EMPTY เมื่อเหลือ 1 ใบ)
    if (myHand.length > 1) { notify('ไพ่ต้องเหลือไม่เกิน 1 ใบถึงจะน็อคได้'); return; }
    if (myPickedCodes().length > 0) { notify('❌ ต้องเกิดใบที่หยิบจากกองทิ้งก่อนน็อค!'); return; }

    // จบรอบฝั่ง client (เขียน rooms.status='ended' + game JSONB พร้อม optimistic lock)
    var res = await finishRoundClientSide(myPlayerId);
    if (!res) { notify('❌ บันทึกผลไม่สำเร็จ ลองใหม่อีกครั้ง'); return; }
    var _p = await db.from('rooms').select('players').eq('id', roomCode).single();
    var players = (_p && _p.data && _p.data.players) || {};
    showEndGame({
      winner: res.winner, totalScores: res.totalScores || {}, roundScores: res.roundScores || {},
      players: players, knockId: myPlayerId, breakdown: endgameBreakdown(myPlayerId)
    });
  } catch(e) { console.error('doKnock error:', e); }
}

async function endTurn() {
  try {
    if (!currentGame || !myTurn) return;
    if (currentGame.phase === 'draw') { notify('ต้องจั่วหรือหยิบจากกองทิ้งก่อน!'); return; }
    if (myPickedCodes().length > 0) { notify('❌ ต้องเกิดใบที่หยิบจากกองทิ้งก่อน!'); return; }
    if (!hasDiscardedThisTurn) { notify('❌ ต้องทิ้งไพ่ 1 ใบก่อนจบตา!'); return; }
    var r = await rpcPlayTurn('END_TURN');
    if (!r) return;
    resetPlayerTimer();
  } catch(e) { console.error('endTurn error:', e); }
}

async function handleKnockout(koId) {
  try {
    var _data = await db.from('rooms').select('id,code,players,game,status,version,totalplayers').eq('id', roomCode).single();
    if (!_data.data) return;
    var players = _data.data.players || {};

    // FIX v39: ใช้สูตรกลางเดียวกันทุกทาง (รองรับผู้น็อคเหลือ 1 ใบ + โทษสเปโต)
    var res = await finishRoundClientSide(koId);
    if (!res) return;
    showEndGame({
      winner: res.winner, totalScores: res.totalScores || {}, roundScores: res.roundScores || {},
      players: players, knockBonus: res.knockBonus, knockId: koId, breakdown: endgameBreakdown(koId)
    });
  } catch(e) { console.error('handleKnockout error:', e); }
}

// --- BOT with timeout safety ---
function botWithTimeout(botId) {
  console.log('[Bot] botWithTimeout START for', botId);
  var done = false;
  setTimeout(function() {
    if (!done) {
      console.warn('[Bot] TIMEOUT for', botId, '- forcing advance');
      botRunning[botId] = false;
      (function() {
        if (!currentGame || !roomCode) { console.warn('[Bot] timeout skip: no game or room'); return; }
        var order = currentGame.playerOrder;
        var idx = order.indexOf(botId);
        if (idx < 0) { console.warn('[Bot] timeout: bot not in order'); return; }
        var nextIdx = (idx + 1) % order.length;
        var nextPid = order[nextIdx];
        currentGame.turnPlayerId = nextPid;
        currentGame.phase = 'draw';
        currentGame.turnStartTime = Date.now();
        db.from('rooms').update({ game: currentGame }).eq('id', roomCode).then(function() {
          console.log('[Bot] timeout advanced to', nextPid);
          renderGame(currentGame);
          if (nextPid.indexOf('bot_') === 0 && currentGame.status === 'playing') {
            setTimeout(function() { botWithTimeout(nextPid); }, 800);
          }
        }).catch(function(e) { console.error('[Bot] timeout update failed:', e); botRunning[botId] = false; });
      })();
    }
  }, 8000);
  botPlay(botId).then(function() {
    done = true;
    console.log('[Bot] botPlay DONE for', botId);
  }).catch(function(e) {
    done = true;
    console.error('[Bot] botPlay ERROR:', botId, e.message);
    botRunning[botId] = false;
  });
}

async function botPlay(botId) {
  try {
    console.log('[Bot] checking status:', currentGame ? currentGame.status : 'null', 'turn:', currentGame ? currentGame.turnPlayerId : 'null');
    if (!currentGame || currentGame.status !== 'playing') { console.log('[Bot] RETURN: no game or not playing'); botRunning[botId] = false; return; }
    if (currentGame.turnPlayerId !== botId) { console.log('[Bot] RETURN: not my turn'); botRunning[botId] = false; return; }

    await delay(600);

    // Re-read current game state from DB (now includes version)
    var _data = await db.from('rooms').select('id,code,game,version').eq('id', roomCode).single();
    if (_data.data && _data.data.game) {
      currentGame = _data.data.game;
      currentRoomVersion = _data.data.version || currentRoomVersion;
      console.log('[Bot] re-read turn:', currentGame.turnPlayerId, 'phase:', currentGame.phase, 'version:', currentGame.version);
    }
    if (!currentGame || currentGame.turnPlayerId !== botId) { console.log('[Bot] RETURN: after re-read not my turn'); botRunning[botId] = false; return; }

    var handCodes = currentGame.hands[botId] || [];
    var hand = codesToCards(handCodes);
    var pickedThisTurn = false;

    // --- DRAW: try pick from discard first ---
    if (currentGame.discardPile && currentGame.discardPile.length > 0) {
      var discard = currentGame.discardPile;
      for (var di = discard.length - 1; di >= 0; di--) {
        var taken = discard.slice(di);
        var meldable = canMeldWithPicked(taken, handCodes);
        if (meldable) {
          // FIX v36: หยิบไพ่ฝั่ง client (RPC PICK_DISCARD ฝั่ง server ตัดไพ่ผิดจนไพ่หาย)
          var pres = await pickDiscardClientSide(di, botId);
          if (!pres) { botRunning[botId] = false; return; }
          hand = codesToCards(currentGame.hands[botId] || []);
          handCodes = hand.map(function(c){ return c.code; });
          pickedThisTurn = true;
          await delay(300);

          // Meld picked cards immediately (ต้องเกิดไพ่ที่หยิบเสมอ ไม่งั้นค้าง/ทิ้งผิดกติกา)
          var botM = findMelds(hand);
          var validM = botM.filter(function(m){ return m.cards.some(function(c){ return taken.indexOf(c.code) >= 0; }); });
          if (validM.length > 0) {
            var bmgCodes = validM[0].cards.map(function(c){ return c.code; });
            var r2 = await rpcPlayTurn('MELD', { meldCodes: bmgCodes, playerId: botId });
            if (r2) {
              hand = codesToCards(currentGame.hands[botId] || []);
              handCodes = hand.map(function(c){ return c.code; });
              // FIX v39: โทษสเปโต -100 เมื่อสเปโตถูกนำไปอยู่ในชุดเกิด
              if (bmgCodes.some(isSpetoCode)) await applySpetoPenalty(botId, bmgCodes);
              await clearPickedFlag(botId);
            }
            await delay(300);
          } else {
            // ไม่มีชุดที่ใช้ไพ่ที่หยิบ → คืนไพ่กลับกองทิ้ง (กันบอทค้าง)
            await returnPickedCardsFor(botId);
            hand = codesToCards(currentGame.hands[botId] || []);
            handCodes = hand.map(function(c){ return c.code; });
            pickedThisTurn = false;
          }
          break;
        }
      }
    }

    // --- DRAW: draw from deck if didn't pick ---
    if (!pickedThisTurn) {
      var r = await rpcPlayTurn('DRAW_DECK', { playerId: botId });
      if (!r) { botRunning[botId] = false; return; }
      if (!r.deckEmpty) {
        hand = codesToCards(currentGame.hands[botId] || []);
        handCodes = hand.map(function(c){ return c.code; });
      }
      await delay(300);
    }

    // --- ACTION: meld (first meld if not yet) ---
    var hasFM2 = currentGame.hasFirstMeld && currentGame.hasFirstMeld[botId];
    if (!hasFM2) {
      var vm = findMelds(hand);
      // FIX v39: เลี่ยงการเลือกชุดที่มีสเปโต ถ้ามีชุดอื่นที่ไม่มีสเปโตให้เลือก
      var vmNoSpeto = vm.filter(function(m){ return !m.cards.some(function(c){ return isSpetoCode(c.code); }); });
      if (vmNoSpeto.length > 0) vm = vmNoSpeto;
      if (vm.length > 0) {
        var m0c = vm[0].cards.map(function(c){ return c.code; });
        var r = await rpcPlayTurn('MELD', { meldCodes: m0c, playerId: botId });
        if (r) {
          hand = codesToCards(currentGame.hands[botId] || []);
          handCodes = hand.map(function(c){ return c.code; });
        }
        await delay(300);
      }
    } else {
      // Layoff
      var los = findAllLayoffs(handCodes, currentGame);
      if (los.length > 0) {
        var lo = los[0];
        var r = await rpcPlayTurn('LAYOFF', {
          cardCode: lo.layoffCard,
          targetPid: lo.targetPid,
          targetMeldIdx: lo.meldIndex,
          playerId: botId
        });
        if (r) {
          hand = codesToCards(currentGame.hands[botId] || []);
          handCodes = hand.map(function(c){ return c.code; });
          // FIX v39: โทษสเปโต -100 เมื่อสเปโตถูกฝากลงชุด
          if (isSpetoCode(lo.layoffCard)) await applySpetoPenalty(botId, [lo.layoffCard]);
        }
        await delay(300);
      }
    }

    // --- DISCARD ---
    if (hand.length > 0) {
      var pCodes = (currentGame.pickedFromDiscard && currentGame.pickedFromDiscard[botId]) || [];
      var botHand = currentGame.hands[botId] || [];
      pCodes = pCodes.filter(function(c){ return botHand.indexOf(c) >= 0; });
      var canD = hand.filter(function(c){ return pCodes.indexOf(c.code) === -1; });
      if (canD.length === 0) canD = hand;
      // FIX v39: ไม่ทิ้งสเปโตก่อน (คนที่ทิ้งคือคนที่จะเสียแต้มถ้ามีคนเกิดมัน) → เลือกไพ่อื่นก่อน
      var nonSpeto = canD.filter(function(c){ return !isSpeto(c); });
      var dCard = nonSpeto.length > 0 ? nonSpeto[nonSpeto.length - 1] : canD[canD.length - 1];

      // FIX v39: บอทน็อคผ่าน finishRoundClientSide (รองรับเหลือ 1 ใบ / 0 ใบ — server เดิมตอบ HAND_NOT_EMPTY)
      if (hand.length <= 1) {
        await finishRoundClientSide(botId);
        botRunning[botId] = false;
        return;
      }

      var r = await rpcPlayTurn('DISCARD', { cardCode: dCard.code, playerId: botId });
      if (!r) { botRunning[botId] = false; return; }
      // FIX v39: จดจำว่าบอททิ้งสเปโต (ถ้ามีคนหยิบไปเกิด → บอทเสีย 100 แต้ม)
      if (isSpetoCode(dCard.code)) await markSpetoDiscarded(botId, dCard.code);
    }

    botRunning[botId] = false;
    console.log('[Bot] turn done for', botId);
  } catch(e) {
    console.error('[Bot] EXCEPTION:', e.message, e.stack ? e.stack.split('\n')[1] : '');
    botRunning[botId] = false;
  }
}

// --- MELD MODAL ---
function openMeldModal(pickedCodes) {
  selectedMeldIndex = null;
  window._selectedMeld = null;
  modalOpen = true;
  try {
    // ถ้าไม่ได้ระบุ → ใช้ไพ่ที่หยิบค้างอยู่ (ถ้ามี) เพื่อบังคับให้เลือกชุดที่ใช้ไพ่ที่หยิบ
    var pc = (pickedCodes && pickedCodes.length > 0) ? pickedCodes : myPickedCodes();
    document.getElementById('meld-modal').classList.add('active');
    renderMeldOptions(pc);
    document.getElementById('btn-confirm-meld').disabled = true;
  } catch(e) { console.error('openMeldModal error:', e); }
}

function closeMeldModal() {
  modalOpen = false;
  try { document.getElementById('meld-modal').classList.remove('active'); } catch(e) {}
}

// กดยกเลิก: ถ้ายังหยิบไพ่ค้างอยู่ → คืนไพ่กลับกองทิ้ง (กันผู้เล่นค้างจนเกมกินไม่ได้)
async function onCancelMeld() {
  if (myPickedCodes().length > 0) {
    await returnPickedCards();
    return;
  }
  closeMeldModal();
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
        ((pickedCodes && pickedCodes.length > 0)
          ? '<div style="color:#e94560;text-align:center;padding:10px">⚠️ ต้องเกิดใบที่หยิบ!</div>' +
            '<div style="text-align:center;padding:4px"><button class="btn btn-secondary" onclick="returnPickedCards()">↩️ คืนไพ่ที่หยิบกลับกองทิ้ง</button></div>'
          : '');
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
    if (pickedCodes && pickedCodes.length > 0) {
      html += '<div style="color:#ffd700;font-size:0.85rem;text-align:center;margin-top:10px">✨ ต้องเลือกชุดที่ใช้ใบที่หยิบ</div>' +
        '<div style="text-align:center;margin-top:8px"><button class="btn btn-secondary" onclick="returnPickedCards()">↩️ คืนไพ่ที่หยิบกลับกองทิ้ง</button></div>';
    }
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
    var meldedCodes = meld.cards.map(function(c){ return c.code; });
    // FIX: clear selectedCards BEFORE RPC so stale refs don't confuse discard btn
    selectedCards = [];
    var r = await rpcPlayTurn('MELD', { meldCodes: meldedCodes });
    if (!r) { selectedCards = []; return; } // revert on failure
    // FIX v39: โทษสเปโต -100 เมื่อสเปโตถูกนำไปอยู่ในชุดเกิด
    if (meldedCodes.some(isSpetoCode)) await applySpetoPenalty(myPlayerId, meldedCodes);
    // FIX v36: server บางเวอร์ชันไม่ล้าง pickedFromDiscard → ล้างเองให้แน่ (ไม่งั้นผู้เล่นค้าง)
    await clearPickedFlag(myPlayerId);
    // FIX: transition phase to 'action' so discard btn enables immediately
    if (currentGame) { currentGame.phase = 'action'; }
    closeMeldModal();
    pendingPickedCodes = [];
    notify(r.is_first_meld ? '🎉 เกิดสำเร็จ! ต่อไปสามารถฝากไพ่ได้!' : '🃏 เกิดสำเร็จ!');
    renderYourHand();
    renderPlayerMeldRow();
    renderScoreboard(currentGame);
    updateLayoffTargets();
    updateActionBtns();
    resetPlayerTimer();
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
  modalOpen = true;
  try {
    document.getElementById('layoff-modal').classList.add('active');
    renderLayoffOptions();
  } catch(e) { console.error('openLayoffModal error:', e); }
}

function closeLayoffModal() {
  modalOpen = false;
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
    var r = await rpcPlayTurn('LAYOFF', {
      cardCode:    lt.layoffCard,
      targetPid:   lt.targetPid,
      targetMeldIdx: lt.meldIndex
    });
    if (!r) return;
    // FIX v39: โทษสเปโต -100 เมื่อสเปโตถูกฝากลงชุด
    if (isSpetoCode(lt.layoffCard)) await applySpetoPenalty(myPlayerId, [lt.layoffCard]);
    closeLayoffModal();
    var card = codeToCard(lt.layoffCard);
    notify('💚 ฝาก ' + (card ? card.rank + card.suit : lt.layoffCard) + ' สำเร็จ!');
    renderYourHand();
    renderPlayerMeldRow();
    updateLayoffTargets();
    updateActionBtns();
    resetPlayerTimer();
  } catch(e) { console.error('selectLayoff error:', e); }
}

// --- RENDERING ---
async function renderLobby(players, maxPlayers) {
  try {
    maxPlayers = maxPlayers || 4;
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
    var nextNum = arr.length + 1;
    for (var ei = arr.length; ei < maxPlayers; ei++) {
      html += '<div class="player-slot"><div class="pemoji">❓</div><div class="pname">รอผู้เล่น...</div><div class="ptype">รอคนที่ ' + nextNum + '...</div></div>';
      nextNum++;
    }
    for (var ei = maxPlayers; ei < 4; ei++) {
      html += '<div class="player-slot"><div class="pemoji">❌</div><div class="pname">ไม่มี</div><div class="ptype">ไม่มีผู้เล่น</div></div>';
    }
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
    if (myTurn) hasDiscardedThisTurn = false; // เริ่มตาใหม่ ต้องทิ้งใหม่
    var ti = document.getElementById('turn-indicator');
    if (ti) ti.textContent = myTurn ? '🎯 ตาของคุณ!' : '⏳ รอตาคนอื่น...';
    // Start/stop player turn timer
    if (myTurn && game.status === 'playing') {
      startPlayerTimer();
    } else {
      stopPlayerTimer();
    }
    var ri = document.getElementById('round-info');
    if (ri) ri.textContent = 'รอบ: ' + (game.round || 1) + ' | ทิ้ง: ' + (game.discardPile ? game.discardPile.length : 0);
    var dc = document.getElementById('deck-count');
    if (dc) dc.textContent = (game.deck ? game.deck.length : 0) + (game.deckEmpty ? ' 🔻หมด' : '');
    var yn = document.getElementById('your-name');
    if (yn) yn.innerHTML = '<span class="av">' + avatarFor(myPlayerId).e + '</span>' + myName;
    await renderOpponents(game);
    renderDiscardPile(game);
    renderYourHand();
    renderPlayerMeldRow();
    renderScoreboard(game);
    updateLayoffTargets();
    updateActionBtns();
    // FIX v36.2: ถ้าธงหยิบค้าง (ไพ่ไม่อยู่บนมือ) → ล้างอัตโนมัติ
    // (กัน server บล็อกทิ้งไพ่ถาวรด้วย MUST_MELD_PICKED เมื่อพี่เอรัน SQL fix)
    try { autoCleanStalePickedFlag(); } catch(e) {}
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
    renderOpponentMeldZone(game, players);
  } catch(e) { console.error('renderOpponents error:', e); }
}

// โซนชุดไพ่ของคู่แข่ง (แถบน้ำเงิน) — รวมชุดไพ่ของทุกคนที่ไม่ใช่เรา
function renderOpponentMeldZone(game, players) {
  try {
    var zone = document.getElementById('opponent-melds');
    if (!zone) return;
    var html = '';
    var any = false;
    for (var pid in (game.melds || {})) {
      if (pid === myPlayerId) continue;
      var melds = game.melds[pid] || [];
      for (var mi = 0; mi < melds.length; mi++) {
        any = true;
        var meldCodes = Array.isArray(melds[mi]) ? melds[mi] : (melds[mi].cards || []);
        var setHtml = '<div class="meld-set-display">';
        for (var ci = 0; ci < meldCodes.length; ci++) {
          var c = codeToCard(meldCodes[ci]);
          if (c) setHtml += '<div class="ms-card ' + handCardClass(c) + '">' + c.rank + '<br>' + c.suit + '</div>';
        }
        setHtml += '</div>';
        var p = players[pid] || {};
        html += setHtml + '<span class="mz-empty" style="align-self:center">' + (p.isBot ? '🤖 ' : '') + (p.name || '??') + '</span>';
      }
    }
    zone.innerHTML = any ? html : '<span class="mz-empty">ยังไม่มีผู้เล่นเกิดชุดไพ่</span>';
  } catch(e) { console.error('renderOpponentMeldZone error:', e); }
}

// --- AVATAR: สัตว์น่ารัก ใช้ emoji ของเราเอง (ไม่ใช้ asset ของเกมอื่น) ---
var AVATARS = [
  { e: '🦌', n: 'แกะ' }, { e: '🐱', n: 'แมว' }, { e: '🐮', n: 'โค' },
  { e: '🐰', n: 'กระต่าย' }, { e: '🐶', n: 'สุนัข' }, { e: '🐻', n: 'หมี' },
  { e: '🐷', n: 'หมู' }, { e: '🐔', n: 'ไก่' }, { e: '🐸', n: 'กบ' },
  { e: '🦊', n: 'สุนัขจิ้งจอก' }, { e: '🐼', n: 'แพนด้า' }, { e: '🐯', n: 'เสือ' }
];
function avatarFor(pid) {
  if (!pid) return AVATARS[0];
  var h = 0;
  for (var i = 0; i < pid.length; i++) { h = ((h << 5) - h + pid.charCodeAt(i)) | 0; }
  return AVATARS[Math.abs(h) % AVATARS.length];
}
function starsFor(n) {
  var s = '';
  for (var i = 0; i < Math.min(3, n); i++) s += '⭐';
  return s;
}

function opponentCardHtml(pid, game, players) {
  if (!pid) return '<div class="opponent-card" style="opacity:0.2"><div class="oheader"><span class="oemoji">❌</span><span class="oname">ไม่มี</span></div><div class="ocard-mini"><span style="color:#bbb;font-size:0.75rem">ไม่มีผู้เล่น</span></div></div>';
  var handSize = game.hands && game.hands[pid] ? game.hands[pid].length : 0;
  var isActive = game.turnPlayerId === pid;
  var p = players[pid] || {};
  var melds = game.melds && game.melds[pid] ? game.melds[pid] : [];
  // NOTE: ไพ่ที่เกิดแล้วแสดงในแถบโซนสีน้ำเงิน (renderOpponentMeldZone) แล้ว
  // การ์ดผู้เล่นจึงแสดงแค่จำนวนชุด ไม่ซ้ำชุดไพ่ (ตามต้นแบบ GAMEINDY)
  var meldChips = '';
  if (melds.length > 0) {
    var typeNames = [];
    for (var mi = 0; mi < melds.length; mi++) {
      var meldCodes = Array.isArray(melds[mi]) ? melds[mi] : (melds[mi].cards || []);
      typeNames.push(detectMeldType(meldCodes));
    }
    meldChips = '<div class="omeld-list"><div class="meld-chip" style="justify-content:center">' +
      '<span style="font-size:0.68rem;white-space:nowrap">เกิด ' + melds.length + ' ชุด (' + typeNames.join(', ') + ')</span></div></div>';
  }
  var activeLabel = isActive ? '<span class="oactive">▶ ตาคนี้</span>' : '';
  var av = avatarFor(pid);
  var starHtml = melds.length ? '<span class="ostars">' + starsFor(melds.length) + '</span>' : '';
  return '<div class="opponent-card' + (isActive ? ' active-turn' : '') + '">' +
    '<div class="oheader"><span class="oemoji">' + av.e + '</span><span class="oname">' + (p.name || '??') + '</span>' + starHtml + activeLabel + '</div>' +
    '<div style="text-align:center;padding:8px 0"><div style="font-size:2rem;font-weight:700;color:var(--gold)">' + handSize + '</div><div style="font-size:0.75rem;color:#bbb">ใบ</div></div>' +
    (meldChips ? '<div class="omeld-list">' + meldChips + '</div>' : '') + '</div>';
}

function renderDiscardPile(game) {
  try {
    var pile = document.getElementById('discard-pile');
    var discard = game.discardPile || [];
    if (!pile) return;
    var badge = document.getElementById('discard-count');
    if (badge) badge.textContent = discard.length;
    if (discard.length === 0) { pile.innerHTML = '<span style="color:#bbb;font-size:0.8rem">ว่าง</span>'; return; }
    var html = '';
    for (var i = 0; i < discard.length; i++) {
      var card = codeToCard(discard[i]);
      if (!card) continue;
      var cls = handCardClass(card);
      // ใบบนสุด (ใบล่าสุด) ไฮไลต์สีเหลือง = ใบที่หยิบได้
      var latest = (i === discard.length - 1) ? ' latest' : '';
      html += '<div class="dp-card ' + cls + latest + '" onclick="pickFromDiscard(' + i + ')" style="cursor:pointer;flex-shrink:0" title="หยิบใบนี้และทุกใบที่อยู่บน">' + card.rank + '<br>' + card.suit + '</div>';
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
    if (myHandOrder && myHandOrder.length === hand.length) {
      var byCode = {};
      for (var bci = 0; bci < hand.length; bci++) byCode[hand[bci].code] = hand[bci];
      var ordered = [];
      var allFound = true;
      for (var oi = 0; oi < myHandOrder.length; oi++) {
        if (!byCode[myHandOrder[oi]]) { allFound = false; break; }
        ordered.push(byCode[myHandOrder[oi]]);
      }
      if (allFound) sorted = ordered; else myHandOrder = null;
    }
    var pickedCodes = myPickedCodes();
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
      var crown = '';
      // ผู้นำอันดับ 1 มีมงกุฎ
      var best = null;
      for (var bi = 0; bi < game.playerOrder.length; bi++) {
        var bp = game.playerOrder[bi];
        var bs = scores[bp] || 0;
        if (best === null || bs > best) best = bs;
      }
      if (best !== null && pts === best && pts > 0) crown = '<span class="crown">👑</span>';
      html += '<div class="score-item' + (isYou ? ' highlight' : '') + '">' +
        '<div class="sname"><span class="av">' + avatarFor(pid).e + '</span>' + (p.isBot ? '🤖 ' : '') + (p.name || '??') + crown + '</div>' +
        '<div class="spoint" style="color:' + (isYou ? '#ffd700' : (pts >= 0 ? '#fff' : '#ff8a80')) + '">' +
        (pts > 0 ? '+' : '') + pts + '<span class="unit">P</span></div>' +
        '<div style="font-size:0.7rem;color:#bbb">เกิด ' + meldCount + '</div></div>';
    }
    row.innerHTML = html;
  } catch(e) { console.error('renderScoreboard error:', e); }
}

function toggleSelect(code) {
  try {
    var hand = currentGame && currentGame.hands ? (currentGame.hands[myPlayerId] || []) : [];
    if (hand.indexOf(code) === -1) return;
    var pickedCodes = myPickedCodes();
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

    var myHand = currentGame.hands[myPlayerId] || [];
    // FIX v39: น็อคได้ตอนเหลือ 0 หรือ 1 ใบ
    var isLastCard = myHand.length === 0;
    var canKnock = myHand.length <= 1;
    var hasMeld = currentGame.hasFirstMeld && currentGame.hasFirstMeld[myPlayerId];
    var picked = myPickedCodes().length > 0;
    var btnKnock = document.getElementById('btn-knock');
    var btnRet = document.getElementById('btn-return-picked');
    if (btnRet) {
      btnRet.style.display = picked ? 'inline-block' : 'none';
      btnRet.disabled = !picked || !myTurn;
    }

    if (myTurn) {
      var phase = currentGame.phase || 'draw';
      if (btnDraw) btnDraw.disabled = phase !== 'draw' || canKnock;
      if (btnMeld) btnMeld.disabled = false;
      // FIX: also verify the selected card is still actually in hand (not stale after a meld)
      var selCodes = selectedCards.map(function(c){ return c.code || c; });
      var myHandCodes = currentGame.hands[myPlayerId] || [];
      var selStillInHand = selectedCards.length === 1 && selCodes.length > 0 && myHandCodes.indexOf(selCodes[0]) >= 0;
      if (btnDiscard) btnDiscard.disabled = !(selStillInHand && !picked && !canKnock);
      if (btnEnd) btnEnd.disabled = !(phase === 'action' && !picked && hasDiscardedThisTurn);
      // FIX v39: ปุ่มน็อคโผล่เมื่อเหลือ <=1 ใบ (ไม่ต้องรอ phase==='action')
      if (btnKnock) btnKnock.style.display = (canKnock && !picked) ? 'inline-block' : 'none';

      if (canKnock) handStatus.textContent = (myHand.length === 0)
        ? '🔔 ไพ่หมด! กดปุ่ม 🔔 น็อค!'
        : '🔔 เหลือไพ่ 1 ใบ! กดปุ่ม 🔔 น็อค (ไพ่ใบนี้จะนับเป็นแต้มหัก)';
      else if (picked) handStatus.textContent = '⚠️ ต้องเกิดใบที่หยิบจากกองทิ้งก่อน!';
      else if (phase === 'draw') handStatus.textContent = '📦 จั่วหรือหยิบจากกองทิ้ง';
      else if (!hasDiscardedThisTurn) handStatus.textContent = '⚠️ ต้องเลือกไพ่ 1 ใบที่จะทิ้ง แล้วกดปุ่ม 🗑️ ทิ้งก่อนจบตา!';
      else handStatus.textContent = '🃏 ทิ้งแล้ว ✓ กดจบตาได้เลย';
    } else {
      [btnDraw, btnMeld, btnDiscard, btnEnd].forEach(function(b){ if(b) b.disabled = true; });
      if (btnKnock) btnKnock.style.display = 'none';
      if (handStatus) handStatus.textContent = '⏳ รอตาคนอื่น...';
    }
  } catch(e) {}
}

// --- END GAME ---
// FIX S3: ผู้ชนะ/คะแนนอาจอยู่ที่ room.winner, room.totalScores หรือใน game JSONB
// (server เขียนไว้ทั้งที่) → อ่านให้ครบทุกทาง ไม่ให้ขึ้น "??" หรือตารางว่าง
function resolveEndGame(room, extra) {
  var r = room || {};
  var g = r.game || {};
  var e = extra || {};
  var players = e.players || r.players || {};
  var winner = (e.winner !== undefined && e.winner !== null) ? e.winner
             : (r.winner !== undefined && r.winner !== null) ? r.winner
             : (g.winner !== undefined ? g.winner : null);
  var totalScores = e.totalScores || r.totalScores || g.totalScores || g.scores || {};
  var roundScores = e.roundScores || g.roundScores || {};
  if (!winner) {
    // ถ้ารฐณณติทฌมีเลือกไม่มีคะแนน์ยองได้ → สลักคะแนน์กอดสุด
    if (Object.keys(totalScores).length) {
      var mn = null;
      for (var k in totalScores) { if (mn === null || totalScores[k] > totalScores[mn]) mn = k; }
      if (mn !== null) winner = mn;
    }
  }
  return { winner: winner, totalScores: totalScores, roundScores: roundScores, players: players };
}

function showEndGame(data) {
  try {
    confetti();
    data = data || {};
    var winner = data.winner;
    var totalScores = data.totalScores || {};
    var roundScores = data.roundScores || {};
    var players = data.players || {};
    var br = data.breakdown || endgameBreakdown(data.knockId);
    var rows = document.getElementById('endgame-rows');
    if (rows) {
      // เรียงตามคะแนนรอบนี้ (มาก→น้อย) แล้วใส่อันดับ 1..4
      var list = [];
      for (var pid in br) {
        list.push({ pid: pid, round: (roundScores[pid] !== undefined ? roundScores[pid] : br[pid].round), b: br[pid] });
      }
      list.sort(function(a, b) { return (b.round || 0) - (a.round || 0); });
      var html = '';
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        var p = players[it.pid] || {};
        var av = avatarFor(it.pid);
        var b = it.b || {};
        var round = it.round || 0;
        var total = (totalScores[it.pid] !== undefined ? totalScores[it.pid] : round);
        var knock = (b.isKnock || it.pid === winner) && (b.knockBonus > 0);
        html += '<div class="eg-row r' + Math.min(4, i + 1) + '">' +
          '<div class="eg-rank-bar"></div>' +
          '<div class="eg-av">' + av.e + '</div>' +
          '<div class="eg-who">' +
            '<div class="eg-nm">' + (p.isBot ? '<span class="eg-bot">🤖</span> ' : '') + escHtml(p.name || '??') +
              (it.pid === winner ? ' <span class="eg-crown">👑</span>' : '') + '</div>' +
            '<div class="eg-cards">' + egCardsHtml(b.meldCards) + (b.meldCards && b.meldCards.length ? '<span class="eg-empty">·</span>' : '') + egCardsHtml(b.handCards) + '</div>' +
          '</div>' +
          '<div class="eg-pts">' +
            '<div class="eg-pt"><span class="lbl">เกิด/ลง/ฝาก</span><span class="val ' + (b.meld > 0 ? 'pos' : 'zero') + '">+' + (b.meld || 0) + 'P</span></div>' +
            '<div class="eg-pt"><span class="lbl">ไพ่บนมือ</span><span class="val ' + (b.hand > 0 ? 'neg' : 'zero') + '">' + (b.hand > 0 ? '-' + b.hand : '0') + 'P</span></div>' +
            '<div class="eg-pt"><span class="lbl">คะแนนพิเศษ</span><span class="val ' + (b.bonus > 0 ? 'pos' : 'zero') + '">' + (b.bonus > 0 ? '+' : '') + (b.bonus || 0) + 'P</span>' +
              (knock ? '<span class="eg-knock">น็อค +' + (b.knockBonus || 0) + 'P</span>' : '') + '</div>' +
            ((b.penalty || 0) > 0 ? '<div class="eg-pt"><span class="lbl">โทษสเปโต</span><span class="val neg">-' + (b.penalty || 0) + 'P</span></div>' : '') +
            '<div class="eg-pt"><span class="lbl">คะแนนรอบนี้</span><span class="val ' + (round > 0 ? 'pos' : (round < 0 ? 'neg' : 'zero')) + '">' + (round > 0 ? '+' : '') + round + 'P</span></div>' +
            '<div class="eg-pt"><span class="lbl">คะแนนรวม</span><span class="val ' + (total > 0 ? 'pos' : (total < 0 ? 'neg' : 'zero')) + '">' + (total > 0 ? '+' : '') + total + 'P</span></div>' +
          '</div>' +
        '</div>';
      }
      rows.innerHTML = html || '<div class="eg-empty">ไม่มีข้อมูลคะแนน</div>';
    }
    // ห้อง + กองจั่ว/กองทิ้ง
    var rcEl = document.getElementById('eg-roomcode');
    if (rcEl) rcEl.textContent = roomCode || '-------';
    var deckEl = document.getElementById('eg-deck');
    if (deckEl) {
      var dcount = (currentGame && currentGame.deck) ? currentGame.deck.length : 0;
      deckEl.innerHTML = dcount ? '<span class="eg-card">📦 ' + dcount + '</span>' : '<span class="eg-empty">ว่าง</span>';
    }
    var disEl = document.getElementById('eg-discard');
    if (disEl) {
      var disc = (currentGame && currentGame.discardPile) ? currentGame.discardPile : [];
      var tail = disc.slice(-4);
      disEl.innerHTML = tail.length ? tail.map(function(c) { return egCardHtml(c); }).join('') : '<span class="eg-empty">ว่าง</span>';
    }
    var modal = document.getElementById('endgame-modal');
    if (modal) modal.classList.add('active');
  } catch(e) { console.error('showEndGame error:', e); }
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function egCardHtml(code) {
  var c = codeToCard(code);
  if (!c) return '';
  var cls = handCardClass(c);
  return '<span class="eg-card ' + cls + '">' + c.rank + '<br>' + c.suit + '</span>';
}
function egCardsHtml(codes) {
  if (!codes || !codes.length) return '';
  return codes.map(egCardHtml).join('');
}

// คำนวณรายละเอียดคะแนนรายคน (ชุด/ฝาก, ไพ่ค้างมือ, โบนัสน็อค) สำหรับหน้าสรุป
function endgameBreakdown(knockId) {
  var game = currentGame || {};
  if (!game.hands) return {};
  var ko = knockId || game.knockPlayerId || null;
  // FIX v39: ใช้สูตรกลางเดียวกับ computeRoundScoresFor (รวมโทษสเปโต + ผู้น็อคเหลือ 1 ใบ)
  var calc = computeRoundScoresFor(game, ko);
  return calc.breakdown || {};
}

function closeEndGame() {
  try {
    var modal = document.getElementById('endgame-modal');
    if (modal) modal.classList.remove('active');
  } catch(e) {}
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
    // FIX v39: คงยอดสะสมข้ามรอบ (เดิมรีเซ็ตทุกครั้ง → เกณฑ์ 500 แต้มใช้ไม่ได้)
    var prevTotal = (currentGame && (currentGame.totalScores || currentGame.scores)) || {};
    var deck = shuffle(makeDeck());
    var hands = {};
    var HAND_SIZE2 = pids.length === 2 ? 11 : pids.length === 3 ? 9 : 7;
    for (var pi = 0; pi < pids.length; pi++) { var h = []; for (var di = 0; di < HAND_SIZE2; di++) h.push(deck.pop().code); hands[pids[pi]] = h; }
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
      totalScores: {},
      round: (currentGame ? (currentGame.round || 1) : 1) + 1,
      turnStartTime: Date.now(),
      headCard: fc.code,
      headPoints: hp,
      hasFirstMeld: {},
      lastDiscard: null,
      deckEmpty: false,
      pickedFromDiscard: {},
      level: (currentGame && currentGame.level) || roomLevel,
      version: 1
    };
    for (var mi = 0; mi < pids.length; mi++) {
      gameData.melds[pids[mi]] = [];
      gameData.scores[pids[mi]] = prevTotal[pids[mi]] || 0;   // ยอดสะสมเดิม
      gameData.totalScores[pids[mi]] = prevTotal[pids[mi]] || 0;
      gameData.hasFirstMeld[pids[mi]] = false;
    }
    // FIX v39: รีเซ็ตโทษสเปโต + ผู้ทิ้งสเปโต ตอนขึ้นรอบใหม่
    gameData.spettoPenalty = {};
    gameData.spetoOrigin = {};
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
      var _data = await db.from('rooms').select('id,code,players,game,status,version,totalplayers').eq('id', rid).single();
      if (_data.error) {
        if (_data.status === 404) return;
        console.warn('[Poll] error:', _data.status, _data.error.message);
        return;
      }
      if (_data.data) {
        var remoteRoom = _data.data;
        if (remoteRoom.status === 'lobby') {
          var newTotal = remoteRoom.totalplayers || 4;
          var playersStr = JSON.stringify(remoteRoom.players || {});
          var curPlayersStr = JSON.stringify(currentLobbyPlayers || {});
          var totalChanged = newTotal !== totalPlayers;
          if (playersStr !== curPlayersStr || totalChanged) {
            currentLobbyPlayers = remoteRoom.players || {};
            totalPlayers = newTotal;
            renderLobby(currentLobbyPlayers, totalPlayers);
          }
        }
        if (remoteRoom.game) {
          var changed = JSON.stringify(remoteRoom.game) !== JSON.stringify(currentGame);
          if (changed) {
            console.log('[Poll] game changed, turn:', remoteRoom.game.turnPlayerId);
            currentGame = remoteRoom.game;
            currentRoomVersion = remoteRoom.version || currentRoomVersion;
            if (remoteRoom.status === 'playing') {
              renderGame(currentGame);
              // Also trigger bot from polling as backup
              if (currentGame.turnPlayerId && currentGame.turnPlayerId.indexOf('bot_') === 0) {
                var pid = currentGame.turnPlayerId;
                if (!botRunning[pid]) {
                  console.log('[Poll] triggering bot for', pid);
                  botRunning[pid] = true;
                  botWithTimeout(pid);
                }
              }
            } else if (remoteRoom.status === 'ended') {
              showEndGame(resolveEndGame(remoteRoom));
            }
          }
        }
      }
    } catch(e) { console.warn('[Poll] exception:', e.message); }
  }, 1500);
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
  console.log('[DummyRummy] v33 Loaded!');
  // Cleanup: delete ONLY empty lobby rooms older than 1 hour — safe for active rooms
  if (db) {
    (async function() {
      try {
        // Only delete rooms that are empty (no players) AND older than 1 hour
        var cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        var oldEmpty = await db.from('rooms').select('id').eq('status', 'lobby').eq('players', '{}').lt('created_at', cutoff).limit(20);
        if (oldEmpty.data && oldEmpty.data.length > 0) {
          for (var ri = 0; ri < oldEmpty.data.length; ri++) {
            await db.from('rooms').delete().eq('id', oldEmpty.data[ri].id);
            console.log('[Cleanup] deleted old empty room:', oldEmpty.data[ri].id);
          }
        }
      } catch(e) { console.warn('[Cleanup] skipped:', e.message); }
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


// --- จัดไพ่อัตโนมัติ (คล้ายต้นแบบ) ---
// จัดกลุ่มไพ่ที่เกิดเป็นชุด/ตองไว้ติดกัน แล้วไพ่ที่เหลือเรียงตามชุดและตัวเลข
function autoSortHand() {
  try {
    if (!currentGame || !currentGame.hands) return;
    var codes = (currentGame.hands[myPlayerId] || []).slice();
    if (codes.length === 0) return;
    var hand = codesToCards(codes);
    var groups = [];
    var used = {};
    var melds = findMelds(hand);
    for (var mi = 0; mi < melds.length; mi++) {
      var g = melds[mi].cards.map(function(c) { return c.code; });
      var fresh = g.filter(function(c) { return !used[c]; });
      if (fresh.length < 2) continue;
      fresh.forEach(function(c) { used[c] = true; });
      groups.push(fresh);
    }
    var rest = hand.filter(function(c) { return !used[c.code]; })
      .sort(function(a, b) {
        var s1 = {'\u2660':0,'\u2665':1,'\u2666':2,'\u2663':3}[a.suit] ?? 4;
        var s2 = {'\u2660':0,'\u2665':1,'\u2666':2,'\u2663':3}[b.suit] ?? 4;
        if (s1 !== s2) return s1 - s2;
        return (RANK_ORDER[a.rank]||14) - (RANK_ORDER[b.rank]||14);
      });
    var order = [];
    groups.forEach(function(g) { g.forEach(function(c) { order.push(c); }); });
    rest.forEach(function(c) { order.push(c.code); });
    myHandOrder = order;
    renderYourHand();
    notify('\uD83C\uDD00 �u0e08ัดไพ่ให้แล้ว (' + groups.length + ' ชุด)');
  } catch(e) { console.error('autoSortHand error:', e); }
}

// --- คัดลอก / แชร์รหัสห้อง ---
function copyRoomCode() {
  try {
    var code = roomCode || (document.getElementById('display-room-code')||{}).textContent;
    if (!code || code === '------') { notify('ยังไม่มีรหัสห้อง'); return; }
    var link = location.origin + location.pathname + '?room=' + code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function() {
        notify('\uD83D\uDCCB คัดลอกรหัสห้อง ' + code + ' แล้ว');
      }).catch(function() { fallbackCopy(code, link); });
    } else fallbackCopy(code, link);
  } catch(e) { console.error('copyRoomCode error:', e); }
}
function fallbackCopy(code, link) {
  try {
    var ta = document.createElement('textarea');
    ta.value = code + ' | ' + link;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    notify('\uD83D\uDCCB คัดลอกรหัสห้อง ' + code + ' แล้ว');
  } catch(e) { notify('รหัสห้อง: ' + code); }
}
function shareRoom() {
  try {
    var code = roomCode || '';
    if (!code) { notify('ยังไม่มีรหัสห้อง'); return; }
    var link = location.origin + location.pathname + '?room=' + code;
    var text = '\uD83C\uDFAE เล่นดัมมี่ด้วยกัน! รหัสห้อง: ' + code + ' (กดลิงก์เพื่อเข้าร่วม)';
    if (navigator.share) {
      navigator.share({ title: 'ดัมมี่ — ห้อง ' + code, text: text, url: link }).catch(function(){});
    } else {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link);
      notify('\uD83D\uDCC4 คัดลอกลิงก์เชิญแล้ว');
    }
  } catch(e) { console.error('shareRoom error:', e); }
}


// --- เล่นเร็ว: สร้างห้องแล้วเติมบอทให้จนเต็ม ---
var BOT_NAMES = ['🤖 บอทสอง', '🤖 บอทมีดี', '🤖 บอทแขง'];
async function quickPlay() {
  try {
    var nameEl = document.getElementById('create-name');
    var name = (nameEl && nameEl.value.trim()) || 'พีเอ';
    if (!db) { notify('กรุภาสักครู่... กดอีกครั้ง'); return; }
    var lvlEl = document.getElementById('room-level');
    roomLevel = lvlEl ? (parseFloat(lvlEl.value) || 1) : 1;
    var total = 4;
    var pcEl = document.getElementById('player-count');
    if (pcEl && pcEl.value === '2') total = 2;
    roomCode = genRoomCode();
    myName = name;
    myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
    var players = {};
    players[myPlayerId] = { id: myPlayerId, name: name, isBot: false, isHost: true };
    var botIdx = 0;
    for (var bi = 1; bi < total; bi++) {
      var bid = 'bot_' + bi;
      players[bid] = { id: bid, name: BOT_NAMES[botIdx % BOT_NAMES.length], isBot: true, isHost: false };
      botIdx++;
    }
    var up = await db.from('rooms').upsert({ id: roomCode, code: roomCode, players: players, status: 'lobby', totalplayers: total });
    if (up.error) { notify('❌ สร้างห้องไม่สำเจ'); return; }
    showScreen('lobby-screen');
    document.getElementById('display-room-code').textContent = roomCode;
    await setupRealtime(roomCode);
    renderLobby(players, total);
    updateLobbyLevelLabel();
    notify('⚡ เติมบอทแล้ว!');
    setTimeout(function() { startGame(); }, 600);
  } catch(e) { console.error('quickPlay error:', e); notify('❌ ผิดพาด: ' + e.message); }
}

function updateLobbyLevelLabel() {
  try {
    var el = document.getElementById('lobby-level');
    if (!el) return;
    var lv = roomLevel || 1;
    el.innerHTML = '🪙 ระดบห้อง: <b>' + lv + '</b>';
  } catch(e) {}
}

// --- Client-side scoring fallback (ไม่ต้องรอ SQL fix) ---
// คะแนน์ออบไปที่ game JSONB: game.winner / game.totalScores / game.roundScores
function saveEndStateClientSide(winner, totalScores, roundScores) {
  try {
    if (!currentGame) return Promise.resolve();
    currentGame.status = 'ended';
    currentGame.winner = winner;
    currentGame.totalScores = totalScores;
    currentGame.roundScores = roundScores;
    return db.from('rooms').update({ status: 'ended', game: currentGame }).eq('id', roomCode);
  } catch(e) { console.error('saveEndStateClientSide error:', e); return Promise.resolve(); }
}

// คำนณณเสลคะแนน์องเรอบ (จากอันมีเลียด้อย้วนไปตี่ game JSONB)
function computeRoundScores(koId) {
  var game = currentGame;
  if (!game) return { roundScores: {}, totalScores: {}, winner: null, knockBonus: 0 };
  // FIX v39: สูตรกลาง (รวมโทษสเปโต + ผู้น็อคเหลือ 1 ใบนับเป็นแต้มหัก)
  var calc = computeRoundScoresFor(game, koId);
  return { roundScores: calc.roundScores, totalScores: calc.totalScores, winner: calc.winner, knockBonus: calc.knockBonus, breakdown: calc.breakdown };
}

console.log('[DummyRummy] Script parsing OK!');
