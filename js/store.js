/* ============================================================
 * store.js — 数据模型 & 持久化（localStorage）
 * 全局命名空间：U（工具函数）、Store
 * ============================================================ */

/* ---------- 日期/时间工具 ---------- */
const U = {
  pad(n) { return String(n).padStart(2, '0'); },
  dateStr(d) { return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate()); },
  parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
  todayStr() { return U.dateStr(new Date()); },
  addDays(s, n) { const d = U.parseDate(s); d.setDate(d.getDate() + n); return U.dateStr(d); },
  /* 周一为一周开始 */
  weekStart(s) { const d = U.parseDate(s); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return U.dateStr(d); },
  weekEnd(s) { return U.addDays(U.weekStart(s), 6); },
  monthKey(s) { return s.slice(0, 7); },
  monthStart(mk) { return mk + '-01'; },
  monthEnd(mk) { const [y, m] = mk.split('-').map(Number); return U.dateStr(new Date(y, m, 0)); },
  addMonths(mk, n) { const [y, m] = mk.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return U.dateStr(d).slice(0, 7); },
  nowHM() { const d = new Date(); return U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()); },
  hm(s) { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); },
  minHM(min) { return U.pad(Math.floor(min / 60)) + ':' + U.pad(min % 60); },
  overlaps(s1, e1, s2, e2) { return U.hm(s1) < U.hm(e2 || s2) && U.hm(s2) < U.hm(e1 || s1); },
  weekdayCN(s) { return '日一二三四五六'[U.parseDate(s).getDay()]; },
  fmtCN(s) { const d = U.parseDate(s); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; },
  fmtFull(s) { const d = U.parseDate(s); return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'; },
  fmtWeekCN(s) { return '周' + U.weekdayCN(s); },
  isoWeekNumber(s) {
    const d = U.parseDate(s);
    const t = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7;
    t.setDate(t.getDate() - dayNr + 3);
    const firstThursday = new Date(t.getFullYear(), 0, 4);
    const diff = t - firstThursday;
    return 1 + Math.round((diff / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  },
  greeting() {
    const h = new Date().getHours();
    if (h < 5) return '夜深了';
    if (h < 9) return '早上好';
    if (h < 12) return '上午好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  },
  relDay(ds) {
    const t = U.todayStr();
    if (ds === t) return '今天';
    if (ds === U.addDays(t, 1)) return '明天';
    if (ds === U.addDays(t, -1)) return '昨天';
    return U.fmtCN(ds) + ' ' + U.fmtWeekCN(ds);
  }
};

/* ---------- Store ---------- */
const DB_KEY = 'workbench.db.v1';

const Store = {
  db: null,

  load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      this.db = raw ? JSON.parse(raw) : null;
    } catch (e) { this.db = null; }
    if (!this.db || !Array.isArray(this.db.tasks)) this.db = this._seed();
    this._normalize();
    this.save();
    return this.db;
  },

  /* 字段归一化：补齐缺失的默认字段（种子/旧备份/访客数据兼容） */
  _normalize() {
    if (!this.db.settings) this.db.settings = { workingStart: '07:00', workingEnd: '23:00', theme: 'light' };
    if (!this.db.meta) this.db.meta = { lastBriefDate: '' };
    this.db.tasks = (this.db.tasks || []).map(t => Object.assign({
      id: this.uid(), kind: 'task', level: 'day', status: 'todo', progress: 0,
      priority: 'mid', date: U.todayStr(), due: '', start: '', end: '', fixed: false, sudden: false,
      tags: [], source: '', adjusted: '', note: '',
      createdAt: Date.now(), updatedAt: Date.now(), doneAt: null
    }, t));
    this.db.refs = (this.db.refs || []).map(r => Object.assign({
      id: this.uid(), title: '', authors: '', year: null, type: 'paper', venue: '',
      doi: '', url: '', tags: [], status: 'want', rating: 0, readProgress: 0,
      abstract: '', note: '', readAt: null, source: '',
      createdAt: Date.now(), updatedAt: Date.now()
    }, r));
    this.db.docs = (this.db.docs || []).map(d => Object.assign({
      id: this.uid(), title: '未命名文档', sub: '', type: 'week', content: '',
      createdAt: Date.now(), updatedAt: Date.now()
    }, d));
  },

  /* 访客只读模式：加载分享数据，不落本地存储，锁定修改 */
  adoptGuest(db, serverUpdatedAt) {
    this.db = (db && typeof db === 'object') ? db : { tasks: [], refs: [] };
    this._normalize();
    this.db.meta.serverUpdatedAt = serverUpdatedAt || 0;
    this.readOnly = true;
    document.body.classList.add('readonly');
    if (typeof App !== 'undefined' && App.state) App.render();
  },

  save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(this.db)); } catch (e) { console.error('保存失败', e); }
    /* 云端模式（自建服务器 / GitHub）：推送到远端（采纳远端数据时跳过，避免回环） */
    if (typeof Sync !== 'undefined' && Sync.mode !== 'local' && !this._skipPush) Sync.schedulePush();
    this._skipPush = false;
  },

  /* 采纳服务器端数据（多设备同步 / 登录后首次拉取） */
  adoptRemote(db, serverUpdatedAt) {
    this.db = db;
    if (!this.db.meta) this.db.meta = {};
    this.db.meta.serverUpdatedAt = serverUpdatedAt;
    if (!this.db.settings) this.db.settings = { workingStart: '07:00', workingEnd: '23:00', theme: 'light' };
    if (!Array.isArray(this.db.tasks)) this.db.tasks = [];
    if (!Array.isArray(this.db.refs)) this.db.refs = [];
    this._skipPush = true;
    this.save();
    if (typeof App !== 'undefined' && App.state) App.render();
  },

  reset() { localStorage.removeItem(DB_KEY); this.load(); },

  tasks() { return this.db.tasks; },

  uid() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },

  addTask(p) {
    const t = Object.assign({
      id: this.uid(),
      kind: 'task',            // task=任务 event=日程/会议
      title: '（未命名）',
      note: '',
      level: 'day',            // day | week | month
      status: 'todo',          // todo | doing | done
      progress: 0,
      priority: 'mid',         // high | mid | low
      date: U.todayStr(),      // 主日期（周任务=该周周一，月任务=该月1号）
      due: '',
      start: '', end: '',      // 时间块（可选）
      fixed: false,            // 固定日程（不被自动调整）
      sudden: false,           // 突发日程
      tags: [],
      source: '',              // 来源文档名
      adjusted: '',            // 被自动调整的说明
      createdAt: Date.now(),
      updatedAt: Date.now(),
      doneAt: null
    }, p);
    if (t.status === 'done' && t.progress < 100) t.progress = 100;
    this.db.tasks.push(t);
    this.save();
    return t;
  },

  get(id) { return this.db.tasks.find(t => t.id === id); },

  updateTask(id, patch) {
    const t = this.get(id);
    if (!t) return null;
    if (patch.progress !== undefined) {
      if (patch.progress >= 100) { patch.progress = 100; if (!patch.status) patch.status = 'done'; }
      else if (patch.progress > 0 && !patch.status && t.status === 'todo') patch.status = 'doing';
    }
    if (patch.status === 'done') { patch.progress = 100; patch.doneAt = Date.now(); }
    else if (patch.status && patch.status !== 'done') { patch.doneAt = null; if (patch.progress === 100) patch.progress = 90; }
    Object.assign(t, patch, { updatedAt: Date.now() });
    this.save();
    return t;
  },

  deleteTask(id) { this.db.tasks = this.db.tasks.filter(t => t.id !== id); this.save(); },

  /* ---------- 文献 CRUD ---------- */
  addRef(p) {
    const r = Object.assign({
      id: this.uid(), title: '', authors: '', year: null, type: 'paper', venue: '',
      doi: '', url: '', tags: [], status: 'want', rating: 0, readProgress: 0,
      abstract: '', note: '', readAt: null, source: '',
      createdAt: Date.now(), updatedAt: Date.now()
    }, p);
    if (r.status === 'read') { if (!r.readAt) r.readAt = Date.now(); r.readProgress = 100; }
    this.db.refs.push(r);
    this.save();
    return r;
  },

  getRef(id) { return this.db.refs.find(r => r.id === id); },

  updateRef(id, patch) {
    const r = this.getRef(id);
    if (!r) return null;
    if (patch.status) {
      if (patch.status === 'read') { if (!r.readAt) patch.readAt = Date.now(); patch.readProgress = 100; }
      else patch.readAt = null;
    }
    Object.assign(r, patch, { updatedAt: Date.now() });
    this.save();
    return r;
  },

  deleteRef(id) { this.db.refs = this.db.refs.filter(r => r.id !== id); this.save(); },

  /* ---------- 文档（周报/月报）CRUD ---------- */
  addDoc(p) {
    const d = Object.assign({
      id: this.uid(), title: '未命名文档', sub: '', type: 'week', content: '',
      createdAt: Date.now(), updatedAt: Date.now()
    }, p);
    this.db.docs.push(d);
    this.save();
    return d;
  },

  getDoc(id) { return (this.db.docs || []).find(d => d.id === id); },

  updateDoc(id, patch) {
    const d = this.getDoc(id);
    if (!d) return null;
    Object.assign(d, patch, { updatedAt: Date.now() });
    this.save();
    return d;
  },

  deleteDoc(id) { this.db.docs = this.db.docs.filter(d => d.id !== id); this.save(); },

  refStats() {
    const list = this.db.refs || [];
    const c = s => list.filter(r => r.status === s).length;
    const rated = list.filter(r => r.rating > 0);
    return {
      total: list.length, want: c('want'), reading: c('reading'), read: c('read'),
      avg: rated.length ? (rated.reduce((a, r) => a + r.rating, 0) / rated.length).toFixed(1) : '—'
    };
  },

  /* 某日的全部条目（含事件、日任务、以及落在当天的其他时间块） */
  dayItems(ds) {
    const list = this.db.tasks.filter(t => t.date === ds && t.level === 'day');
    const timed = list.filter(t => t.start).sort((a, b) => U.hm(a.start) - U.hm(b.start));
    const untimed = list.filter(t => !t.start);
    return { timed, untimed, all: list };
  },

  weekTasks(ws) { return this.db.tasks.filter(t => t.level === 'week' && U.weekStart(t.date) === ws); },
  monthTasks(mk) { return this.db.tasks.filter(t => t.level === 'month' && t.date.slice(0, 7) === mk); },

  overdue(ds) {
    return this.db.tasks.filter(t => t.level === 'day' && t.date < ds && t.status !== 'done')
      .sort((a, b) => a.date < b.date ? -1 : 1);
  },

  stats(list) {
    const total = list.length;
    const done = list.filter(t => t.status === 'done').length;
    return { total, done, pct: total ? Math.round(done / total * 100) : 0 };
  },

  /* 日统计：当天日任务 + 当天事件 */
  dayStats(ds) {
    const it = this.dayItems(ds);
    return this.stats(it.all);
  },

  /* 周统计：一周内的日任务 + 本周任务（周任务权重折算 1） */
  weekStats(ws) {
    const days = [];
    for (let i = 0; i < 7; i++) days.push(U.addDays(ws, i));
    const dayList = this.db.tasks.filter(t => t.level === 'day' && days.includes(t.date));
    const wk = this.weekTasks(ws);
    const s1 = this.stats(dayList), s2 = this.stats(wk);
    const total = s1.total + s2.total, done = s1.done + s2.done;
    return { total, done, pct: total ? Math.round(done / total * 100) : 0, day: s1, week: s2 };
  },

  monthStats(mk) {
    const from = U.monthStart(mk), to = U.monthEnd(mk);
    const dayList = this.db.tasks.filter(t => t.level === 'day' && t.date >= from && t.date <= to);
    const mo = this.monthTasks(mk);
    const s1 = this.stats(dayList), s2 = this.stats(mo);
    const total = s1.total + s2.total, done = s1.done + s2.done;
    return { total, done, pct: total ? Math.round(done / total * 100) : 0, day: s1, month: s2 };
  },

  /* 平均进度（进行中任务的进度均值） */
  avgProgress(list) {
    const act = list.filter(t => t.status !== 'done');
    if (!act.length) return 100;
    return Math.round(act.reduce((s, t) => s + (t.progress || 0), 0) / act.length);
  },

  /* 把指定日期之前的未完成日任务顺延到某日 */
  carryOver(toDate) {
    let n = 0;
    this.db.tasks.forEach(t => {
      if (t.level === 'day' && t.date < toDate && t.status !== 'done') {
        t.adjusted = '由 ' + U.fmtCN(t.date) + ' 顺延到 ' + U.fmtCN(toDate);
        t.date = toDate; t.updatedAt = Date.now();
        n++;
      }
    });
    if (n) this.save();
    return n;
  },

  exportJSON() {
    return JSON.stringify({ exportedAt: new Date().toISOString(), db: this.db }, null, 2);
  },

  importJSON(text) {
    const obj = JSON.parse(text);
    const db = obj.db || obj;
    if (!Array.isArray(db.tasks)) throw new Error('文件格式不正确：缺少 tasks');
    this.db = db;
    if (!this.db.settings) this.db.settings = { workingStart: '07:00', workingEnd: '23:00', theme: 'light' };
    if (!this.db.meta) this.db.meta = { lastBriefDate: '' };
    this.save();
  },

  allTags() {
    const set = new Set();
    this.db.tasks.forEach(t => (t.tags || []).forEach(g => set.add(g)));
    return [...set].sort();
  },

  /* ---------- 演示数据（相对今天生成） ---------- */
  _seedRefs() {
    return [
      { title: 'Attention Is All You Need', authors: 'Ashish Vaswani, Noam Shazeer, Niki Parmar', year: 2017, type: 'paper', venue: 'NeurIPS', url: 'https://arxiv.org/abs/1706.03762', tags: ['深度学习', 'Transformer'], status: 'read', rating: 5, readProgress: 100, readAt: Date.now() - 86400000 * 9, note: 'Transformer 原始论文，自注意力机制的开山之作。' },
      { title: 'Language Models are Few-Shot Learners', authors: 'Tom Brown, Benjamin Mann, Nick Ryder', year: 2020, type: 'paper', venue: 'NeurIPS', url: 'https://arxiv.org/abs/2005.14165', tags: ['大模型', '提示工程'], status: 'reading', rating: 4, readProgress: 60, note: 'GPT-3 论文，重点看 few-shot 评测部分。' },
      { title: 'Chain-of-Thought Prompting Elicits Reasoning in Large Language Models', authors: 'Jason Wei, Xuezhi Wang, Dale Schuurmans', year: 2022, type: 'paper', venue: 'NeurIPS', url: 'https://arxiv.org/abs/2201.11903', tags: ['提示工程', '推理'], status: 'want', rating: 0, readProgress: 0 },
      { title: 'GPT-4 Technical Report', authors: 'OpenAI', year: 2023, type: 'article', venue: 'arXiv', url: 'https://arxiv.org/abs/2303.08774', tags: ['大模型'], status: 'read', rating: 4, readProgress: 100, readAt: Date.now() - 86400000 * 20 },
      { title: '深度学习（Deep Learning）', authors: 'Ian Goodfellow, Yoshua Bengio, Aaron Courville', year: 2016, type: 'book', venue: '人民邮电出版社', tags: ['深度学习', '教材'], status: 'reading', rating: 5, readProgress: 30, note: '花书，配合课程视频一起看。' }
    ];
  },

  _seedDocs() {
    const ws = U.weekStart(U.todayStr());
    const we = U.weekEnd(U.todayStr());
    const wk = U.isoWeekNumber(ws);
    return [{
      title: '周报（示例）：可以怎么写',
      sub: `第 ${wk} 周 · ${U.fmtCN(ws)} ~ ${U.fmtCN(we)}`,
      type: 'week',
      content: `# 周报（示例）

> 这一页演示文档编辑器的能力：图片、公式、代码块都可以写。

## 一、本周进展
- 完成了 A 模块的开发与联调
- 实验准确率提升到 92.4%

## 二、关键指标
损失函数收敛情况（行内公式 $L = -\\sum_i y_i \\log \\hat{y}_i$），整体目标为：

$$J(\\theta) = \\frac{1}{2m}\\sum_{i=1}^{m}\\left(h_\\theta(x^{(i)}) - y^{(i)}\\right)^2 + \\lambda\\|\\theta\\|_2^2$$

## 三、核心代码片段

\`\`\`python
def evaluate(model, loader):
    model.eval()
    correct = sum((model(x).argmax(1) == y).sum().item() for x, y in loader)
    return correct / len(loader.dataset)
\`\`\`

## 四、下周计划
- [ ] 补充消融实验
- [ ] 整理图表写进月报
`
    }];
  },

  _seed() {
    const T = U.todayStr(), Y = U.addDays(T, -1), TM = U.addDays(T, 1);
    const WS = U.weekStart(T), MK = U.monthKey(T);
    const mk = p => ({ date: T, ...p });
    return {
      version: 1,
      meta: { lastBriefDate: '', seededAt: Date.now() },
      settings: { workingStart: '07:00', workingEnd: '23:00', theme: 'light' },
      refs: this._seedRefs(),
      docs: this._seedDocs(),
      tasks: [
        /* —— 今日固定日程 —— */
        mk({ kind: 'event', title: '每日晨会', start: '09:30', end: '10:00', fixed: true, note: '同步各组进展，腾讯会议' }),
        mk({ kind: 'event', title: '产品评审会', start: '14:00', end: '15:30', fixed: true, tags: ['产品'] }),
        /* —— 今日任务 —— */
        mk({ title: '编写季度总结报告', start: '10:00', end: '11:30', status: 'doing', progress: 35, priority: 'high', tags: ['文档'] }),
        mk({ title: '回复客户邮件', start: '11:30', end: '12:00', priority: 'low' }),
        mk({ title: '代码评审：登录模块重构', start: '16:00', end: '17:00', status: 'doing', progress: 60, tags: ['研发'] }),
        mk({ title: '整理晨会会议纪要', priority: 'mid' }),
        /* —— 昨日（含一条逾期） —— */
        { date: Y, title: '完成十月份数据报表', status: 'done', progress: 100, priority: 'mid' },
        { date: Y, title: '准备评审会材料', status: 'done', progress: 100, priority: 'high' },
        { date: Y, title: '修复线上登录偶发失败问题', status: 'todo', priority: 'high', tags: ['研发'] },
        /* —— 明日 —— */
        { date: TM, kind: 'event', title: '与设计团队对齐视觉稿', start: '10:00', end: '11:00', fixed: true },
        { date: TM, title: '更新项目排期表', priority: 'mid' },
        /* —— 本周任务 —— */
        { date: WS, level: 'week', title: '完成工作台原型设计', status: 'doing', progress: 45, priority: 'high', tags: ['设计'] },
        { date: WS, level: 'week', title: '整理客户需求清单', status: 'done', progress: 100, priority: 'mid' },
        { date: WS, level: 'week', title: '优化数据库查询性能', status: 'doing', progress: 20, priority: 'mid', tags: ['研发'] },
        { date: WS, level: 'week', title: '准备下周客户演示 PPT', status: 'todo', priority: 'high', tags: ['文档'] },
        /* —— 本月目标 —— */
        { date: MK + '-01', level: 'month', title: '完成 Q4 产品规划', status: 'doing', progress: 30, priority: 'high' },
        { date: MK + '-01', level: 'month', title: '发布版本 v2.1', status: 'doing', progress: 15, priority: 'mid', tags: ['研发'] },
        { date: MK + '-01', level: 'month', title: '推进团队招聘（2 名工程师）', status: 'doing', progress: 50, priority: 'low', tags: ['招聘'] }
      ]
    };
  }
};
