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

3. **Manajemen & Pengaturan Data Pegawai**:
   - ➕ **Tambah Presensi Baru**: Modal form lengkap untuk input presensi manual.
   - ✏️ **Edit Data Presensi**: Ubah jam datang, jam pulang, dan catatan/dispensasi secara fleksibel.
   - 🗑️ **Hapus Presensi**: Hapus record presensi dengan konfirmasi aman.
   - 🔄 **Reset Data**: Kembalikan ke data awal resmi jika ingin memulai simulasi baru.

4. **Tiga Tampilan Rekapitulasi**:
   - **📋 Log Presensi Harian**: Daftar lengkap presensi dengan penanda merah untuk pegawai terlambat beserta durasi keterlambatan (contoh: `+18m`).
   - **👥 Rekapitulasi per Pegawai**: Akumulasi total kehadiran, total hari terlambat, total menit keterlambatan, dan persentase disiplin per individu dosen/tendik.
   - **🏛 Rekapitulasi per Program Studi**: Evaluasi kepatuhan antar prodi (Ilmu Komunikasi, Ilmu Pemerintahan, Ilmu Hukum, Administrasi Publik, Administrasi Bisnis, Sosiologi, Sastra Inggris, Bagian Tata Usaha).

5. **Filter & Pencarian Multidimensi**:
   - Pencarian instan (Live Search) berdasarkan Nama Pegawai atau NIP.
   - Filter cepat status: *Semua*, *🚨 Terlambat*, *✅ Tepat Waktu*, *⏳ Pulang Cepat*, *📄 Izin/Cuti*.
   - Filter Program Studi / Unit Kerja.
   - Filter Tanggal Presensi.
   - Pengurutan data (Menit telat terlama, Nama A-Z, Jam datang paling pagi, Tanggal terbaru).

## Akses & Cara Menjalankan

### Akses Cepat via Server (Sedang Berjalan di Port 3300)
- **Portal Landing Page**: [http://localhost:3300/](http://localhost:3300/)
- **Dashboard Presensi**: [http://localhost:3300/dashboard](http://localhost:3300/dashboard)

### Menjalankan Server Sendiri
```bash
cd dashboard-absensi-fhisip
node server.js
```
Buka browser di: **`http://localhost:3300`**

### Buka Langsung File HTML (Tanpa Server)
Buka file langsung di browser:
- Landing Page: [landing.html](file:///C:/Users/Fadil/.gemini/antigravity-ide/scratch/dashboard-absensi-fhisip/landing.html)
- Dashboard Presensi: [index.html](file:///C:/Users/Fadil/.gemini/antigravity-ide/scratch/dashboard-absensi-fhisip/index.html)

Aplikasi berjalan 100% mandiri (*zero-dependency*) di sisi peramban (*client-side*) dengan penyimpanan otomatis via LocalStorage.
