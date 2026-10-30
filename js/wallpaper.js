/* Wallpaper — local atmospheric scenes and custom media.
 * Visual reference: elysia395/dsh-wallpaper-engine (MIT), default-wallpaper.
 * No upstream artwork or rendering dependencies are bundled.
 * Settings: wallpaper, wallpaperUrl, wallpaperMediaType ('auto'|'image'|'video'),
 * wallpaperMotion (true), wallpaperDim (0..0.75). System reduced motion wins.
 */
const Wallpaper = {
  _raf: 0, _ctx: null, _cv: null, _scene: null, _parts: [],
  _t: 0, _last: 0, _video: null, _host: null, _listeners: [], _generation: 0,
  SCENES: ['starfield', 'aurora', 'sakura'],
  PRESETS: ['aqua', 'starfield', 'aurora', 'sakura', 'rhine', 'default', 'custom'],

  apply() {
    this.destroy();
    const st = typeof Store !== 'undefined' ? Store.db.settings : {};
    const host = document.getElementById('wallpaper');
    if (!host) return;
    this._host = host;
    const wp = this.PRESETS.includes(st.wallpaper) ? st.wallpaper : 'aqua';
    document.body.dataset.wallpaper = wp;
    host.dataset.scene = wp;
    host.setAttribute('aria-hidden', 'true');
    const dim = Number(st.wallpaperDim);
    host.style.setProperty('--wallpaper-dim', String(st.wallpaperDim != null && Number.isFinite(dim)
      ? Math.max(0, Math.min(0.75, dim)) : wp === 'custom' ? 0.36 : wp === 'sakura' ? 0.04 : 0.18));
    const canvas = document.createElement('canvas');
    canvas.id = 'wallCanvas';
    const video = document.createElement('video');
    video.id = 'wallVideo';
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('playsinline', '');
    const image = document.createElement('img');
    image.id = 'wallImage';
    image.alt = '';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    const light = document.createElement('div');
    light.className = 'wallpaper-light';
    const scrim = document.createElement('div');
    scrim.className = 'wallpaper-scrim';
    host.replaceChildren(image, video, canvas, light, scrim);
    this._motionAllowed = st.wallpaperMotion !== false;
    this._mediaQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this._listen(document, 'visibilitychange', () => this._syncPlayback());
    this._listen(window, 'pagehide', () => { this._pageHidden = true; this._syncPlayback(); });
    this._listen(window, 'pageshow', () => { this._pageHidden = false; this._syncPlayback(); });
    if (this._mediaQuery) {
      const onMotion = () => this._syncPlayback();
      if (this._mediaQuery.addEventListener) this._listen(this._mediaQuery, 'change', onMotion);
      else if (this._mediaQuery.addListener) {
        this._mediaQuery.addListener(onMotion);
        this._listeners.push(() => this._mediaQuery.removeListener(onMotion));
      }
    }
    if (this.SCENES.includes(wp)) {
      this._cv = canvas;
      this._ctx = canvas.getContext('2d');
      this._scene = wp;
      canvas.style.display = 'block';
      this._resize();
      this._listen(window, 'resize', () => this._resize());
    } else if (wp === 'custom') {
      const url = this._safeUrl(st.wallpaperUrl);
      if (url) {
        const explicit = st.wallpaperMediaType;
        const isVideo = explicit === 'video' || (explicit !== 'image' &&
          (/\.(mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i.test(url) || /^data:video\//i.test(url)));
        const media = isVideo ? video : image;
        this._listen(media, 'error', () => {
          host.dataset.mediaState = 'error';
          media.style.display = 'none';
          if (isVideo) { video.pause(); this._video = null; }
        });
        this._listen(media, isVideo ? 'loadeddata' : 'load', () => { host.dataset.mediaState = 'ready'; });
        host.dataset.mediaState = 'loading';
        media.style.display = 'block';
        if (isVideo) this._video = video;
        media.src = url;
      } else host.dataset.mediaState = 'empty';
    }
    this._syncPlayback();
  },

  _safeUrl(value) {
    if (!value || typeof value !== 'string') return '';
    try {
      const url = new URL(value.trim(), document.baseURI);
      if (/^https?:$/.test(url.protocol) || url.protocol === 'blob:') return url.href;
      if (url.protocol === 'data:' && /^data:(image\/(?:png|jpeg|gif|webp|avif)|video\/(?:mp4|webm|ogg));/i.test(value.trim())) return value.trim();
    } catch (_) { /* Invalid and active-content URLs retain the local fallback. */ }
    return '';
  },

  _listen(target, type, callback) {
    target.addEventListener(type, callback);
    this._listeners.push(() => target.removeEventListener(type, callback));
  },

  _syncPlayback() {
    if (!this._host) return;
    const paused = !!(document.hidden || this._pageHidden || !this._motionAllowed ||
      (this._mediaQuery && this._mediaQuery.matches));
    this._host.dataset.paused = String(paused);
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._last = 0;
    if (this._video) {
      if (paused) this._video.pause();
      else {
        const generation = this._generation;
        const play = this._video.play();
        if (play && play.catch) play.catch(() => {
          if (generation === this._generation && this._host) this._host.dataset.mediaState = 'paused';
        });
      }
    }
    if (this._ctx) {
      this._draw(0);
      if (!paused) this._raf = requestAnimationFrame(t => this._loop(t));
    }
  },

  _resize() {
    if (!this._cv || !this._host) return;
    // A background does not need retina-sized buffers; cap at ~2MP and 1x DPR.
    const w = Math.max(1, this._host.clientWidth || window.innerWidth);
    const h = Math.max(1, this._host.clientHeight || window.innerHeight);
    const scale = Math.min(1, Math.sqrt(2073600 / (w * h)));
    this._cv.width = Math.round(w * scale);
    this._cv.height = Math.round(h * scale);
    this._parts = [];
    if (!document.hidden) this._draw(0);
  },

  _loop(now) {
    this._raf = 0;
    if (!this._ctx || !this._host || this._host.dataset.paused === 'true') return;
    if (!this._last || now - this._last >= 50) {
      const dt = this._last ? Math.min(0.1, (now - this._last) / 1000) : 0;
      this._last = now;
      this._t += dt;
      this._draw(dt);
    }
    this._raf = requestAnimationFrame(t => this._loop(t));
  },

  _draw(dt) {
    if (!this._ctx || !this._cv) return;
    this._ctx.clearRect(0, 0, this._cv.width, this._cv.height);
    this['_sc_' + this._scene](this._ctx, this._cv.width, this._cv.height, dt);
  },

  destroy() {
    this._generation++;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._listeners.splice(0).forEach(remove => remove());
    if (this._video) {
      this._video.pause();
      this._video.removeAttribute('src');
      this._video.load();
    }
    if (this._host) {
      this._host.replaceChildren();
      this._host.style.removeProperty('--wallpaper-dim');
      this._host.style.backgroundImage = '';
      delete this._host.dataset.paused;
      delete this._host.dataset.scene;
      delete this._host.dataset.mediaState;
    }
    this._host = this._ctx = this._cv = this._video = this._mediaQuery = null;
    this._scene = null;
    this._parts = [];
    this._t = this._last = 0;
    this._pageHidden = false;
  },

  /* ---------- 场景：星河（视差星点 + 流星） ---------- */
  _sc_starfield(ctx, W, H, dt) {
    if (!this._parts.length) {
      for (let i = 0; i < 150; i++) this._parts.push({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() < 0.85 ? 0.6 + Math.random() * 1.1 : 1.6 + Math.random() * 1.2,
        tw: Math.random() * 6.28, v: 2 + Math.random() * 5,
        layer: 0.3 + Math.random() * 0.7, shoot: false
      });
      this._parts.push({ shoot: true, x: -100, y: 80, v: 520, life: 0, wait: 4 });
    }
    for (const p of this._parts) {
      if (p.shoot) {
        /* 流星：等待-划过-重置 */
        p.wait -= dt;
        if (p.wait <= 0) {
          p.life += dt;
          p.x += p.v * dt; p.y += p.v * 0.38 * dt;
          const tail = 130;
          const g = ctx.createLinearGradient(p.x, p.y, p.x - tail, p.y - tail * 0.38);
          g.addColorStop(0, 'rgba(210,235,255,0.9)');
          g.addColorStop(1, 'rgba(210,235,255,0)');
          ctx.strokeStyle = g; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - tail, p.y - tail * 0.38); ctx.stroke();
          if (p.x > W + 150 || p.y > H + 100) {
            p.x = -120; p.y = Math.random() * H * 0.4;
            p.wait = 5 + Math.random() * 9; p.life = 0;
          }
        }
        continue;
      }
      p.tw += dt * 1.4;
      p.y += p.v * p.layer * dt * 0.22;
      if (p.y > H + 2) { p.y = -2; p.x = Math.random() * W; }
      const a = 0.35 + Math.sin(p.tw) * 0.3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.28);
      ctx.fillStyle = 'rgba(214,230,255,' + a.toFixed(3) + ')';
      ctx.fill();
    }
  },

  /* ---------- 场景：极光（飘带） ---------- */
  _sc_aurora(ctx, W, H, dt) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bands = [
      { hue: [64, 220, 185], y: 0.30, amp: 60, sp: 0.32, w: 130 },
      { hue: [128, 96, 255], y: 0.42, amp: 84, sp: 0.22, w: 170 },
      { hue: [46, 156, 255], y: 0.24, amp: 46, sp: 0.42, w: 100 }
    ];
    for (const b of bands) {
      ctx.beginPath();
      const step = 26;
      ctx.moveTo(-20, H * b.y);
      for (let x = -20; x <= W + 20; x += step) {
        const y = H * b.y + Math.sin(x / 240 + this._t * b.sp) * b.amp
          + Math.sin(x / 90 - this._t * b.sp * 1.7) * b.amp * 0.3;
        ctx.lineTo(x, y);
      }
      for (let x = W + 20; x >= -20; x -= step) {
        const y = H * b.y + Math.sin(x / 240 + this._t * b.sp) * b.amp
          + Math.sin(x / 90 - this._t * b.sp * 1.7) * b.amp * 0.3;
        ctx.lineTo(x, y + b.w);
      }
      ctx.closePath();
      const g = ctx.createLinearGradient(0, H * b.y - b.amp, 0, H * b.y + b.w);
      g.addColorStop(0, 'rgba(' + b.hue.join(',') + ',0)');
      g.addColorStop(0.5, 'rgba(' + b.hue.join(',') + ',0.16)');
      g.addColorStop(1, 'rgba(' + b.hue.join(',') + ',0)');
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();
  },

  /* ---------- 场景：樱花（飘落花瓣 + 光斑） ---------- */
  _sc_sakura(ctx, W, H, dt) {
    if (!this._parts.length) {
      for (let i = 0; i < 34; i++) this._parts.push({
        x: Math.random() * W, y: Math.random() * H,
        s: 4 + Math.random() * 7, v: 22 + Math.random() * 34,
        w: Math.random() * 6.28, wv: 0.8 + Math.random() * 1.6,
        rot: Math.random() * 6.28, rv: (Math.random() - 0.5) * 2
      });
    }
    for (const p of this._parts) {
      p.w += dt * p.wv;
      p.rot += dt * p.rv;
      p.y += p.v * dt;
      const x = p.x + Math.sin(p.w) * 34;
      if (p.y > H + 14) { p.y = -14; p.x = Math.random() * W; }
      ctx.save();
      ctx.translate(x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = 'rgba(255,166,196,0.5)';
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s, p.s * 0.62, 0, 0, 6.28);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,214,230,0.65)';
      ctx.beginPath();
      ctx.ellipse(-p.s * 0.2, -p.s * 0.15, p.s * 0.5, p.s * 0.3, 0, 0, 6.28);
      ctx.fill();
      ctx.restore();
    }
  }
};
