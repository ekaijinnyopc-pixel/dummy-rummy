/* ============================================================
 * Dummy Rummy — กติกาโทษ -100 แบบใหม่ (3 กรณี)  [FIX v41 / 2026-10-23]
 * ------------------------------------------------------------
 * ⚠️ SERVER เป็นเจ้าของการคำนวณโทษฝั่งเดียว (play_turn ใน Supabase)
 *    → ไฟล์นี้เป็น "pure functions" ที่ใช้
 *      1) เตือนผู้เล่นฝั่ง client (UI) — ไม่หักแต้มเอง
 *      2) ใช้เป็นต้นแบบ (reference) ให้ SQL ฝั่ง server ทำงานเหมือนกัน
 *      3) ใช้ทดสอบด้วย Node (tools/test-speto-rules.js)
 *
 * กติกาที่ยืนยันแล้ว (ผู้เสียโทษ = คนทิ้ง เสมอ):
 *   2.1 "ทิ้งดัมมี่"  = ตอนทิ้งไพ่ใบหนึ่ง ถ้าไพ่ใบนั้นฝากต่อชุดเรียง/ชุดกอง
 *                      ไพ่ของผู้เล่นคนอื่นได้ → คนทิ้งเสีย -100 ทันที
 *   2.2 "ตีเต็ม"    = ตอนทิ้งไพ่ลงกองทิ้ง ถ้าหลังทิ้ง กองทิ้งมี "ชุดเกิด" ที่ครบ
 *                      (ตอง 3 ใบพร้อมกัน หรือ เรียง 3 ใบพร้อมกันของสีเดียวกัน)
 *                      และชุดเกิดนั้นมีไพ่ที่เพิ่งทิ้งอยู่ → คนทิ้งเสีย -100 ทันที
 *   2.3 "สเปโต"    = ตอนทิ้งสเปโต (2♣ หรือ Q♠) ลงกองทิ้ง ขณะที่กองทิ้งมี
 *                      "การ์ดเกี่ยวเนื่องสเปโต" → เกิดสถานะค้าง (pending)
 *                      ถ้าภายใน "1 รอบ" มีผู้หยิบสเปโตใบนั้นไป "เกิด" (MELD)
 *                      → คนทิ้งเสีย -100 / ถ้าผ่าน 1 รอบแล้วไม่มีใครเกิด → รอด
 *
 * คำนิยาม:
 *   - "การ์ดเกี่ยวเนื่องสเปโต" = ไพ่บนกองทิ้งที่
 *       (ก) มีตัวเลขเดียวกับสเปโต (2♣ กับ 2♠/2♥/2♦, Q♠ กับ Q♣/Q♥/Q♦) หรือ
 *       (ข) สีเดียวกับสเปโตและตัวเลขติดกัน (2♣ กับ 3♣/A♣, Q♠ กับ K♠/J♠/A♠)
 *   - "1 รอบ" = ครบ 1 รอบผู้เล่นทั้งโต๊ะ นับจากการทิ้ง
 *     (ผู้เล่นคนอื่นทยอยทิ้งไพ่จนกลับมาถึงตาคนทิ้งอีกครั้ง) → server ใช้ turnSeq
 *   - 2.1 ใช้ตรรกะ layoff ตามเกมนี้: สเปโตฝากได้เฉพาะชุดตอง
 *   - 2.3: LAYOFF (ฝาก) ไม่นับ — ต้องเป็น MELD (เกิด) เท่านั้น
 *   - ถ้าการทิ้งใบหนึ่งทำให้ 2.1 และ 2.2 พร้อมกัน → หัก -100 ครั้งเดียว
 * ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = factory(); }
  else { root.SpetoRules = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===== ค่าคงที่ (ต้องตรงกับฝั่ง SQL) =====
  var MAX_PENALTY_PER_DISCARD = 100;   // หักโทษรวมต่อ 1 การทิ้งไม่เกิน 100 (2.1+2.2 = 100 เดียว)
  var SPETO_CODES = ['2♣', 'Q♠'];
  var SUIT_CHARS = ['♠', '♥', '♦', '♣'];
  var RANK_VAL = {
    'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 10, 'J': 11, 'Q': 12, 'K': 13
  };

  // ===== ตัวช่วยพื้นฐาน =====
  function isSpeto(code) { return code === '2♣' || code === 'Q♠'; }

  function suit(code) {
    if (!code) return null;
    var last = code.charAt(code.length - 1);
    return SUIT_CHARS.indexOf(last) >= 0 ? last : null;
  }

  function rank(code) {
    if (!code || !suit(code)) return null;
    return code.substring(0, code.length - 1);
  }

  // A = 1 (ต่ำ) หรือ 14 (สูง)
  function rankVal(code, aHigh) {
    var r = rank(code);
    if (!r) return null;
    if (r === 'A') return aHigh ? 14 : 1;
    return RANK_VAL[r] != null ? RANK_VAL[r] : null;
  }

  // เลขติดกัน (A ต่ำ/สูง) — ใช้กับกติกา 2.3
  function adjacentRank(r1, r2) {
    if (!r1 || !r2) return false;
    var v1 = RANK_VAL[r1], v2 = RANK_VAL[r2];
    if (v1 == null || v2 == null) return false;
    if (Math.abs(v1 - v2) === 1) return true;                 // A(1) ติดกับ 2
    if (r1 === 'A' && (r2 === 'K' || r2 === 'Q')) return true;  // A สูง (เรียง Q-K-A)
    if (r2 === 'A' && (r1 === 'K' || r1 === 'Q')) return true;
    return false;
  }

  // ===== ตรวจชุด (กอง / มือ) =====
  // ตอง: ตัวเลขเดียวกัน >= 3 ใบ คนละสำเนา (สเปโตเข้าตองได้)
  function isSetOf(codes) {
    if (!codes || codes.length < 3) return false;
    var first = null, suits = {}, i, r, s;
    for (i = 0; i < codes.length; i++) {
      r = rank(codes[i]); s = suit(codes[i]);
      if (!r || !s) return false;
      if (first === null) first = r;
      else if (first !== r) return false;
      if (suits[s]) return false;      // สำเนาซ้ำ
      suits[s] = true;
    }
    return true;
  }

  function runValues(codes, aHigh) {
    var vals = [], i, v;
    if (!codes) return null;
    for (i = 0; i < codes.length; i++) {
      if (isSpeto(codes[i])) return null;    // สเปโตห้ามอยู่ในชุดเรียง
      v = rankVal(codes[i], aHigh);
      if (v == null) return null;
      vals.push(v);
    }
    vals.sort(function (a, b) { return a - b; });
    return vals;
  }

  function runValuesOk(vals) {
    if (!vals || vals.length < 3) return false;
    for (var i = 1; i < vals.length; i++) if (vals[i] !== vals[i - 1] + 1) return false;
    return true;
  }

  // เรียง: สีเดียวกัน เลขติดกัน >= 3 ใบ (A ต่ำ/สูงได้ — K-A-2 ไม่เกิด)
  function isRunOf(codes) {
    if (!codes || codes.length < 3) return false;
    var s = suit(codes[0]), i;
    if (!s) return false;
    for (i = 1; i < codes.length; i++) if (suit(codes[i]) !== s) return false;
    if (runValuesOk(runValues(codes, false))) return true;
    return runValuesOk(runValues(codes, true));
  }

  // ชนิดชุด: 'set' | 'run' | null
  function meldType(codes) {
    if (isSetOf(codes)) return 'set';
    if (isRunOf(codes)) return 'run';
    return null;
  }

  // ===== 2.1 — ไพ่ใบนี้ "ฝากต่อ" ชุดนี้ได้ไหม =====
  function canLayoff(cardCode, meldCodes) {
    if (!cardCode || !meldCodes || meldCodes.length === 0) return false;
    var type = meldType(meldCodes);
    var i, r, s, used = {}, vals, min, max, hv, aHigh;
    if (type === 'set') {
      r = rank(cardCode);
      if (!r || r !== rank(meldCodes[0])) return false;
      for (i = 0; i < meldCodes.length; i++) {
        if (meldCodes[i] === cardCode) return false;   // อยู่ในชุดอยู่แล้ว
        used[suit(meldCodes[i])] = true;
      }
      return !used[suit(cardCode)];
    }
    if (type === 'run') {
      s = suit(meldCodes[0]);
      if (suit(cardCode) !== s) return false;
      if (isSpeto(cardCode)) return false;               // สเปโตฝากลงชุดเรียงไม่ได้
      // ลองทั้งแบบ A ต่ำ และ A สูง (A-2-3 หรือ Q-K-A)
      for (aHigh = false; aHigh !== true; aHigh = true) {
        vals = runValues(meldCodes, aHigh);
        if (!runValuesOk(vals)) continue;
        min = vals[0]; max = vals[vals.length - 1];
        hv = rankVal(cardCode, aHigh);
        if (hv == null) continue;
        if (hv === min - 1 || hv === max + 1) return true;
      }
      return false;
    }
    return false;
  }

  // ===== 2.2 — ทิ้งแล้วกองทิ้งมี "ชุดเกิด" ครบที่มีไพ่ที่เพิ่งทิ้งอยู่ไหม =====
  function pileHasMeldWith(pileCodes, cardCode) {
    var pile = (pileCodes || []).slice(), i, v;
    var same = [], suitCards = [], vals = [], map = {}, t, up, down, aHigh, r, s;
    if (!cardCode) return false;
    if (pile.indexOf(cardCode) === -1) pile.push(cardCode);

    // (ก) ตอง 3 ใบพร้อมกัน
    r = rank(cardCode);
    if (r) {
      for (i = 0; i < pile.length; i++) if (rank(pile[i]) === r) same.push(pile[i]);
      if (isSetOf(same)) return true;
    }
    // (ข) เรียง 3 ใบพร้อมกันของสีเดียวกัน (สเปโตห้ามอยู่ในชุดเรียง)
    if (isSpeto(cardCode)) return false;
    s = suit(cardCode);
    for (i = 0; i < pile.length; i++) {
      if (suit(pile[i]) === s && !isSpeto(pile[i])) suitCards.push(pile[i]);
    }
    if (suitCards.length < 3) return false;
    for (aHigh = false; aHigh !== true; aHigh = true) {
      vals = []; map = {};
      for (i = 0; i < suitCards.length; i++) {
        v = rankVal(suitCards[i], aHigh);
        if (v == null) continue;
        vals.push(v); map[v] = true;
      }
      t = rankVal(cardCode, aHigh);
      if (t == null || !map[t]) continue;
      up = 0; while (map[t + up + 1]) up++;
      down = 0; while (map[t - down - 1]) down++;
      if (up + down + 1 >= 3) return true;
    }
    return false;
  }

  // ===== 2.3 — กองทิ้งมี "การ์ดเกี่ยวเนื่องสเปโต" ไหม =====
  function spetoRelated(spetoCode, pileCodes) {
    if (!isSpeto(spetoCode)) return false;
    var pr = rank(spetoCode), ps = suit(spetoCode), i, c, cr, cs;
    if (!pr || !ps) return false;
    var pile = pileCodes || [];
    for (i = 0; i < pile.length; i++) {
      c = pile[i];
      if (!c || c === spetoCode) continue;
      cr = rank(c); cs = suit(c);
      if (!cr || !cs) continue;
      if (cr === pr) return true;                                   // (ก) ตัวเลขเดียวกัน
      if (cs === ps && adjacentRank(cr, pr)) return true;           // (ข) สีเดียวกัน + เลขติดกัน
    }
    return false;
  }

  // ===== คาดการณ์โทษตอนทิ้งไพ่ (ใช้เตือนผู้เล่น — หักจริงที่ server) =====
  //   game = game JSONB, pid = ผู้ทิ้ง, cardCode = ไพ่ที่จะทิ้ง
  function predictDiscardPenalty(game, pid, cardCode) {
    var res = { dumy: false, full: false, speto: false, penalty: 0, reasons: [] };
    if (!game || !cardCode) return res;
    var pile = game.discardPile || [];

    // 2.1 ทิ้งดัมมี่ — ฝากต่อชุดของผู้เล่นคนอื่นได้
    var melds = game.melds || {};
    for (var owner in melds) {
      if (owner === pid) continue;
      var list = melds[owner] || [];
      for (var mi = 0; mi < list.length; mi++) {
        if (canLayoff(cardCode, list[mi])) { res.dumy = true; res.reasons.push('2.1'); break; }
      }
      if (res.dumy) break;
    }

    // 2.2 ตีเต็ม — ทิ้งแล้วกองทิ้งมีชุดเกิดครบ (ที่มีไพ่ที่ทิ้งอยู่)
    res.full = pileHasMeldWith(pile, cardCode);
    if (res.full) res.reasons.push('2.2');

    // 2.3 สเปโต — ทิ้งสเปโตทั้งที่กองทิ้งมีการ์ดเกี่ยวเนื่องสเปโต (จะค้างรอ 1 รอบ)
    res.speto = isSpeto(cardCode) && spetoRelated(cardCode, pile);
    if (res.speto) res.reasons.push('2.3');

    res.penalty = (res.dumy || res.full) ? MAX_PENALTY_PER_DISCARD : 0;
    return res;
  }

  // pending สเปโตที่ "คนทิ้ง" ยังเสี่ยงอยู่ (server เป็นเจ้าของ — client แค่แสดงผล)
  function pendingCodesFor(game, pid) {
    var out = [], pending = (game && game.spetoPending) || {};
    for (var code in pending) {
      if (pending[code] && pending[code].discarder === pid) out.push(code);
    }
    return out;
  }

  // ===== 2.3 — ตัวช่วยจัดการ "pending" (ตรงกับฝั่ง SQL: play_turn) =====
  // สร้าง pending ตอนทิ้งสเปโต (หมดอายุเมื่อตากลับมาที่คนทิ้ง = ผ่าน 1 รอบ)
  function makeSpetoPending(code, discarder, turnSeq, nPlayers) {
    return {
      discarder: discarder,
      expiresAtTurn: (turnSeq || 0) + 1 + Math.max(0, (nPlayers || 1) - 1),
      code: code
    };
  }
  // ตรวจตอน "MELD" — คืนคนที่ต้องโดนโทษ (null = รอด/ไม่มี pending)
  function pendingTrigger(pending, code, turnSeq) {
    if (!pending || !pending[code]) return null;
    var info = pending[code] || {};
    var expires = (info.expiresAtTurn != null) ? info.expiresAtTurn : 0;
    if ((turnSeq || 0) < expires) {
      return { discarder: info.discarder, penalty: MAX_PENALTY_PER_DISCARD };
    }
    return null;    // หมดอายุแล้ว = ผ่าน 1 รอบ → รอด ไม่เสียแต้ม
  }
  // ล้าง pending ที่หมดอายุ (เรียกเมื่อเดินตา)
  function pruneExpiredPending(pending, turnSeq) {
    var out = {};
    for (var code in (pending || {})) {
      var info = pending[code] || {};
      var expires = (info.expiresAtTurn != null) ? info.expiresAtTurn : 0;
      if ((turnSeq || 0) < expires) out[code] = info;
    }
    return out;
  }

  return {
    MAX_PENALTY_PER_DISCARD: MAX_PENALTY_PER_DISCARD,
    SPETO_CODES: SPETO_CODES,
    isSpeto: isSpeto,
    suit: suit,
    rank: rank,
    rankVal: rankVal,
    adjacentRank: adjacentRank,
    isSetOf: isSetOf,
    isRunOf: isRunOf,
    meldType: meldType,
    canLayoff: canLayoff,
    pileHasMeldWith: pileHasMeldWith,
    spetoRelated: spetoRelated,
    predictDiscardPenalty: predictDiscardPenalty,
    pendingCodesFor: pendingCodesFor,
    makeSpetoPending: makeSpetoPending,
    pendingTrigger: pendingTrigger,
    pruneExpiredPending: pruneExpiredPending
  };
});
