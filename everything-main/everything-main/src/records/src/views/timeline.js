/**
 * Timeline: one bar per record from its start date to its end date on a
 * time axis (days, weeks, months or quarters). Drag a bar to move it, drag
 * its ends to change the dates.
 */
import { h, announce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { accentColor, chipColors } from '../lib/colors.js';
import { toDate, shownDate, dateKey, addDays, addValueDays, monthName, daysBetween, isDateOnly, startOfDay } from '../lib/format.js';
import { runView, searchView } from '../data/query.js';
import { isReadOnly } from '../data/fields.js';
import { cardColorFn } from './cards.js';

const PX_PER_DAY = { day: 44, week: 18, month: 6, quarter: 2.4 };
const ROW_H = 36;
const MAX_ROWS = 800;
const AXIS_H = 52;

export class TimelineView {
  constructor(page, table, view) {
    this.page = page;
    this.base = page.base;
    this.table = table;
    this.view = view;
    this.el = h('div.timeline');
    this.el.addEventListener('pointerdown', (e) => this.onDown(e));
    this.el.addEventListener('keydown', (e) => {
      const bar = e.target.closest?.('.tl-bar');
      if (!bar) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.page.openRecord(bar.dataset.id);
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey) {
        e.preventDefault();
        this.shiftRecord(bar.dataset.id, e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey ? 'end' : 'both');
      }
    });
  }

  mounted() {
    this.render(true);
  }
  destroy() {}
  update() {
    this.render(false);
  }
  focus() {
    this.el.querySelector('.tl-bar')?.focus();
  }
  recordOrder() {
    return (this.rows || []).map((r) => r.rec.id);
  }

  field(id) {
    return this.table.field(id);
  }

  render(scrollToToday) {
    const start = this.field(this.view.dateFieldId);
    if (!start) {
      this.hits = [];
      this.el.replaceChildren(h('div.empty', h('div.empty-icon', icon('vTimeline', 22)), h('h2', 'Choose dates'), h('p', 'Pick a start date field (and an end date) from the toolbar.')));
      return;
    }
    const end = this.field(this.view.endFieldId);
    const scale = this.view.scale || 'week';
    const ppd = PX_PER_DAY[scale] || 18;
    const result = runView(this.base, this.table, this.view);
    const colorOf = cardColorFn(this.page, this.table, this.view);
    const rows = [];
    let undated = 0;
    for (const rec of result.records) {
      const s = shownDate(this.base.compute.value(this.table, rec, start), start.options?.gmt);
      if (!s) {
        undated++;
        continue;
      }
      let e = end ? shownDate(this.base.compute.value(this.table, rec, end), end.options?.gmt) : null;
      if (!e || e < s) e = s;
      rows.push({ rec, s: startOfDay(s), e: startOfDay(e) });
    }
    this.rows = rows;
    const today = startOfDay(new Date());
    let min = today;
    let max = addDays(today, 30);
    for (const r of rows) {
      if (r.s < min) min = r.s;
      if (r.e > max) max = r.e;
    }
    min = addDays(min, -14);
    max = addDays(max, 30);
    min = new Date(min.getFullYear(), min.getMonth(), 1);
    const before = { origin: this.origin, ppd: this.ppd };
    this.origin = min;
    this.ppd = ppd;
    const totalDays = daysBetween(min, max) + 1;
    const width = Math.ceil(totalDays * ppd);
    // Axis: months on top, and days or weeks below when there is room.
    const axisTop = h('div.tl-axis-top');
    const axisBottom = h('div.tl-axis-bottom');
    let d = new Date(min);
    while (d <= max) {
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const x = daysBetween(min, d) * ppd;
      const w = daysBetween(d, next) * ppd;
      // The name stays in view while any of its month is (see .tl-month span).
      axisTop.append(h('div.tl-month', { style: { left: `${x}px`, width: `${w}px` } }, h('span', scale === 'quarter' ? `${monthName(d.getMonth()).slice(0, 3)} ${d.getFullYear()}` : `${monthName(d.getMonth())} ${d.getFullYear()}`)));
      d = next;
    }

    const names = h('div.tl-names', { role: 'list', 'aria-label': 'Records' });
    const lanes = h('div.tl-lanes', { style: { width: `${width}px`, height: `${Math.min(rows.length, MAX_ROWS) * ROW_H}px` } });
    const todayX = daysBetween(min, today) * ppd;
    lanes.append(h('div.tl-today', { style: { left: `${todayX}px` }, 'aria-hidden': 'true' }));
    // Day ticks and weekend shading are drawn around the visible part only:
    // a record years away would otherwise add tens of thousands of them.
    const weekends = h('div.tl-weekends', { 'aria-hidden': 'true' });
    lanes.append(weekends);
    let drawn = null;
    const drawTicks = () => {
      if (scale !== 'day' && scale !== 'week') return;
      // Before the scroll position is applied, draw around where it will be.
      const left = this.pendingScroll ? this.pendingScroll.left : scroller.scrollLeft;
      const first = Math.max(0, Math.floor(left / ppd) - 62);
      const last = Math.min(totalDays - 1, Math.ceil((left + (scroller.clientWidth || 2000)) / ppd) + 62);
      if (drawn && first >= drawn[0] && last <= drawn[1]) return;
      // Draw a wider window than needed, so small scrolls redraw nothing.
      const from = Math.max(0, first - 62);
      const to = Math.min(totalDays - 1, last + 62);
      drawn = [from, to];
      const ticks = [];
      const shades = [];
      for (let i = from; i <= to; i++) {
        const day = addDays(min, i);
        if (day.getDay() === 6) shades.push(h('div.tl-weekend', { style: { left: `${i * ppd}px`, width: `${2 * ppd}px` } }));
        if (scale === 'week' && day.getDay() !== 1) continue;
        ticks.push(h(`div.tl-tick${day.getDay() === 0 || day.getDay() === 6 ? '.weekend' : ''}`, { style: { left: `${i * ppd}px`, width: `${(scale === 'week' ? 7 : 1) * ppd}px` } }, String(day.getDate())));
      }
      axisBottom.replaceChildren(...ticks);
      weekends.replaceChildren(...shades);
    };
    const editable = !isReadOnly(start);
    const drawnRows = rows.slice(0, MAX_ROWS);
    // Matching bars in row order (only drawn rows can be shown).
    const hits = this.query ? new Set(searchView(this.base, this.table, this.view, drawnRows.map((r) => r.rec), this.query).map((x) => x.recordId)) : null;
    this.hits = hits ? drawnRows.filter((r) => hits.has(r.rec.id)).map((r) => r.rec.id) : [];
    drawnRows.forEach((r, i) => {
      const name = this.base.recordName(this.table.id, r.rec.id);
      lanes.append(h('div.tl-rowline', { style: { top: `${(i + 1) * ROW_H - 1}px` }, 'aria-hidden': 'true' }));
      const hit = hits?.has(r.rec.id) ? '.search-hit' : '';
      names.append(h('div', { role: 'listitem' }, h(`button.tl-name${hit}`, { type: 'button', style: { height: `${ROW_H}px` }, onclick: () => this.page.openRecord(r.rec.id) }, name)));
      const x = daysBetween(min, r.s) * ppd;
      const w = Math.max(ppd, (daysBetween(r.s, r.e) + 1) * ppd);
      const color = colorOf(r.rec) || 'blue';
      const label = `${name}, ${dateKey(r.s)}${r.e > r.s ? ` to ${dateKey(r.e)}` : ''}`;
      // Short bars get their resize handles outside, so most of the bar still moves it.
      lanes.append(h(`div.tl-bar${hit}${w < 24 ? '.short' : ''}`, { tabindex: '0', role: 'button', 'aria-label': label, title: label, dataset: { id: r.rec.id }, style: { left: `${x}px`, top: `${i * ROW_H + 6}px`, width: `${w}px`, '--bar': accentColor(color), '--bar-fg': chipColors(`${color.replace(/Strong$/, '')}Strong`)[1] } },
        editable ? h('span.tl-handle.left', { dataset: { edge: 'start' } }) : null,
        h('span.tl-bar-label', name),
        editable && end && !isReadOnly(end) ? h('span.tl-handle.right', { dataset: { edge: 'end' } }) : null));
    });
    const note = [];
    if (undated) note.push(`${undated} record${undated === 1 ? '' : 's'} without a start date`);
    if (rows.length > MAX_ROWS) note.push(`showing the first ${MAX_ROWS} records`);
    const scroller = h('div.tl-scroll', h('div.tl-axis', { style: { width: `${width}px` } }, axisTop, axisBottom), lanes);
    // Where the last render scrolled to (it may not be applied yet: renders
    // can follow each other before the next frame).
    const prevScroll = this.pendingScroll || (this.scroller ? { left: this.scroller.scrollLeft, top: this.scroller.scrollTop } : null);
    this.scroller = scroller;
    this.lanes = lanes;
    scroller.addEventListener('scroll', () => {
      names.style.transform = `translateY(${-scroller.scrollTop}px)`;
      drawTicks();
    }, { passive: true });
    // The names follow the bars: they can't scroll on their own, so a
    // focused name scrolls the bars to it, and the wheel over them scrolls the bars.
    const clip = h('div.tl-names-clip', names);
    names.addEventListener('focusin', (e) => {
      const i = [...names.children].indexOf(e.target.closest('[role="listitem"]'));
      if (i < 0) return;
      const ht = Math.max(ROW_H, (scroller.clientHeight || 600) - AXIS_H);
      if (i * ROW_H < scroller.scrollTop) scroller.scrollTop = i * ROW_H;
      else if ((i + 1) * ROW_H > scroller.scrollTop + ht) scroller.scrollTop = (i + 1) * ROW_H - ht;
    });
    clip.addEventListener('wheel', (e) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroller.clientHeight : 1;
      scroller.scrollTop += e.deltaY * unit;
      scroller.scrollLeft += e.deltaX * unit;
    }, { passive: true });
    this.el.replaceChildren(
      h('div.tl-toolbar', h('button.btn.small', { type: 'button', onclick: () => {
        scroller.scrollLeft = Math.max(0, todayX - scroller.clientWidth / 3);
      } }, 'Today'), note.length ? h('span.muted', note.join(', ')) : null, h('div.grow'), h('span.muted.tl-tip', 'Alt+Arrow keys move a focused bar')),
      h('div.tl-body', h('div.tl-side', h('div.tl-side-head', this.table.primary.name), clip), scroller),
    );
    let target;
    if (prevScroll && !scrollToToday) {
      // Keep the same date at the left edge when the scale or range changed.
      const left = before.origin ? (daysBetween(min, before.origin) + prevScroll.left / before.ppd) * ppd : prevScroll.left;
      target = { left, top: prevScroll.top };
    } else target = { left: Math.max(0, todayX - scroller.clientWidth / 3), top: 0 };
    this.pendingScroll = target;
    drawTicks();
    requestAnimationFrame(() => {
      if (this.scroller !== scroller) return;
      // Find may have moved the target to a match since.
      const to = this.pendingScroll || target;
      this.pendingScroll = null;
      scroller.scrollLeft = to.left;
      scroller.scrollTop = to.top;
      drawTicks();
    });
  }

  setSearch(query, { keep = false } = {}) {
    query ||= '';
    // The match that was current, by record: an edit has already redrawn the view.
    const prev = keep ? this.hitId : null;
    // After an edit the view has already drawn this search.
    const drawn = keep && query === this.query;
    this.query = query;
    if (!drawn) this.render(false);
    const hits = this.hits || [];
    const i = prev ? hits.indexOf(prev) : -1;
    this.hitIndex = i >= 0 ? i : Math.min(keep ? this.hitIndex || 0 : 0, Math.max(0, hits.length - 1));
    if (!keep) this.showHit(false);
    this.hitId = this.hits[this.hitIndex];
    return { total: hits.length, index: this.hitIndex };
  }

  stepSearch(d) {
    const n = this.hits?.length || 0;
    if (!n) return { total: 0, index: 0 };
    this.hitIndex = (this.hitIndex + d + n) % n;
    this.showHit(true);
    this.hitId = this.hits[this.hitIndex];
    return { total: n, index: this.hitIndex };
  }

  /** Scroll the current match's bar into view when it is off screen. */
  showHit(focus) {
    const id = this.hits?.[this.hitIndex];
    const bar = id && this.lanes?.querySelector(`.tl-bar[data-id="${CSS.escape(id)}"]`);
    if (!bar) return;
    const sc = this.scroller;
    const at = this.pendingScroll || { left: sc.scrollLeft, top: sc.scrollTop };
    const w = sc.clientWidth || 800;
    const ht = Math.max(ROW_H, (sc.clientHeight || 600) - AXIS_H);
    const x = parseFloat(bar.style.left);
    const y = parseFloat(bar.style.top) - 6;
    const to = { ...at };
    if (x < at.left || x > at.left + w - 40) to.left = Math.max(0, x - w / 3);
    if (y < at.top || y + ROW_H > at.top + ht) to.top = Math.max(0, y - ht / 3);
    // A render's scroll is applied on the next frame: change where it goes.
    if (this.pendingScroll) this.pendingScroll = to;
    else {
      sc.scrollLeft = to.left;
      sc.scrollTop = to.top;
    }
    if (focus) bar.focus({ preventScroll: true });
  }

  shiftRecord(id, days, mode) {
    const rec = this.table.record(id);
    if (!rec) return;
    const cells = {};
    const startF = this.field(this.view.dateFieldId);
    const endF = this.field(this.view.endFieldId);
    const sv = startF ? rec.c[startF.id] : null;
    const ev = endF ? rec.c[endF.id] : null;
    const write = (f, v, dt) => {
      if (!f || isReadOnly(f)) return;
      cells[f.id] = v && isDateOnly(v) ? dateKey(dt) : f.options?.includeTime ? dt.toISOString() : dateKey(dt);
    };
    const later = (v, f) => addValueDays(v, days, f?.options?.gmt);
    if (mode === 'both') {
      if (sv) write(startF, sv, later(sv, startF));
      if (ev) write(endF, ev, later(ev, endF));
    } else if (mode === 'start' && sv) {
      // The start stays on or before the end.
      let dt = later(sv, startF);
      if (ev && dt > toDate(ev)) dt = toDate(ev);
      write(startF, sv, dt);
    } else if (mode === 'end' && (ev || sv)) {
      // A bar without an end date ends on its start; the end stays on or after the start.
      let dt = ev ? later(ev, endF) : later(sv, startF);
      if (sv && dt < toDate(sv)) dt = toDate(sv);
      write(endF, ev || sv, dt);
    }
    for (const [fid, v] of Object.entries(cells)) if (v === rec.c[fid]) delete cells[fid];
    // Nothing to save: redraw the bar where it was, keeping keyboard focus on it.
    if (!Object.keys(cells).length) {
      const focused = document.activeElement?.closest?.('.tl-bar')?.dataset.id === id;
      this.render(false);
      if (focused) this.el.querySelector(`.tl-bar[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    } else {
      this.base.setCells(this.table.id, [{ id, cells }], 'Change dates');
      announce(`Moved ${days > 0 ? 'later' : 'earlier'} by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`);
      requestAnimationFrame(() => this.el.querySelector(`.tl-bar[data-id="${CSS.escape(id)}"]`)?.focus());
    }
  }

  onDown(e) {
    const bar = e.target.closest('.tl-bar');
    if (!bar || e.button !== 0) return;
    const edge = e.target.dataset.edge || null;
    const id = bar.dataset.id;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const left0 = parseFloat(bar.style.left);
    const w0 = parseFloat(bar.style.width);
    let moved = false;
    // Touch drags start after a press and hold, so a swipe still scrolls.
    const touch = e.pointerType !== 'mouse';
    let armed = !touch;
    let timer = 0;
    const blockScroll = (ev) => armed && ev.preventDefault();
    if (touch) {
      timer = setTimeout(() => {
        armed = true;
        bar.classList.add('dragging');
        navigator.vibrate?.(10);
      }, 380);
      bar.addEventListener('touchmove', blockScroll, { passive: false });
    }
    const end = () => {
      clearTimeout(timer);
      bar.classList.remove('dragging');
      bar.removeEventListener('touchmove', blockScroll);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    const cancel = () => {
      end();
      if (moved) this.render(false);
    };
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (!armed) {
        // Moving before the hold is a scroll, not a drag.
        if (Math.hypot(dx, ev.clientY - y0) > 6) end();
        return;
      }
      if (!moved && Math.abs(dx) < 4) return;
      if (isReadOnly(this.field(this.view.dateFieldId))) return;
      moved = true;
      if (edge === 'end') bar.style.width = `${Math.max(this.ppd, w0 + dx)}px`;
      else if (edge === 'start') {
        bar.style.left = `${left0 + dx}px`;
        bar.style.width = `${Math.max(this.ppd, w0 - dx)}px`;
      } else bar.style.left = `${left0 + dx}px`;
    };
    const up = (ev) => {
      end();
      if (!moved) {
        this.page.openRecord(id);
        return;
      }
      const days = Math.round((ev.clientX - x0) / this.ppd);
      if (!days) {
        this.render(false);
        return;
      }
      this.shiftRecord(id, days, edge === 'end' ? 'end' : edge === 'start' ? 'start' : 'both');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    if (!touch) e.preventDefault();
  }
}
