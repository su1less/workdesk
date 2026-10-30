/* ============================================================
 * ui.js — 组件库 & 视图渲染
 * 全局命名空间：UI
 * 依赖：U / Store / MD（app.js 负责事件绑定与状态）
 * ============================================================ */

const UI = {

  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  PRI: { high: { l: '高', c: 'chip-red', d: 'red' }, mid: { l: '中', c: 'chip-amber', d: 'amber' }, low: { l: '低', c: 'chip-green', d: 'green' } },
  ST: { todo: { l: '待办', c: 'chip-gray' }, doing: { l: '进行中', c: 'chip-blue' }, done: { l: '已完成', c: 'chip-green' } },
  LV: { day: '日', week: '周', month: '月' },

  timeStr(t) { return t.start ? (t.start + (t.end ? '–' + t.end : '')) : ''; },

  /* 进度环 */
  ring(pct, size = 62, stroke = 6, color = 'url(#ringGrad)') {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0">
      <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#8b5cf6"/>
      </linearGradient></defs>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"
        transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="52%" dominant-baseline="central" text-anchor="middle" class="ring-txt">${pct}%</text>
    </svg>`;
  },

  /* 任务元信息小标签 */
  metaChips(t) {
    let h = '';
    if (t.kind === 'event') h += `<span class="chip chip-blue">${t.sudden ? '⚡ 突发' : '📅 日程'}</span>`;
    if (t.fixed && t.kind !== 'event') h += `<span class="chip chip-gray">📌 固定</span>`;
    const p = UI.PRI[t.priority] || UI.PRI.mid;
    if (t.kind !== 'event') h += `<span class="chip ${p.c}">${p.l}优先</span>`;
    if (t.start) h += `<span class="chip chip-gray">🕐 ${UI.esc(t.start + (t.end ? '–' + t.end : ''))}</span>`;
    (t.tags || []).forEach(g => { h += `<span class="chip chip-purple">#${UI.esc(g)}</span>`; });
    if (t.adjusted) h += `<span class="chip chip-amber" title="${UI.esc(t.adjusted)}">↩ 已调整</span>`;
    if (t.refId) h += `<span class="chip chip-teal" title="关联文献">📚</span>`;
    return h;
  },

  /* 通用任务卡片（周重点 / 月目标 / 未安排任务） */
  taskCard(t) {
    const st = UI.ST[t.status] || UI.ST.todo;
    const checked = t.status === 'done' ? 'done' : '';
    return `<div class="tcard ${t.status === 'done' ? 'done' : ''}" data-act="open-task" data-id="${t.id}">
      <div class="tcard-head">
        <button class="tc-check ${checked}" data-act="toggle-task" data-id="${t.id}" title="完成/取消完成">✓</button>
        <div class="tc-title">${UI.esc(t.title)}</div>
        <span class="chip ${st.c}">${st.l}</span>
      </div>
      <div class="tc-chips">${UI.metaChips(t)}</div>
      <div class="tc-foot">
        <div class="pbar ${t.status === 'done' ? 'green' : ''} tc-prog"><span style="width:${t.progress || 0}%"></span></div>
        <span class="tc-pct">${t.progress || 0}%</span>
      </div>
    </div>`;
  },

  /* 迷你列表行（仪表盘） */
  miniItem(t, opts = {}) {
    const time = t.start ? t.start + (t.end ? '–' + t.end : '') : (opts.fallbackTime || '—');
    let chip = '';
    if (opts.overdueDays) chip = `<span class="chip chip-red">逾期 ${opts.overdueDays} 天</span>`;
    else if (t.sudden) chip = `<span class="chip chip-rose">⚡</span>`;
    else if (t.kind === 'event' && !t.sudden) chip = `<span class="chip chip-blue">📅</span>`;
    return `<div class="mini-item" data-act="open-task" data-id="${t.id}">
      <span class="mini-time">${UI.esc(time)}</span>
      <span class="mini-title ${t.status === 'done' ? 'done' : ''}">${UI.esc(t.title)}</span>
      ${chip}
      ${t.status !== 'done' && t.kind !== 'event' && (t.progress || 0) > 0 ? `<span class="chip chip-gray">${t.progress}%</span>` : ''}
    </div>`;
  },

  empty(icon, title, sub, btnHtml = '') {
    return `<div class="empty"><div class="e-icon">${icon}</div>
      <div class="e-title">${title}</div><div class="e-sub">${sub}</div>${btnHtml}</div>`;
  },

  /* ============ 弹窗 ============ */
  modal({ title, body, foot = '', wide = false, plainHead = false }) {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="modal-mask" data-act="modal-mask">
        <div class="modal-card ${wide ? 'lg' : ''}">
          ${plainHead ? '' : `<div class="modal-head"><h3>${title}</h3>
            <button class="icon-btn" data-act="close-modal" title="关闭">
              <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button></div>`}
          <div class="modal-body">${body}</div>
          ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
        </div>
      </div>`;
  },

  closeModal() { document.getElementById('modalRoot').innerHTML = ''; },

  confirm(msg, { danger = false, okText = '确认' } = {}) {
    return new Promise(resolve => {
      UI.modal({
        title: '请确认',
        body: `<div style="font-size:13.5px;line-height:1.8;padding:4px 0">${msg}</div>`,
        foot: `<button class="btn btn-ghost" data-act="cf-no">取消</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="cf-yes">${okText}</button>`
      });
      UI._cfResolve = resolve;
    });
  },

  toast(msg, type = 'ok') {
    const root = document.getElementById('toastRoot');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, 2600);
  },

  /* ============ 视图：仪表盘 ============ */
  dashboard() {
    const t = U.todayStr();
    const day = Store.dayItems(t);
    const ds = Store.dayStats(t);
    const ws = Store.weekStats(U.weekStart(t));
    const ms = Store.monthStats(U.monthKey(t));
    const od = Store.overdue(t);
    const wk = Store.weekTasks(U.weekStart(t));
    const doings = Store.tasks().filter(x => x.status === 'doing' && x.level !== 'month').length;
    const refList = Store.db.refs || [];
    const refReading = refList.filter(r => r.status === 'reading');

    const sorted = day.all.slice().sort((a, b) => {
      if (a.start && b.start) return U.hm(a.start) - U.hm(b.start);
      if (a.start) return -1; if (b.start) return 1;
      return 0;
    });

    return `
    <div class="hero">
      <div class="hero-inner">
        <div>
          <div class="hero-hi">${U.greeting()}，欢迎回来 👋</div>
          <div class="hero-date">${U.fmtFull(t)} · ${U.fmtWeekCN(t)} · 第 ${U.isoWeekNumber(t)} 周</div>
          <div class="hero-stats">
            <div class="hero-stat"><b>${ds.total}</b><span>今日安排</span></div>
            <div class="hero-stat"><b>${ds.done}</b><span>已完成</span></div>
            <div class="hero-stat"><b>${doings}</b><span>进行中</span></div>
            <div class="hero-stat"><b style="color:${od.length ? '#fda4af' : '#a7f3d0'}">${od.length}</b><span>待处理延期</span></div>
          </div>
        </div>
        <div class="hero-actions">
          <button class="btn btn-ghost-light" data-act="briefing">📋 查看晨报</button>
          <button class="btn btn-ghost-light" data-act="open-sudden">⚡ 添加突发日程</button>
        </div>
      </div>
    </div>

    <div class="grid stats-grid">
      <div class="card stat-card">${UI.ring(ds.pct)}
        <div class="stat-info"><div class="s-num">${ds.done} / ${ds.total}</div>
        <div class="s-label">今日完成</div>
        <div class="s-extra">${day.timed.length} 项定时 · ${day.untimed.length} 项待安排</div></div>
      </div>
      <div class="card stat-card">${UI.ring(ws.pct)}
        <div class="stat-info"><div class="s-num">${ws.done} / ${ws.total}</div>
        <div class="s-label">本周进度</div>
        <div class="s-extra">周任务 ${ws.week.done}/${ws.week.total} · 日任务 ${ws.day.done}/${ws.day.total}</div></div>
      </div>
      <div class="card stat-card">${UI.ring(ms.pct)}
        <div class="stat-info"><div class="s-num">${ms.done} / ${ms.total}</div>
        <div class="s-label">本月目标</div>
        <div class="s-extra">月任务 ${ms.month.done}/${ms.month.total} · 日程 ${ms.day.done}/${ms.day.total}</div></div>
      </div>
      <div class="card stat-card ${od.length ? 'warn' : ''}">
        <div style="width:62px;height:62px;border-radius:50%;background:var(--red-soft);color:var(--red);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;flex-shrink:0">${od.length}</div>
        <div class="stat-info"><div class="s-num" style="color:${od.length ? 'var(--red)' : 'var(--text)'}">${od.length ? '需要处理' : '一切正常'}</div>
        <div class="s-label">延期 / 未完成</div>
        <div class="s-extra">${od.length ? '点击下方「一键顺延」处理' : '没有逾期的任务 ✨'}</div></div>
      </div>
    </div>

    <div class="grid dash-grid">
      <div class="card">
        <div class="card-title">🕐 今日日程 <span class="more" data-act="go" data-v="today">前往今日 →</span></div>
        ${sorted.length ? sorted.slice(0, 8).map(x => UI.miniItem(x)).join('') : UI.empty('🌤️', '今天还没有安排', '添加任务或导入一份计划文档吧')}
        ${sorted.length > 8 ? `<div style="text-align:center;padding:8px;font-size:12px;color:var(--muted);cursor:pointer" data-act="go" data-v="today">还有 ${sorted.length - 8} 项，查看全部 →</div>` : ''}
      </div>
      <div class="card">
        <div class="card-title">⚠️ 延期任务</div>
        ${od.length ? od.slice(0, 6).map(x => {
          const days = Math.round((U.parseDate(U.todayStr()) - U.parseDate(x.date)) / 86400000);
          return UI.miniItem(x, { overdueDays: days });
        }).join('') + `<button class="btn btn-ghost btn-sm" style="width:100%;margin-top:10px" data-act="carry-over">📥 一键顺延到今天（${od.length} 项）</button>`
        : UI.empty('✨', '没有延期任务', '保持节奏，继续加油')}
      </div>
      <div class="card">
        <div class="card-title">🎯 本周重点 <span class="more" data-act="go" data-v="week">查看本周 →</span></div>
        ${wk.length ? wk.map(x => `
          <div class="mini-item" data-act="open-task" data-id="${x.id}">
            <span class="dot ${x.status === 'done' ? 'green' : UI.PRI[x.priority].d}" style="margin-top:6px"></span>
            <div style="flex:1;min-width:0">
              <div class="mini-title ${x.status === 'done' ? 'done' : ''}" style="white-space:normal">${UI.esc(x.title)}</div>
              <div class="pbar ${x.status === 'done' ? 'green' : ''}" style="margin-top:5px"><span style="width:${x.progress || 0}%"></span></div>
            </div>
            <span class="tc-pct">${x.progress || 0}%</span>
          </div>`).join('')
        : UI.empty('🗓️', '本周暂无周任务', '在任务库或本周视图中添加')}
      </div>
    </div>

    ${refList.length ? `
    <div class="card" style="margin-top:16px">
      <div class="card-title">📚 文献阅读
        <span style="display:flex;gap:6px;margin-left:10px">
          <span class="chip chip-gray">想读 ${Store.refStats().want}</span>
          <span class="chip chip-blue">在读 ${Store.refStats().reading}</span>
          <span class="chip chip-green">已读 ${Store.refStats().read}</span>
        </span>
        <span class="more" data-act="go" data-v="refs">查看文献库 →</span>
      </div>
      ${refReading.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
        ${refReading.slice(0, 4).map(r => `
        <div class="mini-item" data-act="open-ref" data-id="${r.id}" style="border:1px solid var(--line2);border-radius:10px">
          <div style="flex:1;min-width:0">
            <div class="mini-title" style="white-space:normal">${UI.esc(r.title)}</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
              <div class="pbar" style="flex:1"><span style="width:${r.readProgress || 0}%"></span></div>
              <span class="tc-pct">${r.readProgress || 0}%</span>
              <button class="btn btn-ghost btn-sm" style="padding:3px 9px" data-act="ref-task" data-id="${r.id}" data-when="day">＋今日</button>
            </div>
          </div>
        </div>`).join('')}
      </div>` : `<div style="font-size:12.5px;color:var(--muted)">没有正在读的文献，去文献库挑一篇开始吧</div>`}
    </div>` : ''}`;
  },

  /* ============ 视图：今日（时间轴） ============ */
  today() {
    const ds = App.state.day;
    const { timed, untimed } = Store.dayItems(ds);
    const isToday = ds === U.todayStr();
    const H0 = 6, PXH = 52;

    let hours = '';
    for (let h = H0; h < 24; h++) {
      hours += `<div class="tl-hour ${h < 7 || h >= 22 ? 'off' : ''}">
        <div class="tl-hour-label">${U.pad(h)}:00</div><div class="tl-hour-body"></div></div>`;
    }

    let blocks = timed.map(t => {
      const s = U.hm(t.start), e = U.hm(t.end || U.minHM(s + 60));
      const top = (s - H0 * 60) / 60 * PXH;
      const h = Math.max(26, (e - s) / 60 * PXH - 4);
      const cls = ['tl-block'];
      if (t.kind === 'event') cls.push('ev');
      if (t.sudden) cls.push('sudden');
      if (t.fixed && t.kind !== 'event') cls.push('fixed');
      if (t.status === 'done') cls.push('done');
      if (t.adjusted) cls.push('warn');
      return `<div class="${cls.join(' ')}" style="top:${top}px;height:${h}px" data-act="open-task" data-id="${t.id}"
        title="${UI.esc(t.title)}${t.adjusted ? '\n' + t.adjusted : ''}">
        <div class="tlb-title">${t.sudden ? '⚡ ' : ''}${t.kind === 'event' && !t.sudden ? '📅 ' : ''}${t.status === 'done' ? '✓ ' : ''}${UI.esc(t.title)}</div>
        <div class="tlb-time">${UI.esc(t.start)} - ${UI.esc(t.end || '')}${t.adjusted ? ' · 已调整' : ''}</div>
      </div>`;
    }).join('');

    let nowLine = '';
    if (isToday) {
      const now = new Date();
      const mins = now.getHours() * 60 + now.getMinutes();
      if (mins >= H0 * 60 && mins <= 1440) {
        const top = (mins - H0 * 60) / 60 * PXH;
        nowLine = `<div class="tl-now" id="tlNow" style="top:${top}px"><span>${U.nowHM()}</span></div>`;
      }
    }

    return `
    <div class="today-layout">
      <div class="card">
        <div class="tl-head">
          <div class="day-nav">
            <button class="icon-btn" data-act="day-shift" data-v="-1"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button>
            <div class="dn-label">${U.relDay(ds)}</div>
            <button class="icon-btn" data-act="day-shift" data-v="1"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></button>
            <input type="date" value="${ds}" data-act-change="day-goto" style="border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text);padding:6px 9px;font-family:inherit;font-size:12.5px;outline:none">
          </div>
          <div style="display:flex;gap:8px">
            ${ds !== U.todayStr() ? `<button class="btn btn-ghost btn-sm" data-act="day-shift" data-v="0">回到今天</button>` : ''}
            <button class="btn btn-primary btn-sm" data-act="add-task-on" data-date="${ds}">＋ 添加任务</button>
          </div>
        </div>
        <div class="timeline-wrap">
          <div class="timeline" style="height:${(24 - H0) * PXH}px">${hours}${blocks}${nowLine}</div>
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">📝 未安排时间（${untimed.length}）</div>
          ${untimed.length ? untimed.map(x => `
            <div class="mini-item" data-act="open-task" data-id="${x.id}">
              <button class="tc-check ${x.status === 'done' ? 'done' : ''}" data-act="toggle-task" data-id="${x.id}">✓</button>
              <span class="mini-title ${x.status === 'done' ? 'done' : ''}" style="flex:1">${UI.esc(x.title)}</span>
              ${x.progress ? `<span class="chip chip-gray">${x.progress}%</span>` : `<span class="chip ${UI.PRI[x.priority].c}" style="font-size:10px">${UI.PRI[x.priority].l}</span>`}
            </div>`).join('')
          : UI.empty('☕', '没有待安排的任务', '右上方添加，或从时间轴拖起')}
        </div>
        <div class="card">
          <div class="card-title">⚡ 突发日程</div>
          <div style="font-size:12.5px;color:var(--muted);line-height:1.8;margin-bottom:12px">
            临时会议、紧急事务？添加后系统会自动检测冲突，并把可调整的任务顺延到空闲时段。
          </div>
          <button class="btn btn-sudden" style="width:100%" data-act="open-sudden">⚡ 添加突发日程</button>
        </div>
      </div>
    </div>`;
  },

  /* ============ 视图：本周 ============ */
  week() {
    const ws = App.state.week;
    const we = U.weekEnd(ws);
    const st = Store.weekStats(ws);
    const focus = Store.weekTasks(ws);
    const t = U.todayStr();

    let cols = '';
    for (let i = 0; i < 7; i++) {
      const d = U.addDays(ws, i);
      const items = Store.dayItems(d).all;
      const cls = ['wk-col'];
      if (d === t) cls.push('today');
      if (i >= 5) cls.push('weekend');
      if (d > t) cls.push('future');
      cols += `<div class="${cls.join(' ')}">
        <div class="wk-date">
          <span class="d">${+d.slice(8)}</span><span class="w">${U.fmtWeekCN(d)}</span>
          <button class="icon-btn add-day" data-act="add-task-on" data-date="${d}" title="添加任务" style="width:24px;height:24px">
            <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
        ${items.map(x => {
          const c = ['wk-task'];
          if (x.kind === 'event') c.push('ev');
          if (x.sudden) c.push('sudden');
          else if (x.fixed) c.push('fixed');
          if (x.priority === 'high') c.push('p-high');
          if (x.status === 'done') c.push('done');
          return `<div class="${c.join(' ')}" data-act="open-task" data-id="${x.id}">
            <div class="t">${x.sudden ? '⚡' : x.kind === 'event' ? '📅' : ''} ${UI.esc(x.title)}</div>
            <div class="m">${x.start ? x.start + (x.end ? '-' + x.end : '') : (x.status === 'done' ? '已完成' : UI.PRI[x.priority].l + '优先')}</div>
          </div>`;
        }).join('')}
      </div>`;
    }

    return `
    <div class="week-head">
      <div class="day-nav">
        <button class="icon-btn" data-act="week-shift" data-v="-1"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button>
        <div class="dn-label" style="min-width:230px">${U.fmtCN(ws)} ~ ${U.fmtCN(we)} · 第 ${U.isoWeekNumber(ws)} 周</div>
        <button class="icon-btn" data-act="week-shift" data-v="1"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></button>
        ${ws !== U.weekStart(t) ? `<button class="btn btn-ghost btn-sm" data-act="week-shift" data-v="0">本周</button>` : ''}
      </div>
      <div class="week-summary">
        <span>完成率 <b>${st.pct}%</b>（${st.done}/${st.total}）</span>
        <div class="pbar" style="width:160px"><span style="width:${st.pct}%"></span></div>
        <button class="btn btn-primary btn-sm" data-act="add-week-task">＋ 周任务</button>
      </div>
    </div>
    ${focus.length ? `<div class="week-focus">${focus.map(x => UI.taskCard(x)).join('')}</div>` : ''}
    <div class="week-grid">${cols}</div>`;
  },

  /* ============ 视图：本月 ============ */
  month() {
    const mk = App.state.month;
    const from = U.monthStart(mk), to = U.monthEnd(mk);
    const gridStart = U.weekStart(from), gridEnd = U.weekEnd(to);
    const t = U.todayStr();
    const goals = Store.monthTasks(mk);
    const [y, m] = mk.split('-');

    let heads = '一二三四五六日'.split('').map(w => `<div class="m-week-head">周${w}</div>`).join('');
    let cells = '';
    for (let d = gridStart; d <= gridEnd; d = U.addDays(d, 1)) {
      const items = Store.dayItems(d).all;
      const inMonth = d.slice(0, 7) === mk;
      const cls = ['m-cell'];
      if (!inMonth) cls.push('dim');
      if (d === t) cls.push('today');
      cells += `<div class="${cls.join(' ')}" data-act="goto-day" data-date="${d}">
        <div class="m-num">${+d.slice(8)}</div>
        ${items.slice(0, 3).map(x => `<div class="m-item ${x.kind === 'event' ? 'ev' : ''} ${x.sudden ? 'sudden' : ''} ${x.status === 'done' ? 'done' : ''}"
          data-act="open-task" data-id="${x.id}">${x.sudden ? '⚡' : x.kind === 'event' ? '📅' : ''}${UI.esc(x.title)}</div>`).join('')}
        ${items.length > 3 ? `<div class="m-more">还有 ${items.length - 3} 项…</div>` : ''}
      </div>`;
    }

    return `
    <div class="week-head">
      <div class="day-nav">
        <button class="icon-btn" data-act="month-shift" data-v="-1"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button>
        <div class="dn-label" style="min-width:130px">${y} 年 ${+m} 月</div>
        <button class="icon-btn" data-act="month-shift" data-v="1"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></button>
        ${mk !== U.monthKey(t) ? `<button class="btn btn-ghost btn-sm" data-act="month-shift" data-v="0">本月</button>` : ''}
      </div>
      <button class="btn btn-primary btn-sm" data-act="add-month-task">＋ 月目标</button>
    </div>
    <div class="card" style="padding:14px">
      <div class="month-grid">${heads}${cells}</div>
    </div>
    <div class="month-goals">
      ${goals.length ? goals.map(x => UI.taskCard(x)).join('')
        : `<div class="card" style="grid-column:1/-1">${UI.empty('🏔️', '本月还没有目标', '设定 2~4 个月目标是保持方向感的好方法')}</div>`}
    </div>`;
  },

  /* ============ 视图：任务库 ============ */
  library() {
    const f = App.state.lib;
    let list = Store.tasks().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (f.q) { const q = f.q.toLowerCase(); list = list.filter(x => (x.title + ' ' + (x.tags || []).join(' ') + ' ' + (x.note || '')).toLowerCase().includes(q)); }
    if (f.level) list = list.filter(x => x.level === f.level);
    if (f.status) list = list.filter(x => x.status === f.status);
    if (f.tag) list = list.filter(x => (x.tags || []).includes(f.tag));

    const tags = Store.allTags();
    return `
    <div class="filter-bar">
      <input type="text" placeholder="搜索任务 / 标签 / 备注…" value="${UI.esc(f.q)}" data-act-input="lib-q" style="width:240px">
      <select data-act-change="lib-level">
        <option value="">全部类型</option>
        <option value="day" ${f.level === 'day' ? 'selected' : ''}>日任务</option>
        <option value="week" ${f.level === 'week' ? 'selected' : ''}>周任务</option>
        <option value="month" ${f.level === 'month' ? 'selected' : ''}>月目标</option>
      </select>
      <select data-act-change="lib-status">
        <option value="">全部状态</option>
        <option value="todo" ${f.status === 'todo' ? 'selected' : ''}>待办</option>
        <option value="doing" ${f.status === 'doing' ? 'selected' : ''}>进行中</option>
        <option value="done" ${f.status === 'done' ? 'selected' : ''}>已完成</option>
      </select>
      <select data-act-change="lib-tag">
        <option value="">全部标签</option>
        ${tags.map(g => `<option value="${UI.esc(g)}" ${f.tag === g ? 'selected' : ''}>#${UI.esc(g)}</option>`).join('')}
      </select>
      <span style="font-size:12px;color:var(--muted);margin-left:auto">共 ${list.length} 项</span>
      <button class="btn btn-primary btn-sm" data-act="add-task-new">＋ 新建任务</button>
    </div>
    <div class="card scroll-x" style="padding:8px 16px 16px">
      ${list.length ? `<table class="lib-table"><thead><tr>
        <th>任务</th><th>类型</th><th>日期</th><th>时间</th><th>优先级</th><th>状态</th><th style="width:150px">进度</th>
      </tr></thead><tbody>
        ${list.map(x => `<tr data-act="open-task" data-id="${x.id}">
          <td><div class="lib-title ${x.status === 'done' ? 'done' : ''}">${x.sudden ? '⚡ ' : x.kind === 'event' ? '📅 ' : ''}${UI.esc(x.title)}</div>
            ${(x.tags || []).length ? `<div style="margin-top:3px">${x.tags.map(g => `<span class="chip chip-purple" style="font-size:10px">#${UI.esc(g)}</span>`).join(' ')}</div>` : ''}</td>
          <td><span class="chip ${x.level === 'week' ? 'chip-teal' : x.level === 'month' ? 'chip-purple' : 'chip-gray'}">${UI.LV[x.level]}任务</span></td>
          <td style="font-size:12.5px">${U.fmtCN(x.date)}</td>
          <td style="font-size:12px;font-family:ui-monospace,monospace;color:var(--muted)">${x.start ? x.start + (x.end ? '-' + x.end : '') : '—'}</td>
          <td><span class="chip ${UI.PRI[x.priority].c}" style="font-size:10.5px">${UI.PRI[x.priority].l}</span></td>
          <td><span class="chip ${UI.ST[x.status].c}" style="font-size:10.5px">${UI.ST[x.status].l}</span></td>
          <td><div class="lib-prog"><div class="pbar ${x.status === 'done' ? 'green' : ''}"><span style="width:${x.progress || 0}%"></span></div><span style="font-size:11px;color:var(--muted)">${x.progress || 0}%</span></div></td>
        </tr>`).join('')}
      </tbody></table>`
      : UI.empty('🔍', '没有匹配的任务', '调整筛选条件，或创建新任务',
        `<button class="btn btn-primary btn-sm" data-act="add-task-new">＋ 新建任务</button>`)}</div>`;
  },

  /* ============ 视图：进度报告 ============ */
  reports() {
    const r = App.state.report;
    const range = r.type === 'week'
      ? U.fmtCN(U.weekStart(r.anchor)) + ' ~ ' + U.fmtCN(U.weekEnd(r.anchor))
      : U.monthKey(r.anchor).replace('-', ' 年 ') + ' 月';
    return `
    <div class="report-layout">
      <div class="card report-ctrl">
        <div class="report-tabs">
          <button class="${r.type === 'week' ? 'active' : ''}" data-act="rep-type" data-v="week">📅 周报</button>
          <button class="${r.type === 'month' ? 'active' : ''}" data-act="rep-type" data-v="month">🗓️ 月报</button>
        </div>
        <div class="rc-row">
          <button class="icon-btn" data-act="rep-shift" data-v="-1"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button>
          <div style="text-align:center"><div style="font-size:14.5px;font-weight:700">${range}</div>
            <div style="font-size:11.5px;color:var(--muted);margin-top:2px">${r.type === 'week' ? '第 ' + U.isoWeekNumber(U.weekStart(r.anchor)) + ' 周' : ''}</div></div>
          <button class="icon-btn" data-act="rep-shift" data-v="1"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></button>
        </div>
        <button class="btn btn-primary" style="width:100%;margin-bottom:14px" data-act="rep-gen">✨ 生成报告</button>
        <div style="font-size:12px;color:var(--muted);line-height:1.8">
          报告自动汇总所选周期内的：<br>
          · 任务完成率与整体进度<br>
          · 已完成 / 进行中 / 延期清单<br>
          · 突发日程及其引发的调整<br>
          · 下一周期的安排建议<br>
          生成后可一键复制或下载 .md 文件。
        </div>
      </div>
      <div class="card">
        ${r.md ? `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <div class="report-tabs" style="flex:1;margin:0">
            <button class="${r.tab === 'preview' ? 'active' : ''}" data-act="rep-tab" data-v="preview">预览</button>
            <button class="${r.tab === 'src' ? 'active' : ''}" data-act="rep-tab" data-v="src">Markdown</button>
          </div>
          <button class="btn btn-ghost btn-sm" data-act="rep-copy">复制</button>
          <button class="btn btn-ghost btn-sm" data-act="rep-todoc" title="存入周报月报，可继续编辑并插入图片公式">📝 存为文档</button>
          <button class="btn btn-ghost btn-sm" data-act="rep-download">下载 .md</button>
        </div>
        ${r.tab === 'src' ? `<textarea class="report-src" data-act-input="rep-src">${UI.esc(r.md)}</textarea>`
          : `<div class="md-preview">${MD.render(r.md)}</div>`}`
        : UI.empty('📄', '还没有生成报告', '选择周期后点击「生成报告」')}
      </div>
    </div>`;
  },

  /* ============ 视图：导入计划 ============ */
  importView() {
    const imp = App.state.import;
    let right = '';
    if (!imp) {
      right = `<div class="card">${UI.empty('📥', '等待解析', '粘贴或上传 Markdown 计划文档，解析后在此确认导入')}</div>`;
    } else {
      right = `
      <div class="card">
        <div class="card-title">解析结果 · ${UI.esc(imp.title || '未命名文档')}
          <span class="chip chip-purple" style="margin-left:4px">${imp.tasks.length} 项</span>
        </div>
        ${imp.warnings.length ? `<div class="warn-box">${imp.warnings.map(w => '· ' + UI.esc(w)).join('<br>')}</div>` : ''}
        <div style="overflow:auto;max-height:460px;margin-top:12px">
        <table class="imp-table"><thead><tr>
          <th></th><th style="min-width:180px">任务</th><th>类型</th><th>日期</th><th>开始</th><th>结束</th><th>优先级</th><th>进度</th>
        </tr></thead><tbody>
          ${imp.tasks.map((t, i) => `<tr>
            <td><input type="checkbox" class="imp-ck" data-i="${i}" checked></td>
            <td><input type="text" value="${UI.esc(t.title)}" data-i="${i}" data-f="title"></td>
            <td><select data-i="${i}" data-f="level">
              <option value="day" ${t.level === 'day' ? 'selected' : ''}>日</option>
              <option value="week" ${t.level === 'week' ? 'selected' : ''}>周</option>
              <option value="month" ${t.level === 'month' ? 'selected' : ''}>月</option>
            </select></td>
            <td><input type="date" value="${t.date}" data-i="${i}" data-f="date"></td>
            <td><input type="time" value="${t.start || ''}" data-i="${i}" data-f="start"></td>
            <td><input type="time" value="${t.end || ''}" data-i="${i}" data-f="end"></td>
            <td><select data-i="${i}" data-f="priority">
              <option value="high" ${t.priority === 'high' ? 'selected' : ''}>高</option>
              <option value="mid" ${t.priority === 'mid' ? 'selected' : ''}>中</option>
              <option value="low" ${t.priority === 'low' ? 'selected' : ''}>低</option>
            </select></td>
            <td><input type="number" value="${t.progress || 0}" min="0" max="100" style="width:58px" data-i="${i}" data-f="progress"></td>
          </tr>`).join('')}
        </tbody></table></div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:16px">
          <span style="font-size:12.5px;color:var(--muted)">已选 <b id="impCount">${imp.tasks.length}</b> / ${imp.tasks.length} 项</span>
          <button class="btn btn-primary" style="margin-left:auto" data-act="imp-do">✅ 确认导入</button>
          <button class="btn btn-ghost" data-act="imp-clear">重新解析</button>
        </div>
      </div>`;
    }

    return `
    <div class="import-layout">
      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">📂 上传 / 粘贴计划文档</div>
          <div class="imp-file" data-act="imp-file">
            <div style="font-size:26px;margin-bottom:6px">📄</div>
            点击选择 .md 文件（或拖拽到此处）
            <input type="file" id="impFile" accept=".md,.markdown,.txt" style="display:none" data-act-change="imp-file-input">
          </div>
          <textarea class="imp-textarea" id="impText" placeholder="也可以直接把 Markdown 计划粘贴到这里…&#10;&#10;# 十月最后一周计划&#10;## 10-26 ~ 11-01&#10;- [ ] 完成季度报告初稿 !高 ~3h&#10;- [x] 提交报销单&#10;## 本周任务&#10;- [ ] 优化首页加载速度 40% #研发"></textarea>
          <div style="display:flex;gap:10px;margin-top:12px">
            <button class="btn btn-primary" style="flex:1" data-act="imp-parse">🔍 解析文档</button>
          </div>
          <div class="imp-hint">
            支持的写法：<code>- [ ] 任务</code> 复选框、<code>|表格|</code>、<code># 标题</code> 分区（自动识别日期/周/月）；
            行内支持 <code>10:00-11:30</code>、<code>@10-28</code>、<code>!高</code>、<code>P0</code>、<code>40%</code>、<code>~2h</code>、<code>#标签</code>、<code>[固定]</code>、<code>【周】</code>
          </div>
        </div>
        <div class="card">
          <div class="card-title">📖 完整格式示例</div>
          <pre style="font-size:12px;line-height:1.8;background:var(--card2);border-radius:10px;padding:14px;overflow:auto;font-family:ui-monospace,Consolas,monospace">${UI.esc(
`# 项目冲刺计划
## 2026-11-02 ~ 2026-11-08 本周安排
- [ ] 完成登录模块开发 !高 ~4h
- [ ] 修复支付回调 bug P0
  - 复现步骤见 issue #123
- [x] 需求评审会议 14:00-15:30 [固定]
## 每日任务
- [ ] 09:30-10:00 每日站会 [固定]
## 本周任务
- [ ] 完成联调测试 60% #测试
## 本月目标
- [ ] 发布 v2.1 版本 20%`)}</pre>
        </div>
      </div>
      ${right}
    </div>`;
  },

  /* ============ 视图：文献管理 ============ */
  refsView() {
    const f = App.state.refs;
    let list = (Store.db.refs || []).slice();
    if (f.cat === '__none') list = list.filter(r => !String(r.cat || '').trim());
    else if (f.cat) list = list.filter(r => String(r.cat || '').trim() === f.cat);
    if (f.q) {
      const q = f.q.toLowerCase();
      list = list.filter(r => (r.title + ' ' + (r.authors || '') + ' ' + (r.venue || '') + ' ' + (r.tags || []).join(' ') + ' ' + (r.note || '')).toLowerCase().includes(q));
    }
    if (f.status) list = list.filter(r => r.status === f.status);
    if (f.type) list = list.filter(r => r.type === f.type);
    if (f.tag) list = list.filter(r => (r.tags || []).includes(f.tag));
    const sorters = {
      added: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
      year: (a, b) => (b.year || 0) - (a.year || 0),
      rating: (a, b) => (b.rating || 0) - (a.rating || 0)
    };
    list.sort(sorters[f.sort] || sorters.added);

    const st = Store.refStats();
    const cats = Store.refsCats();
    const uncat = (cats.find(c => c.name === '') || { count: 0 }).count;
    const allTags = [...new Set((Store.db.refs || []).flatMap(r => r.tags || []))].sort();
    const NEXT = { want: '在读', reading: '已读', read: '想读' };

    return `
    <div class="filter-bar">
      <div class="ref-badges">
        <span class="chip chip-purple" style="font-size:12px;padding:5px 12px">共 ${st.total} 篇</span>
        <span class="chip chip-gray">想读 ${st.want}</span>
        <span class="chip chip-blue">在读 ${st.reading}</span>
        <span class="chip chip-green">已读 ${st.read}</span>
        <span class="chip chip-amber">均分 ${st.avg}${st.avg !== '—' ? '★' : ''}</span>
      </div>
      <div style="margin-left:auto;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" data-act="ref-import">📥 导入 BibTeX</button>
        <button class="btn btn-ghost btn-sm" data-act="ref-export" ${st.total ? '' : 'disabled'}>📤 导出 BibTeX</button>
        <button class="btn btn-primary btn-sm" data-act="ref-new">＋ 添加文献</button>
      </div>
    </div>
    <div class="filter-bar">
      <button class="chip ${!f.cat ? 'chip-teal cat-chip' : 'chip-gray cat-chip'}" data-act="ref-cat" data-v="">全部 ${st.total}</button>
      <button class="chip ${f.cat === '__none' ? 'chip-teal cat-chip' : 'chip-gray cat-chip'}" data-act="ref-cat" data-v="__none">未分类 ${uncat}</button>
      ${cats.filter(c => c.name).map(c =>
        `<button class="chip ${f.cat === c.name ? 'chip-teal cat-chip' : 'chip-gray cat-chip'}" data-act="ref-cat" data-v="${UI.esc(c.name)}">📁 ${UI.esc(c.name)} ${c.count}</button>`).join('')}
      <button class="chip chip-gray cat-chip" data-act="ref-cat-manage" title="重命名 / 删除分类">⚙ 管理分类</button>
    </div>
    <div class="filter-bar">
      <input type="text" placeholder="搜索标题 / 作者 / 期刊 / 标签…" value="${UI.esc(f.q)}" data-act-input="ref-q" style="width:260px">
      <select data-act-change="ref-status">
        <option value="">全部状态</option>
        <option value="want" ${f.status === 'want' ? 'selected' : ''}>想读</option>
        <option value="reading" ${f.status === 'reading' ? 'selected' : ''}>在读</option>
        <option value="read" ${f.status === 'read' ? 'selected' : ''}>已读</option>
      </select>
      <select data-act-change="ref-type">
        <option value="">全部类型</option>
        ${Object.entries(Refs.TY).map(([k, v]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${v.l}</option>`).join('')}
      </select>
      <select data-act-change="ref-tag">
        <option value="">全部标签</option>
        ${allTags.map(g => `<option value="${UI.esc(g)}" ${f.tag === g ? 'selected' : ''}>#${UI.esc(g)}</option>`).join('')}
      </select>
      <select data-act-change="ref-sort">
        <option value="added" ${f.sort === 'added' ? 'selected' : ''}>按添加时间</option>
        <option value="year" ${f.sort === 'year' ? 'selected' : ''}>按年份</option>
        <option value="rating" ${f.sort === 'rating' ? 'selected' : ''}>按评分</option>
      </select>
      <span style="font-size:12px;color:var(--muted);margin-left:auto">显示 ${list.length} 篇</span>
    </div>
    ${list.length ? `<div class="ref-grid">
      ${list.map(r => {
        const sm = Refs.ST[r.status] || Refs.ST.want;
        const ty = Refs.TY[r.type] || Refs.TY.other;
        return `<div class="ref-card" data-act="open-ref" data-id="${r.id}">
          <div class="ref-top">
            <span class="chip chip-purple">${ty.l}</span>
            ${String(r.cat || '').trim() ? `<span class="chip chip-teal">📁 ${UI.esc(r.cat)}</span>` : ''}
            <span class="chip ${sm.c}">${sm.l}</span>
            ${r.rating ? `<span class="ref-stars" title="评分 ${r.rating}/5">${Refs.stars(r.rating)}</span>` : ''}
          </div>
          <div class="ref-title">${UI.esc(r.title)}</div>
          <div class="ref-authors">${UI.esc(r.authors || '（佚名）')}</div>
          <div class="ref-venue">${UI.esc(r.venue || '—')}${r.year ? ' · ' + r.year : ''}</div>
          ${(r.tags || []).length ? `<div class="tag-chip-list" style="margin-top:8px">${r.tags.map(g => `<span class="chip chip-purple" style="font-size:10px">#${UI.esc(g)}</span>`).join('')}</div>` : ''}
          ${r.status === 'reading' && r.readProgress ? `<div class="tc-foot" style="margin-top:9px">
            <div class="pbar tc-prog"><span style="width:${r.readProgress}%"></span></div><span class="tc-pct">${r.readProgress}%</span></div>` : ''}
          <div class="ref-foot">
            <button class="btn btn-ghost btn-sm" data-act="ref-cycle" data-id="${r.id}">标记${NEXT[r.status] || '在读'}</button>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-sm" data-act="ref-task" data-id="${r.id}" data-when="day" title="加入今日阅读任务">＋今日</button>
              <button class="btn btn-ghost btn-sm" data-act="ref-task" data-id="${r.id}" data-when="week" title="加入本周阅读计划">＋本周</button>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>` : `<div class="card">${UI.empty('📚', '这个分类下还没有文献', '调整分类筛选，或添加 / 导入文献',
      `<button class="btn btn-primary btn-sm" data-act="ref-new">＋ 添加文献</button>`)}</div>`}`;
  },

  /* ---------- 文献编辑弹窗 ---------- */
  refModal(id) {
    const r = id ? Store.getRef(id) : null;
    const isNew = !r;
    const d = r || { title: '', authors: '', year: '', type: 'paper', venue: '', doi: '', url: '', tags: [], status: 'want', rating: 0, readProgress: 0, abstract: '', note: '' };
    const seg = (group, val, label) =>
      `<button type="button" class="${d[group] === val ? 'active c-primary' : 'c-primary'}" data-act="seg" data-v="${val}">${label}</button>`;

    UI.modal({
      title: isNew ? '添加文献' : '文献详情',
      wide: true,
      body: `
        <div class="form-row"><label>标题 *</label>
          <input id="rTitle" type="text" value="${UI.esc(d.title)}" placeholder="论文 / 书籍 / 文章标题"></div>
        <div class="form-grid2">
          <div class="form-row"><label>作者（逗号分隔）</label>
            <input id="rAuthors" type="text" value="${UI.esc(d.authors)}" placeholder="Ian Goodfellow, Yoshua Bengio"></div>
          <div class="form-row"><label>年份</label>
            <input id="rYear" type="number" value="${d.year || ''}" placeholder="2024" min="1900" max="2100"></div>
        </div>
        <div class="form-grid2">
          <div class="form-row"><label>分类（输入名称即可新建）</label>
            <input id="rCat" type="text" value="${UI.esc(d.cat || '')}" list="rCatList" placeholder="例如：NLP / 强化学习 / 教材">
            <datalist id="rCatList">${Store.refsCats().filter(c => c.name).map(c => `<option value="${UI.esc(c.name)}">`).join('')}</datalist></div>
          <div class="form-row"><label>类型</label>
            <select id="rType">${Object.entries(Refs.TY).map(([k, v]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${v.l}</option>`).join('')}</select></div>
        </div>
        <div class="form-row"><label>期刊 / 会议 / 出版社</label>
          <input id="rVenue" type="text" value="${UI.esc(d.venue)}" placeholder="NeurIPS"></div>
        <div class="form-grid2">
          <div class="form-row"><label>DOI</label>
            <input id="rDoi" type="text" value="${UI.esc(d.doi)}" placeholder="10.xxxx/xxxxx"></div>
          <div class="form-row"><label>链接</label>
            <input id="rUrl" type="text" value="${UI.esc(d.url)}" placeholder="https://…"></div>
        </div>
        <div class="form-row"><label>阅读状态</label>
          <div class="seg" id="rStatus">${seg('status', 'want', '想读')}${seg('status', 'reading', '在读')}${seg('status', 'read', '已读')}</div></div>
        <div class="form-row"><label>评分</label>
          <div class="star-row" id="rStars">
            ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="star ${n <= (d.rating || 0) ? 'on' : ''}" data-act="ref-star" data-v="${n}">★</button>`).join('')}
            <span style="font-size:12px;color:var(--muted);margin-left:8px">点击设置</span>
          </div></div>
        <div class="form-row"><label>阅读进度</label>
          <div class="range-row"><input id="rProg" type="range" min="0" max="100" step="5" value="${d.readProgress || 0}" data-act-input="rProg"><b id="rProgVal">${d.readProgress || 0}%</b></div></div>
        <div class="form-row"><label>标签（逗号分隔）</label>
          <input id="rTags" type="text" value="${UI.esc((d.tags || []).join(', '))}" placeholder="深度学习, 大模型"></div>
        <div class="form-row"><label>摘要</label>
          <textarea id="rAbstract" style="min-height:56px">${UI.esc(d.abstract || '')}</textarea></div>
        <div class="form-row"><label>阅读笔记</label>
          <textarea id="rNote">${UI.esc(d.note || '')}</textarea></div>
        ${d.source ? `<div class="src-note">来源：${UI.esc(d.source)}</div>` : ''}`,
      foot: `${!isNew ? `<button class="btn btn-danger left" data-act="ref-delete" data-id="${d.id}">删除</button>` : ''}
             ${d.url ? `<a class="btn btn-ghost" href="${UI.esc(d.url)}" target="_blank" rel="noopener" style="text-decoration:none">🔗 打开链接</a>` : ''}
             <button class="btn btn-ghost" data-act="close-modal">取消</button>
             <button class="btn btn-primary" data-act="ref-save" data-id="${isNew ? '' : d.id}">保存</button>`
    });
    const ti = document.getElementById('rTitle');
    if (ti) { ti.focus(); if (!isNew) ti.select(); }
  },

  /* ---------- BibTeX 导入弹窗 ---------- */
  refImportModal() {
    const imp = Refs._imp;
    UI.modal({
      title: '📥 导入 BibTeX',
      wide: true,
      body: !imp ? `
        <div class="imp-file" data-act="bib-file-click" style="margin-bottom:12px">
          <div style="font-size:26px;margin-bottom:6px">📄</div>
          点击选择 .bib 文件（可从 Zotero / EndNote / Google Scholar 导出）
          <input type="file" id="bibFile" accept=".bib,.txt" style="display:none" data-act-change="bib-file">
        </div>
        <textarea class="imp-textarea" id="bibText" placeholder="也可以直接粘贴 BibTeX 内容…&#10;&#10;@article{vaswani2017attention,&#10;  title={Attention Is All You Need},&#10;  author={Vaswani, Ashish and Shazeer, Noam},&#10;  journal={NeurIPS},&#10;  year={2017}&#10;}"></textarea>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn btn-primary" style="flex:1" data-act="bib-parse">🔍 解析 BibTeX</button>
        </div>`
        : `
        <div class="brief-sec">
          <h4>解析结果 <span class="n">${imp.refs.length} 篇</span></h4>
          ${imp.warnings.length ? `<div class="warn-box">${imp.warnings.map(w => '· ' + UI.esc(w)).join('<br>')}</div>` : ''}
          <div class="form-row" style="margin-top:12px"><label>导入到分类（可选，对本批全部生效）</label>
            <input id="bibCat" type="text" list="bibCatList" placeholder="留空为未分类，例如：NLP">
            <datalist id="bibCatList">${Store.refsCats().filter(c => c.name).map(c => `<option value="${UI.esc(c.name)}">`).join('')}</datalist></div>
          <div style="overflow:auto;max-height:380px;margin-top:10px">
          <table class="imp-table"><thead><tr>
            <th></th><th style="min-width:220px">标题</th><th style="min-width:160px">作者</th><th>年份</th><th>类型</th><th>状态</th>
          </tr></thead><tbody>
            ${imp.refs.map((r, i) => `<tr>
              <td><input type="checkbox" class="imp-ck" data-i="${i}" checked></td>
              <td><input type="text" value="${UI.esc(r.title)}" data-i="${i}" data-f="title"></td>
              <td><input type="text" value="${UI.esc(r.authors)}" data-i="${i}" data-f="authors"></td>
              <td><input type="number" value="${r.year || ''}" style="width:70px" data-i="${i}" data-f="year"></td>
              <td><select data-i="${i}" data-f="type">${Object.entries(Refs.TY).map(([k, v]) => `<option value="${k}" ${r.type === k ? 'selected' : ''}>${v.l}</option>`).join('')}</select></td>
              <td><select data-i="${i}" data-f="status">
                <option value="want" ${r.status === 'want' ? 'selected' : ''}>想读</option>
                <option value="reading" ${r.status === 'reading' ? 'selected' : ''}>在读</option>
                <option value="read" ${r.status === 'read' ? 'selected' : ''}>已读</option>
              </select></td>
            </tr>`).join('')}
          </tbody></table></div>
          <div style="display:flex;align-items:center;gap:12px;margin-top:14px">
            <span style="font-size:12.5px;color:var(--muted)">已选 <b id="impCount">${imp.refs.length}</b> / ${imp.refs.length} 篇</span>
            <button class="btn btn-primary" style="margin-left:auto" data-act="bib-do">✅ 确认导入</button>
            <button class="btn btn-ghost" data-act="bib-clear">重新解析</button>
          </div>
        </div>`
    });
  },

  /* ============ 视图：周报月报（文档写作） ============ */
  DOCTYPE: { week: { l: '周报', c: 'chip-teal' }, month: { l: '月报', c: 'chip-purple' }, other: { l: '文档', c: 'chip-gray' } },

  docsView() {
    const s = App.state.docs;
    if (s.mode === 'edit') return UI.docEditor();
    const f = s.filter;
    let list = (Store.db.docs || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (f !== 'all') list = list.filter(d => d.type === f);
    const total = (Store.db.docs || []).length;
    const cnt = t => (Store.db.docs || []).filter(d => d.type === t).length;
    const snippet = c => String(c || '')
      .replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/[#>*`~$\[\]()!|-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 86);

    return `
    <div class="filter-bar">
      <button class="chip ${f === 'all' ? 'chip-purple' : 'chip-gray'}" style="font-size:12px;padding:6px 12px;cursor:pointer" data-act="doc-filter" data-v="all">全部 ${total}</button>
      ${Object.entries(UI.DOCTYPE).map(([k, v]) =>
        `<button class="chip ${f === k ? 'chip-purple' : 'chip-gray'}" style="font-size:12px;padding:6px 12px;cursor:pointer" data-act="doc-filter" data-v="${k}">${v.l} ${cnt(k)}</button>`).join('')}
      <div style="margin-left:auto;display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" data-act="doc-new" data-v="week">＋ 周报</button>
        <button class="btn btn-primary btn-sm" data-act="doc-new" data-v="month">＋ 月报</button>
      </div>
    </div>
    ${list.length ? `<div class="ref-grid">
      ${list.map(d => {
        const ty = UI.DOCTYPE[d.type] || UI.DOCTYPE.other;
        return `<div class="doc-card" data-act="doc-open" data-id="${d.id}">
          <div class="ref-top">
            <span class="chip ${ty.c}">${ty.l}</span>
            ${d.sub ? `<span class="doc-sub">${UI.esc(d.sub)}</span>` : ''}
            <span class="doc-time">${U.relDay(U.dateStr(new Date(d.updatedAt || Date.now())))}</span>
          </div>
          <div class="doc-title">${UI.esc(d.title)}</div>
          ${snippet(d.content) ? `<div class="doc-snippet">${UI.esc(snippet(d.content))}</div>` : ''}
        </div>`;
      }).join('')}
    </div>` : UI.empty('📝', '还没有周报 / 月报', '新建一篇，支持图片、LaTeX 公式和代码块',
      `<button class="btn btn-primary btn-sm" data-act="doc-new" data-v="week">＋ 新建周报</button>`)}`;
  },

  docEditor() {
    const d = Store.getDoc(App.state.docs.editing);
    if (!d) return UI.empty('🤔', '文档不存在', '可能已被删除', `<button class="btn btn-primary btn-sm" data-act="doc-back">返回列表</button>`);
    const ro = !!Store.readOnly;
    const ty = UI.DOCTYPE[d.type] || UI.DOCTYPE.other;

    return `
    <div class="ndoc-wrap">
      <div class="ndoc-top">
        <button class="icon-btn" data-act="doc-back" title="返回列表">
          <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="ndoc-meta">
          ${ro
            ? `<span class="chip ${ty.c}">${ty.l}</span>${d.sub ? `<span class="ndoc-subtext">${UI.esc(d.sub)}</span>` : ''}`
            : `<select id="docType" data-act-change="doc-type">
                ${Object.entries(UI.DOCTYPE).map(([k, v]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${v.l}</option>`).join('')}
               </select>`}
        </div>
        <div class="ndoc-top-r">
          ${ro ? `<span class="chip chip-gray">👁 只读</span>` : `<span class="ndoc-save">已自动保存</span>
            <button class="icon-btn" data-act="doc-del" title="删除文档" style="color:var(--red)">
              <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>`}
        </div>
      </div>
      <div class="ndoc-scroll">
        <div class="ndoc-page">
          ${ro
            ? `<h1 class="ndoc-title">${UI.esc(d.title || '未命名文档')}</h1>`
            : `<input id="docTitle" class="ndoc-title-in" type="text" value="${UI.esc(d.title)}" placeholder="无标题" data-act-input="doc-title" autocomplete="off">
               <input id="docSub" class="ndoc-sub-in" type="text" value="${UI.esc(d.sub || '')}" placeholder="期号 / 时间段（可选）" data-act-input="doc-sub" autocomplete="off">`}
          <div id="ndocHost"></div>
          ${ro ? '' : `<div class="ndoc-hint">点击正文任意位置开始编辑 · 键入 <b>/</b> 插入标题、列表、任务、<b>公式</b>、图片、代码块 · <b>Enter</b> 分段</div>`}
        </div>
      </div>
    </div>`;
  },

  /* ============ 视图：AI 助手（DeepSeek 风格对话） ============ */
  aiMsg(m, i, o = {}) {
    if (m.role === 'user') {
      return `<div class="ai-row user"><div class="ai-bubble">${UI.esc(m.content)}</div></div>`;
    }
    const thinking = o.streaming && !m.content;
    const fish = typeof Pet !== 'undefined' ? Pet.logoHTML() : '⚡';
    return `<div class="ai-row bot">
      <div class="ai-avatar">${fish}</div>
      <div class="ai-content">
        ${m.reasoning ? `<details class="ai-think" ${thinking ? 'open' : ''}>
          <summary>🧠 深度思考${thinking ? '中…' : '过程'}</summary>
          <pre class="ai-think-body" id="aiThink-${i}">${UI.esc(m.reasoning)}</pre></details>` : ''}
        <div class="ai-md md-preview" id="aiMd-${i}">${m.content ? MD.render(m.content) : (o.streaming ? '<span class="ai-caret"></span>' : '<span style="color:var(--muted)">…</span>')}</div>
        ${o.showActs && m.content ? `<div class="ai-acts">
          <button class="btn btn-ghost btn-sm" data-act="ai-copy" data-i="${i}">复制</button>
          ${o.isLast ? `<button class="btn btn-ghost btn-sm" data-act="ai-regen">重新生成</button>` : ''}
        </div>` : ''}
      </div>
    </div>`;
  },

  aiView() {
    const st = App.state.ai;
    const chats = (Store.db.chats || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const chat = st.cur ? Store.getChat(st.cur) : null;
    const msgs = chat ? chat.messages : [];
    const lastBot = (() => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant') return i; return -1; })();
    const fish = typeof Pet !== 'undefined' ? Pet.logoHTML() : '⚡';

    return `
    <div class="ai-wrap">
      <div class="ai-head">
        <select class="ai-chat-sel" data-act-change="ai-select" title="历史对话">
          ${chats.length ? chats.map(c => `<option value="${c.id}" ${st.cur === c.id ? 'selected' : ''}>${UI.esc(c.title || '新对话')}</option>`).join('')
            : '<option value="">新对话</option>'}
        </select>
        <button class="btn btn-ghost btn-sm" data-act="ai-new">＋ 新对话</button>
        ${chat && msgs.length ? `<button class="btn btn-ghost btn-sm" data-act="ai-del" style="color:var(--red)">🗑 删除</button>` : ''}
      </div>
      <div class="ai-msgs" id="aiMsgs">
        ${msgs.length ? msgs.map((m, i) => UI.aiMsg(m, i, { streaming: false, showActs: true, isLast: i === lastBot })).join('') : `
        <div class="ai-welcome">
          <div class="ai-wl-logo">${fish}</div>
          <div class="ai-wl-title">有什么可以帮你？</div>
          <div class="ai-wl-sub">小鲸已接入你的工作台数据 —— 总结与规划今日、本周、本月的任务，或随便聊点什么</div>
          <div class="ai-quick">
            ${AI.QUICK.map(q => `
            <button class="ai-qcard" data-act="ai-quick" data-k="${q.k}">
              <span class="ai-qicon">${q.icon}</span>
              <span><b>${q.title}</b><i>${q.sub}</i></span>
            </button>`).join('')}
          </div>
        </div>`}
      </div>
      <div class="ai-composer-wrap">
        <div class="ai-composer">
          <textarea id="aiInput" rows="1" placeholder="给小鲸发消息…（Enter 发送 · Shift+Enter 换行）"></textarea>
          <div class="ai-composer-bar">
            <button class="ai-model-chip" data-act="ai-config" title="更换模型 / API">🐋 ${UI.esc(AI.model())}<svg viewBox="0 0 24 24" class="mc-caret"><polyline points="6 9 12 15 18 9"/></svg></button>
            <div style="flex:1"></div>
            ${st.streaming
              ? `<button class="ai-send stop" data-act="ai-stop" title="停止生成"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg></button>`
              : `<button class="ai-send" data-act="ai-send" title="发送"><svg viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg></button>`}
          </div>
        </div>
        <div class="ai-hint">⚠️ AI 生成内容仅供参考 · 对话随工作台数据云端同步 · 快捷指令会自动附带当前任务数据</div>
      </div>
    </div>`;
  },

  /* ---------- 文献分类管理弹窗 ---------- */
  refCatManageModal() {
    const cats = Store.refsCats();
    UI.modal({
      title: '📁 管理文献分类',
      body: `
        <div style="font-size:12.5px;color:var(--muted);line-height:1.7;margin-bottom:14px">
          重命名会同步更新该分类下的所有文献；「未分类」改名可把全部未分类文献批量归入新分类；
          删除分类后文献变为未分类（不会删除文献本身）。新建分类：编辑文献时在「分类」一栏填写即可。
        </div>
        ${cats.map(c => `
        <div class="cat-mg-row">
          <input type="text" value="${UI.esc(c.name)}" placeholder="${c.name === '' ? '（未分类）' : ''}" data-catinput="${UI.esc(c.name)}">
          <span class="chip chip-gray">${c.count} 篇</span>
          <button class="btn btn-ghost btn-sm" data-act="ref-cat-rename" data-old="${UI.esc(c.name)}">重命名</button>
          ${c.name === '' ? '' : `<button class="btn btn-danger btn-sm" data-act="ref-cat-del" data-old="${UI.esc(c.name)}">删除</button>`}
        </div>`).join('')}`
    });
  }
};
