/* ============================================================
 * ai.js — AI 助手：接入 GLM / DeepSeek 等大模型（OpenAI 兼容格式）
 * 全局命名空间：AI（视图在 ui.js，交互在 app.js）
 *
 * 请求路径按运行环境自动适配：
 *   · 自建服务器模式 → 经 /api/ai 由服务器流式代理（无跨域限制）
 *   · 本地 / GitHub 模式 → 浏览器直连服务商接口
 * 输出为 SSE 流式（stream:true），支持 deepseek-reasoner 的
 * reasoning_content（深度思考过程折叠展示）。
 * API Key 只保存在本设备浏览器 localStorage，服务器不落盘。
 * ============================================================ */

const AI = {

  /* 内置默认接口：不配置也能直接用（flash 系列免费）。换成自己的 Key 在设置里保存即可 */
  DEFAULT_CFG: {
    provider: 'glm',
    key: 'd131300cbbc24f2a84633963a25ced66.ms6vWHYVPle42cVn',
    model: 'glm-5.3-flash'
  },

  PROVIDERS: {
    glm: {
      name: '智谱 GLM',
      url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      models: ['glm-5.3-flash', 'glm-5.3-flashx', 'glm-4.7-flash', 'glm-4.5-flash', 'glm-4-flash'],
      def: 'glm-5.3-flash'
    },
    deepseek: {
      name: 'DeepSeek',
      url: 'https://api.deepseek.com/chat/completions',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      def: 'deepseek-chat'
    },
    custom: {
      name: '自定义（OpenAI 兼容）',
      url: '',
      models: [],
      def: ''
    }
  },

  /* ---------- 配置（localStorage: wb.ai；未配置自定义 API 时静默使用内置接口） ----------
   * 页面上永不显示内置 Key：cfg() 仅供发起请求时内部取用；
   * 界面回显一律走 savedCfg()（只含用户自己保存的内容）。 */
  cfg() {
    const o = this.savedCfg();
    if (o.provider && this.PROVIDERS[o.provider] && o.key) return o;   /* 自定义 API 完整覆盖 */
    return { provider: this.DEFAULT_CFG.provider, key: this.DEFAULT_CFG.key,
      model: o.model || this.DEFAULT_CFG.model, url: '' };
  },

  /* 本机保存的原始配置（可能只有 model；绝不包含内置 Key） */
  savedCfg() {
    try { return JSON.parse(localStorage.getItem('wb.ai') || 'null') || {}; } catch (e) { return {}; }
  },

  /* 是否仍在使用内置接口（未配置自定义 Key） */
  isDefault() {
    const o = this.savedCfg();
    return !(o.provider && this.PROVIDERS[o.provider] && o.key);
  },

  ep() {
    const c = this.cfg();
    return c.provider === 'custom' ? (c.url || '').trim() : this.PROVIDERS[c.provider].url;
  },

  model() {
    const c = this.cfg();
    return c.model || this.PROVIDERS[c.provider].def || '';
  },

  label() {
    const c = this.cfg();
    return this.PROVIDERS[c.provider].name + ' · ' + this.model();
  },

  settingsModal(msg) {
    const cur = this.cfg();
    const saved = this.savedCfg();
    const isDef = this.isDefault();
    const prov = isDef ? this.DEFAULT_CFG.provider : cur.provider;
    const p = this.PROVIDERS[prov];
    const modelCtrl = p.models.length
      ? `<select id="aiModel">${p.models.map(m => `<option value="${m}" ${cur.model === m ? 'selected' : ''}>${m}</option>`).join('')}
         ${p.models.includes(cur.model) ? '' : `<option value="${UI.esc(cur.model)}" selected>${UI.esc(cur.model)}</option>`}</select>`
      : `<input id="aiModel" type="text" value="${UI.esc(cur.model || '')}" placeholder="填写模型名">`;

    UI.modal({
      title: '⚡ AI 模型与接口',
      body: `
        ${msg ? `<div class="warn-box" style="margin:0 0 14px">${UI.esc(msg)}</div>` : ''}
        <div class="form-row"><label>AI 模型${isDef ? '（内置免费接口 · 开箱即用）' : '（自定义接口）'}</label>
          ${modelCtrl}
          <div style="font-size:11.5px;color:var(--muted);margin-top:5px">当前接口：${isDef ? '内置默认（密钥不显示、不出现在页面中）' : UI.esc(this.PROVIDERS[prov].name) + ' · 自定义密钥已保存本机'}</div></div>
        <div id="aiAdv" style="display:${isDef ? 'none' : ''}">
          <div class="form-row"><label>服务商</label>
            <select id="aiProv">
              ${Object.entries(this.PROVIDERS).map(([k, v]) => `<option value="${k}" ${prov === k ? 'selected' : ''}>${v.name}</option>`).join('')}
            </select></div>
          <div class="form-row"><label>API Key</label>
            <input id="aiKey" type="password" value="${UI.esc(saved.key || '')}" placeholder="${isDef ? '粘贴你自己的 API Key' : '已保存 · 留空则恢复内置接口'}" autocomplete="off">
            <div style="font-size:11.5px;color:var(--muted);margin-top:5px">只保存在本设备浏览器，不上传服务器存储，页面不回显。获取：智谱 open.bigmodel.cn → API 密钥；DeepSeek platform.deepseek.com → API Keys</div></div>
          <div class="form-row" id="aiUrlRow" style="${prov === 'custom' ? '' : 'display:none'}"><label>接口地址（OpenAI 兼容 /chat/completions）</label>
            <input id="aiUrl" type="text" value="${UI.esc(saved.url || '')}" placeholder="https://…/v1/chat/completions"></div>
          <div class="warn-box" style="font-size:12px;line-height:1.8">
            服务器模式：经 <code>/api/ai</code> 由服务器代理转发（无跨域限制）；默认放行 DeepSeek / 智谱官方域名，自定义域名需加入服务器环境变量 <code>WB_AI_HOSTS</code>。<br>
            本地 / GitHub Pages 模式：浏览器直连服务商，不允许跨域时会失败。
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" data-act="ai-toggle-adv">🔑 更换 API${isDef ? '' : '（已使用自定义）'}</button>`,
      foot: `${isDef ? '' : `<button class="btn btn-danger left" data-act="ai-clear">恢复内置接口</button>`}
             <button class="btn btn-ghost" data-act="close-modal">取消</button>
             <button class="btn btn-primary" data-act="ai-save">保存</button>`
    });
    const sel = document.getElementById('aiProv');
    if (sel) sel.addEventListener('change', e => {
      const np = this.PROVIDERS[e.target.value] || { models: [], def: '' };
      const row = document.getElementById('aiUrlRow');
      if (row) row.style.display = e.target.value === 'custom' ? '' : 'none';
      /* 切换服务商后重建模型控件 */
      const holder = document.getElementById('aiModel').parentElement;
      const cur2 = holder.querySelector('#aiModel');
      const fresh = np.models.length
        ? `<select id="aiModel">${np.models.map(m => `<option value="${m}">${m}</option>`).join('')}</select>`
        : `<input id="aiModel" type="text" value="" placeholder="填写模型名">`;
      cur2.outerHTML = fresh;
    });
  },

  saveSettings() {
    const g = id => (document.getElementById(id).value || '').trim();
    const advOpen = document.getElementById('aiAdv').style.display !== 'none';
    if (advOpen) {
      const provider = g('aiProv');
      const key = g('aiKey');
      const url = g('aiUrl');
      if (!key) { UI.toast('请填写 API Key（留空请改用「恢复内置接口」）', 'warn'); return; }
      if (provider === 'custom' && !/^https?:\/\/.+/.test(url)) { UI.toast('自定义接口地址需以 http(s):// 开头', 'warn'); return; }
      const model = g('aiModel') || this.PROVIDERS[provider].def || '';
      localStorage.setItem('wb.ai', JSON.stringify({ provider, key, model, url }));
      UI.closeModal();
      UI.toast('🔑 已启用自定义 API：' + this.label());
    } else {
      localStorage.setItem('wb.ai', JSON.stringify({ model: g('aiModel') || this.DEFAULT_CFG.model }));
      UI.closeModal();
      UI.toast('🐋 模型已切换：' + this.label());
    }
    App.render();
  },

  clearSettings() {
    UI.confirm('清除后需要重新填写 API Key 才能使用 AI 助手。确定清除？', { danger: true, okText: '清除' }).then(ok => {
      if (ok) { localStorage.removeItem('wb.ai'); UI.closeModal(); UI.toast('已清除 AI 配置'); App.render(); }
    });
  },

  /* ---------- 快捷指令（欢迎页卡片） ---------- */
  QUICK: [
    { k: 'day-sum', icon: '🌅', title: '今日总结', sub: '回顾今天完成与遗留', scope: 'day',
      prompt: '请根据我今天的任务数据，生成一份今日总结：分「已完成 / 进行中 / 未完成」三部分，逐项简要点评，最后给一句整体评价与明日提醒。' },
    { k: 'week-sum', icon: '📅', title: '本周总结', sub: '本周进展与完成率点评', scope: 'week',
      prompt: '请根据本周的任务数据，生成一份本周总结：本周完成率、主要进展、未完成事项及原因推测，并用表格列出下周应优先处理的事项。' },
    { k: 'month-sum', icon: '🗓️', title: '本月总结', sub: '月度目标达成情况', scope: 'month',
      prompt: '请根据本月的任务与目标数据，生成一份月度总结：各月目标完成情况、整体进度评价、遗留风险，以及下月的改进建议。' },
    { k: 'day-plan', icon: '✅', title: '今日待办建议', sub: '按时间段排出优先顺序', scope: 'day',
      prompt: '请根据今天的任务、时间块与此前遗留事项，给出今日待办安排建议：按时间段排出执行顺序，说明理由，标出必须优先完成的事项和可以放弃/顺延的事项。' },
    { k: 'week-plan', icon: '📆', title: '本周规划建议', sub: '周任务拆解到每天', scope: 'week',
      prompt: '请根据本周任务和每日安排，给出本周规划建议：把周任务拆解到具体某天完成，考虑已有日程冲突，标注每天的重点。' },
    { k: 'month-plan', icon: '🎯', title: '本月规划建议', sub: '月目标推进节奏', scope: 'month',
      prompt: '请根据本月目标与当前进度，给出本月剩余时间的推进建议：每个目标按周给出里程碑，指出落后于进度的目标及追赶方案。' }
  ],

  /* ---------- 系统提示词 ---------- */
  system() {
    return '你是「工作台」应用里的 AI 秘书。用户会把自己的任务 / 日程 / 文献数据发给你，请只基于这些数据回答，不要编造不存在的任务。'
      + '要求：用简体中文（用户用其他语言提问时跟随用户的语言）；用 Markdown 排版（分节标题、列表、加粗、必要时用表格）；'
      + '总结类回答分「已完成 / 进行中 / 未完成」并给出简短评价；建议类回答要具体、可执行，考虑优先级、时间冲突与遗留事项；'
      + '语气专业友好，简洁不啰嗦，不要重复罗列原始数据。';
  },

  /* ---------- 上下文组装（scope: day | week | month | auto） ---------- */
  ctxTask(t) {
    const st = { todo: '待办', doing: '进行中', done: '已完成' }[t.status] || '待办';
    const pr = { high: '高', mid: '中', low: '低' }[t.priority] || '中';
    let s = '- ' + (t.start ? t.start + (t.end ? '-' + t.end : '') + ' ' : '') + t.title
      + '（' + st + (t.progress ? ' ' + t.progress + '%' : '')
      + '，' + pr + '优先'
      + (t.kind === 'event' ? '，日程' : '')
      + (t.fixed ? '，固定不可移' : '')
      + (t.sudden ? '，突发' : '') + '）';
    if (t.note) s += ' ｜备注：' + String(t.note).replace(/\s+/g, ' ').slice(0, 60);
    return s;
  },

  _taskLines(list, cap) {
    if (!list || !list.length) return '（无）';
    return list.slice(0, cap || 40).map(t => this.ctxTask(t)).join('\n')
      + (list.length > (cap || 40) ? '\n- …等共 ' + list.length + ' 项' : '');
  },

  buildContext(scope) {
    const T = U.todayStr();
    const L = [];
    const od = Store.overdue(T);
    if (od.length) L.push('【此前遗留未完成 ' + od.length + ' 项】\n' + od.slice(0, 8).map(t => '- ' + t.title + '（原定 ' + t.date + '）').join('\n'));

    if (scope === 'day' || scope === 'auto') {
      const day = Store.dayItems(T);
      L.push('【今日 ' + T + '（' + U.fmtWeekCN(T) + '）安排】\n' + this._taskLines(day.all));
    }
    if (scope === 'week' || scope === 'auto') {
      const ws = U.weekStart(T);
      const st = Store.weekStats(ws);
      L.push('【本周 ' + ws + ' ~ ' + U.weekEnd(ws) + ' · 完成率 ' + st.pct + '%（' + st.done + '/' + st.total + '）】\n'
        + (st.week.total ? '周任务：\n' + this._taskLines(Store.weekTasks(ws)) : '（本周暂无周任务）'));
      if (scope === 'week') {
        for (let i = 0; i < 7; i++) {
          const d = U.addDays(ws, i);
          const items = Store.dayItems(d).all;
          if (items.length) L.push(d + '（' + U.fmtWeekCN(d) + '）：\n' + this._taskLines(items, 20));
        }
      }
    }
    if (scope === 'month' || scope === 'auto') {
      const mk = U.monthKey(T);
      const st = Store.monthStats(mk);
      L.push('【本月 ' + mk + ' · 完成率 ' + st.pct + '%（' + st.done + '/' + st.total + '）】\n'
        + (st.month.total ? '月目标：\n' + this._taskLines(Store.monthTasks(mk)) : '（本月暂无目标）'));
    }
    const reading = (Store.db.refs || []).filter(r => r.status === 'reading');
    if (reading.length) L.push('【在读文献】\n' + reading.slice(0, 8).map(r => '- ' + r.title + '（' + (r.readProgress || 0) + '%）').join('\n'));
    return L.join('\n\n');
  },

  /* ---------- 流式对话（SSE） ----------
   * messages: [{role:'system'|'user'|'assistant', content}]
   * onDelta(content, reasoning) 流式回调（节流由调用方控制）
   * 返回 { content, reasoning }；中途 abort 抛 name==='AbortError' */
  _ctrl: null,

  stop() { if (this._ctrl) { try { this._ctrl.abort(); } catch (e) {} } },

  async chat(messages, onDelta) {
    const cfg = this.cfg();
    if (!cfg) throw new Error('尚未配置 AI 接口，请点击右上角模型标签设置');
    const url = this.ep();
    if (!url) throw new Error('接口地址为空，请检查 AI 设置');
    const payload = { model: this.model(), messages, stream: true, temperature: 0.7 };

    this._ctrl = new AbortController();
    const signal = this._ctrl.signal;
    let res;
    try {
      if (typeof Sync !== 'undefined' && Sync.mode === 'server') {
        res = await fetch('api/ai', {
          method: 'POST', headers: Sync.headers(), signal,
          body: JSON.stringify({ url, key: cfg.key, data: payload })
        });
      } else {
        res = await fetch(url, {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
          body: JSON.stringify(payload)
        });
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('网络请求失败（' + e.message + '）'
        + (!(typeof Sync !== 'undefined' && Sync.mode === 'server')
          ? '。当前为浏览器直连模式，服务商不允许跨域时会失败，建议使用自建服务器模式' : ''));
    }
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try {
        const j = await res.json();
        msg = (j.error && (j.error.message || j.error)) || j.message || msg;
      } catch (e) {}
      if (res.status === 401) msg = 'API Key 无效或已过期（' + msg + '）';
      throw new Error(String(msg));
    }

    let content = '', reasoning = '';
    const rd = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const emit = () => { if (onDelta) onDelta(content, reasoning); };
    while (true) {
      const r = await rd.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim();
        if (d === '[DONE]') { buf = ''; break; }
        let j = null;
        try { j = JSON.parse(d); } catch (e) { continue; }
        const ch = (j.choices && j.choices[0]) || {};
        const dl = ch.delta || ch.message || {};
        if (dl.reasoning_content) { reasoning += dl.reasoning_content; emit(); }
        if (dl.content) { content += dl.content; emit(); }
      }
    }
    if (!content && !reasoning) throw new Error('模型未返回内容（请检查模型名是否正确）');
    return { content, reasoning };
  }
};
