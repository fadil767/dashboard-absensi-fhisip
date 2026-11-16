/**
 * Endpoint AI Agent Khusus Pengelola SDM FHISIP Universitas Terbuka
 * Vercel Node.js Function (Fluid Compute) + Lokal Node Server Bridge
 *
 * Arsitektur & Rules:
 * 1. RBAC Ketat: Hanya SDM & Kepegawaian FHISIP, SDM & Administrasi Umum, dan Administrator.
 * 2. Kuota Terukur: 100 interaksi/hari per akun SDM, batas tim 300/hari (reset 00:00 WIB), cooldown 2,5 detik.
 * 3. Tiered Tools + Human-in-the-Loop: Tool baca jalan otomatis; tool ubah data HANYA membuat draf + tanda tangan HMAC menunggu klik Setujui admin; tool hapus/reset diblokir.
 * 4. Anti-Halusinasi & Hemat Token: Angka dihitung deterministik dari lib/fhisip-agent-rules.mjs, tidak mengirim ribuan baris mentah ke LLM.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { ToolLoopAgent, tool, isStepCount } from 'ai';
import { z } from 'zod';
import {
  QUOTA_RULES,
  DEFAULT_CONFIG,
  isPengelolaSdmActor,
  getWibDayBoundsIso,
  filterEvaluatedRecords,
  computeEmployeeBreakdown,
  searchEmployees,
  summarizePeriod,
  simulatePolicy,
  buildAttendanceDraft
} from '../lib/fhisip-agent-rules.mjs';

const DEFAULT_SUPABASE_URL = 'https://sxnimpyselgoenpurhhw.supabase.co';
const DEFAULT_SUPABASE_ANON = 'sb_publishable_pm5jUtQVQf2wpWrtMtkm-Q_L6eb73S3';
const DEFAULT_MODEL = 'google/gemini-3.8-flash';

const RULES_SUMMARY = [
  {
    layer: 'Akses & Peran (RBAC)',
    detail: 'Hanya aktif untuk Pengelola SDM (Radhitya, Viku, Septin, Administrator). Akun Dosen, Dekan, Evaluator & Tamu ditolak (HTTP 403).'
  },
  {
    layer: 'Kuota & Hemat Token',
    detail: `Maksimal ${QUOTA_RULES.dailyLimitPerUser} tanya/hari per akun SDM (batas tim ${QUOTA_RULES.dailyTeamLimit}/hari, reset ${QUOTA_RULES.resetLabel}), jeda ${QUOTA_RULES.cooldownMs / 1000} detik, dan maksimal ${QUOTA_RULES.maxHistoryMessages} pesan konteks.`
  },
  {
    layer: 'Kebijakan Presensi FHISIP UT',
    detail: 'Sabtu–Minggu otomatis Lembur (tanpa jam). Izin, Cuti, Sakit, Dinas Luar, Tugas Belajar, & Alpha otomatis tanpa jam. Ekspor D.Luar/Cuti/Sakit/Ijin 100% sinkron.'
  },
  {
    layer: 'Persetujuan Manusia (Tier 1–3)',
    detail: 'Tier 1 (Baca/Audit/Simulasi/Filter) berjalan otomatis. Tier 2 (Input/Ubah Data/Kebijakan) wajib preview + klik Setujui. Tier 3 (Hapus/Reset Massal) diblokir untuk AI.'
  }
];

let envLoaded = false;
let snapshotCache = { loadedAt: 0, data: null };
const lastBurstByUser = new Map();

function ensureEnvLoaded() {
  if (envLoaded) return;
  envLoaded = true;
  // Di Vercel Production/Preview semua secret disuntik otomatis via process.env;
  // Di lokal non-Vercel, .env / .env.local dimuat hanya bila bukan runtime Vercel dan tanpa bundling static file trace.
  if (process.env.VERCEL === '1') return;
  try {
    const cwd = process.cwd();
    const envNames = ['.' + 'env', '.' + 'env.local'];
    for (const name of envNames) {
      const filePath = path.join(cwd, name);
      if (!fs.existsSync(filePath)) continue;
      const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        if (!key || (Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key])) continue;
        let val = line.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  } catch (_) {
    // Abaikan error baca env lokal agar runtime serverless read-only tetap aman
  }
}

function getSupabaseConfig() {
  ensureEnvLoaded();
  return {
    url: (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, ''),
    key: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_ANON
  };
}

function getGatewayAuthStatus() {
  ensureEnvLoaded();
  const hasApiKey = Boolean(process.env.AI_GATEWAY_API_KEY && process.env.AI_GATEWAY_API_KEY.trim());
  const hasOidc = Boolean(process.env.VERCEL_OIDC_TOKEN && process.env.VERCEL_OIDC_TOKEN.trim());
  const model = process.env.AI_GATEWAY_MODEL || DEFAULT_MODEL;
  return {
    configured: hasApiKey || hasOidc,
    authMode: hasApiKey ? 'api-key' : (hasOidc ? 'oidc' : 'unconfigured'),
    model
  };
}

function getApprovalSecret() {
  ensureEnvLoaded();
  const seed = process.env.AGENT_APPROVAL_SECRET
    || process.env.AI_GATEWAY_API_KEY
    || process.env.SUPABASE_SECRET_KEY
    || process.env.VERCEL_PROJECT_ID
    || 'fhisip-ut-sdm-approval-guard-v1';
  return crypto.createHash('sha256').update(String(seed)).digest();
}

function signProposal(username, proposal, expiresAt) {
  const canonical = JSON.stringify({
    u: String(username || '').toLowerCase(),
    exp: expiresAt,
    t: proposal.actionType,
    p: proposal.actionType === 'UPSERT_ATTENDANCE'
      ? { nip: proposal.employee?.nip, s: proposal.startDate, e: proposal.endDate, n: proposal.totalDays, st: proposal.requestedStatus }
      : proposal.after
  });
  return crypto.createHmac('sha256', getApprovalSecret()).update(canonical).digest('hex');
}

function verifyProposalSignature(username, proposal, expiresAt, signature) {
  if (!signature || !expiresAt || Date.now() > Number(expiresAt)) return false;
  const expected = signProposal(username, proposal, Number(expiresAt));
  try {
    const a = Buffer.from(String(signature), 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function validateSameOrigin(request) {
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite === 'cross-site') return false;

  const origin = request.headers.get('origin');
  if (!origin) return true; // Browser same-origin GET atau internal call

  try {
    const u = new URL(origin);
    const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').split(':')[0].toLowerCase();
    const oHost = u.hostname.toLowerCase();
    if (oHost === host) return true;
    if (oHost === 'localhost' || oHost === '127.0.0.1') return true;
    if (oHost.endsWith('.vercel.app') && host.endsWith('.vercel.app')) return true;
    return false;
  } catch (_) {
    return false;
  }
}

async function supabaseFetch(restPath, options = {}) {
  const { url, key } = getSupabaseConfig();
  const res = await fetch(`${url}/rest/v1/${restPath}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  return res;
}

async function fetchAllPaginated(tablePath) {
  const pageSize = 1000;
  const firstRes = await supabaseFetch(`${tablePath}${tablePath.includes('?') ? '&' : '?'}limit=${pageSize}&offset=0`, {
    headers: { Prefer: 'count=exact' }
  });
  if (!firstRes.ok) {
    throw new Error(`Supabase REST error (${firstRes.status}) pada ${tablePath}`);
  }
  const firstRows = await firstRes.json();
  const cr = firstRes.headers.get('content-range') || '';
  const totalMatch = /\/(\d+)$/.exec(cr);
  const total = totalMatch ? parseInt(totalMatch[1], 10) : firstRows.length;

  if (!Array.isArray(firstRows) || total <= pageSize) {
    return Array.isArray(firstRows) ? firstRows : [];
  }

  const all = [...firstRows];
  const offsets = [];
  for (let off = pageSize; off < total; off += pageSize) offsets.push(off);

  const chunks = await Promise.all(offsets.map(async off => {
    const r = await supabaseFetch(`${tablePath}${tablePath.includes('?') ? '&' : '?'}limit=${pageSize}&offset=${off}`);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  }));
  for (const chunk of chunks) all.push(...chunk);
  return all;
}

function loadLocalFallbackSnapshot() {
  const dataPath = path.join(process.cwd(), 'js', 'data-fhisip.js');
  if (!fs.existsSync(dataPath)) {
    return { pegawai: [], absensi: [], config: { ...DEFAULT_CONFIG }, source: 'empty' };
  }
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(dataPath, 'utf8'), ctx);
  const initial = ctx.window?.INITIAL_FHISIP_DATA || { pegawai: [], absensi: [] };
  return {
    pegawai: initial.pegawai || [],
    absensi: initial.absensi || [],
    config: { ...DEFAULT_CONFIG },
    source: 'local-fallback'
  };
}

async function getLiveSnapshot(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && snapshotCache.data && (now - snapshotCache.loadedAt) < 15000) {
    return snapshotCache.data;
  }

  try {
    const [unitsRes, pegawaiRes, cfgRes, absensiRows] = await Promise.all([
      supabaseFetch('unit_kerja?select=id,nama'),
      supabaseFetch('pegawai?select=nip,nama_lengkap,status_kepegawaian,jabatan,unit_kerja_id,aktif&limit=1000'),
      supabaseFetch('pengaturan_jam_kerja?select=jam_masuk,toleransi_menit,jam_pulang,jam_pulang_jumat&order=id.desc&limit=1'),
      fetchAllPaginated('absensi?select=id,nip,tanggal,jam_masuk,jam_pulang,status_kehadiran,keterangan&order=tanggal.desc,id.desc')
    ]);

    if (!unitsRes.ok || !pegawaiRes.ok) {
      throw new Error('Gagal memuat master unit/pegawai dari Supabase');
    }

    const [units, pegawaiRaw, cfgRows] = await Promise.all([
      unitsRes.json(),
      pegawaiRes.json(),
      cfgRes.ok ? cfgRes.json() : Promise.resolve([])
    ]);

    const unitMap = new Map((units || []).map(u => [u.id, u.nama]));
    const pegawai = (pegawaiRaw || []).map(p => ({
      nip: String(p.nip).trim(),
      nama_lengkap: p.nama_lengkap,
      status_kepegawaian: p.status_kepegawaian || 'PNS',
      jabatan: p.jabatan || '',
      unit_kerja: unitMap.get(p.unit_kerja_id) || 'FHISIP'
    }));

    const pMap = new Map(pegawai.map(p => [p.nip, p]));
    const absensi = (absensiRows || []).map(a => {
      const emp = pMap.get(String(a.nip).trim()) || {};
      return {
        id: a.id,
        tanggal: String(a.tanggal || '').slice(0, 10),
        nip: String(a.nip).trim(),
        nama_lengkap: emp.nama_lengkap || a.nip,
        unit_kerja: emp.unit_kerja || '-',
        jam_masuk: a.jam_masuk || null,
        jam_pulang: a.jam_pulang || null,
        status_kehadiran: a.status_kehadiran || 'Hadir',
        keterangan: a.keterangan || null
      };
    });

    const latestCfg = Array.isArray(cfgRows) && cfgRows[0] ? cfgRows[0] : null;
    const config = latestCfg
      ? {
          jamMasuk: latestCfg.jam_masuk || DEFAULT_CONFIG.jamMasuk,
          toleransi: Number(latestCfg.toleransi_menit ?? DEFAULT_CONFIG.toleransi),
          jamPulang: latestCfg.jam_pulang || DEFAULT_CONFIG.jamPulang,
          jamPulangJumat: latestCfg.jam_pulang_jumat || DEFAULT_CONFIG.jamPulangJumat,
          preset: 'cloud'
        }
      : { ...DEFAULT_CONFIG };

    const data = { pegawai, absensi, config, source: 'supabase-cloud' };
    snapshotCache = { loadedAt: now, data };
    return data;
  } catch (err) {
    console.warn('[AgentAPI] Supabase snapshot fallback ke lokal:', err.message);
    return loadLocalFallbackSnapshot();
  }
}

async function getQuotaStatus(username) {
  const userKey = String(username || '').trim().toLowerCase();
  const { dateYmdWib, startUtcIso } = getWibDayBoundsIso();

  try {
    const res = await supabaseFetch(
      `audit_log?select=user_identifier,created_at&aksi=eq.AI_AGENT_QUERY&created_at=gte.${encodeURIComponent(startUtcIso)}&order=created_at.desc&limit=500`
    );
    if (!res.ok) throw new Error(`audit_log status ${res.status}`);
    const rows = await res.json();
    const list = Array.isArray(rows) ? rows : [];
    const userRows = list.filter(r => String(r.user_identifier || '').trim().toLowerCase() === userKey);
    const usedToday = userRows.length;
    const teamUsedToday = list.length;
    const lastCreatedAt = userRows[0]?.created_at ? Date.parse(userRows[0].created_at) : 0;
    const memBurst = lastBurstByUser.get(userKey) || 0;

    return {
      source: 'supabase-audit-log',
      dateYmdWib,
      usedToday,
      userLimit: QUOTA_RULES.dailyLimitPerUser,
      remainingToday: Math.max(0, QUOTA_RULES.dailyLimitPerUser - usedToday),
      teamUsedToday,
      teamLimit: QUOTA_RULES.dailyTeamLimit,
      teamRemaining: Math.max(0, QUOTA_RULES.dailyTeamLimit - teamUsedToday),
      lastRequestAt: Math.max(lastCreatedAt || 0, memBurst),
      cooldownMs: QUOTA_RULES.cooldownMs,
      resetLabel: QUOTA_RULES.resetLabel
    };
  } catch (_) {
    return {
      source: 'memory-fallback',
      dateYmdWib,
      usedToday: 0,
      userLimit: QUOTA_RULES.dailyLimitPerUser,
      remainingToday: QUOTA_RULES.dailyLimitPerUser,
      teamUsedToday: 0,
      teamLimit: QUOTA_RULES.dailyTeamLimit,
      teamRemaining: QUOTA_RULES.dailyTeamLimit,
      lastRequestAt: lastBurstByUser.get(userKey) || 0,
      cooldownMs: QUOTA_RULES.cooldownMs,
      resetLabel: QUOTA_RULES.resetLabel
    };
  }
}

async function writeAuditLog(userIdentifier, aksi, detail) {
  try {
    await supabaseFetch('audit_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_identifier: String(userIdentifier || 'sdm').slice(0, 120),
        aksi,
        detail
      })
    });
  } catch (err) {
    console.warn('[AgentAPI] Gagal menulis audit_log:', err.message);
  }
}

async function checkGatewayCreditsSafe() {
  const auth = getGatewayAuthStatus();
  if (!auth.configured) {
    return { available: false, reason: 'missing_auth', balance: null };
  }
  const bearer = (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || '').trim();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://ai-gateway.vercel.sh/v1/credits', {
      headers: { Authorization: `Bearer ${bearer}` },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return { available: false, reason: `http_${res.status}`, balance: null };
    const data = await res.json();
    return { available: true, balance: data.balance ?? null, totalUsed: data.total_used ?? null };
  } catch (_) {
    return { available: false, reason: 'unreachable', balance: null };
  }
}

function classifyGatewayError(err) {
  const status = err?.statusCode || err?.data?.error?.code || err?.cause?.statusCode || 500;
  const msg = String(err?.message || '');
  const low = msg.toLowerCase();

  if (low.includes('customer_verification_required') || low.includes('payment method') || low.includes('credit card')) {
    return {
      httpStatus: 402,
      code: 'GATEWAY_VERIFICATION_REQUIRED',
      error: 'Tim Vercel Anda perlu verifikasi metode pembayaran di menu AI Gateway untuk mengaktifkan kredit gratis / akses model.',
      actionUrl: 'https://vercel.com/~/ai-gateway'
    };
  }
  if (status === 402 || low.includes('insufficient_funds') || low.includes('insufficient credits')) {
    return {
      httpStatus: 402,
      code: 'GATEWAY_CREDITS_EMPTY',
      error: 'Saldo Kredit AI Gateway Vercel saat ini kosong ($0). Silakan aktifkan kredit gratis / top-up di Vercel AI Gateway atau tambahkan AI_GATEWAY_API_KEY / BYOK.',
      actionUrl: 'https://vercel.com/~/ai-gateway'
    };
  }
  if (low.includes('quota_for_entity_exceeded')) {
    return {
      httpStatus: 402,
      code: 'GATEWAY_BUDGET_EXCEEDED',
      error: 'Batas budget AI Gateway untuk tim/proyek ini telah tercapai.',
      actionUrl: 'https://vercel.com/~/ai-gateway'
    };
  }
  if (status === 401 || status === 403 || low.includes('unauthorized') || low.includes('oidc') || low.includes('api key')) {
    return {
      httpStatus: 401,
      code: 'GATEWAY_AUTH_ERROR',
      error: 'Autentikasi Vercel AI Gateway belum aktif atau token OIDC lokal kedaluwarsa (jalankan `vercel env pull .env.local` jika di lokal, atau atur `AI_GATEWAY_API_KEY`).',
      actionUrl: 'https://vercel.com/docs/ai-gateway/getting-started'
    };
  }
  if (status === 429 || low.includes('rate limit')) {
    return {
      httpStatus: 429,
      code: 'GATEWAY_RATE_LIMITED',
      error: 'Rate limit model AI Gateway sementara tercapai. Tunggu beberapa detik lalu coba lagi.'
    };
  }
  return {
    httpStatus: 500,
    code: 'AGENT_EXECUTION_ERROR',
    error: `Terjadi kendala saat memproses permintaan AI Agent: ${msg.slice(0, 220)}`
  };
}

function buildSdmSystemPrompt({ actor, configSnapshot, snapshot }) {
  const cfg = configSnapshot || snapshot.config || DEFAULT_CONFIG;
  const availableMonths = [...new Set((snapshot.absensi || []).map(r => String(r.tanggal || '').slice(0, 7)).filter(Boolean))].sort();
  return `Anda adalah Asisten AI Pengelola SDM resmi Fakultas Hukum, Ilmu Sosial, dan Ilmu Politik (FHISIP) Universitas Terbuka.
Pengguna aktif: ${actor.name} (${actor.role}, username: ${actor.username}).
Periode data tersedia: ${availableMonths.join(', ') || '2026-09, 2026-10'} (Total pegawai: ${snapshot.pegawai.length}, Total catatan: ${snapshot.absensi.length}).
Konfigurasi jam kerja aktif saat ini: Batas Masuk ${cfg.jamMasuk} WIB (Toleransi ${cfg.toleransi || 0} menit), Pulang Senin-Kamis ${cfg.jamPulang} WIB, Pulang Jumat ${cfg.jamPulangJumat || cfg.jamPulang} WIB.

ATURAN WAJIB (PATUHI 100%):
1. ANTI-HALUSINASI: Dilarang mengarang angka, NIP, tanggal, atau jumlah kehadiran. Selalu panggil tool untuk membaca data dan menghitung angka.
2. KEBIJAKAN PRESENSI FHISIP UT:
   - Sabtu & Minggu otomatis berstatus "Lembur" TANPA jam masuk dan jam pulang.
   - Status "Lembur", "Izin", "Cuti", "Sakit", "Dinas Luar", "Tugas Belajar", dan "Alpha" TIDAK memiliki jam masuk/pulang (kosong/null).
   - Pada laporan resmi & Tab Rekap per Pegawai: D.Luar, Cuti, Sakit, Ijin dihitung HANYA dari catatan nyata; hari kerja normal tanpa catatan masuk ke "Tanpa Keterangan". Absen = Normal - Riil.
3. TIER EKSEKUSI TOOL & KONFIRMASI:
   - Tier 1 (cariPegawai, ringkasanDisiplinPeriode, auditPegawaiTerlambatAtauAnomali, cekRekapPegawaiResmi, simulasiKebijakanJamKerja, terapkanFilterDashboard) boleh langsung dijalankan.
   - Tier 2 (siapkanInputPresensi, siapkanUbahKebijakan) HANYA membuat draf preview untuk disetujui Pengelola SDM di layar. Jelaskan ringkasan drafnya secara jelas dan informasikan bahwa data belum tersimpan sebelum admin mengklik tombol "Setujui & Simpan".
   - Tier 3 (Hapus catatan / Reset database / Gantikan seluruh data) DILARANG untuk AI. Jika user meminta menghapus atau reset database, tolak dengan sopan dan arahkan ke tombol manual di dashboard.
4. AMBIGUITAS NAMA: Jika nama pegawai tidak unik (lebih dari 1 kandidat), sebutkan daftar kandidat (Nama, NIP, Unit Kerja) dan minta user memilih satu NIP spesifik.
5. BAHASA & FORMAT: Jawab ringkas, akurat, profesional dalam Bahasa Indonesia menggunakan Markdown rapi.`;
}

function createAgentTools({ snapshot, activeConfig, pendingProposals, uiCommands }) {
  const pegawaiList = snapshot.pegawai;
  const absensiList = snapshot.absensi;

  return {
    cariPegawai: tool({
      description: 'Cari daftar pegawai FHISIP UT berdasarkan potongan nama, NIP, atau unit kerja. Mengembalikan maksimal 15 pegawai.',
      inputSchema: z.object({
        query: z.string().describe('Potongan nama pegawai atau NIP yang dicari'),
        unit: z.string().optional().describe('Opsional filter bagian/program studi')
      }),
      execute: async ({ query, unit }) => {
        const matches = searchEmployees(pegawaiList, query, unit);
        return { totalFound: matches.length, employees: matches };
      }
    }),

    ringkasanDisiplinPeriode: tool({
      description: 'Menghitung ringkasan jumlah presensi, tepat waktu, terlambat, pulang cepat, belum scan pulang, lembur, cuti, sakit, izin, dinas luar untuk suatu bulan atau rentang tanggal.',
      inputSchema: z.object({
        month: z.string().optional().describe('Filter bulan format YYYY-MM, misalnya 2026-10 atau 2026-09'),
        startDate: z.string().optional().describe('Tanggal awal YYYY-MM-DD (opsional)'),
        endDate: z.string().optional().describe('Tanggal akhir YYYY-MM-DD (opsional)'),
        unit: z.string().optional().describe('Filter Unit Kerja / Prodi (opsional)')
      }),
      execute: async ({ month, startDate, endDate, unit }) => {
        return summarizePeriod(absensiList, pegawaiList, activeConfig, { month, startDate, endDate, unit });
      }
    }),

    auditPegawaiTerlambatAtauAnomali: tool({
      description: 'Mengambil daftar pegawai teratas yang paling sering Terlambat, Pulang Cepat, Belum Scan Pulang, atau Tanpa Keterangan pada periode tertentu.',
      inputSchema: z.object({
        month: z.string().optional().describe('Bulan YYYY-MM, contoh: 2026-10'),
        metric: z.enum(['terlambat', 'pulangCepat', 'tanpaPulang', 'tanpaKeterangan', 'lembur']).default('terlambat'),
        unit: z.string().optional().describe('Filter Unit Kerja opsional'),
        minCount: z.number().int().min(1).default(1).describe('Batas minimum kemunculan'),
        limit: z.number().int().min(1).max(25).default(10).describe('Jumlah baris maksimal (1-25)')
      }),
      execute: async ({ month, metric, unit, minCount, limit }) => {
        const pMap = new Map(pegawaiList.map(p => [String(p.nip).trim(), p]));
        const evaluated = filterEvaluatedRecords(absensiList, pMap, activeConfig, { month, unit });
        const breakdown = computeEmployeeBreakdown(evaluated, pegawaiList);
        const rows = breakdown.rows
          .filter(r => (r[metric] || 0) >= minCount)
          .sort((a, b) => (b[metric] - a[metric]) || (b.menitTerlambat - a.menitTerlambat))
          .slice(0, limit)
          .map(r => ({
            nip: r.nip,
            nama_lengkap: r.nama_lengkap,
            unit_kerja: r.unit_kerja,
            [metric]: r[metric],
            totalMenitTelat: r.menitTerlambat,
            normalDays: r.normalDays,
            riilDays: r.riilDays,
            absenDays: r.absenDays
          }));
        return {
          period: { month: month || 'aktif', startDate: breakdown.startDate, endDate: breakdown.endDate, normalWorkingDays: breakdown.normalDays },
          metric,
          totalMatchingEmployees: rows.length,
          topEmployees: rows
        };
      }
    }),

    cekRekapPegawaiResmi: tool({
      description: 'Mengambil rincian kehadiran resmi per pegawai (sama 1-to-1 dengan Export Excel & Tab Rekap per Pegawai): Normal, Riil, Absen, D.Luar, Cuti, Sakit, Izin, Tanpa Keterangan, Terlambat, Lembur.',
      inputSchema: z.object({
        employeeQuery: z.string().describe('Nama atau NIP pegawai'),
        month: z.string().optional().describe('Bulan YYYY-MM, misalnya 2026-10')
      }),
      execute: async ({ employeeQuery, month }) => {
        const pMap = new Map(pegawaiList.map(p => [String(p.nip).trim(), p]));
        const evaluated = filterEvaluatedRecords(absensiList, pMap, activeConfig, { month });
        const breakdown = computeEmployeeBreakdown(evaluated, pegawaiList);
        const q = employeeQuery.trim().toLowerCase();
        const matches = breakdown.rows.filter(r =>
          String(r.nip).toLowerCase() === q || String(r.nama_lengkap).toLowerCase().includes(q)
        );
        return {
          month: month || 'semua periode aktif',
          normalWorkingDays: breakdown.normalDays,
          matchedCount: matches.length,
          employees: matches.slice(0, 10)
        };
      }
    }),

    simulasiKebijakanJamKerja: tool({
      description: 'Mensimulasikan perubahan jam masuk, toleransi keterlambatan, atau jam pulang tanpa mengubah database.',
      inputSchema: z.object({
        month: z.string().optional().describe('Bulan simulasi YYYY-MM, misalnya 2026-10'),
        jamMasuk: z.string().optional().describe('Jam masuk baru HH:MM, misal 08:00'),
        toleransi: z.number().int().min(0).max(60).optional().describe('Menit toleransi keterlambatan'),
        jamPulang: z.string().optional().describe('Jam pulang Senin-Kamis HH:MM, misal 16:30'),
        jamPulangJumat: z.string().optional().describe('Jam pulang hari Jumat HH:MM, misal 17:00')
      }),
      execute: async ({ month, jamMasuk, toleransi, jamPulang, jamPulangJumat }) => {
        const proposed = {};
        if (jamMasuk) proposed.jamMasuk = jamMasuk;
        if (toleransi !== undefined) proposed.toleransi = toleransi;
        if (jamPulang) proposed.jamPulang = jamPulang;
        if (jamPulangJumat) proposed.jamPulangJumat = jamPulangJumat;
        return simulatePolicy(absensiList, pegawaiList, activeConfig, proposed, { month });
      }
    }),

    terapkanFilterDashboard: tool({
      description: 'Mengatur tampilan/filter Dashboard di browser Pengelola SDM (ganti tab ke log harian/rekap pegawai/rekap prodi, isi kolom pencarian, bulan, atau filter status).',
      inputSchema: z.object({
        tab: z.enum(['harian', 'pegawai', 'prodi']).optional().describe('Tab dashboard yang dibuka'),
        search: z.string().optional().describe('Kata kunci pencarian nama/NIP/unit'),
        month: z.string().optional().describe('Bulan periode YYYY-MM atau kosong untuk semua'),
        status: z.enum(['all', 'telat', 'tepat', 'pulang_cepat', 'tanpa_pulang', 'anomali', 'lembur', 'izin']).optional()
      }),
      execute: async (params) => {
        uiCommands.push({ type: 'APPLY_UI_FILTER', params });
        return { appliedInUI: true, filter: params };
      }
    }),

    siapkanInputPresensi: tool({
      description: 'TIER 2 PREVIEW (TIDAK LANGSUNG SIMPAN): Menyiapkan draf tambah/ubah presensi untuk 1 tanggal atau rentang tanggal (Cuti, Izin, Sakit, Dinas Luar, Lembur, Hadir) hingga maksimal 62 hari agar disetujui Pengelola SDM.',
      inputSchema: z.object({
        employeeQuery: z.string().describe('Nama lengkap atau NIP pegawai (jika ambigu akan dikembalikan daftar kandidat NIP)'),
        status: z.enum(['Hadir', 'Cuti', 'Izin', 'Sakit', 'Dinas Luar', 'Lembur', 'Tugas Belajar']).describe('Status kehadiran'),
        startDate: z.string().describe('Tanggal mulai format YYYY-MM-DD'),
        endDate: z.string().optional().describe('Tanggal selesai format YYYY-MM-DD (kosongkan jika 1 hari)'),
        skipWeekend: z.boolean().optional().default(true).describe('Lewati Sabtu & Minggu untuk rentang hari kerja (otomatis false jika status Lembur)'),
        jamMasuk: z.string().optional().describe('Hanya untuk status Hadir di hari kerja, format HH:MM'),
        jamPulang: z.string().optional().describe('Hanya untuk status Hadir di hari kerja, format HH:MM'),
        keterangan: z.string().optional().describe('Catatan pendukung, misal Cuti Tahunan / Surat Dokter / Nomor Surat Tugas')
      }),
      execute: async (params) => {
        const draft = buildAttendanceDraft(pegawaiList, absensiList, params);
        if (!draft.ok) return draft;
        pendingProposals.push(draft.proposal);
        return {
          ok: true,
          requiresAdminApproval: true,
          truncated: draft.truncated,
          previewSummary: {
            employee: draft.proposal.employee,
            status: draft.proposal.requestedStatus,
            startDate: draft.proposal.startDate,
            endDate: draft.proposal.endDate,
            totalDays: draft.proposal.totalDays,
            insertCount: draft.proposal.insertCount,
            overwriteCount: draft.proposal.overwriteCount,
            rulesApplied: draft.proposal.rulesApplied
          }
        };
      }
    }),

    siapkanUbahKebijakan: tool({
      description: 'TIER 2 PREVIEW (TIDAK LANGSUNG SIMPAN): Menyiapkan draf perubahan pengaturan batas jam datang, toleransi keterlambatan, atau jam pulang untuk dikonfirmasi Pengelola SDM.',
      inputSchema: z.object({
        jamMasuk: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Batas jam masuk format HH:MM'),
        toleransi: z.number().int().min(0).max(60).optional().describe('Menit toleransi keterlambatan (0-60)'),
        jamPulang: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Jam pulang Senin-Kamis HH:MM'),
        jamPulangJumat: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Jam pulang hari Jumat HH:MM')
      }),
      execute: async (params) => {
        const after = {
          ...activeConfig,
          ...(params.jamMasuk ? { jamMasuk: params.jamMasuk } : {}),
          ...(params.toleransi !== undefined ? { toleransi: params.toleransi } : {}),
          ...(params.jamPulang ? { jamPulang: params.jamPulang } : {}),
          ...(params.jamPulangJumat ? { jamPulangJumat: params.jamPulangJumat } : {}),
          preset: 'custom'
        };
        const proposal = {
          actionType: 'UPDATE_POLICY',
          before: { ...activeConfig },
          after
        };
        pendingProposals.push(proposal);
        return { ok: true, requiresAdminApproval: true, before: proposal.before, after: proposal.after };
      }
    })
  };
}

export async function GET(request) {
  if (!validateSameOrigin(request)) {
    return Response.json({ error: 'Origin tidak diizinkan.' }, { status: 403 });
  }

  const url = new URL(request.url, 'http://localhost');
  const actor = {
    username: url.searchParams.get('username') || '',
    role: url.searchParams.get('role') || '',
    name: url.searchParams.get('name') || '',
    isGuest: url.searchParams.get('isGuest') === 'true'
  };

  if (!isPengelolaSdmActor(actor)) {
    return Response.json({
      allowed: false,
      error: 'Akses ditolak. Asisten AI khusus untuk Pengelola SDM FHISIP UT (Radhitya, Viku, Septin, Administrator).'
    }, { status: 403 });
  }

  const [quota, credits] = await Promise.all([
    getQuotaStatus(actor.username),
    checkGatewayCreditsSafe()
  ]);

  const gateway = getGatewayAuthStatus();

  return Response.json({
    allowed: true,
    actor: { username: actor.username, role: actor.role, name: actor.name },
    quota,
    gateway: {
      ...gateway,
      credits
    },
    rulesSummary: RULES_SUMMARY
  });
}

export async function POST(request) {
  if (!validateSameOrigin(request)) {
    return Response.json({ error: 'Origin tidak diizinkan.' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return Response.json({ error: 'Body JSON tidak valid.' }, { status: 400 });
  }

  const actor = body?.actor || null;
  if (!isPengelolaSdmActor(actor)) {
    return Response.json({
      error: 'Akses ditolak. Asisten AI hanya tersedia untuk akun Pengelola SDM (bukan Dosen, Dekan, Evaluator, atau Tamu).'
    }, { status: 403 });
  }

  // Jalur 1: Audit persetujuan manusia atas draf Tier 2 (tidak memotong kuota AI)
  if (body.action === 'audit_approval') {
    const { proposal, expiresAt, signature } = body;
    if (!proposal || !verifyProposalSignature(actor.username, proposal, expiresAt, signature)) {
      return Response.json({ error: 'Tanda tangan persetujuan draf tidak valid atau sudah kedaluwarsa (>10 menit).' }, { status: 403 });
    }
    await writeAuditLog(actor.username, 'AI_AGENT_WRITE_APPROVED', {
      approvedByName: actor.name || actor.username,
      approvedByRole: actor.role,
      actionType: proposal.actionType,
      summary: proposal.actionType === 'UPSERT_ATTENDANCE'
        ? {
            nip: proposal.employee?.nip,
            nama: proposal.employee?.nama_lengkap,
            status: proposal.requestedStatus,
            startDate: proposal.startDate,
            endDate: proposal.endDate,
            totalDays: proposal.totalDays
          }
        : { before: proposal.before, after: proposal.after },
      timestamp: new Date().toISOString()
    });
    snapshotCache = { loadedAt: 0, data: null };
    return Response.json({ ok: true, audited: true });
  }

  // Jalur 2: Interaksi chat AI Agent
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  if (rawMessages.length === 0) {
    return Response.json({ error: 'Pesan percakapan tidak boleh kosong.' }, { status: 400 });
  }

  const trimmedHistory = rawMessages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-QUOTA_RULES.maxHistoryMessages)
    .map(m => ({
      role: m.role,
      content: m.content.trim().slice(0, QUOTA_RULES.maxPromptChars)
    }))
    .filter(m => m.content.length > 0);

  const lastMsg = trimmedHistory[trimmedHistory.length - 1];
  if (!lastMsg || lastMsg.role !== 'user') {
    return Response.json({ error: 'Pesan terakhir harus berasal dari pengguna.' }, { status: 400 });
  }

  // Cek cooldown & kuota harian dari Supabase audit_log
  const quota = await getQuotaStatus(actor.username);
  const now = Date.now();
  if (quota.lastRequestAt && (now - quota.lastRequestAt) < QUOTA_RULES.cooldownMs) {
    return Response.json({
      code: 'COOLDOWN_ACTIVE',
      error: `Terlalu cepat. Mohon tunggu ${Math.ceil(QUOTA_RULES.cooldownMs / 1000)} detik antar pertanyaan.`,
      quota
    }, { status: 429 });
  }
  if (quota.remainingToday <= 0) {
    return Response.json({
      code: 'USER_DAILY_QUOTA_EXCEEDED',
      error: `Kuota harian Anda (${quota.userLimit} interaksi/hari) sudah habis. Kuota akan direset pukul ${quota.resetLabel}.`,
      quota
    }, { status: 429 });
  }
  if (quota.teamRemaining <= 0) {
    return Response.json({
      code: 'TEAM_DAILY_QUOTA_EXCEEDED',
      error: `Kuota harian tim Pengelola SDM (${quota.teamLimit} interaksi/hari) telah mencapai batas pengaman.`,
      quota
    }, { status: 429 });
  }

  const gatewayAuth = getGatewayAuthStatus();
  if (!gatewayAuth.configured) {
    return Response.json({
      code: 'GATEWAY_AUTH_MISSING',
      error: 'Autentikasi Vercel AI Gateway belum aktif di server (VERCEL_OIDC_TOKEN atau AI_GATEWAY_API_KEY belum tersedia).',
      actionUrl: 'https://vercel.com/docs/ai-gateway/getting-started',
      quota
    }, { status: 503 });
  }

  lastBurstByUser.set(String(actor.username).trim().toLowerCase(), now);

  const snapshot = await getLiveSnapshot(Boolean(body.refreshSnapshot));
  const activeConfig = body.configSnapshot
    ? { ...DEFAULT_CONFIG, ...body.configSnapshot }
    : snapshot.config;

  const pendingProposals = [];
  const uiCommands = [];

  try {
    const agent = new ToolLoopAgent({
      model: gatewayAuth.model,
      instructions: buildSdmSystemPrompt({ actor, configSnapshot: activeConfig, snapshot }),
      tools: createAgentTools({ snapshot, activeConfig, pendingProposals, uiCommands }),
      stopWhen: isStepCount(6),
      maxOutputTokens: 1200,
      providerOptions: {
        gateway: {
          user: String(actor.username).slice(0, 80),
          tags: ['fhisip-ut', 'pengelola-sdm']
        }
      }
    });

    const result = await agent.generate({
      messages: trimmedHistory
    });

    const expiresAt = Date.now() + 10 * 60 * 1000;
    const signedPendingActions = pendingProposals.map(proposal => ({
      proposal,
      expiresAt,
      signature: signProposal(actor.username, proposal, expiresAt)
    }));

    // Catat ke audit_log hanya setelah generasi berhasil agar error gateway/kredit tidak memotong kuota user
    await writeAuditLog(actor.username, 'AI_AGENT_QUERY', {
      actorName: actor.name || actor.username,
      actorRole: actor.role,
      model: gatewayAuth.model,
      steps: result.steps?.length || 1,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      totalTokens: result.usage?.totalTokens ?? null,
      hasPendingProposal: signedPendingActions.length > 0
    });

    const updatedQuota = {
      ...quota,
      usedToday: quota.usedToday + 1,
      remainingToday: Math.max(0, quota.remainingToday - 1),
      teamUsedToday: quota.teamUsedToday + 1,
      teamRemaining: Math.max(0, quota.teamRemaining - 1)
    };

    return Response.json({
      ok: true,
      reply: result.text || 'Selesai memproses permintaan Anda.',
      model: gatewayAuth.model,
      usage: result.usage || null,
      toolsCalled: (result.steps || [])
        .flatMap(s => (s.toolCalls || []).map(tc => tc.toolName))
        .filter(Boolean),
      pendingActions: signedPendingActions,
      uiCommands,
      quota: updatedQuota,
      snapshotSource: snapshot.source
    });
  } catch (err) {
    const classified = classifyGatewayError(err);
    return Response.json({
      ...classified,
      model: gatewayAuth.model,
      quota
    }, { status: classified.httpStatus });
  }
}
