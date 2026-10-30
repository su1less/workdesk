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
load('ai.js', ['AI']);
load('sync.js', ['Sync']);
load('gate.js', ['Gate']);
load('blocks.js', ['Blocks']);

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

/* ---------- 5.5 块编辑器：Markdown ⇄ 块 ---------- */
console.log('== Blocks parse/serialize ==');
const bdoc = `# 第44周周报

本周完成三件事，实验推进顺利。

## 实验结果

- [x] 数据集清洗
- [ ] 消融实验补充
  - 三组对照
- 结论：$E=mc^2$

\`\`\`python
def hello():
    print("hi")   # 代码内空行

    return 1
\`\`\`

| 列1 | 列2 |
| --- | --- |
| a | b |

> 引用一句
> 引用两句

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

![图片](assets/img-test.png)

---

收尾段落。`;
const frags = Blocks.parse(bdoc);
t('块数量（标题/段落/标题/列表/代码/表格/引用/公式/图片/分割线/段落=11）', frags.length === 11);
t('标题独立成块', frags[0] === '# 第44周周报');
t('列表聚合为一块（含缩进续行）', frags[3].split('\n').length === 4 && /^- \[x\]/.test(frags[3]));
t('代码块完整保留（含内部空行）', /print\("hi"\)/.test(frags[4]) && frags[4].split('\n').length === 6);
t('表格聚合成块', frags[5].startsWith('| 列1'));
t('引用聚合', frags[6] === '> 引用一句\n> 引用两句');
t('块级公式完整', frags[7].startsWith('$$') && frags[7].trimEnd().endsWith('$$'));
t('序列化往返一致', Blocks.serialize(frags) === bdoc);
t('序列化再解析幂等', Blocks.serialize(Blocks.parse(Blocks.serialize(frags))) === Blocks.serialize(frags));
t('空文档 → 空块数组', Blocks.parse('') .length === 0 && Blocks.parse('  \n\n ') .length === 0);
t('连续段落成一块', Blocks.parse('第一行\n第二行').length === 1);
t('序列化剔除空块', Blocks.serialize(['a', '', '  ', 'b']) === 'a\n\nb');

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
  /* 只读分享密钥派生 */
  const shSalt = Sync.b64rnd(16);
  const k1 = await Gate.deriveShareKeys('teacher-pass', shSalt);
  const k2 = await Gate.deriveShareKeys('teacher-pass', shSalt);
  const k3 = await Gate.deriveShareKeys('other-pass', shSalt);
  t('分享密钥哈希确定性(64hex)', k1.hash === k2.hash && /^[0-9a-f]{64}$/.test(k1.hash));
  t('分享哈希口令敏感', k1.hash !== k3.hash);
  const kHex1 = await Gate.keyHex(k1.key), kHex2 = await Gate.keyHex(k2.key);
  t('分享密钥确定性', kHex1 === kHex2);
  /* 分享密钥可加解密数据（访客读取路径） */
  const shPlain = JSON.stringify({ db: { tasks: [{ title: '老师可见' }] }, serverUpdatedAt: 123 });
  const shEnc = await Sync.encryptText(k1.key, shPlain);
  const shFile = 'WBENC1:' + shEnc;   /* 入库文件格式 */
  t('分享数据加解密往返', (await Sync.decryptText(k2.key, shFile.slice(7))) === shPlain);
  /* 文档模块：MD.render 升级 + docs CRUD */
  const mdHtml = MD.render('# 标题\n\n```python\nprint("<b>hi</b>")\n```\n\n![图](data:image/png;base64,AAA)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$E=mc^2$ ~~删~~');
  t('代码块渲染+转义', mdHtml.includes('<pre><code class="lang-python">print("&lt;b&gt;hi&lt;/b&gt;")') );
  t('图片渲染', mdHtml.includes('<img src="data:image/png;base64,AAA"'));
  t('表格渲染', mdHtml.includes('<table>') && mdHtml.includes('<th>A</th>') && mdHtml.includes('<td>2</td>'));
  t('删除线', mdHtml.includes('<del>删</del>'));
  t('公式原文保留（KaTeX 前端排版）', mdHtml.includes('$E=mc^2$'));
  Store.db.docs = [];
  const doc1 = Store.addDoc({ title: '测试周报', type: 'week', content: '# hi' });
  t('addDoc', Store.getDoc(doc1.id).title === '测试周报');
  Store.updateDoc(doc1.id, { content: '# changed' });
  t('updateDoc', Store.getDoc(doc1.id).content === '# changed');
  Store.deleteDoc(doc1.id);
  t('deleteDoc', !Store.getDoc(doc1.id));

  /* ---------- 7. AI 助手（上下文 / 快捷指令 / 对话存储 / 默认接口） ---------- */
  console.log('== AI ==');
  t('服务商：DeepSeek 官方接口', AI.PROVIDERS.deepseek.url === 'https://api.deepseek.com/chat/completions');
  t('服务商：智谱 GLM 官方接口', AI.PROVIDERS.glm.url === 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
  t('GLM flash 系列模型列表（默认 glm-5.3-flash）', AI.PROVIDERS.glm.models[0] === 'glm-5.3-flash'
    && AI.PROVIDERS.glm.def === 'glm-5.3-flash'
    && AI.PROVIDERS.glm.models.includes('glm-5.3-flashx')
    && AI.PROVIDERS.glm.models.includes('glm-4.7-flash')
    && AI.PROVIDERS.glm.models.every(m => m.includes('flash')));
  t('快捷指令 6 条（日/周/月 × 总结/规划）', AI.QUICK.length === 6
    && ['day', 'week', 'month'].every(s => AI.QUICK.some(q => q.scope === s))
    && AI.QUICK.every(q => q.prompt && q.title));
  t('未配置时回退内置默认 GLM 接口', (() => {
    localStorage.removeItem('wb.ai');
    const c = AI.cfg();
    return c.provider === 'glm' && c.key === AI.DEFAULT_CFG.key
      && c.model === 'glm-5.3-flash' && AI.isDefault() === true;
  })());
  t('只存模型时静默沿用内置 Key（页面无需显示 Key）', (() => {
    localStorage.setItem('wb.ai', JSON.stringify({ model: 'glm-4.7-flash' }));
    const c = AI.cfg();
    return c.key === AI.DEFAULT_CFG.key && c.model === 'glm-4.7-flash' && AI.isDefault() === true;
  })());
  t('savedCfg 永不含内置 Key（页面回显安全）', (() => {
    localStorage.removeItem('wb.ai');
    return !('key' in AI.savedCfg()) && Object.keys(AI.savedCfg()).length === 0;
  })());
  localStorage.setItem('wb.ai', JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-chat' }));
  t('配置读取 + 模型标签', AI.cfg() && AI.model() === 'deepseek-chat' && !AI.isDefault());
  t('自定义服务商取自定义地址', (() => {
    localStorage.setItem('wb.ai', JSON.stringify({ provider: 'custom', key: 'k', url: 'https://api.example.com/v1/chat/completions', model: 'm1' }));
    return AI.ep() === 'https://api.example.com/v1/chat/completions' && AI.model() === 'm1';
  })());
  localStorage.removeItem('wb.ai');

  Store.db.tasks = [];
  const T0 = U.todayStr();
  Store.addTask({ title: '今天要写的报告', status: 'doing', progress: 40, priority: 'high', start: '10:00', end: '11:00' });
  Store.addTask({ title: '已完成的站会', status: 'done', progress: 100 });
  const ctxDay = AI.buildContext('day');
  t('day 上下文含今日任务标题', ctxDay.includes('今日') && ctxDay.includes('今天要写的报告'));
  t('day 上下文含状态与进度', ctxDay.includes('进行中 40%') && ctxDay.includes('已完成'));
  Store.db.tasks = [];
  const ws0 = U.weekStart(T0);
  Store.addTask({ title: '本周重点任务X', level: 'week', date: ws0, progress: 30, status: 'doing' });
  const ctxWeek = AI.buildContext('week');
  t('week 上下文含周任务与七天明细标题', ctxWeek.includes('本周重点任务X') && ctxWeek.includes('【本周'));
  const mk0 = U.monthKey(T0);
  Store.addTask({ title: '本月目标Y', level: 'month', date: mk0 + '-01' });
  t('month 上下文含月目标', AI.buildContext('month').includes('本月目标Y'));
  t('auto 上下文同时含周与月', AI.buildContext('auto').includes('【本周') && AI.buildContext('auto').includes('【本月'));
  t('系统提示词含中文要求', AI.system().includes('简体中文') && AI.system().includes('Markdown'));

  /* 对话存储 CRUD */
  Store.db.chats = [];
  const chatA = Store.addChat();
  t('addChat 默认字段', chatA.title === '新对话' && Array.isArray(chatA.messages) && !!chatA.id);
  t('getChat', Store.getChat(chatA.id) === chatA);
  Store.deleteChat(chatA.id);
  t('deleteChat', !Store.getChat(chatA.id));
  t('_normalize 归一化 chats', (Store.db.chats = null, Store._normalize(), Array.isArray(Store.db.chats) && Store.db.chats.length === 0));

  /* ---------- 8. 壁纸与桌宠设置 ---------- */
  console.log('== Wallpaper & Pet ==');
  t('_normalize 默认壁纸为深海 aqua', (() => {
    Store.db.settings = { workingStart: '07:00', workingEnd: '23:00', theme: 'light' };
    Store._normalize();
    return Store.db.settings.wallpaper === 'aqua';
  })());
  t('_normalize 默认开启桌宠', (() => {
    Store.db.settings = { theme: 'light' };
    Store._normalize();
    return Store.db.settings.pet === true;
  })());
  t('_normalize 默认桌宠形象为官方立绘', (() => {
    Store.db.settings = { theme: 'light' };
    Store._normalize();
    return Store.db.settings.petSkin === 'mascot' && Store.db.settings.petImg === '';
  })());

  /* ---------- 9. 文献分类 ---------- */
  console.log('== Refs cat ==');
  Store.db.refs = [];
  const rc1 = Store.addRef({ title: '论文A', cat: 'NLP' });
  const rc2 = Store.addRef({ title: '论文B', cat: 'NLP' });
  const rc3 = Store.addRef({ title: '书C', cat: '' });
  const rc4 = Store.addRef({ title: '论文D' });   /* 无 cat 字段 → 未分类 */
  t('refsCats 统计与排序（未分类在末尾）', (() => {
    const cats = Store.refsCats();
    return cats[0].name === 'NLP' && cats[0].count === 2
      && cats[cats.length - 1].name === '' && cats[cats.length - 1].count === 2;
  })());
  t('addRef 默认 cat 为空串', rc4.cat === '' && rc3.cat === '');
  t('renameRefCat 重命名传播', Store.renameRefCat('NLP', '自然语言处理') === 2
    && Store.getRef(rc1.id).cat === '自然语言处理' && Store.getRef(rc2.id).cat === '自然语言处理');
  t('renameRefCat 空改有（未分类批量归类）', Store.renameRefCat('', '教材') === 2
    && Store.getRef(rc3.id).cat === '教材' && Store.getRef(rc4.id).cat === '教材');
  t('renameRefCat 删除分类归未分类', Store.renameRefCat('教材', '') === 2 && Store.getRef(rc3.id).cat === '');
  t('renameRefCat 不存在的分类返回 0', Store.renameRefCat('不存在', 'x') === 0);
  t('_normalize 补齐旧数据缺失的 cat', (() => {
    Store.db.refs = [{ id: 'x1', title: '旧数据文献' }];
    Store._normalize();
    return Store.db.refs[0].cat === '' && Array.isArray(Store.db.refs[0].tags);
  })());
  finish();
})();

function finish() {
  console.log(`\n结果：${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
return;
