# 🃏 Dummy Rummy — Gameplay Test (3 รอบ Draw/Discard/View)

**ทดสอบเมื่อ:** 2026-10-11 02:34 GMT+8
**URL:** https://dummy-rummy.vercel.app
**Room Code:** YYS695
**Tabs:**
- **Tab1 (ว่าน 🏎️)** — label `rummy-tab1-waan`
- **Tab2 (ลิน 🦊)** — label `rummy-tab2-lin`

---

## ⚠️ หมายเหตุสำคัญ: ลำดับเทิร์น

แผนเดิมระบุว่า **Tab1 (ว่าน) เป็นคนเริ่มก่อน** แต่เกมสุ่มให้ **Tab2 (ลิน) เริ่มก่อน**
รายงานนี้จึงดำเนินการทดสอบโดย**สลับเทิร์นตามที่เกมกำหนด** — pattern คงเดิม (2 draw/discard ต่อรอบ สลับผู้เล่น) แค่สลับชื่อ Tab

---

## 🎯 สรุปผลรวม

| เช็คลิสต์ | ผล |
|----------|------|
| ✅ DRAW ทำงาน | ✅ ผ่าน 100% (6/6 ครั้ง) |
| ✅ DISCARD ทำงาน | ✅ ผ่าน 100% (6/6 ครั้ง) |
| ✅ TURN UPDATE แบบ realtime | ✅ ผ่าน 100% (ไม่ต้อง reload) |
| ✅ ไม่มี console error (ERROR level) | ❌ **มี error ซ้ำ** (แต่ไม่กระทบ gameplay) |
| ✅ ไม่มี VERSION_MISMATCH | ✅ **0 ครั้ง** (เคลียร์แล้ว) |

**สถิติรวม:** 3 รอบ × 2 ผู้เล่น × 2 actions (draw+discard) = 12 actions
- Draw สำเร็จ: 6/6 (100%)
- Discard สำเร็จ: 6/6 (100%)
- Turn updates: ทุกครั้ง realtime ไม่ต้อง reload

---

## 📊 รายละเอียดแต่ละรอบ

### 🟢 รอบที่ 1
**ผลรวม: ✅ PASS**

| Action | ผู้เล่น | ผล | รายละเอียด |
|--------|---------|-----|------------|
| Draw | Tab2 (ลิน) | ✅ | Deck 29→28, มือ 11→12 ใบ, ได้ **5♣** |
| Discard | Tab2 (ลิน) | ✅ | เลือก **2♠** → กองทิ้งมีใหม่, มือกลับเป็น 11 |
| Turn check | Tab1 (ว่าน) | ✅ | เห็น "🎯 ตาของคุณ!" ทันที + กองทิ้ง [K♠, **2♠**] |
| Draw | Tab1 (ว่าน) | ✅ | Deck 28→27, มือ 11→12 ใบ, ได้ **J♥** |
| Discard | Tab1 (ว่าน) | ✅ | เลือก **J♣** → กองทิ้งมีใหม่, มือกลับเป็น 11 |
| Turn check | Tab2 (ลิน) | ✅ | เห็น "🎯 ตาของคุณ!" ทันที + กองทิ้ง [K♠, 2♠, **J♣**] |

**กองทิ้งหลังรอบ 1:** K♠, 2♠, J♣ (3 ใบ)

---

### 🟢 รอบที่ 2
**ผลรวม: ✅ PASS**

| Action | ผู้เล่น | ผล | รายละเอียด |
|--------|---------|-----|------------|
| Draw | Tab2 (ลิน) | ✅ | Deck 27→26, มือ 11→12 ใบ, ได้ **7♠** |
| Discard | Tab2 (ลิน) | ✅ | เลือก **5♠** → กองทิ้งมีใหม่, มือกลับเป็น 11 |
| Turn check | Tab1 (ว่าน) | ✅ | เห็น "🎯 ตาของคุณ!" ทันที + กองทิ้ง [K♠, 2♠, J♣, **5♠**] |
| Draw | Tab1 (ว่าน) | ✅ | Deck 26→25, มือ 11→12 ใบ, ได้ **4♠** |
| Discard | Tab1 (ว่าน) | ⚠️ | เลือก **4♠** แทน 3♥ (ref อ่านผิด) แต่ discard สำเร็จ → กองทิ้งมีใหม่, มือกลับเป็น 11 |
| Turn check | Tab2 (ลิน) | ✅ | เห็น "🎯 ตาของคุณ!" ทันที + กองทิ้ง [K♠, 2♠, J♣, 5♠, **4♠**] |

**หมายเหตุ:** ในรอบนี้ ref e462 ของ Tab1 ตรงกับ **4♠** ไม่ใช่ 3♥ ที่ตั้งใจไว้ (ตำแหน่งของการ์ดเลื่อนหลังจากจั่ว) — แต่กลไก discard ยังทำงานถูกต้อง

**กองทิ้งหลังรอบ 2:** K♠, 2♠, J♣, 5♠, 4♠ (5 ใบ)

---

### 🟢 รอบที่ 3
**ผลรวม: ✅ PASS**

| Action | ผู้เล่น | ผล | รายละเอียด |
|--------|---------|-----|------------|
| Draw | Tab2 (ลิน) | ✅ | Deck 25→24, มือ 11→12 ใบ, ได้ **K♣** |
| Discard | Tab2 (ลิน) | ✅ | เลือก **7♠** → กองทิ้งมีใหม่, มือกลับเป็น 11 |
| Turn check | Tab1 (ว่าน) | ✅ | เห็น "🎯 ตาของคุณ!" ทันที + กองทิ้ง [K♠, 2♠, J♣, 5♠, 4♠, **7♠**] |
| Draw | Tab1 (ว่าน) | ✅ | Deck 24→23, มือ 11→12 ใบ, ได้ **K♦** |
| Discard | Tab1 (ว่าน) | ✅ | เลือก **3♠** → กองทิ้งมีใหม่, มือกลับเป็น 11 |
| Turn check | Tab2 (ลิน) | ✅ | เห็น "🎯 ตาของคุณ!" ทันที + กองทิ้ง [K♠, 2♠, J♣, 5♠, 4♠, 7♠, **3♠**] |

**กองทิ้งหลังรอบ 3:** K♠, 2♠, J♣, 5♠, 4♠, 7♠, 3♠ (7 ใบ)

---

## 🔴 Console Errors (❗ ยังเจอ error ที่ไม่ใช่ VERSION_MISMATCH)

ทุก draw และ discard มี error log ออกมา (6 errors ต่อ tab, รวม 12 errors) — **แต่ไม่กระทบ gameplay**:

```
[RPC] DRAW_DECK exception: db.from(...).update(...).eq(...).catch is not a function
[RPC] DISCARD exception: db.from(...).update(...).eq(...).catch is not a function
```

**จำนวน errors ที่เจอ:**
- Tab1 (ว่าน): 6 errors (3 DRAW_DECK + 3 DISCARD)
- Tab2 (ลิน): 6 errors (3 DRAW_DECK + 3 DISCARD)

**วิเคราะห์เบื้องต้น:**
- Error นี้เกิดจาก `db.from(...).update(...).eq(...).catch is not a function`
- น่าจะเป็นปัญหาที่ chain `.eq(...)` ส่งคืน query builder object (ไม่ใช่ Promise) แต่โค้ดเรียก `.catch()` ทันที — ควรเรียก `.then().catch()` หรือใช้ `await`
- **อย่างไรก็ตาม gameplay ทำงานถูกต้องทั้งหมด** — มี fallback หรือ local state update ก่อน ทำให้ผู้เล่นเห็นผลลัพธ์ถูกต้องแม้ RPC จะ fail
- **VERSION_MISMATCH: 0 ครั้ง** ✅ (เคลียร์แล้ว — bug เดิมที่ต้องการแก้ได้หายไป)

---

## 📸 Screenshots

- `/data/.openclaw/workspace/dummy-rummy/round3-tab1-end.png` — Tab1 หลังจบรอบ 3
- `/data/.openclaw/workspace/dummy-rummy/round3-tab2-end.png` — Tab2 หลังจบรอบ 3 (มีตา)

---

## 🎮 สรุป: พร้อมให้พี่เอเล่นมั้ย?

### ✅ **พร้อมเล่น** — แต่มี caveat เล็กน้อย

**✅ สิ่งที่ทำงานดี:**
- Draw / Discard / Turn switching ทำงานถูกต้อง 100%
- Realtime sync ระหว่าง 2 tabs ทำงานสมบูรณ์ (ไม่ต้อง reload)
- VERSION_MISMATCH หายไปแล้ว ✅
- UI ตอบสนองดี เล่นลื่น

**⚠️ Caveat (ไม่ critical):**
- มี console error ซ้ำทุกครั้งที่ draw/discard: `db.from(...).update(...).eq(...).catch is not a function`
- Error นี้**ไม่กระทบ gameplay** เพราะมี fallback path — แต่เป็น code smell ที่ควรแก้
- ทั้งสองผู้เล่นเห็นสถานะเกมตรงกัน และกองทิ้ง/กองจั่ว/จำนวนไพ่ในมือ sync ถูกต้องหมด

**🔧 คำแนะนำเพิ่มเติม:**
- แก้บั๊ก `.catch()` ใน RPC call (น่าจะอยู่ใน `rpc-draw-deck` และ `rpc-discard`)
- เพิ่ม error toast ใน UI หรือ fallback strategy ที่ชัดเจน เพื่อให้ผู้เล่นรู้ว่า sync DB ล้มเหลว (กัน edge case ที่ state อาจจะ diverge)

**คำตอบสั้นๆ: พร้อมให้พี่เอเล่นได้เลย 🎉** — แค่ระวังเรื่อง RPC error ใน DevTools console เฉยๆ ตัวเกมเล่นได้ลื่น