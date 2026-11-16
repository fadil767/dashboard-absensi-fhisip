/**
 * Shared FHISIP UT Attendance Rules, RBAC Guards, Quota Rules, and Recap Engine
 * Enforces deterministic business & discipline logic server-side for the SDM AI Agent.
 */

export const ALLOWED_SDM_ROLES = new Set([
  'SDM & Kepegawaian FHISIP',
  'SDM & Administrasi Umum',
  'Administrator'
]);

export const ALLOWED_SDM_USERNAMES = new Set([
  'radhitya.putra@ecampus.ut.ac.id',
  'radhitya.putra',
  'radhitya',
  '201210002041',
  'vikupaoki@ecampus.ut.ac.id',
  'vikupaoki',
  'viku.paoki',
  'viku',
  '198605122020032491',
  'septintrif@ecampus.ut.ac.id',
  'septintrif',
  'septin.fadillah',
  'septin',
  '197005122013031700',
  'admin',
  'admin.fhisip',
  'fhisip@ecampus.ut.ac.id',
  'admin@ut.ac.id'
]);

export const QUOTA_RULES = {
  dailyLimitPerUser: 500,
  dailyTeamLimit: 1500,
  cooldownMs: 1000,
  maxHistoryMessages: 8,
  maxPromptChars: 1500,
  maxBatchDays: 62,
  timezone: 'Asia/Jakarta',
  resetLabel: '00:00 WIB'
};

export const DEFAULT_CONFIG = {
  jamMasuk: '08:30',
  toleransi: 0,
  jamPulang: '16:30',
  jamPulangJumat: '16:30',
  preset: 'fhisip'
};

export const NON_TIMED_STATUS_SET = new Set([
  'Lembur',
  'Izin',
  'Cuti',
  'Sakit',
  'Dinas Luar',
  'Tugas Belajar',
  'Alpha'
]);

export const DAY_STATUS_PRIORITY = [
  'Hadir',
  'Dinas Luar',
  'Tugas Belajar',
  'Cuti',
  'Sakit',
  'Izin',
  'Alpha'
];

export const TUGAS_BELAJAR_DEFAULT_NIPS = new Set([
  '199305122019031148', // Nadia Nurani Isfarin, LL.M.
  '198505122013031340'  // Rahmat Hidayat, S.E.
]);

/**
 * Verifies whether the session actor is an authorized Pengelola SDM user.
 */
export function isPengelolaSdmActor(actor) {
  if (!actor || typeof actor !== 'object') return false;
  if (actor.isGuest === true) return false;
  const role = String(actor.role || '').trim();
  const username = String(actor.username || '').trim().toLowerCase();
  if (!role || !username) return false;
  return ALLOWED_SDM_ROLES.has(role) && ALLOWED_SDM_USERNAMES.has(username);
}

/**
 * Returns the UTC start and end timestamps corresponding to today's date in WIB (UTC+7).
 */
export function getWibDayBoundsIso(now = new Date()) {
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const wibNow = new Date(now.getTime() + wibOffsetMs);
  const y = wibNow.getUTCFullYear();
  const m = String(wibNow.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wibNow.getUTCDate()).padStart(2, '0');
  const dateYmdWib = `${y}-${m}-${d}`;
  const startUtc = new Date(`${dateYmdWib}T00:00:00.000+07:00`);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return {
    dateYmdWib,
    startUtcIso: startUtc.toISOString(),
    endUtcIso: endUtc.toISOString()
  };
}

/**
 * Parses YYYY-MM-DD strictly without timezone drift.
 */
export function parseYmdParts(ymd) {
  if (!ymd || typeof ymd !== 'string') return null;
  const parts = ymd.trim().slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const [y, m, d] = parts;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/**
 * Returns 0 (Sunday) through 6 (Saturday) for a YYYY-MM-DD date string.
 */
export function getDayOfWeek(ymd) {
  const p = parseYmdParts(ymd);
  if (!p) return null;
  return new Date(p.y, p.m - 1, p.d).getDay();
}

export function isWeekendDate(ymd) {
  const dow = getDayOfWeek(ymd);
  return dow === 0 || dow === 6;
}

export function getWeekendDayName(ymd) {
  const dow = getDayOfWeek(ymd);
  if (dow === 6) return 'Sabtu';
  if (dow === 0) return 'Minggu';
  return '';
}

/**
 * Normalizes raw attendance statuses onto the canonical FHISIP set.
 */
export function normalizeStatusValue(rawStatus) {
  const s = String(rawStatus || '').trim();
  if (!s) return 'Hadir';
  const low = s.toLowerCase();
  if (low === 'hadir' || low === 'present') return 'Hadir';
  if (low === 'lembur' || low === 'overtime' || low === 'lbr') return 'Lembur';
  if (low === 'izin' || low === 'ijin' || low.startsWith('izin ') || low.startsWith('ijin ')) return 'Izin';
  if (low === 'cuti' || low.startsWith('cuti ')) return 'Cuti';
  if (low === 'sakit' || low === 'skt') return 'Sakit';
  if (low === 'dinas' || low === 'dinas luar' || low === 'dl' || low === 'tugas luar' || low.startsWith('dinas ')) return 'Dinas Luar';
  if (low === 'tugas belajar' || low === 'tb') return 'Tugas Belajar';
  if (low === 'alpha' || low === 'alpa' || low === 'tk' || low === 'tanpa keterangan') return 'Alpha';
  return s;
}

export function isNonTimedStatus(status) {
  return NON_TIMED_STATUS_SET.has(normalizeStatusValue(status));
}

/**
 * Applies weekend Lembur & non-timed blanking rules identically to js/app.js.
 */
export function normalizeAttendanceRecord(rec) {
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

function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return (isNaN(h) || isNaN(m)) ? null : h * 60 + m;
}

/**
 * Evaluates discipline flags on an attendance record given an active schedule config.
 */
export function evaluateRecord(rawRecord, config = DEFAULT_CONFIG) {
  const rec = normalizeAttendanceRecord(rawRecord);
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
  const configMasukMin = parseTimeToMinutes(cfg.jamMasuk);
  const toleransiMin = Number(cfg.toleransi) || 0;
  const batasMasukEfektif = configMasukMin + toleransiMin;

  const dow = getDayOfWeek(rec.tanggal);
  const isFriday = dow === 5;
  const isWeekend = dow === 0 || dow === 6;
  const configPulangMin = parseTimeToMinutes(isFriday ? cfg.jamPulangJumat : cfg.jamPulang);

  const effectiveStatus = rec.status_kehadiran;
  const isNonTimed = isWeekend || isNonTimedStatus(effectiveStatus);
  const recordMasukMin = isNonTimed ? null : parseTimeToMinutes(rec.jam_masuk);
  const recordPulangMin = isNonTimed ? null : parseTimeToMinutes(rec.jam_pulang);

  let isTerlambat = false;
  let menitTerlambat = 0;
  let isPulangCepat = false;
  let menitPulangCepat = 0;
  let isTanpaPulang = false;
  let isTanpaMasuk = false;

  if (!isNonTimed) {
    if (recordMasukMin !== null && configMasukMin !== null) {
      if (recordMasukMin > batasMasukEfektif) {
        isTerlambat = true;
        menitTerlambat = recordMasukMin - configMasukMin;
      }
    } else {
      isTanpaMasuk = true;
    }

    if (recordPulangMin !== null && configPulangMin !== null) {
      if (recordPulangMin < configPulangMin) {
        isPulangCepat = true;
        menitPulangCepat = configPulangMin - recordPulangMin;
      }
    } else if (recordMasukMin !== null) {
      isTanpaPulang = true;
    }
  }

  return {
    ...rec,
    isWeekend,
    isLembur: effectiveStatus === 'Lembur',
    isNonTimed,
    isTerlambat,
    menitTerlambat,
    isPulangCepat,
    menitPulangCepat,
    isTanpaMasuk,
    isTanpaPulang
  };
}

/**
 * Counts Mon-Fri working days within [startYmd, endYmd] inclusive.
 */
export function getWorkingDaysInRange(startYmd, endYmd) {
  const s = parseYmdParts(startYmd);
  const e = parseYmdParts(endYmd);
  if (!s || !e) return 0;
  const cur = new Date(s.y, s.m - 1, s.d);
  const end = new Date(e.y, e.m - 1, e.d);
  if (cur > end) return 0;
  let count = 0;
  while (cur <= end) {
    const wd = cur.getDay();
    if (wd !== 0 && wd !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Enumerates YYYY-MM-DD dates inclusively, capped at maxDays (62).
 */
export function enumerateDatesInclusive(startYmd, endYmd, maxDays = QUOTA_RULES.maxBatchDays) {
  const sPart = parseYmdParts(startYmd);
  if (!sPart) return { dates: [], truncated: false };
  const ePart = parseYmdParts(endYmd || startYmd);
  if (!ePart) return { dates: [startYmd.slice(0, 10)], truncated: false };

  const sIso = startYmd.slice(0, 10);
  const eIso = (endYmd || startYmd).slice(0, 10);
  const lo = sIso <= eIso ? sIso : eIso;
  const hi = sIso <= eIso ? eIso : sIso;

  const lp = parseYmdParts(lo);
  const dates = [];
  let idx = 0;
  let truncated = false;

  while (true) {
    const dt = new Date(lp.y, lp.m - 1, lp.d + idx);
    const ymd = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    if (ymd > hi) break;
    if (dates.length >= maxDays) {
      truncated = true;
      break;
    }
    dates.push(ymd);
    idx++;
  }
  return { dates, truncated };
}

/**
 * Computes 1-to-1 Export-parity breakdown per NIP matching js/excel-monthly-report.js.
 */
export function computeEmployeeBreakdown(evaluatedRecords, pegawaiList = [], opts = {}) {
  const list = Array.isArray(evaluatedRecords) ? evaluatedRecords : [];
  const dates = [...new Set(list.map(r => String(r.tanggal || '').slice(0, 10)).filter(Boolean))].sort();
  const startDate = opts.startDate || dates[0] || '';
  const endDate = opts.endDate || dates[dates.length - 1] || '';
  const workingDaysNormal = getWorkingDaysInRange(startDate, endDate);
  const inRange = (ymd) => (!startDate || ymd >= startDate) && (!endDate || ymd <= endDate);

  const empMap = new Map();
  const initBucket = (p) => {
    const nip = String(p.nip || '').trim();
    return {
      nip,
      nama_lengkap: p.nama_lengkap || `Pegawai ${nip}`,
      unit_kerja: p.unit_kerja || 'FHISIP',
      status_kepegawaian: p.status_kepegawaian || 'PNS',
      tugasBelajar: TUGAS_BELAJAR_DEFAULT_NIPS.has(nip),
      normalDays: workingDaysNormal,
      dayStatus: new Map(),
      terlambat: 0,
      menitTerlambat: 0,
      pulangCepat: 0,
      tanpaPulang: 0,
      lembur: 0,
      hasAnyRecord: false
    };
  };

  for (const p of pegawaiList) {
    if (p && p.nip) empMap.set(String(p.nip).trim(), initBucket(p));
  }

  for (const r of list) {
    if (!r || !r.nip) continue;
    const nip = String(r.nip).trim();
    if (!empMap.has(nip)) {
      empMap.set(nip, initBucket({ nip, nama_lengkap: r.nama_lengkap, unit_kerja: r.unit_kerja }));
    }
    const agg = empMap.get(nip);
    agg.hasAnyRecord = true;
    const effStatus = r.status_kehadiran || 'Hadir';
    const ymd = String(r.tanggal || '').slice(0, 10);

    if (r.isLembur || effStatus === 'Lembur') {
      agg.lembur++;
    } else if (ymd && inRange(ymd) && !isWeekendDate(ymd)) {
      if (effStatus === 'Hadir') {
        if (r.isTerlambat) {
          agg.terlambat++;
          agg.menitTerlambat += (r.menitTerlambat || 0);
        }
        if (r.isPulangCepat) agg.pulangCepat++;
        if (r.isTanpaPulang) agg.tanpaPulang++;
      }
      if (effStatus === 'Tugas Belajar') agg.tugasBelajar = true;
      const prev = agg.dayStatus.get(ymd);
      const rank = DAY_STATUS_PRIORITY.indexOf(effStatus);
      if (rank >= 0 && (prev === undefined || rank < DAY_STATUS_PRIORITY.indexOf(prev))) {
        agg.dayStatus.set(ymd, effStatus);
      }
    }
  }

  const byNip = new Map();
  const rows = [];
  for (const emp of empMap.values()) {
    if (!emp.hasAnyRecord && !(emp.tugasBelajar && list.length > 0)) continue;
    const c = { Hadir: 0, 'Dinas Luar': 0, 'Tugas Belajar': 0, Cuti: 0, Sakit: 0, Izin: 0, Alpha: 0 };
    for (const st of emp.dayStatus.values()) {
      if (Object.hasOwn(c, st)) c[st]++;
    }
    const recordedDays = Object.values(c).reduce((a, b) => a + b, 0);
    const riilDays = Math.min(emp.normalDays, c.Hadir);
    const absenDays = Math.max(0, emp.normalDays - riilDays);
    const tanpaCatatan = Math.max(0, emp.normalDays - recordedDays);
    const tbOnly = emp.tugasBelajar && riilDays === 0;

    const entry = {
      nip: emp.nip,
      nama_lengkap: emp.nama_lengkap,
      unit_kerja: emp.unit_kerja,
      status_kepegawaian: emp.status_kepegawaian,
      normalDays: emp.normalDays,
      riilDays,
      absenDays,
      terlambat: emp.terlambat,
      menitTerlambat: emp.menitTerlambat,
      pulangCepat: emp.pulangCepat,
      tanpaPulang: emp.tanpaPulang,
      lembur: emp.lembur,
      dinasLuar: tbOnly ? 0 : c['Dinas Luar'] + c['Tugas Belajar'],
      sakit: tbOnly ? 0 : c.Sakit,
      cuti: tbOnly ? 0 : c.Cuti,
      izin: tbOnly ? 0 : c.Izin,
      tanpaKeterangan: tbOnly ? 0 : c.Alpha + tanpaCatatan,
      tanpaCatatan: tbOnly ? 0 : tanpaCatatan,
      tugasBelajar: tbOnly
    };
    byNip.set(emp.nip, entry);
    rows.push(entry);
  }

  return { byNip, rows, startDate, endDate, normalDays: workingDaysNormal };
}

/**
 * Filters evaluated attendance records by month, date range, unit, status, or employee query.
 */
export function filterEvaluatedRecords(records, pegawaiMap, config, filters = {}) {
  const q = String(filters.search || '').trim().toLowerCase();
  const unitQ = String(filters.unit || '').trim().toLowerCase();
  const statusFilter = String(filters.status || '').trim();
  const monthPrefix = String(filters.month || '').trim();
  const dateStart = String(filters.startDate || '').trim();
  const dateEnd = String(filters.endDate || '').trim();

  const evaluated = [];
  for (const raw of records) {
    if (!raw || !raw.tanggal) continue;
    const ymd = String(raw.tanggal).slice(0, 10);
    if (monthPrefix && !ymd.startsWith(monthPrefix)) continue;
    if (dateStart && ymd < dateStart) continue;
    if (dateEnd && ymd > dateEnd) continue;

    const p = pegawaiMap.get(String(raw.nip || '').trim()) || {};
    const enriched = {
      ...raw,
      nama_lengkap: raw.nama_lengkap || p.nama_lengkap || raw.nip,
      unit_kerja: raw.unit_kerja || p.unit_kerja || '-',
      status_kepegawaian: p.status_kepegawaian || raw.status_kepegawaian || 'PNS'
    };

    if (unitQ && !String(enriched.unit_kerja).toLowerCase().includes(unitQ)) continue;
    if (q) {
      const hay = `${enriched.nama_lengkap} ${enriched.nip} ${enriched.unit_kerja}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    const ev = evaluateRecord(enriched, config);
    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'telat' && !ev.isTerlambat) continue;
      if (statusFilter === 'tepat' && (ev.status_kehadiran !== 'Hadir' || ev.isTerlambat || ev.isPulangCepat || ev.isTanpaPulang)) continue;
      if (statusFilter === 'pulang_cepat' && !ev.isPulangCepat) continue;
      if (statusFilter === 'tanpa_pulang' && !ev.isTanpaPulang) continue;
      if (statusFilter === 'lembur' && !ev.isLembur) continue;
      if (statusFilter === 'izin' && !['Izin', 'Cuti', 'Sakit', 'Dinas Luar', 'Tugas Belajar'].includes(ev.status_kehadiran)) continue;
      if (['Hadir', 'Lembur', 'Izin', 'Cuti', 'Sakit', 'Dinas Luar', 'Tugas Belajar', 'Alpha'].includes(statusFilter) && ev.status_kehadiran !== statusFilter) continue;
    }

    evaluated.push(ev);
  }
  return evaluated;
}

/**
 * Finds matching employees using case-insensitive substring or NIP match.
 */
export function searchEmployees(pegawaiList, query = '', unitFilter = '') {
  const q = String(query || '').trim().toLowerCase();
  const u = String(unitFilter || '').trim().toLowerCase();
  return (pegawaiList || [])
    .filter(p => {
      if (u && !String(p.unit_kerja || '').toLowerCase().includes(u)) return false;
      if (!q) return true;
      return `${p.nama_lengkap} ${p.nip} ${p.unit_kerja} ${p.jabatan || ''}`.toLowerCase().includes(q);
    })
    .slice(0, 15)
    .map(p => ({
      nip: p.nip,
      nama_lengkap: p.nama_lengkap,
      status_kepegawaian: p.status_kepegawaian || 'PNS',
      jabatan: p.jabatan || '-',
      unit_kerja: p.unit_kerja || '-'
    }));
}

/**
 * Computes deterministic period discipline counts without sending raw arrays to an LLM.
 */
export function summarizePeriod(rawRecords, pegawaiList, config, filters = {}) {
  const pMap = new Map((pegawaiList || []).map(p => [String(p.nip).trim(), p]));
  const evaluated = filterEvaluatedRecords(rawRecords, pMap, config, filters);
  const breakdown = computeEmployeeBreakdown(evaluated, pegawaiList, {
    startDate: filters.startDate || undefined,
    endDate: filters.endDate || undefined
  });

  const counts = {
    totalRecords: evaluated.length,
    hadir: 0,
    tepatWaktu: 0,
    terlambat: 0,
    pulangCepat: 0,
    tanpaPulang: 0,
    lembur: 0,
    dinasLuar: 0,
    tugasBelajar: 0,
    cuti: 0,
    sakit: 0,
    izin: 0,
    alpha: 0
  };

  for (const r of evaluated) {
    if (r.status_kehadiran === 'Hadir') {
      counts.hadir++;
      if (!r.isTerlambat && !r.isPulangCepat && !r.isTanpaPulang) counts.tepatWaktu++;
      if (r.isTerlambat) counts.terlambat++;
      if (r.isPulangCepat) counts.pulangCepat++;
      if (r.isTanpaPulang) counts.tanpaPulang++;
    } else if (r.status_kehadiran === 'Lembur') counts.lembur++;
    else if (r.status_kehadiran === 'Dinas Luar') counts.dinasLuar++;
    else if (r.status_kehadiran === 'Tugas Belajar') counts.tugasBelajar++;
    else if (r.status_kehadiran === 'Cuti') counts.cuti++;
    else if (r.status_kehadiran === 'Sakit') counts.sakit++;
    else if (r.status_kehadiran === 'Izin') counts.izin++;
    else if (r.status_kehadiran === 'Alpha') counts.alpha++;
  }

  return {
    filterApplied: {
      month: filters.month || 'semua',
      startDate: breakdown.startDate,
      endDate: breakdown.endDate,
      unit: filters.unit || 'semua',
      search: filters.search || null
    },
    normalWorkingDays: breakdown.normalDays,
    activeEmployeesCount: breakdown.rows.length,
    counts
  };
}

/**
 * Simulates the effect of changing schedule thresholds without modifying the database.
 */
export function simulatePolicy(rawRecords, pegawaiList, baseConfig, proposedConfig, filters = {}) {
  const pMap = new Map((pegawaiList || []).map(p => [String(p.nip).trim(), p]));
  const baseEval = filterEvaluatedRecords(rawRecords, pMap, baseConfig, filters);
  const nextCfg = { ...DEFAULT_CONFIG, ...baseConfig, ...proposedConfig };
  const nextEval = filterEvaluatedRecords(rawRecords, pMap, nextCfg, filters);

  const countMetrics = (list) => ({
    totalHadir: list.filter(r => r.status_kehadiran === 'Hadir').length,
    terlambat: list.filter(r => r.isTerlambat).length,
    pulangCepat: list.filter(r => r.isPulangCepat).length,
    tepatWaktu: list.filter(r => r.status_kehadiran === 'Hadir' && !r.isTerlambat && !r.isPulangCepat && !r.isTanpaPulang).length
  });

  const before = countMetrics(baseEval);
  const after = countMetrics(nextEval);
  return {
    baseConfig,
    proposedConfig: nextCfg,
    period: filters.month || `${filters.startDate || 'awal'} s/d ${filters.endDate || 'akhir'}`,
    before,
    after,
    delta: {
      terlambat: after.terlambat - before.terlambat,
      pulangCepat: after.pulangCepat - before.pulangCepat,
      tepatWaktu: after.tepatWaktu - before.tepatWaktu
    }
  };
}

/**
 * Validates and builds a Tier-2 Human-in-the-Loop attendance upsert proposal.
 * Enforces NIP uniqueness, max 62 days, weekend Lembur, and null times on non-timed statuses.
 */
export function buildAttendanceDraft(pegawaiList, existingAbsensi, params) {
  const employeeQuery = String(params.nip || params.employeeQuery || '').trim();
  if (!employeeQuery) {
    return { ok: false, error: 'Nama pegawai atau NIP wajib diisi.' };
  }

  let matchedEmployees = [];
  const exactNip = (pegawaiList || []).find(p => String(p.nip).trim() === employeeQuery);
  if (exactNip) {
    matchedEmployees = [exactNip];
  } else {
    const low = employeeQuery.toLowerCase();
    matchedEmployees = (pegawaiList || []).filter(p =>
      String(p.nama_lengkap || '').toLowerCase().includes(low) ||
      String(p.nip || '').toLowerCase().includes(low)
    );
  }

  if (matchedEmployees.length === 0) {
    return { ok: false, error: `Pegawai dengan nama/NIP "${employeeQuery}" tidak ditemukan dalam daftar 136 pegawai FHISIP UT.` };
  }
  if (matchedEmployees.length > 1) {
    return {
      ok: false,
      ambiguous: true,
      error: `Ditemukan ${matchedEmployees.length} pegawai cocok dengan "${employeeQuery}". Minta Pengelola SDM memilih salah satu NIP spesifik.`,
      candidates: matchedEmployees.slice(0, 8).map(p => ({
        nip: p.nip,
        nama_lengkap: p.nama_lengkap,
        unit_kerja: p.unit_kerja
      }))
    };
  }

  const emp = matchedEmployees[0];
  const startDate = String(params.startDate || '').slice(0, 10);
  const endDate = String(params.endDate || startDate).slice(0, 10);
  if (!parseYmdParts(startDate) || !parseYmdParts(endDate)) {
    return { ok: false, error: 'Format tanggal tidak valid. Gunakan format YYYY-MM-DD.' };
  }

  const { dates, truncated } = enumerateDatesInclusive(startDate, endDate, QUOTA_RULES.maxBatchDays);
  if (dates.length === 0) {
    return { ok: false, error: 'Rentang tanggal tidak menghasilkan tanggal yang valid.' };
  }

  const normalizedStatus = normalizeStatusValue(params.status || 'Hadir');
  if (normalizedStatus === 'Alpha') {
    return { ok: false, error: 'Status Alpha tidak diinput via draf AI; hari kerja tanpa presensi otomatis terhitung di Tanpa Keterangan.' };
  }

  const skipWeekend = params.skipWeekend !== false; // default true for ranges unless Lembur or explicit false
  const isRange = dates.length > 1;
  const targetDates = (isRange && skipWeekend && normalizedStatus !== 'Lembur')
    ? dates.filter(ymd => !isWeekendDate(ymd))
    : dates;

  if (targetDates.length === 0) {
    return { ok: false, error: 'Semua tanggal pada rentang tersebut jatuh pada akhir pekan (Sabtu/Minggu) dan dilewati otomatis.' };
  }

  const existingByKey = new Map();
  for (const r of (existingAbsensi || [])) {
    if (r && r.nip && r.tanggal) {
      existingByKey.set(`${String(r.nip).trim()}|${String(r.tanggal).slice(0, 10)}`, r);
    }
  }

  const rulesApplied = [];
  if (isNonTimedStatus(normalizedStatus)) {
    rulesApplied.push(`Status ${normalizedStatus}: jam_masuk & jam_pulang otomatis dikosongkan.`);
  }
  if (isRange && skipWeekend && normalizedStatus !== 'Lembur') {
    rulesApplied.push('Sabtu & Minggu dalam rentang dilewati otomatis.');
  }

  let insertCount = 0;
  let overwriteCount = 0;
  let weekendAutoLemburCount = 0;

  const records = targetDates.map(ymd => {
    const key = `${emp.nip}|${ymd}`;
    const existing = existingByKey.get(key);
    if (existing) overwriteCount++;
    else insertCount++;

    const weekend = isWeekendDate(ymd);
    if (weekend && normalizedStatus === 'Hadir') weekendAutoLemburCount++;

    return normalizeAttendanceRecord({
      id: existing ? existing.id : `rec_ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tanggal: ymd,
      nip: emp.nip,
      nama_lengkap: emp.nama_lengkap,
      unit_kerja: emp.unit_kerja,
      jam_masuk: params.jamMasuk || null,
      jam_pulang: params.jamPulang || null,
      status_kehadiran: normalizedStatus,
      keterangan: params.keterangan ? String(params.keterangan).trim().slice(0, 200) : `Input Asisten AI SDM (${normalizedStatus})`
    });
  });

  if (weekendAutoLemburCount > 0) {
    rulesApplied.push(`${weekendAutoLemburCount} hari akhir pekan otomatis dikonversi ke Lembur tanpa jam.`);
  }

  return {
    ok: true,
    truncated,
    proposal: {
      actionType: 'UPSERT_ATTENDANCE',
      employee: {
        nip: emp.nip,
        nama_lengkap: emp.nama_lengkap,
        unit_kerja: emp.unit_kerja
      },
      requestedStatus: normalizedStatus,
      startDate: targetDates[0],
      endDate: targetDates[targetDates.length - 1],
      totalDays: records.length,
      insertCount,
      overwriteCount,
      rulesApplied,
      records
    }
  };
}
