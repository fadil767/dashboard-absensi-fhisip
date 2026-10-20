/**
 * MODUL IMPORT EXCEL & PEMINDAIAN BIOMETRIK FHISIP UT
 * Mendukung format:
 * 1. Format Mesin Biometrik Scan Fingerprint / RFID ("Data Scan Karyawan" .xls/.xlsx)
 * 2. Format Spreadsheet Tabular Standar (.xlsx, .xls, .csv)
 */

(function () {
  'use strict';

  let stagedImportData = [];
  let stagedFileType = '';
  let stagedFileName = '';

  // Header column aliases for tabular format
  const HEADER_ALIASES = {
    nip: ['nip', 'nidn', 'pin', 'id pegawai', 'no pegawai', 'nomor induk', 'nip/nidn'],
    nama: ['nama', 'nama pegawai', 'nama lengkap', 'pegawai', 'name', 'employee name'],
    unit: ['unit', 'unit kerja', 'prodi', 'program studi', 'bagian', 'department'],
    tanggal: ['tanggal', 'tgl', 'date', 'hari/tanggal', 'tanggal presensi', 'tanggal absen'],
    jam_masuk: ['jam masuk', 'masuk', 'jam datang', 'datang', 'check in', 'checkin', 'scan masuk', 'clock in'],
    jam_pulang: ['jam pulang', 'pulang', 'keluar', 'check out', 'checkout', 'scan pulang', 'clock out'],
    status: ['status', 'status kehadiran', 'status absen', 'kehadiran'],
    keterangan: ['keterangan', 'catatan', 'ket', 'note', 'notes', 'alasan']
  };

  /**
   * Menangani pemilihan / drop berkas Excel
   */
  async function handleFileSelect(file) {
    if (!file) return;

    stagedFileName = file.name;
    const ext = file.name.split('.').pop().toLowerCase();

    if (!['xls', 'xlsx', 'csv'].includes(ext)) {
      alert('Format berkas tidak didukung. Harap unggah file dengan format .xls, .xlsx, atau .csv');
      return;
    }

    try {
      showLoading(true);

      const buffer = await file.arrayBuffer();
      let wb;

      if (ext === 'csv') {
        const text = new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '');
        wb = XLSX.read(text, { type: 'string', raw: true });
      } else {
        wb = XLSX.read(buffer, { type: 'array', cellDates: false });
      }

      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) {
        throw new Error('Sheet kosong atau tidak dapat dibaca.');
      }

      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      if (!rows || rows.length === 0) {
        throw new Error('Tidak ada data dalam berkas.');
      }

      // Deteksi apakah format Mesin Biometrik ("Data Scan Karyawan") atau Tabular Standar
      if (isBiometricMachineScan(rows)) {
        stagedFileType = 'Format Mesin Biometrik Scan (Data Scan Karyawan FHISIP)';
        stagedImportData = parseBiometricScan(rows, window.app.getPegawaiList());
      } else {
        stagedFileType = 'Format Spreadsheet Tabular Standar';
        stagedImportData = parseTabularSpreadsheet(rows, window.app.getPegawaiList());
      }

      showLoading(false);

      if (stagedImportData.length === 0) {
        alert('Gagal mendeteksi data kehadiran valid dalam berkas. Periksa kembali struktur file Anda.');
        return;
      }

      // Tampilkan Preview di Modal
      displayImportPreview(stagedImportData, stagedFileType, stagedFileName);

    } catch (err) {
      showLoading(false);
      console.error('Error parsing file:', err);
      alert('Terjadi kesalahan saat memproses berkas Excel: ' + err.message);
    }
  }

  /**
   * Memeriksa apakah sheet menggunakan format matriks mesin biometrik
   */
  function isBiometricMachineScan(rows) {
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const r = rows[i] || [];
      for (const c of r) {
        if (typeof c === 'string' && (c.includes('Data Scan Karyawan') || c.includes('Scan Karyawan'))) {
          return true;
        }
      }
    }
    for (let i = 0; i < Math.min(25, rows.length); i++) {
      const r = rows[i] || [];
      if (r[9] != null && typeof r[9] === 'number' && Number.isInteger(r[9]) && r[14]) {
        return true;
      }
    }
    return false;
  }

  /**
   * Parser untuk format laporan mesin pemindai biometrik (seperti 19102026_Rekap Absensi.xls)
   */
  function parseBiometricScan(rows, pegawaiList) {
    const byName = new Map();
    const byNip = new Map();

    for (const p of pegawaiList) {
      if (p.nip) byNip.set(String(p.nip).trim(), p);
      if (p.nama_lengkap) byName.set(p.nama_lengkap.toLowerCase().trim(), p);
    }

    // Cari rentang tahun dari judul file (misal "Dari 01-10-2026 s/d 31-10-2026")
    let defaultYear = new Date().getFullYear();
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const r = rows[i] || [];
      for (const c of r) {
        if (typeof c === 'string' && c.includes('s/d')) {
          const m = /(\d{2})-(\d{2})-(\d{4})/.exec(c);
          if (m) defaultYear = Number(m[3]);
        }
      }
    }

    const results = [];
    let currentEmp = null;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;

      const pinVal = row[9];
      const nameVal = row[14];
      const unitVal = row[2];

      // Baris Header Karyawan: PIN di kolom 9, Nama di kolom 14, Unit di kolom 2
      if (pinVal != null && nameVal && typeof nameVal === 'string') {
        const pinStr = String(pinVal).trim();
        const rawName = String(nameVal).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
        const rawUnit = unitVal ? String(unitVal).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim() : '';

        // Cocokkan dengan pegawai yang ada di sistem
        const cleanNameLower = rawName.toLowerCase();
        let matchedPeg = byName.get(cleanNameLower) || pegawaiList.find(p => {
          const pName = (p.nama_lengkap || '').toLowerCase();
          return pName.includes(cleanNameLower) || cleanNameLower.includes(pName);
        });

        currentEmp = {
          pin: pinStr,
          nama: matchedPeg ? matchedPeg.nama_lengkap : rawName,
          nip: matchedPeg ? matchedPeg.nip : ('PIN-' + pinStr),
          unit: matchedPeg ? matchedPeg.unit_kerja : (rawUnit || 'FHISIP')
        };
        continue;
      }

      if (currentEmp) {
        // Cek apakah baris ini berisi header tanggal (format MM/DD Hari, misal "10/01 Thu")
        const dateCols = [];
        for (let c = 0; c < row.length; c++) {
          const val = row[c];
          if (typeof val === 'string') {
            const m = /^(\d{2})\/(\d{2})\s+[A-Za-z]{3}$/.exec(val.trim());
            if (m) dateCols.push({ col: c, month: m[1], day: m[2] });
          }
        }

        if (dateCols.length > 0) {
          // Baris berikutnya setelah tanggal adalah baris nilai pemindaian (scan times)
          const scanRow = rows[r + 1] || [];
          for (const dc of dateCols) {
            const cellVal = scanRow[dc.col];
            const ymd = `${defaultYear}-${dc.month}-${dc.day}`;

            let masuk = null;
            let pulang = null;
            let hasScan = false;

            // Jika nilai berupa pecahan serial Excel (contoh: 0.3020833333333333)
            if (typeof cellVal === 'number') {
              const frac = cellVal - Math.floor(cellVal);
              const mins = Math.round(frac * 1440) % 1440;
              const hh = String(Math.floor(mins / 60)).padStart(2, '0');
              const mm = String(mins % 60).padStart(2, '0');
              const t = `${hh}:${mm}`;
              if (mins < 720) masuk = t; else pulang = t;
              hasScan = true;
            } else if (cellVal) {
              const s = String(cellVal).replace(/\r?\n/g, ' ').trim();
              if (s && s !== '-' && s !== '     -     ') {
                // Pola 1: Jam Masuk dan Pulang lengkap "06:57-16:33"
                const mBoth = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(s);
                if (mBoth) {
                  masuk = mBoth[1].padStart(5, '0');
                  pulang = mBoth[2].padStart(5, '0');
                  hasScan = true;
                } else {
                  // Pola 2: Masuk saja "07:15-"
                  const mIn = /(\d{1,2}:\d{2})\s*-/.exec(s);
                  if (mIn) {
                    masuk = mIn[1].padStart(5, '0');
                    hasScan = true;
                  } else {
                    // Pola 3: Pulang saja "-16:35"
                    const mOut = /-\s*(\d{1,2}:\d{2})/.exec(s);
                    if (mOut) {
                      pulang = mOut[1].padStart(5, '0');
                      hasScan = true;
                    } else {
                      // Pola 4: Satu jam tunggal
                      const mSingle = /(\d{1,2}:\d{2})/.exec(s);
                      if (mSingle) {
                        const t = mSingle[1].padStart(5, '0');
                        const [hh] = t.split(':').map(Number);
                        if (hh < 12) masuk = t; else pulang = t;
                        hasScan = true;
                      }
                    }
                  }
                }
              }
            }

            if (hasScan) {
              results.push({
                id: Date.now() + results.length + Math.floor(Math.random() * 1000),
                nip: currentEmp.nip,
                nama_lengkap: currentEmp.nama,
                unit_kerja: currentEmp.unit,
                tanggal: ymd,
                jam_masuk: masuk,
                jam_pulang: pulang,
                status_kehadiran: 'Hadir',
                keterangan: 'Import Rekap Mesin Presensi'
              });
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Parser untuk format spreadsheet tabular standar
   */
  function parseTabularSpreadsheet(rows, pegawaiList) {
    if (rows.length < 2) return [];

    // Cari baris header
    let headerRowIdx = -1;
    let colMap = {};

    for (let r = 0; r < Math.min(10, rows.length); r++) {
      const row = rows[r] || [];
      const testMap = {};
      row.forEach((cell, cIdx) => {
        if (!cell) return;
        const norm = String(cell).toLowerCase().trim().replace(/[_\-]+/g, ' ');
        for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
          if (testMap[key] == null && aliases.includes(norm)) {
            testMap[key] = cIdx;
          }
        }
      });

      if (testMap.tanggal != null && (testMap.nip != null || testMap.nama != null)) {
        headerRowIdx = r;
        colMap = testMap;
        break;
      }
    }

    if (headerRowIdx === -1) {
      throw new Error('Format kolom tidak dikenali. Pastikan terdapat kolom Tanggal dan NIP atau Nama.');
    }

    const byNip = new Map(pegawaiList.map(p => [String(p.nip).trim(), p]));
    const byName = new Map(pegawaiList.map(p => [(p.nama_lengkap || '').toLowerCase().trim(), p]));

    const results = [];

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const rawNip = colMap.nip != null ? String(row[colMap.nip] || '').trim().replace(/^'/, '') : '';
      const rawNama = colMap.nama != null ? String(row[colMap.nama] || '').trim() : '';
      const rawTgl = colMap.tanggal != null ? row[colMap.tanggal] : null;

      if (!rawTgl && !rawNip && !rawNama) continue;

      const matchedPeg = byNip.get(rawNip) || byName.get(rawNama.toLowerCase());
      const nip = rawNip || (matchedPeg ? matchedPeg.nip : 'PEG-' + Math.floor(Math.random() * 10000));
      const nama = rawNama || (matchedPeg ? matchedPeg.nama_lengkap : 'Pegawai FHISIP');
      const unit = (colMap.unit != null && row[colMap.unit]) ? String(row[colMap.unit]).trim() : (matchedPeg ? matchedPeg.unit_kerja : 'FHISIP');

      // Parsing Tanggal
      let tanggal = formatParsedDate(rawTgl);
      if (!tanggal) continue;

      const masuk = colMap.jam_masuk != null ? formatParsedTime(row[colMap.jam_masuk]) : null;
      const pulang = colMap.jam_pulang != null ? formatParsedTime(row[colMap.jam_pulang]) : null;
      const status = colMap.status != null && row[colMap.status] ? String(row[colMap.status]).trim() : 'Hadir';
      const ket = colMap.keterangan != null && row[colMap.keterangan] ? String(row[colMap.keterangan]).trim() : 'Import Tabular';

      results.push({
        id: Date.now() + results.length + Math.floor(Math.random() * 1000),
        nip,
        nama_lengkap: nama,
        unit_kerja: unit,
        tanggal,
        jam_masuk: masuk,
        jam_pulang: pulang,
        status_kehadiran: status,
        keterangan: ket
      });
    }

    return results;
  }

  function formatParsedDate(v) {
    if (!v) return null;
    if (typeof v === 'number') {
      const p = v >= 1 && v < 2958466 ? XLSX.SSF.parse_date_code(v) : null;
      if (!p) return null;
      return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    }
    const s = String(v).trim().split(' ')[0];
    let r;
    if ((r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) {
      return `${r[1]}-${r[2].padStart(2, '0')}-${r[3].padStart(2, '0')}`;
    }
    if ((r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) {
      return `${r[3]}-${r[2].padStart(2, '0')}-${r[1].padStart(2, '0')}`;
    }
    return s;
  }

  function formatParsedTime(v) {
    if (!v || String(v).trim() === '-' || String(v).trim() === '') return null;
    if (typeof v === 'number') {
      const frac = v - Math.floor(v);
      const mins = Math.round(frac * 1440) % 1440;
      const hh = String(Math.floor(mins / 60)).padStart(2, '0');
      const mm = String(mins % 60).padStart(2, '0');
      return `${hh}:${mm}`;
    }
    const s = String(v).trim().replace('.', ':');
    const m = /(\d{1,2}:\d{2})/.exec(s);
    if (m) return m[1].padStart(5, '0');
    return null;
  }

  /**
   * Menampilkan dialog pratinjau import data
   */
  function displayImportPreview(data, fileType, fileName) {
    const elModal = document.getElementById('modal-import-preview');
    if (!elModal) return;

    document.getElementById('import-file-name').textContent = fileName;
    document.getElementById('import-file-type').textContent = fileType;
    document.getElementById('import-total-count').textContent = data.length.toLocaleString('id-ID');

    // Analisis Pegawai Unik & Tanggal
    const uniqueNip = new Set(data.map(d => d.nip));
    const uniqueDates = [...new Set(data.map(d => d.tanggal))].sort();

    document.getElementById('import-pegawai-count').textContent = uniqueNip.size.toLocaleString('id-ID');
    document.getElementById('import-date-range').textContent = uniqueDates.length > 0 
      ? `${uniqueDates[0]} s/d ${uniqueDates[uniqueDates.length - 1]} (${uniqueDates.length} hari)`
      : '-';

    // Render 10 baris pertama sampel pratinjau
    const tbody = document.getElementById('import-preview-tbody');
    const previewRows = data.slice(0, 10);

    tbody.innerHTML = previewRows.map((r, i) => {
      return `
        <tr>
          <td style="text-align:center;">${i + 1}</td>
          <td><strong>${r.tanggal}</strong></td>
          <td>${escapeHtml(r.nip)}</td>
          <td><strong>${escapeHtml(r.nama_lengkap)}</strong></td>
          <td><small>${escapeHtml(r.unit_kerja)}</small></td>
          <td style="text-align:center;"><code>${r.jam_masuk || '-'}</code></td>
          <td style="text-align:center;"><code>${r.jam_pulang || '-'}</code></td>
        </tr>
      `;
    }).join('');

    // Buka modal
    window.app.openModal('modal-import-preview');
  }

  /**
   * Melakukan commit / penyimpanan data yang diimpor ke aplikasi
   */
  function commitImport(mode = 'replace') {
    if (!stagedImportData || stagedImportData.length === 0) return;

    if (mode === 'replace') {
      if (!confirm(`Konfirmasi: Menggantikan seluruh data presensi yang ada saat ini dengan ${stagedImportData.length} data baru dari file "${stagedFileName}"?`)) {
        return;
      }
      window.app.setAbsensiList([...stagedImportData]);
    } else {
      // Append mode: gabungkan
      const current = window.app.getAbsensiList();
      const existingKeys = new Set(current.map(c => `${c.nip}|${c.tanggal}`));
      let added = 0;
      const combined = [...current];

      stagedImportData.forEach(item => {
        const key = `${item.nip}|${item.tanggal}`;
        if (!existingKeys.has(key)) {
          combined.push(item);
          existingKeys.add(key);
          added++;
        }
      });

      window.app.setAbsensiList(combined);
    }

    window.app.closeModal('modal-import-preview');
    window.app.evaluateAndRender();
    window.app.showToast(`Berhasil mengimpor ${stagedImportData.length} data presensi (${stagedFileName})!`, 'success');
  }

  function showLoading(show) {
    const el = document.getElementById('import-loading-indicator');
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- INITIALIZATION ---
  function init() {
    const fileInput = document.getElementById('input-file-excel');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFileSelect(file);
      });
    }

    // Drag and drop zone
    const dropZone = document.getElementById('import-dropzone');
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });

      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
      });
    }
  }

  window.excelImport = {
    init,
    handleFileSelect,
    commitImport
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
