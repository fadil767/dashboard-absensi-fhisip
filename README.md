# Dashboard Rekapitulasi Absensi Pegawai FHISIP Universitas Terbuka

Dashboard rekapitulasi presensi dan manajemen kedisiplinan pegawai di lingkungan **Fakultas Hukum, Ilmu Sosial, dan Ilmu Politik (FHISIP) Universitas Terbuka**.

Dirancang dengan antarmuka yang bersih, modern, dan **sederhana** untuk memudahkan pengelolaan status pegawai (tepat waktu vs terlambat), dilengkapi **opsi pengaturan batas datang terlambat dan kepulangan** yang dapat disimulasikan secara real-time.

---

## Fitur Utama

1. **Opsi Pengaturan Batas Waktu Terlambat & Kepulangan (Real-time Reactive)**:
   - **Batas Datang Terlambat**: Atur jam masuk maksimal (default: `08:30` WIB).
   - **Toleransi Keterlambatan**: Pilihan kelonggaran `0`, `5`, `10`, atau `15` menit.
   - **Batas Kepulangan**: Atur jam pulang minimal (default: `16:30` WIB) serta penyesuaian khusus hari Jumat.
   - **Preset Cepat Kebijakan**:
     - 🏛 *SK FHISIP UT (`08:30` & `16:30`)*
     - 🏢 *Standar UT Kantor Pusat (`08:00` & `16:30`)*
     - ⏱ *Dispensasi Toleransi 15 Menit*
   - Setiap perubahan batas waktu langsung menghitung ulang status keterlambatan seluruh 948 data presensi pegawai secara instan tanpa reload halaman!

2. **Ringkasan Metrik Rekapitulasi (KPI Cards)**:
   - Total Catatan Presensi
   - Pegawai Tepat Waktu (% Kepatuhan)
   - Pegawai Terlambat Datang (% & Rata-rata Durasi Menit Terlambat)
   - Pegawai Pulang Lebih Awal (Sebelum Jam Resmi)

3. **Import Excel / Scan Biometrik**:
   - Mendukung berkas mesin pemindai biometrik (format matriks `Data Scan Karyawan .xls` seperti `19102026_Rekap Absensi.xls`).
   - Mendukung spreadsheet tabular (.xlsx / .csv).
   - Pratinjau data interaktif sebelum dimasukkan ke sistem dengan opsi *Gabungkan (Merge)* atau *Gantikan (Replace)*.

4. **Ekspor Laporan Resmi (Excel & PDF)**:
   - 📥 **Ekspor Excel (CSV)**: Kolom NIP aman dengan format teks (tidak berubah menjadi format eksponensial di Microsoft Excel).
   - 📄 **Unduh PDF Vektor Resmi**: Dilengkapi Kop Surat Resmi FHISIP UT, ringkasan kebijakan waktu aktif, tabel zebra-striping, dan blok tanda tangan Dekan & Kepala Bagian Tata Usaha.

5. **Tiga Tampilan Rekapitulasi**:
   - **📋 Log Presensi Harian**: Daftar lengkap presensi dengan penanda merah untuk pegawai terlambat beserta durasi keterlambatan (contoh: `+18m`).
   - **👥 Rekapitulasi per Pegawai**: Akumulasi total kehadiran, total hari terlambat, total menit keterlambatan, dan persentase disiplin per individu dosen/tendik.
   - **🏛 Rekapitulasi per Program Studi**: Evaluasi kepatuhan antar prodi (Ilmu Komunikasi, Ilmu Pemerintahan, Ilmu Hukum, Administrasi Publik, Administrasi Bisnis, Sosiologi, Sastra Inggris, Bagian Tata Usaha).

6. **Filter & Pencarian Multidimensi**:
   - Pencarian instan (Live Search) berdasarkan Nama Pegawai atau NIP.
   - Filter cepat status: *Semua*, *🚨 Terlambat*, *✅ Tepat Waktu*, *⏳ Pulang Cepat*, *📄 Izin/Cuti*.
   - Filter Program Studi / Unit Kerja (13 unit kerja).
   - Filter Tanggal Presensi.

---

## 🌐 Akses Lokal

### Akses Cepat via Server (Port 3300)
- **Portal Landing Page**: [http://localhost:3300/](http://localhost:3300/)
- **Dashboard Presensi**: [http://localhost:3300/dashboard](http://localhost:3300/dashboard)

### Menjalankan Server Lokal Sendiri
```bash
cd dashboard-absensi-fhisip
node server.js
```

### Buka Langsung File HTML (Tanpa Server)
- Landing Page: `landing.html`
- Dashboard Presensi: `index.html`

---

## 🐙 1. Panduan GitHub

Repositori Git lokal telah diinisialisasi pada branch `main`.

Untuk menghubungkan ke GitHub Anda (`fadil767`):

1. Buat repository baru di GitHub: [https://github.com/new](https://github.com/new)
   - Nama Repository: `dashboard-absensi-fhisip`
   - Visibilitas: *Public* atau *Private* (pilihan Anda)
   - *Jangan centang "Initialize with a README" atau .gitignore karena sudah dibuat lokal.*
2. Jalankan perintah berikut di terminal:
   ```bash
   cd C:\Users\Fadil\.gemini\antigravity-ide\scratch\dashboard-absensi-fhisip
   git remote add origin https://github.com/fadil767/dashboard-absensi-fhisip.git
   git push -u origin main
   ```

---

## ☁️ 2. Panduan Supabase (Database Cloud)

Skema basis data PostgreSQL dan seed data 121 pegawai resmi FHISIP UT telah disiapkan di folder `supabase/`.

### Langkah Setup Supabase:
1. Buka [https://supabase.com](https://supabase.com) dan buat project baru (misal: `ut-fhisip-absensi`).
2. Masuk ke menu **SQL Editor** pada dashboard Supabase.
3. Jalankan berkas:
   - [`supabase/schema.sql`](supabase/schema.sql) — Membuat tabel `unit_kerja`, `pegawai`, `pengaturan_jam_kerja`, `absensi`, `audit_log`, RLS, dan View.
   - [`supabase/seed.sql`](supabase/seed.sql) — Mengisi data 13 Program Studi, 121 Pegawai, dan 948 catatan presensi.
4. Buka menu **Project Settings → API** di Supabase untuk mendapatkan:
   - **Project URL**
   - **anon / public key**
5. Buka dashboard di peramban, klik tombol **"☁️ Supabase"** di header atas, masukkan Project URL dan anon key, lalu klik **"⚡ Test Koneksi"**.
6. Anda dapat menggunakan tombol **"⬇ Tarik Data dari Cloud"** atau **"⬆ Unggah Data Lokal ke Cloud"** untuk sinkronisasi kapan saja.

---

## 🚀 3. Panduan Vercel (Deployment Cloud)

Konfigurasi [`vercel.json`](vercel.json) telah disiapkan dengan aturan rute otomatis (`/` menuju landing page dan `/dashboard` menuju dashboard presensi) serta header keamanan.

### Cara A: Deploy via GitHub (Paling Direkomendasikan)
1. Setelah push kode ke GitHub (lihat langkah GitHub di atas).
2. Masuk ke [https://vercel.com](https://vercel.com) dengan akun GitHub Anda.
3. Klik **"Add New..." → "Project"**.
4. Pilih repositori `dashboard-absensi-fhisip`.
5. Klik **Deploy**. Website Anda akan langsung aktif dengan domain HTTPS gratis (contoh: `dashboard-absensi-fhisip.vercel.app`).
6. Setiap kali Anda melakukan `git push`, Vercel akan otomatis meng-update deployment Anda (CI/CD otomatis)!

### Cara B: Deploy Langsung via Vercel CLI di Terminal
```bash
cd C:\Users\Fadil\.gemini\antigravity-ide\scratch\dashboard-absensi-fhisip
npx vercel
```
- Ikuti prompt di terminal:
  - *Set up and deploy?* Ketik `y`
  - *Which scope?* Pilih akun Vercel Anda
  - *Link to existing project?* Ketik `n`
  - *What's your project's name?* `dashboard-absensi-fhisip`
  - *In which directory is your code located?* `./`
- Untuk deploy production:
```bash
npx vercel --prod
```
