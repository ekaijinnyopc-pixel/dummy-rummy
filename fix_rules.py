#!/usr/bin/env python3
with open('/data/.openclaw/workspace/dummy-rummy/game-core.js', 'r') as f:
    content = f.read()

# 1. Remove jokers from deck
old = "  deck.push({ suit: '♣', rank: '2', code: '2♣', isSpeto: true });\n  deck.push({ suit: '♠', rank: 'Q', code: 'Q♠', isSpeto: true });\n  deck.push({ suit: '🃏', rank: 'JOKER', code: 'JOKER1', isJoker: true });\n  deck.push({ suit: '🃏', rank: 'JOKER', code: 'JOKER2', isJoker: true });"
content = content.replace(old, "  // NO jokers - standard 52 cards only")

# 2. Fix cardPoints - no jokers, speto handled separately
old = "function cardPoints(card) {\n  if (!card) return 0;\n  if (card.isJoker || card.isSpeto) return 50;\n  if (card.rank === 'A') return 15;\n  if (['J','Q','K'].indexOf(card.rank) >= 0) return 10;\n  return parseInt(card.rank) || 0;\n}"
content = content.replace(old, "function cardPoints(card) {\n  if (!card) return 0;\n  if (card.isSpeto) return 50;\n  if (card.rank === 'A') return 15;\n  if (['J','Q','K'].indexOf(card.rank) >= 0) return 10;\n  if (['2','3','4','5','6','7','8','9'].indexOf(card.rank) >= 0) return 5;\n  return 0;\n}")

# 3. Remove joker from sortOrder
old = "    if (a.isJoker && !b.isJoker) return 1;\n    if (!a.isJoker && b.isJoker) return -1;\n    if (a.isSpeto && !b.isSpeto) return 1;\n    if (!a.isSpeto && b.isSpeto) return -1;"
content = content.replace(old, "    if (a.isSpeto && !b.isSpeto) return 1;\n    if (!a.isSpeto && b.isSpeto) return -1;")

# 4. Remove joker from codeToCard
old = "  if (code === 'JOKER1') return { suit: '🃏', rank: 'JOKER', code: 'JOKER1', isJoker: true };\n  if (code === 'JOKER2') return { suit: '🃏', rank: 'JOKER', code: 'JOKER2', isJoker: true };"
content = content.replace(old, "  // No jokers")

# 5. Remove joker from findMelds
old = "  var normals = hand.filter(function(c) { return !c.isJoker && !c.isSpeto; });\n  var jokers = hand.filter(function(c) { return c.isJoker; });"
content = content.replace(old, "  var normals = hand.filter(function(c) { return !c.isSpeto; });\n  var jokers = []; // No jokers in standard Dummy Rummy")

# 6. Remove joker from handCardClass
old = "function handCardClass(card) {\n  if (!card) return 'black';\n  if (card.isJoker) return 'joker';\n  if (card.isSpeto) return 'speto';\n  if (card.suit === '♥' || card.suit === '♦') return 'red';\n  return 'black';\n}"
content = content.replace(old, "function handCardClass(card) {\n  if (!card) return 'black';\n  if (card.isSpeto) return 'speto';\n  if (card.suit === '♥' || card.suit === '♦') return 'red';\n  return 'black';\n}")

# 7. Remove joker from miniCardClass
old = "function miniCardClass(card) {\n  if (!card) return 'black';\n  if (card.isJoker) return 'joker';\n  if (card.isSpeto) return 'speto';\n  if (card.suit === '♥' || card.suit === '♦') return 'red';\n  return 'black';\n}"
content = content.replace(old, "function miniCardClass(card) {\n  if (!card) return 'black';\n  if (card.isSpeto) return 'speto';\n  if (card.suit === '♥' || card.suit === '♦') return 'red';\n  return 'black';\n}")

# 8. Remove joker from renderMiniCard
old = "  var rank = card.isJoker ? 'J' : card.rank;\n  var suit = card.isJoker ? '★' : card.suit;"
content = content.replace(old, "  var rank = card.rank;\n  var suit = card.suit;")

# 9. Remove joker from meld display
old = "    html += '<div class=\"meld-set\" onclick=\"selectMeld(' + mi + ')\">' + cardsHtml + '<div style=\"width:100%;font-size:0.7rem;color:#888;text-align:center;margin-top:4px\">' + (meld.type === 'set' ? 'ตอง' : 'เรียง') + (meld.jokerUsed ? ' ✨' : '') + '</div></div>';"
content = content.replace(old, "    html += '<div class=\"meld-set\" onclick=\"selectMeld(' + mi + ')\">' + cardsHtml + '<div style=\"width:100%;font-size:0.7rem;color:#888;text-align:center;margin-top:4px\">' + (meld.type === 'set' ? 'ตอง' : 'เรียง') + '</div></div>';")

# 10. Fix renderCardEl - remove joker references
old = "    var extraTag = '';\n      if (card.isSpeto) extraTag = '<span class=\"ctag\">สเปโต</span>';\n      if (card.isJoker) extraTag = '<span class=\"ctag\">โจ๊ก</span>';"
content = content.replace(old, "    var extraTag = '';\n      if (card.isSpeto) extraTag = '<span class=\"ctag\">สเปโต</span>';")

# 11. Remove joker from discardSelected notification
old = "    notify('🗑️ หยิบ: ' + (topCard ? topCard.rank + topCard.suit : top));"
content = content.replace(old, "    notify('🗑️ หยิบ: ' + (topCard ? topCard.rank + topCard.suit : top));")

# 12. Remove joker from renderCardSmall
old = "  var rank = card.isJoker ? 'J' : card.rank;\n  var suit = card.isJoker ? '★' : card.suit;"
content = content.replace(old, "  var rank = card.rank;\n  var suit = card.suit;")

with open('/data/.openclaw/workspace/dummy-rummy/game-core.js', 'w') as f:
    f.write(content)

print("Done writing!")
