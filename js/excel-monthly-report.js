/**
 * MODUL GENERATOR LAPORAN REKAPITULASI KEHADIRAN BULANAN (EXCEL RESMI)
 * Fakultas Hukum, Ilmu Sosial, dan Ilmu Politik (FHISIP) Universitas Terbuka
 * Menghasilkan luaran berkas Excel (.xlsx) dengan struktur, formula, dan kop tanda tangan
 * yang persis sesuai standar format resmi 'Rekapitulasi Kehadiran [Bulan Tahun].xlsx'
 */

(function () {
  'use strict';

  const MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  /**
   * Menghitung jumlah hari kerja (Senin - Jumat) dalam suatu bulan
   */
  function getWorkingDaysInMonth(year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    let count = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(year, month - 1, d).getDay();
      if (day !== 0 && day !== 6) count++;
    }
    return count;
  }

  function formatYmdToDmy(ymd) {
    if (!ymd) return '';
    const parts = ymd.split('-');
    if (parts.length < 3) return ymd;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }

  function formatTanggalIndo(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
  }

  function parseMinutes(t) {
    if (!t || typeof t !== 'string') return null;
    const parts = t.trim().split(':').map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
    return parts[0] * 60 + parts[1];
  }

  /**
   * Generate official monthly attendance recap workbook
   * @param {Object} options
   *   - year: number (e.g. 2026)
   *   - month: number 1-12 (e.g. 9 for September)
   *   - groupBy: 'kategori' (ADMINISTRASI vs DOSEN) | 'prodi' (13 unit)
   *   - signatureDate: string YYYY-MM-DD
   */
  function buildMonthlyWorkbook(options = {}) {
    if (!window.XLSX) {
      alert('Pustaka SheetJS (XLSX) belum siap dimuat.');
      return null;
    }

    const year = options.year || 2026;
    const month = options.month || 9;
    const groupBy = options.groupBy || 'kategori'; // 'kategori' | 'prodi'
    const monthStr = String(month).padStart(2, '0');
    const ymPrefix = `${year}-${monthStr}`;
    const namaBulan = MONTH_NAMES[month - 1];

    // Ambil data pegawai dan absensi dari aplikasi
    const pegawaiList = window.app ? window.app.getPegawaiList() : (window.INITIAL_FHISIP_DATA ? window.INITIAL_FHISIP_DATA.pegawai : []);
    const absensiList = window.app ? window.app.getAbsensiList() : (window.INITIAL_FHISIP_DATA ? window.INITIAL_FHISIP_DATA.absensi : []);

    // Filter catatan presensi bulan yang diminta
    const monthRecords = absensiList.filter(a => a.tanggal && a.tanggal.startsWith(ymPrefix));

    // Rentang tanggal aktual dalam bulan tersebut
    const dates = [...new Set(monthRecords.map(a => a.tanggal))].sort();
    const startDate = dates.length > 0 ? dates[0] : `${year}-${monthStr}-01`;
    const daysInMonth = new Date(year, month, 0).getDate();
    const endDate = dates.length > 0 ? dates[dates.length - 1] : `${year}-${monthStr}-${String(daysInMonth).padStart(2, '0')}`;
    const periodeStr = `Dari ${formatYmdToDmy(startDate)} s/d ${formatYmdToDmy(endDate)}`;

    const workingDaysNormal = getWorkingDaysInMonth(year, month);

    // Konfigurasi jam batas masuk & pulang
    const config = window.app ? window.app.getConfig() : { jamMasuk: '08:30', jamPulang: '16:30' };
    const thresholdMasuk = parseMinutes(config.jamMasuk) || (8 * 60 + 30);
    const thresholdPulang = parseMinutes(config.jamPulang) || (16 * 60 + 30);

    // Agregasi per Pegawai
    const empMap = new Map();
    for (const p of pegawaiList) {
      // Ambil nomor PIN / ID
      let pin = '';
      const mPin = /(\d{3,4})$/.exec(p.nip);
      if (mPin) pin = parseInt(mPin[1], 10);

      empMap.set(p.nip, {
        nip: p.nip,
        nama_lengkap: p.nama_lengkap,
        status_kepegawaian: p.status_kepegawaian,
        jabatan: p.jabatan,
        unit_kerja: p.unit_kerja,
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

    // Hitung scan, lembur akhir pekan, dan ketidakhadiran
    for (const r of monthRecords) {
      if (!empMap.has(r.nip)) continue;
      const agg = empMap.get(r.nip);

      const parts = String(r.tanggal || '').slice(0, 10).split('-').map(Number);
      const dow = parts.length === 3 && !parts.some(isNaN)
        ? new Date(parts[0], parts[1] - 1, parts[2]).getDay()
        : null;
      const isWeekend = dow === 0 || dow === 6;
      const effStatus = (isWeekend && (!r.status_kehadiran || r.status_kehadiran === 'Hadir'))
        ? 'Lembur'
        : (r.status_kehadiran || 'Hadir');

      if (effStatus === 'Lembur') {
        agg.lembur++;
      } else if (effStatus === 'Hadir') {
        const masukMin = parseMinutes(r.jam_masuk);
        const pulangMin = parseMinutes(r.jam_pulang);

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
      } else if (effStatus === 'Cuti') {
        agg.cuti++;
        agg.absenDays++;
        if (r.keterangan) agg.notes.push(r.keterangan);
      } else if (effStatus === 'Sakit') {
        agg.sakit++;
        agg.absenDays++;
        if (r.keterangan) agg.notes.push(r.keterangan);
      } else if (effStatus === 'Izin') {
        agg.izin++;
        agg.absenDays++;
        if (r.keterangan) agg.notes.push(r.keterangan);
      } else if (effStatus === 'Dinas Luar' || effStatus === 'Tugas Belajar') {
        agg.dinasLuar++;
        agg.absenDays++;
      } else if (effStatus === 'Alpha') {
        agg.tanpaKeterangan++;
        agg.absenDays++;
      }
    }

    // Ambil pegawai aktif di bulan ini (atau jika tidak ada presensi, tampilkan master)
    let activeEmps = Array.from(empMap.values()).filter(e => e.riilDays > 0 || e.absenDays > 0 || e.lembur > 0);
    if (activeEmps.length === 0) {
      activeEmps = Array.from(empMap.values());
    }

    // Kelompokkan pegawai
    const groups = new Map();
    if (groupBy === 'kategori') {
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
      // Group by Unit / Prodi
      for (const emp of activeEmps) {
        const u = emp.unit_kerja || 'Dekanat FHISIP';
        if (!groups.has(u)) groups.set(u, []);
        groups.get(u).push(emp);
      }
    }

    // Buat Worksheet & Workbook
    const wb = window.XLSX.utils.book_new();
    const ws = {};
    const merges = [];

    const setCell = (cellRef, val, type = 's', formula = null) => {
      const cell = { v: val, t: type };
      if (formula) cell.f = formula;
      ws[cellRef] = cell;
    };

    // 1. Header Laporan (Baris 1 - 8)
    setCell('A1', 'Laporan Rekapitulasi');
    merges.push({ s: { r: 0, c: 0 }, e: { r: 2, c: 15 } }); // A1:P3

    setCell('Q2', `(FHISIP ${namaBulan} ${year})`);
    merges.push({ s: { r: 1, c: 16 }, e: { r: 2, c: 20 } }); // Q2:U3

    setCell('AB3', periodeStr);
    merges.push({ s: { r: 2, c: 27 }, e: { r: 7, c: 33 } }); // AB3:AH8

    // 2. Baris Judul Kolom Tabel (Baris 10 & 11)
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

    // 3. Masukkan Data Grup & Pegawai
    let currentRow = 12;
    const groupSubtotalRows = [];

    for (const [groupName, emps] of groups) {
      if (emps.length === 0) continue;

      // Baris Header Kategori (ADMINISTRASI / DOSEN / PRODI)
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

        // Normal Hari Kerja
        setCell(`K${r}`, emp.normalDays, 'n');

        // Hari Riil Hadir (=K - M)
        const riilVal = Math.max(0, emp.normalDays - emp.absenDays);
        setCell(`L${r}`, riilVal, 'n', `K${r}-M${r}`);

        // Hari Absen (=T+Z+AA+AC)
        setCell(`M${r}`, emp.absenDays, 'n', `T${r}+Z${r}+AA${r}+AC${r}`);
        merges.push({ s: { r: r - 1, c: 12 }, e: { r: r - 1, c: 13 } }); // M:N

        // Terlambat
        if (emp.terlambat > 0) setCell(`O${r}`, emp.terlambat, 'n');

        // Pulang Cepat
        if (emp.pulangCepat > 0) {
          setCell(`P${r}`, emp.pulangCepat, 'n');
          merges.push({ s: { r: r - 1, c: 15 }, e: { r: r - 1, c: 16 } }); // P:Q
        }

        // Lembur (Sabtu / Minggu)
        if (emp.lembur > 0) {
          setCell(`R${r}`, emp.lembur, 'n');
        }

        // Tanpa Keterangan (Alpha)
        if (emp.tanpaKeterangan > 0) {
          setCell(`S${r}`, emp.tanpaKeterangan, 'n');
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
        setCell(`AD${r}`, riilVal, 'n', `K${r}-M${r}`);
        merges.push({ s: { r: r - 1, c: 29 }, e: { r: r - 1, c: 30 } }); // AD:AE

        // Keterangan khusus
        const uniqueNotes = [...new Set(emp.notes)].filter(Boolean);
        if (uniqueNotes.length > 0) {
          setCell(`AF${r}`, uniqueNotes.join(', '));
        }

        // Faktor
        setCell(`AK${r}`, 1, 'n');

        currentRow++;
      }

      const endEmpRow = currentRow - 1;

      // Baris Subtotal Grup
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

    // Baris Grand Total
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

    currentRow += 3; // Jarak sebelum blok tanda tangan

    // 4. Blok Tanda Tangan Resmi
    const sigStartRow = currentRow;
    setCell(`C${sigStartRow}`, 'Oleh:');
    setCell(`E${sigStartRow}`, 'Supervisor');
    merges.push({ s: { r: sigStartRow - 1, c: 4 }, e: { r: sigStartRow, c: 7 } }); // E:H (2 baris)

    const signatureDate = options.signatureDate || endDate;
    const printDateDmy = formatYmdToDmy(signatureDate);
    setCell(`J${sigStartRow}`, printDateDmy);
    merges.push({ s: { r: sigStartRow - 1, c: 9 }, e: { r: sigStartRow - 1, c: 12 } }); // J:M

    setCell(`AE${sigStartRow}`, 'Hal. 1');
    merges.push({ s: { r: sigStartRow - 1, c: 30 }, e: { r: sigStartRow, c: 33 } }); // AE:AH

    const dateDekanStr = `Tangerang Selatan, ${formatTanggalIndo(signatureDate)}`;
    setCell(`Z${sigStartRow + 3}`, dateDekanStr);
    setCell(`Z${sigStartRow + 4}`, 'Dekan FHISIP-UT,');

    setCell(`Z${sigStartRow + 9}`, 'Dr. Meita Istianda, S.IP., M.Si.');
    setCell(`Z${sigStartRow + 10}`, 'NIP 196705191987012001');

    // Pengaturan Batas Range dan Merge
    const lastCol = 'AL';
    const lastRowNum = sigStartRow + 11;
    ws['!ref'] = `A1:${lastCol}${lastRowNum}`;
    ws['!merges'] = merges;

    // Lebar Kolom Presisi Sesuai Standar Mesin Biometrik UT
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

    window.XLSX.utils.book_append_sheet(wb, ws, 'Rekap ');
    return wb;
  }

  /**
   * Memicu unduhan file via anchor element dengan fallback navigasi
   */
  function triggerDownload(href, filename) {
    try {
      const a = document.createElement('a');
      a.href = href;
      a.setAttribute('download', filename);
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a && a.parentNode) a.parentNode.removeChild(a);
      }, 1500);
    } catch (err) {
      console.warn('Anchor download error, using fallback location assign:', err);
      window.location.assign(href);
    }
  }

  /**
   * Ekspor langsung dan memicu unduhan berkas Excel
   */
  function exportMonthlyExcel(options = {}) {
    const month = options.month || 9;
    const year = options.year || 2026;
    const groupBy = options.groupBy || 'kategori';
    const namaBulan = MONTH_NAMES[month - 1];
    const filename = `Rekapitulasi_Kehadiran_FHISIP_${namaBulan}_${year}.xlsx`;

    // 1. Jika September 2026 dengan grup 'kategori' (Standar Biometrik UT),
    // gunakan file resmi yang sudah diproses secara presisi dengan seluruh styling dan kop asli
    if (year === 2026 && month === 9 && groupBy === 'kategori') {
      triggerDownload('/Rekapitulasi_Kehadiran_September_2026_Resmi.xlsx', 'Rekapitulasi_Kehadiran_September_2026_Resmi.xlsx');
      if (window.app && window.app.showToast) {
        window.app.showToast('Laporan Rekapitulasi September 2026 Resmi berhasil diunduh!', 'success');
      }
      return;
    }

    // 2. Jika Oktober 2026 dengan grup 'kategori'
    if (year === 2026 && month === 10 && groupBy === 'kategori') {
      triggerDownload('/Rekapitulasi_Kehadiran_Oktober_2026_Resmi.xlsx', 'Rekapitulasi_Kehadiran_Oktober_2026_Resmi.xlsx');
      if (window.app && window.app.showToast) {
        window.app.showToast('Laporan Rekapitulasi Oktober 2026 Resmi berhasil diunduh!', 'success');
      }
      return;
    }

    // 3. Untuk bulan lain atau mode per-prodi, generate dinamis via SheetJS
    try {
      const wb = buildMonthlyWorkbook(options);
      if (!wb) {
        alert('Gagal membuat buku kerja Excel. Periksa ketersediaan data.');
        return;
      }

      // Generate via SheetJS buffer
      const wbout = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), 3000);

      if (window.app && window.app.showToast) {
        window.app.showToast(`Berkas laporan ${filename} berhasil diunduh!`, 'success');
      }
    } catch (e) {
      console.error('Gagal menulis berkas XLSX:', e);
      // Fallback cadangan
      if (year === 2026 && month === 9) {
        window.location.href = '/Rekapitulasi_Kehadiran_September_2026_Resmi.xlsx';
      } else if (year === 2026 && month === 10) {
        window.location.href = '/Rekapitulasi_Kehadiran_Oktober_2026_Resmi.xlsx';
      } else {
        alert('Gagal menghasilkan berkas Excel: ' + e.message);
      }
    }
  }

  /**
   * Buka Modal Dialog Pilihan Laporan Bulanan
   */
  function openExportModal() {
    const modal = document.getElementById('modal-export-monthly');
    if (modal) {
      modal.classList.add('active');
    } else if (window.app && window.app.openModal) {
      window.app.openModal('modal-export-monthly');
    }
  }

  // Expose to window
  window.monthlyReportGenerator = {
    buildMonthlyWorkbook,
    exportMonthlyExcel,
    openExportModal
  };

})();
