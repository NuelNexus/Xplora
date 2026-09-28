// PRORESMAT HTTP server: versioned REST API over the domain engine, plus the web app.
// Zero dependencies; requires Node 22+.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../core/engine.js';
import { AppError, fromB64 } from '../core/util.js';
import { fileStore, fileBlobs, loadOrCreateKey } from './storage.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const MAX_BODY = 8 * 1024 * 1024;

export async function startServer(opts = {}) {
  const port = Number(opts.port ?? process.env.PORT ?? 8080);
  const dataDir = opts.dataDir || process.env.DATA_DIR || join(ROOT, 'data');
  const publicUrl = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '');
  const demo = opts.demo ?? (process.env.DEMO ? process.env.DEMO === 'true' : process.env.NODE_ENV !== 'production');
  const config = {
    demo,
    docKey: await loadOrCreateKey(dataDir),
    paystack: process.env.PAYSTACK_SECRET_KEY ? { secretKey: process.env.PAYSTACK_SECRET_KEY, callbackUrl: `${publicUrl}/paystack-return` } : {},
  };
  const engine = await createEngine({ store: fileStore(dataDir), blobs: fileBlobs(dataDir), config });
  const routes = engine.routeTable().map((r) => ({ ...r, re: new RegExp('^/api/v1' + r.path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') }));

  // Simple per-IP rate limiting (sliding one-minute window).
  const hits = new Map();
  const limited = (key, max) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < 60000);
    arr.push(now);
    hits.set(key, arr);
    return arr.length > max;
  };
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k); }, 60000).unref();

  const securityHeaders = (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (publicUrl.startsWith('https://')) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  };
  const sendJson = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new AppError('PAYLOAD_TOO_LARGE', 'The request is too large. Files must be 5 MB or smaller.', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
  const deviceOf = (ua = '') => {
    const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown OS';
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return `${br} on ${os}`;
  };

  async function handleApi(req, res, url) {
    const ip = req.socket.remoteAddress || '';
    const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route) return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown API endpoint.' } });
    const isAuth = url.pathname.startsWith('/api/v1/auth/');
    if (limited(ip, 300) || (isAuth && limited('auth:' + ip, 20))) return sendJson(res, 429, { error: { code: 'RATE_LIMITED', message: 'Too many requests. Wait a minute and try again.' } });
    const params = { ...Object.fromEntries(url.searchParams), ...route.re.exec(url.pathname).groups };
    if (req.method !== 'GET') {
      const raw = await readBody(req);
      if (route.name === 'payments.webhook') { params.rawBody = raw; params.signature = req.headers['x-paystack-signature'] || ''; } else if (raw) {
        try { Object.assign(params, JSON.parse(raw)); } catch { throw new AppError('BAD_JSON', 'The request body is not valid JSON.', 400); }
      }
    }
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '';
    const result = await engine.call(route.name, params, { token, ip, device: deviceOf(req.headers['user-agent']) });
    if (route.name === 'documents.fetch') {
      const bytes = fromB64(result.dataB64);
      res.writeHead(200, { 'Content-Type': result.mime, 'Content-Length': bytes.length, 'Content-Disposition': `inline; filename="${result.name.replace(/"/g, '')}"`, 'Cache-Control': 'no-store, private' });
      return res.end(Buffer.from(bytes));
    }
    return sendJson(res, 200, { data: result });
  }

  async function serveStatic(res, pathname) {
    let rel = pathname === '/' ? '/index.html' : pathname;
    const base = rel.startsWith('/core/') ? ROOT : join(ROOT, 'web');
    const file = normalize(join(base, rel));
    if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not file');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  }

  const server = http.createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (url.pathname === '/paystack-return') {
        res.writeHead(302, { Location: `/#/pay/${encodeURIComponent(url.searchParams.get('reference') || '')}` });
        return res.end();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return await serveStatic(res, url.pathname);
    } catch (err) {
      if (err instanceof AppError || err.code) return sendJson(res, err.status || 400, { error: { code: err.code, message: err.message, details: err.details } });
      console.error(err);
      return sendJson(res, 500, { error: { code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again.' } });
    }
  });
  await new Promise((r) => server.listen(port, r));
  const addr = server.address();
  return { server, engine, port: addr.port, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { port, engine } = await startServer();
  const demo = engine.internals.config.demo;
  console.log(`PRORESMAT Health Connect running at http://localhost:${port}`);
  console.log(`Payments: ${engine.internals.config.paystack?.secretKey ? 'Paystack LIVE keys' : 'Paystack sandbox simulator'}; demo tools: ${demo ? 'on' : 'off'}`);
  if (demo) console.log('Demo password for all accounts: Demo@1234 (e.g. akosua@demo.gh, kwame@demo.gh, clinic@demo.gh, admin@demo.gh)');
}
