/**
 * Lightweight Zero-Dependency Local Static Server
 * Dashboard Rekapitulasi Absensi Pegawai FHISIP Universitas Terbuka
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

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

if (process.env.VERCEL !== '1') {
  server.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(`  DASHBOARD ABSENSI PEGAWAI FHISIP UNIVERSITAS TERBUKA`);
    console.log(`  Aplikasi berjalan di: http://localhost:${PORT}`);
    console.log(`================================================================`);
  });
}

module.exports = server;

