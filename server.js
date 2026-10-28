#!/usr/bin/env node
/* ============================================================
 * server.js — 工作台云端服务（零依赖，Node 14+）
 *
 *   node server.js                          # 启动（首次运行自动生成密码并打印）
 *   node server.js --set-password 新密码     # 修改访问密码
 *   PORT=9000 node server.js                # 自定义端口
 *   WORKBENCH_PASSWORD=xxx node server.js   # 用环境变量当密码（适合托管平台）
 *
 * 功能：静态文件托管 + 单密码登录 + 数据云端存储（data/db.json）
 * 安全：密码 scrypt 哈希存储、HMAC 签名令牌（30 天）、登录限速、
 *       data/ 与 server-config.json 禁止外部访问、请求体上限 8MB。
 * 提示：公网部署请务必套 HTTPS（推荐 Caddy 或 Nginx 反向代理）。
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CONFIG_FILE = path.join(DATA_DIR, 'server-config.json');   /* 放 data/ 内，容器/备份时随数据一起持久化 */
const PORT = Number(process.env.PORT) || 8765;
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_BODY = 8 * 1024 * 1024;

/* ---------- 密码 / 令牌 ---------- */
const rand = n => crypto.randomBytes(n).toString('hex');
const scrypt = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
const safeEq = (a, b) => {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

function loadConfig() {
  if (process.argv.includes('--set-password')) {
    const i = process.argv.indexOf('--set-password');
    const pw = process.argv[i + 1];
    if (!pw) { console.error('用法：node server.js --set-password 新密码'); process.exit(1); }
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) {}
    cfg.salt = cfg.salt || rand(16);
    cfg.hash = scrypt(pw, cfg.salt);
    cfg.secret = cfg.secret || rand(32);
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    console.log('✔ 访问密码已更新');
    process.exit(0);
  }
  if (process.env.WORKBENCH_PASSWORD) {
    return {
      salt: 'env',
      hash: scrypt(process.env.WORKBENCH_PASSWORD, 'env'),
      secret: scrypt(process.env.WORKBENCH_PASSWORD, 'wb-secret-v1')
    };
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    const pw = rand(2) + '-' + rand(2) + '-' + rand(2);
    const cfg = { salt: rand(16), hash: '', secret: rand(32) };
    cfg.hash = scrypt(pw, cfg.salt);
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    console.log('\n============================================');
    console.log('  首次启动，已生成初始访问密码：');
    console.log('        ' + pw);
    console.log('  请妥善保存。修改密码：');
    console.log('        node server.js --set-password 新密码');
    console.log('============================================\n');
    return cfg;
  }
}
const config = loadConfig();

function sign(data) {
  const b = Buffer.from(JSON.stringify(data)).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', config.secret).update(b).toString('base64url');
}
function verifyToken(token) {
  const s = String(token || '');
  const i = s.indexOf('.');
  if (i < 0) return false;
  const b = s.slice(0, i), sig = s.slice(i + 1);
  if (!safeEq(sig, crypto.createHmac('sha256', config.secret).update(b).toString('base64url'))) return false;
  try { return JSON.parse(Buffer.from(b, 'base64url').toString()).exp > Date.now(); } catch (e) { return false; }
}
function authed(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return !!(m && verifyToken(m[1]));
}

/* ---------- 登录限速（每 IP：6 次错误锁 15 分钟） ---------- */
const fails = new Map();
function failState(ip) {
  let f = fails.get(ip);
  if (!f) { f = { n: 0, until: 0 }; fails.set(ip, f); }
  return f;
}

/* ---------- 数据读写 ---------- */
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { return null; }
}
function writeDB(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const now = Date.now();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ db, serverUpdatedAt: now }));
  fs.renameSync(tmp, DB_FILE);
  return now;
}

/* ---------- 工具 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2', '.map': 'application/json'
};

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/* ---------- 静态文件（拦截敏感路径） ---------- */
const BLOCKED = rel => rel === 'server-config.json' || rel === 'data' || rel.startsWith('data/') || rel.startsWith('node_modules/');

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let p;
  try { p = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  const fp = path.normalize(path.join(ROOT, p));
  if (!fp.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  const rel = path.relative(ROOT, fp).split(path.sep).join('/');
  if (BLOCKED(rel)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(fp, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

/* ---------- API ---------- */
async function handleAPI(req, res, u) {
  const ep = (u.pathname.match(/\/api\/([^/]+)$/) || [])[1] || '';
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();

  if (ep === 'login' && req.method === 'POST') {
    const f = failState(ip);
    if (f.until > Date.now()) return sendJSON(res, 429, { error: '尝试次数过多，请 15 分钟后再试' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: '请求格式错误' }); }
    if (!body || body.password == null || !safeEq(scrypt(body.password, config.salt), config.hash)) {
      f.n++;
      if (f.n >= 6) { f.until = Date.now() + 15 * 60000; f.n = 0; }
      return sendJSON(res, 401, { error: '密码不正确' });
    }
    fails.delete(ip);
    return sendJSON(res, 200, { token: sign({ exp: Date.now() + SESSION_MS }) });
  }

  if (ep === 'ping') {
    if (!authed(req)) return sendJSON(res, 401, { ok: false });
    return sendJSON(res, 200, { ok: true });
  }

  if (ep === 'data') {
    if (!authed(req)) return sendJSON(res, 401, { error: '未登录' });
    if (req.method === 'GET') {
      return sendJSON(res, 200, readDB() || { db: null, serverUpdatedAt: 0 });
    }
    if (req.method === 'POST') {
      let body;
      try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: '请求格式错误' }); }
      const db = body && body.db;
      if (!db || !Array.isArray(db.tasks)) return sendJSON(res, 400, { error: '数据格式不正确' });
      if (!Array.isArray(db.refs)) db.refs = [];
      if (typeof db !== 'object') return sendJSON(res, 400, { error: '数据格式不正确' });
      return sendJSON(res, 200, { serverUpdatedAt: writeDB(db) });
    }
  }

  sendJSON(res, 404, { error: 'not found' });
}

/* ---------- 启动 ---------- */
const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); return res.end(); }
  Promise.resolve()
    .then(() => {
      if (/\/api\/./.test(u.pathname)) return handleAPI(req, res, u);
      return serveStatic(req, res, u.pathname);
    })
    .catch(() => { try { sendJSON(res, 500, { error: 'server error' }); } catch (e) {} });
});

server.listen(PORT, () => {
  console.log('⚡ 工作台云端服务已启动: http://127.0.0.1:' + PORT);
  console.log('   数据文件: ' + DB_FILE);
  console.log('   ⚠ 公网部署请务必配置 HTTPS（推荐 Caddy / Nginx 反向代理）');
});
