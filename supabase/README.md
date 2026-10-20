# Panduan Integrasi Supabase — FHISIP Universitas Terbuka

Modul ini menyediakan skema basis data PostgreSQL resmi untuk **Sistem Rekapitulasi Presensi & Disiplin Pegawai FHISIP Universitas Terbuka** pada platform [Supabase Cloud](https://supabase.com).

---

## 📁 Berkas SQL yang Disediakan

1. [`schema.sql`](./schema.sql):
   - Tabel: `unit_kerja`, `pegawai`, `pengaturan_jam_kerja`, `absensi`, dan `audit_log`.
   - Konfigurasi *Row Level Security* (RLS).
   - Indeks kecepatan query dan View evaluasi disiplin otomatis (`v_rekap_absensi_fhisip`).
2. [`seed.sql`](./seed.sql):
   - Data awal **13 Program Studi / Bagian** di lingkungan FHISIP UT.
   - Data resmi **121 Dosen dan Tenaga Kependidikan** FHISIP UT.
   - Pengaturan jam kerja default FHISIP UT (`08:30` - `16:30` WIB).
   - Riwayat data scan kehadiran real (**948 catatan kehadiran**).

---

## 🚀 Langkah Instalasi & Penggunaan di Supabase

### Langkah 1: Buat Project di Supabase
1. Masuk ke [https://supabase.com](https://supabase.com) dan buat akun (bisa menggunakan akun GitHub).
2. Klik tombol **New Project**.
3. Masukkan nama project, contoh: `ut-fhisip-absensi`, tentukan database password yang aman, dan pilih region terdekat (misal: *Singapore*).

### Langkah 2: Eksekusi Skema & Seed Data
1. Buka dashboard project Supabase Anda, lalu klik menu **SQL Editor** di navigasi sebelah kiri.
2. Buka berkas [`schema.sql`](./schema.sql), salin seluruh isinya, tempel ke SQL Editor, lalu klik tombol **Run**.
3. Buka berkas [`seed.sql`](./seed.sql), salin seluruh isinya, tempel ke SQL Editor, lalu klik tombol **Run**.
4. Seluruh tabel, relasi, dan data 121 pegawai FHISIP akan langsung terisi.

### Langkah 3: Hubungkan ke Dashboard Web
1. Di dashboard Supabase, buka menu **Project Settings** (ikon gerigi) → **API**.
2. Salin:
   - **Project URL** (contoh: `https://abcdefghijkl.supabase.co`)
   - **anon / public key** (API key publik)
3. Buka Dashboard Absensi Anda di peramban, klik tombol **"☁️ Supabase"** di header atas.
4. Tempel Project URL dan anon key ke form yang tersedia, lalu klik **"⚡ Test Koneksi"**.
5. Anda dapat mengklik:
   - **"⬇ Tarik Data dari Cloud"** untuk menyinkronkan data dari Supabase ke dashboard lokal.
   - **"⬆ Unggah Data Lokal ke Cloud"** untuk mengirimkan pembaruan absensi lokal ke cloud.
