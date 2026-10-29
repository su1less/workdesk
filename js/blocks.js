/* ============================================================
 * blocks.js — Notion 风格块编辑器（周报月报文档）
 *
 * 数据模型：文档仍是整段 Markdown 字符串（Store 兼容不变），
 * 编辑器把它切成"块"（段落/标题/列表/代码块/表格/公式/引用…），
 * 平铺渲染为 Notion 式页面：点哪块编辑哪块，其余保持渲染态；
 * 键入 / 唤起插入菜单（标题、列表、任务、公式、图片、代码块…）。
 *
 * 中文输入保护：输入法组合期间（isComposing）不拦截按键。
 * ============================================================ */

const Blocks = {

  cur: null,   // 当前实例 { docId, el, ro, frags[], active, slash, timer }

  /* ---------- Markdown ⇄ 块数组 ---------- */
  _kindOf(L) {
    if (/^#{1,6}\s/.test(L)) return 'h';
    if (/^\s*([-*+]|\d+\.)\s/.test(L) || /^\s*\[[xX ]\]\s/.test(L)) return 'list';
    if (/^>/.test(L)) return 'quote';
    if (/^\|/.test(L)) return 'table';
    if (/^\$\$/.test(L)) return 'math';
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(L)) return 'hr';
    return 'p';
  },

  /* Markdown → 块数组（代码围栏 / $$公式块 内部保持原样） */
  parse(md) {
    const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
    const frags = [];
    let buf = [], fence = false, mathFence = false;
    const flush = () => { if (buf.length) { frags.push(buf.join('\n')); buf = []; } };
    for (const L of lines) {
      if (fence) { buf.push(L); if (/^\s*```/.test(L)) fence = false; continue; }
      if (mathFence) { buf.push(L); if (/\$\$\s*$/.test(L)) mathFence = false; continue; }
      const t = L.trim();
      if (!t) { flush(); continue; }
      if (/^\s*```/.test(L)) { flush(); fence = true; buf.push(L); continue; }
      const k = this._kindOf(L);
      if (/^\s{2,}\S|^\t/.test(L) && buf.length) { buf.push(L); continue; }   // 缩进续行并入上一块
      if (k === 'math' && !/\$\$.+\$\$/.test(L)) { flush(); mathFence = true; buf.push(L); continue; }
      if (k === 'h' || k === 'hr') { flush(); frags.push(L); continue; }      // 单行块
      if (!buf.length) { buf.push(L); continue; }
      const pk = this._kindOf(buf[0]);
      if (k === pk || k === 'p' && pk === 'p') buf.push(L);
      else { flush(); buf.push(L); }
    }
    flush();
    return frags.filter(f => f.trim() !== '');
  },

  /* 块数组 → Markdown（空块剔除，块间统一空行） */
  serialize(frags) {
    return frags.map(f => String(f || '').replace(/\s+$/, '')).filter(f => f.trim() !== '').join('\n\n');
  },

  /* ---------- 生命周期 ---------- */
  mount(el, docId) {
    this.flush();
    const doc = Store.getDoc(docId);
    if (!el || !doc) return;
    const inst = {
      docId, el,
      ro: !!Store.readOnly,
      frags: this.parse(doc.content),
      active: -1, slash: -1, slashItems: [], timer: null, menuFor: -1
    };
    if (!inst.frags.length) inst.frags = [''];
    this.cur = inst;
    this._paint(inst);
    if (!inst.ro) {
      el.addEventListener('mousedown', this._onMd);
      this._unload = () => this.flush();
      window.addEventListener('beforeunload', this._unload);
    }
  },

  destroy() {
    if (!this.cur) return;
    this.flush();
    if (!this.cur.ro) this.cur.el.removeEventListener('mousedown', this._onMd);
    window.removeEventListener('beforeunload', this._unload);
    clearTimeout(this.cur.timer);
    this.cur = null;
  },

  /* 立即保存当前编辑中的内容 */
  flush() {
    const c = this.cur;
    if (!c) return;
    if (c.active >= 0) {
      const ta = c.el.querySelector('.nb-ta');
      if (ta) c.frags[c.active] = ta.value;
      c.active = -1;
    }
    clearTimeout(c.timer);
    this._saveNow(c);
  },

  _saveNow(c) {
    const doc = Store.getDoc(c.docId);
    const content = this.serialize(c.frags);
    if (doc && doc.content !== content) Store.updateDoc(c.docId, { content });
  },

  _schedule(c) {
    clearTimeout(c.timer);
    c.timer = setTimeout(() => {
      if (c.active >= 0) {
        const ta = c.el.querySelector('.nb-ta');
        if (ta) c.frags[c.active] = ta.value;
      }
      this._saveNow(c);
    }, 700);
  },

  /* ---------- 渲染 ---------- */
  _paint(c) {
    c.el.innerHTML = c.frags.map((f, i) => this._blockHtml(c, f, i)).join('');
    MD.typeset(c.el);
  },

  _blockHtml(c, f, i) {
    const editing = c.active === i;
    const empty = !editing && f.trim() === '' && c.frags.length === 1;
    const body = editing
      ? `<textarea class="nb-ta" spellcheck="false"></textarea>`
      : `<div class="nb-b md-preview${empty ? ' nb-empty' : ''}">${f.trim() === '' ? '' : MD.render(f)}</div>`;
    const gut = c.ro ? '' : `
      <div class="nb-g">
        <button class="nb-btn" title="在下方插入空块" data-nb="plus">+</button>
        <button class="nb-btn" title="块操作" data-nb="menu">⋮⋮</button>
      </div>`;
    const menu = (c.menuFor === i && !c.ro) ? `
      <div class="nb-menu" data-nb-menu>
        <button data-nb="up">⬆ 上移</button>
        <button data-nb="down">⬇ 下移</button>
        <button data-nb="dup">⧉ 复制块</button>
        <button data-nb="del" class="danger">🗑 删除块</button>
      </div>` : '';
    return `<div class="nb${editing ? ' editing' : ''}${c.ro ? ' ro' : ''}" data-i="${i}">${gut}${menu}
      <div class="nb-w"${c.ro ? '' : ' data-nb="edit"'}>${body}</div>
    </div>`;
  },

  _rerender(c, i) {
    /* 只重画受影响的块，保持其余块的 DOM 稳定 */
    c.el.innerHTML = c.frags.map((f, j) => this._blockHtml(c, f, j)).join('');
    MD.typeset(c.el);
    if (i != null && c.active === i) {
      const ta = c.el.querySelector(`.nb[data-i="${i}"] .nb-ta`);
      if (ta) { this._fit(ta); ta.focus(); }
    }
  },

  /* ---------- 交互 ---------- */
  _onMd(e) {
    const c = Blocks.cur;
    if (!c || c.ro) return;
    const btn = e.target.closest('[data-nb]');
    if (btn && (btn.dataset.nb === 'plus' || btn.dataset.nb === 'menu')) { e.preventDefault(); return; }   // 防止触发块编辑失焦提交
    if (e.target.closest('[data-nb-menu]')) { e.preventDefault(); return; }
  },

  _edit(c, i, caretEnd) {
    if (c.ro || i < 0 || i >= c.frags.length) return;
    if (c.active >= 0) {
      const ta0 = c.el.querySelector('.nb-ta');
      if (ta0) c.frags[c.active] = ta0.value;
      if (c.active === i) return;   // 点击的是正在编辑的块内部：保持不动
    }
    c.active = i;
    c.slash = -1; c.menuFor = -1;
    this._rerender(c, i);
    const ta = c.el.querySelector(`.nb[data-i="${i}"] .nb-ta`);
    if (!ta) return;
    ta.value = c.frags[i];
    this._fit(ta);
    ta.focus();
    const p = caretEnd === false ? 0 : ta.value.length;
    ta.setSelectionRange(p, p);
    this._bindTa(c, i, ta);
  },

  _bindTa(c, i, ta) {
    ta.addEventListener('input', () => {
      c.frags[i] = ta.value;
      this._fit(ta);
      this._slashCheck(c, i, ta);
      this._schedule(c);
    });
    ta.addEventListener('keydown', e => this._taKey(c, i, ta, e));
    ta.addEventListener('blur', () => {
      /* 点击 Slash/块菜单内部时不提交（菜单已 preventDefault mousedown，仍兜底） */
      setTimeout(() => {
        const still = c.el.querySelector('.nb-ta') === ta;
        if (still && c.active === i && !c.el.querySelector('.slash-menu') && !c.el.querySelector('.nb-menu')) {
          c.frags[i] = ta.value;
          c.active = -1;
          this._slashClose(c);
          this._rerender(c);
          this._schedule(c);
        }
      }, 60);
    });
    ta.addEventListener('paste', () => this._schedule(c));
  },

  _fit(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(28, ta.scrollHeight) + 'px';
  },

  _taKey(c, i, ta, e) {
    if (e.isComposing || e.keyCode === 229) return;   // 输入法组合中不拦截
    /* Slash 菜单打开时优先响应 */
    if (c.slash >= 0 && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
      e.preventDefault();
      if (e.key === 'Escape') return this._slashClose(c);
      if (e.key === 'Enter' || e.key === 'Tab') return this._slashApply(c, i, ta);
      const n = c.slashItems.length;
      c.slash = (c.slash + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      return this._slashPaint(c);
    }
    if (e.key === 'Escape') { e.preventDefault(); c.frags[i] = ta.value; c.active = -1; this._rerender(c); return this._schedule(c); }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const pos = ta.selectionStart;
      const v = ta.value;
      c.frags[i] = v.slice(0, pos);
      const after = v.slice(pos).replace(/^\n+/, '');
      if (after.trim() !== '') c.frags.splice(i + 1, 0, after);
      c.frags.splice(i + 1, 0, '');
      c.active = -1;
      this._edit(c, i + 1, false);
      return this._schedule(c);
    }
    if (e.key === 'Backspace' && ta.value === '' && c.frags.length > 1) {
      e.preventDefault();
      c.frags.splice(i, 1);
      this._edit(c, Math.max(0, i - 1), true);
      return this._schedule(c);
    }
    if (e.key === 'ArrowUp' && !ta.value.slice(0, ta.selectionStart).includes('\n') && i > 0) {
      e.preventDefault(); c.frags[i] = ta.value; return this._edit(c, i - 1, true);
    }
    if (e.key === 'ArrowDown' && !ta.value.slice(ta.selectionEnd).includes('\n') && i < c.frags.length - 1) {
      e.preventDefault(); c.frags[i] = ta.value; return this._edit(c, i + 1, false);
    }
  },

  /* ---------- Slash 插入菜单 ---------- */
  SLASH: [
    { k: 'h1',    icon: 'H₁',  label: '一级标题',   pre: '# ' },
    { k: 'h2',    icon: 'H₂',  label: '二级标题',   pre: '## ' },
    { k: 'h3',    icon: 'H₃',  label: '三级标题',   pre: '### ' },
    { k: 'ul',    icon: '•',   label: '无序列表',   pre: '- ' },
    { k: 'ol',    icon: '1.',  label: '有序列表',   pre: '1. ' },
    { k: 'task',  icon: '☑',   label: '任务清单',   pre: '- [ ] ' },
    { k: 'todo',  icon: '☐',   label: '待办（今日）', pre: '- [ ] ' },
    { k: 'quote', icon: '❝',   label: '引用',       pre: '> ' },
    { k: 'code',  icon: '</>', label: '代码块',     pre: '```python\n', post: '\n```' },
    { k: 'math',  icon: '∑',   label: '块级公式',   pre: '$$\n', post: '\n$$' },
    { k: 'imath', icon: '$',   label: '行内公式',   pre: '$', post: '$' },
    { k: 'img',   icon: '🖼',  label: '上传图片',   act: 'image' },
    { k: 'link',  icon: '🔗',  label: '链接',       pre: '[', post: '](https://)' },
    { k: 'table', icon: '▦',   label: '表格',       pre: '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| ', post: ' |  |  |' },
    { k: 'hr',    icon: '—',   label: '分割线',     pre: '---' },
    { k: 'text',  icon: '¶',   label: '正文段落',   pre: '' }
  ],

  _slashCheck(c, i, ta) {
    const m = /^\/([^\s/]*)$/.exec(ta.value);
    if (!m) return this._slashClose(c);
    const q = m[1].toLowerCase();
    c.slashItems = this.SLASH.filter(s => !q || s.label.toLowerCase().includes(q) || s.k.includes(q));
    if (!c.slashItems.length) return this._slashClose(c);
    c.slash = 0;
    this._slashPaint(c);
  },

  _slashClose(c) { c.slash = -1; const m = c.el.querySelector('.slash-menu'); if (m) m.remove(); },

  _slashPaint(c) {
    let m = c.el.querySelector('.slash-menu');
    if (!m) {
      m = document.createElement('div');
      m.className = 'slash-menu';
      m.addEventListener('mousedown', e => e.preventDefault());   // 防止 textarea 失焦
      /* 挂到当前编辑块内部：top:100% 即紧贴块下方，不会被挂载点定位带出视口 */
      const host = c.el.querySelector('.nb[data-i="' + c.active + '"] .nb-w') || c.el;
      host.appendChild(m);
    }
    m.innerHTML = c.slashItems.map((s, j) => `
      <button class="${j === c.slash ? 'on' : ''}" data-si="${j}">
        <span class="si-ic">${s.icon}</span><span>${s.label}</span>
      </button>`).join('');
    m.querySelectorAll('[data-si]').forEach(b => {
      b.addEventListener('click', () => { c.slash = Number(b.dataset.si); this._slashApply(c, c.active, c.el.querySelector('.nb-ta')); });
    });
  },

  _slashApply(c, i, ta) {
    const s = c.slashItems[c.slash];
    this._slashClose(c);
    if (!s || !ta) return;
    if (s.act === 'image') return this._pickImage(c, i);
    if (s.post != null) {
      /* 前后包裹型（代码块/公式/链接/表格）：光标落在中间 */
      ta.value = s.pre + s.post;
      const mid = s.pre.length;
      c.frags[i] = ta.value;
      this._fit(ta);
      ta.focus();
      ta.setSelectionRange(mid, mid);
      this._schedule(c);
      return;
    }
    ta.value = s.pre + ta.value.replace(/^\//, '');
    c.frags[i] = ta.value;
    ta.focus();
    const p = s.pre ? ta.value.length : 0;
    ta.setSelectionRange(p, p);
    this._schedule(c);
  },

  _pickImage(c, i) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      UI.toast('正在处理图片…');
      const ref = await App.uploadImage(f);
      if (!ref) return;
      c.frags[i] = c.frags[i].replace(/^\/\S*\s*$/, '');
      const md = '![图片](' + ref + ')';
      if (c.frags[i].trim() === '') c.frags[i] = md; else c.frags.splice(i + 1, 0, md);
      c.active = -1;
      this._rerender(c);
      this._saveNow(c);
      UI.toast('图片已插入');
    });
    inp.click();
  },

  /* ---------- 块级菜单 / 事件总入口 ---------- */
  handleClick(e) {
    const c = this.cur;
    if (!c) return false;
    /* Slash 菜单按钮 */
    const si = e.target.closest('[data-si]');
    if (si) return true;
    /* 块菜单动作 */
    const act = e.target.closest('[data-nb]');
    if (!act) return false;
    const kind = act.dataset.nb;
    const blk = act.closest('.nb');
    const i = blk ? Number(blk.dataset.i) : -1;
    if (c.active >= 0) {
      const ta = c.el.querySelector('.nb-ta');
      if (ta) c.frags[c.active] = ta.value;
      c.active = -1;
    }
    if (kind === 'plus') {
      c.frags.splice(i + 1, 0, '');
      this._edit(c, i + 1, true);
      this._schedule(c);
      return true;
    }
    if (kind === 'menu') {
      c.menuFor = c.menuFor === i ? -1 : i;
      this._rerender(c);
      return true;
    }
    if (kind === 'up' && i > 0) { [c.frags[i - 1], c.frags[i]] = [c.frags[i], c.frags[i - 1]]; c.menuFor = -1; this._rerender(c); this._schedule(c); return true; }
    if (kind === 'down' && i < c.frags.length - 1) { [c.frags[i], c.frags[i + 1]] = [c.frags[i + 1], c.frags[i]]; c.menuFor = -1; this._rerender(c); this._schedule(c); return true; }
    if (kind === 'dup') { c.frags.splice(i + 1, 0, c.frags[i]); c.menuFor = -1; this._rerender(c); this._schedule(c); return true; }
    if (kind === 'del') {
      c.frags.splice(i, 1);
      if (!c.frags.length) c.frags = [''];
      c.menuFor = -1;
      this._rerender(c);
      this._schedule(c);
      return true;
    }
    if (kind === 'edit') { this._edit(c, i, true); return true; }
    return false;
  }
};

/* 全局点击代理：块菜单/编辑入口 */
document.addEventListener('click', e => { Blocks.handleClick(e); }, true);
