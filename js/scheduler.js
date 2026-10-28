/* ============================================================
 * scheduler.js — 突发日程的冲突检测与自动调整引擎
 *
 * 策略（参考 Motion 的自动排程思想）：
 *  1. 固定日程（fixed / event）永远不动，作为占用块
 *  2. 与突发日程冲突的「可调任务」按原开始时间排序，
 *     依次寻找新时间槽：优先当日突发日程之后的空档，
 *     放不下则向后逐日寻找（最多 7 天）
 *  3. 已被移动的任务占用新位置，避免互相堆叠
 *  4. 与突发日程冲突的固定日程无法自动调整 → 仅提示
 * ============================================================ */

const Scheduler = {

  /* 当天所有时间块（不含突发日程本身） */
  _dayBlocks(day, excludeIds) {
    return Store.tasks()
      .filter(t => t.date === day && t.start && !excludeIds.includes(t.id))
      .map(t => ({ id: t.id, s: U.hm(t.start), e: U.hm(t.end || U.minHM(U.hm(t.start) + 60)) }));
  },

  /**
   * 计算突发日程的调整方案（不修改数据）
   * @param evt {date,start,end,title} 待加入的突发日程
   * @returns {{fixedConf:Array, moves:Array}}
   *          fixedConf: 冲突的固定日程（无法自动调整，仅提示）
   *          moves: 可调任务的移动方案 {taskId,date,start,end,reason,failed}
   */
  propose(evt) {
    const set = Store.db.settings;
    const dayStart = U.hm(set.workingStart), dayEnd = U.hm(set.workingEnd);
    const evtS = U.hm(evt.start), evtE = U.hm(evt.end);

    /* 与突发日程冲突的当天条目 */
    const conf = Store.tasks().filter(t =>
      t.date === evt.date && t.start &&
      U.hm(t.start) < evtE && evtS < U.hm(t.end || U.minHM(U.hm(t.start) + 60))
    );
    const fixedConf = conf.filter(t => t.fixed || t.kind === 'event');
    const flex = conf.filter(t => !(t.fixed || t.kind === 'event'))
      .sort((a, b) => U.hm(a.start) - U.hm(b.start));

    const movedIds = [];   // 已迁移任务（原位置释放）
    const placed = [];     // 已安排的新位置 {id,date,s,e}
    const moves = [];

    const findSlot = (day, durMin, afterMin) => {
      /* 该日占用块 = 所有未迁移的时间块 + 突发日程（若当日）+ 已安排的新位置 */
      let blocks = this._dayBlocks(day, movedIds).map(b => ({ s: b.s, e: b.e }));
      if (day === evt.date) blocks.push({ s: evtS, e: evtE });
      placed.forEach(p => { if (p.date === day) blocks.push({ s: p.s, e: p.e }); });
      blocks.sort((a, b) => a.s - b.s);
      let cur = Math.max(afterMin, dayStart);
      for (const b of blocks) {
        if (b.e <= cur) continue;
        if (cur + durMin <= b.s) return cur;      /* 当前游标与下一块之间的空档够用 */
        cur = Math.max(cur, b.e);
      }
      return cur + durMin <= dayEnd ? cur : null;
    };

    for (const t of flex) {
      const dur = Math.max(15, U.hm(t.end || U.minHM(U.hm(t.start) + 60)) - U.hm(t.start) || 60);
      movedIds.push(t.id);
      let slot = findSlot(evt.date, dur, evtE);
      let targetDay = evt.date, reason = '当日顺延';
      if (slot === null) {
        for (let i = 1; i <= 7; i++) {
          const d = U.addDays(evt.date, i);
          slot = findSlot(d, dur, dayStart);
          if (slot !== null) { targetDay = d; reason = '当日放不下，顺延至 ' + U.fmtCN(d) + '（周' + U.weekdayCN(d) + '）'; break; }
        }
      }
      if (slot !== null) {
        const mv = {
          taskId: t.id, taskTitle: t.title,
          oldDate: t.date, oldStart: t.start, oldEnd: t.end || '',
          date: targetDay, start: U.minHM(slot), end: U.minHM(slot + dur),
          reason, failed: false
        };
        placed.push({ id: t.id, date: targetDay, s: slot, e: slot + dur });
        moves.push(mv);
      } else {
        moves.push({
          taskId: t.id, taskTitle: t.title,
          oldDate: t.date, oldStart: t.start, oldEnd: t.end || '',
          date: t.date, start: t.start, end: t.end || '',
          reason: '未来 7 天工作时段均已排满，需要手动处理', failed: true
        });
      }
    }

    return { fixedConf, flex, moves };
  },

  /* 执行：写入突发日程 + 应用移动方案 */
  apply(evt, moves) {
    const ev = Store.addTask(Object.assign({}, evt, { kind: 'event', sudden: true, fixed: true, level: 'day' }));
    moves.forEach(m => {
      if (m.failed) return;
      Store.updateTask(m.taskId, {
        date: m.date, start: m.start, end: m.end,
        adjusted: '因突发日程「' + evt.title + '」' + m.reason + '（原 ' + U.fmtCN(m.oldDate) + ' ' + m.oldStart + '）'
      });
    });
    return ev;
  }
};
