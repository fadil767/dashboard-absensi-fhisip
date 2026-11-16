/**
 * Mesin Pemahaman Bahasa Alami Deterministik Khusus Pengelola SDM FHISIP UT (Opsi 2 — Gratis Rp 0)
 * Menafsirkan perintah Bahasa Indonesia SDM tanpa LLM eksternal maupun AI Gateway:
 * - Tier 1: Pencarian pegawai, ringkasan periode, audit keterlambatan/anomali, cek rekap Excel, simulasi jam kerja, filter UI.
 * - Tier 2: Penyusunan draf presensi (1 hari atau rentang tanggal) & draf ubah kebijakan (wajib persetujuan manusia).
 * - Tier 3: Pemblokiran penuh aksi hapus / reset database melalui asisten.
 */

import {
  DEFAULT_CONFIG,
  filterEvaluatedRecords,
  computeEmployeeBreakdown,
  searchEmployees,
  summarizePeriod,
  simulatePolicy,
  buildAttendanceDraft,
  parseYmdParts
} from './fhisip-agent-rules.mjs';

const MONTH_TOKEN_MAP = {
  januari: '01', jan: '01',
  februari: '02', pebruari: '02', feb: '02',
  maret: '03', mar: '03',
  april: '04', apr: '04',
  mei: '05',
  juni: '06', jun: '06',
  juli: '07', jul: '07',
  agustus: '08', agu: '08', agt: '08', aug: '08',
  september: '09', sept: '09', sep: '09',
  oktober: '10', okt: '10', oct: '10',
  november: '11', nopember: '11', nov: '11',
  desember: '12', des: '12', dec: '12'
};

const MONTH_DISPLAY_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const TITLE_STOPWORDS = new Set([
  'dr', 'drs', 'dra', 'prof', 'ir', 'h', 'hj', 'sh', 's.h', 'sm', 's.m',
  'se', 's.e', 'si', 's.i', 'sip', 's.ip', 'ssos', 's.sos', 'spsi', 's.psi',
  'skom', 's.kom', 'sap', 's.ap', 'sp', 's.p', 'shum', 's.hum', 'sikom', 's.ikom',
  'msi', 'm.si', 'mh', 'm.h', 'ma', 'm.a', 'mkom', 'm.kom', 'mikom', 'm.ikom',
  'med', 'm.ed', 'map', 'm.ap', 'mip', 'm.ip', 'mm', 'm.m', 'llm', 'll.m', 'phd'
]);

const GENERIC_QUERY_STOPWORDS = new Set([
  'siapa', 'saja', 'pegawai', 'dengan', 'yang', 'atau', 'dan', 'di', 'pada', 'ke', 'untuk',
  'dari', 'bulan', 'periode', 'tanggal', 'tgl', 'tahun', 'jam', 'menit', 'tolong', 'coba',
  'tampilkan', 'lihat', 'cek', 'cari', 'rekap', 'ringkasan', 'status', 'disiplin', 'presensi',
  'absensi', 'data', 'buatkan', 'buat', 'tambah', 'tambahkan', 'input', 'ajukan', 'catat',
  'draf', 'draft', 'cuti', 'izin', 'ijin', 'sakit', 'dinas', 'luar', 'lembur', 'hadir',
  'terlambat', 'telat', 'pulang', 'cepat', 'belum', 'scan', 'tanpa', 'keterangan', 'alpha',
  'simulasi', 'simulasikan', 'dampak', 'ubah', 'ganti', 'menjadi', 'batas', 'masuk',
  'toleransi', 'kebijakan', 'terbanyak', 'paling', 'sering', 'lewati', 'skip', 'weekend',
  'sabtu', 'minggu', 'semua', 'hari', 'kali', 'lebih', 'minimal', 'berapa', 'resmi',
  'tabel', 'dashboard', 'filter', 'tab', 'wib', 's/d', 'sd', 'sampai', 'hingga', 'ini', 'itu',
  'bagian', 'fakultas', 'prodi', 'unit', 'fhisip', 'karyawan', 'dosen', 'administrasi',
  'kemarin', 'besok', 'selama', 'sekarang', 'tolong', 'mohon', 'berikan', 'cariin', 'atas', 'nama'
]);

function normalizeTextForName(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[.,/()'"`:;-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCleanNameTokens(fullName) {
  return normalizeTextForName(fullName)
    .split(' ')
    .filter(t => t && t.length >= 2 && !TITLE_STOPWORDS.has(t));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatMonthLabel(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return 'Semua Periode';
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_DISPLAY_NAMES[m - 1] || ym} ${y}`;
}

function getLatestPopulatedMonth(absensiList) {
  const months = [...new Set((absensiList || []).map(r => String(r?.tanggal || '').slice(0, 7)).filter(Boolean))].sort();
  return months.length > 0 ? months[months.length - 1] : '2026-10';
}

function getWibTodayYmd(now = new Date()) {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return `${wib.getUTCFullYear()}-${pad2(wib.getUTCMonth() + 1)}-${pad2(wib.getUTCDate())}`;
}

/**
 * Extracts explicit YYYY-MM month or 'all' from Indonesian user text.
 */
export function parseMonthFromText(text, defaultMonth = '2026-10') {
  const low = String(text || '').toLowerCase();
  if (/\b(semua\s+(bulan|periode|data)|keseluruhan)\b/.test(low)) {
    return { month: '', explicit: true };
  }

  const isoYm = /\b(20\d{2})-(0[1-9]|1[0-2])\b/.exec(low);
  if (isoYm) {
    return { month: `${isoYm[1]}-${isoYm[2]}`, explicit: true };
  }

  const defaultYear = defaultMonth.slice(0, 4) || '2026';
  const monthNamesRe = Object.keys(MONTH_TOKEN_MAP).sort((a, b) => b.length - a.length).join('|');
  const mMatch = new RegExp(`\\b(${monthNamesRe})\\b(?:\\s+(20\\d{2}))?`, 'i').exec(low);
  if (mMatch) {
    const mm = MONTH_TOKEN_MAP[mMatch[1].toLowerCase()];
    const yy = mMatch[2] || (/\b(20\d{2})\b/.exec(low)?.[1]) || defaultYear;
    if (mm) return { month: `${yy}-${mm}`, explicit: true };
  }

  return { month: defaultMonth, explicit: false };
}

/**
 * Extracts unit/prodi filter if mentioned cleanly in text.
 */
function parseUnitFromText(text, pegawaiList) {
  const low = String(text || '').toLowerCase();
  const units = [...new Set((pegawaiList || []).map(p => p.unit_kerja).filter(Boolean))];
  for (const unit of units) {
    const clean = unit.toLowerCase().replace(/^program studi\s+/i, '').trim();
    const parts = clean.split(/[:/]/).map(s => s.trim()).filter(s => s.length >= 4);
    if (low.includes(unit.toLowerCase()) || (clean.length >= 5 && low.includes(clean))) {
      return unit;
    }
    if (parts.some(pt => pt.length >= 6 && low.includes(pt))) {
      return unit;
    }
  }
  return '';
}

/**
 * Parses explicit single dates or date ranges in ISO, DMY, or natural Indonesian format.
 */
export function parseDateRangeFromText(text, defaultYear = '2026') {
  const low = String(text || '').toLowerCase();
  const today = getWibTodayYmd();

  // 1. ISO dates YYYY-MM-DD (range or single)
  const isoDates = [...low.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map(m => m[1]);
  if (isoDates.length >= 2) {
    return { startDate: isoDates[0], endDate: isoDates[1] };
  }
  if (isoDates.length === 1) {
    return { startDate: isoDates[0], endDate: isoDates[0] };
  }

  // 2. DD/MM/YYYY or DD-MM-YYYY
  const dmyMatches = [...low.matchAll(/\b(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])[\/\-](20\d{2})\b/g)];
  if (dmyMatches.length >= 1) {
    const toIso = m => `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
    return {
      startDate: toIso(dmyMatches[0]),
      endDate: toIso(dmyMatches[1] || dmyMatches[0])
    };
  }

  // 3. Indonesian range: "(tanggal|tgl)? D1 (- | s/d | sd | sampai | hingga) D2 Bulan (YYYY)?"
  const monthNamesRe = Object.keys(MONTH_TOKEN_MAP).sort((a, b) => b.length - a.length).join('|');
  const rangeRe = new RegExp(
    `\\b(?:tanggal|tgl)?\\s*(\\d{1,2})\\s*(?:-|s\\/d|sd|sampai(?:\\s+dengan)?|hingga)\\s*(\\d{1,2})\\s+(${monthNamesRe})(?:\\s+(20\\d{2}))?\\b`,
    'i'
  );
  const rm = rangeRe.exec(low);
  if (rm) {
    const mm = MONTH_TOKEN_MAP[rm[3].toLowerCase()];
    const yy = rm[4] || (/\b(20\d{2})\b/.exec(low)?.[1]) || defaultYear;
    const s = `${yy}-${mm}-${pad2(rm[1])}`;
    const e = `${yy}-${mm}-${pad2(rm[2])}`;
    if (parseYmdParts(s) && parseYmdParts(e)) return { startDate: s, endDate: e };
  }

  // 4. Two full Indonesian dates: "2 Nov ... sampai 4 Nov 2026"
  const singleIndoRe = new RegExp(`\\b(\\d{1,2})\\s+(${monthNamesRe})(?:\\s+(20\\d{2}))?\\b`, 'gi');
  const singles = [...low.matchAll(singleIndoRe)];
  if (singles.length >= 1) {
    const resolveMatch = (m) => {
      const mm = MONTH_TOKEN_MAP[m[2].toLowerCase()];
      const yy = m[3] || defaultYear;
      return `${yy}-${mm}-${pad2(m[1])}`;
    };
    const s = resolveMatch(singles[0]);
    const e = resolveMatch(singles[1] || singles[0]);
    if (parseYmdParts(s) && parseYmdParts(e)) return { startDate: s, endDate: e };
  }

  // 5. Relative keywords: hari ini / besok / kemarin
  if (/\bhari\s+ini\b/.test(low)) return { startDate: today, endDate: today };
  if (/\bbesok\b/.test(low)) {
    const p = parseYmdParts(today);
    const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
    const ymd = dt.toISOString().slice(0, 10);
    return { startDate: ymd, endDate: ymd };
  }
  if (/\bkemarin\b/.test(low)) {
    const p = parseYmdParts(today);
    const dt = new Date(Date.UTC(p.y, p.m - 1, p.d - 1));
    const ymd = dt.toISOString().slice(0, 10);
    return { startDate: ymd, endDate: ymd };
  }

  return null;
}

/**
 * Matches employee mentions in user text against the employee directory using NIP and name tokens.
 */
function findEmployeesInText(text, pegawaiList) {
  const raw = String(text || '');
  const nipMatch = /\b(\d{10,20})\b/.exec(raw);
  if (nipMatch) {
    const exact = (pegawaiList || []).find(p => String(p.nip).trim() === nipMatch[1]);
    if (exact) return { matches: [exact], matchedPhrase: nipMatch[1] };
  }

  const normQuery = normalizeTextForName(raw);
  const queryWords = normQuery.split(' ').filter(w => w.length >= 3 && !GENERIC_QUERY_STOPWORDS.has(w));
  if (queryWords.length === 0) return { matches: [], matchedPhrase: '' };

  const scored = [];
  for (const p of (pegawaiList || [])) {
    const empTokens = getCleanNameTokens(p.nama_lengkap);
    if (empTokens.length === 0) continue;

    // Cek kecocokan nama utuh (tanpa gelar) di dalam kalimat
    const cleanFull = empTokens.join(' ');
    if (cleanFull.length >= 4 && normQuery.includes(cleanFull)) {
      scored.push({ emp: p, score: 100 + empTokens.length });
      continue;
    }

    // Hitung irisan kata unik non-stopword
    const overlap = empTokens.filter(t => queryWords.includes(t));
    if (overlap.length > 0) {
      const ratio = overlap.length / empTokens.length;
      const score = overlap.length * 10 + ratio * 5;
      scored.push({ emp: p, score, overlapCount: overlap.length });
    }
  }

  if (scored.length === 0) return { matches: [], matchedPhrase: '' };
  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0].score;
  const best = scored.filter(s => s.score >= topScore - 2 || (topScore >= 100 && s.score >= 100));
  return {
    matches: best.map(b => b.emp),
    matchedPhrase: best[0]?.emp?.nama_lengkap || ''
  };
}

function parseStatusKeyword(text) {
  const low = String(text || '').toLowerCase();
  if (/\bcuti\b/.test(low)) return 'Cuti';
  if (/\bsakit\b/.test(low)) return 'Sakit';
  if (/\bdinas(\s+luar)?\b|\btugas\s+luar\b/.test(low)) return 'Dinas Luar';
  if (/\btugas\s+belajar\b/.test(low)) return 'Tugas Belajar';
  if (/\b(izin|ijin)\b/.test(low)) return 'Izin';
  if (/\blembur\b/.test(low)) return 'Lembur';
  if (/\bhadir\b/.test(low)) return 'Hadir';
  return null;
}

function formatBreakdownMarkdown(emp, monthLabel) {
  const lines = [
    `**${emp.nama_lengkap}** (\`NIP: ${emp.nip}\`) — *${emp.unit_kerja}*`,
    `- Periode: **${monthLabel}** (Hari Kerja Normal: **${emp.normalDays}** hari)`,
    `- Kehadiran Riil: **${emp.riilDays}** hari | Total Absen: **${emp.absenDays}** hari`,
    `- Rincian Absen (= Export Excel): **Tanpa Ket. ${emp.tanpaKeterangan}** • **D.Luar ${emp.dinasLuar}** • **Cuti ${emp.cuti}** • **Sakit ${emp.sakit}** • **Ijin ${emp.izin}**`,
    `- Disiplin Scan: **Terlambat ${emp.terlambat}x** (${emp.menitTerlambat} menit) • **Pulang Cepat ${emp.pulangCepat}x** • **Belum Scan Pulang ${emp.tanpaPulang}x** • **Lembur ${emp.lembur} hari**`
  ];
  return lines.join('\n');
}

function parsePolicyParamsFromText(text) {
  const low = String(text || '').toLowerCase();
  const out = {};

  const masukMatch = /(?:jam\s*)?(?:masuk|datang)(?:\s+(?:diubah|menjadi|ke|jadi|=))?\s*(\d{1,2})[:.](\d{2})/.exec(low);
  if (masukMatch) out.jamMasuk = `${pad2(masukMatch[1])}:${masukMatch[2]}`;

  const pulangJumatMatch = /(?:pulang\s*)?jumat(?:\s+(?:diubah|menjadi|ke|jadi|=))?\s*(\d{1,2})[:.](\d{2})/.exec(low);
  if (pulangJumatMatch) out.jamPulangJumat = `${pad2(pulangJumatMatch[1])}:${pulangJumatMatch[2]}`;

  const pulangMatch = /(?:jam\s*)?pulang(?:\s+(?:senin\s*-\s*kamis|reguler|diubah|menjadi|ke|jadi|=))?\s*(\d{1,2})[:.](\d{2})/.exec(low);
  if (pulangMatch && !pulangJumatMatch) out.jamPulang = `${pad2(pulangMatch[1])}:${pulangMatch[2]}`;

  const tolMatch = /toleransi(?:\s+(?:keterlambatan|menjadi|ke|=))?\s*(\d{1,2})\s*(?:menit|mnt|m)?/.exec(low);
  if (tolMatch) out.toleransi = Math.min(60, Math.max(0, parseInt(tolMatch[1], 10)));

  // Fallback jika hanya menyebut angka jam tunggal bersama "simulasi/kebijakan"
  if (!out.jamMasuk && !out.jamPulang && out.toleransi === undefined) {
    const anyTime = /\b(0?\d|1\d|2[0-3])[:.](\d{2})\b/.exec(low);
    if (anyTime) {
      const hh = parseInt(anyTime[1], 10);
      const formatted = `${pad2(hh)}:${anyTime[2]}`;
      if (hh < 12) out.jamMasuk = formatted;
      else out.jamPulang = formatted;
    }
  }
  return out;
}

/**
 * Resolves and executes a deterministic Pengelola SDM intent against live dashboard data.
 */
export function processLocalSdmPrompt({ messages, snapshot, activeConfig, actor }) {
  const userMessage = String(messages[messages.length - 1]?.content || '').trim();
  const low = userMessage.toLowerCase();
  const pegawaiList = snapshot.pegawai || [];
  const absensiList = snapshot.absensi || [];
  const defaultMonth = getLatestPopulatedMonth(absensiList);

  // Konteks percakapan sebelumnya (berguna saat konfirmasi NIP disambiguasi)
  const prevAssistant = messages.length >= 2 && messages[messages.length - 2]?.role === 'assistant'
    ? String(messages[messages.length - 2].content || '')
    : '';
  const prevUser = messages.length >= 3 && messages[messages.length - 3]?.role === 'user'
    ? String(messages[messages.length - 3].content || '')
    : '';

  const effectivePrompt = (prevAssistant.includes('Ditemukan beberapa pegawai') && /^\d{10,20}$/.test(userMessage.trim()) && prevUser)
    ? `${prevUser} ${userMessage.trim()}`
    : userMessage;
  const effLow = effectivePrompt.toLowerCase();

  // --------------------------------------------------------------------------
  // 0. TIER 3 GUARD: Blokir aksi destruktif (Hapus / Reset Massal)
  // --------------------------------------------------------------------------
  if (/\b(hapus|delete|buang|bersihkan|kosongkan|reset\s+(semua|data|database)|timpa\s+semua)\b/.test(low)) {
    return {
      reply: [
        '### Akses Diblokir oleh Aturan Keamanan Tier 3',
        'Penghapusan catatan presensi atau reset database **tidak diizinkan melalui Asisten AI** untuk mencegah kehilangan data kepegawaian.',
        '- Untuk menghapus satu baris: gunakan tombol ikon **Hapus** di tabel **Log Presensi Harian**.',
        '- Untuk mengembalikan data awal: gunakan menu **Kelola Data -> Reset ke Data Awal**.'
      ].join('\n'),
      toolsCalled: ['tier3_destructive_guard'],
      pendingProposals: [],
      uiCommands: []
    };
  }

  // --------------------------------------------------------------------------
  // 1. BANTUAN / PANDUAN PERINTAH
  // --------------------------------------------------------------------------
  if (/^(halo|hai|hi|pagi|siang|sore|help|bantuan|\?|apa yang bisa)/i.test(low)) {
    return {
      reply: [
        `### Panduan Asisten SDM Lokal FHISIP (Gratis Rp 0 • Tanpa AI Gateway)`,
        `Halo **${actor.name || actor.username}**, Anda dapat mengetikkan perintah langsung seperti:`,
        '- **Audit Anomali**: `"Siapa saja pegawai dengan Tanpa Keterangan atau belum scan pulang di Oktober 2026?"`',
        '- **Ringkasan Periode**: `"Tampilkan ringkasan disiplin & cuti/sakit/dinas periode Oktober 2026"`',
        '- **Cek Rekap Pegawai**: `"Cek rekap Acep Surya Oktober 2026"` atau `"Cek kehadiran Caecilia September 2026"`',
        '- **Draf Input Cuti/Izin (Tier 2)**: `"Buatkan draf Cuti untuk Acep Surya tanggal 2026-11-02 sampai 2026-11-04 (lewati weekend)"`',
        '- **Simulasi Kebijakan**: `"Simulasikan dampak jika batas jam datang masuk diubah menjadi 08:00 WIB pada Oktober 2026"`',
        '- **Filter Dashboard**: `"Tampilkan tabel Acep di Oktober 2026"` atau `"Buka tab rekap pegawai"`'
      ].join('\n'),
      toolsCalled: ['panduanSdm'],
      pendingProposals: [],
      uiCommands: []
    };
  }

  const periodParsed = parseMonthFromText(effectivePrompt, defaultMonth);
  const unitFilter = parseUnitFromText(effectivePrompt, pegawaiList);
  const empSearch = findEmployeesInText(effectivePrompt, pegawaiList);

  // --------------------------------------------------------------------------
  // 2. TIER 1: SIMULASI KEBIJAKAN JAM KERJA
  // --------------------------------------------------------------------------
  if (/\b(simulasi|simulasikan|dampak|andai|misalkan|seandainya)\b/.test(effLow)) {
    const proposed = parsePolicyParamsFromText(effectivePrompt);
    if (Object.keys(proposed).length === 0) {
      return {
        reply: 'Sebutkan parameter jam yang ingin disimulasikan, misalnya: `"Simulasikan jika jam masuk menjadi 08:00 WIB pada Oktober 2026"` atau `"Simulasikan toleransi 15 menit"`.',
        toolsCalled: ['simulasiKebijakanJamKerja'],
        pendingProposals: [],
        uiCommands: []
      };
    }

    const sim = simulatePolicy(absensiList, pegawaiList, activeConfig, proposed, {
      month: periodParsed.month,
      unit: unitFilter
    });

    return {
      reply: [
        `### Simulasi Dampak Kebijakan Jam Kerja — ${formatMonthLabel(periodParsed.month)}`,
        `- Kebijakan Saat Ini: Masuk **${sim.baseConfig.jamMasuk} WIB** (Toleransi ${sim.baseConfig.toleransi} mnt), Pulang **${sim.baseConfig.jamPulang} WIB** (Jumat ${sim.baseConfig.jamPulangJumat} WIB)`,
        `- Kebijakan Simulasi: Masuk **${sim.proposedConfig.jamMasuk} WIB** (Toleransi ${sim.proposedConfig.toleransi} mnt), Pulang **${sim.proposedConfig.jamPulang} WIB** (Jumat ${sim.proposedConfig.jamPulangJumat} WIB)`,
        `- **Terlambat**: ${sim.before.terlambat} → **${sim.after.terlambat}** (Selisih: **${sim.delta.terlambat >= 0 ? '+' : ''}${sim.delta.terlambat}**)`,
        `- **Tepat Waktu**: ${sim.before.tepatWaktu} → **${sim.after.tepatWaktu}** (Selisih: **${sim.delta.tepatWaktu >= 0 ? '+' : ''}${sim.delta.tepatWaktu}**)`,
        `- **Pulang Cepat**: ${sim.before.pulangCepat} → **${sim.after.pulangCepat}** (Selisih: **${sim.delta.pulangCepat >= 0 ? '+' : ''}${sim.delta.pulangCepat}**)`,
        `*Catatan: Simulasi ini tidak mengubah database. Gunakan kata perintah "Ubah kebijakan..." jika ingin membuat draf persetujuan.*`
      ].join('\n'),
      toolsCalled: ['simulasiKebijakanJamKerja'],
      pendingProposals: [],
      uiCommands: []
    };
  }

  // --------------------------------------------------------------------------
  // 3. TIER 2 PREVIEW: UBAH KEBIJAKAN JAM KERJA (Wajib Konfirmasi)
  // --------------------------------------------------------------------------
  if (/\b(ubah|ganti|set|terapkan|atur)\b/.test(effLow) && /\b(kebijakan|jam\s+masuk|jam\s+pulang|toleransi|batas\s+masuk|batas\s+datang)\b/.test(effLow)) {
    const proposed = parsePolicyParamsFromText(effectivePrompt);
    if (Object.keys(proposed).length === 0) {
      return {
        reply: 'Sebutkan nilai jam kerja baru yang diinginkan, misalnya: `"Ubah jam masuk menjadi 08:00 toleransi 10 menit"`.',
        toolsCalled: ['siapkanUbahKebijakan'],
        pendingProposals: [],
        uiCommands: []
      };
    }
    const nextCfg = {
      ...DEFAULT_CONFIG,
      ...activeConfig,
      ...proposed,
      preset: 'custom'
    };
    return {
      reply: [
        '### Draf Ubah Kebijakan Jam Kerja Siap Dikonfirmasi (Tier 2)',
        `- Sebelum: Masuk \`${activeConfig.jamMasuk}\`, Toleransi \`${activeConfig.toleransi} mnt\`, Pulang \`${activeConfig.jamPulang}\` (Jumat \`${activeConfig.jamPulangJumat}\`)`,
        `- Usulan Baru: Masuk \`${nextCfg.jamMasuk}\`, Toleransi \`${nextCfg.toleransi} mnt\`, Pulang \`${nextCfg.jamPulang}\` (Jumat \`${nextCfg.jamPulangJumat}\`)`,
        'Perubahan **belum diterapkan** sebelum Anda menekan tombol **Setujui & Simpan ke Database** pada kartu di bawah.'
      ].join('\n'),
      toolsCalled: ['siapkanUbahKebijakan'],
      pendingProposals: [{ actionType: 'UPDATE_POLICY', before: { ...activeConfig }, after: nextCfg }],
      uiCommands: []
    };
  }

  // --------------------------------------------------------------------------
  // 4. TIER 2 PREVIEW: BUAT DRAF INPUT / UBAH PRESENSI (Cuti/Izin/Sakit/Dinas/Lembur/Hadir)
  // --------------------------------------------------------------------------
  const hasWriteVerb = /\b(buatkan|buat|tambah|tambahkan|input|inputkan|masukkan|ajukan|catat|catatkan|draf|draft|set)\b/.test(effLow);
  const reqStatus = parseStatusKeyword(effectivePrompt);
  const dateRange = parseDateRangeFromText(effectivePrompt, defaultMonth.slice(0, 4));

  if (hasWriteVerb && (reqStatus || dateRange)) {
    if (!reqStatus) {
      return {
        reply: 'Sebutkan status presensi yang ingin diajukan: `Cuti`, `Izin`, `Sakit`, `Dinas Luar`, `Lembur`, `Tugas Belajar`, atau `Hadir`.',
        toolsCalled: ['siapkanInputPresensi'],
        pendingProposals: [],
        uiCommands: []
      };
    }
    if (!dateRange) {
      return {
        reply: `Sebutkan tanggal presensi untuk status **${reqStatus}**, misalnya \`tanggal 2026-11-02 sampai 2026-11-04\` atau \`tgl 2-5 November 2026\`.`,
        toolsCalled: ['siapkanInputPresensi'],
        pendingProposals: [],
        uiCommands: []
      };
    }
    if (empSearch.matches.length === 0) {
      return {
        reply: 'Nama atau NIP pegawai belum terdeteksi. Sebutkan nama pegawai FHISIP UT (contoh: `"Buatkan draf Cuti untuk Acep Surya tanggal 2026-11-02 sampai 2026-11-04"`).',
        toolsCalled: ['cariPegawai', 'siapkanInputPresensi'],
        pendingProposals: [],
        uiCommands: []
      };
    }
    if (empSearch.matches.length > 1) {
      const candLines = empSearch.matches.slice(0, 8).map(c => `- **${c.nama_lengkap}** (\`NIP: ${c.nip}\`) — ${c.unit_kerja}`);
      return {
        reply: [
          `Ditemukan beberapa pegawai yang cocok (${empSearch.matches.length} kandidat). Mohon balas dengan **NIP spesifik** yang dimaksud:`,
          ...candLines
        ].join('\n'),
        toolsCalled: ['cariPegawai'],
        pendingProposals: [],
        uiCommands: []
      };
    }

    const skipWeekend = /\b(termasuk\s+(weekend|sabtu)|ikut\s+weekend)\b/.test(effLow) ? false : true;
    const targetEmp = empSearch.matches[0];
    const timePairs = [...effectivePrompt.matchAll(/\b([01]?\d|2[0-3])[:.](\d{2})\b/g)].map(m => `${pad2(m[1])}:${m[2]}`);

    const draft = buildAttendanceDraft(pegawaiList, absensiList, {
      nip: targetEmp.nip,
      status: reqStatus,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      skipWeekend,
      jamMasuk: timePairs[0] || null,
      jamPulang: timePairs[1] || null,
      keterangan: `Draf Asisten SDM Lokal (${reqStatus})`
    });

    if (!draft.ok) {
      return {
        reply: draft.error,
        toolsCalled: ['siapkanInputPresensi'],
        pendingProposals: [],
        uiCommands: []
      };
    }

    const p = draft.proposal;
    return {
      reply: [
        `### Draf Presensi Siap Disetujui (Tier 2)`,
        `- Pegawai: **${p.employee.nama_lengkap}** (\`NIP: ${p.employee.nip}\`)`,
        `- Status: **${p.requestedStatus}** | Rentang: **${p.startDate} s/d ${p.endDate}** (**${p.totalDays}** hari)`,
        `- Dampak: **${p.insertCount}** baris baru, **${p.overwriteCount}** menimpa tanggal yang sama`,
        p.rulesApplied.length > 0 ? `- Aturan Otomatis: ${p.rulesApplied.join(' ')}` : '',
        'Data **belum tersimpan** ke database. Silakan periksa kartu konfirmasi di bawah lalu klik **Setujui & Simpan ke Database**.'
      ].filter(Boolean).join('\n'),
      toolsCalled: ['cariPegawai', 'siapkanInputPresensi'],
      pendingProposals: [p],
      uiCommands: []
    };
  }

  // --------------------------------------------------------------------------
  // 5. TIER 1: TERAPKAN FILTER / BUKA TAB DI UI DASHBOARD
  // --------------------------------------------------------------------------
  if (/\b(buka\s+tab|pindah\s+tab|filter\s+(tabel|dashboard)|tampilkan\s+di\s+tabel|tampilkan\s+tabel)\b/.test(effLow)) {
    let tab = 'harian';
    if (/\brekap\s+(per\s+)?pegawai\b/.test(effLow)) tab = 'pegawai';
    else if (/\brekap\s+(per\s+)?(prodi|unit|bagian)\b/.test(effLow)) tab = 'prodi';

    let uiStatus = 'all';
    if (/\b(terlambat|telat)\b/.test(effLow)) uiStatus = 'telat';
    else if (/\btepat\s+waktu\b/.test(effLow)) uiStatus = 'tepat';
    else if (/\bpulang\s+(lebih\s+)?awal|pulang\s+cepat\b/.test(effLow)) uiStatus = 'pulang_cepat';
    else if (/\bbelum\s+scan\s+pulang\b/.test(effLow)) uiStatus = 'tanpa_pulang';
    else if (/\blembur\b/.test(effLow)) uiStatus = 'lembur';
    else if (/\b(izin|ijin|cuti|sakit|dinas)\b/.test(effLow)) uiStatus = 'izin';

    const searchKeyword = empSearch.matches.length === 1 ? empSearch.matches[0].nama_lengkap : (unitFilter || '');
    const filterCmd = {
      tab,
      month: periodParsed.explicit ? periodParsed.month : '',
      search: searchKeyword,
      status: uiStatus
    };

    return {
      reply: `Filter dashboard telah diperbarui: Tab **${tab}**, Periode **${formatMonthLabel(filterCmd.month)}**, Status **${uiStatus}**${searchKeyword ? `, Kata kunci **${searchKeyword}**` : ''}.`,
      toolsCalled: ['terapkanFilterDashboard'],
      pendingProposals: [],
      uiCommands: [{ type: 'APPLY_UI_FILTER', params: filterCmd }]
    };
  }

  // --------------------------------------------------------------------------
  // 6. TIER 1: AUDIT ANOMALI / KETERLAMBATAN / TANPA KETERANGAN / BELUM SCAN PULANG
  // --------------------------------------------------------------------------
  const metricRequests = [];
  if (/\b(tanpa\s+keterangan|alpha|alpa|tanpa\s+catatan|tidak\s+hadir)\b/.test(effLow)) {
    metricRequests.push({ key: 'tanpaKeterangan', label: 'Tanpa Keterangan (Hari Kerja Tanpa Scan/Izin)' });
  }
  if (/\bbelum\s+scan\s+pulang|tanpa\s+pulang|lupa\s+absen\s+pulang\b/.test(effLow)) {
    metricRequests.push({ key: 'tanpaPulang', label: 'Belum Scan Pulang' });
  }
  if (/\b(terlambat|telat)\b/.test(effLow) && !/\b(ringkasan|statistik)\b/.test(effLow)) {
    metricRequests.push({ key: 'terlambat', label: 'Datang Terlambat' });
  }
  if (/\bpulang\s+(cepat|lebih\s+awal)\b/.test(effLow)) {
    metricRequests.push({ key: 'pulangCepat', label: 'Pulang Lebih Awal' });
  }
  if (/\blembur\b/.test(effLow) && /\b(siapa|daftar|terbanyak|paling)\b/.test(effLow)) {
    metricRequests.push({ key: 'lembur', label: 'Lembur Akhir Pekan' });
  }

  const isAuditIntent = metricRequests.length > 0 && (
    /\b(siapa|daftar|audit|terbanyak|paling|sering|cek|cari|pegawai|lebih\s+dari|minimal)\b/.test(effLow) || empSearch.matches.length === 0
  );

  if (isAuditIntent && empSearch.matches.length === 0) {
    const pMap = new Map(pegawaiList.map(p => [String(p.nip).trim(), p]));
    const evaluated = filterEvaluatedRecords(absensiList, pMap, activeConfig, {
      month: periodParsed.month,
      unit: unitFilter
    });
    const breakdown = computeEmployeeBreakdown(evaluated, pegawaiList);
    const minMatch = /(?:>|lebih\s+dari|minimal|min\.?)\s*(\d+)\s*(?:x|kali|hari)?/.exec(effLow);
    const minCount = minMatch ? Math.max(1, parseInt(minMatch[1], 10)) : 1;

    const sections = [`### Hasil Audit Disiplin — ${formatMonthLabel(periodParsed.month)}${unitFilter ? ` (${unitFilter})` : ''}`];
    sections.push(`Rentang data: \`${breakdown.startDate || '-'} s/d ${breakdown.endDate || '-'}\` • Hari kerja normal: **${breakdown.normalDays}** hari.`);

    for (const metric of metricRequests) {
      const matched = breakdown.rows
        .filter(r => (r[metric.key] || 0) >= minCount)
        .sort((a, b) => (b[metric.key] - a[metric.key]) || (b.menitTerlambat - a.menitTerlambat));

      sections.push(`\n**${metric.label}** (Total: **${matched.length}** pegawai dengan >= ${minCount}x):`);
      if (matched.length === 0) {
        sections.push('- Tidak ada pegawai yang memenuhi kriteria pada periode ini.');
      } else {
        matched.slice(0, 10).forEach((r, idx) => {
          const extra = metric.key === 'terlambat' ? ` (${r.menitTerlambat} menit)` : '';
          sections.push(`${idx + 1}. **${r.nama_lengkap}** (\`${r.nip}\`) — **${r[metric.key]}**${extra} • ${r.unit_kerja}`);
        });
        if (matched.length > 10) {
          sections.push(`- *...dan ${matched.length - 10} pegawai lainnya (lihat Tab Rekap per Pegawai untuk daftar lengkap).*`);
        }
      }
    }

    return {
      reply: sections.join('\n'),
      toolsCalled: ['auditPegawaiTerlambatAtauAnomali'],
      pendingProposals: [],
      uiCommands: []
    };
  }

  // --------------------------------------------------------------------------
  // 7. TIER 1: CEK REKAP PEGAWAI SPESIFIK (1-to-1 Export Excel)
  // --------------------------------------------------------------------------
  if (empSearch.matches.length > 0 && !/\b(ringkasan|statistik\s+keseluruhan)\b/.test(effLow)) {
    const pMap = new Map(pegawaiList.map(p => [String(p.nip).trim(), p]));
    const evaluated = filterEvaluatedRecords(absensiList, pMap, activeConfig, {
      month: periodParsed.month
    });
    const breakdown = computeEmployeeBreakdown(evaluated, pegawaiList);
    const labelBulan = formatMonthLabel(periodParsed.month);

    const blocks = [];
    for (const emp of empSearch.matches.slice(0, 5)) {
      const row = breakdown.byNip.get(String(emp.nip).trim());
      if (row) {
        blocks.push(formatBreakdownMarkdown(row, labelBulan));
      } else {
        blocks.push(`**${emp.nama_lengkap}** (\`NIP: ${emp.nip}\`) — Belum memiliki catatan presensi pada ${labelBulan}.`);
      }
    }

    return {
      reply: [`### Rincian Rekapitulasi Resmi Pegawai (${labelBulan})`, ...blocks].join('\n\n'),
      toolsCalled: ['cariPegawai', 'cekRekapPegawaiResmi'],
      pendingProposals: [],
      uiCommands: []
    };
  }

  // --------------------------------------------------------------------------
  // 8. TIER 1: RINGKASAN PERIODE & CUTI / SAKIT / IZIN / DINAS
  // --------------------------------------------------------------------------
  if (/\b(ringkasan|statistik|rekapitulasi|rekap|summary|laporan|cuti|sakit|izin|ijin|dinas|tepat\s+waktu|hadir)\b/.test(effLow)) {
    const summary = summarizePeriod(absensiList, pegawaiList, activeConfig, {
      month: periodParsed.month,
      unit: unitFilter
    });
    const c = summary.counts;
    return {
      reply: [
        `### Ringkasan Presensi & Disiplin — ${formatMonthLabel(periodParsed.month)}${unitFilter ? ` (${unitFilter})` : ''}`,
        `- Rentang Data: \`${summary.filterApplied.startDate || '-'} s/d ${summary.filterApplied.endDate || '-'}\` (${summary.normalWorkingDays} hari kerja normal)`,
        `- Total Catatan: **${c.totalRecords}** baris dari **${summary.activeEmployeesCount}** pegawai terdata`,
        `- **Hadir**: **${c.hadir}** (Tepat Waktu **${c.tepatWaktu}**, Terlambat **${c.terlambat}**, Pulang Cepat **${c.pulangCepat}**, Belum Scan Pulang **${c.tanpaPulang}**)`,
        `- **Izin / Cuti / Sakit / Dinas / Lembur**: Cuti **${c.cuti}** • Sakit **${c.sakit}** • Izin **${c.izin}** • Dinas Luar **${c.dinasLuar}** • Tugas Belajar **${c.tugasBelajar}** • Lembur **${c.lembur}** • Alpha **${c.alpha}**`
      ].join('\n'),
      toolsCalled: ['ringkasanDisiplinPeriode'],
      pendingProposals: [],
      uiCommands: []
    };
  }

  // --------------------------------------------------------------------------
  // 9. TIER 1: CARI PEGAWAI BERDASARKAN UNIT ATAU KATA KUNCI
  // --------------------------------------------------------------------------
  if (/\b(cari|daftar\s+pegawai|unit|prodi)\b/.test(effLow) || unitFilter) {
    const cleanedQ = effectivePrompt
      .replace(/\b(cari|pegawai|daftar|unit|prodi|bagian|siapa)\b/gi, '')
      .trim();
    const list = searchEmployees(pegawaiList, unitFilter ? '' : cleanedQ, unitFilter);
    if (list.length === 0) {
      return {
        reply: `Tidak ditemukan pegawai yang cocok dengan pencarian \`${cleanedQ || unitFilter}\`.`,
        toolsCalled: ['cariPegawai'],
        pendingProposals: [],
        uiCommands: []
      };
    }
    return {
      reply: [
        `### Hasil Pencarian Pegawai (${list.length} ditampilkan)`,
        ...list.map((p, idx) => `${idx + 1}. **${p.nama_lengkap}** (\`NIP: ${p.nip}\`) — ${p.status_kepegawaian} • ${p.unit_kerja}`)
      ].join('\n'),
      toolsCalled: ['cariPegawai'],
      pendingProposals: [],
      uiCommands: []
    };
  }

  // --------------------------------------------------------------------------
  // 10. FALLBACK INFORMATIF (Bila pola belum cocok)
  // --------------------------------------------------------------------------
  return {
    reply: [
      'Saya menjalankan **Mode Deterministik Lokal SDM (Gratis Rp 0)** sehingga perintah perlu menyebut tujuan secara ringkas. Contoh perintah yang langsung berjalan:',
      '- **Audit**: `"Siapa saja pegawai dengan Tanpa Keterangan atau belum scan pulang di Oktober 2026?"`',
      '- **Ringkasan**: `"Ringkasan disiplin Oktober 2026"` atau `"Ringkasan cuti dan sakit Oktober 2026"`',
      '- **Cek Pegawai**: `"Cek rekap Acep Surya Oktober 2026"`',
      '- **Input Draf**: `"Buatkan draf Cuti untuk Acep Surya tanggal 2026-11-02 sampai 2026-11-04 (lewati weekend)"`',
      '- **Simulasi**: `"Simulasikan jika batas jam datang masuk diubah menjadi 08:00 WIB pada Oktober 2026"`'
    ].join('\n'),
    toolsCalled: [],
    pendingProposals: [],
    uiCommands: []
  };
}
