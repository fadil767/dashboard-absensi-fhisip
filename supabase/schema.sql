-- =====================================================================
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
DROP POLICY IF EXISTS "Public read unit_kerja" ON public.unit_kerja;
DROP POLICY IF EXISTS "Public modify unit_kerja" ON public.unit_kerja;
DROP POLICY IF EXISTS "Public read pegawai" ON public.pegawai;
DROP POLICY IF EXISTS "Public modify pegawai" ON public.pegawai;
DROP POLICY IF EXISTS "Public read pengaturan" ON public.pengaturan_jam_kerja;
DROP POLICY IF EXISTS "Public modify pengaturan" ON public.pengaturan_jam_kerja;
DROP POLICY IF EXISTS "Public read absensi" ON public.absensi;
DROP POLICY IF EXISTS "Public modify absensi" ON public.absensi;
DROP POLICY IF EXISTS "Public read audit_log" ON public.audit_log;
DROP POLICY IF EXISTS "Public insert audit_log" ON public.audit_log;

CREATE POLICY "Public read unit_kerja" ON public.unit_kerja FOR SELECT USING (true);
CREATE POLICY "Public modify unit_kerja" ON public.unit_kerja FOR ALL USING (true);
CREATE POLICY "Public read pegawai" ON public.pegawai FOR SELECT USING (true);
CREATE POLICY "Public modify pegawai" ON public.pegawai FOR ALL USING (true);
CREATE POLICY "Public read pengaturan" ON public.pengaturan_jam_kerja FOR SELECT USING (true);
CREATE POLICY "Public modify pengaturan" ON public.pengaturan_jam_kerja FOR ALL USING (true);
CREATE POLICY "Public read absensi" ON public.absensi FOR SELECT USING (true);
CREATE POLICY "Public modify absensi" ON public.absensi FOR ALL USING (true);
CREATE POLICY "Public read audit_log" ON public.audit_log FOR SELECT USING (true);
CREATE POLICY "Public insert audit_log" ON public.audit_log FOR INSERT WITH CHECK (true);

-- KONFIGURASI SUPABASE REALTIME (LIVE MULTI-DEVICE SYNC)
ALTER TABLE public.absensi REPLICA IDENTITY FULL;
ALTER TABLE public.pegawai REPLICA IDENTITY FULL;
ALTER TABLE public.pengaturan_jam_kerja REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'absensi'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.absensi;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pegawai'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.pegawai;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pengaturan_jam_kerja'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.pengaturan_jam_kerja;
        END IF;
    END IF;
END $$;

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
