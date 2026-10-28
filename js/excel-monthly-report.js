/**
 * MODUL GENERATOR LAPORAN REKAPITULASI KEHADIRAN BULANAN & DATABASE EXCEL LIVE
 * Fakultas Hukum, Ilmu Sosial, dan Ilmu Politik (FHISIP) Universitas Terbuka
 *
 * Seluruh ekspor membaca 100% DATA LIVE TERUPDATE dari Dashboard & Supabase Cloud
 * (termasuk penambahan presensi baru, import biometrik, Lembur Sabtu-Minggu tanpa jam,
 * serta Izin, Cuti, Sakit, dan Dinas Luar tanpa jam).
 */

(function () {
  'use strict';

  const MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const DAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  /**
   * Menghitung jumlah hari kerja normal (Senin - Jumat) dalam suatu bulan
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
    const parts = String(ymd).slice(0, 10).split('-');
    if (parts.length < 3) return ymd;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }

  function formatTanggalIndo(dateStr) {
    if (!dateStr) return '';
    const parts = String(dateStr).slice(0, 10).split('-');
    if (parts.length < 3) return dateStr;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return dateStr;
    return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
  }

  function getDayNameFromYmd(ymd) {
    if (!ymd) return '-';
    const parts = String(ymd).slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return '-';
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return isNaN(d.getTime()) ? '-' : DAY_NAMES_ID[d.getDay()];
  }

  /**
   * Mengambil ringkasan live seluruh periode bulan yang ada di Dashboard
   */
  function getAvailableMonthsSummary() {
    const evaluated = (window.app && typeof window.app.getEvaluatedRecords === 'function')
      ? window.app.getEvaluatedRecords()
      : [];

    const defaultMonths = ['2026-09', '2026-10', '2026-11', '2026-12'];
    const monthMap = new Map();

    defaultMonths.forEach(ym => {
      monthMap.set(ym, {
        ym,
        records: [],
        nips: new Set(),
        dates: [],
        hadirCount: 0,
        telatCount: 0,
        lemburCount: 0,
        izinCount: 0
      });
    });

    evaluated.forEach(r => {
      if (!r || !r.tanggal || r.tanggal.length < 7) return;
      const ym = r.tanggal.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) return;

      if (!monthMap.has(ym)) {
        monthMap.set(ym, {
          ym,
          records: [],
          nips: new Set(),
          dates: [],
          hadirCount: 0,
          telatCount: 0,
          lemburCount: 0,
          izinCount: 0
        });
      }

      const bucket = monthMap.get(ym);
      bucket.records.push(r);
      if (r.nip) bucket.nips.add(String(r.nip).trim());
      bucket.dates.push(r.tanggal.slice(0, 10));

      if (r.isLembur) {
        bucket.lemburCount++;
      } else if (r.isIzinCutiSakitDinas) {
        bucket.izinCount++;
      } else if (r.status_kehadiran === 'Hadir') {
        bucket.hadirCount++;
        if (r.isTerlambat) bucket.telatCount++;
      }
    });

    const sortedYms = Array.from(monthMap.keys()).sort();
    return sortedYms.map(ym => {
      const b = monthMap.get(ym);
      const [y, m] = ym.split('-').map(Number);
      const uniqueDates = [...new Set(b.dates)].sort();
      const lastCalendarDay = new Date(y, m, 0).getDate();
      const defaultEnd = `${ym}-${String(lastCalendarDay).padStart(2, '0')}`;

      return {
        ym,
        year: y,
        month: m,
        labelBulan: `${MONTH_NAMES[m - 1]} ${y}`,
        count: b.records.length,
        pegawaiCount: b.nips.size,
        minDate: uniqueDates.length > 0 ? uniqueDates[0] : `${ym}-01`,
        maxDate: uniqueDates.length > 0 ? uniqueDates[uniqueDates.length - 1] : defaultEnd,
        lastCalendarDate: defaultEnd,
        hadirCount: b.hadirCount,
        telatCount: b.telatCount,
        lemburCount: b.lemburCount,
        izinCount: b.izinCount
      };
    });
  }

  /**
   * Menyinkronkan tampilan Modal Ekspor Bulanan dengan data live terbaru di Dashboard
   */
  function refreshExportModalUI(options = {}) {
    const selectEl = document.getElementById('export-month-select');
    if (!selectEl) return;

    const summaries = getAvailableMonthsSummary();
    const summaryByYm = new Map(summaries.map(s => [s.ym, s]));
    const previousValue = selectEl.value;

    // Tentukan pilihan bulan terbaik saat modal baru dibuka
    let targetYm = previousValue;
    if (options.preferActiveFilter) {
      const filterState = (window.app && typeof window.app.getActiveFilterState === 'function')
        ? window.app.getActiveFilterState()
        : null;

      if (filterState && filterState.bulan && summaryByYm.has(filterState.bulan)) {
        targetYm = filterState.bulan;
      } else {
        // Pilih bulan terbaru yang sudah memiliki data presensi live
        const populated = summaries.filter(s => s.count > 0);
        if (populated.length > 0) {
          targetYm = populated[populated.length - 1].ym;
        }
      }
    }

    if (!summaryByYm.has(targetYm)) {
      targetYm = summaries[0] ? summaries[0].ym : '2026-10';
    }

    selectEl.innerHTML = summaries.map(s => {
      const infoText = s.count > 0
        ? `${s.count.toLocaleString('id-ID')} data presensi • s/d ${formatYmdToDmy(s.maxDate)}`
        : 'Belum ada data presensi';
      return `<option value="${s.ym}"${s.ym === targetYm ? ' selected' : ''}>${s.labelBulan} (${infoText})</option>`;
    }).join('');

    selectEl.value = targetYm;
    updateSelectedMonthPreview(targetYm, Boolean(options.updateSignatureDate));

    // Perbarui badge tombol unduh cepat di bagian bawah modal
    const septSummary = summaryByYm.get('2026-09');
    const octSummary = summaryByYm.get('2026-10');
    const elQuickSept = document.getElementById('quick-export-sept-count');
    const elQuickOct = document.getElementById('quick-export-oct-count');
    if (elQuickSept && septSummary) {
      elQuickSept.textContent = `${septSummary.count.toLocaleString('id-ID')} data`;
    }
    if (elQuickOct && octSummary) {
      elQuickOct.textContent = `${octSummary.count.toLocaleString('id-ID')} data`;
    }
  }

  /**
   * Memperbarui kartu pratinjau ringkasan live & tanggal tanda tangan saat pilihan bulan berubah
   */
  function updateSelectedMonthPreview(ymVal, updateSigDate = true) {
    const summaries = getAvailableMonthsSummary();
    const info = summaries.find(s => s.ym === ymVal);
    if (!info) return;

    if (updateSigDate) {
      const elDate = document.getElementById('export-signature-date');
      if (elDate) {
        elDate.value = info.count > 0 ? info.maxDate : info.lastCalendarDate;
      }
    }

    const box = document.getElementById('export-live-summary-box');
    if (!box) return;

    if (info.count === 0) {
      box.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px;">
          <strong>⚠️ Periode ${info.labelBulan}: Belum ada catatan presensi di Dashboard</strong>
          <span class="badge-status badge-warning" style="font-size:0.7rem;">0 Data</span>
        </div>
        <div style="margin-top:4px; font-size:0.76rem; color:var(--text-muted);">
          Silakan tambahkan presensi atau impor berkas Excel terlebih dahulu untuk periode ini.
        </div>
      `;
      return;
    }

    box.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px; margin-bottom:6px;">
        <strong style="color:var(--ut-navy); font-size:0.82rem;">⚡ Tersinkron Live dengan Data Dashboard (${info.labelBulan})</strong>
        <span class="badge-status badge-tepat" style="font-size:0.7rem; padding:2px 8px;">● Live Terupdate</span>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(125px, 1fr)); gap:8px; font-size:0.76rem;">
        <div style="background:#FFF; border:1px solid #CBD5E1; border-radius:6px; padding:6px 8px;">
          <div style="color:var(--text-muted);">Total Data Bulan Ini</div>
          <strong style="font-size:0.92rem; color:var(--ut-blue);">${info.count.toLocaleString('id-ID')} Data</strong>
        </div>
        <div style="background:#FFF; border:1px solid #CBD5E1; border-radius:6px; padding:6px 8px;">
          <div style="color:var(--text-muted);">Pegawai Terdata</div>
          <strong style="font-size:0.92rem; color:var(--ut-navy);">${info.pegawaiCount} Pegawai</strong>
        </div>
        <div style="background:#FFF; border:1px solid #CBD5E1; border-radius:6px; padding:6px 8px;">
          <div style="color:var(--text-muted);">Rentang Tanggal</div>
          <strong style="font-size:0.78rem; color:var(--ut-navy);">${formatYmdToDmy(info.minDate)} s/d ${formatYmdToDmy(info.maxDate)}</strong>
        </div>
        <div style="background:#FFF; border:1px solid #CBD5E1; border-radius:6px; padding:6px 8px;">
          <div style="color:var(--text-muted);">Rincian Status</div>
          <strong style="font-size:0.75rem; color:#334155;">${info.hadirCount} Hadir • ${info.lemburCount} Lembur • ${info.izinCount} Izin/Cuti</strong>
        </div>
      </div>
    `;
  }

  /**
   * Membangun Workbook Excel Rekapitulasi Bulanan Resmi langsung dari data live Dashboard
   * @param {Object} options
   *   - year: number (e.g. 2026)
   *   - month: number 1-12 (e.g. 10 for Oktober)
   *   - groupBy: 'kategori' (ADMINISTRASI vs DOSEN) | 'prodi' (13 unit)
   *   - signatureDate: string YYYY-MM-DD
   */
  function buildMonthlyWorkbook(options = {}) {
    if (!window.XLSX) {
      alert('Pustaka SheetJS (XLSX) belum siap dimuat.');
      return null;
    }

    const year = Number(options.year) || 2026;
    const month = Number(options.month) || 10;
    const groupBy = options.groupBy || 'kategori';
    const monthStr = String(month).padStart(2, '0');
    const ymPrefix = `${year}-${monthStr}`;
    const namaBulan = MONTH_NAMES[month - 1];

    // Ambil data pegawai dan hasil evaluasi presensi LIVE dari Dashboard
    const pegawaiList = (window.app && typeof window.app.getPegawaiList === 'function')
      ? window.app.getPegawaiList()
      : (window.INITIAL_FHISIP_DATA ? window.INITIAL_FHISIP_DATA.pegawai : []);

    const evaluatedAll = (window.app && typeof window.app.getEvaluatedRecords === 'function')
      ? window.app.getEvaluatedRecords()
      : [];

    // Filter catatan presensi untuk bulan yang diminta
    const monthRecords = evaluatedAll.filter(r => r.tanggal && r.tanggal.startsWith(ymPrefix));

    // Rentang tanggal aktual dalam bulan tersebut
    const dates = [...new Set(monthRecords.map(a => a.tanggal.slice(0, 10)))].sort();
    const startDate = dates.length > 0 ? dates[0] : `${year}-${monthStr}-01`;
    const daysInMonth = new Date(year, month, 0).getDate();
    const endDate = dates.length > 0 ? dates[dates.length - 1] : `${year}-${monthStr}-${String(daysInMonth).padStart(2, '0')}`;
    const periodeStr = `Dari ${formatYmdToDmy(startDate)} s/d ${formatYmdToDmy(endDate)}`;

    const workingDaysNormal = getWorkingDaysInMonth(year, month);

    function createEmptyEmpBucket(p) {
      const nipStr = String(p.nip || '').trim();
      let pin = '';
      const mPin = /(\d{3,4})$/.exec(nipStr);
      if (mPin) pin = parseInt(mPin[1], 10);

      return {
        nip: nipStr,
        nama_lengkap: p.nama_lengkap || ('Pegawai ' + nipStr),
        status_kepegawaian: p.status_kepegawaian || 'PNS',
        jabatan: p.jabatan || '',
        unit_kerja: p.unit_kerja || 'FHISIP',
        pin: pin || nipStr,
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
      };
    }

    // Inisialisasi peta agregasi dari master pegawai
    const empMap = new Map();
    for (const p of pegawaiList) {
      if (!p || !p.nip) continue;
      const nipKey = String(p.nip).trim();
      empMap.set(nipKey, createEmptyEmpBucket(p));
    }

    // Hitung scan, keterlambatan, lembur akhir pekan, dan ketidakhadiran dari data LIVE
    for (const r of monthRecords) {
      if (!r || !r.nip) continue;
      const nipKey = String(r.nip).trim();

      // Pastikan pegawai baru hasil Tambah/Import tetap masuk laporan!
      if (!empMap.has(nipKey)) {
        empMap.set(nipKey, createEmptyEmpBucket({
          nip: nipKey,
          nama_lengkap: r.nama_lengkap,
          unit_kerja: r.unit_kerja
        }));
      }

      const agg = empMap.get(nipKey);
      const effStatus = r.status_kehadiran || 'Hadir';

      if (r.isLembur || effStatus === 'Lembur') {
        agg.lembur++;
        if (r.keterangan && !r.keterangan.startsWith('Lembur Akhir Pekan')) {
          agg.notes.push(r.keterangan);
        }
      } else if (effStatus === 'Hadir') {
        agg.riilDays++;
        if (r.jam_masuk) agg.scanCount++;
        if (r.jam_pulang) agg.scanCount++;

        if (r.isTerlambat) agg.terlambat++;
        if (r.isPulangCepat) agg.pulangCepat++;
        if (r.isTanpaMasuk && !r.isTanpaPulang) agg.tidakScanMasuk++;
        if (r.isTanpaPulang && !r.isTanpaMasuk) agg.tidakScanPulang++;

        if (r.keterangan && r.keterangan.includes('WFH')) {
          agg.notes.push('WFH');
        }
      } else if (effStatus === 'Cuti') {
        agg.cuti++;
        agg.absenDays++;
        if (r.keterangan && r.keterangan !== 'Import Tabular') agg.notes.push(r.keterangan);
      } else if (effStatus === 'Sakit') {
        agg.sakit++;
        agg.absenDays++;
        if (r.keterangan && r.keterangan !== 'Import Tabular') agg.notes.push(r.keterangan);
      } else if (effStatus === 'Izin') {
        agg.izin++;
        agg.absenDays++;
        if (r.keterangan && r.keterangan !== 'Import Tabular') agg.notes.push(r.keterangan);
      } else if (effStatus === 'Dinas Luar' || effStatus === 'Tugas Belajar') {
        agg.dinasLuar++;
        agg.absenDays++;
        if (r.keterangan && r.keterangan !== 'Import Tabular') agg.notes.push(r.keterangan);
      } else if (effStatus === 'Alpha') {
        agg.tanpaKeterangan++;
        agg.absenDays++;
      }
    }

    // Ambil pegawai aktif di bulan ini (urut nama A-Z)
    let activeEmps = Array.from(empMap.values()).filter(
      e => e.riilDays > 0 || e.absenDays > 0 || e.lembur > 0
    );
    if (activeEmps.length === 0) {
      activeEmps = Array.from(empMap.values());
    }
    activeEmps.sort((a, b) => (a.nama_lengkap || '').localeCompare(b.nama_lengkap || '', 'id'));

    // Kelompokkan pegawai
    const groups = new Map();
    if (groupBy === 'kategori') {
      groups.set('ADMINISTRASI', []);
      groups.set('DOSEN', []);

      for (const emp of activeEmps) {
        const jabatanLower = (emp.jabatan || '').toLowerCase();
        const isDosen = jabatanLower.includes('dosen') ||
          ((emp.unit_kerja || '').includes('Program Studi') && !jabatanLower.includes('tenaga kependidikan') && !jabatanLower.includes('administrasi') && !jabatanLower.includes('pranata'));
        if (isDosen) {
          groups.get('DOSEN').push(emp);
        } else {
          groups.get('ADMINISTRASI').push(emp);
        }
      }
    } else {
      const unitNames = [...new Set(activeEmps.map(e => e.unit_kerja || 'Dekanat FHISIP'))].sort();
      for (const u of unitNames) groups.set(u, []);
      for (const emp of activeEmps) {
        const u = emp.unit_kerja || 'Dekanat FHISIP';
        groups.get(u).push(emp);
      }
    }

    // Buat Worksheet & Workbook sesuai standar resmi FHISIP UT
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

      const catRow = currentRow;
      setCell(`B${catRow}`, groupName);
      merges.push({ s: { r: catRow - 1, c: 1 }, e: { r: catRow - 1, c: 34 } });
      currentRow++;

      const startEmpRow = currentRow;

      for (const emp of emps) {
        const r = currentRow;
        setCell(`B${r}`, emp.nama_lengkap);
        merges.push({ s: { r: r - 1, c: 1 }, e: { r: r - 1, c: 5 } }); // B:F

        setCell(`G${r}`, emp.pin, typeof emp.pin === 'number' ? 'n' : 's');
        merges.push({ s: { r: r - 1, c: 6 }, e: { r: r - 1, c: 9 } }); // G:J

        // Normal Hari Kerja & Riil Hadir
        setCell(`K${r}`, emp.normalDays, 'n');
        const riilVal = Math.max(0, emp.normalDays - emp.absenDays);
        setCell(`L${r}`, riilVal, 'n', `K${r}-M${r}`);

        // Hari Absen (=S+T+Z+AA+AC)
        setCell(`M${r}`, emp.absenDays, 'n', `S${r}+T${r}+Z${r}+AA${r}+AC${r}`);
        merges.push({ s: { r: r - 1, c: 12 }, e: { r: r - 1, c: 13 } }); // M:N

        if (emp.terlambat > 0) setCell(`O${r}`, emp.terlambat, 'n');

        if (emp.pulangCepat > 0) {
          setCell(`P${r}`, emp.pulangCepat, 'n');
          merges.push({ s: { r: r - 1, c: 15 }, e: { r: r - 1, c: 16 } }); // P:Q
        }

        // Lembur (Sabtu / Minggu — Tanpa Jam)
        if (emp.lembur > 0) setCell(`R${r}`, emp.lembur, 'n');

        // Tanpa Keterangan (Alpha)
        if (emp.tanpaKeterangan > 0) setCell(`S${r}`, emp.tanpaKeterangan, 'n');

        // Dinas Luar
        if (emp.dinasLuar > 0) {
          setCell(`T${r}`, emp.dinasLuar, 'n');
          merges.push({ s: { r: r - 1, c: 19 }, e: { r: r - 1, c: 21 } }); // T:V
        }

        // Tidak scan masuk / pulang / jumlah scan
        if (emp.tidakScanMasuk > 0) setCell(`W${r}`, emp.tidakScanMasuk, 'n');
        if (emp.tidakScanPulang > 0) setCell(`X${r}`, emp.tidakScanPulang, 'n');
        if (emp.scanCount > 0) setCell(`Y${r}`, emp.scanCount, 'n');

        // Sakit, Cuti, Izin
        if (emp.sakit > 0) setCell(`Z${r}`, emp.sakit, 'n');
        if (emp.cuti > 0) {
          setCell(`AA${r}`, emp.cuti, 'n');
          merges.push({ s: { r: r - 1, c: 26 }, e: { r: r - 1, c: 27 } }); // AA:AB
        }
        if (emp.izin > 0) setCell(`AC${r}`, emp.izin, 'n');

        // Total Kehadiran (=K - M)
        setCell(`AD${r}`, riilVal, 'n', `K${r}-M${r}`);
        merges.push({ s: { r: r - 1, c: 29 }, e: { r: r - 1, c: 30 } }); // AD:AE

        // Keterangan khusus
        const uniqueNotes = [...new Set(emp.notes)].filter(Boolean);
        if (uniqueNotes.length > 0) {
          setCell(`AF${r}`, uniqueNotes.join(', '));
        }

        // Rata-rata % Kehadiran
        const pctHadir = emp.normalDays > 0 ? Number(((riilVal / emp.normalDays) * 100).toFixed(1)) : 100;
        setCell(`AH${r}`, pctHadir, 'n');

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
      const sumM = emps.reduce((acc, e) => acc + e.absenDays, 0);
      const sumO = emps.reduce((acc, e) => acc + e.terlambat, 0);
      const sumP = emps.reduce((acc, e) => acc + e.pulangCepat, 0);
      const sumR = emps.reduce((acc, e) => acc + e.lembur, 0);
      const sumT = emps.reduce((acc, e) => acc + e.dinasLuar, 0);
      const sumZ = emps.reduce((acc, e) => acc + e.sakit, 0);
      const sumAA = emps.reduce((acc, e) => acc + e.cuti, 0);
      const sumAC = emps.reduce((acc, e) => acc + e.izin, 0);

      setCell(`K${subRow}`, sumK, 'n', `SUM(K${startEmpRow}:K${endEmpRow})`);
      setCell(`L${subRow}`, sumL, 'n', `SUM(L${startEmpRow}:L${endEmpRow})`);
      setCell(`M${subRow}`, sumM, 'n', `SUM(M${startEmpRow}:M${endEmpRow})`);
      setCell(`O${subRow}`, sumO, 'n', `SUM(O${startEmpRow}:O${endEmpRow})`);
      setCell(`P${subRow}`, sumP, 'n', `SUM(P${startEmpRow}:P${endEmpRow})`);
      setCell(`R${subRow}`, sumR, 'n', `SUM(R${startEmpRow}:R${endEmpRow})`);
      setCell(`T${subRow}`, sumT, 'n', `SUM(T${startEmpRow}:T${endEmpRow})`);
      setCell(`Z${subRow}`, sumZ, 'n', `SUM(Z${startEmpRow}:Z${endEmpRow})`);
      setCell(`AA${subRow}`, sumAA, 'n', `SUM(AA${startEmpRow}:AA${endEmpRow})`);
      setCell(`AC${subRow}`, sumAC, 'n', `SUM(AC${startEmpRow}:AC${endEmpRow})`);
      setCell(`AD${subRow}`, sumL, 'n', `SUM(AD${startEmpRow}:AD${endEmpRow})`);
      merges.push({ s: { r: subRow - 1, c: 29 }, e: { r: subRow - 1, c: 30 } }); // AD:AE

      currentRow++;
    }

    // Baris Grand Total
    const grandRow = currentRow;
    setCell(`B${grandRow}`, `Grand Total: ${activeEmps.length}`);
    merges.push({ s: { r: grandRow - 1, c: 1 }, e: { r: grandRow - 1, c: 9 } }); // B:J

    if (groupSubtotalRows.length > 0) {
      const sumFormula = (col) => `SUM(${groupSubtotalRows.map(r => `${col}${r}`).join(',')})`;
      const totalNormalAll = activeEmps.reduce((acc, e) => acc + e.normalDays, 0);
      const totalRiilAll = activeEmps.reduce((acc, e) => acc + Math.max(0, e.normalDays - e.absenDays), 0);
      const totalAbsenAll = activeEmps.reduce((acc, e) => acc + e.absenDays, 0);
      const totalTelatAll = activeEmps.reduce((acc, e) => acc + e.terlambat, 0);
      const totalPlgAll = activeEmps.reduce((acc, e) => acc + e.pulangCepat, 0);
      const totalLemburAll = activeEmps.reduce((acc, e) => acc + e.lembur, 0);
      const totalDinasAll = activeEmps.reduce((acc, e) => acc + e.dinasLuar, 0);
      const totalSakitAll = activeEmps.reduce((acc, e) => acc + e.sakit, 0);
      const totalCutiAll = activeEmps.reduce((acc, e) => acc + e.cuti, 0);
      const totalIzinAll = activeEmps.reduce((acc, e) => acc + e.izin, 0);

      setCell(`K${grandRow}`, totalNormalAll, 'n', sumFormula('K'));
      setCell(`L${grandRow}`, totalRiilAll, 'n', sumFormula('L'));
      setCell(`M${grandRow}`, totalAbsenAll, 'n', sumFormula('M'));
      setCell(`O${grandRow}`, totalTelatAll, 'n', sumFormula('O'));
      setCell(`P${grandRow}`, totalPlgAll, 'n', sumFormula('P'));
      setCell(`R${grandRow}`, totalLemburAll, 'n', sumFormula('R'));
      setCell(`T${grandRow}`, totalDinasAll, 'n', sumFormula('T'));
      setCell(`Z${grandRow}`, totalSakitAll, 'n', sumFormula('Z'));
      setCell(`AA${grandRow}`, totalCutiAll, 'n', sumFormula('AA'));
      setCell(`AC${grandRow}`, totalIzinAll, 'n', sumFormula('AC'));
      setCell(`AD${grandRow}`, totalRiilAll, 'n', sumFormula('AD'));
      merges.push({ s: { r: grandRow - 1, c: 29 }, e: { r: grandRow - 1, c: 30 } }); // AD:AE
      setCell(`AK${grandRow}`, activeEmps.length, 'n', `SUM(AK13:AK${grandRow - 1})`);
    }

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

    // Tambahkan Sheet 2 berisi Detail Log Presensi Live Bulan Tersebut agar mudah diaudit!
    const detailRows = monthRecords
      .slice()
      .sort((a, b) => (a.tanggal || '').localeCompare(b.tanggal || '') || (a.nama_lengkap || '').localeCompare(b.nama_lengkap || ''))
      .map((r, idx) => ({
        'No': idx + 1,
        'Tanggal': r.tanggal,
        'Hari': getDayNameFromYmd(r.tanggal),
        'NIP': String(r.nip || ''),
        'Nama Lengkap': r.nama_lengkap || '-',
        'Unit Kerja / Program Studi': r.unit_kerja || '-',
        'Jam Masuk': r.isNonTimed ? '-' : (r.jam_masuk || '-'),
        'Jam Pulang': r.isNonTimed ? '-' : (r.jam_pulang || '-'),
        'Status Kehadiran': r.status_kehadiran || 'Hadir',
        'Status Evaluasi Disiplin': r.statusLabel || '-',
        'Terlambat (Menit)': r.isNonTimed ? 0 : (r.menitTerlambat || 0),
        'Pulang Cepat (Menit)': r.isNonTimed ? 0 : (r.menitPulangCepat || 0),
        'Keterangan': r.keterangan || ''
      }));

    if (detailRows.length > 0) {
      const wsDetail = window.XLSX.utils.json_to_sheet(detailRows);
      wsDetail['!cols'] = [
        { wch: 5 }, { wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 28 },
        { wch: 32 }, { wch: 11 }, { wch: 11 }, { wch: 16 }, { wch: 22 },
        { wch: 16 }, { wch: 18 }, { wch: 30 }
      ];
      window.XLSX.utils.book_append_sheet(wb, wsDetail, `Log Detail ${namaBulan}`);
    }

    return { wb, recordCount: monthRecords.length, employeeCount: activeEmps.length, endDate };
  }

  /**
   * Memicu unduhan file via anchor element
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
   * Ekspor langsung berkas Excel Rekapitulasi Bulanan dari DATA LIVE TERUPDATE di Dashboard
   */
  function exportMonthlyExcel(options = {}) {
    const month = Number(options.month) || 10;
    const year = Number(options.year) || 2026;
    const groupBy = options.groupBy || 'kategori';
    const namaBulan = MONTH_NAMES[month - 1];
    const modeSuffix = groupBy === 'prodi' ? '_Per_Prodi' : '_Resmi';
    const filename = `Rekapitulasi_Kehadiran_FHISIP_${namaBulan}_${year}${modeSuffix}.xlsx`;

    try {
      const built = buildMonthlyWorkbook({ ...options, year, month, groupBy });
      if (!built || !built.wb) {
        alert('Gagal membuat buku kerja Excel. Periksa ketersediaan pustaka Excel.');
        return;
      }

      const wbout = window.XLSX.write(built.wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      if (window.app && window.app.showToast) {
        window.app.showToast(
          `Laporan ${namaBulan} ${year} (${built.recordCount.toLocaleString('id-ID')} data live • ${built.employeeCount} pegawai) berhasil diunduh!`,
          'success'
        );
      }
    } catch (e) {
      console.error('Gagal menulis berkas XLSX:', e);
      alert('Gagal menghasilkan berkas Excel: ' + e.message);
    }
  }

  /**
   * Ekspor Database Presensi Bersih (.xlsx) langsung dari data live terbaru di Dashboard
   * @param {string} ymFilter opsional '2026-09' | '2026-10' | '' (semua periode)
   */
  function exportLiveDatabaseXlsx(ymFilter = '') {
    if (!window.XLSX) {
      alert('Pustaka SheetJS (XLSX) belum siap dimuat.');
      return;
    }

    const pegawaiList = (window.app && typeof window.app.getPegawaiList === 'function')
      ? window.app.getPegawaiList()
      : [];
    const empByNip = new Map(pegawaiList.map(p => [String(p.nip).trim(), p]));

    let evaluated = (window.app && typeof window.app.getEvaluatedRecords === 'function')
      ? window.app.getEvaluatedRecords()
      : [];

    if (ymFilter) {
      evaluated = evaluated.filter(r => r.tanggal && r.tanggal.startsWith(ymFilter));
    }

    evaluated.sort((a, b) =>
      (b.tanggal || '').localeCompare(a.tanggal || '') ||
      (a.nama_lengkap || '').localeCompare(b.nama_lengkap || '', 'id')
    );

    const rows = evaluated.map((r, i) => {
      const emp = empByNip.get(String(r.nip || '').trim()) || {};
      return {
        'No': i + 1,
        'Tanggal': r.tanggal,
        'Hari': getDayNameFromYmd(r.tanggal),
        'NIP': String(r.nip || ''),
        'Nama Lengkap': r.nama_lengkap || emp.nama_lengkap || '-',
        'Status Kepegawaian': emp.status_kepegawaian || 'PNS',
        'Program Studi / Unit Kerja': r.unit_kerja || emp.unit_kerja || '-',
        'Jam Masuk': r.isNonTimed ? '-' : (r.jam_masuk || '-'),
        'Jam Pulang': r.isNonTimed ? '-' : (r.jam_pulang || '-'),
        'Status Kehadiran': r.status_kehadiran || 'Hadir',
        'Evaluasi Disiplin': r.statusLabel || '-',
        'Terlambat (Menit)': r.isNonTimed ? 0 : (r.menitTerlambat || 0),
        'Pulang Cepat (Menit)': r.isNonTimed ? 0 : (r.menitPulangCepat || 0),
        'Keterangan': r.keterangan || ''
      };
    });

    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 6 }, { wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 28 },
      { wch: 18 }, { wch: 34 }, { wch: 11 }, { wch: 11 }, { wch: 16 },
      { wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 30 }
    ];

    const sheetTitle = ymFilter ? `Database ${ymFilter}` : 'Database Presensi Live';
    window.XLSX.utils.book_append_sheet(wb, ws, sheetTitle);

    const wbout = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);

    let labelFile = 'Semua_Periode';
    if (ymFilter) {
      const [y, m] = ymFilter.split('-').map(Number);
      labelFile = `${MONTH_NAMES[m - 1]}_${y}`;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    const filename = `Database_Presensi_Live_FHISIP_${labelFile}_${todayStr}.xlsx`;

    triggerDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    if (window.app && window.app.showToast) {
      window.app.showToast(`Database Excel Live (${rows.length.toLocaleString('id-ID')} data terupdate) berhasil diunduh!`, 'success');
    }
  }

  /**
   * Buka Modal Dialog Pilihan Laporan Bulanan & Sinkronkan Angka Live
   */
  function openExportModal() {
    const menuExport = document.getElementById('menu-export');
    if (menuExport && typeof menuExport.hidePopover === 'function') {
      try { menuExport.hidePopover(); } catch (_) {}
    }
    refreshExportModalUI({ preferActiveFilter: true, updateSignatureDate: true });
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
    exportLiveDatabaseXlsx,
    refreshExportModalUI,
    updateSelectedMonthPreview,
    getAvailableMonthsSummary,
    openExportModal
  };

})();
