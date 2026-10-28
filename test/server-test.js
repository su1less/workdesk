#!/usr/bin/env node
/* ============================================================
 * server-test.js — 服务器集成测试
 * 真实启动 server.js 子进程（临时目录隔离），覆盖：
 *   登录鉴权 / 站长与只读令牌分离 / 只读分享全流程 / 原图上传与静态服务 / 敏感路径拦截 / 限速
 * 运行：node test/server-test.js
 * ============================================================ */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 8937;
const BASE = 'http://127.0.0.1:' + PORT;
const OWNER_PW = 'owner-pass-2026';
const SHARE_PW = 'teach-2026';

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name); }
};

function req(method, p, opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    const data = o.body ? JSON.stringify(o.body) : null;
    const headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (o.token) headers.Authorization = 'Bearer ' + o.token;
    const r = http.request(BASE + p, { method, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString()); } catch (e) {}
        resolve({ status: res.statusCode, json, buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-data-'));
  const assetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-asset-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      WORKBENCH_PASSWORD: OWNER_PW,
      WB_DATA_DIR: dataDir,
      WB_ASSET_DIR: assetDir
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', d => process.stderr.write('[server] ' + d));
  child.stdout.resume();

  const cleanup = () => {
    try { child.kill(); } catch (e) {}
    for (const d of [dataDir, assetDir]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
  };

  try {
    /* 等待启动 */
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      await new Promise(r => setTimeout(r, 100));
      try { await req('GET', '/api/ping'); up = true; } catch (e) {}
    }
    ok(up, '服务器启动（ping 有响应）');

    console.log('\n== 登录与鉴权 ==');
    let r = await req('GET', '/api/ping');
    ok(r.status === 401, '无令牌 ping → 401');
    r = await req('POST', '/api/login', { body: { password: 'wrong!' } });
    ok(r.status === 401, '错误密码登录 → 401');
    r = await req('POST', '/api/login', { body: { password: OWNER_PW } });
    ok(r.status === 200 && r.json && r.json.token, '正确密码登录 → 令牌');
    const T = r.json.token;
    r = await req('GET', '/api/ping', { token: T });
    ok(r.status === 200 && r.json && r.json.ok === true, '站长令牌 ping → ok');

    console.log('\n== 只读分享（服务器版） ==');
    r = await req('GET', '/api/share/config');
    ok(r.status === 200 && r.json && r.json.enabled === false, '分享初始状态 → 未开启');
    r = await req('POST', '/api/share/verify', { body: { password: SHARE_PW } });
    ok(r.status === 404, '未开启时分享验证 → 404');
    r = await req('POST', '/api/share/set', { body: { enabled: true, password: SHARE_PW } });
    ok(r.status === 401, '无令牌设置分享 → 401');
    r = await req('POST', '/api/share/set', { token: T, body: { enabled: true, password: 'abc' } });
    ok(r.status === 400, '分享密码过短 → 400');
    r = await req('POST', '/api/share/set', { token: T, body: { enabled: true, password: SHARE_PW } });
    ok(r.status === 200 && r.json && r.json.enabled === true, '站长开启分享 → ok');
    r = await req('GET', '/api/share/config');
    ok(r.json && r.json.enabled === true, '分享状态 → 已开启');
    r = await req('POST', '/api/share/verify', { body: { password: 'wrong!' } });
    ok(r.status === 401, '错误分享密码 → 401');
    r = await req('POST', '/api/share/verify', { body: { password: SHARE_PW } });
    ok(r.status === 200 && r.json && r.json.token, '正确分享密码 → 只读令牌');
    const S = r.json.token;
    r = await req('GET', '/api/share/data', { token: T });
    ok(r.status === 401, '站长令牌不能当只读令牌用 → 401（令牌分离）');
    r = await req('GET', '/api/share/data');
    ok(r.status === 401, '无令牌拉分享数据 → 401');
    r = await req('GET', '/api/share/data', { token: S });
    ok(r.status === 200 && r.json && r.json.db === null, '只读令牌拉取 → 服务器为空 db:null');

    /* 站长写入数据 → 分享端实时可见 */
    const db = { tasks: [{ id: 't1', title: '给老师看的任务', date: '2026-10-29' }], meta: {} };
    r = await req('POST', '/api/data', { token: T, body: { db } });
    ok(r.status === 200 && r.json && r.json.serverUpdatedAt > 0, '站长写入数据 → ok');
    r = await req('POST', '/api/data', { token: S, body: { db: { tasks: [], meta: {} } } });
    ok(r.status === 401, '只读令牌写入数据 → 401（访客无写权限）');
    r = await req('GET', '/api/share/data', { token: S });
    ok(r.status === 200 && r.json && r.json.db && r.json.db.tasks.length === 1
      && r.json.db.tasks[0].title === '给老师看的任务', '分享端实时看到站长数据');

    console.log('\n== 原图上传（服务器版 assets/） ==');
    const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';   /* 1x1 png */
    const pngBin = Buffer.from(pngB64, 'base64');
    r = await req('POST', '/api/asset', { body: { ext: 'png', data: pngB64 } });
    ok(r.status === 401, '无令牌上传图片 → 401');
    r = await req('POST', '/api/asset', { token: S, body: { ext: 'png', data: pngB64 } });
    ok(r.status === 401, '只读令牌上传图片 → 401');
    r = await req('POST', '/api/asset', { token: T, body: { ext: 'exe', data: pngB64 } });
    ok(r.status === 400, '非法图片格式 → 400');
    r = await req('POST', '/api/asset', { token: T, body: { ext: 'png', data: '!!!not-base64!!!' } });
    ok(r.status === 400, '非法 base64 → 400');
    r = await req('POST', '/api/asset', { token: T, body: { ext: 'png', data: pngB64 } });
    ok(r.status === 200 && r.json && /^assets\/img-\w+\.(png|jpg|gif|webp)$/.test(r.json.url), '上传原图 → 返回 assets/ 路径: ' + ((r.json || {}).url));
    const url = r.json.url;
    r = await req('GET', '/' + url);
    ok(r.status === 200 && r.buf.equals(pngBin), '访客可公开访问原图（字节一致，无需令牌）');
    r = await req('GET', '/assets/x%2F..%2F..%2Fserver.js');   /* %2F 解码后才成为 ../，能真正越出 assets 目录 */
    ok(r.status === 403, 'assets 路径穿越 → 403');
    r = await req('GET', '/assets/img-not-exist.png');
    ok(r.status === 404, '不存在的图片 → 404');

    console.log('\n== 敏感路径与停止分享 ==');
    r = await req('GET', '/data/db.json');
    ok(r.status === 403, 'GET /data/db.json → 403');
    r = await req('GET', '/data/server-config.json');
    ok(r.status === 403, 'GET /data/server-config.json → 403');
    r = await req('POST', '/api/share/set', { token: T, body: { enabled: false } });
    ok(r.status === 200, '站长停止分享 → ok');
    r = await req('GET', '/api/share/config');
    ok(r.json && r.json.enabled === false, '分享状态 → 已关闭');
    r = await req('GET', '/api/share/data', { token: S });
    ok(r.status === 401, '停止分享后旧只读令牌立即失效 → 401');
    r = await req('POST', '/api/share/verify', { body: { password: SHARE_PW } });
    ok(r.status === 404, '停止后分享验证 → 404');

    console.log('\n== 登录限速 ==');
    for (let i = 0; i < 6; i++) await req('POST', '/api/login', { body: { password: 'bad-' + i } });
    r = await req('POST', '/api/login', { body: { password: OWNER_PW } });
    ok(r.status === 429, '连续 6 次错误后被锁定 → 429');
  } finally {
    cleanup();
  }

  console.log('\n结果：' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('测试崩溃：', e); process.exit(1); });
