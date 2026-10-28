/* ============================================================
 * refs.js — 文献管理：BibTeX 解析/导出 + 领域逻辑
 * 全局命名空间：Refs（视图在 ui.js，交互在 app.js）
 * ============================================================ */

const Refs = {

  ST: { want: { l: '想读', c: 'chip-gray' }, reading: { l: '在读', c: 'chip-blue' }, read: { l: '已读', c: 'chip-green' } },
  TY: { paper: { l: '论文' }, book: { l: '书籍' }, article: { l: '文章' }, other: { l: '其他' } },

  stars(n) { n = Math.max(0, Math.min(5, n || 0)); return '★'.repeat(n) + '☆'.repeat(5 - n); },

  /* 清洗 LaTeX 记号：花括号、转义符、命令 */
  cleanTex(s) {
    return String(s || '')
      .replace(/\\%/g, '%').replace(/\\&/g, '&').replace(/\\_/g, '_').replace(/\\\$/g, '$')
      .replace(/\\[a-zA-Z]+\s?/g, '')
      .replace(/[{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  },

  /* BibTeX 作者名 "Last, First and Last, First" → "First Last, First Last" */
  fmtAuthors(s) {
    if (!s) return '';
    return String(s).split(/\s+and\s+/i).map(p => p.trim()).filter(Boolean).map(p => {
      if (/others/i.test(p)) return '等';
      if (p.includes(',')) {
        const idx = p.indexOf(',');
        return (p.slice(idx + 1).trim() + ' ' + p.slice(0, idx).trim()).trim();
      }
      return p;
    }).join(', ');
  },

  /* ---------- BibTeX 解析 ---------- */
  parseBibtex(text) {
    const out = { refs: [], warnings: [] };
    const re = /@(\w+)\s*([{(])/g;
    let m;
    while ((m = re.exec(text))) {
      const type = m[1].toLowerCase();
      if (['comment', 'preamble', 'string'].includes(type)) continue;
      const openCh = m[2], closeCh = openCh === '{' ? '}' : ')';
      let depth = 1, end = -1;
      for (let j = re.lastIndex; j < text.length; j++) {
        const c = text[j];
        if (c === openCh) depth++;
        else if (c === closeCh) { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end < 0) { out.warnings.push('存在未闭合的条目，已忽略末尾内容'); break; }
      const body = text.slice(re.lastIndex, end);
      re.lastIndex = end + 1;
      const r = this._parseEntry(type, body, out.warnings);
      if (r) out.refs.push(r);
    }
    if (!out.refs.length) out.warnings.push('未解析到 BibTeX 条目（支持 @article / @inproceedings / @book 等）');
    return out;
  },

  _parseEntry(type, body, warnings) {
    /* key */
    const keyEnd = body.indexOf(',');
    if (keyEnd < 0) { warnings.push('一条 ' + type + ' 条目缺少字段，已跳过'); return null; }
    const s = body.slice(keyEnd + 1);

    /* 逐字段解析（花括号/引号/裸值，逗号分隔） */
    const f = {};
    let i = 0;
    while (i < s.length) {
      while (i < s.length && /[\s,]/.test(s[i])) i++;
      if (i >= s.length) break;
      const nm = s.slice(i).match(/^([\w+-]+)\s*=\s*/);
      if (!nm) break;
      i += nm[0].length;
      let val = '';
      if (s[i] === '{') {
        i++; const st = i; let d = 1;
        while (i < s.length) {
          if (s[i] === '{') d++;
          else if (s[i] === '}') { d--; if (d === 0) break; }
          i++;
        }
        val = s.slice(st, i); i++;
      } else if (s[i] === '"') {
        i++; const st = i;
        while (i < s.length && s[i] !== '"') {
          if (s[i] === '{') { let d = 1; while (i < s.length && d > 0) { i++; if (s[i] === '{') d++; else if (s[i] === '}') d--; } }
          i++;
        }
        val = s.slice(st, i); i++;
      } else {
        const st = i;
        while (i < s.length && s[i] !== ',') i++;
        val = s.slice(st, i);
      }
      f[nm[1].toLowerCase()] = val;
    }

    const TYMAP = {
      article: 'paper', inproceedings: 'paper', conference: 'paper', incollection: 'paper',
      book: 'book', inbook: 'book', phdthesis: 'other', mastersthesis: 'other',
      techreport: 'article', online: 'article', electronic: 'article', misc: 'other', unpublished: 'other'
    };
    const title = this.cleanTex(f.title || '');
    if (!title) { warnings.push('一条 ' + type + ' 条目缺少 title，已跳过'); return null; }
    const ym = (f.year || '').match(/\d{4}/);
    let url = this.cleanTex(f.url || '');
    if (!url && f.eprint) url = 'https://arxiv.org/abs/' + this.cleanTex(f.eprint);
    return {
      title,
      authors: this.fmtAuthors(this.cleanTex(f.author || f.editor || '')),
      year: ym ? +ym[0] : null,
      venue: this.cleanTex(f.journal || f.booktitle || f.publisher || f.school || f.institution || f.howpublished || ''),
      type: TYMAP[type] || 'other',
      doi: this.cleanTex(f.doi || ''),
      url,
      tags: this.cleanTex(f.keywords || '').split(/[;,，、]/).map(t => t.trim()).filter(Boolean),
      abstract: this.cleanTex(f.abstract || '').slice(0, 500),
      status: 'want', rating: 0, readProgress: 0,
      source: 'BibTeX'
    };
  },

  /* ---------- BibTeX 导出 ---------- */
  toBibtex(list) {
    return list.map(r => {
      const ty = { paper: 'article', book: 'book', article: 'misc', other: 'misc' }[r.type || 'paper'];
      const key = (String(r.title || 'ref').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'ref')
        + (r.year || '') + '_' + (r.id ? r.id.slice(-4) : Date.now().toString(36).slice(-4));
      const L = ['@' + ty + '{' + key + ','];
      if (r.title) L.push('  title = {' + r.title + '}');
      if (r.authors) L.push('  author = {' + r.authors + '}');
      if (r.year) L.push('  year = {' + r.year + '}');
      if (r.venue) L.push('  ' + (ty === 'article' ? 'journal' : 'booktitle') + ' = {' + r.venue + '}');
      if (r.doi) L.push('  doi = {' + r.doi + '}');
      if (r.url) L.push('  url = {' + r.url + '}');
      if ((r.tags || []).length) L.push('  keywords = {' + r.tags.join('; ') + '}');
      if (r.abstract) L.push('  abstract = {' + r.abstract + '}');
      L.push('}');
      return L.join(',\n');
    }).join('\n\n') + '\n';
  },

  /* ---------- 与任务联动 ---------- */
  taskFromRef(id, when) {
    const r = Store.getRef(id);
    if (!r) return null;
    const today = U.todayStr();
    return Store.addTask({
      title: '阅读《' + r.title + '》',
      level: when === 'week' ? 'week' : 'day',
      date: when === 'week' ? U.weekStart(today) : today,
      priority: 'mid',
      status: r.status === 'read' ? 'done' : 'todo',
      progress: r.status === 'read' ? 100 : 0,
      tags: ['文献'].concat((r.tags || []).slice(0, 2)),
      note: (r.authors ? '作者：' + r.authors + '\n' : '') + (r.venue ? r.venue + (r.year ? ' · ' + r.year : '') : ''),
      refId: r.id
    });
  }
};
