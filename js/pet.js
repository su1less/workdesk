/* Desktop companion driven by the official dsh-pet animation set.
 * Behaviour chain: landing → patrol (crab walk, mirrored per direction) →
 * idle breathing → spacing out (look around / mutter) → yawn → sleep (loop)
 * Waking: startled awake → big stretch → patrol.
 * Pokes draw from the official click-response set (wave / happy / huffy).
 * Dragging shows the official suspended-feedback clip until release.
 * Clips chain seamlessly through two alternating <video> elements. */
const Pet = {
  el: null, _host: null, _inner: null, _say: null,
  _img: null, _va: null, _vb: null, _video: null,
  st: 'off', _raf: 0, _x: 0, _y: 0, _dir: 1,
  _dragging: false, _pointer: null, _moved: 0,
  _listeners: [], _stateTimer: 0, _sayTimer: 0, _talkTimer: 0,
  _walkRuns: 0, _videoFailed: false, _skinKey: '', _token: 0, _last: 0,
  SPEED: 22,

  enabled() { return !!(Store.db && Store.db.settings && Store.db.settings.pet); },
  init() { this.toggle(this.enabled()); },
  refresh() { this.toggle(false); if (this.enabled()) this.toggle(true); },

  skin() {
    const s = (Store.db && Store.db.settings) || {};
    const custom = String(s.petImg || '').trim();
    if (custom) return { key: 'custom', src: custom };
    /* Retired skins (puppet/dsh/glm) unify onto the official character. */
    const key = s.petSkin === 'whale' ? 'whale' : 'mascot';
    const art = typeof PetArt !== 'undefined' ? PetArt.src : { mascot: 'vendor/pet/mascot.png' };
    return key === 'whale' ? { key, src: '' } : { key, src: art.mascot };
  },
  skinClass() { const k = this.skin().key; return 'skin-' + (k === 'custom' ? 'img' : k); },
  staticImg() { return this.skin().src; },
  isPuppet() { return false; },
  svg() {
    return '<svg viewBox="0 0 150 100" width="100%" height="100%" aria-hidden="true"><path d="M116 48 Q142 28 146 10 Q150 34 138 48 Q150 62 146 86 Q142 68 116 48Z" fill="#6ea9dd"/><ellipse cx="64" cy="50" rx="54" ry="37" fill="#6ea9dd"/><path d="M16 62Q64 92 112 62Q102 86 64 86Q26 86 16 62Z" fill="#d8ecfd"/><circle cx="36" cy="40" r="6" fill="#1d2c3d"/></svg>';
  },
  /* AI-page identity follows the selected companion skin. */
  logoHTML() {
    const src = this.staticImg();
    return src ? `<img class="pet-logo" src="${src}" alt="">` : this.svg();
  },
  animated() { return this._skinKey === 'mascot' && !this._videoFailed; },
  art() { return typeof PetArt !== 'undefined' ? PetArt.animations : null; },

  _on(t, e, fn, opts) { t.addEventListener(e, fn, opts); this._listeners.push(() => t.removeEventListener(e, fn, opts)); },
  _idleVideo() { return this._video === this._va ? this._vb : this._va; },

  toggle(on) {
    if (!on) { this._teardown(); return; }
    if (this.el) return;
    let host = document.getElementById('petHost');
    if (!host) { host = document.createElement('div'); host.id = 'petHost'; document.body.appendChild(host); }
    this._host = host;
    const skin = this.skin();
    this._skinKey = skin.key; this._videoFailed = false;
    this._motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

    this.el = document.createElement('div');
    this.el.id = 'petFish'; this.el.className = 'pet ' + this.skinClass();
    this.el.tabIndex = 0; this.el.setAttribute('role', 'button');
    this.el.setAttribute('aria-label', '桌宠，点击互动，按住拖动');
    this.el.title = '桌宠 · 点击互动，按住可拖动';
    this._inner = document.createElement('div'); this._inner.className = 'pet-inner';
    if (skin.key === 'whale' || !skin.src) this._inner.innerHTML = this.svg();
    else {
      this._img = document.createElement('img'); this._img.className = 'pet-img';
      this._img.src = skin.src; this._img.alt = ''; this._img.draggable = false;
      this._inner.appendChild(this._img);
      this._va = this._mkVideo(); this._vb = this._mkVideo();
      this._inner.appendChild(this._va); this._inner.appendChild(this._vb);
    }
    this._say = document.createElement('div'); this._say.className = 'pet-say';
    this.el.appendChild(this._inner); this.el.appendChild(this._say);
    host.appendChild(this.el);

    const b = this._bounds();
    this._x = 8 + Math.random() * Math.max(0, b.maxX * 0.35); this._y = b.maxY;
    this._place(); this._bind();
    if (this.animated()) this._setState('landing');
    else { this._setState('awake'); this._scheduleSleep(20000); }
    this._sayOnce('有什么可以帮你？', 4200);
    this._loop(performance.now());
  },

  _mkVideo() {
    const v = document.createElement('video');
    v.className = 'pet-video'; v.muted = true; v.defaultMuted = true; v.playsInline = true;
    v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
    v.preload = 'none'; v.loop = false;
    return v;
  },

  _bounds() {
    const w = window.innerWidth, h = window.innerHeight;
    const tab = document.getElementById('tabbar');
    const r = tab && tab.getBoundingClientRect();
    const bottom = r && r.height > 0 && r.top < h ? h - r.top + 8 : w <= 860 ? 82 : 12;
    const ew = this.el ? this.el.offsetWidth : 72, eh = this.el ? this.el.offsetHeight : 96;
    return { maxX: Math.max(0, w - ew - 8), maxY: Math.max(0, h - eh - bottom) };
  },
  _place() {
    if (!this.el) return;
    const b = this._bounds();
    this._x = Math.max(0, Math.min(b.maxX, this._x));
    this._y = Math.max(0, Math.min(b.maxY, this._y));
    this.el.style.transform = `translate(${this._x.toFixed(1)}px, ${this._y.toFixed(1)}px)`;
  },
  _flip(on) { if (this.el) this.el.classList.toggle('pet-flip', on && this._dir < 0); },

  /* ---------- behaviour chain ---------- */
  _setState(st) {
    /* Decode fallback: skip the clip chain and doze off on the still pose. */
    if (!this.animated() && st !== 'awake' && st !== 'sleep') {
      this.st = 'awake'; this._scheduleSleep(30000); return;
    }
    this.st = st;
    clearTimeout(this._stateTimer);
    this.el.classList.remove('pet-sleep');
    if (st === 'landing') this._play('landing');
    else if (st === 'patrol') {
      this._walkRuns = 2 + Math.floor(Math.random() * 3);
      this._patrolUntil = Date.now() + (9000 + Math.random() * 8000);
      this._play('walk');
      this._talkLater();
    } else if (st === 'idle') {
      this._play('idle');
      this._stateTimer = setTimeout(() => this._setState(Math.random() < 0.5 ? 'lookAround' : 'daze'), 6000);
    } else if (st === 'lookAround') { this._play('lookAround'); this._sayOnce('咦…？'); }
    else if (st === 'daze') { this._play('daze'); this._sayOnce('发呆中…'); }
    else if (st === 'yawn') { this._play('yawn'); this._sayOnce('哈啊…困了…'); }
    else if (st === 'wake') this._play('wake');
    else if (st === 'stretch') this._play('stretch');
    else if (st === 'sleep') {
      this._play('sleep');
      this._flip(false);
      this.el.classList.add('pet-sleep');
      this._sayOnce('Zzz…');
    } else if (st === 'awake') { /* still pose */ }
  },

  /* A clip finished → next link in the chain. */
  _advance() {
    if (this.st === 'landing') this._setState('patrol');
    else if (this.st === 'patrol') {
      if (Date.now() < this._patrolUntil) this._play('walk');   /* loop clip re-armed */
      else this._setState('idle');
    } else if (this.st === 'lookAround' || this.st === 'daze') this._setState('yawn');
    else if (this.st === 'yawn') this._setState('sleep');
    else if (this.st === 'wake') this._setState('stretch');
    else if (this.st === 'stretch') this._setState('patrol');
    else if (this.st === 'wave' || this.st === 'happy' || this.st === 'huffy') this._setState('idle');
  },

  _scheduleSleep(ms) {
    clearTimeout(this._stateTimer);
    this._stateTimer = setTimeout(() => { if (this.st === 'awake') this._setState('sleep'); }, ms);
  },

  _play(clip, userInitiated, force) {
    const art = this.art();
    const entry = art && art[clip];
    if (!this.animated() || !entry || (this._dragging && !force)) {
      if (this.st !== 'sleep') this._scheduleSleep(30000);
      return;
    }
    clearTimeout(this._stateTimer);
    const v = this._idleVideo(), token = ++this._token;
    this._stopVideo();
    this._video = v;
    v.loop = !!entry.loop;
    v.src = entry.src; v.currentTime = 0;
    this.el.classList.add('pet-playing');
    this._flip(this.st === 'patrol');
    const p = v.play();
    if (p && p.catch) p.catch(err => {
      if (token !== this._token) return;
      if (err && err.name === 'AbortError') return;   /* superseded by the next clip */
      if (err && err.name === 'NotAllowedError') {
        /* Autoplay gated until first gesture: wait, don't fall back. */
        this._stopVideo();
        if (this.st !== 'sleep') { this.st = 'awake'; this._awaitGesture(); this._scheduleSleep(30000); }
        return;
      }
      this._videoFailed = true; this._afterVideo();
    });
  },

  _awaitGesture() {
    if (this._gestureBound || !this.el) return;
    this._gestureBound = true;
    const wake = () => {
      this._gestureBound = false;
      if (this.st === 'awake' && this.animated()) this._setState('landing');
    };
    this._on(document, 'pointerdown', wake, { once: true });
    this._on(document, 'keydown', wake, { once: true });
  },

  _stopVideo() {
    for (const v of [this._va, this._vb]) if (v) { v.pause(); v.classList.remove('on'); }
    if (this.el) this.el.classList.remove('pet-playing');
  },
  _afterVideo() {
    ++this._token;                     /* invalidate any pending transition */
    this._stopVideo();
    this._advance();
  },

  _poke() {
    if (!this.el) return;
    if (this.st === 'sleep') {
      this.el.classList.remove('pet-sleep');
      this._sayOnce('呜哇！？');
      this._setState('wake');
    } else {
      const r = Math.random();
      const clip = r < 0.4 ? 'wave' : r < 0.8 ? 'happy' : 'huffy';
      this.st = clip;
      this._play(clip, true);
      this._sayOnce(clip === 'wave' ? '嗨～' : clip === 'happy' ? '嘿嘿！' : '哼，别乱戳！');
    }
    if (typeof App !== 'undefined' && App.state && !Store.readOnly && App.state.view !== 'ai') App.go('ai');
  },

  _sayOnce(text, ms) {
    if (!this._say) return;
    this._say.textContent = text; this._say.classList.add('show');
    clearTimeout(this._sayTimer);
    this._sayTimer = setTimeout(() => this._say && this._say.classList.remove('show'), ms || 1800);
  },
  _talkLater() {
    clearTimeout(this._talkTimer);
    this._talkTimer = setTimeout(() => {
      if (this.st === 'patrol') {
        const LINES = ['今天的安排看完了吗？', '陪我走走嘛～', '咕噜咕噜…', '点我有惊喜哦'];
        this._sayOnce(LINES[Math.floor(Math.random() * LINES.length)]);
        this._talkLater();
      }
    }, 18000 + Math.random() * 14000);
  },

  /* Right-click action menu (official clip set). */
  MENU: [
    ['wave', '👋 元气挥手'], ['happy', '🎉 开心跃动'], ['huffy', '😤 傲娇生气'],
    ['idle', '🫁 待机呼吸'], ['patrol', '🚶 走一走'], ['lookAround', '👀 东张西望'],
    ['daze', '💭 发呆碎碎念'], ['yawn', '🥱 打哈欠'], ['stretch', '🤸 伸懒腰'],
    ['sleep', '😴 去睡觉'], ['wake', '⚡ 惊醒'], ['landing', '🛬 落地']
  ],
  _openMenu(x, y) {
    if (!this.el) return;
    this._closeMenu();
    const m = document.createElement('div');
    m.className = 'pet-menu';
    m.setAttribute('role', 'menu');
    m.innerHTML = this.MENU.map(([k, label]) =>
      `<button type="button" role="menuitem" data-k="${k}">${label}</button>`).join('');
    this.el.appendChild(m);
    const mw = 150, mh = m.offsetHeight || 320;
    m.style.left = Math.max(4, Math.min(x - this._x - mw / 2, window.innerWidth - this._x - mw - 6)) + 'px';
    m.style.top = Math.max(4, Math.min(y - this._y - 20, window.innerHeight - this._y - mh - 6)) + 'px';
    m.classList.add('show');
    this._menuEl = m;
    const close = e => { if (this._menuEl && !this._menuEl.contains(e.target)) this._closeMenu(); };
    const esc = e => { if (e.key === 'Escape') this._closeMenu(); };
    this._on(document, 'pointerdown', close);
    this._on(document, 'keydown', esc);
    this._menuOff = () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
    m.addEventListener('click', e => {
      const b = e.target.closest('button[data-k]');
      if (b) this._menuAct(b.dataset.k);
    });
  },
  _closeMenu() {
    if (this._menuOff) { this._menuOff(); this._menuOff = null; }
    if (this._menuEl) { this._menuEl.remove(); this._menuEl = null; }
  },
  _menuAct(k) {
    this._closeMenu();
    if (k === 'patrol' || k === 'idle' || k === 'sleep' || k === 'landing') this._setState(k);
    else if (k === 'wake') this._setState('wake');
    else { this.st = k; this._play(k, true, true); }
  },

  /* ---------- interaction ---------- */
  _bind() {
    const el = this.el;
    this._on(el, 'pointerdown', e => {
      if (e.target && e.target.closest && e.target.closest('.pet-menu')) return;   /* menu owns its clicks */
      if (this._dragging || e.isPrimary === false || (e.button !== undefined && e.button !== 0)) return;
      e.preventDefault();
      clearTimeout(this._stateTimer); this._stopVideo();
      this._dragging = true; this._pointer = e.pointerId; this._moved = 0;
      this._startX = e.clientX; this._startY = e.clientY;
      this._offX = e.clientX - this._x; this._offY = e.clientY - this._y;
      el.classList.add('grab');
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* window listeners remain */ }
      if (this.animated()) { this.st = 'drag'; this._play('drag', false, true); }
    });
    this._on(window, 'pointermove', e => {
      if (!this._dragging || e.pointerId !== this._pointer) return;
      this._moved = Math.max(this._moved, Math.hypot(e.clientX - this._startX, e.clientY - this._startY));
      const dx = e.clientX - this._offX - this._x;
      if (Math.abs(dx) > 2) this._dir = dx > 0 ? 1 : -1;
      this._x = e.clientX - this._offX; this._y = e.clientY - this._offY;
      this._place();
    });
    const finish = (e, cancelled) => {
      if (!this._dragging || e.pointerId !== this._pointer) return;
      const click = !cancelled && this._moved < 8;
      this._cancelDrag(); this._place();
      if (click) this._poke();
      else { this._sayOnce('接住我！'); this._setState('landing'); this._talkLater(); }
    };
    this._on(window, 'pointerup', e => finish(e, false));
    this._on(window, 'pointercancel', e => finish(e, true));
    this._on(el, 'lostpointercapture', e => finish(e, true));
    this._on(el, 'contextmenu', e => {
      e.preventDefault();
      if (this._dragging) return;
      clearTimeout(this._stateTimer); this._stopClipForMenu();
      this._openMenu(e.clientX, e.clientY);
    });
    this._on(el, 'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._poke(); } });
    this._on(window, 'resize', () => this._place());
    this._on(window, 'blur', () => { this._cancelDrag(); this._pauseAll(); });
    this._on(document, 'visibilitychange', () => document.hidden ? this._pauseAll() : this._resume());
    for (const v of [this._va, this._vb]) if (v) {
      this._on(v, 'playing', () => { if (this._video === v) v.classList.add('on'); });
      this._on(v, 'ended', () => { if (this._video === v) this._afterVideo(); });
      this._on(v, 'error', () => { this._videoFailed = true; if (this.st !== 'sleep') this._afterVideo(); });
    }
  },
  _stopClipForMenu() { this._stopVideo(); },
  _cancelDrag() {
    const id = this._pointer; this._pointer = null; this._dragging = false;
    if (!this.el) return;
    this.el.classList.remove('grab');
    try { if (id !== null && this.el.hasPointerCapture(id)) this.el.releasePointerCapture(id); } catch (_) { /* already lost */ }
  },
  _pauseAll() {
    this._cancelDrag();
    this._stopVideo();
    clearTimeout(this._stateTimer); clearTimeout(this._talkTimer);
    if (this.st !== 'sleep') this.st = 'awake';
    this._scheduleSleep(15000);
  },
  _resume() {
    if (document.hidden) return;
    if (this.st === 'sleep') return;                       /* stay asleep until poked */
    if (this.animated()) this._setState('patrol');
    else this._scheduleSleep(20000);
  },

  /* ---------- main loop: patrol drift & direction mirror ---------- */
  _loop(now) {
    this._raf = requestAnimationFrame(t => this._loop(t));
    if (!this.el || document.hidden || this._dragging) return;
    let dt = (now - (this._last || now)) / 1000; this._last = now;
    if (!(dt > 0) || dt > 0.1) dt = 0.033;
    if (this.st === 'patrol' && this._video && !this._video.paused) {
      const b = this._bounds();
      this._x += this._dir * this.SPEED * dt;
      if (this._x <= 0) { this._x = 0; this._dir = 1; }
      if (this._x >= b.maxX) { this._x = b.maxX; this._dir = -1; }
      this._flip(true);
      this._place();
      if (Date.now() > this._patrolUntil) this._afterVideo();   /* patrol time over → idle */
    }
  },

  _teardown() {
    cancelAnimationFrame(this._raf); this._raf = 0;
    this._cancelDrag(); this._closeMenu();
    clearTimeout(this._stateTimer); clearTimeout(this._sayTimer); clearTimeout(this._talkTimer);
    this._listeners.splice(0).forEach(off => off());
    for (const v of [this._va, this._vb]) if (v) { v.removeAttribute('src'); v.load(); }
    if (this._host) this._host.remove();
    this.el = this._host = this._inner = this._say = null;
    this._img = this._va = this._vb = this._video = null;
    this.st = 'off'; this._last = 0; this._token++;
  }
};
