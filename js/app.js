/**
 * DASHBOARD REKAPITULASI ABSENSI PEGAWAI FHISIP UNIVERSITAS TERBUKA
 * Application Logic & Discipline Computation Engine
 */

(function () {
  'use strict';

  // --- STORAGE KEYS ---
  const STORAGE_KEY_ABSENSI = 'ut_fhisip_absensi_data_v1';
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
      status: 'all', // 'all' | 'telat' | 'tepat' | 'pulang_cepat' | 'izin'
      date: '',
      sort: 'telat_desc' // 'telat_desc' | 'nama_asc' | 'masuk_asc' | 'tanggal_desc'
    },
    pagination: {
      currentPage: 1,
      pageSize: 25
    },
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
        state.absensiList = JSON.parse(savedAbsensi);
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
    if (!select) return;

    const dates = [...new Set(state.absensiList.map(a => a.tanggal).filter(Boolean))].sort().reverse();
    select.innerHTML = '<option value="">Semua Tanggal Periode</option>' +
      dates.map(d => `<option value="${d}">${formatTanggalIndo(d)}</option>`).join('');
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

    // Evaluasi jam masuk
    if (recordMasukMin !== null && configMasukMin !== null) {
      if (recordMasukMin > batasMasukEfektif) {
        isTerlambat = true;
        menitTerlambat = recordMasukMin - configMasukMin; // Dihitung dari batas resmi
      }
    }

    // Evaluasi jam pulang
    if (recordPulangMin !== null && configPulangMin !== null) {
      if (recordPulangMin < configPulangMin) {
        isPulangCepat = true;
        menitPulangCepat = configPulangMin - recordPulangMin;
      }
    }

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

    // 2. Render KPI Summary Cards
    renderStats(evaluatedAll);

    // 3. Render View berdasarkan Tab Aktif
    if (state.currentTab === 'harian') {
      renderHarianTable(evaluatedAll);
    } else if (state.currentTab === 'pegawai') {
      renderPegawaiRekapTable(evaluatedAll);
    } else if (state.currentTab === 'prodi') {
      renderProdiRekapTable(evaluatedAll);
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
      }
    });

    const persenTepat = totalRecords > 0 ? ((tepatCount / totalRecords) * 100).toFixed(1) : 0;
    const persenTelat = totalRecords > 0 ? ((telatCount / totalRecords) * 100).toFixed(1) : 0;
    const rataMenitTelat = telatCount > 0 ? Math.round(totalMenitTelat / telatCount) : 0;

    // Update DOM
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
    // 1. Terapkan filter
    let filtered = allEvaluated.filter(r => {
      // Search: nama atau NIP
      if (state.filters.search) {
        const q = state.filters.search.toLowerCase();
        const nama = (r.nama_lengkap || '').toLowerCase();
        const nip = (r.nip || '').toLowerCase();
        if (!nama.includes(q) && !nip.includes(q)) return false;
      }

      // Filter Unit
      if (state.filters.unit && r.unit_kerja !== state.filters.unit) {
        return false;
      }

      // Filter Tanggal
      if (state.filters.date && r.tanggal !== state.filters.date) {
        return false;
      }

      // Filter Status
      if (state.filters.status === 'telat' && !r.isTerlambat) return false;
      if (state.filters.status === 'tepat' && (r.isTerlambat || (r.status_kehadiran && r.status_kehadiran !== 'Hadir'))) return false;
      if (state.filters.status === 'pulang_cepat' && !r.isPulangCepat) return false;
      if (state.filters.status === 'izin' && r.status_kehadiran === 'Hadir') return false;

      return true;
    });

    // 2. Sorting
    filtered.sort((a, b) => {
      if (state.filters.sort === 'telat_desc') {
        return b.menitTerlambat - a.menitTerlambat;
      } else if (state.filters.sort === 'nama_asc') {
        return (a.nama_lengkap || '').localeCompare(b.nama_lengkap || '');
      } else if (state.filters.sort === 'masuk_asc') {
        return (a.jam_masuk || '99:99').localeCompare(b.jam_masuk || '99:99');
      } else if (state.filters.sort === 'tanggal_desc') {
        return (b.tanggal || '').localeCompare(a.tanggal || '');
      }
      return 0;
    });

    // 3. Pagination
    const totalItems = filtered.length;
    const pageSize = state.pagination.pageSize;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    if (state.pagination.currentPage > totalPages) {
      state.pagination.currentPage = 1;
    }
    const startIndex = (state.pagination.currentPage - 1) * pageSize;
    const pageItems = filtered.slice(startIndex, startIndex + pageSize);

    // 4. Render Table
    const tbody = document.getElementById('table-body-harian');
    if (!tbody) return;

    if (totalItems === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8">
            <div class="empty-state">
              <div class="empty-state-icon">🔍</div>
              <h3>Tidak ada data presensi yang sesuai</h3>
              <p>Coba sesuaikan kata kunci pencarian, filter status, atau batas waktu keterlambatan.</p>
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
      }

      // Jam Pulang Pill
      let pulangPill = `<span class="time-pill">${r.jam_pulang || '-'}</span>`;
      if (r.isPulangCepat) {
        pulangPill = `<span class="time-pill time-warning">${r.jam_pulang} (-${r.menitPulangCepat}m)</span>`;
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
        const elDateFilter = document.getElementById('filter-date');
        const elStatusFilter = document.querySelector('.quick-status-filter');
        if (elDateFilter) elDateFilter.style.display = state.currentTab === 'harian' ? 'inline-block' : 'none';
        if (elStatusFilter) elStatusFilter.style.display = state.currentTab === 'harian' ? 'flex' : 'none';

        evaluateAndRender();
      });
    });

    // 5. Search & Filters
    const elSearch = document.getElementById('filter-search');
    if (elSearch) {
      elSearch.addEventListener('input', debounce((e) => {
        state.filters.search = e.target.value.trim();
        state.pagination.currentPage = 1;
        evaluateAndRender();
      }, 200));
    }

    const elUnit = document.getElementById('filter-unit');
    if (elUnit) {
      elUnit.addEventListener('change', (e) => {
        state.filters.unit = e.target.value;
        state.pagination.currentPage = 1;
        evaluateAndRender();
      });
    }

    const elDate = document.getElementById('filter-date');
    if (elDate) {
      elDate.addEventListener('change', (e) => {
        state.filters.date = e.target.value;
        state.pagination.currentPage = 1;
        evaluateAndRender();
      });
    }

    const elSort = document.getElementById('filter-sort');
    if (elSort) {
      elSort.addEventListener('change', (e) => {
        state.filters.sort = e.target.value;
        evaluateAndRender();
      });
    }

    // Quick Status Filter Pills
    document.querySelectorAll('.status-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.status-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.filters.status = btn.getAttribute('data-status');
        state.pagination.currentPage = 1;
        evaluateAndRender();
      });
    });

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
    if (confirm('Kembalikan seluruh data presensi ke sampel awal resmi FHISIP UT (948 data scan)? Seluruh perubahan yang dibuat akan di-reset.')) {
      localStorage.removeItem(STORAGE_KEY_ABSENSI);
      localStorage.removeItem(STORAGE_KEY_CONFIG);
      loadConfig();
      loadData();
      evaluateAndRender();
      showToast('Data dan konfigurasi berhasil dikembalikan ke standar awal FHISIP UT.', 'success');
    }
  }

  // ==========================================================================
  // EXPORT & PRINT
  // ==========================================================================
  function exportToCsv() {
    const evaluatedAll = state.absensiList.map(evaluateRecord);

    // Header CSV resmi
    const headers = [
      'No',
      'Tanggal',
      'NIP',
      'Nama Pegawai',
      'Unit Kerja',
      'Jam Datang',
      'Batas Datang',
      'Terlambat (Menit)',
      'Jam Pulang',
      'Batas Pulang',
      'Status Disiplin',
      'Keterangan'
    ];

    const rows = evaluatedAll.map((r, i) => [
      i + 1,
      r.tanggal,
      `'${r.nip}`, // Tanda petik agar digit NIP aman di Excel
      `"${(r.nama_lengkap || '').replace(/"/g, '""')}"`,
      `"${(r.unit_kerja || '').replace(/"/g, '""')}"`,
      r.jam_masuk || '-',
      state.config.jamMasuk,
      r.menitTerlambat,
      r.jam_pulang || '-',
      state.config.jamPulang,
      `"${r.statusLabel}"`,
      `"${(r.keterangan || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Rekap_Absensi_FHISIP_UT_${state.config.jamMasuk.replace(':', '.')}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('File CSV Rekapitulasi berhasil diunduh!');
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
    exportToCsv,
    exportPdf: (mode) => window.pdfExport ? window.pdfExport.exportPdf(mode) : alert('Modul PDF belum termuat'),
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
    getPegawaiAggregations: () => getPegawaiAggregations(),
    showToast,
    evaluateAndRender
  };

  // Run on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
