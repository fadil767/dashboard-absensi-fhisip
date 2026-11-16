/**
 * MODUL ASISTEN AI PENGELOLA SDM FHISIP UNIVERSITAS TERBUKA
 * Khusus peran Pengelola SDM (SDM & Kepegawaian FHISIP, SDM & Administrasi Umum, Administrator).
 * Fitur: Kuota harian per akun, RBAC strict, Human-in-the-Loop Preview Approval Card, Audit Log.
 */
(function () {
  'use strict';

  const ALLOWED_SDM_ROLES = new Set([
    'SDM & Kepegawaian FHISIP',
    'SDM & Administrasi Umum',
    'Administrator'
  ]);

  const QUICK_PROMPTS = [
    'Siapa saja pegawai dengan Tanpa Keterangan atau belum scan pulang di Oktober 2026?',
    'Tampilkan ringkasan disiplin & cuti/sakit/dinas periode Oktober 2026',
    'Buatkan draf Cuti untuk Acep Surya tanggal 2026-11-02 sampai 2026-11-04 (lewati weekend)',
    'Simulasikan dampak jika batas jam datang masuk diubah menjadi 08:00 WIB pada Oktober 2026'
  ];

  const agentState = {
    history: [], // { role: 'user' | 'assistant', content: string }
    isSending: false,
    lastSentAt: 0,
    quota: null,
    gateway: null,
    rulesSummary: []
  };

  function getActiveSession() {
    try {
      const raw = localStorage.getItem('ut_fhisip_session');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function isPengelolaSdmSession(session) {
    if (!session || !session.isLoggedIn || session.isGuest) return false;
    return ALLOWED_SDM_ROLES.has(String(session.role || '').trim());
  }

  function formatInlineSegment(parent, text) {
    // Parse **bold** and `code` safely using textContent (no raw HTML injection)
    const tokenRe = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let lastIdx = 0;
    let match;
    while ((match = tokenRe.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parent.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
      }
      const token = match[0];
      if (token.startsWith('**') && token.endsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = token.slice(2, -2);
        parent.appendChild(strong);
      } else if (token.startsWith('`') && token.endsWith('`')) {
        const code = document.createElement('code');
        code.textContent = token.slice(1, -1);
        parent.appendChild(code);
      }
      lastIdx = tokenRe.lastIndex;
    }
    if (lastIdx < text.length) {
      parent.appendChild(document.createTextNode(text.slice(lastIdx)));
    }
  }

  function renderSafeMarkdownText(container, markdownText) {
    const lines = String(markdownText || '').split(/\r?\n/);
    let currentUl = null;

    const flushList = () => {
      if (currentUl) {
        container.appendChild(currentUl);
        currentUl = null;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        flushList();
        continue;
      }
      if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
        if (!currentUl) {
          currentUl = document.createElement('ul');
          currentUl.className = 'ai-msg-list';
        }
        const li = document.createElement('li');
        const cleaned = line.replace(/^([-*]|\d+\.)\s+/, '');
        formatInlineSegment(li, cleaned);
        currentUl.appendChild(li);
      } else {
        flushList();
        const p = document.createElement('p');
        if (line.startsWith('### ') || line.startsWith('## ')) {
          p.className = 'ai-msg-heading';
          formatInlineSegment(p, line.replace(/^#{2,3}\s+/, ''));
        } else {
          formatInlineSegment(p, line);
        }
        container.appendChild(p);
      }
    }
    flushList();
  }

  function updateQuotaBannerUI() {
    const q = agentState.quota;
    const g = agentState.gateway;

    const headerPill = document.getElementById('header-ai-quota-pill');
    if (headerPill && q) {
      headerPill.textContent = `${q.remainingToday}/${q.userLimit}`;
    }

    const quotaText = document.getElementById('ai-agent-quota-text');
    if (quotaText && q) {
      quotaText.textContent = `Gratis Rp 0 • Sisa kueri: ${q.remainingToday}/${q.userLimit} hari ini (Reset ${q.resetLabel})`;
    }

    const gatewayBadge = document.getElementById('ai-agent-gateway-badge');
    const gatewayAlert = document.getElementById('ai-agent-gateway-alert');
    if (gatewayBadge && g) {
      if (g.authMode === 'local-free') {
        gatewayBadge.textContent = 'Gratis Rp 0 • Tanpa API Key';
        gatewayBadge.className = 'ai-gateway-badge is-ready';
      } else if (!g.configured) {
        gatewayBadge.textContent = 'Gateway Belum Terkonfigurasi';
        gatewayBadge.className = 'ai-gateway-badge is-warn';
      } else {
        gatewayBadge.textContent = `${g.model} (${g.authMode.toUpperCase()})`;
        gatewayBadge.className = 'ai-gateway-badge is-ready';
      }
    }

    if (gatewayAlert) {
      gatewayAlert.hidden = true;
    }
  }

  function renderRulesList(rules) {
    const listEl = document.getElementById('ai-agent-rules-list');
    if (!listEl || !Array.isArray(rules) || rules.length === 0) return;
    listEl.replaceChildren();
    rules.forEach(rule => {
      const li = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = `${rule.layer}: `;
      const desc = document.createElement('span');
      desc.textContent = rule.detail;
      li.append(title, desc);
      listEl.appendChild(li);
    });
  }

  async function fetchAgentStatus() {
    const session = getActiveSession();
    if (!isPengelolaSdmSession(session)) return null;
    try {
      const qs = new URLSearchParams({
        action: 'status',
        username: session.username || '',
        role: session.role || '',
        name: session.name || '',
        isGuest: String(Boolean(session.isGuest))
      });
      const res = await fetch(`/api/agent?${qs.toString()}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.quota) agentState.quota = data.quota;
      if (data.gateway) agentState.gateway = data.gateway;
      if (data.rulesSummary) {
        agentState.rulesSummary = data.rulesSummary;
        renderRulesList(data.rulesSummary);
      }
      updateQuotaBannerUI();
      return data;
    } catch (_) {
      return null;
    }
  }

  function buildApprovalCard(actionItem) {
    const { proposal, expiresAt, signature } = actionItem;
    const card = document.createElement('div');
    card.className = 'ai-approval-card';

    const head = document.createElement('div');
    head.className = 'ai-approval-head';
    head.textContent = proposal.actionType === 'UPSERT_ATTENDANCE'
      ? 'Konfirmasi Pengelola SDM — Draf Simpan Presensi (Tier 2)'
      : 'Konfirmasi Pengelola SDM — Draf Ubah Jam Kerja (Tier 2)';
    card.appendChild(head);

    const details = document.createElement('ul');
    details.className = 'ai-approval-details';

    const addLine = (label, val) => {
      const li = document.createElement('li');
      const b = document.createElement('strong');
      b.textContent = `${label}: `;
      const sp = document.createElement('span');
      sp.textContent = val;
      li.append(b, sp);
      details.appendChild(li);
    };

    if (proposal.actionType === 'UPSERT_ATTENDANCE') {
      addLine('Pegawai', `${proposal.employee.nama_lengkap} (NIP: ${proposal.employee.nip})`);
      addLine('Unit Kerja', proposal.employee.unit_kerja || '-');
      addLine('Status Kehadiran', `${proposal.requestedStatus}`);
      addLine('Rentang Tanggal', `${proposal.startDate} s/d ${proposal.endDate} (${proposal.totalDays} hari)`);
      addLine('Dampak Data', `${proposal.insertCount} data baru, ${proposal.overwriteCount} menimpa data tanggal sama`);
      const sampleRec = proposal.records && proposal.records[0];
      addLine('Jam Masuk / Pulang', sampleRec && !sampleRec.jam_masuk ? 'Kosong (Otomatis sesuai kebijakan non-jam)' : `${sampleRec?.jam_masuk || '-'} / ${sampleRec?.jam_pulang || '-'}`);
      if (Array.isArray(proposal.rulesApplied) && proposal.rulesApplied.length > 0) {
        addLine('Aturan Diterapkan', proposal.rulesApplied.join(' '));
      }
    } else if (proposal.actionType === 'UPDATE_POLICY') {
      addLine('Jam Masuk Baru', `${proposal.after.jamMasuk} WIB (sebelumnya ${proposal.before.jamMasuk} WIB)`);
      addLine('Toleransi', `${proposal.after.toleransi} menit (sebelumnya ${proposal.before.toleransi} menit)`);
      addLine('Jam Pulang', `${proposal.after.jamPulang} WIB / Jumat ${proposal.after.jamPulangJumat} WIB`);
    }
    card.appendChild(details);

    const btnRow = document.createElement('div');
    btnRow.className = 'ai-approval-actions';

    const statusBadge = document.createElement('div');
    statusBadge.className = 'ai-approval-status';
    statusBadge.hidden = true;

    const btnApprove = document.createElement('button');
    btnApprove.type = 'button';
    btnApprove.className = 'btn btn-primary btn-sm';
    btnApprove.textContent = 'Setujui & Simpan ke Database';

    const btnReject = document.createElement('button');
    btnReject.type = 'button';
    btnReject.className = 'btn btn-outline btn-sm';
    btnReject.textContent = 'Batalkan Draf';

    btnApprove.addEventListener('click', async () => {
      const session = getActiveSession();
      if (!isPengelolaSdmSession(session)) return;
      btnApprove.disabled = true;
      btnReject.disabled = true;
      btnApprove.textContent = 'Menyimpan & Mencatat Audit...';

      try {
        // Verifikasi & catat persetujuan ke audit_log di server terlebih dahulu
        const res = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'audit_approval',
            actor: {
              username: session.username,
              role: session.role,
              name: session.name,
              isGuest: Boolean(session.isGuest)
            },
            proposal,
            expiresAt,
            signature
          })
        });

        const auditData = await res.json();
        if (!res.ok) {
          throw new Error(auditData.error || 'Verifikasi persetujuan draf gagal.');
        }

        // Eksekusi mutasi resmi melalui window.app agar IndexedDB, LocalStorage, UI & Supabase Realtime tersinkron
        if (proposal.actionType === 'UPSERT_ATTENDANCE' && window.app && typeof window.app.commitApprovedRecordsBatch === 'function') {
          window.app.commitApprovedRecordsBatch(proposal.records, `${session.name || 'SDM'} (via AI)`);
        } else if (proposal.actionType === 'UPDATE_POLICY' && window.app && typeof window.app.commitApprovedPolicyUpdate === 'function') {
          window.app.commitApprovedPolicyUpdate(proposal.after);
        }

        btnRow.hidden = true;
        statusBadge.hidden = false;
        statusBadge.className = 'ai-approval-status is-approved';
        statusBadge.textContent = '✅ Disetujui oleh Pengelola SDM, disimpan ke database, & tercatat di Audit Log.';
      } catch (err) {
        btnApprove.disabled = false;
        btnReject.disabled = false;
        btnApprove.textContent = 'Setujui & Simpan ke Database';
        statusBadge.hidden = false;
        statusBadge.className = 'ai-approval-status is-error';
        statusBadge.textContent = err.message;
      }
    });

    btnReject.addEventListener('click', () => {
      btnRow.hidden = true;
      statusBadge.hidden = false;
      statusBadge.className = 'ai-approval-status is-cancelled';
      statusBadge.textContent = 'Draf dibatalkan oleh Pengelola SDM. Tidak ada data yang diubah.';
    });

    btnRow.append(btnApprove, btnReject);
    card.append(btnRow, statusBadge);
    return card;
  }

  function appendChatMessage({ role, text, toolsCalled, pendingActions, isError, actionUrl }) {
    const feed = document.getElementById('ai-agent-messages');
    if (!feed) return;

    const item = document.createElement('div');
    item.className = `ai-chat-bubble ai-chat-${role}${isError ? ' is-error' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'ai-chat-meta';
    meta.textContent = role === 'user' ? 'Anda (Pengelola SDM)' : 'Asisten AI SDM';
    item.appendChild(meta);

    const body = document.createElement('div');
    body.className = 'ai-chat-body';
    renderSafeMarkdownText(body, text);

    if (actionUrl) {
      const pLink = document.createElement('p');
      const a = document.createElement('a');
      a.href = actionUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'Buka Pengaturan Vercel AI Gateway →';
      pLink.appendChild(a);
      body.appendChild(pLink);
    }

    item.appendChild(body);

    if (Array.isArray(toolsCalled) && toolsCalled.length > 0) {
      const toolsRow = document.createElement('div');
      toolsRow.className = 'ai-tools-row';
      const uniqTools = [...new Set(toolsCalled)];
      toolsRow.textContent = `Tool dijalankan: ${uniqTools.join(', ')}`;
      item.appendChild(toolsRow);
    }

    if (Array.isArray(pendingActions) && pendingActions.length > 0) {
      pendingActions.forEach(act => {
        item.appendChild(buildApprovalCard(act));
      });
    }

    feed.appendChild(item);
    feed.scrollTop = feed.scrollHeight;
  }

  async function sendPrompt(rawPrompt) {
    const prompt = String(rawPrompt || '').trim();
    if (!prompt || agentState.isSending) return;

    const session = getActiveSession();
    if (!isPengelolaSdmSession(session)) {
      if (window.app && window.app.showToast) {
        window.app.showToast('Asisten AI hanya tersedia untuk akun Pengelola SDM.', 'warning');
      }
      return;
    }

    const now = Date.now();
    if (now - agentState.lastSentAt < 1000) {
      appendChatMessage({
        role: 'assistant',
        text: 'Mohon tunggu 1 detik sebelum mengirim perintah berikutnya.',
        isError: true
      });
      return;
    }

    const inputEl = document.getElementById('ai-agent-input');
    const sendBtn = document.getElementById('btn-ai-agent-send');
    const typingEl = document.getElementById('ai-agent-typing');

    agentState.isSending = true;
    agentState.lastSentAt = now;
    if (inputEl) inputEl.value = '';
    if (sendBtn) sendBtn.disabled = true;
    if (typingEl) typingEl.hidden = false;

    appendChatMessage({ role: 'user', text: prompt });
    agentState.history.push({ role: 'user', content: prompt });
    if (agentState.history.length > 8) {
      agentState.history = agentState.history.slice(-8);
    }

    try {
      const configSnapshot = (window.app && typeof window.app.getConfig === 'function')
        ? window.app.getConfig()
        : null;

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat',
          actor: {
            username: session.username,
            role: session.role,
            name: session.name,
            isGuest: Boolean(session.isGuest)
          },
          configSnapshot,
          messages: agentState.history
        })
      });

      const data = await res.json();
      if (data.quota) {
        agentState.quota = data.quota;
        updateQuotaBannerUI();
      }

      if (!res.ok) {
        agentState.history.pop(); // Jangan simpan giliran gagal ke memori percakapan
        appendChatMessage({
          role: 'assistant',
          text: data.error || `Gagal memproses permintaan (HTTP ${res.status}).`,
          isError: true,
          actionUrl: data.actionUrl || null
        });
        return;
      }

      agentState.history.push({ role: 'assistant', content: data.reply || '' });
      if (agentState.history.length > 8) {
        agentState.history = agentState.history.slice(-8);
      }

      // Jalankan instruksi navigasi filter UI (Tier 1) jika dipanggil oleh agent
      if (Array.isArray(data.uiCommands) && window.app && typeof window.app.applyFilterCommand === 'function') {
        data.uiCommands.forEach(cmd => {
          if (cmd && cmd.type === 'APPLY_UI_FILTER' && cmd.params) {
            window.app.applyFilterCommand(cmd.params);
          }
        });
      }

      appendChatMessage({
        role: 'assistant',
        text: data.reply,
        toolsCalled: data.toolsCalled || [],
        pendingActions: data.pendingActions || []
      });
    } catch (err) {
      agentState.history.pop();
      appendChatMessage({
        role: 'assistant',
        text: `Koneksi ke endpoint Asisten AI SDM terputus: ${err.message}`,
        isError: true
      });
    } finally {
      agentState.isSending = false;
      if (sendBtn) sendBtn.disabled = false;
      if (typingEl) typingEl.hidden = true;
      if (inputEl) inputEl.focus();
    }
  }

  function setupDialogControls(dialog) {
    // Fallback light-dismiss hanya bila closedby belum didukung native oleh browser
    if (dialog && !('closedBy' in HTMLDialogElement.prototype)) {
      const isOutside = (e) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', (e) => {
        pressedOutside = isOutside(e);
      });
      dialog.addEventListener('pointerup', (e) => {
        if (pressedOutside && isOutside(e)) dialog.close();
      });
    }
  }

  function initAiAgent() {
    const session = getActiveSession();
    const triggerBtn = document.getElementById('btn-header-ai-agent');
    const dialog = document.getElementById('dialog-ai-agent');

    if (!triggerBtn || !dialog) return;

    // RBAC Frontend: Tampilkan tombol AI Agent HANYA untuk Pengelola SDM
    if (!isPengelolaSdmSession(session)) {
      triggerBtn.style.display = 'none';
      return;
    }

    triggerBtn.style.display = 'inline-flex';
    if (dialog.dataset.bound === '1') {
      fetchAgentStatus();
      return;
    }
    dialog.dataset.bound = '1';
    setupDialogControls(dialog);

    const openDrawer = () => {
      if (!dialog.open) {
        dialog.showModal();
      }
      fetchAgentStatus();
    };

    triggerBtn.addEventListener('click', openDrawer);

    const closeBtn = document.getElementById('btn-ai-agent-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => dialog.close());
    }

    const form = document.getElementById('form-ai-agent');
    const input = document.getElementById('ai-agent-input');
    if (form && input) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        sendPrompt(input.value);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendPrompt(input.value);
        }
      });
    }

    const quickContainer = document.getElementById('ai-agent-quick-prompts');
    if (quickContainer) {
      quickContainer.replaceChildren();
      QUICK_PROMPTS.forEach(q => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ai-quick-chip';
        btn.textContent = q;
        btn.addEventListener('click', () => sendPrompt(q));
        quickContainer.appendChild(btn);
      });
    }

    // Muat status kuota di badge header tanpa memicu panggilan LLM
    fetchAgentStatus();
  }

  window.aiAgent = {
    init: initAiAgent,
    open: () => {
      const session = getActiveSession();
      if (!isPengelolaSdmSession(session)) {
        alert('Fitur Asisten AI dikhususkan bagi akun Pengelola SDM FHISIP UT.');
        return;
      }
      const dialog = document.getElementById('dialog-ai-agent');
      if (dialog && !dialog.open) {
        dialog.showModal();
        fetchAgentStatus();
      }
    },
    refreshStatus: fetchAgentStatus
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAiAgent);
  } else {
    initAiAgent();
  }
})();
