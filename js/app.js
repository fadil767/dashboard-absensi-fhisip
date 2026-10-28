/**
 * DASHBOARD REKAPITULASI ABSENSI PEGAWAI FHISIP UNIVERSITAS TERBUKA
 * Application Logic & Discipline Computation Engine
 */

(function () {
  'use strict';

  // --- STORAGE KEYS ---
  const STORAGE_KEY_ABSENSI = 'ut_fhisip_absensi_data_v2';
  const STORAGE_KEY_CONFIG = 'ut_fhisip_config_v1';

  // --- DEFAULT CONFIGURATION (Resmi FHISIP UT) ---
  const DEFAULT_CONFIG = {
    jamMasuk: '08:30',
    toleransi: 0,
    jamPulang: '16:30',
    jamPulangJumat: '16:30',
    preset: 'fhisip'
  };

  // --- APPLICATION STATE ---
  let state = {
    pegawaiList: [],
    absensiList: [],
    config: { ...DEFAULT_CONFIG },
    currentTab: 'harian', // 'harian' | 'pegawai' | 'prodi'
    filters: {
      search: '',
      unit: '',
      kepegawaian: '', // '' | 'PNS' | 'PPPK' | 'Non-PNS'
      status: 'all', // 'all' | 'telat' | 'tepat' | 'pulang_cepat' | 'tanpa_pulang' | 'anomali' | 'izin'
      bulan: '', // '' | '2026-09' | '2026-10'
      date: '',
      dateStart: '',
      dateEnd: '',
      durasiTelat: '', // '' | 'ringan' | 'sedang' | 'berat'
      sort: 'telat_desc' // 'telat_desc' | 'telat_asc' | 'masuk_asc' | 'masuk_desc' | 'pulang_asc' | 'tanggal_desc' | 'tanggal_asc' | 'nama_asc' | 'nama_desc'
    },
    pagination: {
      currentPage: 1,
      pageSize: 25
    },
    lastFilteredRecords: [],
    editingRecordId: null,
    autoSetLemburTambah: false,
    liveHighlights: new Map(), // key: nip|tanggal -> { seq, actorName, label, timestamp }
    liveSeqCounter: 0
  };

  // Status kehadiran yang TIDAK menggunakan jam masuk & jam pulang
  const NON_TIMED_STATUS_SET = new Set([
    'Lembur',
    'Izin',
    'Cuti',
    'Sakit',
    'Dinas Luar',
    'Tugas Belajar',
    'Alpha'
  ]);

  const IZIN_CUTI_SAKIT_DINAS_SET = new Set([
    'Izin',
    'Cuti',
    'Sakit',
    'Dinas Luar',
    'Tugas Belajar'
  ]);

  function getDayOfWeek(ymd) {
    if (!ymd || typeof ymd !== 'string') return null;
    const parts = ymd.trim().slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return null;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return isNaN(d.getTime()) ? null : d.getDay(); // 0 = Minggu, 6 = Sabtu
  }

  function isWeekendDate(ymd) {
    const dow = getDayOfWeek(ymd);
    return dow === 0 || dow === 6;
  }

  function getWeekendDayName(ymd) {
    const dow = getDayOfWeek(ymd);
    if (dow === 6) return 'Sabtu';
    if (dow === 0) return 'Minggu';
    return '';
  }

  function normalizeStatusValue(rawStatus) {
    const s = String(rawStatus || '').trim();
    if (!s) return 'Hadir';
    const low = s.toLowerCase();
    if (low === 'hadir' || low === 'present') return 'Hadir';
    if (low === 'lembur' || low === 'overtime' || low === 'lbr') return 'Lembur';
    if (low === 'izin' || low === 'ijin' || low.startsWith('izin ')) return 'Izin';
    if (low === 'cuti' || low.startsWith('cuti ')) return 'Cuti';
    if (low === 'sakit' || low === 'skt') return 'Sakit';
    if (low === 'dinas' || low === 'dinas luar' || low === 'dl' || low === 'tugas luar' || low.startsWith('dinas ')) return 'Dinas Luar';
    if (low === 'tugas belajar' || low === 'tb') return 'Tugas Belajar';
    if (low === 'alpha' || low === 'alpa' || low === 'tk' || low === 'tanpa keterangan') return 'Alpha';
    return s;
  }

  function isNonTimedStatus(status) {
    return NON_TIMED_STATUS_SET.has(normalizeStatusValue(status));
  }

  /**
   * Menormalisasi aturan hari Sabtu-Minggu = Lembur (tanpa jam)
   * serta Izin, Cuti, Sakit, Dinas Luar, Lembur, Alpha = tanpa jam.
   */
  function normalizeAttendanceRecord(rec) {
    if (!rec || typeof rec !== 'object') return rec;
    const weekend = isWeekendDate(rec.tanggal);
    let status = normalizeStatusValue(rec.status_kehadiran);
    let keterangan = rec.keterangan || null;

    if (weekend && status === 'Hadir') {
      status = 'Lembur';
      if (!keterangan || keterangan === 'Mesin Biometrik' || keterangan === 'Import Rekap Mesin Presensi') {
        keterangan = `Lembur Akhir Pekan (${getWeekendDayName(rec.tanggal)})`;
      }
    }

    const nonTimed = weekend || isNonTimedStatus(status);
    return {
      ...rec,
      status_kehadiran: status,
      jam_masuk: nonTimed ? null : (rec.jam_masuk || null),
      jam_pulang: nonTimed ? null : (rec.jam_pulang || null),
      keterangan
    };
  }

  // ==========================================================================
  // INITIALIZATION & DATA LOADING
  // ==========================================================================
  function init() {
    loadConfig();
    loadData();
    bindEvents();
    evaluateAndRender();
    initMultiTabSync();

    // Set default tanggal tambah ke hari ini (waktu lokal) & sinkronkan status Sabtu-Minggu/Tanpa Jam
    const elTambahTanggal = document.getElementById('modal-tambah-tanggal');
    if (elTambahTanggal) {
      const now = new Date();
      const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      elTambahTanggal.value = todayIso;
      syncModalTimeFields('tambah', 'date');
    }

    // Aktifkan Live Multi-Device Sync (Supabase Cloud Realtime)
    if (window.supabaseSync && typeof window.supabaseSync.initLiveSync === 'function') {
      window.supabaseSync.initLiveSync();
    }
  }

  function loadConfig() {
    state.config = window.StorageManager
      ? window.StorageManager.loadConfig(DEFAULT_CONFIG)
      : { ...DEFAULT_CONFIG };

    // Sync input fields with config
    syncConfigUI();
  }

  function saveConfig(options = {}) {
    if (window.StorageManager) {
      window.StorageManager.saveConfig(state.config, options);
    } else {
      try {
        localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(state.config));
      } catch (e) {
        console.warn('Gagal menyimpan konfigurasi ke localStorage:', e);
      }
    }

    if (!options.skipCloud && window.supabaseSync && typeof window.supabaseSync.syncConfigToCloud === 'function') {
      window.supabaseSync.syncConfigToCloud(state.config).catch(() => {});
    }
  }

  function syncConfigUI() {
    const elMasuk = document.getElementById('input-jam-masuk');
    const elToleransi = document.getElementById('input-toleransi');
    const elPulang = document.getElementById('input-jam-pulang');
    const elPulangJumat = document.getElementById('input-jam-pulang-jumat');

    if (elMasuk) elMasuk.value = state.config.jamMasuk;
    if (elToleransi) elToleransi.value = state.config.toleransi;
    if (elPulang) elPulang.value = state.config.jamPulang;
    if (elPulangJumat) elPulangJumat.value = state.config.jamPulangJumat;

    // Update tolerance chips active state
    document.querySelectorAll('.tolerance-chip').forEach(chip => {
      const val = parseInt(chip.getAttribute('data-minutes'), 10);
      chip.classList.toggle('active', val === Number(state.config.toleransi));
    });

    // Update preset pills active state
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-preset') === state.config.preset);
    });

    // Update summary rule in header & footer
    const ruleSummary = `Batas Masuk: <strong>${state.config.jamMasuk} WIB</strong> ${state.config.toleransi > 0 ? `(+${state.config.toleransi}m toleransi)` : ''} | Batas Pulang: <strong>${state.config.jamPulang} WIB</strong> (Jumat: ${state.config.jamPulangJumat}) | Sabtu–Minggu: <strong>Lembur (Tanpa Jam)</strong>`;
    const elHeaderPill = document.getElementById('header-policy-rule');
    if (elHeaderPill) elHeaderPill.innerHTML = ruleSummary;

    const elPrintRule = document.getElementById('print-rule-summary');
    if (elPrintRule) elPrintRule.innerHTML = ruleSummary;
  }

  function loadData() {
    const initial = window.INITIAL_FHISIP_DATA || { pegawai: [], absensi: [] };
    state.pegawaiList = initial.pegawai || [];

    if (window.StorageManager) {
      // 1. Baca data sinkron untuk pemuatan UI secepat kilat (tanpa jeda/blank)
      const meta = window.StorageManager.getMeta();
      const syncList = window.StorageManager.KEYS ? localStorage.getItem(window.StorageManager.KEYS.ABSENSI) : null;
      let parsed = null;
      try {
        if (syncList) parsed = JSON.parse(syncList);
      } catch (e) {}

      // Jika pengguna sudah memiliki data tersimpan (termasuk jika berkurang akibat hapus data)
      if (parsed && Array.isArray(parsed) && (meta.isInitialized || parsed.length > 0)) {
        state.absensiList = parsed.map(normalizeAttendanceRecord);
        console.log(`[App] Memuat ${parsed.length} data presensi dari penyimpanan lokal stabil.`);
      } else {
        // Kunjungan pertama (fresh baseline)
        state.absensiList = (initial.absensi ? [...initial.absensi] : []).map(normalizeAttendanceRecord);
        window.StorageManager.saveAbsensi(state.absensiList, { isUserModified: false });
      }

      // 2. Verifikasi dan pulihkan secara asinkron dari IndexedDB / Server API
      window.StorageManager.loadAbsensiInitial(initial.absensi).then(records => {
        if (records && Array.isArray(records)) {
          if (records.length !== state.absensiList.length) {
            state.absensiList = records.map(normalizeAttendanceRecord);
            populateDateDropdown();
            evaluateAndRender();
          }
        }
      }).catch(err => {
        console.warn('[App] Gagal inisialisasi async StorageManager:', err);
      });
    } else {
      // Fallback reguler
      try {
        const savedAbsensi = localStorage.getItem(STORAGE_KEY_ABSENSI);
        if (savedAbsensi) {
          const parsed = JSON.parse(savedAbsensi);
          const rawList = Array.isArray(parsed) ? parsed : (initial.absensi ? [...initial.absensi] : []);
          state.absensiList = rawList.map(normalizeAttendanceRecord);
        } else {
          state.absensiList = (initial.absensi ? [...initial.absensi] : []).map(normalizeAttendanceRecord);
        }
      } catch (e) {
        state.absensiList = (initial.absensi ? [...initial.absensi] : []).map(normalizeAttendanceRecord);
      }
    }

    populateUnitDropdown();
    populateDateDropdown();
    populatePegawaiSelect();
  }

  function saveAbsensi(isUserModified = true, extraOptions = {}) {
    if (window.StorageManager) {
      window.StorageManager.saveAbsensi(state.absensiList, { isUserModified, ...extraOptions });
    } else {
      try {
        localStorage.setItem(STORAGE_KEY_ABSENSI, JSON.stringify(state.absensiList));
      } catch (e) {
        console.warn('Gagal menyimpan data absensi ke localStorage:', e);
      }
    }
  }

  function populateUnitDropdown() {
    const select = document.getElementById('filter-unit');
    if (!select) return;

    // Get unique units
    const units = [...new Set(state.pegawaiList.map(p => p.unit_kerja).filter(Boolean))].sort();
    select.innerHTML = '<option value="">Semua Program Studi / Unit Kerja</option>' +
      units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
  }

  function populateDateDropdown() {
    const select = document.getElementById('filter-date');
    const elStart = document.getElementById('filter-date-start');
    const elEnd = document.getElementById('filter-date-end');

    const dates = [...new Set(state.absensiList.map(a => a.tanggal).filter(Boolean))].sort().reverse();

    if (select) {
      select.innerHTML = '<option value="">Semua Tanggal Periode</option>' +
        dates.map(d => `<option value="${d}">${formatTanggalIndo(d)}</option>`).join('');
    }

    if (dates.length > 0) {
      const minDate = dates[dates.length - 1];
      const maxDate = dates[0];
      if (elStart) {
        elStart.min = minDate;
        elStart.max = maxDate;
      }
      if (elEnd) {
        elEnd.min = minDate;
        elEnd.max = maxDate;
      }
    }
  }

  function populatePegawaiSelect() {
    const select = document.getElementById('modal-tambah-pegawai');
    if (!select) return;

    select.innerHTML = '<option value="">-- Pilih Pegawai FHISIP --</option>' +
      state.pegawaiList.map(p => {
        return `<option value="${p.nip}">${escapeHtml(p.nama_lengkap)} (${p.status_kepegawaian}) - ${escapeHtml(p.unit_kerja || '')}</option>`;
      }).join('');
  }

  // ==========================================================================
  // DISCIPLINE EVALUATION ENGINE (CORE ALGORITHM)
  // ==========================================================================
  function parseTimeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const parts = timeStr.trim().split(':');
    if (parts.length < 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  function minutesToTime(totalMinutes) {
    if (totalMinutes == null || isNaN(totalMinutes)) return '-';
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /**
   * Mengevaluasi catatan presensi berdasarkan ambang batas waktu yang aktif saat ini.
   * Aturan khusus:
   * - Hari Sabtu & Minggu otomatis berstatus Lembur (tanpa jam masuk/pulang).
   * - Status Lembur, Izin, Cuti, Sakit, Dinas Luar, Tugas Belajar, Alpha tidak memiliki jam masuk/pulang.
   */
  function evaluateRecord(record) {
    const configMasukMin = parseTimeToMinutes(state.config.jamMasuk);
    const toleransiMin = Number(state.config.toleransi) || 0;
    const batasMasukEfektif = configMasukMin + toleransiMin;

    const dow = getDayOfWeek(record.tanggal);
    const isFriday = dow === 5;
    const isWeekend = dow === 0 || dow === 6;
    const configPulangMin = parseTimeToMinutes(isFriday ? state.config.jamPulangJumat : state.config.jamPulang);

    let effectiveStatus = normalizeStatusValue(record.status_kehadiran);
    if (isWeekend && effectiveStatus === 'Hadir') {
      effectiveStatus = 'Lembur';
    }

    const isNonTimed = isWeekend || isNonTimedStatus(effectiveStatus);
    const effectiveMasuk = isNonTimed ? null : (record.jam_masuk || null);
    const effectivePulang = isNonTimed ? null : (record.jam_pulang || null);

    const recordMasukMin = parseTimeToMinutes(effectiveMasuk);
    const recordPulangMin = parseTimeToMinutes(effectivePulang);

    let isTerlambat = false;
    let menitTerlambat = 0;
    let isPulangCepat = false;
    let menitPulangCepat = 0;
    let isTanpaPulang = false;
    let isTanpaMasuk = false;

    // Evaluasi jam masuk & kepulangan hanya untuk Hadir pada hari kerja (Senin - Jumat)
    if (isNonTimed) {
      isTerlambat = false;
      isPulangCepat = false;
      isTanpaMasuk = false;
      isTanpaPulang = false;
    } else {
      // Evaluasi jam masuk
      if (recordMasukMin !== null && configMasukMin !== null) {
        if (recordMasukMin > batasMasukEfektif) {
          isTerlambat = true;
          menitTerlambat = recordMasukMin - configMasukMin; // Dihitung dari batas resmi
        }
      } else {
        isTanpaMasuk = true;
      }

      // Evaluasi jam pulang
      if (recordPulangMin !== null && configPulangMin !== null) {
        if (recordPulangMin < configPulangMin) {
          isPulangCepat = true;
          menitPulangCepat = configPulangMin - recordPulangMin;
        }
      } else {
        isTanpaPulang = true;
      }
    }

    const isLembur = effectiveStatus === 'Lembur';
    const isIzinCutiSakitDinas = IZIN_CUTI_SAKIT_DINAS_SET.has(effectiveStatus);
    const isAnomali = isTerlambat || isPulangCepat || isTanpaPulang || isTanpaMasuk || (effectiveStatus === 'Alpha');

    // Label Status & Badge
    let statusLabel = 'Tepat Waktu';
    let statusBadgeClass = 'badge-tepat';

    if (effectiveStatus === 'Lembur') {
      const wkDay = getWeekendDayName(record.tanggal);
      statusLabel = wkDay ? `Lembur (${wkDay})` : 'Lembur';
      statusBadgeClass = 'badge-lembur';
    } else if (effectiveStatus === 'Izin') {
      statusLabel = 'Izin';
      statusBadgeClass = 'badge-izin';
    } else if (effectiveStatus === 'Cuti') {
      statusLabel = 'Cuti';
      statusBadgeClass = 'badge-cuti';
    } else if (effectiveStatus === 'Sakit') {
      statusLabel = 'Sakit';
      statusBadgeClass = 'badge-sakit';
    } else if (effectiveStatus === 'Dinas Luar') {
      statusLabel = 'Dinas Luar';
      statusBadgeClass = 'badge-dinas';
    } else if (effectiveStatus === 'Tugas Belajar') {
      statusLabel = 'Tugas Belajar';
      statusBadgeClass = 'badge-dinas';
    } else if (effectiveStatus !== 'Hadir') {
      statusLabel = effectiveStatus;
      statusBadgeClass = 'badge-alpha';
    } else {
      if (isTerlambat && isPulangCepat) {
        statusLabel = 'Telat & Pulang Cepat';
        statusBadgeClass = 'badge-telat-pulang-cepat';
      } else if (isTerlambat) {
        statusLabel = 'Terlambat';
        statusBadgeClass = 'badge-telat';
      } else if (isPulangCepat) {
        statusLabel = 'Pulang Lebih Awal';
        statusBadgeClass = 'badge-pulang-cepat';
      } else if (isTanpaPulang && !isTanpaMasuk) {
        statusLabel = 'Belum Scan Pulang';
        statusBadgeClass = 'badge-warning';
      } else if (isTanpaMasuk && !isTanpaPulang) {
        statusLabel = 'Tanpa Scan Masuk';
        statusBadgeClass = 'badge-warning';
      } else if (isTanpaMasuk && isTanpaPulang) {
        statusLabel = 'Tanpa Scan';
        statusBadgeClass = 'badge-warning';
      } else {
        statusLabel = 'Tepat Waktu';
        statusBadgeClass = 'badge-tepat';
      }
    }

    return {
      ...record,
      jam_masuk: effectiveMasuk,
      jam_pulang: effectivePulang,
      status_kehadiran: effectiveStatus,
      isWeekend,
      isNonTimed,
      isLembur,
      isIzinCutiSakitDinas,
      isTerlambat,
      menitTerlambat,
      isPulangCepat,
      menitPulangCepat,
      isTanpaPulang,
      isTanpaMasuk,
      isAnomali,
      statusLabel,
      statusBadgeClass
    };
  }

  // ==========================================================================
  // RENDER & RECALCULATION PIPELINE
  // ==========================================================================
  const MONTH_NAMES_ID = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  function formatPeriodLabel(ym) {
    if (!ym || ym === 'all') return 'Semua Periode';
    const parts = String(ym).split('-').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && parts[1] >= 1 && parts[1] <= 12) {
      return `${MONTH_NAMES_ID[parts[1] - 1]} ${parts[0]}`;
    }
    return ym;
  }

  function getEvaluatedForActivePeriod() {
    const all = state.absensiList.map(evaluateRecord);
    return state.filters.bulan
      ? all.filter(r => r.tanggal && r.tanggal.startsWith(state.filters.bulan))
      : all;
  }

  function syncDynamicPeriodButtons(monthCountsMap) {
    const groupEl = document.getElementById('period-filter-group');
    if (!groupEl) return;

    // Hapus tombol bulan dinamis lama yang sudah kosong / digantikan
    groupEl.querySelectorAll('.period-btn-dynamic').forEach(btn => btn.remove());

    // Render tombol bulan tambahan di luar 2026-09 & 2026-10 jika ada data baru (mis. 2026-11, 2026-12, dst.)
    const extraMonths = Array.from(monthCountsMap.keys())
      .filter(ym => ym !== '2026-09' && ym !== '2026-10' && (monthCountsMap.get(ym) || 0) > 0)
      .sort();

    extraMonths.forEach(ym => {
      const count = monthCountsMap.get(ym) || 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'period-btn period-btn-dynamic' + (state.filters.bulan === ym ? ' active' : '');
      btn.setAttribute('data-period', ym);
      btn.title = `Hanya tampilkan data presensi periode ${formatPeriodLabel(ym)}`;
      btn.innerHTML = `
        <span>📅</span>
        <span>${escapeHtml(formatPeriodLabel(ym))}</span>
        <span class="period-count">${count.toLocaleString('id-ID')}</span>
      `;
      groupEl.appendChild(btn);
    });
  }

  function evaluateAndRender() {
    // 1. Evaluasi seluruh data absensi dengan konfigurasi batas waktu aktif
    const evaluatedAll = state.absensiList.map(evaluateRecord);

    // Hitung live counter periode & pegawai aktif per bulan
    const monthCountsMap = new Map();
    const septPegawaiSet = new Set();
    const octPegawaiSet = new Set();

    state.absensiList.forEach(a => {
      if (!a || !a.tanggal || a.tanggal.length < 7) return;
      const ym = a.tanggal.slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(ym)) {
        monthCountsMap.set(ym, (monthCountsMap.get(ym) || 0) + 1);
      }
      if (ym === '2026-09' && a.nip) septPegawaiSet.add(String(a.nip).trim());
      if (ym === '2026-10' && a.nip) octPegawaiSet.add(String(a.nip).trim());
    });

    const septCount = monthCountsMap.get('2026-09') || 0;
    const octCount = monthCountsMap.get('2026-10') || 0;

    setText('count-period-all', state.absensiList.length.toLocaleString('id-ID'));
    setText('count-period-sept', septCount.toLocaleString('id-ID'));
    setText('count-period-oct', octCount.toLocaleString('id-ID'));
    syncDynamicPeriodButtons(monthCountsMap);

    // Sinkronkan angka live pada Modal Kamus & Referensi Database (#modal-database-ref)
    setText('ref-sept-count', septCount.toLocaleString('id-ID'));
    setText('ref-sept-pegawai', `${septPegawaiSet.size} Org`);
    setText('ref-oct-count', octCount.toLocaleString('id-ID'));
    setText('ref-oct-pegawai', `${octPegawaiSet.size} Org`);
    setText('ref-pegawai-count', `${state.pegawaiList.length} Pegawai`);
    setText('ref-total-count', `${state.absensiList.length.toLocaleString('id-ID')} Data`);

    // Sinkronkan angka live pada Modal Ekspor Bulanan (#modal-export-monthly)
    if (window.monthlyReportGenerator && typeof window.monthlyReportGenerator.refreshExportModalUI === 'function') {
      window.monthlyReportGenerator.refreshExportModalUI({
        preferActiveFilter: false,
        updateSignatureDate: false
      });
    }

    // Catatan untuk periode aktif (jika filter bulan dipilih)
    const evaluatedForPeriod = state.filters.bulan
      ? evaluatedAll.filter(r => r.tanggal && r.tanggal.startsWith(state.filters.bulan))
      : evaluatedAll;

    // 2. Render KPI Summary Cards berdasarkan periode yang dipilih
    renderStats(evaluatedForPeriod);

    // 3. Render View berdasarkan Tab Aktif
    if (state.currentTab === 'harian') {
      renderHarianTable(evaluatedAll);
    } else if (state.currentTab === 'pegawai') {
      renderPegawaiRekapTable(evaluatedForPeriod);
    } else if (state.currentTab === 'prodi') {
      renderProdiRekapTable(evaluatedForPeriod);
    }
  }

  // --- KPI STATS COMPUTATION ---
  function renderStats(records) {
    const totalRecords = records.length;
    let tepatCount = 0;
    let telatCount = 0;
    let pulangCepatCount = 0;
    let totalMenitTelat = 0;
    let lemburCount = 0;
    let izinCount = 0;
    let tanpaPulangCount = 0;
    let anomaliCount = 0;

    records.forEach(r => {
      if (r.isLembur) {
        lemburCount++;
      } else if (r.isIzinCutiSakitDinas) {
        izinCount++;
      } else if (r.status_kehadiran === 'Hadir') {
        if (r.isTerlambat) {
          telatCount++;
          totalMenitTelat += r.menitTerlambat;
        } else if (!r.isTanpaMasuk) {
          tepatCount++;
        }

        if (r.isPulangCepat) {
          pulangCepatCount++;
        }
        if (r.isTanpaPulang) {
          tanpaPulangCount++;
        }
      }

      if (r.isAnomali) {
        anomaliCount++;
      }
    });

    const persenTepat = totalRecords > 0 ? ((tepatCount / totalRecords) * 100).toFixed(1) : 0;
    const persenTelat = totalRecords > 0 ? ((telatCount / totalRecords) * 100).toFixed(1) : 0;
    const rataMenitTelat = telatCount > 0 ? Math.round(totalMenitTelat / telatCount) : 0;

    // Update DOM KPI Cards
    setText('stat-total-records', totalRecords.toLocaleString('id-ID'));
    setText('stat-tepat-count', tepatCount.toLocaleString('id-ID'));
    setText('stat-tepat-pct', `${persenTepat}% Tepat Waktu`);
    setText('stat-telat-count', telatCount.toLocaleString('id-ID'));
    setText('stat-telat-sub', `${persenTelat}% • Rata-rata: ${rataMenitTelat} menit`);
    setText('stat-pulang-cepat-count', pulangCepatCount.toLocaleString('id-ID'));

    // Progress bar fills
    setBarWidth('bar-tepat', `${persenTepat}%`);
    setBarWidth('bar-telat', `${persenTelat}%`);
    setBarWidth('bar-pulang-cepat', `${totalRecords > 0 ? ((pulangCepatCount / totalRecords) * 100).toFixed(1) : 0}%`);

    // Tab badges
    setText('tab-count-harian', totalRecords);
    setText('tab-count-pegawai', state.pegawaiList.length);

    // Update Quick Filter Button Pill Counts
    setText('count-status-all', totalRecords.toLocaleString('id-ID'));
    setText('count-status-telat', telatCount.toLocaleString('id-ID'));
    setText('count-status-tepat', tepatCount.toLocaleString('id-ID'));
    setText('count-status-pulang-cepat', pulangCepatCount.toLocaleString('id-ID'));
    setText('count-status-tanpa-pulang', tanpaPulangCount.toLocaleString('id-ID'));
    setText('count-status-anomali', anomaliCount.toLocaleString('id-ID'));
    setText('count-status-lembur', lemburCount.toLocaleString('id-ID'));
    setText('count-status-izin', izinCount.toLocaleString('id-ID'));
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setBarWidth(id, width) {
    const el = document.getElementById(id);
    if (el) el.style.width = width;
  }

  // --- TAB 1: LOG PRESENSI HARIAN ---
  function renderHarianTable(allEvaluated) {
    // 1. Terapkan filter multi-dimensi
    let filtered = allEvaluated.filter(r => {
      // Filter 0: Basis Bulan / Periode (September 2026 vs Oktober 2026)
      if (state.filters.bulan && (!r.tanggal || !r.tanggal.startsWith(state.filters.bulan))) {
        return false;
      }

      // Filter 1: Pencarian (Nama Pegawai, NIP, atau Unit Kerja)
      if (state.filters.search) {
        const q = state.filters.search.toLowerCase();
        const nama = (r.nama_lengkap || '').toLowerCase();
        const nip = (r.nip || '').toLowerCase();
        const unit = (r.unit_kerja || '').toLowerCase();
        if (!nama.includes(q) && !nip.includes(q) && !unit.includes(q)) return false;
      }

      // Filter 2: Program Studi / Bagian
      if (state.filters.unit && r.unit_kerja !== state.filters.unit) {
        return false;
      }

      // Filter 3: Status Kepegawaian (PNS / PPPK / Non-PNS)
      if (state.filters.kepegawaian) {
        const emp = state.pegawaiList.find(p => p.nip === r.nip) || {};
        if (emp.status_kepegawaian !== state.filters.kepegawaian) return false;
      }

      // Filter 4: Tanggal Spesifik
      if (state.filters.date && r.tanggal !== state.filters.date) {
        return false;
      }

      // Filter 5: Rentang Tanggal (Date Range)
      if (state.filters.dateStart && r.tanggal < state.filters.dateStart) {
        return false;
      }
      if (state.filters.dateEnd && r.tanggal > state.filters.dateEnd) {
        return false;
      }

      // Filter 6: Durasi Keterlambatan
      if (state.filters.durasiTelat) {
        if (!r.isTerlambat) return false;
        if (state.filters.durasiTelat === 'ringan' && r.menitTerlambat > 15) return false;
        if (state.filters.durasiTelat === 'sedang' && (r.menitTerlambat < 16 || r.menitTerlambat > 30)) return false;
        if (state.filters.durasiTelat === 'berat' && r.menitTerlambat <= 30) return false;
      }

      // Filter 7: Status Disiplin & Kehadiran
      if (state.filters.status === 'telat') {
        if (!r.isTerlambat) return false;
      } else if (state.filters.status === 'tepat') {
        if (r.isTerlambat || r.status_kehadiran !== 'Hadir' || r.isTanpaMasuk) return false;
      } else if (state.filters.status === 'pulang_cepat') {
        if (!r.isPulangCepat) return false;
      } else if (state.filters.status === 'tanpa_pulang') {
        if (!r.isTanpaPulang) return false;
      } else if (state.filters.status === 'anomali') {
        if (!r.isAnomali) return false;
      } else if (state.filters.status === 'lembur') {
        if (!r.isLembur) return false;
      } else if (state.filters.status === 'izin') {
        if (!r.isIzinCutiSakitDinas) return false;
      }

      return true;
    });

    state.lastFilteredRecords = filtered;

    // 2. Sorting Multi-Opsi (Prioritaskan baris yang baru ditambahkan/diupdate secara live di atas)
    filtered.sort((a, b) => {
      const liveA = state.liveHighlights.get(`${a.nip}|${a.tanggal}`);
      const liveB = state.liveHighlights.get(`${b.nip}|${b.tanggal}`);
      if (liveA && !liveB) return -1;
      if (!liveA && liveB) return 1;
      if (liveA && liveB && liveA.seq !== liveB.seq) return liveB.seq - liveA.seq;

      switch (state.filters.sort) {
        case 'telat_desc':
          return b.menitTerlambat - a.menitTerlambat;
        case 'telat_asc':
          return a.menitTerlambat - b.menitTerlambat;
        case 'masuk_asc':
          if (!a.jam_masuk && !b.jam_masuk) return 0;
          if (!a.jam_masuk) return 1;
          if (!b.jam_masuk) return -1;
          return a.jam_masuk.localeCompare(b.jam_masuk);
        case 'masuk_desc':
          if (!a.jam_masuk && !b.jam_masuk) return 0;
          if (!a.jam_masuk) return 1;
          if (!b.jam_masuk) return -1;
          return b.jam_masuk.localeCompare(a.jam_masuk);
        case 'pulang_asc':
          if (!a.jam_pulang && !b.jam_pulang) return 0;
          if (!a.jam_pulang) return 1;
          if (!b.jam_pulang) return -1;
          return a.jam_pulang.localeCompare(b.jam_pulang);
        case 'tanggal_desc':
          return (b.tanggal || '').localeCompare(a.tanggal || '');
        case 'tanggal_asc':
          return (a.tanggal || '').localeCompare(b.tanggal || '');
        case 'nama_asc':
          return (a.nama_lengkap || '').localeCompare(b.nama_lengkap || '');
        case 'nama_desc':
          return (b.nama_lengkap || '').localeCompare(a.nama_lengkap || '');
        default:
          return 0;
      }
    });

    // 3. Render Active Filter Tags & Count Summary
    renderActiveFilterSummary(allEvaluated.length, filtered.length);

    // 4. Pagination
    const totalItems = filtered.length;
    const pageSize = state.pagination.pageSize;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    if (state.pagination.currentPage > totalPages) {
      state.pagination.currentPage = 1;
    }
    const startIndex = (state.pagination.currentPage - 1) * pageSize;
    const pageItems = filtered.slice(startIndex, startIndex + pageSize);

    // 5. Render Table Body
    const tbody = document.getElementById('table-body-harian');
    if (!tbody) return;

    if (totalItems === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8">
            <div class="empty-state">
              <div class="empty-state-icon">🔍</div>
              <h3>Tidak ada data presensi yang sesuai kriteria</h3>
              <p>Coba sesuaikan kata kunci pencarian, filter status, atau klik tombol Reset Filter di bawah.</p>
              <button type="button" class="btn btn-outline btn-sm" onclick="window.app.resetFilters()" style="margin-top:10px;">
                🔄 Reset Semua Filter
              </button>
            </div>
          </td>
        </tr>
      `;
      renderPagination(0, 0, 0, 1);
      return;
    }

    tbody.innerHTML = pageItems.map((r, idx) => {
      const rowNo = startIndex + idx + 1;
      const liveMeta = state.liveHighlights.get(`${r.nip}|${r.tanggal}`);
      const isFreshFlash = liveMeta && (Date.now() - liveMeta.timestamp < 12000);
      const rowClasses = [
        r.isTerlambat ? 'highlight-telat' : '',
        isFreshFlash ? 'row-live-flash' : ''
      ].filter(Boolean).join(' ');

      // Employee metadata
      const emp = state.pegawaiList.find(p => p.nip === r.nip) || {};
      const statusPns = emp.status_kepegawaian || 'Pegawai';

      // Jam Masuk & Jam Pulang Pill (Kosong / Tanpa Jam untuk Sabtu-Minggu Lembur & Izin/Cuti/Sakit/Dinas)
      let masukPill;
      let pulangPill;

      if (r.isNonTimed) {
        masukPill = `<span class="time-pill time-none" title="Status ${escapeHtml(r.status_kehadiran)} tidak menggunakan jam masuk">—</span>`;
        pulangPill = `<span class="time-pill time-none" title="Status ${escapeHtml(r.status_kehadiran)} tidak menggunakan jam pulang">—</span>`;
      } else {
        masukPill = `<span class="time-pill">${r.jam_masuk || '-'}</span>`;
        if (r.isTerlambat) {
          masukPill = `<span class="time-pill time-danger">${r.jam_masuk} (+${r.menitTerlambat}m)</span>`;
        } else if (!r.jam_masuk && r.status_kehadiran === 'Hadir') {
          masukPill = `<span class="time-pill time-warning" title="Belum / tidak ada scan masuk">Kosong ⚠️</span>`;
        }

        pulangPill = `<span class="time-pill">${r.jam_pulang || '-'}</span>`;
        if (r.isPulangCepat) {
          pulangPill = `<span class="time-pill time-warning">${r.jam_pulang} (-${r.menitPulangCepat}m)</span>`;
        } else if (!r.jam_pulang && r.status_kehadiran === 'Hadir') {
          pulangPill = `<span class="time-pill" style="background:#FFFBEB; color:#B45309; border:1px solid #FDE68A;" title="Belum melakukan scan keluar">Belum Scan ⏳</span>`;
        }
      }

      const weekendTagHtml = r.isWeekend
        ? `<div><span class="weekend-day-tag">🗓️ Akhir Pekan</span></div>`
        : '';

      const liveBadgeHtml = liveMeta
        ? `<div style="margin-top:3px;"><span class="badge-live-row" title="Diperbarui oleh ${escapeHtml(liveMeta.actorName || 'Pengguna')}">${escapeHtml(liveMeta.label || '⚡ Live')}</span></div>`
        : '';

      let statusIcon = '';
      if (r.isLembur) statusIcon = '🗓️ ';
      else if (r.status_kehadiran === 'Izin') statusIcon = '📄 ';
      else if (r.status_kehadiran === 'Cuti') statusIcon = '🏖️ ';
      else if (r.status_kehadiran === 'Sakit') statusIcon = '🩺 ';
      else if (r.status_kehadiran === 'Dinas Luar' || r.status_kehadiran === 'Tugas Belajar') statusIcon = '🏛️ ';
      else if (r.isTerlambat) statusIcon = '⚠️ ';
      else if (r.statusLabel === 'Tepat Waktu') statusIcon = '✓ ';

      return `
        <tr class="${rowClasses}">
          <td style="color:var(--text-muted); font-weight:600; text-align:center; width:45px;">${rowNo}</td>
          <td style="white-space:nowrap;">
            <strong>${formatTanggalIndo(r.tanggal)}</strong>
            ${weekendTagHtml}
            ${liveBadgeHtml}
          </td>
          <td>
            <div class="employee-cell">
              <span class="employee-name">${escapeHtml(r.nama_lengkap || emp.nama_lengkap || 'Pegawai')}</span>
              <div class="employee-meta">
                <span>NIP: ${r.nip || '-'}</span>
                <span class="badge-kepegawaian">${escapeHtml(statusPns)}</span>
              </div>
            </div>
          </td>
          <td style="font-size:0.82rem; color:var(--text-muted); max-width:200px;">
            ${escapeHtml(r.unit_kerja || emp.unit_kerja || '-')}
          </td>
          <td style="text-align:center;">${masukPill}</td>
          <td style="text-align:center;">${pulangPill}</td>
          <td>
            <span class="badge-status ${r.statusBadgeClass}">
              ${statusIcon}${escapeHtml(r.statusLabel)}
            </span>
            ${r.keterangan ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${escapeHtml(r.keterangan)}</div>` : ''}
          </td>
          <td>
            <div class="table-actions">
              <button class="btn-table-action btn-action-edit" onclick="window.app.openEditModal('${escapeHtml(String(r.id))}')" title="Edit Jam & Keterangan">
                ✏️ Edit
              </button>
              <button class="btn-table-action btn-action-delete" onclick="window.app.deleteRecord('${escapeHtml(String(r.id))}')" title="Hapus Data">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    renderPagination(totalItems, startIndex + 1, Math.min(startIndex + pageSize, totalItems), totalPages);
  }

  // --- ACTIVE FILTER SUMMARY & CHIPS ---
  function renderActiveFilterSummary(totalAll, totalFiltered) {
    const elCount = document.getElementById('summary-match-count');
    if (elCount) {
      elCount.innerHTML = `Menampilkan <strong>${totalFiltered.toLocaleString('id-ID')}</strong> dari <strong>${totalAll.toLocaleString('id-ID')}</strong> catatan presensi`;
    }

    const chipsContainer = document.getElementById('active-filter-chips');
    const badgeActiveCount = document.getElementById('badge-active-filter-count');
    const btnReset = document.getElementById('btn-reset-filter');
    const btnClearSearch = document.getElementById('btn-clear-search');
    const btnClearDateRange = document.getElementById('btn-clear-date-range');

    if (btnClearSearch) {
      btnClearSearch.style.display = state.filters.search ? 'flex' : 'none';
    }
    if (btnClearDateRange) {
      btnClearDateRange.style.display = (state.filters.dateStart || state.filters.dateEnd) ? 'inline-block' : 'none';
    }

    const activeList = [];

    if (state.filters.search) {
      activeList.push({ key: 'search', label: `Cari: "${state.filters.search}"` });
    }
    if (state.filters.status && state.filters.status !== 'all') {
      const statusLabels = {
        telat: '🚨 Terlambat',
        tepat: '✅ Tepat Waktu',
        pulang_cepat: '⏳ Pulang Cepat',
        tanpa_pulang: '⚠️ Belum Scan Pulang',
        anomali: '⚡ Semua Pelanggaran',
        lembur: '🗓️ Lembur (Sabtu/Minggu)',
        izin: '📄 Izin / Cuti / Sakit / Dinas'
      };
      activeList.push({ key: 'status', label: `Status: ${statusLabels[state.filters.status] || state.filters.status}` });
    }
    if (state.filters.unit) {
      activeList.push({ key: 'unit', label: `Unit: ${state.filters.unit}` });
    }
    if (state.filters.kepegawaian) {
      activeList.push({ key: 'kepegawaian', label: `Kepegawaian: ${state.filters.kepegawaian}` });
    }
    if (state.filters.date) {
      activeList.push({ key: 'date', label: `Tanggal: ${formatTanggalIndo(state.filters.date)}` });
    }
    if (state.filters.dateStart || state.filters.dateEnd) {
      activeList.push({
        key: 'dateRange',
        label: `Rentang: ${state.filters.dateStart || 'Awal'} s/d ${state.filters.dateEnd || 'Akhir'}`
      });
    }
    if (state.filters.durasiTelat) {
      const durasiLabels = { ringan: 'Telat 1-15m', sedang: 'Telat 16-30m', berat: 'Telat >30m' };
      activeList.push({ key: 'durasiTelat', label: `Durasi: ${durasiLabels[state.filters.durasiTelat] || state.filters.durasiTelat}` });
    }
    if (state.filters.bulan) {
      const bLabel = state.filters.bulan === '2026-09' ? 'Periode: September 2026' : 'Periode: Oktober 2026';
      activeList.push({ key: 'bulan', label: bLabel });
    }

    if (chipsContainer) {
      chipsContainer.innerHTML = activeList.map(item => `
        <span class="filter-chip">
          <span>${escapeHtml(item.label)}</span>
          <button type="button" class="filter-chip-remove" onclick="window.app.clearFilterItem('${item.key}')" title="Hapus filter ini">✕</button>
        </span>
      `).join('');
    }

    const activeCount = activeList.length;
    if (badgeActiveCount) {
      badgeActiveCount.textContent = activeCount;
      badgeActiveCount.style.display = activeCount > 0 ? 'inline-block' : 'none';
    }
    if (btnReset) {
      btnReset.style.display = activeCount > 0 ? 'inline-flex' : 'none';
    }
  }

  function clearFilterItem(key) {
    if (key === 'search') {
      state.filters.search = '';
      const el = document.getElementById('filter-search');
      if (el) el.value = '';
    } else if (key === 'status') {
      state.filters.status = 'all';
      document.querySelectorAll('.status-filter-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-status') === 'all');
      });
    } else if (key === 'bulan') {
      state.filters.bulan = '';
      document.querySelectorAll('.period-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-period') === 'all');
      });
    } else if (key === 'unit') {
      state.filters.unit = '';
      const el = document.getElementById('filter-unit');
      if (el) el.value = '';
    } else if (key === 'kepegawaian') {
      state.filters.kepegawaian = '';
      const el = document.getElementById('filter-kepegawaian');
      if (el) el.value = '';
    } else if (key === 'date') {
      state.filters.date = '';
      const el = document.getElementById('filter-date');
      if (el) el.value = '';
    } else if (key === 'dateRange') {
      state.filters.dateStart = '';
      state.filters.dateEnd = '';
      const elStart = document.getElementById('filter-date-start');
      const elEnd = document.getElementById('filter-date-end');
      if (elStart) elStart.value = '';
      if (elEnd) elEnd.value = '';
    } else if (key === 'durasiTelat') {
      state.filters.durasiTelat = '';
      const el = document.getElementById('filter-durasi-telat');
      if (el) el.value = '';
    }

    state.pagination.currentPage = 1;
    evaluateAndRender();
  }

  function resetFilters() {
    state.filters = {
      search: '',
      unit: '',
      kepegawaian: '',
      status: 'all',
      bulan: '',
      date: '',
      dateStart: '',
      dateEnd: '',
      durasiTelat: '',
      sort: 'telat_desc'
    };
    state.pagination.currentPage = 1;

    // Reset Form Input DOM
    const elSearch = document.getElementById('filter-search');
    const elUnit = document.getElementById('filter-unit');
    const elKepeg = document.getElementById('filter-kepegawaian');
    const elDate = document.getElementById('filter-date');
    const elDateStart = document.getElementById('filter-date-start');
    const elDateEnd = document.getElementById('filter-date-end');
    const elDurasi = document.getElementById('filter-durasi-telat');
    const elSort = document.getElementById('filter-sort');

    if (elSearch) elSearch.value = '';
    if (elUnit) elUnit.value = '';
    if (elKepeg) elKepeg.value = '';
    if (elDate) elDate.value = '';
    if (elDateStart) elDateStart.value = '';
    if (elDateEnd) elDateEnd.value = '';
    if (elDurasi) elDurasi.value = '';
    if (elSort) elSort.value = 'telat_desc';

    document.querySelectorAll('.status-filter-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-status') === 'all');
    });

    document.querySelectorAll('.period-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-period') === 'all');
    });

    evaluateAndRender();
    showToast('Semua filter berhasil dikembalikan ke standar awal.');
  }

  function renderPagination(total, from, to, totalPages) {
    const elInfo = document.getElementById('pagination-info');
    if (elInfo) {
      if (total === 0) {
        elInfo.textContent = 'Menampilkan 0 data';
      } else {
        elInfo.textContent = `Menampilkan ${from} - ${to} dari ${total.toLocaleString('id-ID')} data presensi`;
      }
    }

    const elPrev = document.getElementById('btn-page-prev');
    const elNext = document.getElementById('btn-page-next');
    const elNum = document.getElementById('pagination-page-num');

    if (elPrev) elPrev.disabled = state.pagination.currentPage <= 1;
    if (elNext) elNext.disabled = state.pagination.currentPage >= totalPages;
    if (elNum) elNum.textContent = `Halaman ${state.pagination.currentPage} / ${totalPages}`;
  }

  // --- TAB 2: REKAPITULASI PER PEGAWAI ---
  function renderPegawaiRekapTable(allEvaluated) {
    const tbody = document.getElementById('table-body-pegawai');
    if (!tbody) return;

    // Filter per unit / search jika ada
    let pegawaiPool = state.pegawaiList;
    if (state.filters.search) {
      const q = state.filters.search.toLowerCase();
      pegawaiPool = pegawaiPool.filter(p => (p.nama_lengkap || '').toLowerCase().includes(q) || (p.nip || '').includes(q));
    }
    if (state.filters.unit) {
      pegawaiPool = pegawaiPool.filter(p => p.unit_kerja === state.filters.unit);
    }

    // Hitung agregasi per NIP
    const rekapMap = new Map();

    allEvaluated.forEach(r => {
      if (!rekapMap.has(r.nip)) {
        rekapMap.set(r.nip, {
          totalHadir: 0,
          tepatCount: 0,
          telatCount: 0,
          totalMenitTelat: 0,
          pulangCepatCount: 0,
          lemburCount: 0,
          izinCount: 0
        });
      }
      const agg = rekapMap.get(r.nip);
      if (r.isLembur) {
        agg.lemburCount++;
      } else if (r.isIzinCutiSakitDinas) {
        agg.izinCount++;
      } else if (r.status_kehadiran === 'Hadir') {
        agg.totalHadir++;
        if (r.isTerlambat) {
          agg.telatCount++;
          agg.totalMenitTelat += r.menitTerlambat;
        } else if (!r.isTanpaMasuk) {
          agg.tepatCount++;
        }
        if (r.isPulangCepat) {
          agg.pulangCepatCount++;
        }
      }
    });

    const rows = pegawaiPool.map(p => {
      const agg = rekapMap.get(p.nip) || {
        totalHadir: 0,
        tepatCount: 0,
        telatCount: 0,
        totalMenitTelat: 0,
        pulangCepatCount: 0,
        lemburCount: 0,
        izinCount: 0
      };

      const pctDisiplin = agg.totalHadir > 0 ? ((agg.tepatCount / agg.totalHadir) * 100).toFixed(1) : 100;
      return { ...p, ...agg, pctDisiplin: Number(pctDisiplin) };
    });

    // Urutkan default: yang paling banyak telat di paling atas
    rows.sort((a, b) => b.totalMenitTelat - a.totalMenitTelat || b.telatCount - a.telatCount);

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Tidak ada data pegawai yang sesuai.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((p, idx) => {
      let kepatuhanBadge = `<span class="badge-status badge-tepat">Sangat Baik</span>`;
      if (p.pctDisiplin < 85) {
        kepatuhanBadge = `<span class="badge-status badge-telat">Perlu Pembinaan</span>`;
      } else if (p.pctDisiplin < 95) {
        kepatuhanBadge = `<span class="badge-status badge-pulang-cepat">Cukup Baik</span>`;
      }

      const extraChips = [];
      if (p.lemburCount > 0) {
        extraChips.push(`<span class="weekend-day-tag" title="Lembur Sabtu/Minggu">🗓️ ${p.lemburCount} Lembur</span>`);
      }
      if (p.izinCount > 0) {
        extraChips.push(`<span class="badge-kepegawaian" style="background:#EFF6FF; color:#1E40AF;" title="Izin / Cuti / Sakit / Dinas Luar">📄 ${p.izinCount} Izin/Cuti/Sakit/Dinas</span>`);
      }

      return `
        <tr>
          <td style="text-align:center; color:var(--text-muted); font-weight:600;">${idx + 1}</td>
          <td>
            <div class="employee-cell">
              <span class="employee-name">${escapeHtml(p.nama_lengkap)}</span>
              <div class="employee-meta">
                <span>NIP: ${p.nip}</span>
                <span class="badge-kepegawaian">${escapeHtml(p.status_kepegawaian || 'PNS')}</span>
                ${extraChips.join(' ')}
              </div>
            </div>
          </td>
          <td style="font-size:0.82rem; color:var(--text-muted);">${escapeHtml(p.unit_kerja || '-')}</td>
          <td style="text-align:center; font-weight:700;">${p.totalHadir}</td>
          <td style="text-align:center; font-weight:700; color:var(--success-text);">${p.tepatCount}</td>
          <td style="text-align:center;">
            ${p.telatCount > 0 
              ? `<strong style="color:var(--danger-text);">${p.telatCount}x</strong> <small style="color:var(--text-muted);">(${p.totalMenitTelat} mnt)</small>` 
              : `<span style="color:var(--success-text);">0</span>`}
          </td>
          <td style="text-align:center;">
            <div style="font-weight:700; color:${p.pctDisiplin >= 95 ? 'var(--success-text)' : 'var(--danger-text)'};">${p.pctDisiplin}%</div>
          </td>
          <td style="text-align:center;">${kepatuhanBadge}</td>
        </tr>
      `;
    }).join('');
  }

  // --- TAB 3: REKAPITULASI PER PROGRAM STUDI ---
  function renderProdiRekapTable(allEvaluated) {
    const tbody = document.getElementById('table-body-prodi');
    if (!tbody) return;

    // Grouping by unit
    const unitsMap = new Map();

    state.pegawaiList.forEach(p => {
      const u = p.unit_kerja || 'Lainnya';
      if (!unitsMap.has(u)) {
        unitsMap.set(u, {
          unit: u,
          totalPegawai: 0,
          totalHadir: 0,
          tepatCount: 0,
          telatCount: 0,
          totalMenitTelat: 0,
          pulangCepatCount: 0
        });
      }
      unitsMap.get(u).totalPegawai++;
    });

    allEvaluated.forEach(r => {
      const u = r.unit_kerja || 'Lainnya';
      if (unitsMap.has(u)) {
        const item = unitsMap.get(u);
        if (r.status_kehadiran === 'Hadir') {
          item.totalHadir++;
          if (r.isTerlambat) {
            item.telatCount++;
            item.totalMenitTelat += r.menitTerlambat;
          } else {
            item.tepatCount++;
          }
          if (r.isPulangCepat) {
            item.pulangCepatCount++;
          }
        }
      }
    });

    const prodiList = Array.from(unitsMap.values());
    prodiList.forEach(p => {
      p.pctDisiplin = p.totalHadir > 0 ? ((p.tepatCount / p.totalHadir) * 100).toFixed(1) : 100;
    });

    // Urutkan berdasarkan kepatuhan disiplin tertinggi
    prodiList.sort((a, b) => b.pctDisiplin - a.pctDisiplin);

    tbody.innerHTML = prodiList.map((p, idx) => {
      return `
        <tr>
          <td style="text-align:center; font-weight:600; color:var(--text-muted);">${idx + 1}</td>
          <td><strong>${escapeHtml(p.unit)}</strong></td>
          <td style="text-align:center; font-weight:700;">${p.totalPegawai}</td>
          <td style="text-align:center;">${p.totalHadir}</td>
          <td style="text-align:center; color:var(--success-text); font-weight:700;">${p.tepatCount}</td>
          <td style="text-align:center; color:${p.telatCount > 0 ? 'var(--danger-text)' : 'inherit'}; font-weight:700;">
            ${p.telatCount} (${p.totalMenitTelat} menit)
          </td>
          <td style="text-align:center; font-weight:800; color:${p.pctDisiplin >= 95 ? 'var(--success-text)' : 'var(--danger-text)'};">
            ${p.pctDisiplin}%
          </td>
        </tr>
      `;
    }).join('');
  }

  // ==========================================================================
  // EVENT BINDINGS
  // ==========================================================================
  function bindEvents() {
    // 1. Batas Jam Masuk & Pulang Input Handlers
    const elMasuk = document.getElementById('input-jam-masuk');
    const elToleransi = document.getElementById('input-toleransi');
    const elPulang = document.getElementById('input-jam-pulang');
    const elPulangJumat = document.getElementById('input-jam-pulang-jumat');

    if (elMasuk) {
      elMasuk.addEventListener('change', (e) => {
        state.config.jamMasuk = e.target.value || '08:30';
        state.config.preset = 'custom';
        saveConfig();
        syncConfigUI();
        evaluateAndRender();
        showToast(`Batas datang terlambat diperbarui menjadi ${state.config.jamMasuk} WIB`);
      });
    }

    if (elToleransi) {
      elToleransi.addEventListener('change', (e) => {
        state.config.toleransi = parseInt(e.target.value, 10) || 0;
        state.config.preset = 'custom';
        saveConfig();
        syncConfigUI();
        evaluateAndRender();
        showToast(`Toleransi keterlambatan diubah menjadi ${state.config.toleransi} menit`);
      });
    }

    if (elPulang) {
      elPulang.addEventListener('change', (e) => {
        state.config.jamPulang = e.target.value || '16:30';
        state.config.preset = 'custom';
        saveConfig();
        syncConfigUI();
        evaluateAndRender();
        showToast(`Batas kepulangan diperbarui menjadi ${state.config.jamPulang} WIB`);
      });
    }

    if (elPulangJumat) {
      elPulangJumat.addEventListener('change', (e) => {
        state.config.jamPulangJumat = e.target.value || '16:30';
        state.config.preset = 'custom';
        saveConfig();
        syncConfigUI();
        evaluateAndRender();
        showToast(`Batas kepulangan hari Jumat diperbarui: ${state.config.jamPulangJumat} WIB`);
      });
    }

    // 2. Tolerance Chip Clicks
    document.querySelectorAll('.tolerance-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const m = parseInt(chip.getAttribute('data-minutes'), 10);
        state.config.toleransi = m;
        state.config.preset = 'custom';
        saveConfig();
        syncConfigUI();
        evaluateAndRender();
        showToast(`Toleransi diatur ke ${m} menit`);
      });
    });

    // 3. Preset Buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-preset');
        applyPreset(p);
      });
    });

    // 3.5. Basis Data Periode Buttons (Delegated agar mendukung bulan baru hasil Import)
    const periodGroupEl = document.getElementById('period-filter-group');
    if (periodGroupEl) {
      periodGroupEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.period-btn');
        if (!btn) return;
        const period = btn.getAttribute('data-period') || 'all';
        periodGroupEl.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.filters.bulan = (period === 'all' ? '' : period);
        state.pagination.currentPage = 1;
        evaluateAndRender();
        const totalNow = state.absensiList.length.toLocaleString('id-ID');
        const periodCount = state.absensiList.filter(a => a.tanggal && a.tanggal.startsWith(period)).length.toLocaleString('id-ID');
        showToast(period === 'all'
          ? `Menampilkan semua periode (${totalNow} data presensi live tersinkron)`
          : `Menampilkan data presensi periode ${formatPeriodLabel(period)} (${periodCount} data live)`);
      });
    }

    // 4. View Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentTab = btn.getAttribute('data-tab');

        // Toggle table containers
        document.getElementById('view-harian').style.display = state.currentTab === 'harian' ? 'block' : 'none';
        document.getElementById('view-pegawai').style.display = state.currentTab === 'pegawai' ? 'block' : 'none';
        document.getElementById('view-prodi').style.display = state.currentTab === 'prodi' ? 'block' : 'none';

        // Adjust toolbar filters
        const elStatusFilter = document.getElementById('quick-status-group');
        const elActionGroup = document.querySelector('.filter-action-group');
        const elDrawer = document.getElementById('advanced-filter-drawer');
        const elSummary = document.getElementById('filter-summary-bar');
        const elSection = document.getElementById('filter-dashboard-section');

        if (state.currentTab === 'harian') {
          if (elSection) elSection.style.display = 'flex';
          if (elStatusFilter) elStatusFilter.style.display = 'flex';
          if (elActionGroup) elActionGroup.style.display = 'flex';
          if (elDrawer) elDrawer.style.display = '';
          if (elSummary) elSummary.style.display = 'flex';
        } else if (state.currentTab === 'pegawai') {
          if (elSection) elSection.style.display = 'flex';
          if (elStatusFilter) elStatusFilter.style.display = 'none';
          if (elActionGroup) elActionGroup.style.display = 'none';
          if (elDrawer) elDrawer.style.display = 'none';
          if (elSummary) elSummary.style.display = 'none';
        } else {
          if (elSection) elSection.style.display = 'none';
        }

        evaluateAndRender();
      });
    });

    // 5. Search Input & Clear Search
    const elSearch = document.getElementById('filter-search');
    const btnClearSearch = document.getElementById('btn-clear-search');

    if (elSearch) {
      elSearch.addEventListener('input', debounce((e) => {
        state.filters.search = e.target.value.trim();
        state.pagination.currentPage = 1;
        evaluateAndRender();
      }, 200));
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        clearFilterItem('search');
      });
    }

    // 6. Filter Program Studi / Unit
    const elUnit = document.getElementById('filter-unit');
    if (elUnit) {
      elUnit.addEventListener('change', (e) => {
        state.filters.unit = e.target.value;
        state.pagination.currentPage = 1;
        evaluateAndRender();
      });
    }

    // 7. Filter Status Kepegawaian (PNS / PPPK / Non-PNS)
    const elKepeg = document.getElementById('filter-kepegawaian');
    if (elKepeg) {
      elKepeg.addEventListener('change', (e) => {
        state.filters.kepegawaian = e.target.value;
        state.pagination.currentPage = 1;
        evaluateAndRender();
      });
    }

    // 8. Filter Tanggal Spesifik
    const elDate = document.getElementById('filter-date');
    if (elDate) {
      elDate.addEventListener('change', (e) => {
        state.filters.date = e.target.value;
        if (state.filters.date) {
          // Kosongkan rentang tanggal jika tanggal spesifik dipilih
          state.filters.dateStart = '';
          state.filters.dateEnd = '';
          const elStart = document.getElementById('filter-date-start');
          const elEnd = document.getElementById('filter-date-end');
          if (elStart) elStart.value = '';
          if (elEnd) elEnd.value = '';
        }
        state.pagination.currentPage = 1;
        evaluateAndRender();
      });
    }

    // 9. Filter Rentang Tanggal (Date Range)
    const elDateStart = document.getElementById('filter-date-start');
    const elDateEnd = document.getElementById('filter-date-end');
    const btnClearDateRange = document.getElementById('btn-clear-date-range');

    if (elDateStart) {
      elDateStart.addEventListener('change', (e) => {
        state.filters.dateStart = e.target.value;
        if (state.filters.dateStart) {
          state.filters.date = '';
          if (elDate) elDate.value = '';
        }
        state.pagination.currentPage = 1;
        evaluateAndRender();
      });
    }

    if (elDateEnd) {
      elDateEnd.addEventListener('change', (e) => {
        state.filters.dateEnd = e.target.value;
        if (state.filters.dateEnd) {
          state.filters.date = '';
          if (elDate) elDate.value = '';
        }
        state.pagination.currentPage = 1;
        evaluateAndRender();
      });
    }

    if (btnClearDateRange) {
      btnClearDateRange.addEventListener('click', () => {
        clearFilterItem('dateRange');
      });
    }

    // 10. Filter Durasi Telat
    const elDurasi = document.getElementById('filter-durasi-telat');
    if (elDurasi) {
      elDurasi.addEventListener('change', (e) => {
        state.filters.durasiTelat = e.target.value;
        state.pagination.currentPage = 1;
        evaluateAndRender();
      });
    }

    // 11. Filter Pengurutan Data (Sort)
    const elSort = document.getElementById('filter-sort');
    if (elSort) {
      elSort.addEventListener('change', (e) => {
        state.filters.sort = e.target.value;
        state.liveHighlights.clear(); // Kembalikan ke urutan murni saat pengguna memilih sort eksplisit
        evaluateAndRender();
      });
    }

    // 12. Jumlah Baris per Halaman (Page Size)
    const elPageSize = document.getElementById('filter-page-size');
    if (elPageSize) {
      elPageSize.addEventListener('change', (e) => {
        state.pagination.pageSize = parseInt(e.target.value, 10) || 25;
        state.pagination.currentPage = 1;
        evaluateAndRender();
      });
    }

    // 13. Quick Status Filter Pills
    document.querySelectorAll('.status-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.status-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.filters.status = btn.getAttribute('data-status');
        state.pagination.currentPage = 1;
        evaluateAndRender();
      });
    });

    // 14. Toggle Drawer Filter Lanjutan
    const btnToggleAdvanced = document.getElementById('btn-toggle-advanced-filter');
    const advancedDrawer = document.getElementById('advanced-filter-drawer');
    if (btnToggleAdvanced && advancedDrawer) {
      btnToggleAdvanced.addEventListener('click', () => {
        advancedDrawer.classList.toggle('collapsed');
        const isCollapsed = advancedDrawer.classList.contains('collapsed');
        btnToggleAdvanced.classList.toggle('active', !isCollapsed);
      });
    }

    // 15. Reset Semua Filter
    const btnResetFilter = document.getElementById('btn-reset-filter');
    if (btnResetFilter) {
      btnResetFilter.addEventListener('click', resetFilters);
    }

    // Pagination buttons
    const btnPrev = document.getElementById('btn-page-prev');
    const btnNext = document.getElementById('btn-page-next');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (state.pagination.currentPage > 1) {
          state.pagination.currentPage--;
          evaluateAndRender();
        }
      });
    }
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        state.pagination.currentPage++;
        evaluateAndRender();
      });
    }

    // Form Tambah Presensi & Reaktivitas Tanggal Sabtu-Minggu / Status Tanpa Jam
    const formTambah = document.getElementById('form-tambah-presensi');
    if (formTambah) {
      formTambah.addEventListener('submit', handleTambahPresensi);
    }

    const elTambahTanggal = document.getElementById('modal-tambah-tanggal');
    const elTambahStatus = document.getElementById('modal-tambah-status');
    if (elTambahTanggal) {
      elTambahTanggal.addEventListener('change', () => syncModalTimeFields('tambah', 'date'));
    }
    if (elTambahStatus) {
      elTambahStatus.addEventListener('change', () => syncModalTimeFields('tambah', 'status'));
    }

    // Form Edit Presensi & Reaktivitas Status Tanpa Jam
    const formEdit = document.getElementById('form-edit-presensi');
    if (formEdit) {
      formEdit.addEventListener('submit', handleSaveEditPresensi);
    }

    const elEditStatus = document.getElementById('modal-edit-status');
    if (elEditStatus) {
      elEditStatus.addEventListener('change', () => syncModalTimeFields('edit', 'status'));
    }

    // Tutup modal aktif dengan tombol Escape (Aksesibilitas Keyboard)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
      }
    });
  }

  function applyPreset(presetName) {
    if (presetName === 'fhisip') {
      state.config = {
        jamMasuk: '08:30',
        toleransi: 0,
        jamPulang: '16:30',
        jamPulangJumat: '16:30',
        preset: 'fhisip'
      };
      showToast('Menerapkan Kebijakan Resmi FHISIP UT (Masuk 08:30 & Pulang 16:30)');
    } else if (presetName === 'ut-pusat') {
      state.config = {
        jamMasuk: '08:00',
        toleransi: 0,
        jamPulang: '16:30',
        jamPulangJumat: '16:30',
        preset: 'ut-pusat'
      };
      showToast('Menerapkan Standar UT Pusat (Masuk 08:00 & Pulang 16:30)');
    } else if (presetName === 'toleransi-15') {
      state.config = {
        jamMasuk: '08:30',
        toleransi: 15,
        jamPulang: '16:30',
        jamPulangJumat: '16:30',
        preset: 'toleransi-15'
      };
      showToast('Menerapkan Dispensasi Toleransi +15 Menit');
    }

    saveConfig();
    syncConfigUI();
    evaluateAndRender();
  }

  // ==========================================================================
  // CRUD OPERATIONS: MENGATUR DATA PEGAWAI & PRESENSI
  // ==========================================================================
  function syncModalTimeFields(mode = 'tambah', triggerSource = 'open') {
    const isTambah = mode === 'tambah';
    const elTanggal = document.getElementById(isTambah ? 'modal-tambah-tanggal' : 'modal-edit-tanggal');
    const elStatus = document.getElementById(isTambah ? 'modal-tambah-status' : 'modal-edit-status');
    const elRowJam = document.getElementById(isTambah ? 'row-jam-tambah' : 'row-jam-edit');
    const elMasuk = document.getElementById(isTambah ? 'modal-tambah-masuk' : 'modal-edit-masuk');
    const elPulang = document.getElementById(isTambah ? 'modal-tambah-pulang' : 'modal-edit-pulang');
    const elNotice = document.getElementById(isTambah ? 'notice-no-jam-tambah' : 'notice-no-jam-edit');

    if (!elStatus) return;

    const tanggalVal = elTanggal ? elTanggal.value : '';
    const weekend = isWeekendDate(tanggalVal);
    const optHadir = elStatus.querySelector('option[value="Hadir"]');

    if (weekend) {
      if (optHadir) {
        optHadir.disabled = true;
        optHadir.textContent = 'Hadir (Tidak berlaku di Sabtu/Minggu — Otomatis Lembur)';
      }
      if (elStatus.value === 'Hadir' || !elStatus.value) {
        elStatus.value = 'Lembur';
        if (isTambah) state.autoSetLemburTambah = true;
      }
    } else {
      if (optHadir) {
        optHadir.disabled = false;
        optHadir.textContent = 'Hadir (Hari Kerja — Evaluasi Jam Masuk/Pulang)';
      }
      if (isTambah && triggerSource === 'date' && state.autoSetLemburTambah && elStatus.value === 'Lembur') {
        elStatus.value = 'Hadir';
        state.autoSetLemburTambah = false;
      } else if (isTambah && triggerSource === 'status') {
        state.autoSetLemburTambah = false;
      }
    }

    const statusVal = normalizeStatusValue(elStatus.value);
    const hideTime = weekend || isNonTimedStatus(statusVal);

    if (hideTime) {
      if (elRowJam) elRowJam.style.display = 'none';
      if (elMasuk) elMasuk.value = '';
      if (elPulang) elPulang.value = '';

      if (elNotice) {
        elNotice.style.display = 'flex';
        if (statusVal === 'Lembur' && weekend) {
          const wkDay = getWeekendDayName(tanggalVal);
          elNotice.className = 'no-time-notice';
          elNotice.innerHTML = `<span>🗓️</span><div><strong>Lembur Akhir Pekan (${escapeHtml(wkDay)}) — Tidak Ada Jam</strong><br>Hari Sabtu &amp; Minggu tercatat otomatis sebagai <strong>Lembur</strong> tanpa jam masuk maupun jam pulang.</div>`;
        } else if (statusVal === 'Lembur') {
          elNotice.className = 'no-time-notice';
          elNotice.innerHTML = `<span>🗓️</span><div><strong>Status Lembur — Tidak Ada Jam</strong><br>Data lembur dicatat tanpa jam masuk &amp; jam pulang serta tidak dievaluasi sebagai terlambat/pulang cepat.</div>`;
        } else {
          elNotice.className = 'no-time-notice notice-izin';
          elNotice.innerHTML = `<span>📄</span><div><strong>Status ${escapeHtml(statusVal)} — Tidak Ada Jam</strong><br>Status <strong>${escapeHtml(statusVal)}</strong> disimpan tanpa jam masuk &amp; jam pulang (otomatis kosong).</div>`;
        }
      }
    } else {
      if (elRowJam) elRowJam.style.display = 'grid';
      if (elNotice) elNotice.style.display = 'none';
      if (isTambah && elMasuk && elPulang && !elMasuk.value && !elPulang.value) {
        elMasuk.value = '08:15';
        elPulang.value = '16:45';
      }
    }
  }

  function handleTambahPresensi(e) {
    e.preventDefault();
    const nip = document.getElementById('modal-tambah-pegawai').value;
    const tanggal = document.getElementById('modal-tambah-tanggal').value;
    const rawMasuk = document.getElementById('modal-tambah-masuk').value || null;
    const rawPulang = document.getElementById('modal-tambah-pulang').value || null;
    const rawStatus = document.getElementById('modal-tambah-status').value || 'Hadir';
    const rawKeterangan = document.getElementById('modal-tambah-keterangan').value || null;

    if (!nip || !tanggal) {
      alert('Silakan pilih pegawai dan tanggal presensi.');
      return;
    }

    const emp = state.pegawaiList.find(p => p.nip === nip) || {};
    const existingIdx = state.absensiList.findIndex(r => r.nip === nip && r.tanggal === tanggal);

    let targetRecord;
    let subAction = 'INSERT';

    if (existingIdx >= 0) {
      subAction = 'UPDATE';
      targetRecord = normalizeAttendanceRecord({
        ...state.absensiList[existingIdx],
        nama_lengkap: emp.nama_lengkap || state.absensiList[existingIdx].nama_lengkap || 'Pegawai',
        unit_kerja: emp.unit_kerja || state.absensiList[existingIdx].unit_kerja || '-',
        jam_masuk: rawMasuk,
        jam_pulang: rawPulang,
        status_kehadiran: rawStatus,
        keterangan: rawKeterangan
      });
      state.absensiList[existingIdx] = targetRecord;
    } else {
      targetRecord = normalizeAttendanceRecord({
        id: 'rec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        tanggal,
        nip,
        nama_lengkap: emp.nama_lengkap || 'Pegawai',
        unit_kerja: emp.unit_kerja || '-',
        jam_masuk: rawMasuk,
        jam_pulang: rawPulang,
        status_kehadiran: rawStatus,
        keterangan: rawKeterangan
      });
      state.absensiList.unshift(targetRecord);
    }

    state.liveHighlights.set(`${nip}|${tanggal}`, {
      seq: ++state.liveSeqCounter,
      actorName: 'Anda',
      label: subAction === 'INSERT' ? '✨ Baru Ditambahkan' : '✨ Baru Diperbarui',
      timestamp: Date.now()
    });
    state.pagination.currentPage = 1;

    saveAbsensi(true);
    populateDateDropdown();
    closeModal('modal-tambah');
    evaluateAndRender();
    showToast(
      subAction === 'INSERT'
        ? `Presensi ${targetRecord.status_kehadiran} untuk ${emp.nama_lengkap} (${tanggal}) berhasil ditambahkan & disiarkan live!`
        : `Presensi ${targetRecord.status_kehadiran} ${emp.nama_lengkap} (${tanggal}) berhasil diperbarui & disiarkan live!`,
      'success'
    );

    if (window.supabaseSync && typeof window.supabaseSync.updateRecordInCloud === 'function') {
      window.supabaseSync.updateRecordInCloud(targetRecord, subAction).catch(() => {});
    }
  }

  function openEditModal(recordId) {
    const rec = state.absensiList.find(r => String(r.id) === String(recordId));
    if (!rec) {
      showToast('Data presensi tidak ditemukan.', 'warning');
      return;
    }

    const normRec = normalizeAttendanceRecord(rec);
    state.editingRecordId = rec.id;

    const elPegawai = document.getElementById('modal-edit-pegawai');
    const elTanggal = document.getElementById('modal-edit-tanggal');
    const elMasuk = document.getElementById('modal-edit-masuk');
    const elPulang = document.getElementById('modal-edit-pulang');
    const elStatus = document.getElementById('modal-edit-status');
    const elKet = document.getElementById('modal-edit-keterangan');

    if (elPegawai) elPegawai.value = `${normRec.nama_lengkap} (${normRec.nip})`;
    if (elTanggal) elTanggal.value = normRec.tanggal;
    if (elStatus) elStatus.value = normRec.status_kehadiran || 'Hadir';
    if (elMasuk) elMasuk.value = normRec.jam_masuk || '';
    if (elPulang) elPulang.value = normRec.jam_pulang || '';
    if (elKet) elKet.value = normRec.keterangan || '';

    syncModalTimeFields('edit', 'open');
    openModal('modal-edit');
  }

  function handleSaveEditPresensi(e) {
    e.preventDefault();
    if (!state.editingRecordId) return;

    const idx = state.absensiList.findIndex(r => String(r.id) === String(state.editingRecordId));
    if (idx < 0) {
      showToast('Data presensi tidak ditemukan saat menyimpan perubahan.', 'danger');
      return;
    }

    const prev = state.absensiList[idx];
    const updated = normalizeAttendanceRecord({
      ...prev,
      jam_masuk: document.getElementById('modal-edit-masuk').value || null,
      jam_pulang: document.getElementById('modal-edit-pulang').value || null,
      status_kehadiran: document.getElementById('modal-edit-status').value || 'Hadir',
      keterangan: document.getElementById('modal-edit-keterangan').value || null
    });

    state.absensiList[idx] = updated;

    saveAbsensi(true);
    closeModal('modal-edit');
    evaluateAndRender();
    showToast(`Perubahan presensi (${updated.status_kehadiran}) untuk ${updated.nama_lengkap} berhasil disimpan & disinkronkan live!`, 'success');

    if (window.supabaseSync && typeof window.supabaseSync.updateRecordInCloud === 'function') {
      window.supabaseSync.updateRecordInCloud(updated, 'UPDATE').catch(() => {});
    }
  }

  function deleteRecord(recordId) {
    const rec = state.absensiList.find(r => String(r.id) === String(recordId));
    if (!rec) {
      showToast('Data presensi tidak ditemukan.', 'warning');
      return;
    }

    if (confirm(`Apakah Anda yakin ingin menghapus data presensi ${rec.nama_lengkap} tanggal ${rec.tanggal}?`)) {
      state.absensiList = state.absensiList.filter(r => String(r.id) !== String(recordId));
      state.liveHighlights.delete(`${rec.nip}|${rec.tanggal}`);
      saveAbsensi(true);
      populateDateDropdown();

      // Penyesuaian pagination jika data terakhir di halaman terhapus
      const currentFiltered = state.lastFilteredRecords || [];
      const newFilteredTotal = Math.max(0, currentFiltered.length - 1);
      const totalPages = Math.ceil(newFilteredTotal / state.pagination.pageSize) || 1;
      if (state.pagination.currentPage > totalPages) {
        state.pagination.currentPage = totalPages;
      }

      evaluateAndRender();
      showToast(`Data presensi ${rec.nama_lengkap} (${rec.tanggal}) berhasil dihapus di semua perangkat.`, 'danger');

      if (window.supabaseSync && typeof window.supabaseSync.deleteRecordFromCloud === 'function') {
        window.supabaseSync.deleteRecordFromCloud(rec.nip, rec.tanggal, rec.nama_lengkap).catch(() => {});
      }
    }
  }

  async function resetToDefault() {
    if (confirm('Kembalikan seluruh data presensi ke database resmi FHISIP UT (September & Oktober)? Perubahan ini juga akan mereset data di Cloud agar semua perangkat selaras.')) {
      const initial = window.INITIAL_FHISIP_DATA || { pegawai: [], absensi: [] };
      state.liveHighlights.clear();
      const normalizedInitial = (initial.absensi ? [...initial.absensi] : []).map(normalizeAttendanceRecord);
      if (window.StorageManager) {
        state.absensiList = await window.StorageManager.resetToDefault(normalizedInitial, DEFAULT_CONFIG);
      } else {
        localStorage.removeItem(STORAGE_KEY_ABSENSI);
        localStorage.removeItem(STORAGE_KEY_CONFIG);
        state.absensiList = normalizedInitial;
      }
      loadConfig();
      populateDateDropdown();
      evaluateAndRender();
      showToast('Data dan konfigurasi berhasil dikembalikan ke database master FHISIP UT.', 'success');

      if (window.supabaseSync && typeof window.supabaseSync.replaceAllInCloud === 'function') {
        window.supabaseSync.replaceAllInCloud(state.absensiList, { isReset: true }).catch(() => {});
        if (typeof window.supabaseSync.syncConfigToCloud === 'function') {
          window.supabaseSync.syncConfigToCloud(DEFAULT_CONFIG).catch(() => {});
        }
      }
    }
  }

  // ==========================================================================
  // EXPORT & PRINT
  // ==========================================================================
  function exportToCsv(useFiltered = false) {
    let recordsToExport = [];
    if (useFiltered) {
      recordsToExport = state.lastFilteredRecords || [];
      if (recordsToExport.length === 0) {
        showToast('Tidak ada data presensi yang sesuai filter saat ini untuk diekspor ke CSV.', 'warning');
        return;
      }
    } else {
      recordsToExport = state.absensiList
        .map(evaluateRecord)
        .sort((a, b) =>
          (b.tanggal || '').localeCompare(a.tanggal || '') ||
          (a.nama_lengkap || '').localeCompare(b.nama_lengkap || '', 'id')
        );
    }

    // Header CSV resmi lengkap Status Kehadiran & Evaluasi Disiplin
    const headers = [
      'No',
      'Tanggal',
      'NIP',
      'Nama Pegawai',
      'Status Kepegawaian',
      'Unit Kerja',
      'Jam Datang',
      'Batas Datang',
      'Terlambat (Menit)',
      'Jam Pulang',
      'Batas Pulang',
      'Status Kehadiran',
      'Status Disiplin',
      'Keterangan'
    ];

    const rows = recordsToExport.map((r, i) => {
      const emp = state.pegawaiList.find(p => p.nip === r.nip) || {};
      const isFriday = getDayOfWeek(r.tanggal) === 5;
      const batasPulangRow = isFriday ? state.config.jamPulangJumat : state.config.jamPulang;
      return [
        i + 1,
        r.tanggal,
        `'${r.nip}`, // Tanda petik agar digit NIP aman di Excel
        `"${(r.nama_lengkap || emp.nama_lengkap || '').replace(/"/g, '""')}"`,
        `"${(emp.status_kepegawaian || 'Pegawai').replace(/"/g, '""')}"`,
        `"${(r.unit_kerja || emp.unit_kerja || '').replace(/"/g, '""')}"`,
        r.isNonTimed ? '-' : (r.jam_masuk || '-'),
        r.isNonTimed ? '-' : state.config.jamMasuk,
        r.isNonTimed ? 0 : (r.menitTerlambat || 0),
        r.isNonTimed ? '-' : (r.jam_pulang || '-'),
        r.isNonTimed ? '-' : batasPulangRow,
        `"${(r.status_kehadiran || 'Hadir').replace(/"/g, '""')}"`,
        `"${(r.statusLabel || '').replace(/"/g, '""')}"`,
        `"${(r.keterangan || '').replace(/"/g, '""')}"`
      ];
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const prefix = useFiltered ? 'Rekap_Presensi_Terfilter_FHISIP_UT' : 'Database_Presensi_Live_FHISIP_UT';
    link.setAttribute('download', `${prefix}_${state.config.jamMasuk.replace(':', '.')}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showToast(`File CSV ${useFiltered ? 'Hasil Filter' : 'Database Live Terpadu'} (${recordsToExport.length.toLocaleString('id-ID')} data) berhasil diunduh!`, 'success');
  }

  function printOfficialReport() {
    window.print();
  }

  // ==========================================================================
  // MODAL & UI HELPERS
  // ==========================================================================
  function openModal(modalId) {
    if (modalId === 'modal-tambah') {
      syncModalTimeFields('tambah', 'open');
    }
    const el = document.getElementById(modalId);
    if (el) el.classList.add('active');
  }

  function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('active');
  }

  function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>ℹ️</span> <div>${escapeHtml(message)}</div>`;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  function formatTanggalIndo(dateStr) {
    if (!dateStr) return '-';
    try {
      const parts = String(dateStr).trim().slice(0, 10).split('-').map(Number);
      const d = (parts.length === 3 && !parts.some(isNaN))
        ? new Date(parts[0], parts[1] - 1, parts[2])
        : new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('id-ID', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  function getPegawaiAggregations(evaluatedList = getEvaluatedForActivePeriod(), filterOpts = {}) {
    const rekapMap = new Map();
    const extraEmployees = new Map();
    const knownNips = new Set(state.pegawaiList.map(p => String(p.nip).trim()));

    evaluatedList.forEach(r => {
      if (!r || !r.nip) return;
      const nipKey = String(r.nip).trim();

      if (!knownNips.has(nipKey) && !extraEmployees.has(nipKey)) {
        extraEmployees.set(nipKey, {
          nip: nipKey,
          nama_lengkap: r.nama_lengkap || ('Pegawai ' + nipKey),
          status_kepegawaian: 'PNS',
          unit_kerja: r.unit_kerja || 'FHISIP'
        });
      }

      if (!rekapMap.has(nipKey)) {
        rekapMap.set(nipKey, {
          totalHadir: 0,
          tepatCount: 0,
          telatCount: 0,
          totalMenitTelat: 0,
          pulangCepatCount: 0,
          lemburCount: 0,
          izinCount: 0
        });
      }
      const agg = rekapMap.get(nipKey);
      if (r.isLembur) {
        agg.lemburCount++;
      } else if (r.isIzinCutiSakitDinas) {
        agg.izinCount++;
      } else if (r.status_kehadiran === 'Hadir') {
        agg.totalHadir++;
        if (r.isTerlambat) {
          agg.telatCount++;
          agg.totalMenitTelat += r.menitTerlambat;
        } else if (!r.isTanpaMasuk) {
          agg.tepatCount++;
        }
        if (r.isPulangCepat) {
          agg.pulangCepatCount++;
        }
      }
    });

    let pegawaiPool = [...state.pegawaiList, ...extraEmployees.values()];
    if (filterOpts.applyActiveFilters) {
      if (state.filters.search) {
        const q = state.filters.search.toLowerCase();
        pegawaiPool = pegawaiPool.filter(p =>
          (p.nama_lengkap || '').toLowerCase().includes(q) ||
          (p.nip || '').toLowerCase().includes(q) ||
          (p.unit_kerja || '').toLowerCase().includes(q)
        );
      }
      if (state.filters.unit) {
        pegawaiPool = pegawaiPool.filter(p => p.unit_kerja === state.filters.unit);
      }
      if (state.filters.kepegawaian) {
        pegawaiPool = pegawaiPool.filter(p => p.status_kepegawaian === state.filters.kepegawaian);
      }
    }

    const rows = pegawaiPool.map(p => {
      const agg = rekapMap.get(String(p.nip).trim()) || {
        totalHadir: 0,
        tepatCount: 0,
        telatCount: 0,
        totalMenitTelat: 0,
        pulangCepatCount: 0,
        lemburCount: 0,
        izinCount: 0
      };
      const pctDisiplin = agg.totalHadir > 0 ? ((agg.tepatCount / agg.totalHadir) * 100).toFixed(1) : 100;
      return { ...p, ...agg, pctDisiplin: Number(pctDisiplin) };
    });
    rows.sort((a, b) => b.totalMenitTelat - a.totalMenitTelat || b.telatCount - a.telatCount);
    return rows;
  }

  // ==========================================================================
  // LIVE MULTI-DEVICE & MULTI-TAB SYNCHRONIZATION HANDLERS
  // ==========================================================================
  function computeDatasetSignature(records) {
    if (!Array.isArray(records) || records.length === 0) return 'empty:0';
    const first = records[0];
    const mid = records[Math.floor(records.length / 2)];
    const last = records[records.length - 1];
    return [
      records.length,
      `${first.nip}|${first.tanggal}|${first.jam_masuk}|${first.jam_pulang}|${first.status_kehadiran}`,
      `${mid.nip}|${mid.tanggal}|${mid.jam_masuk}|${mid.jam_pulang}|${mid.status_kehadiran}`,
      `${last.nip}|${last.tanggal}|${last.jam_masuk}|${last.jam_pulang}|${last.status_kehadiran}`
    ].join('::');
  }

  function mergePegawaiList(remotePegawai) {
    if (!Array.isArray(remotePegawai) || remotePegawai.length === 0) return;
    const existingMap = new Map(state.pegawaiList.map(p => [String(p.nip).trim(), p]));
    let addedCount = 0;

    remotePegawai.forEach(rp => {
      if (!rp || !rp.nip) return;
      const nip = String(rp.nip).trim();
      if (!existingMap.has(nip)) {
        state.pegawaiList.push(rp);
        existingMap.set(nip, rp);
        addedCount++;
      }
    });

    if (addedCount > 0) {
      populateUnitDropdown();
      populatePegawaiSelect();
    }
  }

  function applyRemoteRecordUpsert(record, actor = {}, subAction = 'UPDATE') {
    if (!record || !record.nip || !record.tanggal) return 'ignored';

    // Pastikan pegawai baru ikut masuk daftar pegawai lokal
    if (!state.pegawaiList.some(p => p.nip === record.nip)) {
      mergePegawaiList([{
        nip: record.nip,
        nama_lengkap: record.nama_lengkap || ('Pegawai ' + record.nip),
        status_kepegawaian: 'PNS',
        unit_kerja: record.unit_kerja || 'FHISIP'
      }]);
    }

    const emp = state.pegawaiList.find(p => p.nip === record.nip) || {};
    const enriched = normalizeAttendanceRecord({
      ...record,
      nama_lengkap: record.nama_lengkap || emp.nama_lengkap || 'Pegawai',
      unit_kerja: record.unit_kerja || emp.unit_kerja || 'FHISIP'
    });

    const existingIdx = state.absensiList.findIndex(
      r => (r.nip === enriched.nip && r.tanggal === enriched.tanggal) ||
           (record.id && String(r.id) === String(record.id))
    );

    let outcome = 'updated';
    if (existingIdx >= 0) {
      state.absensiList[existingIdx] = normalizeAttendanceRecord({
        ...state.absensiList[existingIdx],
        ...enriched
      });
    } else {
      state.absensiList.unshift(enriched);
      outcome = 'inserted';
    }

    const actorName = actor && actor.name ? actor.name : 'Pengguna Lain';
    state.liveHighlights.set(`${enriched.nip}|${enriched.tanggal}`, {
      seq: ++state.liveSeqCounter,
      actorName,
      label: outcome === 'inserted' ? `⚡ Live Baru (${actorName.split(' ')[0]})` : `⚡ Diperbarui (${actorName.split(' ')[0]})`,
      timestamp: Date.now()
    });

    saveAbsensi(true, { skipServerPush: true, silentBadge: true });
    populateDateDropdown();
    evaluateAndRender();

    const actionWord = (outcome === 'inserted' || subAction === 'INSERT') ? 'menambahkan' : 'memperbarui';
    showToast(
      `⚡ Live Update: ${actorName} ${actionWord} presensi ${enriched.nama_lengkap} (${formatTanggalIndo(enriched.tanggal)})`,
      'success'
    );
    return outcome;
  }

  function applyRemoteRecordDelete(nip, tanggal, namaLengkap = '', actor = {}) {
    if (!nip || !tanggal) return;
    const prevLen = state.absensiList.length;
    const found = state.absensiList.find(r => r.nip === nip && r.tanggal === tanggal);
    state.absensiList = state.absensiList.filter(r => !(r.nip === nip && r.tanggal === tanggal));
    state.liveHighlights.delete(`${nip}|${tanggal}`);

    if (state.absensiList.length !== prevLen) {
      saveAbsensi(true, { skipServerPush: true, silentBadge: true });
      populateDateDropdown();
      evaluateAndRender();

      const actorName = actor && actor.name ? actor.name : 'Pengguna Lain';
      const displayNama = namaLengkap || (found && found.nama_lengkap) || nip;
      showToast(`⚡ Live Update: ${actorName} menghapus presensi ${displayNama} (${formatTanggalIndo(tanggal)})`, 'warning');
    }
  }

  function applyRemoteDataset(records, actor = null, toastMessage = null, opts = {}) {
    if (!Array.isArray(records)) return;

    const normalizedRecords = records.map(normalizeAttendanceRecord);
    const currentSig = computeDatasetSignature(state.absensiList);
    const nextSig = computeDatasetSignature(normalizedRecords);

    if (currentSig === nextSig && state.absensiList.length === normalizedRecords.length) {
      return; // Data sudah identik, hemat re-render DOM
    }

    state.absensiList = normalizedRecords;
    saveAbsensi(true, { skipServerPush: true, silentBadge: true });
    populateDateDropdown();
    evaluateAndRender();

    if (!opts.silent && toastMessage) {
      showToast(toastMessage, 'info');
    }
  }

  function applyRemoteConfigUpdate(newCfg, actor = null, opts = {}) {
    if (!newCfg) return;
    const changed =
      (newCfg.jamMasuk && newCfg.jamMasuk !== state.config.jamMasuk) ||
      (newCfg.toleransi !== undefined && Number(newCfg.toleransi) !== Number(state.config.toleransi)) ||
      (newCfg.jamPulang && newCfg.jamPulang !== state.config.jamPulang) ||
      (newCfg.jamPulangJumat && newCfg.jamPulangJumat !== state.config.jamPulangJumat);

    if (!changed) return;

    state.config = {
      ...state.config,
      jamMasuk: newCfg.jamMasuk || state.config.jamMasuk,
      toleransi: newCfg.toleransi !== undefined ? Number(newCfg.toleransi) : state.config.toleransi,
      jamPulang: newCfg.jamPulang || state.config.jamPulang,
      jamPulangJumat: newCfg.jamPulangJumat || state.config.jamPulangJumat,
      preset: newCfg.preset || 'custom'
    };

    saveConfig({ skipCloud: true });
    syncConfigUI();
    evaluateAndRender();

    if (!opts.silent) {
      const actorName = actor && actor.name ? actor.name : 'Administrator';
      showToast(`⚡ Live Kebijakan: ${actorName} memperbarui batas jam kerja (${state.config.jamMasuk} - ${state.config.jamPulang})`, 'info');
    }
  }

  function initMultiTabSync() {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const channel = new BroadcastChannel('ut_fhisip_sync_channel');
        channel.onmessage = (event) => {
          if (!event.data) return;
          if (window.StorageManager && event.data.clientId && event.data.clientId === window.StorageManager.CLIENT_ID) {
            return;
          }

          if (event.data.type === 'DATA_UPDATED' || event.data.type === 'DATA_RESET') {
            const syncRecords = window.StorageManager && window.StorageManager.KEYS
              ? localStorage.getItem(window.StorageManager.KEYS.ABSENSI)
              : null;
            if (syncRecords) {
              try {
                const parsed = JSON.parse(syncRecords);
                if (Array.isArray(parsed)) {
                  const normalizedParsed = parsed.map(normalizeAttendanceRecord);
                  const sigBefore = computeDatasetSignature(state.absensiList);
                  const sigAfter = computeDatasetSignature(normalizedParsed);
                  if (sigBefore !== sigAfter) {
                    state.absensiList = normalizedParsed;
                    populateDateDropdown();
                    evaluateAndRender();
                  }
                }
              } catch (_) {}
            }
          } else if (event.data.type === 'CONFIG_UPDATED' && event.data.config) {
            applyRemoteConfigUpdate(event.data.config, null, { silent: true });
          }
        };
      } catch (e) {}
    }
  }

  // --- EXPOSE TO GLOBAL WINDOW ---
  window.app = {
    init,
    openModal,
    closeModal,
    openEditModal,
    deleteRecord,
    resetToDefault,
    exportToCsv: (useFiltered = false) => exportToCsv(useFiltered),
    exportPdf: (mode, useFiltered = false) => window.pdfExport ? window.pdfExport.exportPdf(mode, useFiltered) : alert('Modul PDF belum termuat'),
    printOfficialReport,
    applyPreset,
    getPegawaiList: () => state.pegawaiList,
    getAbsensiList: () => state.absensiList,
    setAbsensiList: (list) => {
      state.absensiList = Array.isArray(list) ? list.map(normalizeAttendanceRecord) : [];
      saveAbsensi(true);
      populateDateDropdown();
    },
    isWeekendDate,
    isNonTimedStatus,
    normalizeStatusValue,
    normalizeAttendanceRecord,
    mergePegawaiList,
    applyRemoteRecordUpsert,
    applyRemoteRecordDelete,
    applyRemoteDataset,
    applyRemoteConfigUpdate,
    getConfig: () => ({ ...state.config }),
    getActiveFilterState: () => ({ ...state.filters }),
    formatPeriodLabel,
    getEvaluatedRecords: () => state.absensiList.map(evaluateRecord),
    getEvaluatedForActivePeriod,
    getFilteredRecords: () => state.lastFilteredRecords || [],
    getPegawaiAggregations: (list, opts) => getPegawaiAggregations(list, opts),
    exportLiveDatabaseXlsx: (ym = '') => {
      const menuExport = document.getElementById('menu-export');
      const menuData = document.getElementById('menu-data');
      if (menuExport && typeof menuExport.hidePopover === 'function') { try { menuExport.hidePopover(); } catch (_) {} }
      if (menuData && typeof menuData.hidePopover === 'function') { try { menuData.hidePopover(); } catch (_) {} }
      if (window.monthlyReportGenerator && typeof window.monthlyReportGenerator.exportLiveDatabaseXlsx === 'function') {
        window.monthlyReportGenerator.exportLiveDatabaseXlsx(ym);
      } else {
        alert('Modul Excel belum siap dimuat.');
      }
    },
    clearFilterItem,
    resetFilters,
    showToast,
    openDatabaseRefModal: () => openModal('modal-database-ref'),
    downloadMasterSeptember: () => {
      if (window.monthlyReportGenerator && typeof window.monthlyReportGenerator.exportLiveDatabaseXlsx === 'function') {
        window.monthlyReportGenerator.exportLiveDatabaseXlsx('2026-09');
      }
    },
    downloadTemplate: () => {
      const a = document.createElement('a');
      a.href = 'Template_Format_Presensi_FHISIP.xlsx';
      a.download = 'Template_Format_Presensi_FHISIP.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    evaluateAndRender
  };

  // Run on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
