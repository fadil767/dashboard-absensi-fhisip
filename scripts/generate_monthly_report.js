const fs = require('fs');
const XLSX = require('../js/vendor/xlsx.full.min.js');
const vm = require('vm');

// Read data-fhisip.js
const ctx = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync('js/data-fhisip.js', 'utf8'), ctx);
const data = ctx.window.INITIAL_FHISIP_DATA;
const pegawaiList = data.pegawai;
const allAbsensi = data.absensi;

console.log('Total Pegawai:', pegawaiList.length);
console.log('Total Absensi:', allAbsensi.length);

/**
 * Generate official monthly attendance recap workbook
 * exactly matching 'Rekapitulasi Kehadiran September 2026.xlsx'
 */
function generateOfficialMonthlyReport(year, month, groupBy = 'kategori') {
  const monthStr = String(month).padStart(2, '0');
  const ymPrefix = `${year}-${monthStr}`;

  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const namaBulan = monthNames[month - 1];

  // Filter records for this month
  const monthRecords = allAbsensi.filter(a => a.tanggal && a.tanggal.startsWith(ymPrefix));
  
  // Calculate date range in this month
  const dates = [...new Set(monthRecords.map(a => a.tanggal))].sort();
  const startDate = dates.length > 0 ? dates[0] : `${year}-${monthStr}-01`;
  const endDate = dates.length > 0 ? dates[dates.length - 1] : `${year}-${monthStr}-30`;

  // Format DD-MM-YYYY
  const formatYmdToDmy = (ymd) => {
    const parts = ymd.split('-');
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  };
  const periodeStr = `Dari ${formatYmdToDmy(startDate)} s/d ${formatYmdToDmy(endDate)}`;

  // Count standard working days in month (Mon-Fri)
  const [y, m] = [year, month];
  const daysInMonth = new Date(y, m, 0).getDate();
  let workingDaysNormal = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dayOfWeek = new Date(y, m - 1, d).getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) workingDaysNormal++;
  }

  // Aggregate attendance per employee for this month
  const empMap = new Map();
  for (const p of pegawaiList) {
    // Extract numeric PIN/ID if available from NIP
    let pin = '';
    const mPin = /(\d{3,4})$/.exec(p.nip);
    if (mPin) pin = parseInt(mPin[1], 10);

    empMap.set(p.nip, {
      ...p,
      pin: pin || p.nip,
      normalDays: workingDaysNormal,
      riilDays: 0,
      absenDays: 0,
      terlambat: 0,
      pulangCepat: 0,
      lembur: 0,
      tanpaKeterangan: 0,
      dinasLuar: 0,
      tidakScanMasuk: 0,
      tidakScanPulang: 0,
      scanCount: 0,
      sakit: 0,
      cuti: 0,
      izin: 0,
      notes: []
    });
  }

  // Standard threshold
  const thresholdMasuk = 8 * 60 + 30; // 08:30
  const thresholdPulang = 16 * 60 + 30; // 16:30

  const parseMinutes = (t) => {
    if (!t) return null;
    const parts = t.split(':').map(Number);
    return parts[0] * 60 + parts[1];
  };

  for (const r of monthRecords) {
    if (!empMap.has(r.nip)) continue;
    const agg = empMap.get(r.nip);

    const masukMin = parseMinutes(r.jam_masuk);
    const pulangMin = parseMinutes(r.jam_pulang);

    if (r.status_kehadiran === 'Hadir') {
      agg.riilDays++;
      if (r.jam_masuk) agg.scanCount++;
      if (r.jam_pulang) agg.scanCount++;

      if (masukMin && masukMin > thresholdMasuk) agg.terlambat++;
      if (pulangMin && pulangMin < thresholdPulang) agg.pulangCepat++;
      if (!r.jam_masuk && r.jam_pulang) agg.tidakScanMasuk++;
      if (r.jam_masuk && !r.jam_pulang) agg.tidakScanPulang++;

      if (r.keterangan && r.keterangan.includes('WFH')) {
        agg.notes.push('WFH');
      }
    } else if (r.status_kehadiran === 'Cuti') {
      agg.cuti++;
      agg.absenDays++;
      if (r.keterangan) agg.notes.push(r.keterangan);
    } else if (r.status_kehadiran === 'Sakit') {
      agg.sakit++;
      agg.absenDays++;
      if (r.keterangan) agg.notes.push(r.keterangan);
    } else if (r.status_kehadiran === 'Izin') {
      agg.izin++;
      agg.absenDays++;
      if (r.keterangan) agg.notes.push(r.keterangan);
    } else if (r.status_kehadiran === 'Dinas Luar') {
      agg.dinasLuar++;
      agg.absenDays++;
    }
  }

  // Filter only employees active or having records in this month (or all)
  const activeEmps = Array.from(empMap.values()).filter(e => {
    return e.riilDays > 0 || e.absenDays > 0;
  });

  // Group employees
  const groups = new Map();
  if (groupBy === 'kategori') {
    // Administrasi vs Dosen
    groups.set('ADMINISTRASI', []);
    groups.set('DOSEN', []);

    for (const emp of activeEmps) {
      const isDosen = (emp.jabatan && emp.jabatan.toLowerCase().includes('dosen')) ||
                      (emp.unit_kerja && emp.unit_kerja.includes('Program Studi') && !emp.jabatan.includes('Tenaga Kependidikan'));
      if (isDosen) {
        groups.get('DOSEN').push(emp);
      } else {
        groups.get('ADMINISTRASI').push(emp);
      }
    }
  } else {
    // Group by 13 official units
    for (const emp of activeEmps) {
      const u = emp.unit_kerja || 'Dekanat FHISIP';
      if (!groups.has(u)) groups.set(u, []);
      groups.get(u).push(emp);
    }
  }

  // Create Workbook & Worksheet
  const wb = XLSX.utils.book_new();
  const ws = {};
  const merges = [];

  // Helper to set cell
  const setCell = (cellRef, val, type = 's', formula = null) => {
    const cell = { v: val, t: type };
    if (formula) cell.f = formula;
    ws[cellRef] = cell;
  };

  // 1. Header Block (Rows 1 to 8)
  setCell('A1', 'Laporan Rekapitulasi');
  merges.push({ s: { r: 0, c: 0 }, e: { r: 2, c: 15 } }); // A1:P3

  setCell('Q2', `(FHISIP ${namaBulan} ${year})`);
  merges.push({ s: { r: 1, c: 16 }, e: { r: 2, c: 20 } }); // Q2:U3

  setCell('AB3', periodeStr);
  merges.push({ s: { r: 2, c: 27 }, e: { r: 7, c: 33 } }); // AB3:AH8

  // 2. Table Column Headers (Row 10 and 11, 0-indexed r=9, r=10)
  setCell('B10', 'Nama');
  merges.push({ s: { r: 9, c: 1 }, e: { r: 10, c: 4 } }); // B10:E11

  setCell('F10', 'No. ID');
  merges.push({ s: { r: 9, c: 5 }, e: { r: 10, c: 9 } }); // F10:J11

  setCell('K10', 'Normal');
  setCell('L10', 'Riil');
  setCell('M10', 'Absen');
  setCell('M11', 'Hari');

  setCell('O10', 'Trlmbt');
  setCell('P10', 'Plg. Cpt');
  setCell('R10', 'Lmbr');
  setCell('S10', 'Tanpa Keterangan');
  setCell('T10', 'D.Luar');
  setCell('W10', 'N/In');
  setCell('X10', 'N/Out');
  setCell('Y10', 'Scan');
  setCell('Z10', 'Sakit');
  setCell('AA10', 'Cuti');
  setCell('AC10', 'Ijin');
  setCell('AD10', 'Kehadiran');
  setCell('AF10', 'Keterangan');
  setCell('AG10', 'Jam Kerja');
  setCell('AG11', 'Jam');
  setCell('AH10', 'Rata-2\n%');
  merges.push({ s: { r: 9, c: 33 }, e: { r: 10, c: 34 } }); // AH10:AI11
  setCell('AK10', 'Faktor');

  // 3. Populate Groups and Employee Rows
  let currentRow = 12; // 1-indexed (Row 12)
  const groupSubtotalRows = [];

  for (const [groupName, emps] of groups) {
    if (emps.length === 0) continue;

    // Category Header Row
    const catRow = currentRow;
    setCell(`B${catRow}`, groupName);
    merges.push({ s: { r: catRow - 1, c: 1 }, e: { r: catRow - 1, c: 34 } }); // B:AI
    currentRow++;

    const startEmpRow = currentRow;

    for (const emp of emps) {
      const r = currentRow;
      setCell(`B${r}`, emp.nama_lengkap);
      merges.push({ s: { r: r - 1, c: 1 }, e: { r: r - 1, c: 5 } }); // B:F

      setCell(`G${r}`, emp.pin, typeof emp.pin === 'number' ? 'n' : 's');
      merges.push({ s: { r: r - 1, c: 6 }, e: { r: r - 1, c: 9 } }); // G:J

      // Normal Days
      setCell(`K${r}`, emp.normalDays, 'n');

      // Riil Days (=K - M)
      setCell(`L${r}`, Math.max(0, emp.normalDays - emp.absenDays), 'n', `K${r}-M${r}`);

      // Absen Days (=SUM(T+Z+AA+AC))
      setCell(`M${r}`, emp.absenDays, 'n', `T${r}+Z${r}+AA${r}+AC${r}`);
      merges.push({ s: { r: r - 1, c: 12 }, e: { r: r - 1, c: 13 } }); // M:N

      // Terlambat
      if (emp.terlambat > 0) setCell(`O${r}`, emp.terlambat, 'n');

      // Pulang Cepat
      if (emp.pulangCepat > 0) {
        setCell(`P${r}`, emp.pulangCepat, 'n');
        merges.push({ s: { r: r - 1, c: 15 }, e: { r: r - 1, c: 16 } }); // P:Q
      }

      // Dinas Luar
      if (emp.dinasLuar > 0) {
        setCell(`T${r}`, emp.dinasLuar, 'n');
        merges.push({ s: { r: r - 1, c: 19 }, e: { r: r - 1, c: 21 } }); // T:V
      }

      // Tidak scan masuk / pulang
      if (emp.tidakScanMasuk > 0) setCell(`W${r}`, emp.tidakScanMasuk, 'n');
      if (emp.tidakScanPulang > 0) setCell(`X${r}`, emp.tidakScanPulang, 'n');

      // Sakit
      if (emp.sakit > 0) setCell(`Z${r}`, emp.sakit, 'n');

      // Cuti
      if (emp.cuti > 0) {
        setCell(`AA${r}`, emp.cuti, 'n');
        merges.push({ s: { r: r - 1, c: 26 }, e: { r: r - 1, c: 27 } }); // AA:AB
      }

      // Izin
      if (emp.izin > 0) setCell(`AC${r}`, emp.izin, 'n');

      // Total Kehadiran (=K - M)
      setCell(`AD${r}`, Math.max(0, emp.normalDays - emp.absenDays), 'n', `K${r}-M${r}`);
      merges.push({ s: { r: r - 1, c: 29 }, e: { r: r - 1, c: 30 } }); // AD:AE

      // Keterangan khusus (e.g. Cuti alasan penting (4), WFH, etc.)
      const uniqueNotes = [...new Set(emp.notes)].filter(Boolean);
      if (uniqueNotes.length > 0) {
        setCell(`AF${r}`, uniqueNotes.join(', '));
      }

      // Faktor
      setCell(`AK${r}`, 1, 'n');

      currentRow++;
    }

    const endEmpRow = currentRow - 1;

    // Subtotal Row for Group
    const subRow = currentRow;
    groupSubtotalRows.push(subRow);

    setCell(`B${subRow}`, `Total: ${emps.length}`);
    merges.push({ s: { r: subRow - 1, c: 1 }, e: { r: subRow - 1, c: 9 } }); // B:J

    const sumK = emps.reduce((acc, e) => acc + e.normalDays, 0);
    const sumL = emps.reduce((acc, e) => acc + Math.max(0, e.normalDays - e.absenDays), 0);
    setCell(`K${subRow}`, sumK, 'n', `SUM(K${startEmpRow}:K${endEmpRow})`);
    setCell(`L${subRow}`, sumL, 'n', `SUM(L${startEmpRow}:L${endEmpRow})`);
    setCell(`AD${subRow}`, sumL, 'n', `SUM(AD${startEmpRow}:AD${endEmpRow})`);
    merges.push({ s: { r: subRow - 1, c: 29 }, e: { r: subRow - 1, c: 30 } }); // AD:AE

    currentRow++;
  }

  // Grand Total Row
  const grandRow = currentRow;
  setCell(`B${grandRow}`, `Grand Total: ${activeEmps.length}`);
  merges.push({ s: { r: grandRow - 1, c: 1 }, e: { r: grandRow - 1, c: 9 } }); // B:J

  const formulaSumK = `SUM(${groupSubtotalRows.map(r => `K${r}`).join(',')})`;
  const formulaSumL = `SUM(${groupSubtotalRows.map(r => `L${r}`).join(',')})`;
  const formulaSumAD = `SUM(${groupSubtotalRows.map(r => `AD${r}`).join(',')})`;
  const formulaSumAK = `SUM(AK13:AK${grandRow - 1})`;

  const totalNormalAll = activeEmps.reduce((acc, e) => acc + e.normalDays, 0);
  const totalRiilAll = activeEmps.reduce((acc, e) => acc + Math.max(0, e.normalDays - e.absenDays), 0);

  setCell(`K${grandRow}`, totalNormalAll, 'n', formulaSumK);
  setCell(`L${grandRow}`, totalRiilAll, 'n', formulaSumL);
  setCell(`AD${grandRow}`, totalRiilAll, 'n', formulaSumAD);
  merges.push({ s: { r: grandRow - 1, c: 29 }, e: { r: grandRow - 1, c: 30 } }); // AD:AE
  setCell(`AK${grandRow}`, activeEmps.length, 'n', formulaSumAK);

  currentRow += 3; // Space before signatures

  // 4. Signature Block (Rows currentRow to currentRow + 10)
  const sigStartRow = currentRow;
  setCell(`C${sigStartRow}`, 'Oleh:');
  setCell(`E${sigStartRow}`, 'Supervisor');
  merges.push({ s: { r: sigStartRow - 1, c: 4 }, e: { r: sigStartRow, c: 7 } }); // E:H (2 rows)

  const printDateDmy = formatYmdToDmy(endDate);
  setCell(`J${sigStartRow}`, printDateDmy);
  merges.push({ s: { r: sigStartRow - 1, c: 9 }, e: { r: sigStartRow - 1, c: 12 } }); // J:M

  setCell(`AE${sigStartRow}`, 'Hal. 1');
  merges.push({ s: { r: sigStartRow - 1, c: 30 }, e: { r: sigStartRow, c: 33 } }); // AE:AH

  const dateDekanStr = `Tangerang Selatan, ${formatTanggalIndo(endDate)}`;
  setCell(`Z${sigStartRow + 3}`, dateDekanStr);
  setCell(`Z${sigStartRow + 4}`, 'Dekan FHISIP-UT,');

  setCell(`Z${sigStartRow + 9}`, 'Dr. Meita Istianda, S.IP., M.Si.');
  setCell(`Z${sigStartRow + 10}`, 'NIP 196705191987012001');

  // Set Worksheet Range and Merges
  const lastCol = 'AL';
  const lastRowNum = sigStartRow + 11;
  ws['!ref'] = `A1:${lastCol}${lastRowNum}`;
  ws['!merges'] = merges;

  // Set Exact Column Widths Matching Template
  ws['!cols'] = [
    { wch: 2 },  // A
    { wch: 8 },  // B
    { wch: 10 }, // C
    { wch: 8 },  // D
    { wch: 12 }, // E
    { wch: 4 },  // F
    { wch: 4 },  // G
    { wch: 6 },  // H
    { wch: 4 },  // I
    { wch: 2 },  // J
    { wch: 8 },  // K (Normal)
    { wch: 8 },  // L (Riil)
    { wch: 6 },  // M (Absen)
    { wch: 4 },  // N
    { wch: 8 },  // O (Trlmbt)
    { wch: 6 },  // P (Plg Cpt)
    { wch: 4 },  // Q
    { wch: 6 },  // R (Lmbr)
    { wch: 10 }, // S (Tanpa Ket)
    { wch: 6 },  // T (D.Luar)
    { wch: 4 },  // U
    { wch: 4 },  // V
    { wch: 6 },  // W (N/In)
    { wch: 6 },  // X (N/Out)
    { wch: 6 },  // Y (Scan)
    { wch: 6 },  // Z (Sakit)
    { wch: 6 },  // AA (Cuti)
    { wch: 4 },  // AB
    { wch: 6 },  // AC (Ijin)
    { wch: 8 },  // AD (Kehadiran)
    { wch: 4 },  // AE
    { wch: 26 }, // AF (Keterangan)
    { wch: 10 }, // AG (Jam Kerja)
    { wch: 8 },  // AH (Rata-2 %)
    { wch: 4 },  // AI
    { wch: 2 },  // AJ
    { wch: 8 },  // AK (Faktor)
    { wch: 16 }  // AL (Catatan)
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Rekap ');
  return wb;
}

function formatTanggalIndo(dateStr) {
  const parts = dateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return `${d} ${months[m - 1]} ${y}`;
}

// Test Generating September 2026
const wbSept = generateOfficialMonthlyReport(2026, 9, 'kategori');
const bufSept = XLSX.write(wbSept, { type: 'buffer', bookType: 'xlsx' });
const outFileSept = 'Rekapitulasi_Kehadiran_September_2026_Resmi.xlsx';
fs.writeFileSync(outFileSept, bufSept);
console.log('Generated:', outFileSept, 'Size:', bufSept.length, 'bytes');

// Test Generating October 2026
const wbOct = generateOfficialMonthlyReport(2026, 10, 'kategori');
const bufOct = XLSX.write(wbOct, { type: 'buffer', bookType: 'xlsx' });
const outFileOct = 'Rekapitulasi_Kehadiran_Oktober_2026_Resmi.xlsx';
fs.writeFileSync(outFileOct, bufOct);
console.log('Generated:', outFileOct, 'Size:', bufOct.length, 'bytes');
