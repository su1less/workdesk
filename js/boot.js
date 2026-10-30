/* ============================================================
 * boot.js — 启动动画（参考 DeepSeek Harness 启动插件的分幕结构）
 * 全局命名空间：Boot
 *
 * 四幕：黑幕标识 → 过曝洗白 → 技术档案授权序列 → 色散故障揭幕。
 * 点击 / Esc / 回车可随时跳过；每次浏览器会话只播一次
 * （sessionStorage），可在设置里关闭（settings.boot === false）。
 * ============================================================ */

const Boot = {

  _skip: null,

  enabled() { return Store.db && Store.db.settings && Store.db.settings.boot !== false; },

  /* 播放完（或跳过）后 resolve */
  play() {
    return new Promise(resolve => {
      if (!this.enabled() || sessionStorage.getItem('wb.boot') === '1') return resolve();
      sessionStorage.setItem('wb.boot', '1');

      const LINES = [
        ['需要访问许可', 'ACCESS PERMISSION REQUIRED'],
        ['身份资料确认', 'IDENTITY VERIFICATION'],
        ['接收访问需求', 'ACCESS REQUEST RECEIVED'],
        ['读取完毕 · 核验通过', 'READ COMPLETE · VERIFIED']
      ];

      const root = document.createElement('div');
      root.id = 'bootScreen';
      root.innerHTML = `
        <div class="boot-act1">
          <div class="boot-ring"></div>
          <div class="boot-logo">⚡</div>
          <div class="boot-name">工作台</div>
          <div class="boot-en" id="bootType"></div>
          <div class="boot-foot">PROFESSIONAL WORK MODE</div>
        </div>
        <div class="boot-flash"></div>
        <div class="boot-act3">
          <div class="boot-panel">
            <div class="boot-head"><span class="boot-dot"></span>WORKDESK OS · 技术档案 <span class="boot-ver">v2.0</span></div>
            <div class="boot-title">正在建立工作环境</div>
            <div class="boot-lines" id="bootLines"></div>
            <div class="boot-bar"><span id="bootBar"></span></div>
            <div class="boot-pct" id="bootPct">0%</div>
          </div>
          <div class="boot-tip">点击任意位置跳过</div>
        </div>
        <div class="boot-glitch"></div>`;
      document.body.appendChild(root);

      /* 打字机：WORKDESK HARNESS */
      const typeEl = root.querySelector('#bootType');
      const TXT = 'WORKDESK HARNESS';
      let ti = 0;
      const typer = setInterval(() => {
        ti++;
        typeEl.textContent = TXT.slice(0, ti) + (ti < TXT.length ? '▌' : '');
        if (ti >= TXT.length) clearInterval(typer);
      }, 70);

      /* 第三幕授权序列 + 进度 */
      const linesEl = root.querySelector('#bootLines');
      const barEl = root.querySelector('#bootBar');
      const pctEl = root.querySelector('#bootPct');
      let li = 0, pct = 0;
      const lineTimer = setInterval(() => {
        if (li >= LINES.length) { clearInterval(lineTimer); return; }
        const [zh, en] = LINES[li++];
        const row = document.createElement('div');
        row.className = 'boot-line';
        row.innerHTML = `<span class="boot-ok">▸</span><b>${zh}</b><i>${en}</i>`;
        linesEl.appendChild(row);
      }, 620);
      const pctTimer = setInterval(() => {
        pct = Math.min(100, pct + 3 + Math.random() * 7);
        barEl.style.width = pct + '%';
        pctEl.textContent = Math.round(pct) + '%';
        if (pct >= 100) clearInterval(pctTimer);
      }, 90);

      /* 幕次时间轴（毫秒） */
      const T1 = 1500, T2 = 2100, T3 = 4300, T4 = 5000;
      const acts = [
        [T1, () => root.classList.add('at-flash')],
        [T2, () => root.classList.add('at-panel')],
        [T3, () => root.classList.add('at-glitch')],
        [T4, () => finish()]
      ];
      const timers = acts.map(([t, fn]) => setTimeout(fn, t));

      const finish = () => {
        timers.forEach(clearTimeout);
        clearInterval(typer); clearInterval(lineTimer); clearInterval(pctTimer);
        root.classList.add('boot-out');
        setTimeout(() => { root.remove(); }, 450);
        cleanup();
        resolve();
      };
      const skip = () => finish();
      const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') skip(); };
      const cleanup = () => {
        root.removeEventListener('click', skip);
        document.removeEventListener('keydown', onKey);
      };
      root.addEventListener('click', skip);
      document.addEventListener('keydown', onKey);
      this._skip = skip;
    });
  }
};
