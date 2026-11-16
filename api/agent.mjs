/**
 * Endpoint Asisten Cerdas Pengelola SDM FHISIP Universitas Terbuka (Opsi 2: 100% Gratis Rp 0)
 * Berjalan penuh di server Vercel/Node menggunakan Mesin Deterministik Lokal tanpa AI Gateway
 * maupun biaya token pihak ketiga.
 *
 * Rules Wajib:
 * 1. RBAC Ketat: Hanya SDM & Kepegawaian FHISIP, SDM & Administrasi Umum, dan Administrator.
 * 2. Bebas Biaya Token (Rp 0): Menggunakan processLocalSdmPrompt + batas aman 500 tanya/hari per akun SDM.
 * 3. Kebijakan Presensi FHISIP UT: Sabtu-Minggu = Lembur tanpa jam, status non-jam kosong, ekspor 100% sinkron.
 * 4. Tiered Tools + HMAC Approval: Tier 1 jalan otomatis, Tier 2 wajib klik Setujui (HMAC 10 menit), Tier 3 diblokir.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {
  QUOTA_RULES,
  DEFAULT_CONFIG,
  isPengelolaSdmActor,
  getWibDayBoundsIso
} from '../lib/fhisip-agent-rules.mjs';
import { processLocalSdmPrompt } from '../lib/fhisip-agent-nlu.mjs';

const DEFAULT_SUPABASE_URL = 'https://sxnimpyselgoenpurhhw.supabase.co';
const DEFAULT_SUPABASE_ANON = 'sb_publishable_pm5jUtQVQf2wpWrtMtkm-Q_L6eb73S3';
const LOCAL_ENGINE_NAME = 'Mode Lokal SDM (Gratis Rp 0)';

const RULES_SUMMARY = [
  {
    layer: 'Akses & Peran (RBAC)',
    detail: 'Hanya aktif untuk Pengelola SDM (Radhitya, Viku, Septin, Administrator). Akun Dosen, Dekan, Evaluator & Tamu ditolak (HTTP 403).'
  },
  {
    layer: '100% Gratis & Privasi UT',
    detail: `Diproses oleh mesin deterministik internal FHISIP tanpa AI Gateway maupun LLM pihak ketiga (Rp 0 biaya token, batas aman ${QUOTA_RULES.dailyLimitPerUser}/hari per akun, reset ${QUOTA_RULES.resetLabel}).`
  },
  {
    layer: 'Kebijakan Presensi FHISIP UT',
    detail: 'Sabtu–Minggu otomatis Lembur (tanpa jam). Izin, Cuti, Sakit, Dinas Luar, Tugas Belajar, & Alpha otomatis tanpa jam. Ekspor D.Luar/Cuti/Sakit/Ijin 100% sinkron.'
  },
  {
    layer: 'Persetujuan Manusia (Tier 1–3)',
    detail: 'Tier 1 (Baca/Audit/Simulasi/Filter) berjalan otomatis. Tier 2 (Input/Ubah Data/Kebijakan) wajib preview + klik Setujui. Tier 3 (Hapus/Reset Massal) diblokir.'
  }
];

let envLoaded = false;
let snapshotCache = { loadedAt: 0, data: null };
const lastBurstByUser = new Map();

function ensureEnvLoaded() {
  if (envLoaded) return;
  envLoaded = true;
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
    // Abaikan error baca env lokal pada runtime read-only
  }
}

function getSupabaseConfig() {
  ensureEnvLoaded();
  return {
    url: (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, ''),
    key: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_ANON
  };
}

function getEngineStatus() {
  return {
    configured: true,
    authMode: 'local-free',
    model: LOCAL_ENGINE_NAME,
    credits: null
  };
}

function getApprovalSecret() {
  ensureEnvLoaded();
  const seed = process.env.AGENT_APPROVAL_SECRET
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
  if (!origin) return true;

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
  return fetch(`${url}/rest/v1/${restPath}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
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
      `audit_log?select=user_identifier,created_at&aksi=eq.AI_AGENT_QUERY&created_at=gte.${encodeURIComponent(startUtcIso)}&order=created_at.desc&limit=1500`
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

  const quota = await getQuotaStatus(actor.username);
  return Response.json({
    allowed: true,
    actor: { username: actor.username, role: actor.role, name: actor.name },
    quota,
    gateway: getEngineStatus(),
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

  // Jalur 1: Audit persetujuan manusia atas draf Tier 2
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

  // Jalur 2: Interaksi Asisten SDM Deterministik Lokal (Rp 0 Tanpa AI Gateway)
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
      error: `Batas aman harian (${quota.userLimit} kueri/hari) tercapai. Akan direset pukul ${quota.resetLabel}.`,
      quota
    }, { status: 429 });
  }
  if (quota.teamRemaining <= 0) {
    return Response.json({
      code: 'TEAM_DAILY_QUOTA_EXCEEDED',
      error: `Batas aman tim (${quota.teamLimit} kueri/hari) tercapai untuk menjaga performa database.`,
      quota
    }, { status: 429 });
  }

  lastBurstByUser.set(String(actor.username).trim().toLowerCase(), now);

  const snapshot = await getLiveSnapshot(Boolean(body.refreshSnapshot));
  const activeConfig = body.configSnapshot
    ? { ...DEFAULT_CONFIG, ...body.configSnapshot }
    : snapshot.config;

  const engineResult = processLocalSdmPrompt({
    messages: trimmedHistory,
    snapshot,
    activeConfig,
    actor
  });

  const expiresAt = Date.now() + 10 * 60 * 1000;
  const signedPendingActions = (engineResult.pendingProposals || []).map(proposal => ({
    proposal,
    expiresAt,
    signature: signProposal(actor.username, proposal, expiresAt)
  }));

  await writeAuditLog(actor.username, 'AI_AGENT_QUERY', {
    actorName: actor.name || actor.username,
    actorRole: actor.role,
    engine: 'local-deterministic-free',
    toolsCalled: engineResult.toolsCalled,
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
    reply: engineResult.reply,
    model: LOCAL_ENGINE_NAME,
    usage: null,
    toolsCalled: engineResult.toolsCalled,
    pendingActions: signedPendingActions,
    uiCommands: engineResult.uiCommands,
    quota: updatedQuota,
    snapshotSource: snapshot.source
  });
}
