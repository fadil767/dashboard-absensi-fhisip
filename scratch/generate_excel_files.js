const fs = require('fs');
const XLSX = require('../js/vendor/xlsx.full.min.js');
const vm = require('vm');

// Read data-fhisip.js
const ctx = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync('js/data-fhisip.js', 'utf8'), ctx);
const data = ctx.window.INITIAL_FHISIP_DATA;
const septRecords = data.absensi.filter(a => a.tanggal.startsWith('2026-09'));
const octRecords = data.absensi.filter(a => a.tanggal.startsWith('2026-10'));
const pegawaiList = data.pegawai;

console.log('Generating Excel Reference files...');
console.log('September records:', septRecords.length);
console.log('Pegawai count:', pegawaiList.length);

// 1. Create Clean September 2026 Excel File
const septWb = XLSX.utils.book_new();

// Sheet 1: Log Presensi September 2026
const septRows = septRecords.map((r, idx) => ({
  'No': idx + 1,
  'Tanggal': r.tanggal,
  'NIP': r.nip,
  'Nama Lengkap': r.nama_lengkap,
  'Unit Kerja / Program Studi': r.unit_kerja,
  'Jam Masuk': r.jam_masuk || '-',
  'Jam Pulang': r.jam_pulang || '-',
  'Status Kehadiran': r.status_kehadiran,
  'Keterangan': r.keterangan || 'Mesin Biometrik'
}));
const wsSept = XLSX.utils.json_to_sheet(septRows);
// Set column widths
wsSept['!cols'] = [
  { wch: 6 },
  { wch: 14 },
  { wch: 22 },
  { wch: 35 },
  { wch: 42 },
  { wch: 12 },
  { wch: 12 },
  { wch: 18 },
  { wch: 28 }
];
XLSX.utils.book_append_sheet(septWb, wsSept, 'Presensi September 2026');

// Sheet 2: Master Pegawai FHISIP UT
const empRows = pegawaiList.map((p, idx) => ({
  'No': idx + 1,
  'NIP': p.nip,
  'Nama Lengkap': p.nama_lengkap,
  'Status Kepegawaian': p.status_kepegawaian,
  'Jabatan': p.jabatan,
  'Program Studi / Bagian': p.unit_kerja
}));
const wsEmp = XLSX.utils.json_to_sheet(empRows);
wsEmp['!cols'] = [
  { wch: 6 },
  { wch: 22 },
  { wch: 35 },
  { wch: 20 },
  { wch: 30 },
  { wch: 42 }
];
XLSX.utils.book_append_sheet(septWb, wsEmp, 'Master Pegawai FHISIP');

// Sheet 3: Rekap per Unit Kerja September 2026
const unitSummary = {};
for (const p of pegawaiList) {
  if (!unitSummary[p.unit_kerja]) {
    unitSummary[p.unit_kerja] = { totalPegawai: 0, totalScan: 0, hadir: 0, cuti: 0, sakit: 0, izin: 0 };
  }
  unitSummary[p.unit_kerja].totalPegawai++;
}
for (const r of septRecords) {
  const u = r.unit_kerja || 'Dekanat FHISIP';
  if (!unitSummary[u]) {
    unitSummary[u] = { totalPegawai: 0, totalScan: 0, hadir: 0, cuti: 0, sakit: 0, izin: 0 };
  }
  unitSummary[u].totalScan++;
  if (r.status_kehadiran === 'Hadir') unitSummary[u].hadir++;
  else if (r.status_kehadiran === 'Cuti') unitSummary[u].cuti++;
  else if (r.status_kehadiran === 'Sakit') unitSummary[u].sakit++;
  else unitSummary[u].izin++;
}
const rekapRows = Object.keys(unitSummary).sort().map((unit, idx) => ({
  'No': idx + 1,
  'Program Studi / Bagian': unit,
  'Jumlah Pegawai': unitSummary[unit].totalPegawai,
  'Total Catatan Presensi': unitSummary[unit].totalScan,
  'Hadir': unitSummary[unit].hadir,
  'Cuti': unitSummary[unit].cuti,
  'Sakit': unitSummary[unit].sakit,
  'Izin': unitSummary[unit].izin
}));
const wsRekap = XLSX.utils.json_to_sheet(rekapRows);
wsRekap['!cols'] = [
  { wch: 6 },
  { wch: 45 },
  { wch: 16 },
  { wch: 22 },
  { wch: 10 },
  { wch: 10 },
  { wch: 10 },
  { wch: 10 }
];
XLSX.utils.book_append_sheet(septWb, wsRekap, 'Rekap Unit September 2026');

const septFileOut = 'Database_September_2026_Clean_FHISIP.xlsx';
const bufSept = XLSX.write(septWb, { type: 'buffer', bookType: 'xlsx' });
fs.writeFileSync(septFileOut, bufSept);
console.log('Created:', septFileOut, 'Size:', bufSept.length, 'bytes');

// 2. Create Template Format Standard Excel File for Next Month (e.g. November / December)
const tplWb = XLSX.utils.book_new();
const sampleRows = [
  {
    'Tanggal': '2026-11-02',
    'NIP': '199305122009031148',
    'Nama Lengkap': 'Acep Surya',
    'Program Studi / Unit Kerja': 'Bagian Tata Usaha: Keuangan, SDM, dan Umum',
    'Jam Masuk': '07:45',
    'Jam Pulang': '16:45',
    'Status Kehadiran': 'Hadir',
    'Keterangan': 'Mesin Biometrik'
  },
  {
    'Tanggal': '2026-11-02',
    'NIP': '199405122021031574',
    'Nama Lengkap': 'MEITA ISTI',
    'Program Studi / Unit Kerja': 'Dekanat FHISIP',
    'Jam Masuk': '07:30',
    'Jam Pulang': '17:00',
    'Status Kehadiran': 'Hadir',
    'Keterangan': 'Mesin Biometrik'
  },
  {
    'Tanggal': '2026-11-02',
    'NIP': '198105122015031586',
    'Nama Lengkap': 'Dr. Sri Sediyaningsih, M.Si.',
    'Program Studi / Unit Kerja': 'Program Studi S1 Ilmu Komunikasi',
    'Jam Masuk': '08:15',
    'Jam Pulang': '16:35',
    'Status Kehadiran': 'Hadir',
    'Keterangan': 'Mesin Biometrik'
  },
  {
    'Tanggal': '2026-11-02',
    'NIP': '197905122012032159',
    'Nama Lengkap': 'Bahir Mukhammad, S.H., M.H.',
    'Program Studi / Unit Kerja': 'Program Studi S1 Ilmu Hukum',
    'Jam Masuk': '08:20',
    'Jam Pulang': '16:40',
    'Status Kehadiran': 'Hadir',
    'Keterangan': 'Mesin Biometrik'
  },
  {
    'Tanggal': '2026-11-02',
    'NIP': '198705122008032867',
    'Nama Lengkap': 'Rahma Tri Nurnindiati, S.I.Kom.',
    'Program Studi / Unit Kerja': 'Bagian Tata Usaha: Akademik',
    'Jam Masuk': '-',
    'Jam Pulang': '-',
    'Status Kehadiran': 'Cuti',
    'Keterangan': 'Cuti Tahunan'
  }
];
const wsTpl = XLSX.utils.json_to_sheet(sampleRows);
wsTpl['!cols'] = [
  { wch: 14 },
  { wch: 22 },
  { wch: 35 },
  { wch: 42 },
  { wch: 12 },
  { wch: 12 },
  { wch: 18 },
  { wch: 25 }
];
XLSX.utils.book_append_sheet(tplWb, wsTpl, 'Template Input Presensi');

// Panduan Kolom
const panduan = [
  { 'Nama Kolom': 'Tanggal', 'Tipe Data': 'YYYY-MM-DD', 'Wajib': 'Ya', 'Contoh': '2026-11-02', 'Penjelasan': 'Format tanggal standar tahun-bulan-hari' },
  { 'Nama Kolom': 'NIP', 'Tipe Data': 'Teks / Angka', 'Wajib': 'Ya', 'Contoh': '199305122009031148', 'Penjelasan': 'Nomor Induk Pegawai resmi atau ID Pegawai' },
  { 'Nama Kolom': 'Nama Lengkap', 'Tipe Data': 'Teks', 'Wajib': 'Ya', 'Contoh': 'Acep Surya', 'Penjelasan': 'Nama lengkap pegawai beserta gelar bila ada' },
  { 'Nama Kolom': 'Program Studi / Unit Kerja', 'Tipe Data': 'Teks', 'Wajib': 'Ya', 'Contoh': 'Program Studi S1 Ilmu Komunikasi', 'Penjelasan': 'Pilih salah satu dari 13 unit resmi FHISIP UT' },
  { 'Nama Kolom': 'Jam Masuk', 'Tipe Data': 'HH:MM (24 Jam)', 'Wajib': 'Tidak (jika Cuti/Sakit)', 'Contoh': '08:15', 'Penjelasan': 'Waktu scan sidik jari/wajah saat tiba' },
  { 'Nama Kolom': 'Jam Pulang', 'Tipe Data': 'HH:MM (24 Jam)', 'Wajib': 'Tidak', 'Contoh': '16:35', 'Penjelasan': 'Waktu scan saat kepulangan' },
  { 'Nama Kolom': 'Status Kehadiran', 'Tipe Data': 'Pilihan', 'Wajib': 'Ya', 'Contoh': 'Hadir', 'Penjelasan': 'Hadir / Cuti / Sakit / Izin / Dinas Luar' },
  { 'Nama Kolom': 'Keterangan', 'Tipe Data': 'Teks', 'Wajib': 'Tidak', 'Contoh': 'Mesin Biometrik', 'Penjelasan': 'Catatan tambahan seperti WFH, Cuti Bersama, dll.' }
];
const wsPanduan = XLSX.utils.json_to_sheet(panduan);
wsPanduan['!cols'] = [
  { wch: 26 },
  { wch: 20 },
  { wch: 10 },
  { wch: 22 },
  { wch: 50 }
];
XLSX.utils.book_append_sheet(tplWb, wsPanduan, 'Panduan Struktur Kolom');

// Daftar 13 Unit Resmi
const prodiList = [
  { 'No': 1, 'Nama Unit / Program Studi': 'Dekanat FHISIP', 'Tipe': 'Pimpinan Fakultas' },
  { 'No': 2, 'Nama Unit / Program Studi': 'Bagian Tata Usaha: Keuangan, SDM, dan Umum', 'Tipe': 'Tata Usaha' },
  { 'No': 3, 'Nama Unit / Program Studi': 'Bagian Tata Usaha: Akademik', 'Tipe': 'Tata Usaha' },
  { 'No': 4, 'Nama Unit / Program Studi': 'Bagian Tata Usaha: Kemahasiswaan', 'Tipe': 'Tata Usaha' },
  { 'No': 5, 'Nama Unit / Program Studi': 'Program Studi S1 Ilmu Komunikasi', 'Tipe': 'Program Studi S1' },
  { 'No': 6, 'Nama Unit / Program Studi': 'Program Studi S1 Ilmu Pemerintahan', 'Tipe': 'Program Studi S1' },
  { 'No': 7, 'Nama Unit / Program Studi': 'Program Studi S1 Ilmu Hukum', 'Tipe': 'Program Studi S1' },
  { 'No': 8, 'Nama Unit / Program Studi': 'Program Studi S1 Sosiologi', 'Tipe': 'Program Studi S1' },
  { 'No': 9, 'Nama Unit / Program Studi': 'Program Studi S1 Administrasi Publik', 'Tipe': 'Program Studi S1' },
  { 'No': 10, 'Nama Unit / Program Studi': 'Program Studi S1 Administrasi Bisnis', 'Tipe': 'Program Studi S1' },
  { 'No': 11, 'Nama Unit / Program Studi': 'Program Studi S1 Sastra Inggris', 'Tipe': 'Program Studi S1' },
  { 'No': 12, 'Nama Unit / Program Studi': 'Program Studi S1 Perpajakan', 'Tipe': 'Program Studi S1' },
  { 'No': 13, 'Nama Unit / Program Studi': 'Program Studi Perpustakaan dan Sains Informasi', 'Tipe': 'Program Studi S1' }
];
const wsProdi = XLSX.utils.json_to_sheet(prodiList);
wsProdi['!cols'] = [
  { wch: 6 },
  { wch: 48 },
  { wch: 22 }
];
XLSX.utils.book_append_sheet(tplWb, wsProdi, '13 Unit Resmi FHISIP');

const tplFileOut = 'Template_Format_Presensi_FHISIP.xlsx';
const bufTpl = XLSX.write(tplWb, { type: 'buffer', bookType: 'xlsx' });
fs.writeFileSync(tplFileOut, bufTpl);
console.log('Created:', tplFileOut, 'Size:', bufTpl.length, 'bytes');
