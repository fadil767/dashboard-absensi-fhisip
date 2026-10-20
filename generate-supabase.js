const fs = require('fs');
const path = require('path');
const dump = JSON.parse(fs.readFileSync(path.join(__dirname, '../ut-absensi-dump.json'), 'utf8'));

const schemaSql = `-- =====================================================================
-- SKEMA BASIS DATA SUPABASE (POSTGRESQL)
-- SISTEM REKAPITULASI PRESENSI & DISIPLIN PEGAWAI FHISIP UNIVERSITAS TERBUKA
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TABEL UNIT KERJA / PROGRAM STUDI
CREATE TABLE IF NOT EXISTS public.unit_kerja (
    id SERIAL PRIMARY KEY,
    nama TEXT NOT NULL UNIQUE,
    kode VARCHAR(20),
    keterangan TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABEL PEGAWAI FHISIP UT
CREATE TABLE IF NOT EXISTS public.pegawai (
    nip VARCHAR(30) PRIMARY KEY,
    nama_lengkap TEXT NOT NULL,
    status_kepegawaian VARCHAR(20) DEFAULT 'PNS',
    jabatan TEXT,
    unit_kerja_id INT REFERENCES public.unit_kerja(id) ON DELETE SET NULL,
    aktif BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABEL PENGATURAN JAM KERJA & AMBANG BATAS
CREATE TABLE IF NOT EXISTS public.pengaturan_jam_kerja (
    id SERIAL PRIMARY KEY,
    jam_masuk VARCHAR(5) DEFAULT '08:30',
    toleransi_menit INT DEFAULT 0,
    jam_pulang VARCHAR(5) DEFAULT '16:30',
    jam_pulang_jumat VARCHAR(5) DEFAULT '16:30',
    keterangan TEXT DEFAULT 'Kebijakan Resmi FHISIP UT',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABEL PRESENSI / ABSENSI PEGAWAI
CREATE TABLE IF NOT EXISTS public.absensi (
    id BIGSERIAL PRIMARY KEY,
    nip VARCHAR(30) NOT NULL REFERENCES public.pegawai(nip) ON DELETE CASCADE,
    tanggal DATE NOT NULL,
    jam_masuk VARCHAR(5),
    jam_pulang VARCHAR(5),
    status_kehadiran VARCHAR(20) DEFAULT 'Hadir',
    keterangan TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_absensi_nip_tanggal UNIQUE(nip, tanggal)
);

-- 5. TABEL AUDIT LOG AKTIVITAS
CREATE TABLE IF NOT EXISTS public.audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_identifier TEXT,
    aksi TEXT NOT NULL,
    detail JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEX UNTUK PERFORMA QUERY CEPAT
CREATE INDEX IF NOT EXISTS idx_absensi_tanggal ON public.absensi(tanggal);
CREATE INDEX IF NOT EXISTS idx_absensi_nip ON public.absensi(nip);
CREATE INDEX IF NOT EXISTS idx_pegawai_unit ON public.pegawai(unit_kerja_id);

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE public.unit_kerja ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pegawai ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pengaturan_jam_kerja ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.absensi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- KEBIJAKAN AKSES PUBLIC
CREATE POLICY "Public read unit_kerja" ON public.unit_kerja FOR SELECT USING (true);
CREATE POLICY "Public read pegawai" ON public.pegawai FOR SELECT USING (true);
CREATE POLICY "Public read pengaturan" ON public.pengaturan_jam_kerja FOR SELECT USING (true);
CREATE POLICY "Public read absensi" ON public.absensi FOR SELECT USING (true);
CREATE POLICY "Public modify absensi" ON public.absensi FOR ALL USING (true);
CREATE POLICY "Public modify pegawai" ON public.pegawai FOR ALL USING (true);
CREATE POLICY "Public modify pengaturan" ON public.pengaturan_jam_kerja FOR ALL USING (true);

-- VIEW REKAP PRESENSI DENGAN EVALUASI DISIPLIN
CREATE OR REPLACE VIEW public.v_rekap_absensi_fhisip AS
SELECT 
    a.id,
    a.tanggal,
    a.nip,
    p.nama_lengkap,
    p.status_kepegawaian,
    p.jabatan,
    u.nama AS unit_kerja,
    a.jam_masuk,
    a.jam_pulang,
    a.status_kehadiran,
    a.keterangan,
    CASE 
        WHEN a.status_kehadiran <> 'Hadir' THEN a.status_kehadiran
        WHEN a.jam_masuk > '08:30' AND a.jam_pulang < '16:30' THEN 'Telat & Pulang Cepat'
        WHEN a.jam_masuk > '08:30' THEN 'Terlambat'
        WHEN a.jam_pulang < '16:30' THEN 'Pulang Lebih Awal'
        ELSE 'Tepat Waktu'
    END AS status_disiplin_resmi,
    CASE 
        WHEN a.jam_masuk IS NOT NULL AND a.jam_masuk > '08:30' 
        THEN (CAST(SPLIT_PART(a.jam_masuk, ':', 1) AS INT) * 60 + CAST(SPLIT_PART(a.jam_masuk, ':', 2) AS INT)) - (8 * 60 + 30)
        ELSE 0 
    END AS menit_keterlambatan
FROM public.absensi a
JOIN public.pegawai p ON a.nip = p.nip
LEFT JOIN public.unit_kerja u ON p.unit_kerja_id = u.id;
`;

const unitNames = [...new Set(dump.pegawai.map(p => p.unit_kerja).filter(Boolean))].sort();

let seedSql = `-- =====================================================================
-- SEED DATA RESMI FHISIP UNIVERSITAS TERBUKA UNTUK SUPABASE
-- 13 Program Studi / Unit Kerja & 121 Pegawai Resmi
-- =====================================================================

-- 1. INSERT UNIT KERJA
INSERT INTO public.unit_kerja (id, nama) VALUES
` + unitNames.map((u, i) => `  (${i + 1}, '${u.replace(/'/g, "''")}')`).join(',\n') + `
ON CONFLICT (id) DO UPDATE SET nama = EXCLUDED.nama;

-- 2. INSERT PENGATURAN JAM KERJA DEFAULT FHISIP UT
INSERT INTO public.pengaturan_jam_kerja (id, jam_masuk, toleransi_menit, jam_pulang, jam_pulang_jumat, keterangan)
VALUES (1, '08:30', 0, '16:30', '16:30', 'Kebijakan Jam Presensi Resmi FHISIP UT')
ON CONFLICT (id) DO NOTHING;

-- 3. INSERT 121 PEGAWAI FHISIP UT
INSERT INTO public.pegawai (nip, nama_lengkap, status_kepegawaian, jabatan, unit_kerja_id, aktif) VALUES
` + dump.pegawai.map(p => {
  const uIdx = unitNames.indexOf(p.unit_kerja) + 1;
  return `  ('${p.nip}', '${p.nama_lengkap.replace(/'/g, "''")}', '${p.status_kepegawaian || 'PNS'}', '${(p.jabatan || 'Dosen').replace(/'/g, "''")}', ${uIdx || 'NULL'}, true)`;
}).join(',\n') + `
ON CONFLICT (nip) DO UPDATE SET 
  nama_lengkap = EXCLUDED.nama_lengkap,
  unit_kerja_id = EXCLUDED.unit_kerja_id;

-- 4. INSERT DATA PRESENSI / SCAN RESMI (${dump.absensi.length} Catatan)
INSERT INTO public.absensi (nip, tanggal, jam_masuk, jam_pulang, status_kehadiran, keterangan) VALUES
` + dump.absensi.map(a => {
  const m = a.jam_masuk ? `'${a.jam_masuk}'` : 'NULL';
  const p = a.jam_pulang ? `'${a.jam_pulang}'` : 'NULL';
  return `  ('${a.nip}', '${a.tanggal}', ${m}, ${p}, '${a.status_kehadiran || 'Hadir'}', '${(a.keterangan || 'Data Scan Resmi').replace(/'/g, "''")}')`;
}).join(',\n') + `
ON CONFLICT (nip, tanggal) DO UPDATE SET
  jam_masuk = EXCLUDED.jam_masuk,
  jam_pulang = EXCLUDED.jam_pulang,
  status_kehadiran = EXCLUDED.status_kehadiran;
`;

fs.mkdirSync(path.join(__dirname, 'supabase'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'supabase/schema.sql'), schemaSql, 'utf8');
fs.writeFileSync(path.join(__dirname, 'supabase/seed.sql'), seedSql, 'utf8');
console.log('Generated schema.sql and seed.sql successfully!');
