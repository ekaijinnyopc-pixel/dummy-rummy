# 🧪 SMOKE TEST — ตรวจ live ด้วย browser จริง (ทำซ้ำได้)

ใช้ตอน deploy client ใหม่ เพื่อยืนยันว่าเกมเล่นได้จริงบน browser (ไม่ใช่แค่เทสต์ unit)

## ขั้นตอน (ผ่าน OpenClaw browser tool)

1. `browser action=start` → `open` URL `https://ekaijinnyopc-pixel.github.io/dummy-rummy/` (label `rummy`)
2. `snapshot` → ต้องเห็นหน้า lobby (สร้างห้องใหม่ / เข้าห้องที่มีอยู่แล้ว)
3. กรอกชื่อ → กด **"⚡ เล่นเร็ว (เติมบอทให้)"**
4. รอจนถึงตาของเรา → `snapshot` → ต้องเห็น:
   - ห้องจั่ว / กองทิ้ง / มือไพ่ของเรา / ปุ่ม 5 ปุ่ม (จั่ว · เก็บเกิด · วาง (เกิดในมือ) · ทิ้ง · จบตา)
   - ปุ่ม "ฝาก" ต้อง **ซ่อน** ถ้ายังไม่เคยเก็บเกิดจากกองทิ้ง (กติกา v55)
   - action-hint ต้องขึ้น 🔒 "ฝาก" ไม่ได้: ต้อง "เก็บเกิดจากกองทิ้ง" อย่างน้อย 1 ครั้งก่อน
5. ทดสอบ action จริง (ผ่าน `browser act=evaluate`):
   ```js
   // กดจั่ว
   document.getElementById('btn-draw').click();
   // เลือกไพ่ (อย่าใช้ textContent เพราะไพ่สเปโตมีคำว่า "สเปโต" ติดมาด้วย!)
   [...document.querySelectorAll('.hand-card')]
     .find(e => (e.getAttribute('onclick')||'').includes("'8♣'")).click();
   // ทิ้ง
   document.getElementById('btn-discard').click();
   ```
   → ต้องเห็น: กองจั่วลดลง 1 · มือเพิ่ม 1 · กองทิ้งมีไพ่ที่ทิ้ง · ตาเปลี่ยนไปบอท
6. `browser action=console` → **ต้องไม่มี error** (type = error)
   - โบนัส: ถ้าเห็น `[RT] ข้าม event เก่า: N < M` = FIX v55.2 ทำงานจริงบน live ✅
7. **ลบห้องทดสอบ** (สำคัญ! ไม่ให้ขยะบน live)
   ```bash
   python3 - <<'PY'
   import json, re, urllib.request
   SRC=open('game-core.js',encoding='utf-8').read()
   URL=re.search(r"SUPABASE_URL = '([^']+)'",SRC).group(1)
   KEY=re.search(r"SUPABASE_KEY = '([^']+)'",SRC).group(1)
   H={'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json'}
   r=urllib.request.Request(URL+'/rest/v1/rooms?id=eq.<ROOMCODE>', headers=H, method='DELETE')
   print('HTTP', urllib.request.urlopen(r,timeout=30).status)
   PY
   ```
   → ควรได้ HTTP 204 และเช็คด้วยว่าไพ่รวม 52 ใบ ไม่มีซ้ำ (ยืนยัน FIX v53)

## ผลรอบล่าสุด (2026-10-25 20:58 · live v=57)

| ข้อ | ผล |
|---|---|
| lobby + สร้างห้อง + บอทเล่นเอง | ✅ |
| ปุ่มครบ + "ฝาก" ซ่อนตามกติกา v55 | ✅ |
| action-hint 🔒 ฝาก | ✅ |
| จั่ว → เลือก → ทิ้ง | ✅ (มือ 7→8→7, กองจั่ว 22→21, กองทิ้งมี 8♣) |
| console error | ✅ ไม่มีเลย |
| FIX v55.2 บน live | ✅ เห็น `[RT] ข้าม event เก่า: 2 < 3` |
| ไพ่ในห้องทดสอบ | ✅ 52 ใบ ไม่ซ้ำ |
| ลบห้องทดสอบ | ✅ HTTP 204 |
