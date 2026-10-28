/**
 * MODUL KONEKSI & LIVE MULTI-DEVICE SYNCHRONIZATION (SUPABASE CLOUD REALTIME)
 * Sistem Rekapitulasi Presensi Pegawai FHISIP Universitas Terbuka
 *
 * Fitur Utama:
 * 1. Live-to-Update Real-time antar perangkat & antar user (<100ms via WebSocket Broadcast)
 * 2. Live Presence: Indikator jumlah perangkat & daftar user yang sedang aktif bersamaan
 * 3. Paginated Cloud Pull (mengambil >3.000+ rekaman secara paralel tanpa batas 1.000 baris)
 * 4. Offline Queue & Auto-Reconnect saat perangkat berganti jaringan / bangun dari sleep
 * 5. Proteksi Foreign-Key otomatis untuk pegawai baru saat Tambah / Import Excel
 */

(function () {
  'use strict';

  const STORAGE_KEY_SUPABASE = 'ut_fhisip_supabase_config_v1';
  const STORAGE_KEY_LIVE_ENABLED = 'ut_fhisip_live_sync_enabled_v1';
  const STORAGE_KEY_PENDING_QUEUE = 'ut_fhisip_pending_sync_queue_v1';

  const DEFAULT_SUPABASE = {
    url: 'https://sxnimpyselgoenpurhhw.supabase.co',
    anonKey: 'sb_publishable_pm5jUtQVQf2wpWrtMtkm-Q_L6eb73S3'
  };

  const DEVICE_ID = (window.StorageManager && window.StorageManager.CLIENT_ID)
    ? window.StorageManager.CLIENT_ID
    : ('dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8));

  let supabaseClient = null;
  let liveRoomChannel = null;
  let pgChangesChannel = null;
  let deltaTimer = null;
  let reconnectTimer = null;

  let isRealtimeActive = false;
  let isSyncInProgress = false;
  let lastLocalMutationAt = 0;
  let lastSyncedAt = null;
  let lastKnownCloudCount = null;
  let lastKnownLatestId = null;

  // Cache relasi cloud untuk mempercepat validasi FK pegawai & unit kerja
  const knownCloudNips = new Set();
  const unitNameToId = new Map();

  // Deduplikasi event live agar tidak diproses dua kali
  const processedMutationIds = new Set();
  const recentRecordFingerprints = new Map(); // key: nip|tanggal -> timestamp

  // Daftar perangkat/user online & riwayat aktivitas live sesi ini
  let onlinePeers = [];
  const liveActivityLog = [];

  // ==========================================================================
  // HELPERS: KONFIGURASI, IDENTITAS USER & ANTREAN OFFLINE
  // ==========================================================================
  function loadSavedConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SUPABASE);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          url: parsed.url || DEFAULT_SUPABASE.url,
          anonKey: parsed.anonKey || DEFAULT_SUPABASE.anonKey
        };
      }
    } catch (e) {
      console.warn('[LiveSync] Gagal membaca config Supabase:', e);
    }
    return { ...DEFAULT_SUPABASE };
  }

  function saveConfig(url, anonKey) {
    try {
      localStorage.setItem(STORAGE_KEY_SUPABASE, JSON.stringify({ url, anonKey }));
    } catch (e) {
      console.warn('[LiveSync] Gagal menyimpan config Supabase:', e);
    }
  }

  function isAutoSyncEnabled() {
    try {
      const val = localStorage.getItem(STORAGE_KEY_LIVE_ENABLED);
      return val === null ? true : val !== '0';
    } catch (_) {
      return true;
    }
  }

  function setAutoSyncEnabled(enabled) {
    try {
      localStorage.setItem(STORAGE_KEY_LIVE_ENABLED, enabled ? '1' : '0');
    } catch (_) {}

    if (enabled) {
      initLiveSync();
    } else {
      disconnectRealtime();
      if (window.StorageManager) {
        window.StorageManager.setLiveSyncStatus(false, 1, null);
      }
      refreshModalUI();
    }
  }

  function detectDeviceType() {
    if (typeof navigator === 'undefined') return 'Desktop';
    const ua = navigator.userAgent || '';
    if (/iPad|Tablet/i.test(ua)) return 'Tablet';
    if (/Android|iPhone|iPod|Mobile/i.test(ua)) return 'Smartphone';
    return 'Laptop / PC';
  }

  function getActorInfo() {
    if (window.StorageManager && typeof window.StorageManager.getActiveUserActor === 'function') {
      const base = window.StorageManager.getActiveUserActor();
      return { ...base, deviceType: detectDeviceType(), deviceId: DEVICE_ID };
    }
    try {
      const s = JSON.parse(localStorage.getItem('ut_fhisip_session') || '{}');
      return {
        name: s.name || 'Admin FHISIP UT',
        role: s.role || 'Administrator',
        username: s.username || 'admin',
        deviceType: detectDeviceType(),
        deviceId: DEVICE_ID
      };
    } catch (_) {
      return {
        name: 'Admin FHISIP UT',
        role: 'Administrator',
        username: 'admin',
        deviceType: detectDeviceType(),
        deviceId: DEVICE_ID
      };
    }
  }

  function getPendingQueue() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PENDING_QUEUE);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function savePendingQueue(queue) {
    try {
      if (!queue || queue.length === 0) {
        localStorage.removeItem(STORAGE_KEY_PENDING_QUEUE);
      } else {
        localStorage.setItem(STORAGE_KEY_PENDING_QUEUE, JSON.stringify(queue.slice(-200)));
      }
    } catch (_) {}
  }

  function enqueueOfflineMutation(item) {
    const queue = getPendingQueue();
    // Gabungkan jika operasi pada nip|tanggal yang sama sudah ada di antrean
    const key = `${item.nip || (item.record && item.record.nip)}|${item.tanggal || (item.record && item.record.tanggal)}`;
    const filtered = queue.filter(q => {
      const qKey = `${q.nip || (q.record && q.record.nip)}|${q.tanggal || (q.record && q.record.tanggal)}`;
      return qKey !== key;
    });
    filtered.push({ ...item, queuedAt: new Date().toISOString() });
    savePendingQueue(filtered);
    updateGlobalSyncBadge();
  }

  function recordActivityLog(message, actorName = 'Sistem', type = 'sync') {
    const entry = {
      time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      actor: actorName,
      message,
      type
    };
    liveActivityLog.unshift(entry);
    if (liveActivityLog.length > 30) liveActivityLog.length = 30;
    refreshModalUI();
  }

  function markFingerprint(nip, tanggal) {
    if (!nip || !tanggal) return;
    recentRecordFingerprints.set(`${nip}|${tanggal}`, Date.now());
    if (recentRecordFingerprints.size > 300) {
      const firstKey = recentRecordFingerprints.keys().next().value;
      recentRecordFingerprints.delete(firstKey);
    }
  }

  function wasRecentlyHandled(nip, tanggal, windowMs = 4000) {
    const ts = recentRecordFingerprints.get(`${nip}|${tanggal}`);
    return Boolean(ts && (Date.now() - ts) < windowMs);
  }

  function getClient() {
    if (supabaseClient) return supabaseClient;
    const cfg = loadSavedConfig();
    if (cfg.url && cfg.anonKey && window.supabase) {
      supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey, {
        realtime: {
          params: {
            eventsPerSecond: 20
          }
        }
      });
    }
    return supabaseClient;
  }

  // ==========================================================================
  // SINKRONISASI BADGE HEADER & MODAL LIVE SYNC UI
  // ==========================================================================
  function updateGlobalSyncBadge() {
    if (!window.StorageManager) return;
    const pending = getPendingQueue().length;

    if (!navigator.onLine) {
      const msg = pending > 0
        ? `Mode Offline • ${pending} Antrean Sinkron`
        : 'Mode Offline (Tersimpan Lokal)';
      window.StorageManager.setLiveSyncStatus(false, 1, msg);
      refreshModalUI();
      return;
    }

    if (isRealtimeActive) {
      const count = Math.max(1, onlinePeers.length);
      const custom = pending > 0
        ? `Menyinkronkan ${pending} Antrean...`
        : (count > 1 ? `Live Sync • ${count} Perangkat Online` : 'Live Sync Cloud Aktif');
      window.StorageManager.setLiveSyncStatus(true, count, custom);
    } else if (isAutoSyncEnabled()) {
      window.StorageManager.setLiveSyncStatus(false, 1, pending > 0 ? `Menunggu Koneksi (${pending} Antrean)` : null);
    } else {
      window.StorageManager.setLiveSyncStatus(false, 1, null);
    }

    refreshModalUI();
  }

  function refreshModalUI() {
    if (typeof document === 'undefined') return;

    const elStatus = document.getElementById('supabase-status-badge');
    const elOnlineCount = document.getElementById('live-sync-online-count');
    const elLastSync = document.getElementById('live-sync-last-time');
    const elPeerList = document.getElementById('live-sync-peer-list');
    const elActivityList = document.getElementById('live-sync-activity-list');
    const elAutoToggle = document.getElementById('toggle-auto-live-sync');
    const elPendingBanner = document.getElementById('live-sync-pending-banner');

    if (elAutoToggle) {
      elAutoToggle.checked = isAutoSyncEnabled();
    }

    const pendingCount = getPendingQueue().length;
    if (elPendingBanner) {
      if (pendingCount > 0) {
        elPendingBanner.style.display = 'flex';
        elPendingBanner.innerHTML = `<span>⏳</span> <span>Terdapat <strong>${pendingCount} perubahan lokal</strong> dalam antrean yang akan disinkronkan otomatis saat jaringan stabil.</span>`;
      } else {
        elPendingBanner.style.display = 'none';
      }
    }

    if (elStatus) {
      if (!navigator.onLine) {
        elStatus.className = 'badge-status badge-warning';
        elStatus.textContent = '🟠 Offline (Lokal)';
      } else if (isRealtimeActive) {
        elStatus.className = 'badge-status badge-tepat';
        elStatus.textContent = '● Live Realtime Terhubung';
      } else if (isAutoSyncEnabled()) {
        elStatus.className = 'badge-status badge-izin';
        elStatus.textContent = '◌ Menghubungkan Cloud...';
      } else {
        elStatus.className = 'badge-status badge-alpha';
        elStatus.textContent = '○ Live Sync Dijeda';
      }
    }

    if (elOnlineCount) {
      const c = Math.max(1, onlinePeers.length);
      elOnlineCount.textContent = `${c} Perangkat`;
    }

    if (elLastSync) {
      if (lastSyncedAt) {
        const timeStr = lastSyncedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const totalStr = lastKnownCloudCount !== null ? ` • ${lastKnownCloudCount.toLocaleString('id-ID')} data` : '';
        elLastSync.textContent = `${timeStr} WIB${totalStr}`;
      } else {
        elLastSync.textContent = 'Sedang memuat...';
      }
    }

    if (elPeerList) {
      const peersToRender = onlinePeers.length > 0 ? onlinePeers : [{
        deviceId: DEVICE_ID,
        userName: getActorInfo().name,
        userRole: getActorInfo().role,
        deviceType: detectDeviceType()
      }];

      elPeerList.innerHTML = peersToRender.map(p => {
        const isSelf = p.deviceId === DEVICE_ID;
        const icon = p.deviceType === 'Smartphone' ? '📱' : (p.deviceType === 'Tablet' ? '📲' : '💻');
        return `
          <div class="live-peer-chip ${isSelf ? 'is-self' : ''}">
            <span class="live-peer-dot"></span>
            <span>${icon}</span>
            <span class="live-peer-name">${escapeHtml(p.userName || 'Pengguna')}</span>
            <small class="live-peer-meta">${escapeHtml(p.deviceType || 'Perangkat')}${isSelf ? ' • Anda' : ''}</small>
          </div>
        `;
      }).join('');
    }

    if (elActivityList) {
      if (liveActivityLog.length === 0) {
        elActivityList.innerHTML = `<div class="live-activity-empty">Belum ada aktivitas perubahan antar-perangkat pada sesi ini. Setiap penambahan/edit presensi akan tampil live di sini.</div>`;
      } else {
        elActivityList.innerHTML = liveActivityLog.slice(0, 10).map(item => `
          <div class="live-activity-item">
            <span class="live-activity-time">${escapeHtml(item.time)}</span>
            <div class="live-activity-body">
              <strong>${escapeHtml(item.actor)}</strong> — ${escapeHtml(item.message)}
            </div>
          </div>
        `).join('');
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ==========================================================================
  // PROTEKSI RELASI PEGAWAI & UNIT KERJA DI CLOUD
  // ==========================================================================
  async function loadCloudReferenceCache(client) {
    try {
      const { data: units } = await client.from('unit_kerja').select('id, nama');
      if (Array.isArray(units)) {
        units.forEach(u => {
          if (u && u.nama) unitNameToId.set(u.nama.trim(), u.id);
        });
      }

      const { data: dbPegawai, error: errPeg } = await client
        .from('pegawai')
        .select('nip, nama_lengkap, status_kepegawaian, jabatan, unit_kerja(nama)');

      if (!errPeg && Array.isArray(dbPegawai)) {
        const formattedPegawai = dbPegawai.map(p => {
          knownCloudNips.add(String(p.nip).trim());
          return {
            nip: p.nip,
            nama_lengkap: p.nama_lengkap,
            status_kepegawaian: p.status_kepegawaian || 'PNS',
            jabatan: p.jabatan || 'Pegawai',
            unit_kerja: (p.unit_kerja && p.unit_kerja.nama) ? p.unit_kerja.nama : 'FHISIP'
          };
        });

        if (window.app && typeof window.app.mergePegawaiList === 'function') {
          window.app.mergePegawaiList(formattedPegawai);
        }
      }
    } catch (e) {
      console.warn('[LiveSync] Gagal memuat cache referensi pegawai/unit:', e);
    }
  }

  async function ensurePegawaiInCloud(records) {
    const client = getClient();
    if (!client || !Array.isArray(records) || records.length === 0) return;

    if (knownCloudNips.size === 0 || unitNameToId.size === 0) {
      await loadCloudReferenceCache(client);
    }

    const appPegawaiMap = new Map();
    if (window.app && typeof window.app.getPegawaiList === 'function') {
      window.app.getPegawaiList().forEach(p => {
        if (p && p.nip) appPegawaiMap.set(String(p.nip).trim(), p);
      });
    }

    const missingPegawaiMap = new Map();
    const missingUnits = new Set();

    records.forEach(r => {
      if (!r || !r.nip) return;
      const nip = String(r.nip).trim();
      if (!knownCloudNips.has(nip) && !missingPegawaiMap.has(nip)) {
        const refPeg = appPegawaiMap.get(nip) || {};
        const unitName = (r.unit_kerja || refPeg.unit_kerja || 'FHISIP').trim();
        if (unitName && !unitNameToId.has(unitName)) {
          missingUnits.add(unitName);
        }
        missingPegawaiMap.set(nip, {
          nip,
          nama_lengkap: r.nama_lengkap || refPeg.nama_lengkap || ('Pegawai ' + nip),
          status_kepegawaian: refPeg.status_kepegawaian || 'PNS',
          jabatan: refPeg.jabatan || 'Pegawai FHISIP',
          unit_name: unitName
        });
      }
    });

    if (missingUnits.size > 0) {
      const unitPayload = Array.from(missingUnits).map(nama => ({ nama }));
      const { data: createdUnits } = await client
        .from('unit_kerja')
        .upsert(unitPayload, { onConflict: 'nama' })
        .select('id, nama');
      if (Array.isArray(createdUnits)) {
        createdUnits.forEach(u => unitNameToId.set(u.nama.trim(), u.id));
      }
    }

    if (missingPegawaiMap.size > 0) {
      const pegawaiPayload = Array.from(missingPegawaiMap.values()).map(p => ({
        nip: p.nip,
        nama_lengkap: p.nama_lengkap,
        status_kepegawaian: p.status_kepegawaian,
        jabatan: p.jabatan,
        unit_kerja_id: unitNameToId.get(p.unit_name) || null,
        aktif: true
      }));

      const { error } = await client.from('pegawai').upsert(pegawaiPayload, { onConflict: 'nip' });
      if (!error) {
        pegawaiPayload.forEach(p => knownCloudNips.add(p.nip));
      } else {
        console.warn('[LiveSync] Peringatan upsert pegawai baru:', error.message);
      }
    }
  }

  // ==========================================================================
  // PAGINATED CLOUD PULL & OFFLINE QUEUE FLUSH
  // ==========================================================================
  async function flushPendingQueue() {
    const queue = getPendingQueue();
    if (queue.length === 0 || !navigator.onLine) return 0;

    const client = getClient();
    if (!client) return 0;

    const remaining = [];
    let flushed = 0;

    for (const item of queue) {
      try {
        if (item.op === 'upsert' && item.record) {
          await ensurePegawaiInCloud([item.record]);
          const payload = {
            nip: item.record.nip,
            tanggal: item.record.tanggal,
            jam_masuk: item.record.jam_masuk || null,
            jam_pulang: item.record.jam_pulang || null,
            status_kehadiran: item.record.status_kehadiran || 'Hadir',
            keterangan: item.record.keterangan || null
          };
          const { error } = await client.from('absensi').upsert([payload], { onConflict: 'nip, tanggal' });
          if (error) throw error;
          broadcastMutation('UPSERT_RECORD', { subAction: 'INSERT', record: item.record });
          flushed++;
        } else if (item.op === 'delete' && item.nip && item.tanggal) {
          const { error } = await client.from('absensi').delete().match({ nip: item.nip, tanggal: item.tanggal });
          if (error) throw error;
          broadcastMutation('DELETE_RECORD', { nip: item.nip, tanggal: item.tanggal, nama_lengkap: item.nama_lengkap || '' });
          flushed++;
        }
      } catch (e) {
        remaining.push(item);
      }
    }

    savePendingQueue(remaining);
    if (flushed > 0) {
      recordActivityLog(`Menyinkronkan ${flushed} antrean perubahan offline ke Cloud`, getActorInfo().name);
    }
    updateGlobalSyncBadge();
    return flushed;
  }

  /**
   * Menarik SELURUH data terbaru dari Supabase ke Dashboard secara terpaginasi paralel
   * (Mengatasi batas 1.000 baris PostgREST sehingga seluruh 3.072+ baris terambil utuh)
   */
  async function pullFromSupabase(options = {}) {
    const client = getClient();
    if (!client) throw new Error('Koneksi Supabase belum diatur.');
    if (isSyncInProgress && options.silent) return 0;

    isSyncInProgress = true;
    try {
      // Pastikan perubahan offline lokal dikirim lebih dulu agar tidak tertimpa
      await flushPendingQueue();

      // 1. Muat data master pegawai & unit kerja
      await loadCloudReferenceCache(client);

      // 2. Ambil halaman pertama (0..999) sekaligus total count eksak
      const PAGE_SIZE = 1000;
      const selectCols = 'id, tanggal, nip, jam_masuk, jam_pulang, status_kehadiran, keterangan, pegawai(nama_lengkap, unit_kerja(nama))';

      const firstPage = await client
        .from('absensi')
        .select(selectCols, { count: 'exact' })
        .order('tanggal', { ascending: false })
        .order('id', { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (firstPage.error) {
        throw new Error('Gagal mengambil data absensi: ' + firstPage.error.message);
      }

      let allRows = firstPage.data || [];
      const totalCount = typeof firstPage.count === 'number' ? firstPage.count : allRows.length;

      // 3. Jika total > 1000 baris, ambil sisa halaman secara paralel!
      if (totalCount > PAGE_SIZE && allRows.length === PAGE_SIZE) {
        const pagePromises = [];
        for (let offset = PAGE_SIZE; offset < totalCount; offset += PAGE_SIZE) {
          pagePromises.push(
            client
              .from('absensi')
              .select(selectCols)
              .order('tanggal', { ascending: false })
              .order('id', { ascending: false })
              .range(offset, offset + PAGE_SIZE - 1)
          );
        }

        const extraPages = await Promise.all(pagePromises);
        for (const res of extraPages) {
          if (res.error) throw new Error('Gagal mengambil halaman data absensi: ' + res.error.message);
          if (Array.isArray(res.data)) {
            allRows = allRows.concat(res.data);
          }
        }
      }

      // 4. Sinkronkan pengaturan jam kerja jika diminta
      if (options.syncConfig) {
        try {
          const { data: cfgRows } = await client.from('pengaturan_jam_kerja').select('*').eq('id', 1).limit(1);
          if (Array.isArray(cfgRows) && cfgRows[0] && window.app && typeof window.app.applyRemoteConfigUpdate === 'function') {
            const c = cfgRows[0];
            window.app.applyRemoteConfigUpdate({
              jamMasuk: c.jam_masuk || '08:30',
              toleransi: Number(c.toleransi_menit) || 0,
              jamPulang: c.jam_pulang || '16:30',
              jamPulangJumat: c.jam_pulang_jumat || '16:30'
            }, null, { silent: true });
          }
        } catch (_) {}
      }

      // 5. Transformasi data & deduplikasi aman berdasarkan nip|tanggal
      const pegawaiLookup = new Map();
      if (window.app && typeof window.app.getPegawaiList === 'function') {
        window.app.getPegawaiList().forEach(p => pegawaiLookup.set(p.nip, p));
      }

      let maxId = 0;
      const seenKeys = new Set();
      const formattedAbsensi = [];

      for (const a of allRows) {
        const key = `${a.nip}|${a.tanggal}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        if (typeof a.id === 'number' && a.id > maxId) maxId = a.id;

        const p = a.pegawai || pegawaiLookup.get(a.nip) || {};
        const u = (p.unit_kerja && typeof p.unit_kerja === 'object')
          ? p.unit_kerja.nama
          : (p.unit_kerja || 'FHISIP');

        formattedAbsensi.push({
          id: a.id,
          tanggal: a.tanggal,
          nip: a.nip,
          nama_lengkap: p.nama_lengkap || 'Pegawai',
          unit_kerja: u || 'FHISIP',
          jam_masuk: a.jam_masuk,
          jam_pulang: a.jam_pulang,
          status_kehadiran: a.status_kehadiran || 'Hadir',
          keterangan: a.keterangan
        });
      }

      lastKnownCloudCount = totalCount;
      lastKnownLatestId = maxId || null;
      lastSyncedAt = new Date();

      if (window.app && typeof window.app.applyRemoteDataset === 'function') {
        window.app.applyRemoteDataset(
          formattedAbsensi,
          options.actor || null,
          options.toastMessage || null,
          { silent: Boolean(options.silent) }
        );
      } else if (window.app) {
        window.app.setAbsensiList(formattedAbsensi);
        window.app.evaluateAndRender();
      }

      updateGlobalSyncBadge();
      return formattedAbsensi.length;
    } finally {
      isSyncInProgress = false;
    }
  }

  // ==========================================================================
  // OPERASI TULIS KE CLOUD + BROADCAST REALTIME KE DEVICE LAIN
  // ==========================================================================
  function deduplicateRecordsForCloud(records) {
    const cleanMap = new Map();
    records.forEach(a => {
      if (!a || !a.nip || !a.tanggal) return;
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
    return Array.from(cleanMap.values());
  }

  /**
   * Mengunggah seluruh data lokal saat ini ke Supabase Cloud (Upsert)
   */
  async function pushToSupabase(recordsOverride = null, summaryMeta = null) {
    const client = getClient();
    if (!client) throw new Error('Koneksi Supabase belum diatur.');

    const sourceList = Array.isArray(recordsOverride) ? recordsOverride : window.app.getAbsensiList();
    if (sourceList.length === 0) throw new Error('Tidak ada data presensi untuk diunggah.');

    lastLocalMutationAt = Date.now();
    await ensurePegawaiInCloud(sourceList);

    const upsertRows = deduplicateRecordsForCloud(sourceList);
    const chunkSize = 200;
    let committed = 0;

    for (let i = 0; i < upsertRows.length; i += chunkSize) {
      const chunk = upsertRows.slice(i, i + chunkSize);
      const { error } = await client.from('absensi').upsert(chunk, { onConflict: 'nip, tanggal' });
      if (error) throw new Error(`Gagal upsert batch ${i}: ` + error.message);
      committed += chunk.length;
    }

    lastSyncedAt = new Date();
    lastLocalMutationAt = Date.now();

    const actor = getActorInfo();
    broadcastMutation('BULK_UPSERT', {
      count: committed,
      added: summaryMeta && summaryMeta.added !== undefined ? summaryMeta.added : committed,
      updated: summaryMeta && summaryMeta.updated !== undefined ? summaryMeta.updated : 0,
      fileName: summaryMeta && summaryMeta.fileName ? summaryMeta.fileName : null
    });

    recordActivityLog(
      summaryMeta && summaryMeta.fileName
        ? `Mengimpor & menyinkronkan ${committed.toLocaleString('id-ID')} data (${summaryMeta.fileName})`
        : `Mengunggah ${committed.toLocaleString('id-ID')} data presensi ke Cloud`,
      actor.name
    );

    // Perbarui fingerprint cloud
    refreshCloudMetaSnapshot().catch(() => {});
    updateGlobalSyncBadge();
    return committed;
  }

  /**
   * Menggantikan seluruh isi tabel absensi di Cloud (untuk Import Mode Replace / Reset Master)
   */
  async function replaceAllInCloud(newRecords, options = {}) {
    const client = getClient();
    if (!client || !Array.isArray(newRecords)) return 0;

    lastLocalMutationAt = Date.now();
    await ensurePegawaiInCloud(newRecords);

    const upsertRows = deduplicateRecordsForCloud(newRecords);

    // Hapus data lama di Cloud lalu masukkan dataset baru
    const { error: delErr } = await client.from('absensi').delete().gte('id', 0);
    if (delErr) {
      console.warn('[LiveSync] Peringatan hapus massal Cloud:', delErr.message);
    }

    const chunkSize = 200;
    let committed = 0;
    for (let i = 0; i < upsertRows.length; i += chunkSize) {
      const chunk = upsertRows.slice(i, i + chunkSize);
      const { error } = await client.from('absensi').upsert(chunk, { onConflict: 'nip, tanggal' });
      if (error) throw new Error(`Gagal menyimpan batch ${i}: ` + error.message);
      committed += chunk.length;
    }

    lastSyncedAt = new Date();
    lastKnownCloudCount = committed;
    lastLocalMutationAt = Date.now();

    const actionType = options.isReset ? 'RESET_DATA' : 'BULK_REPLACE';
    broadcastMutation(actionType, {
      count: committed,
      fileName: options.fileName || null
    });

    recordActivityLog(
      options.isReset
        ? `Mereset database ke data awal resmi (${committed.toLocaleString('id-ID')} data)`
        : `Mengganti database dengan berkas ${options.fileName || 'baru'} (${committed.toLocaleString('id-ID')} data)`,
      getActorInfo().name
    );

    refreshCloudMetaSnapshot().catch(() => {});
    updateGlobalSyncBadge();
    return committed;
  }

  /**
   * Menyimpan/memperbarui 1 baris presensi ke Cloud + Live Broadcast instan (<100ms) ke user lain
   */
  async function updateRecordInCloud(rec, subAction = 'UPDATE') {
    if (!rec || !rec.nip || !rec.tanggal) return false;

    markFingerprint(rec.nip, rec.tanggal);
    lastLocalMutationAt = Date.now();

    if (!navigator.onLine) {
      enqueueOfflineMutation({ op: 'upsert', record: { ...rec } });
      return false;
    }

    const client = getClient();
    if (!client) return false;

    try {
      await ensurePegawaiInCloud([rec]);

      const payload = {
        nip: rec.nip,
        tanggal: rec.tanggal,
        jam_masuk: rec.jam_masuk || null,
        jam_pulang: rec.jam_pulang || null,
        status_kehadiran: rec.status_kehadiran || 'Hadir',
        keterangan: rec.keterangan || null
      };

      const { data, error } = await client
        .from('absensi')
        .upsert([payload], { onConflict: 'nip, tanggal' })
        .select('id');

      if (error) throw error;

      const savedId = Array.isArray(data) && data[0] && data[0].id ? data[0].id : rec.id;
      const syncedRecord = { ...rec, id: savedId };

      if (typeof savedId === 'number') {
        if (!lastKnownLatestId || savedId > lastKnownLatestId) {
          lastKnownLatestId = savedId;
        }
      }
      if (subAction === 'INSERT' && typeof lastKnownCloudCount === 'number') {
        lastKnownCloudCount += 1;
      }
      lastSyncedAt = new Date();
      lastLocalMutationAt = Date.now();

      broadcastMutation('UPSERT_RECORD', {
        subAction,
        record: syncedRecord
      });

      const verb = subAction === 'INSERT' ? 'menambahkan' : 'memperbarui';
      recordActivityLog(`${verb} presensi ${rec.nama_lengkap || rec.nip} (${rec.tanggal})`, getActorInfo().name);
      updateGlobalSyncBadge();
      return true;
    } catch (e) {
      console.warn('[LiveSync] Gagal sinkron 1 data ke Cloud, masuk antrean offline:', e.message || e);
      enqueueOfflineMutation({ op: 'upsert', record: { ...rec } });
      return false;
    }
  }

  /**
   * Menghapus 1 baris presensi dari Cloud + Live Broadcast instan ke user lain
   */
  async function deleteRecordFromCloud(nip, tanggal, namaLengkap = '') {
    if (!nip || !tanggal) return false;

    markFingerprint(nip, tanggal);
    lastLocalMutationAt = Date.now();

    if (!navigator.onLine) {
      enqueueOfflineMutation({ op: 'delete', nip, tanggal, nama_lengkap: namaLengkap });
      return false;
    }

    const client = getClient();
    if (!client) return false;

    try {
      const { error } = await client.from('absensi').delete().match({ nip, tanggal });
      if (error) throw error;

      if (typeof lastKnownCloudCount === 'number' && lastKnownCloudCount > 0) {
        lastKnownCloudCount -= 1;
      }
      lastSyncedAt = new Date();
      lastLocalMutationAt = Date.now();

      broadcastMutation('DELETE_RECORD', {
        nip,
        tanggal,
        nama_lengkap: namaLengkap
      });

      recordActivityLog(`menghapus presensi ${namaLengkap || nip} (${tanggal})`, getActorInfo().name);
      updateGlobalSyncBadge();
      return true;
    } catch (e) {
      console.warn('[LiveSync] Gagal hapus data di Cloud, masuk antrean offline:', e.message || e);
      enqueueOfflineMutation({ op: 'delete', nip, tanggal, nama_lengkap: namaLengkap });
      return false;
    }
  }

  /**
   * Menyinkronkan perubahan aturan jam kerja ke Cloud & perangkat lain
   */
  async function syncConfigToCloud(config) {
    if (!config || !navigator.onLine) return false;
    const client = getClient();
    if (!client) return false;

    try {
      const payload = {
        id: 1,
        jam_masuk: config.jamMasuk || '08:30',
        toleransi_menit: Number(config.toleransi) || 0,
        jam_pulang: config.jamPulang || '16:30',
        jam_pulang_jumat: config.jamPulangJumat || '16:30',
        updated_at: new Date().toISOString()
      };
      const { error } = await client.from('pengaturan_jam_kerja').upsert([payload], { onConflict: 'id' });
      if (error) throw error;

      broadcastMutation('CONFIG_UPDATE', { config });
      recordActivityLog(`mengubah kebijakan batas jam kerja (${payload.jam_masuk} - ${payload.jam_pulang})`, getActorInfo().name);
      return true;
    } catch (e) {
      console.warn('[LiveSync] Gagal sinkron pengaturan jam kerja:', e.message || e);
      return false;
    }
  }

  // ==========================================================================
  // SUPABASE REALTIME WEBSOCKET ENGINE (BROADCAST + PRESENCE + PG_CHANGES)
  // ==========================================================================
  function broadcastMutation(action, extraPayload = {}) {
    if (!liveRoomChannel || !isRealtimeActive) return;

    const mutationId = 'mut_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    processedMutationIds.add(mutationId);
    if (processedMutationIds.size > 200) {
      const oldest = processedMutationIds.values().next().value;
      processedMutationIds.delete(oldest);
    }

    liveRoomChannel.send({
      type: 'broadcast',
      event: 'absensi_sync',
      payload: {
        mutationId,
        deviceId: DEVICE_ID,
        actor: getActorInfo(),
        action,
        ...extraPayload,
        timestamp: new Date().toISOString()
      }
    }).catch(err => {
      console.warn('[LiveSync] Gagal mengirim broadcast realtime:', err);
    });
  }

  function handleIncomingBroadcast(payload) {
    if (!payload || !isAutoSyncEnabled()) return;
    if (payload.deviceId === DEVICE_ID) return; // Abaikan event dari tab sendiri

    if (payload.mutationId) {
      if (processedMutationIds.has(payload.mutationId)) return;
      processedMutationIds.add(payload.mutationId);
    }

    const actor = payload.actor || { name: 'Pengguna Lain' };
    const actorName = actor.name || 'Pengguna Lain';
    lastSyncedAt = new Date();

    if (payload.action === 'UPSERT_RECORD' && payload.record) {
      const rec = payload.record;
      markFingerprint(rec.nip, rec.tanggal);

      if (typeof rec.id === 'number' && (!lastKnownLatestId || rec.id > lastKnownLatestId)) {
        lastKnownLatestId = rec.id;
      }

      if (window.app && typeof window.app.applyRemoteRecordUpsert === 'function') {
        const result = window.app.applyRemoteRecordUpsert(rec, actor, payload.subAction || 'UPDATE');
        if (result === 'inserted' && typeof lastKnownCloudCount === 'number') {
          lastKnownCloudCount += 1;
        }
      }

      const verb = payload.subAction === 'INSERT' ? 'menambahkan' : 'memperbarui';
      recordActivityLog(`${verb} presensi ${rec.nama_lengkap || rec.nip} (${rec.tanggal})`, actorName, 'remote');
      updateGlobalSyncBadge();
      return;
    }

    if (payload.action === 'DELETE_RECORD' && payload.nip && payload.tanggal) {
      markFingerprint(payload.nip, payload.tanggal);
      if (typeof lastKnownCloudCount === 'number' && lastKnownCloudCount > 0) {
        lastKnownCloudCount -= 1;
      }

      if (window.app && typeof window.app.applyRemoteRecordDelete === 'function') {
        window.app.applyRemoteRecordDelete(payload.nip, payload.tanggal, payload.nama_lengkap || '', actor);
      }

      recordActivityLog(`menghapus presensi ${payload.nama_lengkap || payload.nip} (${payload.tanggal})`, actorName, 'remote');
      updateGlobalSyncBadge();
      return;
    }

    if (payload.action === 'BULK_UPSERT' || payload.action === 'BULK_REPLACE' || payload.action === 'RESET_DATA') {
      const desc = payload.action === 'RESET_DATA'
        ? `⚡ Live Sync: ${actorName} mereset data ke master resmi FHISIP`
        : `⚡ Live Update: ${actorName} mengimpor/memperbarui ${(payload.count || 0).toLocaleString('id-ID')} data presensi`;

      recordActivityLog(
        payload.action === 'RESET_DATA'
          ? 'mereset database ke master resmi'
          : `memperbarui massal ${(payload.count || 0).toLocaleString('id-ID')} data presensi`,
        actorName,
        'remote'
      );

      pullFromSupabase({
        silent: false,
        actor,
        toastMessage: desc
      }).catch(err => console.warn('[LiveSync] Gagal pull setelah bulk broadcast:', err));
      return;
    }

    if (payload.action === 'CONFIG_UPDATE' && payload.config) {
      if (window.app && typeof window.app.applyRemoteConfigUpdate === 'function') {
        window.app.applyRemoteConfigUpdate(payload.config, actor, { silent: false });
      }
      recordActivityLog(`mengubah batas jam kerja menjadi Masuk ${payload.config.jamMasuk} / Pulang ${payload.config.jamPulang}`, actorName, 'remote');
      updateGlobalSyncBadge();
    }
  }

  function handleIncomingPostgresChange(pgEvent) {
    if (!pgEvent || !isAutoSyncEnabled()) return;
    // Jika perubahan baru saja kita tangani lewat Broadcast atau penulisan lokal, lewati agar tidak duplikat
    if (Date.now() - lastLocalMutationAt < 3500) return;

    const row = pgEvent.new && pgEvent.new.nip ? pgEvent.new : (pgEvent.old || {});
    if (row.nip && row.tanggal && wasRecentlyHandled(row.nip, row.tanggal, 5000)) {
      return;
    }

    if (pgEvent.eventType === 'DELETE' && row.nip && row.tanggal) {
      markFingerprint(row.nip, row.tanggal);
      if (window.app && typeof window.app.applyRemoteRecordDelete === 'function') {
        window.app.applyRemoteRecordDelete(row.nip, row.tanggal, '', { name: 'Database Cloud' });
      }
      recordActivityLog(`menghapus presensi NIP ${row.nip} (${row.tanggal})`, 'Supabase Cloud', 'remote');
      return;
    }

    if ((pgEvent.eventType === 'INSERT' || pgEvent.eventType === 'UPDATE') && pgEvent.new && pgEvent.new.nip) {
      const r = pgEvent.new;
      markFingerprint(r.nip, r.tanggal);

      let emp = {};
      if (window.app && typeof window.app.getPegawaiList === 'function') {
        emp = window.app.getPegawaiList().find(p => p.nip === r.nip) || {};
      }

      const formatted = {
        id: r.id,
        tanggal: r.tanggal,
        nip: r.nip,
        nama_lengkap: emp.nama_lengkap || 'Pegawai FHISIP',
        unit_kerja: emp.unit_kerja || 'FHISIP',
        jam_masuk: r.jam_masuk,
        jam_pulang: r.jam_pulang,
        status_kehadiran: r.status_kehadiran || 'Hadir',
        keterangan: r.keterangan
      };

      if (window.app && typeof window.app.applyRemoteRecordUpsert === 'function') {
        window.app.applyRemoteRecordUpsert(
          formatted,
          { name: 'Sinkronisasi Cloud' },
          pgEvent.eventType === 'INSERT' ? 'INSERT' : 'UPDATE'
        );
      }
      recordActivityLog(`pembaruan langsung database untuk ${formatted.nama_lengkap} (${r.tanggal})`, 'Supabase Cloud', 'remote');
    }
  }

  function syncPresencePeers() {
    if (!liveRoomChannel) return;
    try {
      const state = liveRoomChannel.presenceState();
      const peers = [];
      const seenDevices = new Set();

      Object.values(state || {}).forEach(presences => {
        if (Array.isArray(presences)) {
          presences.forEach(p => {
            const id = p.deviceId || p.presence_ref;
            if (id && !seenDevices.has(id)) {
              seenDevices.add(id);
              peers.push(p);
            }
          });
        }
      });

      onlinePeers = peers;
      updateGlobalSyncBadge();
    } catch (e) {
      console.warn('[LiveSync] Gagal membaca presence state:', e);
    }
  }

  function connectRealtimeChannels() {
    if (!isAutoSyncEnabled() || !navigator.onLine) return;

    const client = getClient();
    if (!client) return;

    disconnectRealtime(false);

    const actor = getActorInfo();

    // KANAL 1: Broadcast & Presence (Selalu aktif instan di semua device tanpa syarat publikasi SQL)
    liveRoomChannel = client.channel('fhisip-live-room-v1', {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: DEVICE_ID }
      }
    });

    liveRoomChannel
      .on('broadcast', { event: 'absensi_sync' }, ({ payload }) => {
        handleIncomingBroadcast(payload);
      })
      .on('presence', { event: 'sync' }, () => {
        syncPresencePeers();
      })
      .on('presence', { event: 'join' }, () => {
        syncPresencePeers();
      })
      .on('presence', { event: 'leave' }, () => {
        syncPresencePeers();
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          isRealtimeActive = true;
          try {
            await liveRoomChannel.track({
              deviceId: DEVICE_ID,
              userName: actor.name,
              userRole: actor.role,
              deviceType: actor.deviceType,
              onlineAt: new Date().toISOString()
            });
          } catch (_) {}
          syncPresencePeers();
          updateGlobalSyncBadge();
          console.log('[LiveSync] Terhubung ke Supabase Realtime Live Room.');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          isRealtimeActive = false;
          updateGlobalSyncBadge();
          scheduleReconnect();
        }
      });

    // KANAL 2: Postgres Changes WAL (Opsional - menangkap perubahan via SQL/CLI langsung bila diaktifkan)
    pgChangesChannel = client.channel('fhisip-pg-changes-v1');
    pgChangesChannel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absensi' }, (payload) => {
        handleIncomingPostgresChange(payload);
      })
      .subscribe(() => {
        // Jika publikasi tabel belum diaktifkan di SQL Editor, kanal ini gagal diam-diam tanpa mengganggu liveRoomChannel
      });
  }

  function disconnectRealtime(clearTimers = true) {
    isRealtimeActive = false;
    onlinePeers = [];

    if (clearTimers && reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (supabaseClient) {
      try {
        if (liveRoomChannel) supabaseClient.removeChannel(liveRoomChannel);
        if (pgChangesChannel) supabaseClient.removeChannel(pgChangesChannel);
      } catch (_) {}
    }
    liveRoomChannel = null;
    pgChangesChannel = null;
  }

  function scheduleReconnect() {
    if (reconnectTimer || !isAutoSyncEnabled()) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (isAutoSyncEnabled() && navigator.onLine && !isRealtimeActive) {
        connectRealtimeChannels();
      }
    }, 4000);
  }

  // ==========================================================================
  // SMART DELTA WATCHER (Deteksi Perubahan Eksternal Hemat Kuota)
  // ==========================================================================
  async function refreshCloudMetaSnapshot() {
    const client = getClient();
    if (!client || !navigator.onLine) return null;

    const { data, count, error } = await client
      .from('absensi')
      .select('id', { count: 'exact' })
      .order('id', { ascending: false })
      .limit(1);

    if (error) return null;
    const latestId = Array.isArray(data) && data[0] ? data[0].id : 0;
    lastKnownCloudCount = typeof count === 'number' ? count : lastKnownCloudCount;
    lastKnownLatestId = latestId || lastKnownLatestId;
    return { count: lastKnownCloudCount, latestId: lastKnownLatestId };
  }

  async function checkCloudDeltaIfNeeded() {
    if (!isAutoSyncEnabled() || !navigator.onLine || isSyncInProgress) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (Date.now() - lastLocalMutationAt < 4000) return;

    try {
      if (getPendingQueue().length > 0) {
        await flushPendingQueue();
      }

      const client = getClient();
      if (!client) return;

      const { data, count, error } = await client
        .from('absensi')
        .select('id', { count: 'exact' })
        .order('id', { ascending: false })
        .limit(1);

      if (error) return;

      const cloudCount = typeof count === 'number' ? count : null;
      const cloudLatestId = Array.isArray(data) && data[0] ? data[0].id : 0;

      const hasChanged =
        (lastKnownCloudCount !== null && cloudCount !== null && cloudCount !== lastKnownCloudCount) ||
        (lastKnownLatestId !== null && cloudLatestId !== lastKnownLatestId);

      if (hasChanged && Date.now() - lastLocalMutationAt >= 4000) {
        console.log('[LiveSync] Mendeteksi delta perubahan Cloud, menarik pembaruan otomatis...');
        await pullFromSupabase({
          silent: false,
          toastMessage: '⚡ Live Sync: Data presensi terbaru dari perangkat lain berhasil dimuat!'
        });
        recordActivityLog('Menyinkronkan pembaruan data terbaru dari Cloud', 'Auto-Sync', 'remote');
      } else {
        lastKnownCloudCount = cloudCount !== null ? cloudCount : lastKnownCloudCount;
        lastKnownLatestId = cloudLatestId || lastKnownLatestId;
      }
    } catch (_) {}
  }

  function startLifecycleListeners() {
    if (deltaTimer) clearInterval(deltaTimer);
    deltaTimer = setInterval(checkCloudDeltaIfNeeded, 18000);

    if (typeof window !== 'undefined' && !window.__fhisipLiveListenersBound) {
      window.__fhisipLiveListenersBound = true;

      window.addEventListener('online', async () => {
        updateGlobalSyncBadge();
        await flushPendingQueue();
        connectRealtimeChannels();
        checkCloudDeltaIfNeeded();
      });

      window.addEventListener('offline', () => {
        isRealtimeActive = false;
        updateGlobalSyncBadge();
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isAutoSyncEnabled() && navigator.onLine) {
          if (!isRealtimeActive) connectRealtimeChannels();
          checkCloudDeltaIfNeeded();
        }
      });
    }
  }

  // ==========================================================================
  // INITIALIZATION ENTRYPOINT
  // ==========================================================================
  async function initLiveSync() {
    startLifecycleListeners();
    updateGlobalSyncBadge();

    if (!isAutoSyncEnabled() || !navigator.onLine) return;

    // 1. Hubungkan WebSocket Realtime segera
    connectRealtimeChannels();

    // 2. Tarik data otoritatif terbaru dari Supabase Cloud di latar belakang
    try {
      await pullFromSupabase({ silent: true, syncConfig: true });
    } catch (err) {
      console.warn('[LiveSync] Pemuatan awal Cloud dilewati (menggunakan cache lokal):', err.message || err);
    }
  }

  // ==========================================================================
  // UI MODAL HANDLERS
  // ==========================================================================
  async function testConnection(url, anonKey) {
    if (!window.supabase) {
      throw new Error('Library Supabase JS belum siap. Periksa koneksi internet.');
    }
    if (!url || !anonKey) {
      throw new Error('Harap masukkan URL Project dan Anon Key Supabase.');
    }

    const client = window.supabase.createClient(url, anonKey);
    const { error } = await client.from('pengaturan_jam_kerja').select('*').limit(1);

    if (error) {
      const test2 = await client.from('pegawai').select('nip').limit(1);
      if (test2.error) {
        throw new Error(`Koneksi berhasil tetapi query gagal: ${error.message}. Pastikan schema.sql sudah dijalankan.`);
      }
    }

    disconnectRealtime();
    supabaseClient = client;
    saveConfig(url, anonKey);
    connectRealtimeChannels();
    return true;
  }

  function openSupabaseModal() {
    const cfg = loadSavedConfig();
    const elUrl = document.getElementById('supabase-url');
    const elKey = document.getElementById('supabase-key');

    if (elUrl) elUrl.value = cfg.url || '';
    if (elKey) elKey.value = cfg.anonKey || '';

    refreshModalUI();
    window.app.openModal('modal-supabase');
  }

  async function handleTestConnection() {
    const url = document.getElementById('supabase-url').value.trim();
    const key = document.getElementById('supabase-key').value.trim();
    const btn = document.getElementById('btn-test-supabase');

    try {
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Menguji...'; }
      await testConnection(url, key);
      await pullFromSupabase({ silent: true, syncConfig: true });
      window.app.showToast('Koneksi Live Sync Supabase Cloud Berhasil!', 'success');
      refreshModalUI();
    } catch (err) {
      alert('Gagal terhubung ke Supabase:\n' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⚡ Simpan & Uji Koneksi'; }
    }
  }

  async function handlePull() {
    const btn = document.getElementById('btn-pull-supabase');
    try {
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Mengambil...'; }
      const count = await pullFromSupabase({ silent: true, syncConfig: true });
      recordActivityLog(`Menarik manual ${count.toLocaleString('id-ID')} data dari Cloud`, getActorInfo().name);
      window.app.showToast(`Berhasil menyinkronkan ${count.toLocaleString('id-ID')} data terbaru dari Cloud!`, 'success');
      refreshModalUI();
    } catch (err) {
      alert('Gagal mengambil data dari Supabase:\n' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⬇ Tarik Data Cloud'; }
    }
  }

  async function handlePush() {
    const btn = document.getElementById('btn-push-supabase');
    try {
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Mengunggah...'; }
      const count = await pushToSupabase();
      window.app.showToast(`Berhasil mengunggah & menyiarkan ${count.toLocaleString('id-ID')} data ke semua perangkat!`, 'success');
      refreshModalUI();
    } catch (err) {
      alert('Gagal mengunggah data ke Supabase:\n' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⬆ Unggah ke Cloud'; }
    }
  }

  async function handleSyncNow() {
    const btn = document.getElementById('btn-sync-now-supabase');
    try {
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Menyinkronkan...'; }
      await flushPendingQueue();
      if (!isRealtimeActive && isAutoSyncEnabled()) {
        connectRealtimeChannels();
      }
      const count = await pullFromSupabase({ silent: true, syncConfig: true });
      window.app.showToast(`🔄 Sinkronisasi selesai! ${count.toLocaleString('id-ID')} data presensi mutakhir.`, 'success');
      refreshModalUI();
    } catch (err) {
      window.app.showToast('Gagal menyinkronkan: ' + err.message, 'danger');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Sinkronkan Sekarang'; }
    }
  }

  // Expose Public API
  window.supabaseSync = {
    initLiveSync,
    openModal: openSupabaseModal,
    testConnection: handleTestConnection,
    pull: handlePull,
    push: handlePush,
    syncNow: handleSyncNow,
    pullData: pullFromSupabase,
    pushData: pushToSupabase,
    replaceAllInCloud,
    deleteRecordFromCloud,
    updateRecordInCloud,
    syncConfigToCloud,
    setAutoSyncEnabled,
    isAutoSyncEnabled,
    isRealtimeConnected: () => isRealtimeActive,
    getOnlinePeers: () => [...onlinePeers],
    getClient
  };

})();
