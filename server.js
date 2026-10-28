/**
 * Lightweight Zero-Dependency Local Static & Live-Sync Server
 * Dashboard Rekapitulasi Absensi Pegawai FHISIP Universitas Terbuka
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3300;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv; charset=utf-8'
};

// =========================================================================
// REAL-TIME SSE CLIENTS (Sinkronisasi Live Antar-Device di Jaringan Lokal)
// =========================================================================
const sseClients = new Set();

function broadcastSSE(eventName, payload) {
  if (sseClients.size === 0) return;
  const msg = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const clientRes of sseClients) {
    try {
      clientRes.write(msg);
    } catch (_) {
      sseClients.delete(clientRes);
    }
  }
}

const sseHeartbeat = setInterval(() => {
  for (const clientRes of sseClients) {
    try {
      clientRes.write(': heartbeat\n\n');
    } catch (_) {
      sseClients.delete(clientRes);
    }
  }
}, 20000);
if (typeof sseHeartbeat.unref === 'function') sseHeartbeat.unref();

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, 'http://localhost');
  let reqPath = urlObj.searchParams.get('path');
  if (reqPath) {
    reqPath = '/' + reqPath;
  } else {
    reqPath = decodeURI(urlObj.pathname);
  }

  // Bersihkan trailing slash
  if (reqPath.length > 1 && reqPath.endsWith('/')) {
    reqPath = reqPath.slice(0, -1);
  }

  if (reqPath === '/' || reqPath === '/landing' || reqPath === '/landing.html') reqPath = '/index.html';
  if (reqPath === '/dashboard' || reqPath === '/dashboard.html') reqPath = '/dashboard.html';

  // Di Vercel Serverless (read-only filesystem), sinkronisasi penuh ditangani oleh Supabase Cloud Realtime
  if ((reqPath === '/api/events' || reqPath === '/api/absensi') && process.env.VERCEL === '1') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Cloud Mode Active');
    return;
  }

  // =========================================================================
  // ENDPOINT STREAM LIVE UPDATE SSE (/api/events - Khusus Server Lokal / LAN)
  // =========================================================================
  if (reqPath === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    broadcastSSE('presence', { onlineDevices: sseClients.size, timestamp: new Date().toISOString() });

    req.on('close', () => {
      sseClients.delete(res);
      broadcastSSE('presence', { onlineDevices: sseClients.size, timestamp: new Date().toISOString() });
    });
    return;
  }

  // =========================================================================
  // API PERSISTENSI DATA LOKAL (/api/absensi)
  // Memastikan data edit & hapus tersimpan permanen pada disk lokal
  // =========================================================================
  if (reqPath === '/api/absensi') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const dataDir = path.join(PUBLIC_DIR, 'data');
    const storageFile = path.join(dataDir, 'absensi-storage.json');

    if (req.method === 'GET') {
      if (fs.existsSync(storageFile)) {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate'
        });
        const stream = fs.createReadStream(storageFile);
        stream.pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, message: 'Belum ada data disk tersimpan' }));
      }
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 50 * 1024 * 1024) { // 50MB limit
          req.destroy();
        }
      });

      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
          }
          const tmpFile = storageFile + '.tmp';
          fs.writeFileSync(tmpFile, JSON.stringify(parsed, null, 2), 'utf8');
          fs.renameSync(tmpFile, storageFile);

          const recordCount = Array.isArray(parsed.absensi) ? parsed.absensi.length : 0;
          const nowIso = new Date().toISOString();

          broadcastSSE('sync', {
            type: 'SERVER_DATA_UPDATED',
            clientId: parsed.clientId || null,
            actor: parsed.actor || null,
            count: recordCount,
            timestamp: nowIso
          });

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            message: 'Data berhasil disimpan di disk lokal',
            count: recordCount,
            timestamp: nowIso
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      try {
        if (fs.existsSync(storageFile)) {
          fs.unlinkSync(storageFile);
        }
        broadcastSSE('sync', {
          type: 'SERVER_DATA_RESET',
          timestamp: new Date().toISOString()
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, message: 'Data disk lokal berhasil direset' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }
  }

  let filePath = path.join(PUBLIC_DIR, reqPath);

  // Security check: ensure path is within PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  // Jika file tidak ditemukan pada path yang diminta, periksa apakah file ada di root PUBLIC_DIR
  if (!fs.existsSync(filePath)) {
    const baseName = path.basename(reqPath);
    const rootCandidate = path.join(PUBLIC_DIR, baseName);
    if (fs.existsSync(rootCandidate) && fs.statSync(rootCandidate).isFile()) {
      filePath = rootCandidate;
    }
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const isStaticAsset = ['.css', '.js', '.jpg', '.jpeg', '.png', '.svg', '.ico', '.xlsx', '.csv'].includes(ext);
    const cacheHeader = isStaticAsset
      ? 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800'
      : 'public, max-age=0, must-revalidate';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheHeader
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

function getLocalNetworkAddresses() {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`http://${net.address}:${PORT}`);
      }
    }
  }
  return urls;
}

if (process.env.VERCEL !== '1') {
  server.listen(PORT, '0.0.0.0', () => {
    const lanUrls = getLocalNetworkAddresses();
    console.log(`================================================================`);
    console.log(`  DASHBOARD ABSENSI PEGAWAI FHISIP UNIVERSITAS TERBUKA`);
    console.log(`  Lokal PC  : http://localhost:${PORT}`);
    lanUrls.forEach(u => console.log(`  Jaringan  : ${u} (Buka di HP/Device lain)`));
    console.log(`  Live Sync : Aktif (SSE /api/events + Supabase Cloud Realtime)`);
    console.log(`================================================================`);
  });
}

module.exports = server;
