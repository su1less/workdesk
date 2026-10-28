/* Node 环境逻辑自测：stub localStorage 后测试 MD 解析 / 排程 / 报告 */
global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
global.document = { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } };

const path = require('path');
const base = path.join(__dirname, '..');
const load = (f, names) => {
  const src = require('fs').readFileSync(path.join(base, 'js', f), 'utf8');
  const exp = names.map(n => `globalThis.${n}=${n};`).join('');
  (0, eval)(src + '\n' + exp);
};
load('store.js', ['U', 'Store']);
load('scheduler.js', ['Scheduler']);
load('md.js', ['MD']);
load('refs.js', ['Refs']);
load('sync.js', ['Sync']);
load('gate.js', ['Gate']);

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  ✗ FAIL:', name); } };

/* ---------- 1. MD.parse ---------- */
console.log('== MD.parse ==');
const doc = `# 十一月冲刺计划
## 2027-03-01 ~ 2027-03-03 冲刺安排
- [ ] 完成登录模块 !高 ~4h
- [x] 需求评审会议 14:00-15:30 [固定]
  - 复现步骤见 issue #123
- [ ] 修复支付回调 P0
## 本周任务
- [ ] 完成联调测试 60% #测试
## 本月目标
- [ ] 发布 v2.1 版本 20%`;
const r = MD.parse(doc);
t('标题解析', r.title === '十一月冲刺计划');
t('解析出 5 项任务', r.tasks.length === 5);
const t1 = r.tasks[0];
t('优先级 !高 → high', t1.priority === 'high');
t('时长 ~4h 未计入标题', !/4h|~/.test(t1.title) && t1.title === '完成登录模块');
t('区间第1项日期=起始日', t1.date === '2027-03-01');
t('区间任务按天分配', r.tasks[1].date === '2027-03-02' && r.tasks[2].date === '2027-03-03');
const t2 = r.tasks[1];
t('时间块 14:00-15:30', t2.start === '14:00' && t2.end === '15:30');
t('[固定] → fixed', t2.fixed === true);
t('缩进行 → 备注', /issue #123/.test(t2.note));
t('已完成勾选', t2.status === 'done');
const t3 = r.tasks[2];
t('P0 → high', t3.priority === 'high');
const t4 = r.tasks[3];
t('本周任务 level=week', t4.level === 'week');
t('进度 60% 解析', t4.progress === 60);
t('#测试 标签', t4.tags.includes('测试'));
const t5 = r.tasks[4];
t('本月目标 level=month', t5.level === 'month');

/* 表格解析 */
const tbl = MD.parse(`# 表格计划
| 任务 | 日期 | 优先级 | 进度 |
| --- | --- | --- | --- |
| 写周报 | 10-24 | 高 | 50% |
| 开会 | 10-25 14:00-15:00 | 低 | 0% |`);
t('表格解析 2 行', tbl.tasks.length === 2);
t('表格优先级', tbl.tasks[0].priority === 'high');
t('表格日期+时间', tbl.tasks[1].date.endsWith('-10-25') && tbl.tasks[1].start === '14:00');

/* 快速添加 inline */
console.log('== MD.inline ==');
const q = MD.inline('写周报 14:00-15:00 !高 #产品 明天', {});
t('inline 时间', q.start === '14:00' && q.end === '15:00');
t('inline 优先级', q.priority === 'high');
t('inline 标签', q.tags[0] === '产品');
t('inline 明天', q.date === U.addDays(U.todayStr(), 1));
t('inline 标题清洗', q.title === '写周报');

/* ---------- 2. Scheduler ---------- */
console.log('== Scheduler ==');
Store.load();
Store.db.tasks = [];
Store.db.settings = { workingStart: '07:00', workingEnd: '23:00', theme: 'light' };
const T = U.todayStr();
Store.addTask({ kind: 'event', title: '固定晨会', date: T, start: '09:00', end: '09:30', fixed: true });
Store.addTask({ title: '可调任务A', date: T, start: '10:00', end: '11:00' });
Store.addTask({ title: '可调任务B', date: T, start: '11:00', end: '12:00' });
Store.addTask({ title: '不受影响C', date: T, start: '16:00', end: '17:00' });

const evt = { title: '客户临时到访', date: T, start: '10:30', end: '12:30' };
const plan = Scheduler.propose(evt);
t('2 项可调任务冲突', plan.moves.length === 2 && plan.flex.length === 2);
t('无固定冲突', plan.fixedConf.length === 0);
const mvA = plan.moves.find(m => m.taskTitle === '可调任务A');
const mvB = plan.moves.find(m => m.taskTitle === '可调任务B');
t('A 顺延到 12:30 后', mvA && U.hm(mvA.start) >= U.hm('12:30'), mvA && mvA.start);
t('B 在 A 之后且不重叠', mvA && mvB && U.hm(mvB.start) >= U.hm(mvA.end));
t('调整仍在当天', mvA.date === T && mvB.date === T);
t('C 不在调整列表', !plan.moves.some(m => m.taskTitle === '不受影响C'));

/* 冲突固定日程提示 */
Store.addTask({ kind: 'event', title: '另一个固定会', date: T, start: '11:00', end: '12:00', fixed: true });
const plan2 = Scheduler.propose(evt);
t('固定日程冲突被识别', plan2.fixedConf.length === 1);

/* 应用调整 */
const ev2 = Scheduler.apply(evt, plan.moves);
const after = Store.tasks().find(x => x.title === '可调任务A');
t('apply 后 A 位置更新', after.start === mvA.start);
t('apply 后产生调整说明', /客户临时到访/.test(after.adjusted));
t('突发事件已入库', Store.tasks().some(x => x.id === ev2.id && x.sudden));

/* ---------- 3. 报告 ---------- */
console.log('== MD.report ==');
Store.db.tasks = [];
const WS = U.weekStart(T);
Store.addTask({ title: '任务1', date: T, status: 'done', progress: 100 });
Store.addTask({ title: '任务2', date: T, status: 'doing', progress: 40 });
Store.addTask({ level: 'week', date: WS, title: '周任务', status: 'todo' });
Store.addTask({ kind: 'event', sudden: true, title: '突发A', date: T, start: '10:00', end: '11:00', fixed: true });
const rep = MD.report('week', T);
t('报告标题', /工作周报/.test(rep));
t('概览含完成率', /综合完成率/.test(rep));
t('已完成列表', /任务1/.test(rep));
t('进行中含进度条', /任务2.*█/.test(rep));
t('突发日程章节', /突发A/.test(rep));
const repM = MD.report('month', T);
t('月报标题', /工作月报/.test(repM));

/* ---------- 4. 日期工具 ---------- */
console.log('== U ==');
t('weekStart 是周一', U.parseDate(U.weekStart('2026-10-23')).getDay() === 1);
t('addDays', U.addDays('2026-10-31', 1) === '2026-11-01');
t('overlaps', U.overlaps('10:00', '11:00', '10:30', '12:00'));
t('non-overlaps', !U.overlaps('10:00', '11:00', '11:00', '12:00'));

/* ---------- 5. 文献管理（BibTeX / 状态流转 / 任务联动） ---------- */
console.log('== Refs / BibTeX ==');
const bib = `@article{vaswani2017attention,
  title = {Attention Is All You {Need}},
  author = {Vaswani, Ashish and Shazeer, Noam and others},
  journal = {Advances in Neural Information Processing Systems},
  year = {2017},
  doi = {10.5555/3294771},
  keywords = {transformer, attention}
}

@inproceedings{wei2022cot,
  title = "Chain-of-Thought Prompting",
  author = "Wei, Jason and Wang, Xuezhi",
  booktitle = "NeurIPS",
  year = "2022",
  url = "https://example.com/cot"
}

@book{goodfellow2016dl,
  title = {Deep Learning},
  author = {Goodfellow, Ian and Bengio, Yoshua},
  publisher = {MIT Press},
  year = {2016}
}`;
const bp = Refs.parseBibtex(bib);
t('BibTeX 解析 3 篇', bp.refs.length === 3, 'got ' + bp.refs.length);
const b0 = bp.refs[0];
t('标题清洗花括号', b0.title === 'Attention Is All You Need');
t('作者格式化+others', b0.authors === 'Ashish Vaswani, Noam Shazeer, 等', b0.authors);
t('年份/期刊/DOI', b0.year === 2017 && /Neural/.test(b0.venue) && b0.doi === '10.5555/3294771');
t('关键词→标签', b0.tags.includes('transformer') && b0.tags.includes('attention'));
const b1 = bp.refs[1];
t('引号值解析', b1.title === 'Chain-of-Thought Prompting' && b1.authors === 'Jason Wei, Xuezhi Wang');
t('inproceedings→paper', b1.type === 'paper' && b1.url === 'https://example.com/cot');
t('book→book', bp.refs[2].type === 'book' && bp.refs[2].venue === 'MIT Press');
t('空内容告警', Refs.parseBibtex('hello world').refs.length === 0);

/* 导出 */
const bibOut = Refs.toBibtex([b0]);
t('导出含 @article 与字段', /@article\{/.test(bibOut) && /title = \{Attention Is All You Need\}/.test(bibOut) && /year = \{2017\}/.test(bibOut));

/* 状态流转 */
Store.db.refs = [];
const r1 = Store.addRef({ title: '测试文献A', authors: '张三', year: 2024, status: 'want' });
t('初始想读', r1.status === 'want' && r1.readAt === null);
Store.updateRef(r1.id, { status: 'reading', readProgress: 40 });
t('转在读', Store.getRef(r1.id).status === 'reading' && Store.getRef(r1.id).readAt === null);
Store.updateRef(r1.id, { status: 'read' });
const r1b = Store.getRef(r1.id);
t('转已读记录时间+进度', r1b.readAt !== null && r1b.readProgress === 100);
Store.updateRef(r1.id, { status: 'want' });
t('回到想读清时间', Store.getRef(r1.id).readAt === null);
t('refStats 统计', Store.refStats().total === 1 && Store.refStats().want === 1);

/* 任务联动 */
const tk = Refs.taskFromRef(r1.id, 'day');
t('生成阅读任务', tk.title === '阅读《测试文献A》' && tk.refId === r1.id && tk.tags.includes('文献'));
t('周任务对齐周一', Refs.taskFromRef(r1.id, 'week').date === U.weekStart(U.todayStr()));

/* 报告文献章节 */
Store.db.tasks = [];
Store.addTask({ title: '任务1', date: T, status: 'done', progress: 100 });
Store.updateRef(r1.id, { status: 'read' });
const repW2 = MD.report('week', T);
t('周报含文献章节', /六、文献阅读/.test(repW2));
t('周报编号顺延', /七、下周安排/.test(repW2));

/* ---------- 6. GitHub 同步工具（Base64 / AES-GCM 加密） ---------- */
console.log('== Sync crypto ==');
t('b64 中文往返', Sync.b64decode(Sync.b64encode('中文测试🎉emoji')) === '中文测试🎉emoji');
const big = 'x'.repeat(100000) + '结尾';
t('b64 大文本往返（分块）', Sync.b64decode(Sync.b64encode(big)) === big);
(async () => {
  const salt = Sync.b64rnd(16);
  const key = await Sync.deriveKey('我的口令123', salt);
  const txt = JSON.stringify({ db: { tasks: [{ title: '加密任务测试', note: '📎' }] }, serverUpdatedAt: 1698000000000 });
  const enc = await Sync.encryptText(key, txt);
  t('AES-GCM 加密往返', (await Sync.decryptText(key, enc)) === txt);
  const wrongKey = await Sync.deriveKey('错误口令', salt);
  let failed = false;
  try { await Sync.decryptText(wrongKey, enc); } catch (e) { failed = true; }
  t('错误口令解密失败', failed);
  t('密文不含明文', !enc.includes('加密任务测试'));
  /* 网页门禁哈希 */
  const gs = Gate.b64rnd ? null : null;
  const salt2 = Sync.b64rnd(16);
  const h1 = await Gate.deriveHash('门禁口令测试', salt2);
  const h2 = await Gate.deriveHash('门禁口令测试', salt2);
  const h3 = await Gate.deriveHash('其他口令', salt2);
  const h4 = await Gate.deriveHash('门禁口令测试', Sync.b64rnd(16));
  t('门禁哈希确定性', h1 === h2 && /^[0-9a-f]{64}$/.test(h1));
  t('门禁哈希敏感性（口令/盐不同则不同）', h1 !== h3 && h1 !== h4);
  finish();
})();

function finish() {
  console.log(`\n结果：${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
return;
