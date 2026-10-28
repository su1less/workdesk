/* ============================================================
 * sync.js — 数据同步（自动探测运行环境）
 *
 * 三种后端模式自动适配：
 *   1. 自建 node server.js  → 登录门禁 + 数据存服务器（api/ping 探测）
 *   2. GitHub 同步          → 仓库当数据库（GitHub Pages / 静态托管适用，
 *                             用 Fine-grained PAT 读写仓库内数据文件，
 *                             可选 AES-GCM 加密，公开仓库也安全）
 *   3. 本地模式             → 数据存浏览器 localStorage（file:// / 未配置）
 *
 * 同步策略：修改后自动推送（自建服务器 0.7s / GitHub 3s）；
 * 周期性 + 窗口聚焦时拉取其他设备变更；整库覆盖、后保存者优先。
 * ============================================================ */

const Sync = {
  mode: 'local',            // 'local' | 'server' | 'github'
  token: localStorage.getItem('wb.token') || '',
  gh: null,                 // GitHub 同步配置 {repo,branch,path,token,pass,salt}
  _ghKey: null,             // 由口令派生的 AES-GCM 密钥
  _pushTimer: null,
  _retryTimer: null,
  _pollTimer: null,
  _pushing: false,
  _dirty: false,           // 有未上传到云端的本地修改（拉取不得覆盖）
  _dirtySeq: 0,            // 修改代际：推送期间又有新修改时，禁止清除脏标记
  _lastFailAt: 0,          // 上次失败提示时间（重试限频用）
  guest: false,            // 服务器模式·只读访客（分享密码进入）

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h.Authorization = 'Bearer ' + this.token;
    return h;
  },

  /* ================= 启动探测 ================= */
  async init() {
    if (!/^https?:$/.test(location.protocol)) return false;

    /* 1) 自建 node 后端 */
    try {
      const r = await fetch('api/ping', { headers: this.headers(), cache: 'no-store' });
      if ((r.headers.get('content-type') || '').includes('application/json')) {
        if (r.status === 401) {
          /* 本机记住的只读分享令牌 → 直接恢复访客模式 */
          if (localStorage.getItem('wb.share') && await this.enterGuest(true)) return true;
          this.loginUI();
          return true;
        }
        const j = await r.json().catch(() => null);
        if (j && j.ok === true) {
          this.mode = 'server';
          await this.pull();
          this.startPoll(25000);
          window.addEventListener('focus', () => { if (!document.hidden) this.pull(); });
          return true;
        }
      }
    } catch (e) { /* 无后端，继续探测 */ }

    /* 2) GitHub 同步（已配置） */
    const gh = this.ghConfig();
    if (gh) { await this.ghStart(); return true; }

    return false;   /* 3) 本地模式 */
  },

  /* ================= 拉取 / 推送 ================= */
  async pull() {
    /* 本地有未推送的修改时禁止采纳远端，防止把待上传的变更覆盖掉 */
    if (this._pushing || this._dirty) return;
    /* 只读访客：拉取分享数据（实时只读） */
    if (this.guest) {
      try {
        const r = await fetch('api/share/data', {
          headers: { Authorization: 'Bearer ' + (localStorage.getItem('wb.share') || '') },
          cache: 'no-store'
        });
        if (r.status === 401) {
          this.guest = false;
          localStorage.removeItem('wb.share');
          this.loginUI('分享密码已失效，请重新输入');
          return;
        }
        const j = await r.json();
        if (j && j.db) Store.adoptGuest(j.db, j.serverUpdatedAt || 0);
      } catch (e) { /* 网络波动，下轮再试 */ }
      return;
    }
    if (this.mode === 'server') {
      try {
        const r = await fetch('api/data', { headers: this.headers(), cache: 'no-store' });
        if (r.status === 401) { this.loginUI(); return; }
        const j = await r.json();
        if (!j || !j.db) { this.schedulePush(); return; }
        if ((Store.db.meta || {}).serverUpdatedAt !== j.serverUpdatedAt) {
          Store.adoptRemote(j.db, j.serverUpdatedAt);
        }
      } catch (e) { /* 网络波动，下轮再试 */ }
    } else if (this.mode === 'github') {
      try {
        const j = await this.ghGet();
        if (j.empty) { this.schedulePush(); return; }
        if ((Store.db.meta || {}).serverUpdatedAt !== j.serverUpdatedAt) {
          Store.adoptRemote(j.db, j.serverUpdatedAt);
        }
      } catch (e) {
        if (e.message === 'ENC' || /口令|令牌|TOKEN/.test(e.message)) {
          this.ghModal(e.message === 'ENC' ? '云端数据已加密，请在本设备配置相同的加密口令' : e.message);
        } else { console.warn('GitHub 拉取失败', e); }
      }
    }
  },

  schedulePush() {
    if (this.mode === 'local' || this.guest) return;
    this._dirty = true;
    this._dirtySeq++;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.push(), this.mode === 'github' ? 3000 : 700);
  },

  async push() {
    if (this.mode === 'local') return;
    if (this._pushing) {
      /* 已有推送在途：若仍有待推修改，稍后再试，确保不会静默丢失 */
      if (this._dirty) this._pushTimer = setTimeout(() => this.push(), 1500);
      return;
    }
    const seq = this._dirtySeq;   // 本次推送所覆盖的修改代际
    this._pushing = true;
    let ok = false;
    try {
      if (this.mode === 'server') {
        const r = await fetch('api/data', {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ db: Store.db })
        });
        if (r.status === 401) { this.loginUI(); return; }
        if (r.status === 400) { UI.toast && UI.toast('同步失败：数据格式异常', 'err'); return; }
        const j = await r.json();
        if (j && j.serverUpdatedAt) { this._stampLocal(j.serverUpdatedAt); ok = true; }
      } else if (this.mode === 'github') {
        const su = await this.ghPut(Store.db);
        this._stampLocal(su);
        await this._pushShare(su);
        ok = true;
      }
      if (ok) {
        /* 仅当推送期间没有产生新修改（代际未变）才清除脏标记、恢复拉取 */
        if (this._dirtySeq === seq) {
          this._dirty = false;
          clearTimeout(this._retryTimer);
        }
      }
    } catch (e) {
      if (this.mode === 'github' && /令牌|TOKEN/.test(e.message)) this.ghModal(e.message);
      else {
        /* 保持 _dirty：阻止轮询用旧数据覆盖，并自动重试推送 */
        const now = Date.now();
        if (now - this._lastFailAt > 120000) {
          UI.toast && UI.toast('☁ 同步失败，稍后自动重试', 'warn');
          this._lastFailAt = now;
        }
        clearTimeout(this._retryTimer);
        this._retryTimer = setTimeout(() => this.push(), 15000);
      }
    } finally {
      this._pushing = false;
    }
  },

  _stampLocal(su) {
    if (su == null) return;
    if (!Store.db.meta) Store.db.meta = {};
    Store.db.meta.serverUpdatedAt = su;
    try { localStorage.setItem('workbench.db.v1', JSON.stringify(Store.db)); } catch (e) {}
  },

  startPoll(ms) {
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => {
      if (!document.hidden && !this._pushing) this.pull();
    }, ms);
  },

  /* ================= GitHub 同步 ================= */
  ghConfig() {
    try {
      const c = JSON.parse(localStorage.getItem('wb.gh') || 'null');
      if (c && c.repo && c.token) { this.gh = c; return c; }
    } catch (e) {}
    this.gh = null;
    return null;
  },

  async ghStart() {
    this.mode = 'github';
    if (this.gh.pass) {
      try { this._ghKey = await this.deriveKey(this.gh.pass, this.gh.salt); }
      catch (e) { this.ghModal('无法初始化加密：' + e.message); return; }
    }
    /* 读取站点配置（含只读分享开关） */
    try {
      const r = await fetch('site-config.json?t=' + Date.now(), { cache: 'no-store' });
      this.siteCfg = r.ok ? await r.json().catch(() => null) : null;
    } catch (e) { this.siteCfg = null; }
    await this.pull();
    this.startPoll(60000);
    window.addEventListener('focus', () => { if (!document.hidden && this.mode === 'github') this.pull(); });
  },

  ghHeaders(extra) {
    return Object.assign({
      Authorization: 'Bearer ' + this.gh.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }, extra || {});
  },

  ghUrl(op) {
    return 'https://api.github.com/repos/' + this.gh.repo + '/contents/' + this.gh.path + (op || '');
  },

  async ghGet() {
    const r = await fetch(this.ghUrl('?ref=' + encodeURIComponent(this.gh.branch) + '&t=' + Date.now()),
      { headers: this.ghHeaders(), cache: 'no-store' });
    if (r.status === 404) return { empty: true };
    if (r.status === 401) throw new Error('访问令牌无效或已过期，请重新配置 GitHub 同步');
    if (!r.ok) throw new Error('GitHub 接口异常 (' + r.status + ')');
    const j = await r.json();
    if (j.encoding !== 'base64') throw new Error('数据文件超过 1MB，GitHub Contents API 无法读取，请精简数据');
    let txt = this.b64decode(j.content.replace(/\s+/g, ''));
    if (txt.startsWith('WBENC1:')) {
      if (!this._ghKey) throw new Error('ENC');
      try { txt = await this.decryptText(this._ghKey, txt.slice(7)); }
      catch (e) { throw new Error('加密口令不正确，无法读取云端数据'); }
    }
    const data = JSON.parse(txt);
    return { db: data.db, serverUpdatedAt: data.serverUpdatedAt || 0 };
  },

  /* 通用文件提交：自动处理 sha（新建/更新/冲突重试一次，后写优先）。
   * content 为字符串/对象（JSON 序列化）；{__RAW_B64__} 表示已是 base64，直接作为文件内容 */
  async ghPutFile(path, content, message, opts) {
    const o = opts || { repo: this.gh.repo, token: this.gh.token, branch: this.gh.branch };
    const body0 = (content && content.__RAW_B64__) ? content.__RAW_B64__
      : (typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    const payload = (content && content.__RAW_B64__) ? content.__RAW_B64__ : this.b64encode(body0);
    const base = 'https://api.github.com/repos/' + o.repo + '/contents/' + path;
    const hd = {
      Authorization: 'Bearer ' + o.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    let sha = null;
    const r0 = await fetch(base + '?ref=' + encodeURIComponent(o.branch) + '&t=' + Date.now(),
      { headers: hd, cache: 'no-store' });
    if (r0.status === 401) throw new Error('访问令牌无效或已过期，请重新配置 GitHub 同步');
    if (r0.ok) sha = (await r0.json()).sha;

    const attempt = async s => {
      const body = { message, content: payload, branch: o.branch };
      if (s) body.sha = s;
      const r = await fetch(base, {
        method: 'PUT',
        headers: Object.assign({ 'Content-Type': 'application/json' }, hd),
        body: JSON.stringify(body)
      });
      if (r.status === 401) throw new Error('访问令牌无效或没有写入权限，请重新配置 GitHub 同步');
      if (r.status === 409 || r.status === 422) return null;   /* sha 过期/缺失 → 重取后再试 */
      if (!r.ok) throw new Error('GitHub 写入失败 (' + r.status + ')');
      const j = await r.json().catch(() => ({}));
      return (j.content && j.content.sha) || true;
    };

    let res = await attempt(sha);
    if (res === null) {
      const r2 = await fetch(base + '?ref=' + encodeURIComponent(o.branch), { headers: hd });
      res = await attempt(r2.ok ? (await r2.json()).sha : null);
    }
    if (res === null) throw new Error('GitHub 提交冲突，自动重试失败');
    return res;
  },

  /* 图片上传：dataURL → 仓库 assets/ 目录，返回相对路径（文档中引用，不占数据文件体积） */
  async ghPutAsset(dataUrl) {
    const m = String(dataUrl).match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
    if (!m) throw new Error('不支持的图片格式');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const name = 'img-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + '.' + ext;
    await this.ghPutFile('assets/' + name, { __RAW_B64__: m[2] }, '上传文档图片 ' + name);
    return 'assets/' + name;
  },

  async ghPut(db) {
    const su = Date.now();
    let txt = JSON.stringify({ db, serverUpdatedAt: su });
    if (this._ghKey) txt = 'WBENC1:' + await this.encryptText(this._ghKey, txt);
    await this.ghPutFile(this.gh.path, txt, '工作台数据同步 ' + new Date(su).toLocaleString('zh-CN'));
    return su;
  },

  /* 只读分享开启时，随主数据同步更新分享文件 */
  async _pushShare(su) {    try {
      const shareOn = this.siteCfg && this.siteCfg.share && this.siteCfg.share.salt && this.gh.sharePass;
      if (!shareOn) return;
      if (!this._shareKeyC) {
        const k = await Gate.deriveShareKeys(this.gh.sharePass, this.siteCfg.share.salt);
        this._shareKeyC = k.key;
      }
      let txt = JSON.stringify({ db: Store.db, serverUpdatedAt: su });
      txt = 'WBENC1:' + await this.encryptText(this._shareKeyC, txt);
      await this.ghPutFile(SHARE_PATH, txt, '只读分享数据同步');
    } catch (e) { /* 分享更新失败不影响主数据 */ }
  },

  /* ---------- 加密（AES-GCM + PBKDF2，WebCrypto） ---------- */
  b64rnd(n) {
    const b = crypto.getRandomValues(new Uint8Array(n));
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  },

  b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  },

  b64decode(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  },

  async deriveKey(pass, saltB64) {
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  },

  async encryptText(key, txt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(txt)));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv); out.set(ct, 12);
    let bin = '';
    for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
    return btoa(bin);
  },

  async decryptText(key, payloadB64) {
    const data = Uint8Array.from(atob(payloadB64), c => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12));
    return new TextDecoder().decode(pt);
  },

  /* ---------- 配置界面 ---------- */
  ghModal(err) {
    const c = this.gh || { repo: '', branch: 'main', path: 'data/db.json', token: '', pass: '' };
    UI.modal({
      title: '☁ GitHub 同步配置',
      body: `
        ${err ? `<div class="warn-box" style="margin-bottom:14px">${UI.esc(err)}</div>` : ''}
        <div style="font-size:12.5px;color:var(--muted);line-height:1.8;margin-bottom:16px">
          用你自己的 GitHub 仓库当数据库：多设备同步、清缓存不丢数据、免费、自带版本历史。
          需要一个<b>细粒度访问令牌</b>（仅授权该仓库的 Contents 读写），生成步骤见 README。
        </div>
        <div class="form-row"><label>仓库（用户名/仓库名）</label>
          <input id="ghRepo" type="text" value="${UI.esc(c.repo)}" placeholder="yourname/workbench"></div>
        <div class="form-grid2">
          <div class="form-row"><label>分支</label>
            <input id="ghBranch" type="text" value="${UI.esc(c.branch)}" placeholder="main"></div>
          <div class="form-row"><label>数据文件路径</label>
            <input id="ghPath" type="text" value="${UI.esc(c.path)}" placeholder="data/db.json"></div>
        </div>
        <div class="form-row"><label>访问令牌（Fine-grained PAT）</label>
          <input id="ghToken" type="password" value="${UI.esc(c.token)}" placeholder="github_pat_…">
          <div style="font-size:11.5px;color:var(--muted);margin-top:5px">只保存在本设备浏览器中，用于读写你指定仓库里的数据文件</div></div>
        <div class="form-row"><label>加密口令（强烈推荐）</label>
          <input id="ghPass" type="password" value="${UI.esc(c.pass)}" placeholder="数据加密后再上传">
          <div style="font-size:11.5px;color:var(--muted);margin-top:5px">⚠ 公开仓库若不加密，任何人都可能在仓库里直接看到数据内容；设置加密后所有设备需使用同一口令。修改口令前请先用原口令完成一次同步。</div></div>`,
      foot: `${this.gh ? `<button class="btn btn-danger left" data-act="gh-disconnect">断开连接</button>` : ''}
             <button class="btn btn-ghost" data-act="close-modal">取消</button>
             <button class="btn btn-primary" data-act="gh-save">验证并保存</button>`
    });
  },

  async ghSave() {
    const g = id => (document.getElementById(id).value || '').trim();
    const repo = g('ghRepo');
    const branch = g('ghBranch') || 'main';
    const path = (g('ghPath') || 'data/db.json').replace(/^\/+/, '');
    const token = g('ghToken');
    const pass = (document.getElementById('ghPass').value || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { UI.toast('仓库格式应为 用户名/仓库名，例如 yourname/workbench', 'warn'); return; }
    if (!token) { UI.toast('请填写访问令牌', 'warn'); return; }

    const btn = document.querySelector('[data-act="gh-save"]');
    if (btn) { btn.disabled = true; btn.textContent = '验证中…'; }
    try {
      const r = await fetch('https://api.github.com/repos/' + repo, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }
      });
      if (r.status === 401) { UI.toast('令牌无效或已过期', 'err'); return; }
      if (r.status === 404) { UI.toast('仓库不存在，或令牌未授权访问该仓库', 'err'); return; }
      if (!r.ok) { UI.toast('GitHub 校验失败（' + r.status + '）', 'err'); return; }

      /* 维护仓库根目录 site-config.json（网页门禁用；保留已有门禁设置） */
      try {
        const rs = await fetch('https://api.github.com/repos/' + repo + '/contents/site-config.json?ref=' + encodeURIComponent(branch),
          { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } });
        let site = null;
        if (rs.ok) site = JSON.parse(this.b64decode((await rs.json()).content.replace(/\s+/g, '')));
        if (!site || site.repo !== repo || site.branch !== branch) {
          await this.ghPutFile('site-config.json',
            { repo, branch, gate: (site && site.gate) || null },
            '工作台站点配置', { repo, token, branch });
        }
      } catch (e) { /* 非致命：门禁可在设置中再生成 */ }

      const cfg = { repo, branch, path, token, pass: pass || '', salt: (this.gh && this.gh.salt) || this.b64rnd(16) };
      localStorage.setItem('wb.gh', JSON.stringify(cfg));
      UI.closeModal();
      UI.toast('✔ GitHub 同步已配置，即将重新加载…');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      UI.toast('无法连接 GitHub，请检查网络', 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '验证并保存'; }
    }
  },

  /* 图片上传：dataURL 原图 → 服务器 assets/（不压缩、不进数据文件），返回相对路径 */
  async putAsset(dataUrl) {
    const m = String(dataUrl).match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
    if (!m) throw new Error('不支持的图片格式');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const r = await fetch('api/asset', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ ext, data: m[2] })
    });
    if (r.status === 401) { this.loginUI(); throw new Error('登录已过期'); }
    if (!r.ok) throw new Error('上传失败 (' + r.status + ')');
    const j = await r.json();
    if (!j || !j.url) throw new Error('上传响应异常');
    return j.url;
  },

  /* ================= 服务器模式 · 只读访客（分享密码） ================= */
  async enterGuest(quiet) {
    const token = localStorage.getItem('wb.share') || '';
    if (!token) return false;
    try {
      const r = await fetch('api/share/data', {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store'
      });
      if (r.status === 401) { localStorage.removeItem('wb.share'); return false; }
      const j = await r.json();
      if (!j) return false;
      this.guest = true;
      if (j.db) Store.adoptGuest(j.db, j.serverUpdatedAt || 0);
      this.startPoll(30000);
      if (!this._focusBound) {
        this._focusBound = true;
        window.addEventListener('focus', () => { if (!document.hidden && this.guest) this.pull(); });
      }
      if (!quiet) {
        const root = document.getElementById('loginRoot');
        if (root) root.innerHTML = '';
        /* 关闭登录前基于本地演示数据弹出的晨报等残留弹窗 */
        if (typeof UI !== 'undefined' && UI.closeModal) UI.closeModal();
        UI.toast && UI.toast('已进入只读访问模式 👁');
        if (typeof App !== 'undefined' && App.render) App.render();
      }
      return true;
    } catch (e) { return false; }
  },

  /* ================= 自建服务器登录门禁 ================= */
  async loginUI(msg) {
    const root = document.getElementById('loginRoot');
    if (!root) return;
    /* 已开启只读分享 → 登录卡片附带"只读查看"入口 */
    let shareOn = false;
    try {
      const r = await fetch('api/share/config', { cache: 'no-store' });
      if (r.ok) shareOn = !!((await r.json().catch(() => null)) || {}).enabled;
    } catch (e) {}
    root.innerHTML = `
      <div class="login-mask">
        <div class="login-card">
          <div class="logo-icon" style="margin:0 auto 14px">⚡</div>
          <div class="login-title">工作台</div>
          <div class="login-sub">${msg || '该站点已开启访问保护，请输入密码进入'}</div>
          <input type="password" id="loginPw" placeholder="访问密码" autocomplete="current-password">
          <button class="btn btn-primary" id="loginBtn" style="width:100%;justify-content:center">进入工作台</button>
          ${shareOn ? `
          <div style="display:flex;align-items:center;gap:10px;margin:16px 0;color:var(--muted);font-size:12px">
            <span style="flex:1;height:1px;background:var(--border)"></span>或<span style="flex:1;height:1px;background:var(--border)"></span>
          </div>
          <input type="password" id="gPw" placeholder="分享密码（只读查看）" autocomplete="current-password" style="margin-bottom:10px">
          <button class="btn btn-ghost" id="gBtn" style="width:100%;justify-content:center">👁 只读查看工作安排</button>` : ''}
          <div class="login-err" id="loginErr"></div>
        </div>
      </div>`;
    const input = document.getElementById('loginPw');
    const btn = document.getElementById('loginBtn');
    const err = document.getElementById('loginErr');
    input.focus();

    const submit = async () => {
      const pw = input.value;
      if (!pw) return;
      btn.disabled = true;
      err.textContent = '';
      try {
        const r = await fetch('api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw })
        });
        const j = await r.json().catch(() => ({}));
        if (r.status === 200 && j.token) {
          this.token = j.token;
          localStorage.setItem('wb.token', j.token);
          root.innerHTML = '';
          /* 关闭登录前残留的演示数据弹窗，并用真实云端数据重新触发晨报判断 */
          if (typeof UI !== 'undefined' && UI.closeModal) UI.closeModal();
          this.mode = 'server';
          await this.pull();
          this.startPoll(25000);
          if (typeof App !== 'undefined' && App.state) {
            App.render();
            if (typeof App.maybeBriefing === 'function') App.maybeBriefing();
          }
          return;
        }
        err.textContent = j.error || '密码不正确';
      } catch (e) {
        err.textContent = '网络错误，请重试';
      }
      btn.disabled = false;
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });

    if (!shareOn) return;
    const gi = document.getElementById('gPw');
    const gb = document.getElementById('gBtn');
    const gsubmit = async () => {
      const pw = gi.value;
      if (!pw) return;
      gb.disabled = true;
      err.textContent = '';
      try {
        const r = await fetch('api/share/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw })
        });
        const j = await r.json().catch(() => ({}));
        if (r.status === 200 && j.token) {
          localStorage.setItem('wb.share', j.token);
          if (await this.enterGuest()) return;
          err.textContent = '分享数据暂不可用，请稍后再试';
        } else {
          err.textContent = j.error || '密码不正确';
        }
      } catch (e) {
        err.textContent = '网络错误，请重试';
      }
      gb.disabled = false;
    };
    gb.addEventListener('click', gsubmit);
    gi.addEventListener('keydown', e => { if (e.key === 'Enter') gsubmit(); });
  },

  /* ================= 服务器模式 · 只读分享设置（站长） ================= */
  async serverShareModal() {
    let on = false;
    try {
      const r = await fetch('api/share/config', { cache: 'no-store' });
      const j = r.ok ? await r.json().catch(() => null) : null;
      on = !!(j && j.enabled);
    } catch (e) {}
    UI.modal({
      title: '🔗 只读分享',
      body: `
        <div style="font-size:12.5px;color:var(--muted);line-height:1.8;margin-bottom:14px">
          当前状态：<b style="color:${on ? 'var(--green)' : 'var(--muted)'}">${on ? '已开启' : '未开启'}</b><br>
          开启后，把 <b>网址 + 分享密码</b> 发给老师即可：对方打开网页点「👁 只读查看工作安排」输入密码，就能<strong>只读查看</strong>你的任务、日程、文献与报告——不能修改任何内容，数据<strong>实时刷新</strong>（无需等待部署）。文档里的图片为<strong>原图</strong>，可点击放大下载。<br>
          ⚠ 对方将能看到你的全部数据内容，请自行斟酌分享范围；未配置 HTTPS 前密码为明文传输，建议尽快配好域名。
        </div>
        <div class="form-row"><label>${on ? '新的分享密码（至少 4 位）' : '分享密码（至少 4 位）'}</label>
          <input id="srvShPw" type="password" placeholder="发给老师的密码，例如 su-teach-2026"></div>`,
      foot: `${on ? `<button class="btn btn-danger left" data-act="srv-share-clear">停止分享</button>` : ''}
             <button class="btn btn-ghost" data-act="close-modal">取消</button>
             <button class="btn btn-primary" data-act="srv-share-save">${on ? '更新密码' : '开启分享'}</button>`
    });
  },

  async serverShareSave() {
    const el = document.getElementById('srvShPw');
    const pw = ((el && el.value) || '').trim();
    if (pw.length < 4) { UI.toast('分享密码至少 4 位', 'warn'); return; }
    const btn = document.querySelector('[data-act="srv-share-save"]');
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    try {
      const r = await fetch('api/share/set', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ enabled: true, password: pw })
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '保存失败');
      UI.closeModal();
      UI.toast('🔗 只读分享已开启：把网址和分享密码发给老师即可，数据实时可见');
    } catch (e) {
      UI.toast('保存失败：' + e.message, 'err');
      if (btn) { btn.disabled = false; btn.textContent = '开启分享'; }
    }
  },

  serverShareClear() {
    UI.confirm('停止分享后，老师将无法再通过密码访问（立即生效）。确定停止？', { danger: true, okText: '停止分享' }).then(async ok => {
      if (!ok) return;
      try {
        const r = await fetch('api/share/set', {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ enabled: false })
        });
        if (!r.ok) throw new Error('操作失败');
        UI.closeModal();
        UI.toast('已停止分享');
      } catch (e) { UI.toast('停止失败：' + e.message, 'err'); }
    });
  }
};
