# สถานะโปรเจกต์ ดัมมี่ออนไลน์
## อัพเดท: 2026-10-09 17:58 GMT+8

### สถานะ: ⏸️ รอ Supabase Key + DB Setup

### สิ่งที่ทำเสร็จแล้ว
- ✅ index.html (UI หน้าเว็บทั้งหมด)
- ✅ game-core.js (Supabase v2 API + game logic)
- ⏳ Supabase Key (รอพี่เอส่งค่าเต็ม eyJ...)
- ⬜ Database table สร้าง
- ⬜ Deploy (GitHub Pages หรือ Hostinger)

### สิ่งที่รอจากพี่เอ
1. Supabase anon key (eyJ... ค่ะ) → ใส่ใน game-core.js
2. รัน SQL สร้าง table บน Supabase
3. เลือกวิธี deploy: GitHub Pages หรือ Hostinger

### Deploy Options
- GitHub Pages: ฟรี, ต้องมี GitHub account
- Hostinger: มีอยู่แล้ว, รอ SSH credentials

### โปรเจกต์ใช้
- Project: https://dbtlbeymrchodloboymr.supabase.co
- Key: sb_publishable_m72xxY53a8lHIHplk8jLRg_es5hrjWf

### สิ่งที่ต้องทำต่อ
1. เขียน game.js (backend logic + Supabase sync)
2. ตั้งค่า Supabase database
3. Deploy ไฟล์ lên server/host
4. ทดสอบ

### ปัญหาที่เจอ
- LLM timeout บ่อย ต้องแก้ config timeoutSeconds
