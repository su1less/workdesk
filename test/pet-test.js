'use strict';
/* Behaviour-chain tests against the official dsh-pet clip set:
 * landing → patrol (mirrored crab walk) → idle → look-around/daze → yawn →
 * sleep loop; wake → stretch; click responses; drag feedback; cleanup. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

class Target {
  constructor() { this.events = new Map(); }
  addEventListener(n, f) { if (!this.events.has(n)) this.events.set(n, new Set()); this.events.get(n).add(f); }
  removeEventListener(n, f) { this.events.get(n)?.delete(f); }
  fire(n, data = {}) { for (const f of [...(this.events.get(n) || [])]) f({ preventDefault() {}, ...data }); }
  count() { return [...this.events.values()].reduce((a, s) => a + s.size, 0); }
}
function setup({ fail = false, blocked = false } = {}) {
  const nodes = new Set(), timers = new Map(); let tid = 0, nav = 0;
  class Element extends Target {
    constructor(tag) {
      super(); this.tagName = tag; this.style = {}; this.children = [];
      this.offsetWidth = 104; this.offsetHeight = 104;
      const cls = new Set();
      this.classList = { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, on) => { (on ? cls.add(c) : cls.delete(c)); } };
      nodes.add(this); this.paused = true; this.src = '';
    }
    appendChild(c) { this.children.push(c); c.parent = this; }
    querySelectorAll(sel) {
      const cls = sel.match(/\.([\w-]+)/); const out = [];
      const walk = n => { for (const c of n.children || []) { if (cls ? (c.className || '').split(' ').includes(cls[1]) && String(sel).startsWith('.') : true) out.push(c); walk(c); } };
      walk(this); return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    remove() { for (const c of this.children) c.remove(); nodes.delete(this); }
    setAttribute(n, v) { this[n] = v; } getAttribute(n) { return this[n] ?? null; } removeAttribute(n) { delete this[n]; }
    setPointerCapture(id) { this.capture = id; }
    hasPointerCapture(id) { return this.capture === id; }
    releasePointerCapture(id) { this.capture = null; this.fire('lostpointercapture', { pointerId: id }); }
    play() { this.paused = false; return fail ? Promise.reject(new Error('codec')) : blocked ? Promise.reject({ name: 'NotAllowedError' }) : Promise.resolve(); }
    pause() { this.paused = true; this.classList.remove('on'); }
    load() {}
  }
  const document = new Target(); document.hidden = false; document.body = new Element('body');
  document.createElement = t => new Element(t);
  document.getElementById = id => [...nodes].find(n => n.id === id) || null;
  const motion = new Target(); motion.matches = false; motion.addEventListener = () => {};
  const window = new Target(); window.innerWidth = 1200; window.innerHeight = 800;
  window.matchMedia = () => motion;
  const Store = { db: { settings: { pet: true } }, readOnly: false };
  const ctx = vm.createContext({
    document, window, Store,
    App: { state: { view: 'today' }, go() { nav++; } },
    setTimeout(fn, ms) { timers.set(++tid, { fn, ms }); return tid; },
    clearTimeout(id) { timers.delete(id); },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {}
  });
  vm.runInContext(
    fs.readFileSync(path.join(root, 'js/pet-art.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(root, 'js/pet.js'), 'utf8') + '\nglobalThis.pet = Pet;', ctx);
  return { pet: ctx.pet, window, document, motion, Store, timers, nodes, nav: () => nav };
}
const active = p => p._video && !p._video.paused ? p._video : null;
const srcEnd = v => v && String(v.src || '').split('/').pop();
const fireEnd = p => { const v = p._video; v.fire('ended'); };

(async () => {
  const s = setup(), p = s.pet; p.init();

  /* entry: landing starts the official chain, greeting bubble shows */
  assert.equal(p._skinKey, 'mascot'); assert.equal(p.st, 'landing');
  assert.equal(srcEnd(active(p)), 'landing.webm');
  assert.equal(p._say.textContent, '有什么可以帮你？');
  assert(p._say.classList.contains('show'));

  /* landing → patrol: looping crab walk, mirrored to the travel direction */
  const first = p._video; first.fire('playing'); assert(first.classList.contains('on'));
  fireEnd(p);
  assert.equal(p.st, 'patrol'); assert.equal(srcEnd(active(p)), 'walk.webm');
  assert.equal(p._video.loop, true, 'walk loops while patrolling');
  assert.notEqual(p._video, first, 'chains on the spare video element');

  /* patrol drifts and mirrors */
  const x0 = p._x; p._dir = 1;
  p._loop(1000); p._loop(1500);
  assert(p._x > x0, 'patrol drifts right');
  assert(p.el.classList.contains('pet-flip') === false, 'facing right is unmirrored');
  p._dir = -1; p._loop(2000);
  assert(p.el.classList.contains('pet-flip'), 'facing left mirrors the clip');

  /* patrol time over → idle breathing → spacing out → yawn → sleep loop */
  p._patrolUntil = Date.now() - 1; p._loop(2100);
  assert.equal(p.st, 'idle'); assert.equal(srcEnd(active(p)), 'idle.webm');
  const toSpace = [...s.timers.entries()].find(([, t]) => t.ms === 6000);
  assert(toSpace, 'idle schedules spacing out');
  s.timers.delete(toSpace[0]); toSpace[1].fn();
  assert.ok(['lookAround', 'daze'].includes(p.st), 'idle flows into look-around or daze');
  assert.ok(/(look-around|daze)\.webm$/.test(srcEnd(active(p))));
  fireEnd(p); assert.equal(p.st, 'yawn'); assert.equal(srcEnd(active(p)), 'yawn.webm');
  fireEnd(p);
  assert.equal(p.st, 'sleep'); assert.equal(srcEnd(active(p)), 'sleep.webm');
  assert.equal(p._video.loop, true, 'sleep loops');
  assert(p.el.classList.contains('pet-sleep'));

  /* poke during sleep: startled wake → stretch → patrol */
  p._poke();
  assert.equal(p.st, 'wake'); assert.equal(srcEnd(active(p)), 'wake.webm');
  assert(!p.el.classList.contains('pet-sleep'));
  assert.equal(s.nav(), 1, 'poke opens the assistant view once');
  fireEnd(p); assert.equal(p.st, 'stretch'); assert.equal(srcEnd(active(p)), 'stretch.webm');
  fireEnd(p); assert.equal(p.st, 'patrol');

  /* click responses come from the official set */
  const dist = new Set();
  for (let i = 0; i < 300; i++) { const r = Math.random(); dist.add(r < 0.4 ? 'wave' : r < 0.8 ? 'happy' : 'huffy'); }
  assert.deepEqual([...dist].sort(), ['happy', 'huffy', 'wave']);
  p._poke(); assert.ok(['wave', 'happy', 'huffy'].includes(p.st));
  assert.ok(/(wave|happy|huffy)\.webm$/.test(srcEnd(active(p))));
  fireEnd(p); assert.equal(p.st, 'idle');

  /* drag: suspended-feedback clip plays while held; release lands */
  p.el.fire('pointerdown', { pointerId: 1, button: 0, clientX: 40, clientY: 600 });
  assert.equal(p.st, 'drag'); assert.equal(srcEnd(active(p)), 'drag.webm');
  assert.equal(p._video.loop, true, 'drag feedback loops while held');
  const before = p.el.style.transform;
  s.window.fire('pointermove', { pointerId: 1, clientX: 500, clientY: 300 });
  assert.notEqual(p.el.style.transform, before, 'pose follows the pointer');
  s.window.fire('pointerup', { pointerId: 1 });
  assert.equal(p.st, 'landing');

  /* tap counts as a poke, not a drag */
  p.el.fire('pointerdown', { pointerId: 2, button: 0, clientX: 40, clientY: 600 });
  s.window.fire('pointerup', { pointerId: 2 });
  assert.ok(['wave', 'happy', 'huffy'].includes(p.st), 'tap triggers a click response');

  /* retired skins migrate onto the official character; logo follows */
  for (const skin of ['dsh', 'glm', 'puppet']) {
    s.Store.db.settings.petSkin = skin; p.toggle(false); p.init();
    assert.equal(p._skinKey, 'mascot', `skin ${skin} unifies onto mascot`);
    assert(p._img.src.includes('mascot.png'));
    assert.match(p.logoHTML(), /mascot\.png/);
    p.toggle(false);
  }
  s.Store.db.settings.petSkin = 'whale'; p.init();
  assert.equal(p._skinKey, 'whale'); assert.match(p.logoHTML(), /<svg/);
  assert.equal(p.animated(), false);
  p.toggle(false);
  s.Store.db.settings.petSkin = 'mascot';

  /* right-click menu opens with the official action set; picking plays it */
  p.init();
  p.el.fire('contextmenu', { clientX: 300, clientY: 400 });
  assert(p._menuEl, 'context menu opens');
  const menuKeys = p.MENU.map(([k]) => k);
  assert.ok(menuKeys.includes('sleep') && menuKeys.includes('wave') && menuKeys.includes('patrol'), 'menu covers the action set');
  p._menuAct('yawn');
  assert.equal(p._menuEl, null, 'choosing closes the menu');
  assert.equal(p.st, 'yawn'); assert.ok(/yawn\.webm$/.test(srcEnd(active(p))));
  fireEnd(p); assert.equal(p.st, 'sleep', 'menu yawn still chains into sleep');
  p._closeMenu();
  p.toggle(false);

  /* hidden tab pauses; returning resumes the patrol (asleep stays asleep) */
  p.init(); fireEnd(p); /* patrol */
  s.document.hidden = true; s.document.fire('visibilitychange');
  assert(!active(p)); assert.equal(p.st, 'awake');
  s.document.hidden = false; s.document.fire('visibilitychange');
  assert.equal(p.st, 'patrol'); p.toggle(false);

  /* decode failure falls back to the still pose with one clean timer */
  const f = setup({ fail: true }); f.pet.init();
  await Promise.resolve(); await Promise.resolve();
  assert(f.pet._videoFailed); assert(!f.pet.el.classList.contains('pet-playing'));
  assert.equal(f.timers.size, 2, 'sleep fallback + greeting bubble timers only');
  f.pet.toggle(false); assert.equal(f.timers.size, 0);

  /* autoplay blocked: wait for first gesture instead of falling back */
  const g = setup({ blocked: true }); g.pet.init();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(g.pet._videoFailed, false, 'blocked autoplay is not a decode failure');
  assert.equal(g.pet.st, 'awake');
  g.document.fire('pointerdown', {});
  assert.equal(g.pet.st, 'landing'); assert.ok(active(g.pet), 'gesture restarts the chain');
  g.pet.toggle(false);

  /* full teardown removes every listener and node */
  const c = setup(); c.pet.init(); c.pet.toggle(false);
  assert.equal(c.window.count() + c.document.count(), 0, 'listeners gone');
  assert.equal(c.pet.el, null); assert.equal(c.timers.size, 0);
  assert(![...c.nodes].some(n => n !== c.document.body), 'all pet DOM nodes removed');
  for (let i = 0; i < 5; i++) { c.pet.init(); c.pet.refresh(); c.pet.toggle(false); }
  assert.equal(c.timers.size, 0);

  /* assets: official clips present, genuine unmodified WebM containers */
  const map = {
    'landing.webm': '原地重力下蹲压缩',
    'walk.webm': '螃蟹走路',
    'idle.webm': '待机呼吸休闲',
    'look-around.webm': '东张西望',
    'daze.webm': '碎碎念-发呆碎碎念',
    'yawn.webm': '哈欠连天',
    'stretch.webm': '超大伸懒腰',
    'sleep.webm': '原地小憩沉眠',
    'wake.webm': '打瞌睡被惊醒',
    'drag.webm': '被鼠标拖拽悬空反馈',
    'wave.webm': '点击回应-元气挥手',
    'happy.webm': '点击回应-开心跃动',
    'huffy.webm': '点击回应-傲娇生气'
  };
  const upstream = 'C:/Users/ASUS/AppData/Local/Temp/dsh-pet';
  for (const [name, cn] of Object.entries(map)) {
    const bytes = fs.readFileSync(path.join(root, 'vendor/pet/animations', name));
    assert.equal(bytes.subarray(0, 4).toString('hex'), '1a45dfa3');
    const src = fs.existsSync(path.join(upstream, 'dsh-pet/assets/webm', cn + '.webm'))
      ? path.join(upstream, 'dsh-pet/assets/webm', cn + '.webm') : null;
    if (src) assert(bytes.equals(fs.readFileSync(src)), `${name} must remain unmodified`);
  }
  console.log('Pet tests passed: official dsh-pet chain, patrol mirror, idle/daze/yawn/sleep, wake, click set, drag, fallback, cleanup, assets.');
})().catch(e => { console.error(e); process.exitCode = 1; });
