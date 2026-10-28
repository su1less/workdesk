/* ============================================================
 * md.js — Markdown 三大能力
 *  1. MD.inline  : 行内语法解析（快速添加 / 列表项元数据）
 *  2. MD.parse   : 计划文档解析 → 结构化任务
 *  3. MD.report  : 周报 / 月报自动生成
 *  4. MD.render  : Markdown → HTML 轻量渲染（报告预览）
 *
 * 行内语法约定：
 *   时间块   10:00-11:30
 *   日期     @2026-10-24 / @10-24 / 明天 / 周三 / 下周五 / 10月24日
 *   优先级   P0/P1/P2 · !高 !中 !低 · [高]（中）· !!!/!!/!
 *   进度     40% 或 进度:40
 *   时长     ~2h / 2小时 / 90分钟
 *   标签     #研发 #产品
 *   固定     [固定] （固定）
 *   类型     【日】【周】【月】
 * ============================================================ */

const MD = {

  /* ---------- 行内解析：从一段文本中抽取任务元数据 ---------- */
  inline(raw, ctx = {}) {
    let s = ' ' + raw + ' ';
    const out = { start: '', end: '', date: '', priority: '', progress: -1, tags: [], fixed: false, level: '', durMin: 0, done: false };

    /* 时间块 */
    let m = s.match(/(\d{1,2}:\d{2})\s*[-–—~～至到]\s*(\d{1,2}:\d{2})/);
    if (m) { out.start = m[1]; out.end = m[2]; s = s.replace(m[0], ' '); }

    /* 日期 */
    const today = U.todayStr();
    m = s.match(/@(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/);
    if (m) { out.date = MD.normDate(m[1]); s = s.replace(m[0], ' '); }
    if (!out.date) { m = s.match(/@(\d{1,2})[-/.](\d{1,2})/); if (m) { out.date = MD.normDate(m[1] + '-' + m[2]); s = s.replace(m[0], ' '); } }
    if (!out.date) { m = s.match(/下周([一二三四五六日天])/); if (m) { out.date = U.addDays(U.weekStart(today), 7 + '一二三四五六日天'.indexOf(m[1])); s = s.replace(m[0], ' '); } }
    if (!out.date) { m = s.match(/(?:周|星期)([一二三四五六日天])/); if (m) { out.date = U.addDays(U.weekStart(ctx.date || today), '一二三四五六日天'.indexOf(m[1])); s = s.replace(m[0], ' '); } }
    if (!out.date) { m = s.match(/(\d{1,2})月(\d{1,2})[日号]?/); if (m) { out.date = MD.normDate(m[1] + '-' + m[2]); s = s.replace(m[0], ' '); } }
    if (!out.date) {
      if (/今天|今日/.test(s)) { out.date = today; s = s.replace(/今天|今日/g, ' '); }
      else if (/明天|明日/.test(s)) { out.date = U.addDays(today, 1); s = s.replace(/明天|明日/g, ' '); }
      else if (/后天/.test(s)) { out.date = U.addDays(today, 2); s = s.replace(/后天/g, ' '); }
    }

    /* 优先级 */
    m = s.match(/\bp([012])\b/i);
    if (m) { out.priority = { 0: 'high', 1: 'mid', 2: 'low' }[m[1]]; s = s.replace(m[0], ' '); }
    if (!out.priority) { m = s.match(/[!！](高|重要|中|低)/); if (m) { out.priority = { 高: 'high', 重要: 'high', 中: 'mid', 低: 'low' }[m[1]]; s = s.replace(m[0], ' '); } }
    if (!out.priority) { m = s.match(/[!！]{3}/); if (m) { out.priority = 'high'; s = s.replace(m[0], ' '); } else { m = s.match(/[!！]{2}/); if (m) { out.priority = 'mid'; s = s.replace(m[0], ' '); } } }
    if (!out.priority) { m = s.match(/[\[【（(]\s*(高|重要|中|低)\s*[)）】\]]/); if (m) { out.priority = { 高: 'high', 重要: 'high', 中: 'mid', 低: 'low' }[m[1]]; s = s.replace(m[0], ' '); } }

    /* 固定 */
    if (/[\[【（(]?\s*固定\s*[\]）】)]?/.test(s)) { const fm = s.match(/[\[【（(]\s*固定\s*[\]）】)]/); if (fm) { out.fixed = true; s = s.replace(fm[0], ' '); } }

    /* 类型 */
    m = s.match(/【(日|周|月)】/);
    if (m) { out.level = { 日: 'day', 周: 'week', 月: 'month' }[m[1]]; s = s.replace(m[0], ' '); }

    /* 进度 */
    m = s.match(/进度\s*[:：]?\s*(\d{1,3})\s*%?/);
    if (m) { out.progress = Math.min(100, +m[1]); s = s.replace(m[0], ' '); }
    if (out.progress < 0) { m = s.match(/(\d{1,3})\s*%/); if (m) { out.progress = Math.min(100, +m[1]); s = s.replace(m[0], ' '); } }

    /* 时长 */
    m = s.match(/约?\s*(\d+(?:\.\d+)?)\s*个?小时(?![a-zA-Z])/); if (m) { out.durMin = Math.round(+m[1] * 60); s = s.replace(m[0], ' '); }
    if (!out.durMin) { m = s.match(/约?\s*(\d+)\s*分钟(?![a-zA-Z])/); if (m) { out.durMin = +m[1]; s = s.replace(m[0], ' '); } }
    if (!out.durMin) { m = s.match(/~\s*(\d+(?:\.\d+)?)\s*h\b/i); if (m) { out.durMin = Math.round(+m[1] * 60); s = s.replace(m[0], ' '); } }

    /* 标签 */
    let tm; const tagRe = /#([^\s#,，、；;]+)/g;
    while ((tm = tagRe.exec(s))) out.tags.push(tm[1]);
    s = s.replace(tagRe, ' ');

    /* 状态 */
    if (/已完成|已完成✔|✅/.test(s)) { out.done = true; s = s.replace(/已完成|✅/g, ' '); }

    out.title = s.replace(/\s+/g, ' ').replace(/^[\s:：\-–—、,，.·]+|[\s:：\-–—、,，.·]+$/g, '').trim();
    return out;
  },

  /* 短日期归一化：10-24 / 2026.10.24 → YYYY-MM-DD（无年份时取今年，过早则顺延下一年） */
  normDate(tok) {
    let y, m, d;
    const full = tok.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (full) { y = +full[1]; m = +full[2]; d = +full[3]; }
    else {
      const short = tok.match(/^(\d{1,2})[-/.](\d{1,2})$/);
      if (!short) return '';
      y = new Date().getFullYear(); m = +short[1]; d = +short[2];
    }
    if (m < 1 || m > 12 || d < 1 || d > 31) return '';
    let ds = y + '-' + U.pad(m) + '-' + U.pad(d);
    if (!full) {
      const t = U.todayStr();
      const diff = (U.parseDate(ds) - U.parseDate(t)) / 86400000;
      if (diff < -150) ds = (y + 1) + '-' + U.pad(m) + '-' + U.pad(d);
    }
    return ds;
  },

  /* ---------- 计划文档解析 ---------- */
  parse(text) {
    const lines = text.split(/\r?\n/);
    const res = { title: '', tasks: [], warnings: [] };
    const today = U.todayStr();
    let ctx = { level: 'day', date: today, tag: '', range: null, baseIndent: 0 };
    let lastTask = null, inCode = false, tableBuf = [];

    const flushTable = () => {
      if (!tableBuf.length) return;
      MD._parseTable(tableBuf, ctx, res);
      tableBuf = [];
    };
    /* 把当前 range 段落中没有明确日期的任务按顺序铺到日期区间 */
    const distribute = () => {
      if (!ctx.range) return;
      const [a, b] = ctx.range;
      const nDays = Math.round((U.parseDate(b) - U.parseDate(a)) / 86400000) + 1;
      const pend = res.tasks.filter(t => t._pendingRange === ctx.range[0]);
      pend.forEach((t, i) => {
        t.date = U.addDays(a, i % nDays);
        delete t._pendingRange;
      });
      if (pend.length) res.warnings.push('「' + U.fmtCN(a) + ' ~ ' + U.fmtCN(b) + '」区间内 ' + pend.length + ' 项任务已按顺序自动分配到各天');
    };

    for (const raw of lines) {
      const line = raw.replace(/\t/g, '  ').replace(/\s+$/, '');

      if (/^```/.test(line)) { inCode = !inCode; continue; }
      if (inCode) continue;

      /* 表格行缓冲 */
      if (/^\s*\|.*\|\s*$/.test(line)) { tableBuf.push(line.trim()); continue; }
      if (tableBuf.length) flushTable();

      /* 标题 */
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        distribute();
        const depth = h[1].length, txt = h[2].trim();
        if (depth === 1 && !res.title) { res.title = txt; continue; }
        ctx = MD._headingCtx(txt, ctx, today);
        lastTask = null;
        continue;
      }

      /* 列表项 */
      const li = line.match(/^(\s*)(?:[-*+]|\d+[.、])\s+(.+)$/);
      if (li) {
        const indent = li[1].length;
        let content = li[2].trim();
        const cb = content.match(/^\[( |x|X|✓|☑)\]\s*(.*)$/);
        let checked = false;
        if (cb) { checked = cb[1] !== ' '; content = cb[2].trim(); }
        /* 缩进更深 → 上一条任务的备注 */
        if (lastTask && indent >= ctx.baseIndent + 2) {
          const sm = content.match(/^\[( |x|X)\]\s*(.*)$/);
          const txt = sm ? sm[2].trim() : content;
          if (txt) lastTask.note = (lastTask.note ? lastTask.note + '\n' : '') + txt;
          continue;
        }
        ctx.baseIndent = indent;
        const p = MD.inline(content, ctx);
        const task = {
          title: p.title || '（未命名）',
          level: p.level || ctx.level,
          date: p.date || ctx.date,
          start: p.start, end: p.end,
          priority: p.priority || 'mid',
          progress: p.done ? 100 : (p.progress >= 0 ? p.progress : 0),
          status: p.done || checked ? 'done' : (p.progress > 0 ? 'doing' : 'todo'),
          tags: p.tags.concat(ctx.tag ? [ctx.tag] : []),
          fixed: p.fixed || p.start,
          note: '',
          source: res.title || '导入文档'
        };
        if (task.level === 'week') task.date = U.weekStart(task.date);
        if (task.level === 'month') task.date = task.date.slice(0, 7) + '-01';
        if (p.durMin && task.start && !task.end) task.end = U.minHM(U.hm(task.start) + p.durMin);
        if (!p.date && ctx.range && task.level === 'day') task._pendingRange = ctx.range[0];
        res.tasks.push(task);
        lastTask = task;
        if (/每天|每周|每月|每日/.test(content)) res.warnings.push('「' + p.title + '」疑似周期性任务，已按单次导入');
        continue;
      }
      /* 非列表的普通文本行（可能是清单符号 □ ☐） */
      const box = line.match(/^(\s*)[□☐☑✔✓×x]\s+(.+)$/);
      if (box) {
        const indent = box[1].length;
        if (lastTask && indent >= ctx.baseIndent + 2) { lastTask.note = (lastTask.note ? lastTask.note + '\n' : '') + box[2].trim(); continue; }
        ctx.baseIndent = indent;
        const p = MD.inline(box[2].trim(), ctx);
        const task = {
          title: p.title || '（未命名）', level: p.level || ctx.level, date: p.date || ctx.date,
          start: p.start, end: p.end, priority: p.priority || 'mid',
          progress: p.done ? 100 : (p.progress >= 0 ? p.progress : 0),
          status: p.done ? 'done' : (p.progress > 0 ? 'doing' : 'todo'),
          tags: p.tags.concat(ctx.tag ? [ctx.tag] : []), fixed: p.fixed || p.start, note: '',
          source: res.title || '导入文档'
        };
        if (task.level === 'week') task.date = U.weekStart(task.date);
        if (task.level === 'month') task.date = task.date.slice(0, 7) + '-01';
        res.tasks.push(task);
        lastTask = task;
        continue;
      }

      /* 普通段落文本：缩进时并入上一任务备注 */
      if (line.trim() && lastTask && /^ {2,}/.test(raw.replace(/\t/g, '  '))) {
        lastTask.note = (lastTask.note ? lastTask.note + '\n' : '') + line.trim();
      }
    }
    if (tableBuf.length) flushTable();
    distribute();

    res.tasks.forEach(t => { delete t._pendingRange; });
    if (!res.tasks.length) res.warnings.push('未解析到任何任务，请检查文档格式（支持 - [ ] 清单、|表格|、#标题 分区）');
    return res;
  },

  /* 标题 → 解析上下文（日期 / 类型 / 区间 / 分组标签） */
  _headingCtx(txt, prev, today) {
    const ctx = { level: prev.level, date: prev.date, tag: prev.tag, range: null, baseIndent: 0 };
    /* 抽取标题中的所有日期 */
    const ds = [];
    const re = /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})|(?<![\d.])(\d{1,2}[-/.]\d{1,2})(?![\d.])/g;
    let m;
    while ((m = re.exec(txt))) {
      const nd = MD.normDate(m[1] || m[2]);
      if (nd && !ds.includes(nd)) ds.push(nd);
    }
    if (ds.length >= 2) {
      ds.sort();
      ctx.range = [ds[0], ds[ds.length - 1]];
      ctx.date = ds[0];
      ctx.level = /月/.test(txt) ? 'month' : 'day';
    } else if (ds.length === 1) {
      ctx.date = ds[0];
      if (/周|week/i.test(txt)) { ctx.level = 'week'; ctx.date = U.weekStart(ds[0]); }
      else if (/月/.test(txt) && !/日|号/.test(txt)) { ctx.level = 'month'; ctx.date = ds[0].slice(0, 7) + '-01'; }
      else ctx.level = 'day';
    } else {
      const wm = txt.match(/下周/);
      if (/本月|月度|月计划|月目标|月总结/.test(txt)) { ctx.level = 'month'; ctx.date = U.monthKey(today) + '-01'; }
      else if (/本周|周计划|周报|周目标|每周|week/i.test(txt)) {
        ctx.level = 'week';
        ctx.date = U.weekStart(wm ? U.addDays(U.weekStart(today), 7) : today);
      }
      else if (/每日|今日|今天|今日安排|日常/.test(txt)) { ctx.level = 'day'; ctx.date = today; }
      else if (/明日|明天/.test(txt)) { ctx.level = 'day'; ctx.date = U.addDays(today, 1); }
      else if (/昨日|昨天/.test(txt)) { ctx.level = 'day'; ctx.date = U.addDays(today, -1); }
      else {
        /* 周几标题：### 周三 */
        const wd = txt.match(/(?:周|星期)([一二三四五六日天])/);
        if (wd && txt.length <= 8) {
          ctx.level = 'day';
          const base = /上周/.test(txt) ? U.addDays(U.weekStart(today), -7) : (/下周/.test(txt) ? U.addDays(U.weekStart(today), 7) : U.weekStart(today));
          ctx.date = U.addDays(base, '一二三四五六日天'.indexOf(wd[1]));
        } else {
          /* 普通分组标题：沿用外层日期，标题作为默认标签 */
          ctx.tag = txt.replace(/[【】\[\]]/g, '').slice(0, 10);
        }
      }
    }
    if (ctx.level === 'week') ctx.date = U.weekStart(ctx.date);
    if (ctx.level === 'month') ctx.date = ctx.date.slice(0, 7) + '-01';
    return ctx;
  },

  /* Markdown 表格 → 任务 */
  _parseTable(rows, ctx, res) {
    const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const head = cells(rows[0]);
    const keyIdx = {};
    head.forEach((h, i) => {
      if (/任务|事项|内容|标题|计划|工作/.test(h)) keyIdx.title = i;
      else if (/日期|时间|日程|安排/.test(h)) keyIdx.when = i;
      else if (/优先/.test(h)) keyIdx.pri = i;
      else if (/进度|完成/.test(h)) keyIdx.prog = i;
      else if (/状态/.test(h)) keyIdx.status = i;
      else if (/备注|说明|描述/.test(h)) keyIdx.note = i;
      else if (/类型|级别|周期/.test(h)) keyIdx.level = i;
    });
    if (keyIdx.title === undefined) return;
    rows.slice(1).forEach(r => {
      if (/^[\s|:-]+$/.test(r)) return;
      const c = cells(r);
      const title = keyIdx.title !== undefined ? c[keyIdx.title] : '';
      if (!title) return;
      const p = MD.inline(title, ctx);
      const task = {
        title: p.title || title,
        level: p.level || ctx.level, date: p.date || ctx.date,
        start: p.start, end: p.end, priority: p.priority || 'mid',
        progress: p.progress >= 0 ? p.progress : 0,
        status: p.done ? 'done' : (p.progress > 0 ? 'doing' : 'todo'),
        tags: p.tags.concat(ctx.tag ? [ctx.tag] : []),
        fixed: p.fixed || p.start, note: '', source: res.title || '导入文档'
      };
      if (keyIdx.when !== undefined && c[keyIdx.when]) {
        const w = String(c[keyIdx.when]);
        const dm = w.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/) || w.match(/(\d{1,2}[-/.]\d{1,2})/);
        if (dm) task.date = MD.normDate(dm[1]);
        const tm = w.match(/(\d{1,2}:\d{2})\s*[-–—~～至到]\s*(\d{1,2}:\d{2})/);
        if (tm) { task.start = tm[1]; task.end = tm[2]; }
      }
      if (keyIdx.pri !== undefined && c[keyIdx.pri]) {
        const v = String(c[keyIdx.pri]);
        task.priority = /高|急|P0/i.test(v) ? 'high' : /低|P2/i.test(v) ? 'low' : 'mid';
      }
      if (keyIdx.prog !== undefined && c[keyIdx.prog]) {
        const v = String(c[keyIdx.prog]).match(/(\d{1,3})/);
        if (v) { task.progress = Math.min(100, +v[1]); task.status = task.progress >= 100 ? 'done' : 'doing'; }
      }
      if (keyIdx.status !== undefined && c[keyIdx.status]) {
        if (/完成|✓|✔|是|done/i.test(String(c[keyIdx.status]))) { task.status = 'done'; task.progress = 100; }
        else if (/进行|doing/i.test(String(c[keyIdx.status]))) { task.status = 'doing'; if (!task.progress) task.progress = 30; }
      }
      if (keyIdx.note !== undefined && c[keyIdx.note]) task.note = String(c[keyIdx.note]);
      if (keyIdx.level !== undefined && c[keyIdx.level]) {
        const v = String(c[keyIdx.level]);
        task.level = /周/.test(v) ? 'week' : /月/.test(v) ? 'month' : 'day';
      }
      if (task.level === 'week') task.date = U.weekStart(task.date);
      if (task.level === 'month') task.date = task.date.slice(0, 7) + '-01';
      res.tasks.push(task);
    });
  },

  /* ---------- 报告生成 ---------- */
  bar(pct) { const n = Math.round(pct / 10); return '█'.repeat(n) + '░'.repeat(10 - n); },

  report(type, anchor) {
    let from, to, periodTasks, periodLabel, nextLabel, nextTasks;
    if (type === 'week') {
      from = U.weekStart(anchor); to = U.weekEnd(anchor);
      periodTasks = Store.weekTasks(from);
      periodLabel = '周任务'; nextLabel = '下周';
      const nw = U.addDays(from, 7);
      nextTasks = Store.weekTasks(nw);
    } else {
      const mk = U.monthKey(anchor);
      from = U.monthStart(mk); to = U.monthEnd(mk);
      periodTasks = Store.monthTasks(mk);
      periodLabel = '月目标'; nextLabel = '下月';
      const nmk = U.addMonths(mk, 1);
      nextTasks = Store.monthTasks(nmk);
    }
    const dayList = Store.tasks().filter(t => t.level === 'day' && t.date >= from && t.date <= to);
    const sDay = Store.stats(dayList), sPer = Store.stats(periodTasks);
    const total = sDay.total + sPer.total, done = sDay.done + sPer.done;
    const pct = total ? Math.round(done / total * 100) : 0;
    const doings = dayList.concat(periodTasks).filter(t => t.status === 'doing');
    const todos = dayList.concat(periodTasks).filter(t => t.status === 'todo');
    const suddens = Store.tasks().filter(t => t.sudden && t.date >= from && t.date <= to);
    const avg = Store.avgProgress(dayList.concat(periodTasks));
    const rangeStr = U.fmtFull(from) + (from !== to ? ' ~ ' + U.fmtFull(to) : '');
    const now = new Date();
    const genTime = U.pad(now.getHours()) + ':' + U.pad(now.getMinutes());

    let md = '';
    md += '# ' + (type === 'week' ? '工作周报' : '工作月报') + ' · ' + rangeStr + '\n\n';
    md += '> 由工作台自动生成 · ' + U.fmtFull(U.todayStr()) + ' ' + genTime + '\n\n';

    md += '## 一、总体概览\n\n';
    md += '- 综合完成率：**' + pct + '%**（已完成 ' + done + ' / 共 ' + total + ' 项）\n';
    md += '- 日程任务：' + sDay.done + '/' + sDay.total + (sDay.total ? '（' + Math.round(sDay.done / sDay.total * 100) + '%）' : '') + '\n';
    if (sPer.total) md += '- ' + periodLabel + '：' + sPer.done + '/' + sPer.total + '（' + Math.round(sPer.done / sPer.total * 100) + '%）\n';
    if (doings.length) md += '- 进行中平均进度：' + avg + '%\n';
    md += '- 突发日程：' + suddens.length + ' 项\n\n';

    const doneList = dayList.concat(periodTasks).filter(t => t.status === 'done')
      .sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0));
    md += '## 二、已完成（' + doneList.length + '）\n\n';
    doneList.forEach(t => { md += '- [x] ' + t.title + '（' + U.fmtCN(t.date) + '）\n'; });
    if (!doneList.length) md += '- 暂无\n';
    md += '\n';

    md += '## 三、进行中（' + doings.length + '）\n\n';
    doings.sort((a, b) => b.priority.localeCompare(a.priority)).forEach(t => {
      md += '- ' + t.title + ' `' + MD.bar(t.progress) + ' ' + t.progress + '%`' + (t.due ? ' · 截止 ' + U.fmtCN(t.due) : '') + '\n';
    });
    if (!doings.length) md += '- 暂无\n';
    md += '\n';

    md += '## 四、待办 / 延期（' + todos.length + '）\n\n';
    todos.sort((a, b) => a.date < b.date ? -1 : 1).forEach(t => {
      const late = t.date < U.todayStr() ? ' ⚠️已延期' : '';
      md += '- [ ] ' + t.title + '（' + U.fmtCN(t.date) + ' · ' + { high: '高', mid: '中', low: '低' }[t.priority] + '优先级' + late + '）\n';
    });
    if (!todos.length) md += '- 暂无\n';
    md += '\n';

    md += '## 五、突发日程记录（' + suddens.length + '）\n\n';
    suddens.forEach(t => {
      md += '- **' + t.title + '** · ' + U.fmtCN(t.date) + ' ' + (t.start || '') + (t.end ? '-' + t.end : '') + '\n';
      const moved = Store.tasks().filter(x => x.adjusted && x.adjusted.includes(t.title));
      moved.forEach(x => { md += '  - 影响：' + x.title + ' → ' + U.fmtCN(x.date) + ' ' + (x.start || '') + '\n'; });
    });
    if (!suddens.length) md += '- 本期无突发日程\n';
    md += '\n';

    const nextCarry = todos.filter(t => t.date < U.todayStr()).slice(0, 10);
    /* 文献阅读章节（有文献库时才输出） */
    const refList = Store.db.refs || [];
    let secNo = 6;
    if (refList.length) {
      const readRefs = refList.filter(r => {
        if (!r.readAt) return false;
        const ds = U.dateStr(new Date(r.readAt));
        return ds >= from && ds <= to;
      });
      const readingRefs = refList.filter(r => r.status === 'reading');
      md += '## 六、文献阅读\n\n';
      if (readRefs.length) readRefs.forEach(r => {
        md += '- 《' + r.title + '》' + (r.rating ? ' ' + MD.bar(r.rating * 20) + ' ' + r.rating + '/5★' : '') + (r.authors ? '（' + r.authors.split(',')[0] + ' 等，' + (r.year || '') + '）' : '') + '\n';
      });
      if (readingRefs.length) {
        if (readRefs.length) md += '\n**正在读**\n\n';
        readingRefs.forEach(r => { md += '- 《' + r.title + '》 `' + MD.bar(r.readProgress || 0) + ' ' + (r.readProgress || 0) + '%`\n'; });
      }
      if (!readRefs.length && !readingRefs.length) md += '- 本期无文献阅读记录\n';
      md += '\n';
      secNo = 7;
    }
    md += '## ' + '一二三四五六七'[secNo - 1] + '、' + nextLabel + '安排\n\n';
    nextTasks.forEach(t => { md += '- [ ] ' + t.title + '\n'; });
    if (nextCarry.length) { md += '\n**需要顺延到' + nextLabel + '的事项**\n\n'; nextCarry.forEach(t => { md += '- ' + t.title + '（本期未完成）\n'; }); }
    if (!nextTasks.length && !nextCarry.length) md += '- 暂无，可导入新的计划文档或手动添加\n';

    return md;
  },

  /* ---------- Markdown 轻量渲染（报告预览） ---------- */
  render(src) {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = s => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    const lines = src.split('\n');
    let html = '', inList = false, para = [];
    const flushP = () => { if (para.length) { html += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } };
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (const line of lines) {
      const t = line.trim();
      if (!t) { flushP(); closeList(); continue; }
      let m;
      if ((m = t.match(/^(#{1,4})\s+(.*)$/))) { flushP(); closeList(); html += '<h' + (m[1].length + 1) + '>' + inline(m[2]) + '</h' + (m[1].length + 1) + '>'; continue; }
      if (/^(---|\*\*\*)$/.test(t)) { flushP(); closeList(); html += '<hr>'; continue; }
      if ((m = t.match(/^&gt;\s?(.*)$/)) || (m = t.match(/^>\s?(.*)$/))) { flushP(); closeList(); html += '<blockquote>' + inline(m[1]) + '</blockquote>'; continue; }
      if ((m = t.match(/^[-*+]\s+(.*)$/))) { flushP(); if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(m[1].replace(/^\[( |x|X)\]\s*/, (_, c) => c.trim() ? '✔ ' : '○ ')) + '</li>'; continue; }
      if (/^(\s{2,})[-*+]\s+/.test(line)) { html += '<li style="margin-left:18px">' + inline(line.trim().replace(/^[-*+]\s+/, '')) + '</li>'; continue; }
      para.push(t);
    }
    flushP(); closeList();
    return html;
  }
};
