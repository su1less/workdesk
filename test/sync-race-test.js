/* ============================================================
 * sync-race-test.js — 同步竞态回归测试
 * 场景：本地清空数据（推送防抖期内发生拉取）不得被远端旧数据覆盖，
 *       推送必须最终到达服务器；推送失败保持脏标记并自动重试。
 * 运行：node test/sync-race-test.js
 * ============================================================ */
global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
global.document = { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, body: { classList: { add() {} } } };
global.UI = { toast() {}, modal() {}, confirm() { return Promise.resolve(true); }, closeModal() {} };

const path = require('path');
const base = path.join(__dirname, '..');
const load = (f, names) => {
  const src = require('fs').readFileSync(path.join(base, 'js', f), 'utf8');
  (0, eval)(src + '\n' + names.map(n => `globalThis.${n}=${n};`).join(''));
};
load('store.js', ['U', 'Store']);
load('sync.js', ['Sync']);

let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✗ FAIL:', name, extra || ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64e = s => Buffer.from(s, 'utf8').toString('base64');
const b64d = s => Buffer.from(String(s).replace(/\s+/g, ''), 'base64').toString('utf8');
const resp = (status, obj) => ({ status, ok: status < 400, json: async () => obj, text: async () => JSON.stringify(obj), headers: { get: () => 'application/json' } });

(async () => {
  /* ---- 模拟 GitHub 服务器：初始有一份旧数据 ---- */
  const server = {
    sha: 'sha-1',
    wrapper: { db: { tasks: [{ id: 'a1', title: '旧任务', date: '2026-01-01', level: 'day', status: 'todo' }], refs: [], meta: {}, settings: {} }, serverUpdatedAt: 100 }
  };
  let puts = 0;
  let putDelay = 0;
  global.fetch = async (url, opts) => {
    url = String(url);
    const isPut = opts && opts.method === 'PUT';
    if (url.includes('/contents/data/db.json') && !isPut) {
      return resp(200, { sha: server.sha, encoding: 'base64', content: b64e(JSON.stringify(server.wrapper)) });
    }
    if (url.includes('/contents/data/db.json') && isPut) {
      if (putDelay) await sleep(putDelay);
      puts++;
      server.sha = 'sha-' + (puts + 1);
      server.wrapper = JSON.parse(b64d(JSON.parse(opts.body).content));
      return resp(200, { content: { sha: server.sha } });
    }
    if (url.includes('/contents/site-config.json')) return resp(404, {});
    return resp(404, {});
  };

  /* ---- 进入 GitHub 同步模式 ---- */
  Store.load();
  Sync.mode = 'github';
  Sync.gh = { repo: 't/r', branch: 'main', path: 'data/db.json', token: 'x', pass: '', salt: Sync.b64rnd(16) };

  /* 初始拉取（无脏数据）→ 采纳服务器旧数据 */
  await Sync.pull();
  t('初始拉取采纳远端数据', Store.db.tasks.length === 1);

  /* ---- 用户点击"清空数据"（推送进入 3 秒防抖期） ---- */
  Store.db.tasks = [];
  Store.db.refs = [];
  Store.db.meta.lastBriefDate = U.todayStr();
  Store.save();
  t('清空后置脏标记', Sync._dirty === true);

  /* 防抖期内发生拉取（聚焦/轮询）→ 不得覆盖本地待推送的清空 */
  await Sync.pull();
  t('防抖期内拉取被阻止（本地仍为空）', Store.db.tasks.length === 0);
  t('防抖期内未误推旧数据', server.wrapper.db.tasks.length === 1);

  /* 等待防抖结束，推送应到达服务器 */
  await sleep(3400);
  t('推送到达服务器（服务器被清空）', server.wrapper.db.tasks.length === 0);
  t('推送成功后脏标记清除', Sync._dirty === false);
  const su = Store.db.meta.serverUpdatedAt;
  t('本地同步标记已更新', typeof su === 'number' && su >= 100);

  /* 推送后的拉取不应回滚 */
  await Sync.pull();
  t('推送后拉取不回滚', Store.db.tasks.length === 0);

  /* ---- 推送失败场景：服务器暂时 500 → 保持脏标记并重试 ---- */
  const goodFetch = global.fetch;
  global.fetch = async () => { await sleep(50); return resp(500, {}); };
  Store.addTask({ title: '网络故障期的修改' });
  await sleep(3400);   /* 防抖推送 → 失败（保持 dirty） */
  t('推送失败保持脏标记', Sync._dirty === true);
  await Sync.pull();   /* 失败期间拉取仍不得覆盖 */
  t('失败期间拉取被阻止', Store.db.tasks.length === 1);

  global.fetch = goodFetch;
  await sleep(16000);  /* 等 15 秒自动重试 */
  t('自动重试后服务器收到修改', server.wrapper.db.tasks.length === 1 && server.wrapper.db.tasks[0].title === '网络故障期的修改');
  t('重试成功后脏标记清除', Sync._dirty === false);

  /* ---- 场景 3：推送在途期间又发生新修改（代际保护） ---- */
  putDelay = 1200;   /* 模拟慢网络：PUT 需要 1.2 秒 */
  Store.addTask({ title: '推送期间第一次修改' });
  Sync._pushTimer = null;
  Sync.push();                              /* 立即推送（跳过防抖，制造在途窗口） */
  await sleep(400);                          /* 推送在途 */
  Store.addTask({ title: '推送在途中的新修改' });   /* save → dirty=true, 代际+1 */
  await sleep(1400);                         /* 第一次推送完成 */
  t('推送完成后脏标记保留（期间有新修改）', Sync._dirty === true);
  await Sync.pull();
  t('在途修改未被拉取覆盖', Store.db.tasks.some(x => x.title === '推送在途中的新修改'));
  await sleep(3400);                         /* 新修改的防抖推送 */
  t('在途修改最终推送到服务器', server.wrapper.db.tasks.some(x => x.title === '推送在途中的新修改'));
  t('最终脏标记清除', Sync._dirty === false);
  putDelay = 0;

  console.log(`\n结果：${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
