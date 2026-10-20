const fs = require('fs');
const XLSX = require('../js/vendor/xlsx.full.min.js');

const filePath = 'C:/Users/Fadil/Downloads/Database September1 (1).xlsx';
const buf = fs.readFileSync(filePath);
const wb = XLSX.read(buf, { type: 'buffer' });

// Load existing pegawai
const dataContent = fs.readFileSync('js/data-fhisip.js', 'utf8');
const vm = require('vm');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(dataContent, context);
const existingPegawai = context.window.INITIAL_FHISIP_DATA.pegawai;
console.log('Existing pegawai count in system:', existingPegawai.length);

const s1Rows = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'], { header: 1, raw: true, defval: null });
const s2Rows = XLSX.utils.sheet_to_json(wb.Sheets['tarikan data baru'], { header: 1, raw: true, defval: null });

// Map PIN -> Unit from s2 (tarikan data baru)
const pinToProdi = new Map();
const pinToName2 = new Map();
for (let r = 0; r < s2Rows.length; r++) {
  const row = s2Rows[r] || [];
  if (row[9] != null && row[14]) {
    const pin = String(row[9]).trim();
    pinToProdi.set(pin, String(row[2] || '').trim());
    pinToName2.set(pin, String(row[14] || '').trim());
  }
}

// Function to normalize prodi name to our standard FHISIP names
function normalizeUnit(rawUnit) {
  if (!rawUnit) return 'Dekanat FHISIP';
  const u = rawUnit.toLowerCase();
  if (u.includes('keuangan') || u.includes('sdm')) return 'Bagian Tata Usaha: Keuangan, SDM, dan Umum';
  if (u.includes('akademik')) return 'Bagian Tata Usaha: Akademik';
  if (u.includes('kemahasiwaan') || u.includes('kemahasiswaan')) return 'Bagian Tata Usaha: Kemahasiswaan';
  if (u.includes('bisnis')) return 'Program Studi S1 Administrasi Bisnis';
  if (u.includes('publik')) return 'Program Studi S1 Administrasi Publik';
  if (u.includes('sastra') || u.includes('inggris')) return 'Program Studi S1 Sastra Inggris';
  if (u.includes('komunikasi')) return 'Program Studi S1 Ilmu Komunikasi';
  if (u.includes('pemerintahan')) return 'Program Studi S1 Ilmu Pemerintahan';
  if (u.includes('hukum')) return 'Program Studi S1 Ilmu Hukum';
  if (u.includes('sosiologi')) return 'Program Studi S1 Sosiologi';
  if (u.includes('perpajakan')) return 'Program Studi S1 Perpajakan';
  if (u.includes('perpustakaan')) return 'Program Studi Perpustakaan dan Sains Informasi';
  if (u.includes('dekanat')) return 'Dekanat FHISIP';
  if (u.includes('administrasi')) return 'Bagian Tata Usaha: Keuangan, SDM, dan Umum';
  if (u.includes('ptnpns')) return 'Bagian Tata Usaha: Keuangan, SDM, dan Umum';
  return rawUnit;
}

const defaultYear = 2026;
const parsedRecords = [];
const allPegawaiMap = new Map();

// First, seed all existingPegawai so we don't lose any registered employee
for (const p of existingPegawai) {
  allPegawaiMap.set(p.nip, { ...p });
}

for (let r = 0; r < s1Rows.length; r++) {
  const row = s1Rows[r] || [];
  const pin = row[9];
  const name = row[14];
  const unitS1 = row[2];

  if (pin != null && name && typeof name === 'string') {
    const pinStr = String(pin).trim();
    const rawName = String(name).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    const unitS2 = pinToProdi.get(pinStr) || unitS1;
    const finalUnit = normalizeUnit(unitS2);

    // Match with existing pegawai
    const cleanLower = rawName.toLowerCase();
    let matched = existingPegawai.find(p => {
      const pName = (p.nama_lengkap || '').toLowerCase();
      return pName === cleanLower || pName.includes(cleanLower) || cleanLower.includes(pName);
    });

    let nip = matched ? matched.nip : ('PIN-' + pinStr);
    let statusKepeg = matched ? matched.status_kepegawaian : (unitS1 === 'PTNPNS' ? 'Non-PNS' : 'PNS');
    let jabatan = matched ? matched.jabatan : (unitS1 === 'DOSEN' ? 'Dosen' : 'Tenaga Kependidikan');

    const empObj = {
      nip: nip,
      nama_lengkap: matched ? matched.nama_lengkap : rawName,
      status_kepegawaian: statusKepeg,
      jabatan: jabatan,
      unit_kerja: matched ? matched.unit_kerja : finalUnit
    };

    allPegawaiMap.set(nip, empObj);

    // Read attendance blocks: next rows until next employee or empty
    for (let offset = 1; offset <= 10; offset++) {
      const dateRow = s1Rows[r + offset];
      if (!dateRow) continue;
      // If next employee header, break
      if (dateRow[9] != null && dateRow[14]) break;

      const dateCols = [];
      for (let c = 0; c < dateRow.length; c++) {
        const val = dateRow[c];
        if (typeof val === 'string') {
          const m = /^(\d{2})\/(\d{2})\s+[A-Za-z]{3}$/.exec(val.trim());
          if (m) dateCols.push({ col: c, month: m[1], day: m[2] });
        }
      }

      if (dateCols.length > 0) {
        const valRow = s1Rows[r + offset + 1] || [];
        for (const dc of dateCols) {
          const cellVal = valRow[dc.col];
          const ymd = defaultYear + '-' + dc.month + '-' + dc.day;

          let jamMasuk = null;
          let jamPulang = null;
          let statusKehadiran = 'Hadir';
          let keterangan = null;
          let hasRecord = false;

          if (typeof cellVal === 'number') {
            const frac = cellVal - Math.floor(cellVal);
            const mins = Math.round(frac * 1440) % 1440;
            const hh = String(Math.floor(mins / 60)).padStart(2, '0');
            const mm = String(mins % 60).padStart(2, '0');
            const t = hh + ':' + mm;
            if (mins < 720) jamMasuk = t; else jamPulang = t;
            hasRecord = true;
          } else if (cellVal) {
            const s = String(cellVal).replace(/\r?\n/g, ' ').trim();
            if (s && s !== '-' && s !== '     -     ') {
              const upper = s.toUpperCase();
              if (upper === 'WFH') {
                statusKehadiran = 'Hadir';
                keterangan = 'Work From Home (WFH)';
                hasRecord = true;
              } else if (upper.includes('SAKIT')) {
                statusKehadiran = 'Sakit';
                keterangan = 'Izin Sakit';
                hasRecord = true;
              } else if (upper.includes('IZIN')) {
                statusKehadiran = 'Izin';
                keterangan = 'Izin Resmi';
                hasRecord = true;
              } else if (upper.includes('CUTI')) {
                statusKehadiran = 'Cuti';
                keterangan = 'Cuti Tahunan / Bersama';
                hasRecord = true;
              } else {
                const mBoth = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(s);
                if (mBoth) {
                  jamMasuk = mBoth[1].padStart(5, '0');
                  jamPulang = mBoth[2].padStart(5, '0');
                  hasRecord = true;
                } else {
                  const mIn = /(\d{1,2}:\d{2})\s*-/.exec(s);
                  if (mIn) {
                    jamMasuk = mIn[1].padStart(5, '0');
                    hasRecord = true;
                  } else {
                    const mOut = /-\s*(\d{1,2}:\d{2})/.exec(s);
                    if (mOut) {
                      jamPulang = mOut[1].padStart(5, '0');
                      hasRecord = true;
                    } else {
                      const mSingle = /(\d{1,2}:\d{2})/.exec(s);
                      if (mSingle) {
                        const t = mSingle[1].padStart(5, '0');
                        const [hh] = t.split(':').map(Number);
                        if (hh < 12) jamMasuk = t; else jamPulang = t;
                        hasRecord = true;
                      }
                    }
                  }
                }
              }
            }
          }

          if (hasRecord) {
            parsedRecords.push({
              id: parsedRecords.length + 1,
              tanggal: ymd,
              nip: empObj.nip,
              nama_lengkap: empObj.nama_lengkap,
              unit_kerja: empObj.unit_kerja,
              jam_masuk: jamMasuk,
              jam_pulang: jamPulang,
              status_kehadiran: statusKehadiran,
              keterangan: keterangan || 'Mesin Biometrik'
            });
          }
        }
      }
    }
  }
}

console.log('Total Pegawai in combined master:', allPegawaiMap.size);
console.log('Total September 2026 records parsed:', parsedRecords.length);
console.log('Sample parsed record 0:', parsedRecords[0]);
console.log('Sample parsed record 10:', parsedRecords[10]);
console.log('Sample parsed record 50:', parsedRecords[50]);

// Count by status
const statusCounts = {};
parsedRecords.forEach(r => {
  statusCounts[r.status_kehadiran] = (statusCounts[r.status_kehadiran] || 0) + 1;
});
console.log('Status counts in September data:', statusCounts);
