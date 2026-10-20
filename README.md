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

## 🌐 Akses Live & Deployment

### 🚀 Production Live (Vercel)
- **Portal Landing Page**: [https://dashboard-absensi-fhisip.vercel.app/](https://dashboard-absensi-fhisip.vercel.app/)
- **Dashboard Presensi Interaktif**: [https://dashboard-absensi-fhisip.vercel.app/dashboard](https://dashboard-absensi-fhisip.vercel.app/dashboard)

### 🐙 Repositori GitHub
- **URL Repositori**: [https://github.com/fadil767/dashboard-absensi-fhisip](https://github.com/fadil767/dashboard-absensi-fhisip)
- **Branch Utama**: `main`

### 💻 Akses Lokal (Pengembangan)
- **Portal Landing Page**: [http://localhost:3300/](http://localhost:3300/)
- **Dashboard Presensi**: [http://localhost:3300/dashboard](http://localhost:3300/dashboard)

```bash
# Menjalankan server lokal
npm start
# atau
node server.js
```

### 🔑 Akun Login Tersedia
| Peran / Akun | Nama Pengguna / Email | Kata Sandi | Deskripsi Hak Akses |
| :--- | :--- | :--- | :--- |
| **Admin FHISIP** | `admin` / `fhisip@ecampus.ut.ac.id` | `admin123` | Administrator (Akses Penuh: input, atur jam, impor/ekspor, sinkronisasi) |
| **Dosen** | `dosen` / `dosen@ecampus.ut.ac.id` | `dosen123` | Dosen Tetap FHISIP UT (Lihat dan evaluasi presensi) |
| **Dekanat** | `dekan` / `dekan@ecampus.ut.ac.id` | `dekan123` | Pimpinan Fakultas (Monitoring kedisiplinan dan laporan) |
| **Tamu / Evaluator** | Tombol *"Lihat halaman publik / evaluator"* | *(Tanpa kata sandi)* | Akses langsung publik / akreditasi evaluator |

---

## ☁️ Integrasi Supabase Cloud

Aplikasi telah terhubung langsung dengan project Supabase Cloud aktif:
- **Project URL**: `https://sxnimpyselgoenpurhhw.supabase.co`
- **Data Tersinkronisasi**:
  - `unit_kerja`: 13 Unit / Program Studi FHISIP UT
  - `pengaturan_jam_kerja`: Kebijakan resmi FHISIP UT (08:30 & 16:30)
  - `pegawai`: 121 Pegawai resmi
  - `absensi`: 948 Catatan presensi biometrik lengkap
- **Keamanan Kunci**:
  - `SUPABASE_PUBLISHABLE_KEY`: Digunakan secara aman di client-side ([`js/supabase-client.js`](js/supabase-client.js)).
  - `SUPABASE_SECRET_KEY`: Disimpan di berkas rahasia `.env` (diabaikan oleh git via `.gitignore`) dan hanya digunakan oleh script sinkronisasi database ([`sync-to-supabase.js`](sync-to-supabase.js)).

### Skrip Migrasi & Sinkronisasi
```bash
# Menyinkronkan ulang data awal ke Supabase jika dibutuhkan
node sync-to-supabase.js
```

---

## 🚀 Deployment Vercel & CI/CD Otomatis

Proyek ini telah dideploy di Vercel dan terhubung langsung (*Connected*) dengan repositori GitHub `fadil767/dashboard-absensi-fhisip`.

- **Auto-Deploy CI/CD**: Setiap kali Anda melakukan `git push origin main`, Vercel akan secara otomatis membangun dan memperbarui website secara instan!
- **Konfigurasi Routing**: Diatur rapi melalui [`vercel.json`](vercel.json) dengan parameter rewrites dan bundling otomatis.
- **Deploy Manual via CLI**:
  ```bash
  npx vercel --prod
  ```

