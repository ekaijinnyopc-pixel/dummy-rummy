-- Fix RLS และ columns (รันแค่อันนี้อันเดียวใน Supabase SQL Editor)
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read" ON rooms;
DROP POLICY IF EXISTS "public_insert" ON rooms;
DROP POLICY IF EXISTS "public_update" ON rooms;
DROP POLICY IF EXISTS "public_delete" ON rooms;
CREATE POLICY "public_read" ON rooms FOR SELECT USING (true);
CREATE POLICY "public_insert" ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "public_update" ON rooms FOR UPDATE USING (true);
CREATE POLICY "public_delete" ON rooms FOR DELETE USING (true);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS totalPlayers INTEGER NOT NULL DEFAULT 4;
GRANT USAGE ON SCHEMA public TO anon;
GRANT ALL ON rooms TO anon;
