/* ============================================================
 * app.js — 应用入口 / 状态 / 路由 / 事件交互
 * 全局命名空间：App
 * ============================================================ */

const App = {

  state: {
    view: 'dashboard',
    day: U.todayStr(),
    week: U.weekStart(U.todayStr()),
    month: U.monthKey(U.todayStr()),
    lib: { q: '', level: '', status: '', tag: '' },
    refs: { q: '', status: '', type: '', tag: '', sort: 'added' },
    docs: { filter: 'all', mode: 'list', editing: null, tab: 'edit' },
    report: { type: 'week', anchor: U.todayStr(), md: null, tab: 'preview' },
    import: null
  },

  /* ---------- 启动 ---------- */
  init() {
    Store.load();
    this.applyTheme();
    this.bindEvents();
    /* 网页门禁（静态部署可在设置中开启）→ 通过后再展示界面 */
    Gate.init().then(() => {
      this.render();
      /* 云端同步（检测到后端时启用登录与同步），数据就绪后再弹晨报 */
      Sync.init().then(() => this.maybeBriefing());
    });
    /* 今日视图每分钟刷新（当前时间线） */
    setInterval(() => {
      if (this.state.view === 'today' && this.state.day === U.todayStr()) this.render();
    }, 60000);
  },

  applyTheme() {
    const th = Store.db.settings.theme || 'light';
    document.documentElement.dataset.theme = th;
    const lb = document.getElementById('themeLabel');
    if (lb) lb.textContent = th === 'dark' ? '浅色模式' : '深色模式';
  },

  /* ---------- 渲染 ---------- */
  render() {
    const s = this.state;
    document.querySelectorAll('.nav-item[data-nav], .tab-item[data-nav]').forEach(b =>
      b.classList.toggle('active', b.dataset.nav === s.view));
    const map = {
      dashboard: UI.dashboard, today: UI.today, week: UI.week, month: UI.month,
      library: UI.library, refs: UI.refsView, reports: UI.reports, docs: UI.docsView, import: UI.importView
    };
    document.getElementById('view').innerHTML = map[s.view].call(UI);
    /* 文档编辑器：渲染预览 + 公式排版 */
    if (s.view === 'docs' && s.docs.mode === 'edit') this.renderDocPreview();
    const subs = {
      dashboard: ['仪表盘', '总览今日安排、进度与延期事项'],
      today: ['今日', U.fmtFull(s.day) + ' ' + U.fmtWeekCN(s.day) + (s.day === U.todayStr() ? ' · 今天' : '')],
      week: ['本周', U.fmtCN(s.week) + ' ~ ' + U.fmtCN(U.weekEnd(s.week)) + ' · 第 ' + U.isoWeekNumber(s.week) + ' 周'],
      month: ['本月', s.month.replace('-', ' 年 ') + ' 月'],
      library: ['任务库', '全部任务的检索与管理'],
      refs: ['文献管理', '文献阅读追踪与 BibTeX 导入导出'],
      docs: ['周报月报', 'Markdown 文档写作：支持图片、LaTeX 公式、代码块'],
      reports: ['进度报告', '周报 / 月报自动生成，支持导出 Markdown'],
      import: ['导入计划', '解析 Markdown 计划文档，一键生成任务与进度安排']
    };
    document.getElementById('viewTitle').textContent = subs[s.view][0];
    document.getElementById('viewSub').textContent = Store.readOnly
      ? '👁 访客只读模式 · 数据自动刷新'
      : subs[s.view][1];
  },

  go(v) { this.state.view = v; this.render(); },

  /* ---------- 事件绑定 ---------- */
  bindEvents() {
    document.querySelectorAll('[data-nav]').forEach(b =>
      b.addEventListener('click', () => this.go(b.dataset.nav)));

    /* 点击委托 */
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const act = el.dataset.act;
      if (act === 'modal-mask' && e.target !== el) return;   /* 只点遮罩本身才关闭 */
      this.handle(act, el, e);
    });

    /* change 委托（下拉 / 日期 / 文件） */
    document.addEventListener('change', e => {
      const el = e.target.closest('[data-act-change]');
      if (el) { this.handleChange(el.dataset.actChange, el, e); return; }
      /* 导入表格行内编辑 */
      const imp = e.target.closest('[data-f]');
      if (imp && this.state.import) {
        const i = +imp.dataset.i, f = imp.dataset.f;
        if (f === 'progress') this.state.import.tasks[i][f] = Math.max(0, Math.min(100, +imp.value || 0));
        else this.state.import.tasks[i][f] = imp.value;
        return;
      }
      if (e.target.classList.contains('imp-ck')) {
        const cnt = document.querySelectorAll('.imp-ck:checked').length;
        const c = document.getElementById('impCount');
        if (c) c.textContent = cnt;
      }
    });

    /* input 委托（搜索框 / 进度滑块 / 报告源码） */
    document.addEventListener('input', e => {
      const el = e.target.closest('[data-act-input]');
      if (!el) return;
      const k = el.dataset.actInput;
      if (k === 'tProgress') {
        const v = document.getElementById('tProgVal');
        if (v) v.textContent = el.value + '%';
      } else if (k === 'rProg') {
        const v = document.getElementById('rProgVal');
        if (v) v.textContent = el.value + '%';
      } else if (k === 'doc-ta') {
        this.docAutosave('content', el.value);
        clearTimeout(this._docPvTimer);
        this._docPvTimer = setTimeout(() => this.renderDocPreview(), 350);
      } else if (k === 'doc-title') {
        this.docAutosave('title', el.value.trim() || '未命名文档');
      } else if (k === 'doc-sub') {
        this.docAutosave('sub', el.value.trim());
      } else if (k === 'ref-q') {
        this.state.refs.q = el.value;
        clearTimeout(this._rTimer);
        this._rTimer = setTimeout(() => {
          this.render();
          const inp = document.querySelector('[data-act-input="ref-q"]');
          if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
        }, 240);
      } else if (k === 'lib-q') {
        this.state.lib.q = el.value;
        clearTimeout(this._qTimer);
        this._qTimer = setTimeout(() => {
          this.render();
          const inp = document.querySelector('[data-act-input="lib-q"]');
          if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
        }, 240);
      } else if (k === 'rep-src') {
        this.state.report.md = el.value;
      }
    });

    /* 快速添加回车 */
    document.getElementById('quickInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.quickAdd(e.target);
    });

    /* Esc 关闭弹窗 */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') UI.closeModal();
    });

    /* 导入文件拖拽 */
    document.addEventListener('dragover', e => {
      const z = e.target.closest && e.target.closest('.imp-file');
      if (z) { e.preventDefault(); z.classList.add('drag'); }
    });
    document.addEventListener('dragleave', e => {
      const z = e.target.closest && e.target.closest('.imp-file');
      if (z) z.classList.remove('drag');
    });
    document.addEventListener('drop', e => {
      const z = e.target.closest && e.target.closest('.imp-file');
      if (!z) return;
      e.preventDefault();
      z.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f) this.readImportFile(f);
    });
  },

  handleChange(act, el) {
    const s = this.state;
    switch (act) {
      case 'day-goto': if (el.value) { s.day = el.value; this.render(); } break;
      case 'lib-level': s.lib.level = el.value; this.render(); break;
      case 'lib-status': s.lib.status = el.value; this.render(); break;
      case 'lib-tag': s.lib.tag = el.value; this.render(); break;
      case 'ref-status': s.refs.status = el.value; this.render(); break;
      case 'ref-type': s.refs.type = el.value; this.render(); break;
      case 'ref-tag': s.refs.tag = el.value; this.render(); break;
      case 'ref-sort': s.refs.sort = el.value; this.render(); break;
      case 'doc-type': this._docPatch({ type: el.value }); this.render(); break;
      case 'doc-img-file': {
        const f = el.files[0];
        if (f) this.docInsertImage(f);
        el.value = '';
        break;
      }
      case 'bib-file': {
        const f = el.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          const ta = document.getElementById('bibText');
          if (ta) ta.value = rd.result;
          Refs._imp = Refs.parseBibtex(rd.result);
          UI.refImportModal();
          UI.toast(Refs._imp.refs.length ? '已读取「' + f.name + '」，解析到 ' + Refs._imp.refs.length + ' 篇文献' : '未解析到有效条目', Refs._imp.refs.length ? 'ok' : 'warn');
        };
        rd.readAsText(f, 'utf-8');
        break;
      }
      case 'imp-file-input': if (el.files[0]) this.readImportFile(el.files[0]); break;
      case 'set-file': {
        const f = el.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          try {
            Store.importJSON(r.result);
            this.applyTheme(); UI.closeModal(); this.render();
            UI.toast('数据已恢复（共 ' + Store.tasks().length + ' 条）');
          } catch (err) { UI.toast('导入失败：' + err.message, 'err'); }
        };
        r.readAsText(f);
        break;
      }
      case 'set-hours': {
        const st = Store.db.settings;
        st.workingStart = document.getElementById('wStart').value || '07:00';
        st.workingEnd = document.getElementById('wEnd').value || '23:00';
        if (U.hm(st.workingStart) >= U.hm(st.workingEnd)) {
          UI.toast('工作时段开始必须早于结束', 'warn');
          st.workingStart = '07:00'; st.workingEnd = '23:00';
        }
        Store.save();
        break;
      }
    }
  },

  /* ---------- 动作分发 ---------- */
  handle(act, el, e) {
    /* 访客只读模式：拦截所有修改类操作 */
    if (Store.readOnly && App.RO_BLOCK.has(act)) {
      e && e.preventDefault && e.preventDefault();
      UI.toast('🔗 访客只读模式：仅可查看，不能修改', 'warn');
      return;
    }
    const s = this.state;
    switch (act) {
      /* --- 通用 --- */
      case 'go': if (document.querySelector('#modalRoot .modal-mask')) UI.closeModal(); this.go(el.dataset.v); break;
      case 'open-more': {
        UI.modal({
          title: '更多',
          body: `<div class="more-list">
            <button data-act="go" data-v="library"><span class="mi-icon">🗂️</span>任务库</button>
            <button data-act="go" data-v="refs"><span class="mi-icon">📚</span>文献管理</button>
            <button data-act="go" data-v="reports"><span class="mi-icon">📄</span>进度报告</button>
            <button data-act="go" data-v="docs"><span class="mi-icon">📝</span>周报月报</button>
            <button data-act="go" data-v="import"><span class="mi-icon">📥</span>导入计划</button>
            <button data-act="open-settings"><span class="mi-icon">⚙️</span>设置</button>
            <button data-act="toggle-theme"><span class="mi-icon">🌙</span>深色 / 浅色切换</button>
          </div>`
        });
        break;
      }
      case 'close-modal': UI.closeModal(); break;
      case 'modal-mask':
        if (UI._cfResolve) { UI._cfResolve(false); UI._cfResolve = null; }
        UI.closeModal(); break;
      case 'cf-yes': if (UI._cfResolve) { UI._cfResolve(true); UI._cfResolve = null; } UI.closeModal(); break;
      case 'cf-no': if (UI._cfResolve) { UI._cfResolve(false); UI._cfResolve = null; } UI.closeModal(); break;
      case 'toggle-theme': {
        Store.db.settings.theme = Store.db.settings.theme === 'dark' ? 'light' : 'dark';
        Store.save(); this.applyTheme();
        UI.closeModal();
        break;
      }

      /* --- 任务 --- */
      case 'open-task': this.taskModal(el.dataset.id); break;
      case 'toggle-task': {
        e.stopPropagation();
        const t = Store.get(el.dataset.id);
        if (!t) break;
        Store.updateTask(t.id, { status: t.status === 'done' ? ((t.progress || 0) > 0 && t.progress < 100 ? 'doing' : 'todo') : 'done' });
        UI.toast(t.status === 'done' ? '已标记完成 🎉' : '已恢复进行');
        this.render();
        break;
      }
      case 'day-shift': s.day = el.dataset.v === '0' ? U.todayStr() : U.addDays(s.day, +el.dataset.v); this.render(); break;
      case 'week-shift': s.week = el.dataset.v === '0' ? U.weekStart(U.todayStr()) : U.addDays(s.week, 7 * +el.dataset.v); this.render(); break;
      case 'month-shift': s.month = el.dataset.v === '0' ? U.monthKey(U.todayStr()) : U.addMonths(s.month, +el.dataset.v); this.render(); break;
      case 'goto-day': s.day = el.dataset.date; this.go('today'); break;
      case 'add-task-on': this.taskModal(null, { date: el.dataset.date }); break;
      case 'add-task-new': this.taskModal(null, {}); break;
      case 'add-week-task': this.taskModal(null, { level: 'week', date: s.week }); break;
      case 'add-month-task': this.taskModal(null, { level: 'month', date: s.month + '-01' }); break;
      case 'carry-over': {
        const n = Store.carryOver(U.todayStr());
        UI.toast(n ? '已顺延 ' + n + ' 项任务到今天' : '没有需要顺延的任务', n ? 'ok' : 'warn');
        this.render(); break;
      }

      /* --- 任务编辑弹窗内的分段按钮 --- */
      case 'seg': {
        const seg = el.closest('.seg');
        seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === el));
        break;
      }
      case 't-save': this.saveTask(el.dataset.id); break;
      case 't-delete': {
        UI.confirm('确定删除这条任务吗？删除后无法恢复。', { danger: true, okText: '删除' }).then(ok => {
          if (ok) { Store.deleteTask(el.dataset.id); UI.closeModal(); UI.toast('已删除'); this.render(); }
        });
        break;
      }

      /* --- 晨报 --- */
      case 'briefing': this.briefing(); break;
      case 'brief-task': UI.closeModal(); this.taskModal(el.dataset.id); break;
      case 'brief-carry': {
        const n = Store.carryOver(U.todayStr());
        UI.toast(n ? '已顺延 ' + n + ' 项到今天' : '没有需要顺延的任务');
        this.briefing();
        break;
      }

      /* --- 突发日程 --- */
      case 'open-sudden': this.suddenModal(); break;
      case 'sud-submit': this.submitSudden(); break;
      case 'adj-apply': {
        const p = this._pendingSudden;
        if (p) { Scheduler.apply(p.evt, p.plan.moves); UI.toast('已加入突发日程，并自动调整 ' + p.plan.moves.filter(m => !m.failed).length + ' 项任务'); }
        this._pendingSudden = null; UI.closeModal();
        s.day = p ? p.evt.date : s.day; this.go('today');
        break;
      }
      case 'adj-only': {
        const p = this._pendingSudden;
        if (p) { Store.addTask(Object.assign({}, p.evt, { kind: 'event', sudden: true, fixed: true, level: 'day' })); UI.toast('已加入突发日程（未调整其他任务）'); }
        this._pendingSudden = null; UI.closeModal();
        s.day = p ? p.evt.date : s.day; this.go('today');
        break;
      }
      case 'adj-back': this.suddenModal(true); break;

      /* --- 导入 --- */
      case 'imp-file': document.getElementById('impFile').click(); break;
      case 'imp-parse': {
        const txt = document.getElementById('impText').value.trim();
        if (!txt) { UI.toast('请先粘贴或选择 Markdown 文档', 'warn'); break; }
        s.import = MD.parse(txt);
        this.render();
        UI.toast('解析到 ' + s.import.tasks.length + ' 项任务，请确认后导入');
        break;
      }
      case 'imp-clear': s.import = null; this.render(); break;
      case 'imp-do': {
        const imp = s.import;
        if (!imp) break;
        const rows = document.querySelectorAll('.imp-ck:checked');
        let n = 0;
        rows.forEach(ck => {
          const i = +ck.dataset.i;
          const base = imp.tasks[i];
          const patch = {
            title: base.title, level: base.level, date: base.date,
            start: base.start || '', end: base.end || '',
            priority: base.priority, progress: base.progress || 0,
            status: base.status || (base.progress >= 100 ? 'done' : 'todo'),
            tags: base.tags || [], fixed: !!base.fixed, note: base.note || '',
            source: imp.title || '导入文档', kind: 'task'
          };
          /* 从表格读取用户修改后的值 */
          document.querySelectorAll(`[data-f][data-i="${i}"]`).forEach(inp => {
            const f = inp.dataset.f;
            if (f === 'progress') patch[f] = Math.max(0, Math.min(100, +inp.value || 0));
            else patch[f] = inp.value;
          });
          if (patch.level === 'week') patch.date = U.weekStart(patch.date);
          if (patch.level === 'month') patch.date = patch.date.slice(0, 7) + '-01';
          if (!patch.title.trim()) return;
          Store.addTask(patch); n++;
        });
        s.import = null;
        UI.toast('成功导入 ' + n + ' 项任务 🎉');
        this.go('today');
        break;
      }

      /* --- 文献管理 --- */
      case 'open-ref': UI.refModal(el.dataset.id); break;
      case 'ref-new': UI.refModal(null); break;
      case 'ref-save': this.saveRef(el.dataset.id); break;
      case 'ref-delete': {
        UI.confirm('确定删除这篇文献吗？关联的阅读任务不会删除。', { danger: true, okText: '删除' }).then(ok => {
          if (ok) { Store.deleteRef(el.dataset.id); UI.closeModal(); UI.toast('已删除'); this.render(); }
        });
        break;
      }
      case 'ref-cycle': {
        const r = Store.getRef(el.dataset.id);
        if (!r) break;
        const NEXTS = { want: 'reading', reading: 'read', read: 'want' };
        const ns = NEXTS[r.status] || 'reading';
        Store.updateRef(r.id, { status: ns });
        UI.toast('已标记为「' + Refs.ST[ns].l + '」' + (ns === 'read' ? ' 🎉' : ''));
        this.render();
        break;
      }
      case 'ref-task': {
        const r = Store.getRef(el.dataset.id);
        const t = Refs.taskFromRef(el.dataset.id, el.dataset.when);
        if (t) UI.toast('已加入' + (el.dataset.when === 'week' ? '本周阅读计划' : '今日阅读任务') + '：' + t.title);
        this.render();
        break;
      }
      case 'ref-import': Refs._imp = null; UI.refImportModal(); break;
      case 'bib-file-click': {
        const fi = document.getElementById('bibFile');
        if (fi) fi.click();
        break;
      }
      case 'bib-parse': {
        const txt = document.getElementById('bibText').value.trim();
        if (!txt) { UI.toast('请先粘贴或选择 BibTeX 内容', 'warn'); break; }
        Refs._imp = Refs.parseBibtex(txt);
        UI.refImportModal();
        UI.toast(Refs._imp.refs.length ? '解析到 ' + Refs._imp.refs.length + ' 篇文献，请确认后导入' : '未解析到有效条目', Refs._imp.refs.length ? 'ok' : 'warn');
        break;
      }
      case 'bib-clear': Refs._imp = null; UI.refImportModal(); break;
      case 'bib-do': {
        const imp = Refs._imp;
        if (!imp) break;
        let n = 0;
        document.querySelectorAll('#modalRoot .imp-ck:checked').forEach(ck => {
          const i = +ck.dataset.i;
          const patch = Object.assign({}, imp.refs[i]);
          document.querySelectorAll('#modalRoot [data-f][data-i="' + i + '"]').forEach(inp => {
            if (inp.dataset.f === 'year') patch.year = +inp.value || null;
            else patch[inp.dataset.f] = inp.value;
          });
          if (!patch.title || !patch.title.trim()) return;
          Store.addRef(patch); n++;
        });
        Refs._imp = null;
        UI.closeModal();
        UI.toast('成功导入 ' + n + ' 篇文献 📚');
        this.render();
        break;
      }
      case 'ref-export': {
        const list = Store.db.refs || [];
        if (!list.length) { UI.toast('文献库为空，无内容可导出', 'warn'); break; }
        this.download('文献库_' + U.todayStr() + '.bib', Refs.toBibtex(list));
        UI.toast('已导出 ' + list.length + ' 篇（.bib）');
        break;
      }
      case 'ref-star': {
        const v = +el.dataset.v;
        const row = document.getElementById('rStars');
        if (!row) break;
        const clicked = row.querySelectorAll('.star');
        clicked.forEach(b => b.classList.toggle('on', +b.dataset.v <= v));
        break;
      }

      /* --- 周报月报（文档写作） --- */
      case 'doc-filter': s.docs.filter = el.dataset.v; s.docs.mode = 'list'; this.render(); break;
      case 'doc-new': {
        const type = el.dataset.v || 'week';
        let title, sub;
        const t = U.todayStr();
        if (type === 'week') {
          const ws = U.weekStart(t);
          title = '周报 · 第 ' + U.isoWeekNumber(ws) + ' 周';
          sub = U.fmtCN(ws) + ' ~ ' + U.fmtCN(U.weekEnd(ws));
        } else if (type === 'month') {
          title = t.slice(0, 7).replace('-', '年') + '月报';
          sub = '';
        } else { title = '新建文档'; sub = ''; }
        const d = Store.addDoc({ type, title, sub, content: '# ' + title + '\n\n## 一、\n\n## 二、\n\n## 三、\n' });
        s.docs.editing = d.id; s.docs.mode = 'edit'; s.docs.tab = 'edit';
        this.render();
        const ti = document.getElementById('docTa');
        if (ti) { ti.focus(); ti.setSelectionRange(ti.value.length, ti.value.length); }
        break;
      }
      case 'doc-open': s.docs.editing = el.dataset.id; s.docs.mode = 'edit'; s.docs.tab = 'edit'; this.render(); break;
      case 'doc-back': this.docSaveNow(); s.docs.mode = 'list'; this.render(); break;
      case 'doc-tab': s.docs.tab = el.dataset.v; this.docSaveNow(); this.render(); break;
      case 'doc-del': {
        UI.confirm('确定删除这篇文档吗？无法恢复。', { danger: true, okText: '删除' }).then(ok => {
          if (ok) {
            this.docSaveNow();
            Store.deleteDoc(s.docs.editing);
            s.docs.mode = 'list';
            UI.toast('文档已删除');
            this.render();
          }
        });
        break;
      }
      case 'doc-ins': {
        if (el.dataset.b === '' && el.dataset.a === '' && el.dataset.p === '') { this.docPickImage(); break; }
        this.docInsert(el.dataset.b, el.dataset.a, el.dataset.p);
        break;
      }
      case 'rep-todoc': {
        const md = s.report.md || MD.report(s.report.type, s.report.anchor);
        const range = s.report.type === 'week'
          ? U.fmtCN(U.weekStart(s.report.anchor)) + ' ~ ' + U.fmtCN(U.weekEnd(s.report.anchor))
          : s.report.anchor.slice(0, 7).replace('-', '年') + '月';
        Store.addDoc({
          type: s.report.type,
          title: (s.report.type === 'week' ? '周报（自动汇总）· 第 ' + U.isoWeekNumber(U.weekStart(s.report.anchor)) + ' 周'
            : '月报（自动汇总）· ' + s.report.anchor.slice(0, 7).replace('-', '年') + '月'),
          sub: range, content: md
        });
        UI.toast('已存为可编辑文档，可在此基础上补充图片与公式');
        s.docs.mode = 'list';
        this.go('docs');
        break;
      }

      /* --- 报告 --- */
      case 'rep-type': s.report.type = el.dataset.v; s.report.md = null; this.render(); break;
      case 'rep-shift': {
        if (s.report.type === 'week') s.report.anchor = U.addDays(s.report.anchor, 7 * +el.dataset.v);
        else s.report.anchor = U.addMonths(U.monthKey(s.report.anchor), +el.dataset.v) + '-01';
        s.report.md = null; this.render();
        break;
      }
      case 'rep-gen': s.report.md = MD.report(s.report.type, s.report.anchor); s.report.tab = 'preview'; this.render(); UI.toast('报告已生成'); break;
      case 'rep-tab': s.report.tab = el.dataset.v; this.render(); break;
      case 'rep-copy': {
        const md = s.report.md || MD.report(s.report.type, s.report.anchor);
        s.report.md = md;
        this.copyText(md).then(() => UI.toast('已复制到剪贴板'));
        break;
      }
      case 'rep-download': {
        const md = s.report.md || MD.report(s.report.type, s.report.anchor);
        s.report.md = md;
        const name = s.report.type === 'week'
          ? '周报_' + U.weekStart(s.report.anchor) + '_' + U.weekEnd(s.report.anchor) + '.md'
          : '月报_' + U.monthKey(s.report.anchor) + '.md';
        this.download(name, md);
        UI.toast('已下载 ' + name);
        break;
      }

      /* --- 设置 --- */
      case 'open-settings': this.settingsModal(); break;
      case 'sync-logout': {
        UI.confirm('退出后此设备需要重新输入密码才能进入（数据保存在服务器，不受影响）。确定退出？').then(ok => {
          if (ok) { localStorage.removeItem('wb.token'); location.reload(); }
        });
        break;
      }

      /* --- GitHub 同步 --- */
      case 'gh-config': Sync.ghModal(); break;
      case 'gh-save': Sync.ghSave(); break;
      case 'gh-pull-now': UI.toast('正在同步…'); Sync.pull(); break;
      case 'gh-disconnect': {
        UI.confirm('断开后此设备恢复为本地模式（云端数据仍在仓库里，重新配置即可连回）。确定断开？').then(ok => {
          if (ok) { localStorage.removeItem('wb.gh'); location.reload(); }
        });
        break;
      }

      /* --- 网页门禁 --- */
      case 'gate-set': Gate.modal(); break;
      case 'gate-save': Gate.save(); break;
      case 'gate-clear': Gate.clear(); break;

      /* --- 只读分享（GitHub 模式 / 服务器模式各有实现） --- */
      case 'share-set': Sync.mode === 'server' ? Sync.serverShareModal() : Gate.shareModal(); break;
      case 'share-save': Gate.shareSave(); break;
      case 'share-clear': Gate.shareClear(); break;
      case 'srv-share-save': Sync.serverShareSave(); break;
      case 'srv-share-clear': Sync.serverShareClear(); break;
      case 'guest-exit': localStorage.removeItem('wb.share'); location.reload(); break;
      case 'set-export': this.download('工作台备份_' + U.todayStr() + '.json', Store.exportJSON()); UI.toast('备份文件已下载'); break;
      case 'set-import': document.getElementById('setFile').click(); break;
      case 'set-demo': {
        UI.confirm('重新生成演示数据将<b>覆盖现有全部数据</b>，确定继续吗？', { danger: true, okText: '覆盖并生成' }).then(ok => {
          if (ok) { Store.reset(); UI.closeModal(); this.applyTheme(); this.render(); UI.toast('已恢复演示数据'); }
        });
        break;
      }
      case 'set-clear': {
        UI.confirm('清空后将<b>删除所有任务、日程与文献</b>（建议先导出备份），确定继续吗？', { danger: true, okText: '全部清空' }).then(ok => {
          if (ok) {
            Store.db.tasks = [];
            Store.db.refs = [];
            /* 只重置晨报标记，保留 serverUpdatedAt 等同步元信息 */
            Store.db.meta.lastBriefDate = U.todayStr();
            Store.save();
            UI.closeModal(); this.render(); UI.toast('已清空所有数据');
          }
        });
        break;
      }
    }
  },

  /* 访客只读模式下被拦截的修改类动作 */
  RO_BLOCK: new Set([
    'toggle-task', 'carry-over', 't-save', 't-delete', 'brief-carry',
    'sud-submit', 'adj-apply', 'adj-only', 'imp-do',
    'ref-save', 'ref-delete', 'ref-cycle', 'ref-task', 'bib-do',
    'gate-save', 'gate-clear', 'share-save', 'share-clear',
    'gh-save', 'gh-disconnect', 'sync-logout',
    'set-import', 'set-demo', 'set-clear', 'add-task-on', 'add-task-new', 'add-week-task', 'add-month-task',
    'doc-new', 'doc-del', 'rep-todoc'
  ]),

  /* ---------- 快速添加 ---------- */
  quickAdd(input) {
    if (Store.readOnly) { UI.toast('🔗 访客只读模式：仅可查看', 'warn'); input.value = ''; return; }
    const v = input.value.trim();
    if (!v) return;
    const p = MD.inline(v, { date: U.todayStr() });
    if (!p.title) { UI.toast('没有识别到任务内容', 'warn'); return; }
    Store.addTask({
      title: p.title,
      level: p.level || 'day',
      date: p.date || U.todayStr(),
      start: p.start, end: p.end,
      priority: p.priority || 'mid',
      progress: Math.max(0, p.progress),
      status: p.done ? 'done' : (p.progress > 0 ? 'doing' : 'todo'),
      tags: p.tags, fixed: p.fixed
    });
    input.value = '';
    UI.toast('已添加：' + p.title + (p.date ? '（' + U.fmtCN(p.date) + (p.start ? ' ' + p.start : '') + '）' : ''));
    this.render();
  },

  /* ---------- 任务编辑弹窗 ---------- */
  taskModal(id, preset = {}) {
    const t = id ? Store.get(id) : null;
    const isNew = !t;
    const d = t || Object.assign({
      kind: 'task', title: '', level: 'day', status: 'todo', priority: 'mid',
      date: this.state.day, due: '', start: '', end: '', fixed: false,
      tags: [], note: '', progress: 0
    }, preset);

    const segBtn = (group, val, label, cls = '') =>
      `<button type="button" class="${d[group] === val ? 'active ' + cls : cls}" data-act="seg" data-g="${group}" data-v="${val}">${label}</button>`;

    UI.modal({
      title: isNew ? '新建任务' : (d.kind === 'event' ? '日程详情' : '任务详情'),
      wide: true,
      body: `
        <div class="form-row"><label>标题</label>
          <input id="tTitle" type="text" value="${UI.esc(d.title)}" placeholder="要做什么？"></div>
        <div class="form-grid2">
          <div class="form-row"><label>类型</label>
            <select id="tLevel">
              <option value="day" ${d.level === 'day' ? 'selected' : ''}>日任务（具体某天）</option>
              <option value="week" ${d.level === 'week' ? 'selected' : ''}>周任务（本周重点）</option>
              <option value="month" ${d.level === 'month' ? 'selected' : ''}>月目标</option>
            </select></div>
          <div class="form-row"><label>优先级</label>
            <div class="seg" id="tPri">
              ${segBtn('priority', 'high', '🔴 高', 'c-red')}${segBtn('priority', 'mid', '🟡 中', 'c-amber')}${segBtn('priority', 'low', '🟢 低', 'c-green')}
            </div></div>
        </div>
        <div class="form-grid3">
          <div class="form-row"><label>日期${d.level === 'week' ? '（自动对齐到周一）' : d.level === 'month' ? '（自动对齐到1号）' : ''}</label>
            <input id="tDate" type="date" value="${d.date}"></div>
          <div class="form-row"><label>开始时间（可选）</label>
            <input id="tStart" type="time" value="${d.start || ''}"></div>
          <div class="form-row"><label>结束时间（可选）</label>
            <input id="tEnd" type="time" value="${d.end || ''}"></div>
        </div>
        <div class="form-grid2">
          <div class="form-row"><label>截止日期（可选）</label>
            <input id="tDue" type="date" value="${d.due || ''}"></div>
          <div class="form-row"><label>状态</label>
            <div class="seg" id="tStatus">
              ${segBtn('status', 'todo', '待办', 'c-primary')}${segBtn('status', 'doing', '进行中', 'c-primary')}${segBtn('status', 'done', '已完成', 'c-green')}
            </div></div>
        </div>
        <div class="form-row"><div class="switch-row">
          <span class="sr-label">📌 固定日程（不参与突发日程的自动调整）</span>
          <label class="switch"><input type="checkbox" id="tFixed" ${d.fixed ? 'checked' : ''}><span class="track"></span></label>
        </div></div>
        <div class="form-row"><label>进度</label>
          <div class="range-row"><input id="tProgress" type="range" min="0" max="100" step="5" value="${d.progress || 0}" data-act-input="tProgress"><b id="tProgVal">${d.progress || 0}%</b></div></div>
        <div class="form-row"><label>标签（逗号分隔）</label>
          <input id="tTags" type="text" value="${UI.esc((d.tags || []).join(', '))}" placeholder="研发, 产品"></div>
        <div class="form-row"><label>备注</label>
          <textarea id="tNote">${UI.esc(d.note || '')}</textarea></div>
        ${d.adjusted ? `<div class="src-note">↩ ${UI.esc(d.adjusted)}</div>` : ''}
        ${d.source ? `<div class="src-note">来源：${UI.esc(d.source)}</div>` : ''}`,
      foot: `${!isNew ? `<button class="btn btn-danger left" data-act="t-delete" data-id="${d.id}">删除</button>` : ''}
             <button class="btn btn-ghost" data-act="close-modal">取消</button>
             <button class="btn btn-primary" data-act="t-save" data-id="${isNew ? '' : d.id}">保存</button>`
    });
    const ti = document.getElementById('tTitle');
    if (ti) { ti.focus(); if (!isNew) ti.select(); }
  },

  saveTask(id) {
    const g = x => document.getElementById(x).value.trim();
    const active = sel => { const b = document.querySelector(sel + ' button.active'); return b ? b.dataset.v : 'mid'; };
    const title = g('tTitle');
    if (!title) { UI.toast('标题不能为空', 'warn'); return; }
    let date = g('tDate') || U.todayStr();
    const level = document.getElementById('tLevel').value;
    if (level === 'week') date = U.weekStart(date);
    if (level === 'month') date = date.slice(0, 7) + '-01';
    const start = g('tStart'), end = g('tEnd');
    if (start && end && U.hm(start) >= U.hm(end)) { UI.toast('结束时间需晚于开始时间', 'warn'); return; }
    const patch = {
      title, level, date, due: g('tDue'),
      start, end,
      priority: active('#tPri'),
      status: active('#tStatus'),
      progress: +document.getElementById('tProgress').value || 0,
      fixed: document.getElementById('tFixed').checked,
      tags: g('tTags').split(/[,，、\s]+/).filter(Boolean),
      note: document.getElementById('tNote').value.trim()
    };
    if (id) { Store.updateTask(id, patch); UI.toast('已保存'); }
    else { Store.addTask(Object.assign({ kind: 'task' }, patch)); UI.toast('已创建：' + title); }
    UI.closeModal();
    this.render();
  },

  /* ---------- 文献保存 ---------- */
  saveRef(id) {
    const g = x => document.getElementById(x).value.trim();
    const title = g('rTitle');
    if (!title) { UI.toast('标题不能为空', 'warn'); return; }
    const active = document.querySelector('#rStatus button.active');
    const patch = {
      title,
      authors: g('rAuthors'),
      year: +g('rYear') || null,
      type: document.getElementById('rType').value,
      venue: g('rVenue'),
      doi: g('rDoi'),
      url: g('rUrl'),
      status: active ? active.dataset.v : 'want',
      rating: document.querySelectorAll('#rStars .star.on').length,
      readProgress: +document.getElementById('rProg').value || 0,
      tags: g('rTags').split(/[,，、\s]+/).filter(Boolean),
      abstract: document.getElementById('rAbstract').value.trim(),
      note: document.getElementById('rNote').value.trim()
    };
    if (id) { Store.updateRef(id, patch); UI.toast('文献已保存'); }
    else { Store.addRef(patch); UI.toast('已添加文献'); }
    UI.closeModal();
    this.render();
  },

  /* ---------- 周报月报：编辑器辅助 ---------- */
  renderDocPreview() {
    const pv = document.getElementById('docPv');
    const ta = document.getElementById('docTa');
    if (!pv) return;
    pv.innerHTML = MD.render(ta ? ta.value : (Store.getDoc(this.state.docs.editing) || {}).content || '');
    MD.typeset(pv);
  },

  _docPatch(patch) {
    if (Store.readOnly) return;
    Store.updateDoc(this.state.docs.editing, patch);
  },

  /* 输入防抖保存：仅更新数据与预览，不重渲染视图（保住光标） */
  docAutosave(field, value) {
    if (Store.readOnly) return;
    clearTimeout(this._docTimer);
    this._docTimer = setTimeout(() => {
      this._docPatch({ [field]: value });
      if (field === 'content') this.renderDocPreview();
    }, 700);
  },

  docSaveNow() {
    if (this._docTimer) {
      clearTimeout(this._docTimer);
      this._docTimer = null;
      /* 从 DOM 取最新值立即保存 */
      const ta = document.getElementById('docTa');
      const ti = document.getElementById('docTitle');
      const su = document.getElementById('docSub');
      const patch = {};
      if (ta) patch.content = ta.value;
      if (ti) patch.title = ti.value.trim() || '未命名文档';
      if (su) patch.sub = su.value.trim();
      if (Object.keys(patch).length && !Store.readOnly) Store.updateDoc(this.state.docs.editing, patch);
    }
  },

  /* 在光标处插入 Markdown 片段 */
  docInsert(before, after, placeholder) {
    const ta = document.getElementById('docTa');
    if (!ta || Store.readOnly) return;
    const s0 = ta.selectionStart ?? ta.value.length;
    const e0 = ta.selectionEnd ?? s0;
    const sel = ta.value.slice(s0, e0) || placeholder || '';
    ta.setRangeText(before + sel + after, s0, e0, 'end');
    ta.focus();
    clearTimeout(this._docTimer);
    this._docPatch({ content: ta.value });
    this.renderDocPreview();
  },

  docPickImage() {
    const fi = document.getElementById('docImg');
    if (fi) fi.click();
  },

  /* 本地图片 → 压缩内嵌 data URL → 插入文档 */
  compressImage(file) {
    return new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onerror = reject;
      rd.onload = () => {
        const dataUrl = rd.result;
        /* 小图直接用；大图等比压缩（最长边 1000px，JPEG 72%） */
        if (file.size < 150 * 1024) return resolve(dataUrl);
        const img = new Image();
        img.onerror = () => resolve(dataUrl);
        img.onload = () => {
          try {
            const scale = Math.min(1, 1000 / Math.max(img.width, img.height));
            const cv = document.createElement('canvas');
            cv.width = Math.round(img.width * scale);
            cv.height = Math.round(img.height * scale);
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            resolve(cv.toDataURL('image/jpeg', 0.72));
          } catch (e) { resolve(dataUrl); }
        };
        img.src = dataUrl;
      };
      rd.readAsDataURL(file);
    });
  },

  async docInsertImage(file) {
    try {
      if (Sync.mode === 'github' || Sync.mode === 'server') {
        /* GitHub / 服务器模式：原图直传 assets/（保留论文级分辨率，不压缩），失败再降级压缩内嵌 */
        try {
          UI.toast('正在上传原图…');
          const dataUrl = await this.readFileAsDataURL(file);
          if (dataUrl.length > 8 * 1024 * 1024) {
            UI.toast('图片较大（约 ' + Math.round(dataUrl.length / 1024 / 1024) + 'MB），上传可能较慢', 'warn');
          }
          const ref = await (Sync.mode === 'github' ? Sync.ghPutAsset(dataUrl) : Sync.putAsset(dataUrl));
          UI.toast('原图已上传：' + ref);
          this.docInsert('\n![图片](', ')\n', ref);
          return;
        } catch (e) {
          UI.toast('上传失败，改为压缩内嵌（' + e.message + '）', 'warn');
        }
      }
      const dataUrl = await this.compressImage(file);
      if (dataUrl.length > 400 * 1024) UI.toast('图片较大（' + Math.round(dataUrl.length / 1024) + 'KB），已内嵌；注意数据体积', 'warn');
      this.docInsert('\n![图片](', ')\n', dataUrl);
    } catch (e) {
      UI.toast('图片读取失败', 'err');
    }
  },

  readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onload = () => resolve(rd.result);
      rd.onerror = reject;
      rd.readAsDataURL(file);
    });
  },

  /* ---------- 突发日程 ---------- */
  suddenModal(keep) {
    const p = keep ? this._pendingSudden.evt : { date: U.todayStr() };
    UI.modal({
      title: '⚡ 添加突发日程',
      body: `
        <div style="font-size:12.5px;color:var(--muted);line-height:1.8;margin-bottom:16px">
          加入后系统将自动检测当天冲突：<b>可调整的任务</b>会被顺延到空闲时段，<b>固定日程</b>仅提示冲突。
        </div>
        <div class="form-row"><label>事项标题</label>
          <input id="sTitle" type="text" value="${UI.esc(p.title || '')}" placeholder="例如：客户临时到访 / 紧急会议"></div>
        <div class="form-grid3">
          <div class="form-row"><label>日期</label><input id="sDate" type="date" value="${p.date}"></div>
          <div class="form-row"><label>开始时间</label><input id="sStart" type="time" value="${p.start || ''}"></div>
          <div class="form-row"><label>结束时间</label><input id="sEnd" type="time" value="${p.end || ''}"></div>
        </div>
        <div class="form-row"><label>备注（可选）</label><textarea id="sNote">${UI.esc(p.note || '')}</textarea></div>`,
      foot: `<button class="btn btn-ghost" data-act="close-modal">取消</button>
             <button class="btn btn-primary" data-act="sud-submit">下一步：检测冲突</button>`
    });
    const si = document.getElementById('sTitle');
    if (si) si.focus();
  },

  submitSudden() {
    const g = x => document.getElementById(x).value.trim();
    const evt = {
      title: g('sTitle'), date: g('sDate'), start: g('sStart'), end: g('sEnd'),
      note: document.getElementById('sNote').value.trim()
    };
    if (!evt.title) { UI.toast('请填写事项标题', 'warn'); return; }
    if (!evt.start || !evt.end) { UI.toast('请填写开始和结束时间', 'warn'); return; }
    if (U.hm(evt.start) >= U.hm(evt.end)) { UI.toast('结束时间需晚于开始时间', 'warn'); return; }
    if (!evt.date) evt.date = U.todayStr();

    const plan = Scheduler.propose(evt);
    this._pendingSudden = { evt, plan };

    if (!plan.moves.length && !plan.fixedConf.length) {
      /* 无冲突，直接加入 */
      Store.addTask(Object.assign({}, evt, { kind: 'event', sudden: true, fixed: true, level: 'day' }));
      this._pendingSudden = null;
      UI.closeModal();
      UI.toast('已加入突发日程（当天无冲突）');
      this.state.day = evt.date;
      this.go('today');
      return;
    }

    /* 冲突 → 展示调整方案 */
    const movesHtml = plan.moves.map(m => `
      <div class="adj-item ${m.failed ? 'failed' : ''}">
        <span style="flex:1;min-width:0">
          <div style="font-weight:600">${UI.esc(m.taskTitle)}</div>
          <div style="margin-top:3px">
            <span class="adj-old">${U.fmtCN(m.oldDate)} ${m.oldStart}${m.oldEnd ? '-' + m.oldEnd : ''}</span>
            <span class="adj-arrow">→</span>
            <span class="adj-new">${U.fmtCN(m.date)} ${m.start}-${m.end}</span>
          </div>
          <div style="font-size:11.5px;color:var(--muted);margin-top:2px">${UI.esc(m.reason)}</div>
        </span>
      </div>`).join('');

    const fixedHtml = plan.fixedConf.length ? `
      <div class="adj-fixed">⚠️ 有 ${plan.fixedConf.length} 项<b>固定日程</b>与突发日程时间重叠，无法自动调整：<br>
        ${plan.fixedConf.map(f => '「' + UI.esc(f.title) + '」' + f.start + '-' + f.end).join('、')}<br>请手动处理或与相关方协调。</div>` : '';

    UI.modal({
      title: '⚡ 调整方案确认',
      wide: true,
      body: `
        <div style="background:var(--rose-soft);border-radius:12px;padding:13px 16px;margin-bottom:16px;font-size:13.5px">
          📌 将加入突发日程：<b>${UI.esc(evt.title)}</b> · ${U.fmtCN(evt.date)}（${U.fmtWeekCN(evt.date)}） ${evt.start}-${evt.end}
        </div>
        ${plan.moves.length ? `<div class="brief-sec"><h4>以下 ${plan.moves.length} 项任务建议调整</h4>${movesHtml}</div>` : ''}
        ${fixedHtml}`,
      foot: `<button class="btn btn-ghost" data-act="adj-back">返回修改</button>
             <button class="btn btn-ghost" data-act="adj-only">仅加入，不调整</button>
             <button class="btn btn-primary" data-act="adj-apply">确认加入并自动调整</button>`
    });
  },

  /* ---------- 晨报（秘书提醒） ---------- */
  maybeBriefing() {
    if (Store.readOnly) return;   /* 访客只读模式不弹晨报 */
    if (Store.db.meta.lastBriefDate !== U.todayStr()) {
      Store.db.meta.lastBriefDate = U.todayStr();
      Store.save();
      this.briefing();
    }
  },

  briefing() {
    const t = U.todayStr();
    const day = Store.dayItems(t);
    const od = Store.overdue(t);
    const wk = Store.weekStats(U.weekStart(t));
    const mo = Store.monthStats(U.monthKey(t));
    const ds = Store.dayStats(t);
    const refReading = (Store.db.refs || []).filter(r => r.status === 'reading');

    const sorted = day.all.slice().sort((a, b) => {
      if (a.start && b.start) return U.hm(a.start) - U.hm(b.start);
      if (a.start) return -1; if (b.start) return 1; return 0;
    });

    const rowHtml = x => `
      <div class="mini-item" data-act="brief-task" data-id="${x.id}">
        <span class="mini-time">${x.start ? UI.esc(x.start + (x.end ? '–' + x.end : '')) : '未定时'}</span>
        <span class="mini-title ${x.status === 'done' ? 'done' : ''}">${x.sudden ? '⚡ ' : x.kind === 'event' ? '📅 ' : ''}${UI.esc(x.title)}</span>
        <span class="chip ${x.status === 'done' ? 'chip-green' : 'chip-gray'}" style="font-size:10px">${UI.ST[x.status].l}</span>
      </div>`;

    UI.modal({
      title: '', plainHead: false,
      wide: true,
      body: `
        <div class="brief-hero">
          <div class="brief-hi">${U.greeting()}！今天是 ${U.fmtFull(t)} · ${U.fmtWeekCN(t)}</div>
          <div class="brief-date">第 ${U.isoWeekNumber(t)} 周 · 今日 ${ds.total} 项安排（已完成 ${ds.done} 项）${od.length ? ' · ⚠️ 有 ' + od.length + ' 项遗留任务' : ''}</div>
        </div>
        <div class="brief-sec">
          <h4>🕐 今日安排 <span class="n">${sorted.length} 项</span></h4>
          ${sorted.length ? sorted.map(rowHtml).join('') : '<div style="font-size:13px;color:var(--muted);padding:8px 2px">今天还没有安排，去添加任务或导入一份计划吧</div>'}
        </div>
        ${od.length ? `
        <div class="brief-sec">
          <h4>⚠️ 昨日及更早遗留 <span class="n">${od.length} 项</span></h4>
          ${od.slice(0, 5).map(rowHtml).join('')}
          ${od.length > 5 ? `<div style="font-size:12px;color:var(--muted);padding:4px 2px">…等共 ${od.length} 项</div>` : ''}
          <button class="btn btn-ghost btn-sm" style="margin-top:10px" data-act="brief-carry">📥 全部顺延到今天</button>
        </div>` : ''}
        <div class="brief-sec">
          <h4>📊 周期进度</h4>
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <div style="flex:1;min-width:200px;background:var(--card2);border-radius:10px;padding:12px 14px">
              <div style="font-size:12px;color:var(--muted);margin-bottom:8px">本周 · 完成 ${wk.pct}%（${wk.done}/${wk.total}）</div>
              <div class="pbar"><span style="width:${wk.pct}%"></span></div>
            </div>
            <div style="flex:1;min-width:200px;background:var(--card2);border-radius:10px;padding:12px 14px">
              <div style="font-size:12px;color:var(--muted);margin-bottom:8px">本月 · 完成 ${mo.pct}%（${mo.done}/${mo.total}）</div>
              <div class="pbar"><span style="width:${mo.pct}%"></span></div>
            </div>
          </div>
        </div>
        ${refReading.length ? `
        <div class="brief-sec">
          <h4>📚 在读文献 <span class="n">${refReading.length} 篇</span></h4>
          ${refReading.slice(0, 4).map(r => `
          <div class="mini-item" data-act="open-ref" data-id="${r.id}">
            <span class="mini-title" style="flex:1;white-space:normal">${UI.esc(r.title)}</span>
            <span class="chip chip-gray">${r.readProgress || 0}%</span>
            <button class="btn btn-ghost btn-sm" style="padding:3px 9px" data-act="ref-task" data-id="${r.id}" data-when="day">＋今日</button>
          </div>`).join('')}
          ${refReading.length > 4 ? `<div style="font-size:12px;color:var(--muted);padding:2px 4px">…等共 ${refReading.length} 篇</div>` : ''}
        </div>` : ''}
        <div style="font-size:12px;color:var(--muted);line-height:1.8">💡 如遇临时会议或紧急事务，随时点击右上角「⚡ 突发日程」，系统会自动为你重排当天的任务。</div>`,
      foot: `<button class="btn btn-ghost" data-act="open-sudden">⚡ 突发日程</button>
             <button class="btn btn-primary" data-act="close-modal">开始今天 →</button>`
    });
  },

  /* ---------- 设置 ---------- */
  settingsModal() {
    const st = Store.db.settings;
    /* 访客只读模式：极简设置 */
    if (Store.readOnly) {
      UI.modal({
        title: '⚙️ 设置（访客只读模式）',
        body: `
          <div class="warn-box" style="margin-bottom:14px">👁 当前为访客只读模式：可自由浏览所有视图、时间轴与报告，数据自动刷新，不能修改。</div>
          ${Sync.guest ? `<div class="form-row"><label>访客身份</label>
            <div style="font-size:12.5px;color:var(--muted);margin-bottom:9px">本机已用分享密码登录只读模式。</div>
            <button class="btn btn-ghost btn-sm" data-act="guest-exit">🚪 退出只读访问（重新输入密码）</button></div>` : ''}
          ${Sync.guest ? '' : `<div class="form-row"><label>我是站长</label>
            <div style="font-size:12.5px;color:var(--muted);margin-bottom:9px">在此设备配置 GitHub 同步后可获得完整读写权限。</div>
            <button class="btn btn-ghost btn-sm" data-act="gh-config">☁ 配置 GitHub 同步</button></div>`}`
      });
      return;
    }
    const n = Store.tasks().length;
    const size = Math.round(JSON.stringify(Store.db).length / 1024);
    UI.modal({
      title: '⚙️ 设置',
      body: `
        <div class="form-row"><label>工作时段（自动排程只在该时段内寻找空档）</label>
          <div style="display:flex;gap:10px;align-items:center">
            <input id="wStart" type="time" value="${st.workingStart}" data-act-change="set-hours">
            <span style="color:var(--muted)">至</span>
            <input id="wEnd" type="time" value="${st.workingEnd}" data-act-change="set-hours">
          </div></div>
        <div class="form-row"><label>外观</label>
          <div style="font-size:12.5px;color:var(--muted)">使用左侧栏底部的月亮/太阳按钮切换深浅色主题（当前：${st.theme === 'dark' ? '深色' : '浅色'}）。</div></div>
        ${Sync.mode === 'server' ? `<div class="form-row"><label>☁ 云端同步 · 自建服务器（已启用）</label>
          <div style="font-size:12.5px;color:var(--muted);margin-bottom:9px;line-height:1.7">
            数据实时保存到服务器，多设备登录后看到同一份数据；清浏览器缓存不影响数据。备份可直接复制 <code>data/db.json</code>。
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" data-act="share-set">🔗 只读分享</button>
            <button class="btn btn-ghost btn-sm" data-act="sync-logout">🚪 退出登录（此设备）</button>
          </div></div>`
        : Sync.mode === 'github' ? `<div class="form-row"><label>☁ 云端同步 · GitHub（已启用）</label>
          <div style="font-size:12.5px;color:var(--muted);margin-bottom:9px;line-height:1.7">
            仓库 <b>${UI.esc(Sync.gh.repo)}</b> · 分支 ${UI.esc(Sync.gh.branch)}${Sync.gh.pass ? ' · 🔒 已加密' : ' · <span style="color:var(--amber)">未加密</span>'}。
            修改自动提交到仓库（约 3 秒延迟），每分钟拉取其他设备变更；清浏览器缓存不影响数据。
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" data-act="gh-pull-now">🔄 立即同步</button>
            <button class="btn btn-ghost btn-sm" data-act="gh-config">⚙ 修改配置</button>
            <button class="btn btn-ghost btn-sm" data-act="share-set">🔗 只读分享</button>
            <button class="btn btn-ghost btn-sm" data-act="gate-set">🔒 网页门禁</button>
          </div></div>`
        : `<div class="form-row"><label>☁ 云端同步（未启用）</label>
          <div style="font-size:12.5px;color:var(--muted);margin-bottom:9px;line-height:1.7">
            自建服务器（node server.js）部署时自动启用；部署在 GitHub Pages 等静态托管时，可配置 <b>GitHub 同步</b>——
            数据存到你的仓库：多设备一致、清缓存不丢、免费且自带版本历史。
          </div>
          <button class="btn btn-ghost btn-sm" data-act="gh-config">☁ 配置 GitHub 同步</button></div>`}
        <div class="form-row"><label>数据（${Sync.mode === 'local' ? '本地浏览器存储' : '云端为主 · 本地缓存加速'} · ${n} 条记录 · 约 ${size} KB）</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" data-act="set-export">⬇ 导出备份 JSON</button>
            <button class="btn btn-ghost btn-sm" data-act="set-import">⬆ 导入备份</button>
            <input type="file" id="setFile" accept=".json" style="display:none" data-act-change="set-file">
          </div></div>
        <div class="form-row"><label>重置</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" data-act="set-demo">🔄 恢复演示数据</button>
            <button class="btn btn-danger btn-sm" data-act="set-clear">🗑 清空全部数据</button>
          </div></div>`
    });
  },

  /* ---------- 工具 ---------- */
  download(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  },

  copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((res, rej) => {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); res(); } catch (e) { rej(e); }
      ta.remove();
    });
  },

  readImportFile(file) {
    const r = new FileReader();
    r.onload = () => {
      const ta = document.getElementById('impText');
      if (ta) ta.value = r.result;
      this.state.import = MD.parse(r.result);
      this.render();
      UI.toast('已读取「' + file.name + '」，解析到 ' + this.state.import.tasks.length + ' 项任务');
    };
    r.readAsText(file, 'utf-8');
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
