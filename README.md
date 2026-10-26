# 🃏 Dummy Rummy (ดัมมี่ 7 ใบ)

เกม Rummy เล่นออนไลน์ real-time กับเพื่อนและบอท AI · ไพ่ 52 ใบ · ผู้เล่น 2-4 คน

**🌐 เล่นสด:** https://ekaijinnyopc-pixel.github.io/dummy-rummy
**🗄️ Backend:** Supabase (Postgres + PostgREST + Realtime) · RPC `play_turn(...)`
**📜 กติกาและสถานะทั้งหมด:** [`GAME-CONCEPT.md`](GAME-CONCEPT.md)

---

## 📌 สถานะปัจจุบัน (อัปเดต 26 ต.ค. 2026)

| หัวข้อ | สถานะ |
|---|---|
| client ที่ deploy | `game-core.js?v=57` · `speto-rules.js?v=57` ✅ |
| กติกา v54 (A = แต้มสูงสุด 14) | ✅ client + SQL |
| กติกา v55 (น็อคมืด ×2, ฝากต้องเคยเก็บเกิด) | ✅ client · ⏳ **SQL ยังไม่ apply บน live** |
| FIX v54.1 (บั๊กสเปโต: server คิด A ติดกับ Q) | ✅ แก้ในไฟล์ patch · ⏳ ยังไม่ apply บน live |
| กติกาโทษ 2.1 / 2.2 / 2.3 | ✅ client = server (parity test ผ่าน) |
| เครื่องมือทดสอบ | 7 ชุด (unit + parity + integration) · เขียวทั้งหมด |
| smoke test บน browser จริง | ✅ ผ่าน ไม่มี console error |

### ⏳ รอพี่เอทำ (3 อย่าง)

1. **รัน SQL patch** → Supabase → SQL Editor → วาง [`APPLY-ALL-2026-10-25.sql`](APPLY-ALL-2026-10-25.sql) → Run
   แล้ววาง [`tools/verify-live-sql.sql`](tools/verify-live-sql.sql) → Run เพื่อเช็ค (read-only)
2. **เลือก A หรือ B** เรื่อง "ฝากลงชุดของตัวเอง" → [`PATCH-optionB-layoff-own-meld.md`](PATCH-optionB-layoff-own-meld.md)
3. **อนุมัติลบห้องค้าง** → `python3 tools/cleanup-abandoned-rooms.py --apply`

> หมายเหตุ: จนกว่าจะรัน SQL · server ยังเป็นเจ้าของกติกาเวอร์ชันเก่า (A ติดกับ Q, ไม่มี ×2 น็อคมืด)
> client คำนวณคะแนนเองทั้งหมด → **การเล่นปกติยังถูกต้อง** แต่ client อื่นอาจแอ้เปรียบได้

---

## 📁 ไฟล์ SQL

| ไฟล์ | หน้าที่ | สถานะ |
|---|---|---|
| `APPLY-ALL-2026-10-25.sql` | **รวมทุก patch + verify** (a-high + v55 + v54.1) | ⏳ รอรัน |
| `FIX-a-high-2026-10-25.sql` | A = 14 เสมอ + `rummy_adjacent_rank` (FIX v54.1) | รวมใน APPLY-ALL |
| `FIX-v55-2026-10-25.sql` | น็อคมืด ×2 + MUST_PICK_FIRST + ธง everMeld/everPick + validate ชุด | รวมใน APPLY-ALL |
| `FIX-backfill-flags.sql` | backfill ธงห้องเก่า (idempotent · รันซ้ำได้) | รวมใน APPLY-ALL |
| `FIX-optionB-layoff-no-own-meld.sql` | ตัวเลือก B (ห้ามฝากลงชุดตัวเอง) | ยังไม่ใช้ |
| `tools/verify-live-sql.sql` | ตรวจหลัง apply (read-only) | ✅ พร้อมใช้ |
| `tools/simulate-live-state.sql` | ย้อน DB ให้เหมือน live (ทดสอบ patch บน local) | ✅ |
| `tools/test-v55.sql` | เทสต์ SQL ฝั่ง server | ✅ |
| `fix-rls.sql` / `supabase-schema*.sql` | schema + RLS policies | ตั้งค่าครั้งแรก |

---

## 🧰 เครื่องมือทดสอบ (`tools/`)

รันด้วย `node tools/<ไฟล์>.js` (บางตัวต้องมี Postgres local: `PGHOST=/tmp/pgtest PGPORT=55432 PGUSER=postgres`)

| ไฟล์ | ตรวจอะไร |
|---|---|
| `test-meld-flow.js` | flow เกิดชุด 13 เคส (จำลอง browser ใน Node) |
| `test-v55-client.js` | กติกา v55 ฝั่ง client 23 เคส (ปุ่ม/ธง/ข้ามรอบ/น็อคมืด) |
| `test-v55-rules.js` | กติกา v55.1 (ปุ่มฝาก + action-hint) 15 เคส |
| `test-v55-integration.js` | จำลอง server ทั้งชุด + เล่นรอบเต็ม 17 เคส |
| `test-rules-parity.js` | **client ↔ server**: เกิดชุด / ฝาก / สเปโตเกี่ยว (พันเคส) |
| `test-scoring-parity.js` | **client ↔ server**: คะแนนรอบ (KNOCK) |
| `test-penalty-parity.js` | **client ↔ server**: โทษ 2.1 / 2.2 / 2.3 + spetoPending |
| `audit-live-scores.py` | คะแนนที่บันทึกบน live ตรงกติกาไหม |
| `probe-speto-live.py` | พฤติกรรมสเปโตจริงบน live (ต้องมี 2 ผู้เล่น) |
| `probe-v55-live.py` | เช็คว่า patch v55 apply บน live แล้วหรือยัง (KNOCK=280 = แล้ว) |
| `check-stuck-rooms.py` / `check-stuck-detail.py` | ห้องค้าง / รายละเอียด |
| `cleanup-abandoned-rooms.py` | กวาดห้องค้าง (dry-run เป็นค่าเริ่มต้น) |
| `SMOKE-TEST-LIVE.md` | ขั้นตอนทดสอบบน browser จริง |

> parity test รับ env `RUMMY_TEST_DB=<ชื่อ DB>` ได้ (default `rummytest`)

---

## 🗂️ โครงสร้างโค้ด

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | UI + cache-buster (ต้อง bump `?v=` ทุกครั้งที่แก้ client) |
| `game-core.js` | ตรรกะเกมฝั่ง client (~2,700 บรรทัด) |
| `speto-rules.js` | กติกาสเปโต + canLayoff (ใช้ร่วมกับ SQL) |
| `GAME-CONCEPT.md` | กติกา + สถานะ + FIX LOG (อัปเดตล่าสุด v55.1) |

**สถาปัตยกรรม:** client เป็นเจ้าของ UI และการคำนวณคะแนน (`finishRoundClientSide`) · server เป็นเจ้าของ state + กติกาที่ต้องบังคับ (MELD validate, MUST_PICK_FIRST, โทษ, KNOCK) · client ↔ server ต้องตรงกันเสมอ → **parity test คือกันดักหลัก**

---

## 🚀 วิธี deploy

```bash
git add -A && git commit -m "..." && git push origin main
# GitHub Pages จะ auto-build (~1 นาที)
# แล้ว bump cache-buster ใน index.html: game-core.js?v=NN → commit อีกครั้ง
```

ตรวจว่า live ขึ้นแล้ว:
```bash
curl -s https://ekaijinnyopc-pixel.github.io/dummy-rummy/ | grep -o "game-core.js?v=[0-9]*"
```

---

## 🔒 กติกาที่ห้ามแตะ (พี่เอยืนยัน)

- 2.1 ทิ้งดัมมี่ = −100 · 2.2 ตีเต็ม = −100 · 2.1 + 2.2 = **−100 เดียว**
- 2.3 สเปโต = −100 เพิ่ม (ภายใน 1 รอบ) · 2.1/2.2 + 2.3 = รวม −200
- ฝาก (LAYOFF) ไม่โดนโทษ · "1 รอบ" = `game.turnSeq`
- A = แต้มสูงสุด (14) เสมอ · A ติดกับ K เท่านั้น
- "น็อคมืด" = ชนะโดยไม่เคยเกิดตั้งแต่ต้นเกมจนถึงรอบก่อนน็อค → คะแนน ×2
- Server เป็นเจ้าของการคำนวณคะแนน
