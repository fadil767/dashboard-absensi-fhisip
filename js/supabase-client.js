/**
 * MODUL KONEKSI & SINKRONISASI SUPABASE CLOUD
 * Sistem Rekapitulasi Presensi Pegawai FHISIP Universitas Terbuka
 */

(function () {
  'use strict';

  const STORAGE_KEY_SUPABASE = 'ut_fhisip_supabase_config_v1';
  let supabaseClient = null;

  const DEFAULT_SUPABASE = {
    url: 'https://sxnimpyselgoenpurhhw.supabase.co',
    anonKey: 'sb_publishable_pm5jUtQVQf2wpWrtMtkm-Q_L6eb73S3'
  };

  function loadSavedConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SUPABASE);
      if (saved) return { ...DEFAULT_SUPABASE, ...JSON.parse(saved) };
    } catch (e) {
      console.warn('Gagal membaca config Supabase:', e);
    }
    return { ...DEFAULT_SUPABASE };
  }

  function saveConfig(url, anonKey) {
    try {
      localStorage.setItem(STORAGE_KEY_SUPABASE, JSON.stringify({ url, anonKey }));
    } catch (e) {
      console.warn('Gagal menyimpan config Supabase:', e);
    }
  }

  function getClient() {
    if (supabaseClient) return supabaseClient;
    const cfg = loadSavedConfig();
    if (cfg.url && cfg.anonKey && window.supabase) {
      supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
    }
    return supabaseClient;
  }

  /**
   * Menguji koneksi ke Supabase
   */
  async function testConnection(url, anonKey) {
    if (!window.supabase) {
      throw new Error('Library Supabase JS belum siap. Periksa koneksi internet.');
    }
    if (!url || !anonKey) {
      throw new Error('Harap masukkan URL Project dan Anon Key Supabase.');
    }

    const client = window.supabase.createClient(url, anonKey);
    const { data, error } = await client.from('pengaturan_jam_kerja').select('*').limit(1);

    if (error) {
      // Jika tabel belum ada, cek unit_kerja atau pegawai
      const test2 = await client.from('pegawai').select('nip').limit(1);
      if (test2.error) {
        throw new Error(`Koneksi berhasil tetapi query gagal: ${error.message}. Pastikan schema.sql dan seed.sql sudah dijalankan di Supabase SQL Editor.`);
      }
    }

    supabaseClient = client;
    saveConfig(url, anonKey);
    return true;
  }

  /**
   * Menarik data terbaru dari Supabase ke Dashboard
   */
  async function pullFromSupabase() {
    const client = getClient();
    if (!client) throw new Error('Koneksi Supabase belum diatur.');

    // 1. Ambil data pegawai
    const { data: dbPegawai, error: errPeg } = await client
      .from('pegawai')
      .select('nip, nama_lengkap, status_kepegawaian, jabatan, unit_kerja(nama)');

    if (errPeg) throw new Error('Gagal mengambil data pegawai: ' + errPeg.message);

    // 2. Ambil data absensi
    const { data: dbAbsensi, error: errAbs } = await client
      .from('absensi')
      .select('id, tanggal, nip, jam_masuk, jam_pulang, status_kehadiran, keterangan, pegawai(nama_lengkap, unit_kerja(nama))')
      .order('tanggal', { ascending: false });

    if (errAbs) throw new Error('Gagal mengambil data absensi: ' + errAbs.message);

    // Transformasi data
    const formattedAbsensi = dbAbsensi.map(a => {
      const p = a.pegawai || {};
      const u = p.unit_kerja ? p.unit_kerja.nama : 'FHISIP';
      return {
        id: a.id,
        tanggal: a.tanggal,
        nip: a.nip,
        nama_lengkap: p.nama_lengkap || 'Pegawai',
        unit_kerja: u,
        jam_masuk: a.jam_masuk,
        jam_pulang: a.jam_pulang,
        status_kehadiran: a.status_kehadiran || 'Hadir',
        keterangan: a.keterangan
      };
    });

    window.app.setAbsensiList(formattedAbsensi);
    window.app.evaluateAndRender();
    return formattedAbsensi.length;
  }

  /**
   * Mengunggah data presensi lokal saat ini ke Supabase
   */
  async function pushToSupabase() {
    const client = getClient();
    if (!client) throw new Error('Koneksi Supabase belum diatur.');

    const localList = window.app.getAbsensiList();
    if (localList.length === 0) throw new Error('Tidak ada data presensi lokal.');

    // Deduplikasi otomatis berdasarkan kunci unik (nip, tanggal) agar tidak memicu error batch PostgreSQL
    const cleanMap = new Map();
    localList.forEach(a => {
      const k = `${a.nip}|${a.tanggal}`;
      if (!cleanMap.has(k)) {
        cleanMap.set(k, {
          nip: a.nip,
          tanggal: a.tanggal,
          jam_masuk: a.jam_masuk || null,
          jam_pulang: a.jam_pulang || null,
          status_kehadiran: a.status_kehadiran || 'Hadir',
          keterangan: a.keterangan || null
        });
      } else {
        const existing = cleanMap.get(k);
        if (a.jam_masuk && (!existing.jam_masuk || a.jam_masuk < existing.jam_masuk)) existing.jam_masuk = a.jam_masuk;
        if (a.jam_pulang && (!existing.jam_pulang || a.jam_pulang > existing.jam_pulang)) existing.jam_pulang = a.jam_pulang;
        if (a.keterangan && !existing.keterangan) existing.keterangan = a.keterangan;
      }
    });

    const upsertRows = Array.from(cleanMap.values());

    // Batch upsert 150 rows per request
    const chunkSize = 150;
    let committed = 0;

    for (let i = 0; i < upsertRows.length; i += chunkSize) {
      const chunk = upsertRows.slice(i, i + chunkSize);
      const { error } = await client.from('absensi').upsert(chunk, { onConflict: 'nip, tanggal' });
      if (error) throw new Error(`Gagal upsert batch ${i}: ` + error.message);
      committed += chunk.length;
    }

    return committed;
  }

  // --- UI INTEGRATION ---
  function openSupabaseModal() {
    const cfg = loadSavedConfig();
    const elUrl = document.getElementById('supabase-url');
    const elKey = document.getElementById('supabase-key');
    const elStatus = document.getElementById('supabase-status-badge');

    if (elUrl) elUrl.value = cfg.url || '';
    if (elKey) elKey.value = cfg.anonKey || '';
    if (elStatus) {
      if (cfg.url && cfg.anonKey) {
        elStatus.className = 'badge-status badge-tepat';
        elStatus.textContent = '● Terkonfigurasi';
      } else {
        elStatus.className = 'badge-status badge-alpha';
        elStatus.textContent = '○ Belum Terhubung';
      }
    }

    window.app.openModal('modal-supabase');
  }

  async function handleTestConnection() {
    const url = document.getElementById('supabase-url').value.trim();
    const key = document.getElementById('supabase-key').value.trim();
    const btn = document.getElementById('btn-test-supabase');

    try {
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Menguji...'; }
      await testConnection(url, key);
      window.app.showToast('Koneksi ke Supabase Cloud Berhasil!', 'success');
      
      const elStatus = document.getElementById('supabase-status-badge');
      if (elStatus) {
        elStatus.className = 'badge-status badge-tepat';
        elStatus.textContent = '● Terhubung';
      }
    } catch (err) {
      alert('Gagal terhubung ke Supabase:\n' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Test Koneksi'; }
    }
  }

  async function handlePull() {
    const btn = document.getElementById('btn-pull-supabase');
    try {
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Mengambil data...'; }
      const count = await pullFromSupabase();
      window.app.showToast(`Berhasil menyinkronkan ${count} data dari Supabase Cloud!`, 'success');
      window.app.closeModal('modal-supabase');
    } catch (err) {
      alert('Gagal mengambil data dari Supabase:\n' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⬇ Tarik Data dari Cloud'; }
    }
  }

  async function handlePush() {
    const btn = document.getElementById('btn-push-supabase');
    try {
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Mengunggah data...'; }
      const count = await pushToSupabase();
      window.app.showToast(`Berhasil mengunggah ${count} data presensi ke Supabase Cloud!`, 'success');
      window.app.closeModal('modal-supabase');
    } catch (err) {
      alert('Gagal mengunggah data ke Supabase:\n' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⬆ Unggah Data Lokal ke Cloud'; }
    }
  }

  window.supabaseSync = {
    openModal: openSupabaseModal,
    testConnection: handleTestConnection,
    pull: handlePull,
    push: handlePush,
    pullData: pullFromSupabase,
    pushData: pushToSupabase,
    getClient
  };

})();
