/**
 * Script untuk Menyinkronkan Data Awal FHISIP UT ke Database Supabase
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const dump = JSON.parse(fs.readFileSync(path.join(__dirname, '../ut-absensi-dump.json'), 'utf8'));

// Memuat konfigurasi dari .env jika ada
if (fs.existsSync(path.join(__dirname, '.env'))) {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  envContent.split('\n').forEach(line => {
    const [k, ...v] = line.trim().split('=');
    if (k && v.length) process.env[k] = v.join('=').trim();
  });
}

const secKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.SUPABASE_URL || 'https://sxnimpyselgoenpurhhw.supabase.co';
const baseUrl = `${supabaseUrl}/rest/v1`;

if (!secKey) {
  console.error('ERROR: SUPABASE_SECRET_KEY tidak ditemukan di .env atau environment variables!');
  process.exit(1);
}

function post(endpoint, body) {
  return new Promise((resolve, reject) => {
    const dataStr = JSON.stringify(body);
    const req = https.request(baseUrl + endpoint, {
      method: 'POST',
      headers: {
        'apikey': secKey,
        'Authorization': 'Bearer ' + secKey,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates, return=minimal'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(dataStr);
    req.end();
  });
}

async function run() {
  console.log('1. Mengisi Data Unit Kerja...');
  const unitNames = [...new Set(dump.pegawai.map(p => p.unit_kerja).filter(Boolean))].sort();
  const unitRows = unitNames.map((u, i) => ({ id: i + 1, nama: u }));
  const r1 = await post('/unit_kerja', unitRows);
  console.log('   - Unit Kerja:', r1.status === 201 ? 'Berhasil (201)' : r1.status);

  console.log('2. Mengisi Pengaturan Jam Kerja...');
  const r2 = await post('/pengaturan_jam_kerja', [{ id: 1, jam_masuk: '08:30', toleransi_menit: 0, jam_pulang: '16:30', jam_pulang_jumat: '16:30', keterangan: 'Kebijakan Resmi FHISIP UT' }]);
  console.log('   - Pengaturan:', r2.status === 201 ? 'Berhasil (201)' : r2.status);

  console.log('3. Mengisi 121 Pegawai FHISIP UT...');
  const pegawaiRows = dump.pegawai.map(p => {
    const uIdx = unitNames.indexOf(p.unit_kerja) + 1;
    return {
      nip: p.nip,
      nama_lengkap: p.nama_lengkap,
      status_kepegawaian: p.status_kepegawaian || 'PNS',
      jabatan: p.jabatan || 'Dosen',
      unit_kerja_id: uIdx > 0 ? uIdx : null,
      aktif: true
    };
  });
  const r3 = await post('/pegawai', pegawaiRows);
  console.log('   - Pegawai (' + pegawaiRows.length + ' orang):', r3.status === 201 ? 'Berhasil (201)' : r3.status);

  console.log('4. Mengisi ' + dump.absensi.length + ' Catatan Presensi...');
  const chunkSize = 200;
  for (let i = 0; i < dump.absensi.length; i += chunkSize) {
    const chunk = dump.absensi.slice(i, i + chunkSize).map(a => ({
      nip: a.nip,
      tanggal: a.tanggal,
      jam_masuk: a.jam_masuk || null,
      jam_pulang: a.jam_pulang || null,
      status_kehadiran: a.status_kehadiran || 'Hadir',
      keterangan: a.keterangan || 'Data Scan Resmi'
    }));
    const r4 = await post('/absensi', chunk);
    console.log('   - Batch ' + (i + 1) + ' s/d ' + Math.min(i + chunkSize, dump.absensi.length) + ':', r4.status === 201 ? 'Berhasil (201)' : r4.status);
  }

  console.log('\nSEMUA DATA BERHASIL DI-SEED KE DATABASE SUPABASE CLOUD!');
}

run().catch(console.error);
