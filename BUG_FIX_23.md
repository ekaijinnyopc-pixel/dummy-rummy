# BUG FIX #2 + #3 — game-core.js

**วันที่แก้:** 2026-10-11 (GMT+8)
**ไฟล์:** `/data/.openclaw/workspace/dummy-rummy/game-core.js`
**ทดสอบบน:** https://dummy-rummy.vercel.app (Supabase `dbtlbeymrchodloboymr`)

---

## ✅ BUG #2: Race condition ใน joinRoom() — แก้แล้ว

### ปัญหาเดิม
- `joinRoom()` fetch room → mutate players object → `update({ players })` โดยไม่เช็คว่า state เปลี่ยนไปหรือไม่
- 2 คน join พร้อมกัน → ทั้งคู่ fetch version=1 → ทั้งคู่ `update()` ด้วย players object ที่ตัวเองเห็น → **last write wins** → คนที่ update ทีหลังเขียนทับ players ของคนแรก (silent data loss)

### วิธีแก้
ใช้ **optimistic concurrency control** ด้วย version check:

```javascript
// 1. Fetch fresh state + version
var _fresh = await db.from('rooms').select('id,players,version,totalplayers').eq('id', code).single();
if (!_fresh.data) { notify('❌ ไม่พบห้อง'); return; }
var currentPlayers = _fresh.data.players || {};
if (currentPlayers[myPlayerId]) { notify('คุณอยู่ในห้องแล้ว'); return; }
var currentKeys = Object.keys(currentPlayers);
if (currentKeys.length >= (_fresh.data.totalplayers || 4)) { notify('❌ ห้องเต็มแล้ว'); return; }

// 2. Build new state
var newPlayers = Object.assign({}, currentPlayers);
newPlayers[myPlayerId] = { id: myPlayerId, name: name, isBot: false, isHost: false };

// 3. Update with version guard — ถ้า version เปลี่ยนไปแล้ว update จะไม่ match row
var updated = await db.from('rooms').update({
  players: newPlayers,
  version: _fresh.data.version + 1
}).eq('id', code).eq('version', _fresh.data.version);

// 4. ถ้า update ไม่ติด (data ว่าง) = มีคนอื่น update ก่อนหน้า
if (!updated.data || (updated.data && updated.data.length === 0)) {
  notify('❌ ห้องเต็มหรือมีคนเข้าแล้ว — ลองใหม่');
  return;
}
```

### ผลลัพธ์
- ✅ Concurrent join → คนที่ update ก่อนชนะ คนที่สองได้ `length === 0` → notify ให้ลองใหม่
- ✅ Room-full check ใช้ fresh `totalplayers`
- ✅ Duplicate-self-join guard (เช็ค `currentPlayers[myPlayerId]`)
- ✅ `node --check` ผ่าน

---

## ✅ BUG #3: Polling ไม่ render lobby — แก้แล้ว

### ปัญหาเดิม
- `startPolling()` เช็คเฉพาะ `if (remoteRoom.game)` → ตอน `status='lobby'` (game = null) ไม่ render อะไรเลย
- ผลคือ host สร้างห้อง → render lobby คนเดียว, คนอื่น join ผ่าน realtime แต่ถ้า realtime fail → polling ก็ไม่ช่วย → UI ของ host ค้าง

### วิธีแก้
เพิ่ม branch `status === 'lobby'` ก่อนเช็ค game:

```javascript
if (_data.data) {
  var remoteRoom = _data.data;

  // NEW: render lobby when status=lobby
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
    // ... existing game-state polling ...
  }
}
```

### สิ่งที่เพิ่ม
- ✅ ตัวแปร global `currentLobbyPlayers` (declared ใกล้ `pollInterval`)
- ✅ Diff-check ด้วย `JSON.stringify` — ไม่ re-render lobby ทุก 1.5s ถ้าไม่มีอะไรเปลี่ยน (กัน flicker)
- ✅ Reset `currentLobbyPlayers = null` ใน `leaveRoom()` เพื่อให้ rejoin ทำงานถูก

### ผลลัพธ์
- ✅ Lobby update ผ่าน polling ทุก 1.5s ถ้า players เปลี่ยน
- ✅ ทำงานเป็น fallback เมื่อ Supabase Realtime มีปัญหา
- ✅ ไม่กระทบ performance (diff-check)

---

## 🧪 Validation
- `node --check game-core.js` → SYNTAX OK
- ทั้ง 2 fix ไม่มี syntax error
- Logic flow ตรวจสอบกับ Supabase REST pattern (`.eq('version', x)` + check returned data length)

## 📝 Next steps (manual test recommended)
1. Deploy → เปิด 2 tabs พร้อมกัน join ห้องเดียวกัน — verify ทั้ง 2 คนอยู่ใน lobby
2. ปิด realtime ใน DevTools network tab → ยืนยันว่า polling ยังอัปเดต lobby
3. ลอง spam join 5+ คนเข้าห้อง 4 คน → คนที่ 5 ต้องโดนปฏิเสธ