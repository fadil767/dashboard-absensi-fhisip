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
    editingRecordId: null
  };

  // ==========================================================================
  // INITIALIZATION & DATA LOADING
  // ==========================================================================
  function init() {
    loadConfig();
    loadData();
    bindEvents();
    evaluateAndRender();
  }

  function loadConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (saved) {
        state.config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Gagal membaca konfigurasi dari localStorage:', e);
      state.config = { ...DEFAULT_CONFIG };
    }

    // Sync input fields with config
    syncConfigUI();
  }

  function saveConfig() {
    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(state.config));
    } catch (e) {
      console.warn('Gagal menyimpan konfigurasi ke localStorage:', e);
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
    const ruleSummary = `Batas Masuk: <strong>${state.config.jamMasuk} WIB</strong> ${state.config.toleransi > 0 ? `(+${state.config.toleransi}m toleransi)` : ''} | Batas Pulang: <strong>${state.config.jamPulang} WIB</strong> (Jumat: ${state.config.jamPulangJumat})`;
    const elHeaderPill = document.getElementById('header-policy-rule');
    if (elHeaderPill) elHeaderPill.innerHTML = ruleSummary;

    const elPrintRule = document.getElementById('print-rule-summary');
    if (elPrintRule) elPrintRule.innerHTML = ruleSummary;
  }

  function loadData() {
    const initial = window.INITIAL_FHISIP_DATA || { pegawai: [], absensi: [] };
    state.pegawaiList = initial.pegawai || [];

    try {
      const savedAbsensi = localStorage.getItem(STORAGE_KEY_ABSENSI);
      if (savedAbsensi) {
        const parsed = JSON.parse(savedAbsensi);
        if (Array.isArray(parsed) && parsed.length >= (initial.absensi ? initial.absensi.length : 3000)) {
          state.absensiList = parsed;
        } else {
          // If stored records are from older session with fewer rows, load full 3.098 dataset
          state.absensiList = initial.absensi ? [...initial.absensi] : [];
          saveAbsensi();
        }
      } else {
        state.absensiList = initial.absensi ? [...initial.absensi] : [];
        saveAbsensi();
      }
    } catch (e) {
      console.warn('Gagal membaca data absensi dari localStorage:', e);
      state.absensiList = initial.absensi ? [...initial.absensi] : [];
    }

    populateUnitDropdown();
    populateDateDropdown();
    populatePegawaiSelect();
  }

  function saveAbsensi() {
    try {
      localStorage.setItem(STORAGE_KEY_ABSENSI, JSON.stringify(state.absensiList));
    } catch (e) {
      console.warn('Gagal menyimpan data absensi ke localStorage:', e);
      if (e.name === 'QuotaExceededError' || e.code === 22 || e.number === -2147024882) {
        if (typeof showToast === 'function') {
          showToast('Kapasitas penyimpanan lokal browser hampir penuh (>5MB). Sangat disarankan sinkronisasi ke Supabase Cloud atau cadangkan berkas Excel.', 'warning');
        }
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
   */
  function evaluateRecord(record) {
    const configMasukMin = parseTimeToMinutes(state.config.jamMasuk);
    const toleransiMin = Number(state.config.toleransi) || 0;
    const batasMasukEfektif = configMasukMin + toleransiMin;

    // Tentukan batas pulang (perhatikan hari Jumat jika ada)
    const isFriday = record.tanggal ? new Date(record.tanggal).getDay() === 5 : false;
    const configPulangMin = parseTimeToMinutes(isFriday ? state.config.jamPulangJumat : state.config.jamPulang);

    const recordMasukMin = parseTimeToMinutes(record.jam_masuk);
    const recordPulangMin = parseTimeToMinutes(record.jam_pulang);

    let isTerlambat = false;
    let menitTerlambat = 0;
    let isPulangCepat = false;
    let menitPulangCepat = 0;
    let isTanpaPulang = false;
    let isTanpaMasuk = false;

    // Evaluasi jam masuk & kepulangan
    if (record.status_kehadiran && record.status_kehadiran !== 'Hadir') {
      // Dispensasi resmi (Dinas Luar, Izin, Cuti, Sakit dsb)
      isTerlambat = false;
      isPulangCepat = false;
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

    const isAnomali = isTerlambat || isPulangCepat || isTanpaPulang || isTanpaMasuk || (record.status_kehadiran === 'Alpha');

    // Label Status
    let statusLabel = 'Tepat Waktu';
    let statusBadgeClass = 'badge-tepat';

    if (record.status_kehadiran && record.status_kehadiran !== 'Hadir') {
      statusLabel = record.status_kehadiran;
      if (['Izin', 'Cuti', 'Dinas Luar', 'Tugas Belajar'].includes(record.status_kehadiran)) {
        statusBadgeClass = 'badge-izin';
      } else {
        statusBadgeClass = 'badge-alpha';
      }
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
      } else {
        statusLabel = 'Tepat Waktu';
        statusBadgeClass = 'badge-tepat';
      }
    }

    return {
      ...record,
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
  function evaluateAndRender() {
    // 1. Evaluasi seluruh data absensi dengan konfigurasi batas waktu aktif
    const evaluatedAll = state.absensiList.map(evaluateRecord);

    // Hitung live counter periode
    const septCount = state.absensiList.filter(a => a.tanggal && a.tanggal.startsWith('2026-09')).length;
    const octCount = state.absensiList.filter(a => a.tanggal && a.tanggal.startsWith('2026-10')).length;
    setText('count-period-all', state.absensiList.length.toLocaleString('id-ID'));
    setText('count-period-sept', septCount.toLocaleString('id-ID'));
    setText('count-period-oct', octCount.toLocaleString('id-ID'));

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
    let izinCount = 0;
    let tanpaPulangCount = 0;
    let anomaliCount = 0;

    records.forEach(r => {
      if (r.status_kehadiran && r.status_kehadiran !== 'Hadir') {
        izinCount++;
      } else {
        if (r.isTerlambat) {
          telatCount++;
          totalMenitTelat += r.menitTerlambat;
        } else {
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
        if (r.isTerlambat || (r.status_kehadiran && r.status_kehadiran !== 'Hadir')) return false;
      } else if (state.filters.status === 'pulang_cepat') {
        if (!r.isPulangCepat) return false;
      } else if (state.filters.status === 'tanpa_pulang') {
        if (!r.isTanpaPulang) return false;
      } else if (state.filters.status === 'anomali') {
        if (!r.isAnomali) return false;
      } else if (state.filters.status === 'izin') {
        if (r.status_kehadiran === 'Hadir') return false;
      }

      return true;
    });

    state.lastFilteredRecords = filtered;

    // 2. Sorting Multi-Opsi
    filtered.sort((a, b) => {
      switch (state.filters.sort) {
        case 'telat_desc':
          return b.menitTerlambat - a.menitTerlambat;
        case 'telat_asc':
          return a.menitTerlambat - b.menitTerlambat;
        case 'masuk_asc':
          return (a.jam_masuk || '99:99').localeCompare(b.jam_masuk || '99:99');
        case 'masuk_desc':
          return (b.jam_masuk || '00:00').localeCompare(a.jam_masuk || '00:00');
        case 'pulang_asc':
          return (a.jam_pulang || '99:99').localeCompare(b.jam_pulang || '99:99');
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
      const isLateRow = r.isTerlambat ? 'highlight-telat' : '';

      // Employee metadata
      const emp = state.pegawaiList.find(p => p.nip === r.nip) || {};
      const statusPns = emp.status_kepegawaian || 'Pegawai';

      // Jam Masuk Pill
      let masukPill = `<span class="time-pill">${r.jam_masuk || '-'}</span>`;
      if (r.isTerlambat) {
        masukPill = `<span class="time-pill time-danger">${r.jam_masuk} (+${r.menitTerlambat}m)</span>`;
      } else if (!r.jam_masuk && r.status_kehadiran === 'Hadir') {
        masukPill = `<span class="time-pill time-warning" title="Belum / tidak ada scan masuk">Kosong ⚠️</span>`;
      }

      // Jam Pulang Pill
      let pulangPill = `<span class="time-pill">${r.jam_pulang || '-'}</span>`;
      if (r.isPulangCepat) {
        pulangPill = `<span class="time-pill time-warning">${r.jam_pulang} (-${r.menitPulangCepat}m)</span>`;
      } else if (!r.jam_pulang && r.status_kehadiran === 'Hadir') {
        pulangPill = `<span class="time-pill" style="background:#FFFBEB; color:#B45309; border:1px solid #FDE68A;" title="Belum melakukan scan keluar">Belum Scan ⏳</span>`;
      }

      return `
        <tr class="${isLateRow}">
          <td style="color:var(--text-muted); font-weight:600; text-align:center; width:45px;">${rowNo}</td>
          <td style="white-space:nowrap;">
            <strong>${formatTanggalIndo(r.tanggal)}</strong>
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
              ${r.isTerlambat ? '⚠️ ' : (r.statusLabel === 'Tepat Waktu' ? '✓ ' : '')}${r.statusLabel}
            </span>
            ${r.keterangan ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${escapeHtml(r.keterangan)}</div>` : ''}
          </td>
          <td>
            <div class="table-actions">
              <button class="btn-table-action btn-action-edit" onclick="window.app.openEditModal(${r.id})" title="Edit Jam & Keterangan">
                ✏️ Edit
              </button>
              <button class="btn-table-action btn-action-delete" onclick="window.app.deleteRecord(${r.id})" title="Hapus Data">
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
        izin: '📄 Izin / Dinas'
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
          izinCount: 0
        });
      }
      const agg = rekapMap.get(r.nip);
      if (r.status_kehadiran && r.status_kehadiran !== 'Hadir') {
        agg.izinCount++;
      } else {
        agg.totalHadir++;
        if (r.isTerlambat) {
          agg.telatCount++;
          agg.totalMenitTelat += r.menitTerlambat;
        } else {
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

      return `
        <tr>
          <td style="text-align:center; color:var(--text-muted); font-weight:600;">${idx + 1}</td>
          <td>
            <div class="employee-cell">
              <span class="employee-name">${escapeHtml(p.nama_lengkap)}</span>
              <div class="employee-meta">
                <span>NIP: ${p.nip}</span>
                <span class="badge-kepegawaian">${escapeHtml(p.status_kepegawaian || 'PNS')}</span>
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

    // 3.5. Basis Data Periode Buttons
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const period = btn.getAttribute('data-period');
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.filters.bulan = (period === 'all' ? '' : period);
        state.pagination.currentPage = 1;
        evaluateAndRender();
        showToast(period === 'all' 
          ? 'Menampilkan semua periode (September & Oktober 2026 - 3.098 data)' 
          : `Menampilkan data presensi periode ${period === '2026-09' ? 'September 2026 (2.150 data)' : 'Oktober 2026 (948 data)'}`);
      });
    });

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

    // Form Tambah Presensi
    const formTambah = document.getElementById('form-tambah-presensi');
    if (formTambah) {
      formTambah.addEventListener('submit', handleTambahPresensi);
    }

    // Form Edit Presensi
    const formEdit = document.getElementById('form-edit-presensi');
    if (formEdit) {
      formEdit.addEventListener('submit', handleSaveEditPresensi);
    }
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
  function handleTambahPresensi(e) {
    e.preventDefault();
    const nip = document.getElementById('modal-tambah-pegawai').value;
    const tanggal = document.getElementById('modal-tambah-tanggal').value;
    const jamMasuk = document.getElementById('modal-tambah-masuk').value || null;
    const jamPulang = document.getElementById('modal-tambah-pulang').value || null;
    const status = document.getElementById('modal-tambah-status').value || 'Hadir';
    const keterangan = document.getElementById('modal-tambah-keterangan').value || null;

    if (!nip || !tanggal) {
      alert('Silakan pilih pegawai dan tanggal presensi.');
      return;
    }

    const emp = state.pegawaiList.find(p => p.nip === nip) || {};

    const newRecord = {
      id: Date.now(),
      tanggal,
      nip,
      nama_lengkap: emp.nama_lengkap || 'Pegawai',
      unit_kerja: emp.unit_kerja || '-',
      jam_masuk: jamMasuk,
      jam_pulang: jamPulang,
      status_kehadiran: status,
      keterangan
    };

    state.absensiList.unshift(newRecord);
    saveAbsensi();
    populateDateDropdown();
    closeModal('modal-tambah');
    evaluateAndRender();
    showToast(`Presensi untuk ${emp.nama_lengkap} berhasil ditambahkan!`, 'success');
  }

  function openEditModal(recordId) {
    const rec = state.absensiList.find(r => r.id === recordId);
    if (!rec) return;

    state.editingRecordId = recordId;

    document.getElementById('modal-edit-pegawai').value = `${rec.nama_lengkap} (${rec.nip})`;
    document.getElementById('modal-edit-tanggal').value = rec.tanggal;
    document.getElementById('modal-edit-masuk').value = rec.jam_masuk || '';
    document.getElementById('modal-edit-pulang').value = rec.jam_pulang || '';
    document.getElementById('modal-edit-status').value = rec.status_kehadiran || 'Hadir';
    document.getElementById('modal-edit-keterangan').value = rec.keterangan || '';

    openModal('modal-edit');
  }

  function handleSaveEditPresensi(e) {
    e.preventDefault();
    if (!state.editingRecordId) return;

    const rec = state.absensiList.find(r => r.id === state.editingRecordId);
    if (!rec) return;

    rec.jam_masuk = document.getElementById('modal-edit-masuk').value || null;
    rec.jam_pulang = document.getElementById('modal-edit-pulang').value || null;
    rec.status_kehadiran = document.getElementById('modal-edit-status').value || 'Hadir';
    rec.keterangan = document.getElementById('modal-edit-keterangan').value || null;

    saveAbsensi();
    closeModal('modal-edit');
    evaluateAndRender();
    showToast(`Perubahan presensi untuk ${rec.nama_lengkap} berhasil disimpan!`, 'success');
  }

  function deleteRecord(recordId) {
    const rec = state.absensiList.find(r => r.id === recordId);
    if (!rec) return;

    if (confirm(`Apakah Anda yakin ingin menghapus data presensi ${rec.nama_lengkap} tanggal ${rec.tanggal}?`)) {
      state.absensiList = state.absensiList.filter(r => r.id !== recordId);
      saveAbsensi();
      evaluateAndRender();
      showToast('Data presensi berhasil dihapus.', 'danger');
    }
  }

  function resetToDefault() {
    if (confirm('Kembalikan seluruh data presensi ke database resmi FHISIP UT (3.098 data scan September & Oktober)? Seluruh perubahan manual akan di-reset.')) {
      localStorage.removeItem(STORAGE_KEY_ABSENSI);
      localStorage.removeItem(STORAGE_KEY_CONFIG);
      loadConfig();
      loadData();
      evaluateAndRender();
      showToast('Data dan konfigurasi berhasil disinkronkan ke database master FHISIP UT (3.098 data).', 'success');
    }
  }

  // ==========================================================================
  // EXPORT & PRINT
  // ==========================================================================
  function exportToCsv(useFiltered = false) {
    const recordsToExport = (useFiltered && state.lastFilteredRecords && state.lastFilteredRecords.length > 0)
      ? state.lastFilteredRecords
      : state.absensiList.map(evaluateRecord);

    // Header CSV resmi
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
      'Status Disiplin',
      'Keterangan'
    ];

    const rows = recordsToExport.map((r, i) => {
      const emp = state.pegawaiList.find(p => p.nip === r.nip) || {};
      return [
        i + 1,
        r.tanggal,
        `'${r.nip}`, // Tanda petik agar digit NIP aman di Excel
        `"${(r.nama_lengkap || emp.nama_lengkap || '').replace(/"/g, '""')}"`,
        `"${(emp.status_kepegawaian || 'Pegawai').replace(/"/g, '""')}"`,
        `"${(r.unit_kerja || emp.unit_kerja || '').replace(/"/g, '""')}"`,
        r.jam_masuk || '-',
        state.config.jamMasuk,
        r.menitTerlambat || 0,
        r.jam_pulang || '-',
        state.config.jamPulang,
        `"${r.statusLabel}"`,
        `"${(r.keterangan || '').replace(/"/g, '""')}"`
      ];
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const prefix = useFiltered ? 'Rekap_Presensi_Terfilter_FHISIP_UT' : 'Rekap_Absensi_FHISIP_UT';
    link.setAttribute('download', `${prefix}_${state.config.jamMasuk.replace(':', '.')}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`File CSV ${useFiltered ? 'Hasil Filter' : 'Lengkap'} (${recordsToExport.length} data) berhasil diunduh!`);
  }

  function printOfficialReport() {
    window.print();
  }

  // ==========================================================================
  // MODAL & UI HELPERS
  // ==========================================================================
  function openModal(modalId) {
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
      const d = new Date(dateStr);
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

  function getPegawaiAggregations(evaluatedList = state.absensiList.map(evaluateRecord)) {
    const rekapMap = new Map();
    evaluatedList.forEach(r => {
      if (!rekapMap.has(r.nip)) {
        rekapMap.set(r.nip, {
          totalHadir: 0,
          tepatCount: 0,
          telatCount: 0,
          totalMenitTelat: 0,
          pulangCepatCount: 0,
          izinCount: 0
        });
      }
      const agg = rekapMap.get(r.nip);
      if (r.status_kehadiran && r.status_kehadiran !== 'Hadir') {
        agg.izinCount++;
      } else {
        agg.totalHadir++;
        if (r.isTerlambat) {
          agg.telatCount++;
          agg.totalMenitTelat += r.menitTerlambat;
        } else {
          agg.tepatCount++;
        }
        if (r.isPulangCepat) {
          agg.pulangCepatCount++;
        }
      }
    });

    const rows = state.pegawaiList.map(p => {
      const agg = rekapMap.get(p.nip) || {
        totalHadir: 0,
        tepatCount: 0,
        telatCount: 0,
        totalMenitTelat: 0,
        pulangCepatCount: 0,
        izinCount: 0
      };
      const pctDisiplin = agg.totalHadir > 0 ? ((agg.tepatCount / agg.totalHadir) * 100).toFixed(1) : 100;
      return { ...p, ...agg, pctDisiplin: Number(pctDisiplin) };
    });
    rows.sort((a, b) => b.totalMenitTelat - a.totalMenitTelat || b.telatCount - a.telatCount);
    return rows;
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
      state.absensiList = list;
      saveAbsensi();
      populateDateDropdown();
    },
    getConfig: () => ({ ...state.config }),
    getEvaluatedRecords: () => state.absensiList.map(evaluateRecord),
    getFilteredRecords: () => state.lastFilteredRecords || [],
    getPegawaiAggregations: () => getPegawaiAggregations(),
    clearFilterItem,
    resetFilters,
    showToast,
    openDatabaseRefModal: () => openModal('modal-database-ref'),
    downloadMasterSeptember: () => {
      const a = document.createElement('a');
      a.href = 'Database_September_2026_Clean_FHISIP.xlsx';
      a.download = 'Database_September_2026_Clean_FHISIP.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
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
