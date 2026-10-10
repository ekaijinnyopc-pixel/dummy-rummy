# 🃏 Dummy Rummy — รายงานทดสอบ Join/Lobby/Game

**วันที่ทดสอบ:** 2026-10-11 (GMT+8)
**URL ที่ทดสอบ:** https://dummy-rummy.vercel.app
**Supabase Project:** dbtlbeymrchodloboymr
**Browser:** Chromium (openclaw profile)
**Strategy:** 5 tabs in same browser (แต่ละ tab = player แยกเพราะ playerId generate ใหม่ทุก join/create)

---

## ⚠️ สรุประดับสูง (Executive Summary)

**❌ แอปยังไม่พร้อมใช้งานจริงในโหมด multiplayer** — เจอบั๊ก critical 4 ตัวที่ทำให้ multiplayer ใช้งานไม่ได้

| # | หัวข้อ | ผลลัพธ์ DB | ผลลัพธ์ UI | หมายเหตุ |
|---|--------|------------|-----------|----------|
| 1 | สร้างห้อง | ✅ | ✅ | ทำงานปกติ |
| 2 | คนที่ 2 เข้าห้อง | ✅ DB 2 players | ⚠️ Tab1 UI ไม่ auto-update | **Realtime ไม่ทำงาน update UI ของ host** |
| 3 | คนที่ 3 เข้าห้อง | ✅ DB 3 players | ⚠️ Tab1, Tab2 UI ไม่ update | **Realtime broadcast ไม่ส่งถึงทุกคน** |
| 4 | คนที่ 4 เข้าห้อง | ✅ DB 4 players | ⚠️ Tab1, Tab2, Tab3 UI เก่า | เฉพาะ Tab ที่ join ล่าสุดเห็น 4 คน |
| 5 | คนที่ 5 เข้าห้องเต็ม | ✅ ถูกปฏิเสธ | ✅ ขึ้น "❌ ห้องเต็มแล้ว" | ทำงานถูก |
| 6 | ออกจากห้อง | ✅ DB ลดเหลือ 3 | ⚠️ UI อื่น stale | UI ของ Tab ที่เหลือไม่ refresh |
| 7 | เข้าใหม่หลังคนออก | ✅ DB 4 players | ✅ UI ใหม่เห็น 4 คน | ทำงาน (rejoin เห็น players ใหม่) |
| 8 | Start game | ✅ DB status=playing | ❌ **Tab อื่นไม่เปลี่ยนหน้า** | **Critical — เกมเริ่มแล้วแต่ผู้เล่นอื่นไม่รู้** |
| 9 | ล็อคห้อง | — | — | ไม่มีปุ่มล็อค (ตามที่ระบุ) |
| 10 | Cleanup | ✅ | — | ลบห้องทดสอบเรียบร้อย |

---

## 🐛 Bugs ที่เจอ (เรียงตามความร้ายแรง)

### 🔴 BUG #1: Cleanup script ลบ lobby rooms ทุกครั้งที่ page load
**Location:** `game-core.js` lines 1459-1477 (DOMContentLoaded handler)
**Code:**
```js
// Cleanup: delete rooms still in lobby (never started) — skip 'playing' rooms
if (db) {
  (async function() {
    try {
      var lobbies = await db.from('rooms').select('id, status').eq('status', 'lobby').limit(20);
      if (lobbies.data && lobbies.data.length > 0) {
        for (var ri = 0; ri < lobbies.data.length; ri++) {
          await db.from('rooms').delete().eq('id', lobbies.data[ri].id).eq('status', 'lobby');
        }
      }
    } catch(e) { console.warn('[Cleanup] skipped:', e.message); }
  })();
}
```
**Impact:** 
- ทุก tab ที่โหลดหน้า home จะลบ lobby room ของทุกคนทันที
- ถ้ามีคนกำลังสร้างห้องรอเพื่อนอยู่ แล้วเพื่อนเปิดแอป → ห้องหายทันที
- **ห้ามแก้โดยการเพิ่ม WHERE clause แบบนี้แล้วเปิดใหม่ใน 30 วิ**
**ทำให้ทดสอบครั้งแรก fail ทั้งหมด** (ต้องเปิด tabs ทั้งหมดก่อนแล้วค่อยสร้างห้องทีหลัง)

**แนะนำแก้:** ใช้ `created_at < now() - interval '1 hour'` หรือลบเฉพาะห้องที่ player 0 คนมานานแล้ว ไม่ใช่ลบทุก lobby

### 🔴 BUG #2: Race condition ใน joinRoom() — ไม่มี optimistic concurrency
**Location:** `game-core.js` lines 477-505 (joinRoom function)
**Code:**
```js
var _data = await db.from('rooms').select(...).eq('id', code).single();
var room = _data.data;
// ... 
var players = Object.assign({}, room.players || {});
players[myPlayerId] = { ... };  // <-- อ่าน snapshot แล้วเขียนทับทันที
await db.from('rooms').update({ players: players }).eq('id', code);  // <-- เขียนทับของเดิม
```
**Impact:**
- ถ้า 2 คน join พร้อมกัน → คนที่ update ทีหลัง "ลบ" คนแรกออกจากห้อง
- ทดสอบจริง: เรียก joinRoom() พร้อมกัน 3 tabs → DB มีแค่ 2 คน (1 คนถูกเขียนทับ)
- ต้อง join ทีละคน ห่างกัน ≥ 2 วินาที ถึงจะปลอดภัย

**แนะนำแก้:** ใช้ Postgres RPC ที่เช็ค `version` ก่อน update (เหมือนที่ทำใน `play_turn` RPC) หรือใช้ Supabase Realtime + re-fetch + retry

### 🔴 BUG #3: Polling ไม่อัปเดต lobby players (อัปเดตแค่ game state)
**Location:** `game-core.js` lines 1410-1433
**Impact:**
- Polling ทำงานทุก 1.5 วินาที แต่ logic เช็คแค่ `if (remoteRoom.game)` ก่อน render
- ถ้า status='lobby' (game = null) → polling ไม่ render อะไรเลย
- Lobby player list ไม่ refresh อัตโนมัติเลย (ต้อง reload page)

### 🔴 BUG #4: Realtime subscription ไม่ fire สำหรับทุก client
**Location:** `game-core.js` lines 412-419 (`setupRealtime`)
**Impact:**
- ทดสอบจริง: Tab4 join หลังสุด เห็น 4 คนใน lobby (มี realtime update จากตัวเอง) แต่ Tab1, Tab2, Tab3 ที่ join ก่อนหน้า **ไม่เห็น Tab4** ใน lobby
- สาเหตุน่าจะเป็นเพราะ `filter:'id=eq.'+rid` ทำงานไม่สมบูรณ์ + Supabase Realtime มี RLS ที่ block anon
- ผลกระทบร้ายแรงที่สุด: **เมื่อ Tab1 กด Start Game → DB status='playing' → Tab อื่นไม่ได้รับ broadcast** → ผู้เล่นอื่นยังอยู่หน้า lobby ที่แสดง "รอผู้เล่นคนที่ 3" ขณะที่เกมเริ่มไปแล้ว

---

## 🧪 Test Detail (ทุกข้อที่ทดสอบ)

### Test 1: สร้างห้อง ✅ PASSED
- Tab1 สร้างห้อง → ได้ code `YHMVX3` (ครั้งแรก) และ `F4PJZU` (รอบที่ใช้ทดสอบจริง)
- DB: มี row ครบ `id, code, players, status='lobby', version=1, totalplayers=4, game=null`
- UI: Tab1 แสดง lobby พร้อม "รหัสห้อง: F4PJZU", player slot 1 = Tab1-Host (คุณ)
- **หมายเหตุ:** version ของ room ไม่ได้อัปเดตเมื่อมีคน join/leave (อาจเป็น bug เอง หรือไม่ได้ใช้)

### Test 2: คนที่ 2 เข้าห้อง ⚠️ PASSED (DB) / FAIL (UI sync)
- Tab2 ใส่ code `F4PJZU` + click join → เข้าสำเร็จ (notification "✅ เข้าห้องสำเร็จ!")
- DB: มี 2 players (Tab1, Tab2) ✅
- Tab2 lobby UI: แสดง Tab1 + Tab2 ✅
- **Tab1 lobby UI: ยังแสดงแค่ Tab1 (3 empty slots) ❌** — ต้องใช้ `evaluate()` call `renderLobby()` manual ถึงจะเห็น

### Test 3: คนที่ 3 เข้าห้อง ⚠️ PASSED (DB) / FAIL (UI sync)
- Tab3 join หลังจาก Tab2 (delay ~2s เพื่อหลีกเลี่ยง race condition)
- DB: 3 players ✅
- **Tab3, Tab4 lobby UI: stale ❌** — Tab4 ที่ join หลังสุดเห็นทั้งหมด Tab1, Tab2, Tab3
- **Tab1, Tab2 lobby UI: ไม่ update ❌**

### Test 4: คนที่ 4 เข้าห้อง ⚠️ PASSED (DB) / FAIL (UI sync)
- Tab4 join ตามด้วย delay
- DB: 4 players (Tab1, Tab2, Tab3, Tab4) ✅
- **Tab4 lobby UI: เห็นทั้ง 4 คน ✅**
- Tab1, Tab2, Tab3 lobby UI: stale ❌

### Test 5: ห้องเต็ม 4 คน ✅ PASSED
- Tab5 พยายาม join ห้องที่มี 4 คนเต็ม
- Notification: **"❌ ห้องเต็มแล้ว"** ✅
- DB: ยังคง 4 players (Tab5 ไม่ถูกเพิ่ม) ✅

### Test 6: ออกจากห้อง ⚠️ PASSED (DB) / FAIL (UI sync)
- Tab2 เรียก `leaveRoom()`
- DB: 3 players (Tab1, Tab3, Tab4 — Tab2 หายไป) ✅
- Tab2: กลับหน้า home ✅
- Tab1, Tab3, Tab4 lobby UI: stale — ยังแสดง Tab2 (Tab4) หรือไม่แสดง Tab4 (Tab3) ❌

### Test 7: เข้าห้องใหม่หลังคนออก ✅ PASSED
- Tab5 (ที่เคยถูก reject) join ห้องเดิม
- DB: 4 players (Tab1, Tab3, Tab4, Tab5) ✅
- Tab5 lobby UI: เห็นทั้ง 4 คน ✅ (Tab5 join ล่าสุด)

### Test 8: Start game 🔴 CRITICAL FAIL
- Tab1 เรียก `startGame()`
- DB: `status='playing'`, `game` object มีครบ (deck, hands, playerOrder, turnPlayerId, phase='draw') ✅
- **Tab1: navigate ไป game-screen สำเร็จ ✅ — แสดงไพ่ 7 ใบ, เห็น opponent 3 คน**
- **Tab3, Tab4, Tab5: ยังอยู่หน้า lobby ❌** — ไม่ auto-navigate ไป game-screen
- ทดสอบ manual `showScreen('game-screen'); renderGame(currentGame)` ใน Tab3 → ทำงานได้ปกติ (เห็นไพ่, เห็น opponents, เห็น turn indicator)
- **ผลกระทบ: ผู้เล่นจริงต้อง refresh page ทุกครั้งที่มีคน start game — ใช้งานไม่ได้**

### Test 9: ล็อคห้อง — N/A
- HTML และ button list ไม่มีคำว่า "lock" หรือ "ล็อค"
- ไม่มี feature นี้ (ตามที่ระบุในงาน)

### Test 10: Cleanup ✅ PASSED
- DELETE `/rest/v1/rooms?id=eq.F4PJZU` → 200 OK, row ถูกลบ
- DB ตอนนี้เหลือแต่ playing rooms เก่า 20 ห้อง (จากการทดสอบก่อนหน้า) + 0 lobby rooms

---

## 🔬 สิ่งที่ตรวจพบเพิ่มเติม

### 406 Schema Cache Error
- Browser บ่น 406 ทุกครั้งที่ query ห้องที่ไม่มี + `.single()`
- แต่ curl ตรงๆ ได้ 200 (ไม่ใช่ schema cache จริง — เป็น `.single()` ที่โยน 406 เมื่อ result count != 1)
- มี comment `// hotfix: เปลี่ยน select('*') → explicit columns เพื่อหลีก schema cache 406 error` ใน game-core.js v30 แต่ยังไม่ช่วย
- **ข้อแนะนำ:** ใช้ `.maybeSingle()` แทน `.single()` หรือเช็ค `result.data` แทน `result.error.status === 406`

### RLS เปิดให้ anon DELETE/UPDATE ได้
- DELETE ผ่าน anon key สำเร็จ → RLS ไม่ได้ป้องกัน
- นี่คือเหตุผลที่ BUG #1 สามารถลบห้องคนอื่นได้
- **ควรเพิ่ม RLS policy** หรือใช้ service_role key ใน cleanup job

### playerId generate ใหม่ทุกครั้ง
- `myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9)` — random ใหม่ทุกครั้งที่ joinRoom/createRoom
- **ไม่ persist ใน localStorage** (verified: `localStorage.keys() = []`)
- **ผลกระทบ:** ถ้า user refresh page ขณะอยู่ในห้อง → playerId เปลี่ยน → ตัวเองหายไปจากห้อง (เหมือน leave แล้ว rejoin เป็นคนใหม่)
- ในทางทฤษฎี user คนเดียวกันอาจเป็น player หลายคนในห้องเดียวกันถ้าเปิดหลาย tab

### Polling Logic Bug
- `startPolling()` ใช้ `setInterval` แต่ถ้า `roomCode` ถูก reset เป็น null มัน clear interval ทันที (ดี)
- แต่: ตอน `leaveRoom()` reset `roomCode = null` ก่อนเรียก `stopPolling()` → polling cycle ก่อนหน้านั้นอาจ query ห้องที่หายแล้ว → ได้ 406
- ถ้า room ถูกลบไปแล้วตอน polling → log error 406 ทุก 1.5s (เห็นใน console Tab1 ระหว่าง test rooms เก่า)

### Player Count Logic
- `totalplayers` column ถูก set ตอนสร้างห้อง (2, 3, หรือ 4)
- ห้องที่ join ผ่าน "เข้าห้อง" ใช้ `room.totalplayers` ของห้องเดิม (เปลี่ยนไม่ได้)
- ในทางปฏิบัติ host สร้าง 4 คน → join ได้แค่ 4 คน (ทำงานถูก)

---

## 🎯 สรุป: พร้อมเล่นจริงหรือยัง?

**❌ ยังไม่พร้อม — ห้ามปล่อยให้ผู้ใช้ทั่วไปเล่น**

### บั๊กที่ block การใช้งานจริง (Blockers):
1. **BUG #1 (Cleanup)** — ผู้ใช้ที่เปิดแอปจะลบห้อง lobby ของทุกคนที่กำลังรอเพื่อน → เพื่อน join ไม่ได้
2. **BUG #4 (Realtime start-game)** — เกมเริ่มแล้วแต่คนอื่นไม่รู้ ต้อง refresh page

### บั๊กที่เสี่ยงต่อการสูญเสียผู้เล่น:
3. **BUG #2 (Race condition)** — 2 คน join พร้อมกันจะหายไป 1 คน (silent data loss)

### สิ่งที่ทำงานได้ดี:
- Create room
- Join with valid code
- Room full rejection
- Leave room
- Rejoin after slot opens
- DB integrity (เมื่อ join ทีละคน)

### ข้อแนะนำก่อนปล่อยจริง:
1. ✅ แก้ BUG #1 (cleanup logic)
2. ✅ แก้ BUG #2 (concurrency ใน joinRoom) — เพิ่ม version-check optimistic locking (2026-10-11)
3. ✅ ตรวจ Supabase Realtime RLS — anon ต้อง subscribe `postgres_changes` ได้ หรือใช้วิธีอื่น
4. ✅ เพิ่ม polling fallback สำหรับ lobby updates (ปัจจุบันมีแต่สำหรับ game state) — แก้ startPolling() ให้ renderLobby เมื่อ status='lobby' (2026-10-11)
5. ✅ Persist playerId ใน sessionStorage (เพื่อรองรับ refresh)
6. ⚠️ พิจารณาเพิ่ม RLS บน rooms table (ป้องกัน abuse)

---

## 📊 สถิติการทดสอบ

- Tabs ที่ใช้: 5 (tab1, tab2, tab3, tab4, tab5)
- Rooms ที่สร้าง: 3 (GK86EW, YHMVX3, F4PJZU) — 2 ถูกลบโดย cleanup bug, 1 ถูกลบตอน cleanup
- ผู้เล่นสูงสุดพร้อมกัน: 4 คน (Tab1, Tab3, Tab4, Tab5 — Tab2 ออกไปก่อน)
- Manual workarounds ที่ใช้: 7 (fetch patch attempts, manual renderLobby, manual showScreen)
- Bug console errors ที่บันทึก: ~150 (ส่วนใหญ่เป็น 406 จาก polling ของ tab1 ในห้อง GK86EW ที่หายไป)
- เวลาทดสอบรวม: ~10 นาที

---

*รายงานนี้จัดทำโดย subagent ตามคำสั่งของจิน 2026-10-11*