/* ============================================================
 * gate.js — 网页门禁（静态托管适用：GitHub Pages / Vercel / Netlify）
 *
 * 原理：仓库根目录的 site-config.json 存放门禁口令的 PBKDF2 哈希
 * （在「设置 → 网页门禁密码」中生成，经 GitHub API 自动提交，公开无妨）。
 * 任何设备打开网页时先拉取该文件校验口令；通过后本机记住
 * （记住的是哈希前缀，改密码后所有设备自动要求重新输入）。
 *
 * 定位：防"知道网址的路人"直接看到界面；数据本身的机密性由
 * GitHub 同步的加密口令 + 访问令牌保证。纯前端校验可被技术
 * 手段绕过，但绕过后看到的也只是空白本地模式，没有数据。
 * ============================================================ */

const Gate = {

  /* PBKDF2(120k, SHA-256) → 256bit hex，与保存格式一致 */
  async deriveHash(pass, saltB64) {
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, km, 256);
    return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
  },

  /* App 启动时调用：无门禁/本机已通过 → 立即放行；否则显示门禁并等待通过 */
  init() {
    return new Promise(async resolve => {
      if (!/^https?:$/.test(location.protocol)) return resolve();
      let cfg = null;
      try {
        const r = await fetch('site-config.json?t=' + Date.now(), { cache: 'no-store' });
        if (r.ok) cfg = await r.json().catch(() => null);
      } catch (e) { cfg = null; }
      const g = cfg && cfg.gate;
      if (!g || !g.salt || !g.hash) return resolve();                    /* 未启用门禁 */
      if (localStorage.getItem('wb.gate') === g.hash.slice(0, 16)) return resolve();  /* 本机已通过且密码未变 */
      this._show(g, resolve);
    });
  },

  _show(g, resolve) {
    const root = document.getElementById('loginRoot');
    if (!root) return resolve();
    let attempts = 0;
    root.innerHTML = `
      <div class="login-mask">
        <div class="login-card">
          <div class="logo-icon" style="margin:0 auto 14px">⚡</div>
          <div class="login-title">工作台</div>
          <div class="login-sub">该站点已开启访问保护，请输入密码进入</div>
          <input type="password" id="gatePw" placeholder="访问密码" autocomplete="current-password">
          <button class="btn btn-primary" id="gateBtn" style="width:100%;justify-content:center">进入工作台</button>
          <div class="login-err" id="gateErr"></div>
        </div>
      </div>`;
    const input = document.getElementById('gatePw');
    const btn = document.getElementById('gateBtn');
    const err = document.getElementById('gateErr');
    input.focus();

    const submit = async () => {
      const pw = input.value;
      if (!pw) return;
      attempts++;
      btn.disabled = true;
      err.textContent = '';
      /* 错误次数越多等待越久，拖慢暴力尝试 */
      const delay = Math.min(600 * (attempts - 1), 4000);
      if (delay) await new Promise(r => setTimeout(r, delay));
      const h = await this.deriveHash(pw, g.salt);
      if (h === g.hash) {
        localStorage.setItem('wb.gate', g.hash.slice(0, 16));
        root.innerHTML = '';
        resolve();
      } else {
        err.textContent = '密码不正确';
        btn.disabled = false;
        input.select();
      }
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  },

  /* ---------- 设置界面（GitHub 同步模式下可用） ---------- */
  async modal() {
    let on = false;
    try { const cfg = await this._readConfig(); on = !!(cfg && cfg.gate && cfg.gate.hash); } catch (e) {}
    UI.modal({
      title: '🔒 网页门禁密码',
      body: `
        <div style="font-size:12.5px;color:var(--muted);line-height:1.8;margin-bottom:14px">
          当前状态：<b style="color:${on ? 'var(--green)' : 'var(--muted)'}">${on ? '已启用' : '未启用'}</b><br>
          启用后，任何人打开这个网址都必须先输入密码才能看到界面；本机通过后自动记住，修改密码后所有设备会重新要求输入。<br>
          说明：这层门禁防的是"知道网址的路人"；数据机密性仍由加密口令与访问令牌保证，技术绕过门禁的人也只能看到空白界面。
        </div>
        <div class="form-row"><label>新门禁密码（至少 4 位）</label>
          <input id="gNewPw" type="password" placeholder="设置一个打开网页要输入的密码"></div>`,
      foot: `${on ? `<button class="btn btn-danger left" data-act="gate-clear">清除门禁</button>` : ''}
             <button class="btn btn-ghost" data-act="close-modal">取消</button>
             <button class="btn btn-primary" data-act="gate-save">保存并启用</button>`
    });
  },

  async _readConfig() {
    const url = 'https://api.github.com/repos/' + Sync.gh.repo + '/contents/site-config.json?ref=' + encodeURIComponent(Sync.gh.branch);
    const r = await fetch(url, { headers: Sync.ghHeaders() });
    if (r.status === 404) return { repo: Sync.gh.repo, branch: Sync.gh.branch, gate: null };
    if (r.status === 401) throw new Error('访问令牌无效或已过期');
    if (!r.ok) throw new Error('读取站点配置失败 (' + r.status + ')');
    const j = await r.json();
    return JSON.parse(Sync.b64decode(j.content.replace(/\s+/g, '')));
  },

  async save() {
    const pw = (document.getElementById('gNewPw').value || '').trim();
    if (pw.length < 4) { UI.toast('门禁密码至少 4 位', 'warn'); return; }
    const btn = document.querySelector('[data-act="gate-save"]');
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    try {
      let cfg;
      try { cfg = await this._readConfig(); } catch (e) { cfg = { repo: Sync.gh.repo, branch: Sync.gh.branch, gate: null }; }
      const salt = Sync.b64rnd(16);
      const hash = await this.deriveHash(pw, salt);
      cfg.gate = { salt, hash };
      await Sync.ghPutFile('site-config.json', cfg, '更新网页门禁');
      localStorage.setItem('wb.gate', hash.slice(0, 16));   /* 本机立即生效，无需重输 */
      UI.closeModal();
      UI.toast('🔒 门禁已启用：其他设备下次打开网页时需输入此密码');
    } catch (e) {
      UI.toast('保存失败：' + e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = '保存并启用'; }
    }
  },

  clear() {
    UI.confirm('清除后任何人打开网址都无需密码即可看到界面，确定清除门禁？', { danger: true, okText: '清除' }).then(async ok => {
      if (!ok) return;
      try {
        const cfg = await this._readConfig();
        cfg.gate = null;
        await Sync.ghPutFile('site-config.json', cfg, '清除网页门禁');
        localStorage.removeItem('wb.gate');
        UI.closeModal();
        UI.toast('门禁已清除');
      } catch (e) { UI.toast('清除失败：' + e.message, 'err'); }
    });
  }
};
