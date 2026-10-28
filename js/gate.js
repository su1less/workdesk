/* ============================================================
 * gate.js — 网页入口保护 & 只读分享（静态托管适用）
 *
 * 仓库根目录 site-config.json（公开）：
 *   { repo, branch,
 *     gate:  {salt, hash},          // 门禁密码：进入本地空白模式
 *     share: {salt, hash}  }        // 分享密码：进入只读访客模式
 *
 * 三类访问者：
 *   · 站长设备（已配置 GitHub 同步 / 服务器令牌）→ 自动跳过入口
 *   · 访客（老师等）输入分享密码 → 解密 data/share.json → 只读视图，
 *     每分钟自动刷新，不能修改任何内容；本机记住，改密码后自动失效
 *   · 其他人输入门禁密码 → 本地空白模式（无数据）
 *
 * 分享密码派生 512bit：前 256bit 作校验哈希（存 site-config），
 * 后 256bit 作 AES-GCM 密钥（加密 data/share.json）。
 * ============================================================ */

const SHARE_PATH = 'data/share.json';

const Gate = {

  _share: null,        // 当前分享配置 {salt, hash}
  _shareKey: null,     // 访客解密密钥
  _poll: null,

  /* PBKDF2(120k, SHA-256) → 256bit hex（门禁密码校验用） */
  async deriveHash(pass, saltB64) {
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, km, 256);
    return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
  },

  /* 分享密码 → {hash(64hex), key(AES-GCM, 可导出)} */
  async deriveShareKeys(pass, saltB64) {
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, km, 512));
    const hash = Array.from(bits.slice(0, 32), b => b.toString(16).padStart(2, '0')).join('');
    const key = await crypto.subtle.importKey('raw', bits.slice(32), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    return { hash, key };
  },

  async keyHex(key) {
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    return Array.from(raw, b => b.toString(16).padStart(2, '0')).join('');
  },

  /* ================= 入口流程 ================= */
  init() {
    return new Promise(async resolve => {
      if (!/^https?:$/.test(location.protocol)) return resolve();
      /* 站长设备（已配置同步）→ 免入口 */
      if (localStorage.getItem('wb.gh') || localStorage.getItem('wb.token')) return resolve();

      let cfg = null;
      try {
        const r = await fetch('site-config.json?t=' + Date.now(), { cache: 'no-store' });
        if (r.ok) cfg = await r.json().catch(() => null);
      } catch (e) { cfg = null; }
      if (!cfg) return resolve();
      const gate = (cfg.gate && cfg.gate.salt && cfg.gate.hash) ? cfg.gate : null;
      const share = (cfg.share && cfg.share.salt && cfg.share.hash) ? cfg.share : null;
      this._share = share;
      if (!gate && !share) return resolve();

      /* 本机已通过门禁（密码未变） */
      if (gate && localStorage.getItem('wb.gate') === gate.hash.slice(0, 16)) return resolve();
      /* 访客本机记住（派生密钥缓存，改分享密码后盐变化自动失效） */
      if (share) {
        const saved = localStorage.getItem('wb.gk');
        if (saved) {
          const i = saved.indexOf(':');
          const salt = saved.slice(0, i), keyHexStr = saved.slice(i + 1);
          if (salt === share.salt && /^[0-9a-f]{64}$/.test(keyHexStr)) {
            try {
              const bytes = Uint8Array.from(keyHexStr.match(/../g).map(h => parseInt(h, 16)));
              this._shareKey = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
              if (await this._enterGuest()) return resolve();
            } catch (e) { /* 缓存失效，走密码页 */ }
          }
        }
      }
      this._show(gate, share, resolve);
    });
  },

  _show(gate, share, resolve) {
    const root = document.getElementById('loginRoot');
    if (!root) return resolve();
    let attempts = 0;
    root.innerHTML = `
      <div class="login-mask">
        <div class="login-card">
          <div class="logo-icon" style="margin:0 auto 14px">⚡</div>
          <div class="login-title">工作台</div>
          <div class="login-sub">${share ? '请输入访问密码查看工作安排（只读）' : '该站点已开启访问保护，请输入密码进入'}</div>
          <input type="password" id="gatePw" placeholder="访问密码" autocomplete="current-password">
          <button class="btn btn-primary" id="gateBtn" style="width:100%;justify-content:center">${share ? '查看工作安排' : '进入工作台'}</button>
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
      const delay = Math.min(600 * (attempts - 1), 4000);
      if (delay) await new Promise(r => setTimeout(r, delay));

      /* 1) 门禁密码 → 本地模式 */
      if (gate && await this.deriveHash(pw, gate.salt) === gate.hash) {
        localStorage.setItem('wb.gate', gate.hash.slice(0, 16));
        root.innerHTML = '';
        return resolve();
      }
      /* 2) 分享密码 → 只读访客模式 */
      if (share) {
        const k = await this.deriveShareKeys(pw, share.salt);
        if (k.hash === share.hash) {
          this._shareKey = k.key;
          localStorage.setItem('wb.gk', share.salt + ':' + await this.keyHex(k.key));
          const ok = await this._enterGuest();
          if (ok) { root.innerHTML = ''; return resolve(); }
          err.textContent = '分享数据尚未就绪，请站长完成一次数据同步';
          btn.disabled = false;
          return;
        }
      }
      err.textContent = '密码不正确';
      btn.disabled = false;
      input.select();
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  },

  /* 拉取并解密分享数据 → 只读装载 */
  async _enterGuest(quiet) {
    try {
      const r = await fetch(SHARE_PATH + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) { if (!quiet) UI.toast && UI.toast('分享数据尚未生成', 'warn'); return false; }
      const txt = (await r.text()).trim();
      if (!txt.startsWith('WBENC1:')) return false;
      const plain = await Sync.decryptText(this._shareKey, txt.slice(7));
      const data = JSON.parse(plain);
      Store.adoptGuest(data.db, data.serverUpdatedAt || 0);
      this._startGuestPoll();
      if (!quiet) UI.toast && UI.toast('已进入只读访问模式 👁');
      return true;
    } catch (e) {
      console.warn('读取分享数据失败', e);
      if (!quiet) UI.toast && UI.toast('读取分享数据失败：' + (e.message || '未知错误'), 'err');
      return false;
    }
  },

  _startGuestPoll() {
    clearInterval(this._poll);
    this._poll = setInterval(async () => {
      if (document.hidden || !this._shareKey || !Store.readOnly) return;
      try {
        const r = await fetch(SHARE_PATH + '?t=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) return;
        const txt = (await r.text()).trim();
        if (!txt.startsWith('WBENC1:')) return;
        const data = JSON.parse(await Sync.decryptText(this._shareKey, txt.slice(7)));
        if (data.serverUpdatedAt && data.serverUpdatedAt !== (Store.db.meta || {}).serverUpdatedAt) {
          Store.adoptGuest(data.db, data.serverUpdatedAt);
        }
      } catch (e) { /* 下轮再试 */ }
    }, 60000);
  },

  /* ================= 站长：门禁设置 ================= */
  async modal() {
    let on = false;
    try { const cfg = await this._readConfig(); on = !!(cfg && cfg.gate && cfg.gate.hash); } catch (e) {}
    UI.modal({
      title: '🔒 网页门禁密码',
      body: `
        <div style="font-size:12.5px;color:var(--muted);line-height:1.8;margin-bottom:14px">
          当前状态：<b style="color:${on ? 'var(--green)' : 'var(--muted)'}">${on ? '已启用' : '未启用'}</b><br>
          门禁密码用于打开网页的本地空白模式（不显示你的数据）。若要让他人<strong>只读查看你的工作安排</strong>，请使用「🔗 只读分享」。<br>
          说明：这层门禁防"知道网址的路人"；数据机密性由加密口令与访问令牌保证。
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
    if (r.status === 404) return { repo: Sync.gh.repo, branch: Sync.gh.branch, gate: null, share: null };
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
      localStorage.setItem('wb.gate', hash.slice(0, 16));
      UI.closeModal();
      UI.toast('🔒 门禁已启用：其他设备下次打开网页时需输入此密码');
    } catch (e) {
      UI.toast('保存失败：' + e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = '保存并启用'; }
    }
  },

  clear() {
    UI.confirm('清除后任何人打开网址都无需密码即可看到界面（本地空白模式），确定清除门禁？', { danger: true, okText: '清除' }).then(async ok => {
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
  },

  /* ================= 站长：只读分享（发给老师） ================= */
  async shareModal() {
    let on = false;
    try { const cfg = await this._readConfig(); on = !!(cfg.share && cfg.share.hash); } catch (e) {}
    UI.modal({
      title: '🔗 只读分享',
      body: `
        <div style="font-size:12.5px;color:var(--muted);line-height:1.8;margin-bottom:14px">
          当前状态：<b style="color:${on ? 'var(--green)' : 'var(--muted)'}">${on ? '已开启' : '未开启'}</b><br>
          开启后，把 <b>网址 + 分享密码</b> 发给老师即可：对方打开网页输入密码，就能<strong>只读查看</strong>你的任务、日程、文献与报告——不能修改任何内容，每分钟自动刷新。<br>
          ⚠ 注意：分享数据会延迟几分钟同步到网页（GitHub Pages 部署需要时间）；对方将能看到你的全部数据内容，请自行斟酌分享范围。
        </div>
        <div class="form-row"><label>${on ? '新的分享密码（至少 4 位）' : '分享密码（至少 4 位）'}</label>
          <input id="shNewPw" type="password" placeholder="发给老师的密码，例如 su-teach-2026"></div>`,
      foot: `${on ? `<button class="btn btn-danger left" data-act="share-clear">停止分享</button>` : ''}
             <button class="btn btn-ghost" data-act="close-modal">取消</button>
             <button class="btn btn-primary" data-act="share-save">${on ? '更新密码' : '开启分享'}</button>`
    });
  },

  async shareSave() {
    const pw = (document.getElementById('shNewPw').value || '').trim();
    if (pw.length < 4) { UI.toast('分享密码至少 4 位', 'warn'); return; }
    const btn = document.querySelector('[data-act="share-save"]');
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    try {
      let cfg;
      try { cfg = await this._readConfig(); } catch (e) { cfg = { repo: Sync.gh.repo, branch: Sync.gh.branch }; }
      const salt = Sync.b64rnd(16);
      const keys = await this.deriveShareKeys(pw, salt);
      cfg.share = { salt, hash: keys.hash };
      /* 1) 配置入库 */
      await Sync.ghPutFile('site-config.json', cfg, '更新只读分享配置');
      /* 2) 立即生成一份分享数据 */
      let txt = JSON.stringify({ db: Store.db, serverUpdatedAt: Date.now() });
      txt = 'WBENC1:' + await Sync.encryptText(keys.key, txt);
      await Sync.ghPutFile(SHARE_PATH, txt, '生成只读分享数据');
      /* 3) 记住分享密码，供日常数据同步时同步更新分享文件 */
      if (Sync.gh) {
        Sync.gh.sharePass = pw;
        localStorage.setItem('wb.gh', JSON.stringify(Sync.gh));
        Sync.siteCfg = cfg;
      }
      UI.closeModal();
      UI.toast('🔗 只读分享已开启：把网址和密码发给老师即可（数据约几分钟后可见）');
    } catch (e) {
      UI.toast('保存失败：' + e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = '保存并启用'; }
    }
  },

  shareClear() {
    UI.confirm('停止分享后，老师将无法再通过密码访问（旧密码立即失效）。确定停止？', { danger: true, okText: '停止分享' }).then(async ok => {
      if (!ok) return;
      try {
        const cfg = await this._readConfig();
        cfg.share = null;
        await Sync.ghPutFile('site-config.json', cfg, '停止只读分享');
        if (Sync.gh) {
          delete Sync.gh.sharePass;
          localStorage.setItem('wb.gh', JSON.stringify(Sync.gh));
          Sync.siteCfg = cfg;
        }
        UI.closeModal();
        UI.toast('已停止分享');
      } catch (e) { UI.toast('停止失败：' + e.message, 'err'); }
    });
  }
};
