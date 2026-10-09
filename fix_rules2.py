#!/usr/bin/env python3
with open('/data/.openclaw/workspace/dummy-rummy/game-core.js', 'r') as f:
    content = f.read()

# ============================================================
# FIX 1: Start game - track head card properly
# ============================================================
old_start = """    var discardPile = [firstCard];\n    var gameData = {"""
new_start = """    // First discard becomes head card with points
    var headCard = firstCard;
    var headPoints = 50;
    if (headCard.code === '2♣' || headCard.code === 'Q♠') headPoints = 100;
    var gameData = {"""
content = content.replace(old_start, new_start)

# Add headCard and headPoints to gameData
old_gd = """      round: 1,\n      turnStartTime: Date.now()\n    };"""
new_gd = """      round: 1,\n      turnStartTime: Date.now(),\n      headCard: headCard,\n      headPoints: headPoints,\n      hasFirstMeld: {},  // track who has melded first time\n      pickedFromDiscard: {}  // track who picked from discard this turn\n    };"""
content = content.replace(old_gd, new_gd)

# ============================================================
# FIX 2: hasFirstMeld initialization
# ============================================================
old_init_meld = """    for (var mi = 0; mi < playerIds.length; mi++) {\n      gameData.melds[playerIds[mi]] = [];\n      gameData.scores[playerIds[mi]] = 0;\n    }"""
new_init_meld = """    for (var mi = 0; mi < playerIds.length; mi++) {\n      gameData.melds[playerIds[mi]] = [];\n      gameData.scores[playerIds[mi]] = 0;\n      gameData.hasFirstMeld[playerIds[mi]] = false;\n    }"""
content = content.replace(old_init_meld, new_init_meld)

# ============================================================
# FIX 3: pickDiscard - must meld immediately
# ============================================================
old_pick = """async function pickDiscard() {\n  try {\n    if (!currentGame || !myTurn || currentGame.phase !== 'draw') return;\n    var discard = currentGame.discardPile.slice();\n    if (discard.length === 0) return;\n    var top = discard.pop();"""
new_pick = """async function pickDiscard() {\n  try {\n    if (!currentGame || !myTurn || currentGame.phase !== 'draw') return;\n    var discard = currentGame.discardPile.slice();\n    if (discard.length === 0) return;\n    var top = discard.pop();\n    // Check if player can meld with this card immediately\n    var testHand = (currentGame.hands[myPlayerId] || []).concat([top.code || top.code]);\n    var meldsFound = findMelds(codesToCards(testHand));\n    if (meldsFound.length === 0) {\n      notify('❌ ต้องเกิดทันทีเมื่อหยิบจากกองกลาง! ไม่มีชุดที่เกิดได้');\n      return;\n    }"""
content = content.replace(old_pick, new_pick)

# ============================================================
# FIX 4: advanceTurn - reset pickedFromDiscard
# ============================================================
old_adv = """    var updatedGame = Object.assign({}, currentGame, { turnPlayerId: nextPid, phase: 'draw', turnStartTime: Date.now() });"""
new_adv = """    var updatedGame = Object.assign({}, currentGame, { turnPlayerId: nextPid, phase: 'draw', turnStartTime: Date.now(), pickedFromDiscard: {} });"""
content = content.replace(old_adv, new_adv)

# ============================================================
# FIX 5: handleKnockout - apply proper scoring rules
# ============================================================
old_ko = """async function handleKnockout(koId) {\n  try {\n    var _data = await db.from('rooms').select('*').eq('id', roomCode).single();\n    if (!_data.data) return;\n    var players = _data.data.players || {};\n    var game = currentGame;\n    var allDeck = makeDeck();\n    var allCodes = {};\n    for (var di = 0; di < allDeck.length; di++) allCodes[allDeck[di].code] = allDeck[di];\n    var roundScores = {};\n    for (var pid in game.hands) {\n      var pts = 0;\n      for (var ci = 0; ci < game.hands[pid].length; ci++) {\n        var c = allCodes[game.hands[pid][ci]];\n        if (c) pts += cardPoints(c);\n      }\n      roundScores[pid] = pts;\n    }\n    roundScores[koId] = 0;\n    var prevScores = (_data.data.game && _data.data.game.scores) || {};\n    var totalScores = {};\n    for (var ti = 0; ti < game.playerOrder.length; ti++) {\n      var tpid = game.playerOrder[ti];\n      totalScores[tpid] = (prevScores[tpid] || 0) + (roundScores[tpid] || 0);\n    }\n    var winner = null;\n    for (var wid in totalScores) {\n      if (totalScores[wid] >= 500) {\n        var min = Infinity, winPid = null;\n        for (var w2 in totalScores) { if (totalScores[w2] < min) { min = totalScores[w2]; winPid = w2; } }\n        winner = winPid; break;\n      }\n    }\n    await db.from('rooms').update({ status: 'ended', winner: winner, totalScores: totalScores }).eq('id', roomCode);\n    showEndGame({ winner: winner, totalScores: totalScores, roundScores: roundScores, players: players });\n  } catch(e) { console.error('handleKnockout error:', e); }\n}"""
content = content.replace(old_ko, new_ko)

with open('/data/.openclaw/workspace/dummy-rummy/game-core.js', 'w') as f:
    f.write(content)
print("Part 1 done!")
