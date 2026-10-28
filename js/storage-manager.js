/**
 * MODUL STORAGE MANAGER & SISTEM PERSISTENSI DATA MULTI-PERANGKAT
 * Dashboard Rekapitulasi Presensi Pegawai FHISIP Universitas Terbuka
 * 
 * Sistem penyimpanan & sinkronisasi bertingkat (Quad-Tier Defense):
 * 1. IndexedDB (Database Browser Utama - Kuota besar, transaksi aman)
 * 2. LocalStorage (Cache sinkron cepat & fallback instan)
 * 3. Server-side API & SSE (/api/absensi & /api/events pada server Node lokal/LAN)
 * 4. Multi-tab Synchronization (BroadcastChannel) + Supabase Cloud Realtime
 */

(function () {
  'use strict';

  // --- STORAGE KEYS & CONSTANTS ---
  const DB_NAME = 'UT_FHISIP_Absensi_DB_v2';
  const DB_VERSION = 1;
  const STORE_NAME = 'app_store';

  const STORAGE_KEY_ABSENSI = 'ut_fhisip_absensi_data_v2';
  const STORAGE_KEY_CONFIG = 'ut_fhisip_config_v1';
  const STORAGE_KEY_META = 'ut_fhisip_meta_v2';

  // Unique tab/instance client ID untuk mencegah echo loop saat live sync
  const CLIENT_ID = 'client_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  // Debounce timer for server sync
  let serverSyncTimer = null;
  let broadcastChannel = null;
  let localSseSource = null;
  let localApiAvailable = null; // null = unknown, true = node server active, false = static host

  // State indikator live sync agar tidak tertimpa label statis setelah simpan lokal
  let liveSyncState = {
    isLive: false,
    onlineCount: 1,
    customLabel: null
  };

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      broadcastChannel = new BroadcastChannel('ut_fhisip_sync_channel');
    }
  } catch (e) {
    console.warn('[StorageManager] BroadcastChannel tidak didukung:', e);
  }

  function getActiveUserActor() {
    try {
      const s = localStorage.getItem('ut_fhisip_session');
      if (s) {
        const parsed = JSON.parse(s);
        return {
          name: parsed.name || 'Pengguna FHISIP',
          role: parsed.role || 'Pegawai',
          username: parsed.username || 'user'
        };
      }
    } catch (_) {}
    return { name: 'Admin FHISIP UT', role: 'Administrator', username: 'admin' };
  }

  // ==========================================================================
  // INDEXEDDB ENGINE (Native Promise-based)
  // ==========================================================================
  let dbPromise = null;

  function getDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return resolve(null);
      }

      try {
        const req = window.indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };

        req.onsuccess = (event) => {
          resolve(event.target.result);
        };

        req.onerror = (event) => {
          console.warn('[StorageManager] Gagal membuka IndexedDB:', event.target ? event.target.error : event);
          resolve(null);
        };
      } catch (err) {
        console.warn('[StorageManager] Exception membuka IndexedDB:', err);
        resolve(null);
      }
    });

    return dbPromise;
  }

  async function idbGet(key) {
    try {
      const db = await getDB();
      if (!db) return null;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return null;
    }
  }

  async function idbSet(key, val) {
    try {
      const db = await getDB();
      if (!db) return false;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(val, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn(`[StorageManager] Gagal menulis ke IndexedDB [${key}]:`, e);
      return false;
    }
  }

  async function idbClear() {
    try {
      const db = await getDB();
      if (!db) return false;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return false;
    }
  }

  // ==========================================================================
  // METADATA TRACKING
  // ==========================================================================
  function getMeta() {
    try {
      const s = localStorage.getItem(STORAGE_KEY_META);
      if (s) return JSON.parse(s);
    } catch (e) {
      console.warn('[StorageManager] Gagal membaca metadata:', e);
    }
    return {
      isInitialized: false,
      isUserModified: false,
      lastModified: null,
      count: 0,
      version: '2.1'
    };
  }

  function setMeta(metaUpdates) {
    const current = getMeta();
    const updated = {
      ...current,
      ...metaUpdates,
      lastModified: new Date().toISOString()
    };
    try {
      localStorage.setItem(STORAGE_KEY_META, JSON.stringify(updated));
    } catch (e) {
      console.warn('[StorageManager] Gagal menyimpan metadata ke localStorage:', e);
    }
    idbSet('meta', updated);
    return updated;
  }

  // ==========================================================================
  // LOCALSTORAGE SYNCHRONOUS ACCESS
  // ==========================================================================
  function getSyncAbsensi() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ABSENSI);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('[StorageManager] Gagal membaca sync absensi dari localStorage:', e);
    }
    return null;
  }

  function setSyncAbsensi(records) {
    try {
      localStorage.setItem(STORAGE_KEY_ABSENSI, JSON.stringify(records));
      return true;
    } catch (e) {
      console.warn('[StorageManager] Peringatan: localStorage penuh atau dibatasi:', e);
      return false;
    }
  }

  // ==========================================================================
  // SERVER API SYNC & LOCAL LAN LIVE SSE (/api/absensi & /api/events)
  // ==========================================================================
  async function fetchServerAbsensi() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1800);
      const res = await fetch('/api/absensi', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        localApiAvailable = true;
        initLocalServerSSE();
      } else {
        localApiAvailable = false;
      }

      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data && Array.isArray(data.absensi) && data.absensi.length > 0) {
          return data;
        }
      }
    } catch (e) {
      localApiAvailable = false;
    }
    return null;
  }

  function initLocalServerSSE() {
    if (localSseSource || typeof EventSource === 'undefined' || localApiAvailable === false) return;
    try {
      localSseSource = new EventSource('/api/events');

      localSseSource.addEventListener('sync', async (ev) => {
        try {
          const payload = JSON.parse(ev.data || '{}');
          if (payload.clientId && payload.clientId === CLIENT_ID) return; // Abaikan echo dari diri sendiri

          if (payload.type === 'SERVER_DATA_UPDATED') {
            // Jika Supabase Realtime sudah aktif, biarkan Supabase yang mengatur agar tidak duplikat notifikasi
            if (window.supabaseSync && window.supabaseSync.isRealtimeConnected && window.supabaseSync.isRealtimeConnected()) {
              return;
            }
            const serverData = await fetchServerAbsensi();
            if (serverData && Array.isArray(serverData.absensi) && window.app && typeof window.app.applyRemoteDataset === 'function') {
              const actorName = payload.actor && payload.actor.name ? payload.actor.name : 'Perangkat Lain (LAN)';
              window.app.applyRemoteDataset(
                serverData.absensi,
                payload.actor || { name: actorName },
                `⚡ Live Update Jaringan Lokal dari ${actorName} (${serverData.absensi.length.toLocaleString('id-ID')} data)`
              );
            }
          }
        } catch (err) {
          console.warn('[StorageManager] Gagal memproses SSE sync:', err);
        }
      });

      localSseSource.onerror = () => {
        if (localSseSource && localSseSource.readyState === EventSource.CLOSED) {
          localSseSource = null;
        }
      };
    } catch (e) {
      localSseSource = null;
    }
  }

  function pushToServerDebounced(records, config) {
    if (localApiAvailable === false) return;
    if (serverSyncTimer) clearTimeout(serverSyncTimer);

    serverSyncTimer = setTimeout(async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const res = await fetch('/api/absensi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: CLIENT_ID,
            actor: getActiveUserActor(),
            absensi: records,
            config: config || null,
            meta: getMeta()
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          localApiAvailable = true;
          initLocalServerSSE();
          console.log('[StorageManager] Data berhasil disinkronkan ke server lokal disk.');
        } else {
          localApiAvailable = false;
        }
      } catch (e) {
        // Silently skip if server API is unavailable (e.g. Vercel Edge static)
      }
    }, 500);
  }

  // ==========================================================================
  // STATUS BADGE UI INDICATOR
  // ==========================================================================
  function setLiveSyncStatus(isLive, onlineCount = 1, customLabel = null) {
    liveSyncState.isLive = Boolean(isLive);
    liveSyncState.onlineCount = Math.max(1, Number(onlineCount) || 1);
    liveSyncState.customLabel = customLabel;
    renderRestingBadge();
  }

  function renderRestingBadge() {
    if (liveSyncState.isLive) {
      const label = liveSyncState.customLabel || (
        liveSyncState.onlineCount > 1
          ? `Live Sync • ${liveSyncState.onlineCount} Perangkat Online`
          : 'Live Sync Cloud Aktif'
      );
      updateStatusBadge(label, 'live');
    } else if (liveSyncState.customLabel) {
      updateStatusBadge(liveSyncState.customLabel, 'warning');
    } else {
      updateStatusBadge('Data Tersimpan Permanen', 'saved');
    }
  }

  function updateStatusBadge(statusText, type = 'success') {
    if (typeof document === 'undefined') return;
    const elPill = document.getElementById('storage-status-pill');
    const elLabel = document.getElementById('storage-status-label');
    if (!elPill || !elLabel) return;

    elLabel.textContent = statusText;

    elPill.className = 'storage-status-pill';
    if (type === 'saving') {
      elPill.classList.add('saving');
    } else if (type === 'warning') {
      elPill.classList.add('warning');
    } else if (type === 'live') {
      elPill.classList.add('live');
    } else {
      elPill.classList.add('saved');
    }
  }

  // ==========================================================================
  // PUBLIC STORAGE MANAGER INTERFACE
  // ==========================================================================
  const StorageManager = {
    CLIENT_ID,
    KEYS: {
      ABSENSI: STORAGE_KEY_ABSENSI,
      CONFIG: STORAGE_KEY_CONFIG,
      META: STORAGE_KEY_META
    },

    /**
     * Memuat data absensi secara cerdas & stabil:
     * 1. Ambil data dari localStorage (langsung tersedia tanpa lag)
     * 2. Jika kosong, periksa IndexedDB
     * 3. Jika tersedia Server API lokal, inisialisasi SSE & cek data
     * 4. Jika masih kosong, inisialisasi dari window.INITIAL_FHISIP_DATA
     */
    async loadAbsensiInitial(defaultData = []) {
      const meta = getMeta();

      // Probe server lokal di latar belakang (juga mengaktifkan SSE jika server Node aktif)
      const serverPromise = fetchServerAbsensi();

      // 1. Cek synchronous localStorage
      let list = getSyncAbsensi();

      // 2. Jika localStorage kosong tapi pernah diinisialisasi, coba IndexedDB
      if (!list || !Array.isArray(list)) {
        try {
          const fromIdb = await idbGet('absensi');
          if (fromIdb && Array.isArray(fromIdb) && fromIdb.length > 0) {
            list = fromIdb;
            setSyncAbsensi(list);
            console.log(`[StorageManager] Pulihkan ${list.length} data dari IndexedDB.`);
          }
        } catch (e) {
          console.warn('[StorageManager] Gagal membaca dari IndexedDB saat inisialisasi:', e);
        }
      }

      // 3. Periksa Server API lokal
      const serverData = await serverPromise;
      if ((!list || !Array.isArray(list)) && serverData && Array.isArray(serverData.absensi)) {
        list = serverData.absensi;
        setSyncAbsensi(list);
        await idbSet('absensi', list);
        setMeta({ isInitialized: true, isUserModified: true, count: list.length });
        console.log(`[StorageManager] Menggunakan data dari Server Lokal Disk (${list.length} rekaman).`);
        renderRestingBadge();
        return list;
      }

      // 4. Jika pengguna sudah memiliki data tersimpan
      if (list && Array.isArray(list) && (meta.isInitialized || list.length > 0)) {
        console.log(`[StorageManager] Memuat data stabil pengguna (${list.length} rekaman, termodifikasi: ${meta.isUserModified}).`);
        renderRestingBadge();
        idbSet('absensi', list).catch(() => {});
        return list;
      }

      // 5. Fresh first-time visit: Inisialisasi awal dengan data bawaan resmi FHISIP
      const initialBaseline = Array.isArray(defaultData) ? [...defaultData] : [];
      setSyncAbsensi(initialBaseline);
      await idbSet('absensi', initialBaseline);
      setMeta({
        isInitialized: true,
        isUserModified: false,
        count: initialBaseline.length
      });

      console.log(`[StorageManager] Inisialisasi database bawaan resmi (${initialBaseline.length} rekaman).`);
      renderRestingBadge();
      return initialBaseline;
    },

    /**
     * Menyimpan perubahan data absensi ke seluruh lapisan penyimpanan
     * @param {Array} records Array data presensi terbaru
     * @param {Object} options Opsi { isUserModified, notifyTabs, skipServerPush, silentBadge }
     */
    async saveAbsensi(records, options = {}) {
      if (!Array.isArray(records)) return false;

      if (!options.silentBadge) {
        updateStatusBadge('Menyimpan & Sinkron...', 'saving');
      }

      const isModified = options.isUserModified !== undefined ? options.isUserModified : true;

      // 1. Simpan ke LocalStorage untuk akses sinkron cepat
      setSyncAbsensi(records);

      // 2. Simpan ke IndexedDB untuk ketahanan kapasitas besar (>50MB)
      try {
        await idbSet('absensi', records);
      } catch (e) {
        console.warn('[StorageManager] Gagal menyimpan ke IndexedDB:', e);
      }

      // 3. Perbarui metadata
      setMeta({
        isInitialized: true,
        isUserModified: isModified,
        count: records.length
      });

      // 4. Sinkronisasi ke disk server lokal di latar belakang jika bukan dari event eksternal
      if (!options.skipServerPush) {
        pushToServerDebounced(records);
      }

      // 5. Beritahukan tab browser lain jika dibuka bersamaan
      if (options.notifyTabs !== false && broadcastChannel) {
        try {
          broadcastChannel.postMessage({
            type: 'DATA_UPDATED',
            clientId: CLIENT_ID,
            count: records.length,
            timestamp: Date.now()
          });
        } catch (_) {}
      }

      if (!options.silentBadge) {
        setTimeout(() => {
          renderRestingBadge();
        }, 350);
      }

      return true;
    },

    /**
     * Memuat konfigurasi aturan jam kerja
     */
    loadConfig(defaultConfig) {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
        if (saved) {
          return { ...defaultConfig, ...JSON.parse(saved) };
        }
      } catch (e) {
        console.warn('[StorageManager] Gagal memuat konfigurasi:', e);
      }
      return { ...defaultConfig };
    },

    /**
     * Menyimpan konfigurasi aturan jam kerja
     */
    saveConfig(config, options = {}) {
      try {
        localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
        idbSet('config', config).catch(() => {});
        if (options.notifyTabs !== false && broadcastChannel) {
          broadcastChannel.postMessage({
            type: 'CONFIG_UPDATED',
            clientId: CLIENT_ID,
            config,
            timestamp: Date.now()
          });
        }
      } catch (e) {
        console.warn('[StorageManager] Gagal menyimpan konfigurasi:', e);
      }
    },

    /**
     * Reset seluruh data kembali ke database resmi awal
     */
    async resetToDefault(initialRecords, initialConfig) {
      localStorage.removeItem(STORAGE_KEY_ABSENSI);
      localStorage.removeItem(STORAGE_KEY_CONFIG);
      localStorage.removeItem(STORAGE_KEY_META);

      await idbClear();

      if (localApiAvailable !== false) {
        try {
          fetch('/api/absensi', { method: 'DELETE' }).catch(() => {});
        } catch (_) {}
      }

      const baseline = Array.isArray(initialRecords) ? [...initialRecords] : [];
      setSyncAbsensi(baseline);
      await idbSet('absensi', baseline);
      if (initialConfig) {
        localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(initialConfig));
        await idbSet('config', initialConfig);
      }

      setMeta({
        isInitialized: true,
        isUserModified: false,
        count: baseline.length
      });

      if (broadcastChannel) {
        try {
          broadcastChannel.postMessage({
            type: 'DATA_RESET',
            clientId: CLIENT_ID,
            timestamp: Date.now()
          });
        } catch (_) {}
      }

      renderRestingBadge();
      return baseline;
    },

    getMeta,
    getActiveUserActor,
    setLiveSyncStatus,
    updateStatusBadge
  };

  window.StorageManager = StorageManager;

})();
