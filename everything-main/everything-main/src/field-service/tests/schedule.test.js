// @vitest-environment jsdom
/**
 * Schedule, job and timesheet screens against the demo data: drag and drop,
 * keyboard focus and other behaviour the smoke test does not reach.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  window.cancelAnimationFrame ??= (id) => clearTimeout(id);
  globalThis.cancelAnimationFrame ??= window.cancelAnimationFrame;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView ??= function () {};
  Element.prototype.setPointerCapture ??= function () {};
});

const settle = () => new Promise((r) => setTimeout(r, 20));
let ctx;

async function bootDemo() {
  const { app } = await import('../src/app.js');
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { buildSampleData } = await import('../src/core/sample.js');
  const { buildShell } = await import('../src/ui/shell.js');
  const { startViews } = await import('../src/ui/viewhost.js');
  app.demo = true;
  app.today = () => '2026-10-12';
  app.store = createStore({ backend: createMemoryBackend(buildSampleData('2026-10-12')) });
  await app.store.init();
  document.body.innerHTML = '<div id="app"></div>';
  const shell = buildShell({});
  document.getElementById('app').append(shell.root);
  startViews(shell.main);
  return { app, main: shell.main };
}

// Views load on demand: wait for the new one rather than a fixed time.
async function go(hash) {
  const before = ctx.main.firstElementChild;
  location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  for (let i = 0; i < 250; i++) {
    await settle();
    const now = ctx.main.firstElementChild;
    if (now && now !== before && ctx.main.querySelector('h1')) break;
  }
  await settle();
}

/** jsdom has no PointerEvent: a mouse event carrying the pointer fields. */
function pointer(el, type, x, y, pointerType = 'mouse') {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
  el.dispatchEvent(e);
  return e;
}

const visitChip = () => ctx.main.querySelector('.chip-item.block[data-kind="visit"]:not(.done)');
const visitOf = (key) => {
  const [, jobId, visitId] = key.split(':');
  return ctx.app.store.get('jobs', jobId).visits.find((v) => v.id === visitId);
};

describe('schedule', () => {
  beforeAll(async () => {
    ctx = await bootDemo();
  });
  beforeEach(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  it('saves nothing when a block is let go where it started', async () => {
    await go('#/schedule?view=week');
    const chip = visitChip();
    const before = visitOf(chip.dataset.key);
    pointer(chip, 'pointerdown', 100, 100);
    pointer(chip, 'pointermove', 100, 105);
    pointer(chip, 'pointerup', 100, 105);
    await settle();
    expect(visitOf(chip.dataset.key)).toBe(before);
    expect(document.querySelector('.toast')?.textContent || '').not.toMatch(/Moved/);
  });

  it('keeps a dragged block under the pointer while the grid scrolls', async () => {
    await go('#/schedule?view=week');
    const chip = visitChip();
    const key = chip.dataset.key;
    const before = visitOf(key);
    // jsdom has no layout: give the grid a scroll position to change.
    const scroller = ctx.main.querySelector('.tg-scroll');
    Object.defineProperty(scroller, 'scrollTop', { value: 0, writable: true });
    pointer(chip, 'pointerdown', 100, 100);
    pointer(chip, 'pointermove', 100, 110);
    // Two hours further down (by the wheel) with the pointer held still.
    scroller.scrollTop = 104;
    scroller.dispatchEvent(new Event('scroll'));
    pointer(chip, 'pointerup', 100, 110);
    await settle();
    const { timeToMinutes } = await import('../src/core/dates.js');
    // 114px at 52px an hour, in 15 minute steps: 2 hours 15 minutes later.
    expect(timeToMinutes(visitOf(key).start) - timeToMinutes(before.start)).toBe(135);
  });

  it('scrolls the grid while a block is held near its bottom edge', async () => {
    await go('#/schedule?view=week');
    const chip = visitChip();
    const scroller = ctx.main.querySelector('.tg-scroll');
    Object.defineProperty(scroller, 'scrollTop', { value: 0, writable: true });
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 400, height: 400, left: 0, right: 800 });
    pointer(chip, 'pointerdown', 100, 300);
    pointer(chip, 'pointermove', 100, 395);
    await settle();
    await settle();
    const scrolled = scroller.scrollTop;
    pointer(chip, 'pointerup', 100, 395);
    await settle();
    expect(scrolled).toBeGreaterThan(0);
    // And stops once the block is let go.
    const after = scroller.scrollTop;
    await settle();
    expect(scroller.scrollTop).toBe(after);
  });

  it('scrolls on a touch swipe across a block, and drags after a press and hold', async () => {
    await go('#/schedule?view=week');
    const chip = visitChip();
    const key = chip.dataset.key;
    const before = visitOf(key);
    const touchmove = () => {
      const t = new Event('touchmove', { bubbles: true, cancelable: true });
      chip.dispatchEvent(t);
      return t.defaultPrevented;
    };
    pointer(chip, 'pointerdown', 100, 100, 'touch');
    pointer(chip, 'pointermove', 100, 140, 'touch');
    expect(touchmove()).toBe(false);
    pointer(chip, 'pointercancel', 100, 140, 'touch');
    await settle();
    expect(visitOf(key)).toBe(before);
    expect(chip.classList.contains('dragging')).toBe(false);

    pointer(chip, 'pointerdown', 100, 100, 'touch');
    await new Promise((r) => setTimeout(r, 400));
    expect(chip.classList.contains('dragging')).toBe(true);
    expect(touchmove()).toBe(true);
    pointer(chip, 'pointermove', 100, 152, 'touch');
    pointer(chip, 'pointerup', 100, 152, 'touch');
    await settle();
    const { timeToMinutes } = await import('../src/core/dates.js');
    expect(timeToMinutes(visitOf(key).start) - timeToMinutes(before.start)).toBe(60);
  });

  it('follows an item moved by keyboard to another day, keeping it focused', async () => {
    await go('#/schedule?view=day');
    const chip = visitChip();
    const key = chip.dataset.key;
    chip.focus();
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
    await settle();
    expect(visitOf(key).date).toBe('2026-10-13');
    expect(ctx.main.querySelector('h1').textContent).toMatch(/October 13/);
    expect(document.activeElement.dataset.key).toBe(key);
  });

  it('moves the now line along while the page stays open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      vi.setSystemTime(new Date(2026, 9, 12, 10, 0));
      await go('#/schedule?view=week');
      const line = ctx.main.querySelector('.tg-now');
      const top = parseFloat(line.style.top);
      vi.advanceTimersByTime(60 * 60000);
      expect(parseFloat(line.style.top) - top).toBe(52);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists work left with no active person under Unassigned when filtering by it', async () => {
    const job = ctx.app.store.all('jobs').find((j) => j.visits?.some((v) => v.date === '2026-10-12' && v.assignees?.length === 1));
    const visit = job.visits.find((v) => v.date === '2026-10-12' && v.assignees?.length === 1);
    const memberId = visit.assignees[0];
    ctx.app.store.patch('team', memberId, { active: false });
    localStorage.setItem('fieldservice.scheduleTeam', JSON.stringify(['unassigned']));
    try {
      await go('#/schedule?view=day&date=2026-10-12');
      const key = `v:${job.id}:${visit.id}`;
      expect([...ctx.main.querySelectorAll('.chip-item')].some((c) => c.dataset.key === key)).toBe(true);
    } finally {
      localStorage.removeItem('fieldservice.scheduleTeam');
      ctx.app.store.patch('team', memberId, { active: true });
    }
  });

  it('keeps focus on the checkbox of the same row in the list view', async () => {
    await go('#/schedule?view=list');
    const rows = [...ctx.main.querySelectorAll('.agenda-list li')];
    const row = rows.find((li) => !li.querySelector('.agenda-check').checked && rows.indexOf(li) > 2);
    const box = row.querySelector('.agenda-check');
    box.focus();
    box.click();
    await settle();
    expect(document.activeElement.classList.contains('agenda-check')).toBe(true);
    // The same row, not another with the same title.
    expect([...ctx.main.querySelectorAll('.agenda-list li')].indexOf(document.activeElement.closest('li'))).toBe(rows.indexOf(row));
  });

  it('moves an item dropped on another day of the month, and puts it back on Undo', async () => {
    await go('#/schedule?view=month&date=2026-10-12');
    const chip = ctx.main.querySelector('.month-cell[data-date="2026-10-13"] .chip-item[data-kind="visit"]');
    const key = chip.dataset.key;
    const before = visitOf(key);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    drop.dataTransfer = { types: ['text/x-agenda'], getData: (t) => (t === 'text/x-agenda' ? key : '') };
    ctx.main.querySelector('.month-cell[data-date="2026-10-20"]').dispatchEvent(drop);
    await settle();
    expect(visitOf(key)).toMatchObject({ date: '2026-10-20', start: before.start, end: before.end });
    [...document.querySelectorAll('.toast button')].find((b) => b.textContent === 'Undo').click();
    await settle();
    expect(visitOf(key)).toMatchObject({ date: '2026-10-13', start: before.start, end: before.end });
  });

  it('gives phones a short schedule title', async () => {
    await go('#/schedule?view=day&date=2026-10-12');
    expect(ctx.main.querySelector('h1 .show-mobile').textContent).toBe('Mon, Oct 12');
    expect(ctx.main.querySelector('h1 .hide-mobile').textContent).toBe('Monday, October 12, 2026');
    await go('#/schedule?view=week&date=2026-09-28');
    expect(ctx.main.querySelector('h1 .show-mobile').textContent).toBe('Sep 27 to Oct 3');
  });

  it('keeps an item dropped near midnight its full length', async () => {
    const job = ctx.app.store.all('jobs').find((j) => j.visits?.some((v) => v.date === '2026-10-14'));
    const v = job.visits.find((x) => x.date === '2026-10-14');
    ctx.app.store.patch('jobs', job.id, (j) => ((j.visits = j.visits.map((x) => (x.id === v.id ? { ...x, start: '22:00', end: '23:59' } : x))), j));
    const task = ctx.app.store.all('events').find((x) => !x.start);
    await go('#/schedule?view=week&date=2026-10-14');
    const col = ctx.main.querySelector('.tg-col[data-date="2026-10-14"]');
    const startH = Number(col.closest('.tg-body').dataset.startH);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    drop.dataTransfer = { types: ['text/x-agenda'], getData: (t) => (t === 'text/x-agenda' ? `e:${task.id}` : '') };
    Object.defineProperty(drop, 'clientY', { value: (23.5 - startH) * 52 });
    col.dispatchEvent(drop);
    await settle();
    expect(ctx.app.store.get('events', task.id)).toMatchObject({ date: '2026-10-14', start: '23:00', end: '23:59' });
  });

  it('shows everyone when the saved team filter names only people since removed', async () => {
    localStorage.setItem('fieldservice.scheduleTeam', JSON.stringify(['gone']));
    try {
      await go('#/schedule?view=week&date=2026-10-12');
      expect(ctx.main.querySelector('[aria-label^="Team filter"]').getAttribute('aria-label')).toBe('Team filter: Everyone');
      expect(ctx.main.querySelectorAll('.chip-item').length).toBeGreaterThan(0);
    } finally {
      localStorage.removeItem('fieldservice.scheduleTeam');
    }
  });

  it('marks up the month as a table of days', async () => {
    await go('#/schedule?view=month&date=2026-10-12');
    expect(ctx.main.querySelector('[role="grid"], [role="gridcell"]')).toBeNull();
    expect(ctx.main.querySelectorAll('.month-grid[role="table"] [role="row"] [role="cell"]').length).toBeGreaterThanOrEqual(28);
  });

  it('starts scheduling an unscheduled job on the day in view', async () => {
    await go('#/schedule?view=day&date=2026-10-20');
    [...ctx.main.querySelectorAll('button')].find((b) => /^Unscheduled jobs/.test(b.getAttribute('aria-label') || '')).click();
    await settle();
    [...ctx.main.querySelectorAll('.sched-side button')].find((b) => b.textContent === 'Schedule').click();
    expect(document.querySelector('dialog input[type="date"]').value).toBe('2026-10-20');
    document.querySelector('dialog .icon-btn[aria-label="Close"]').click();
  });

  it('asks for a date instead of moving a task to today when its date is cleared', async () => {
    const { eventDialog } = await import('../src/views/schedule.js');
    const ev = ctx.app.store.all('events').find((x) => x.date !== '2026-10-12');
    eventDialog({ eventId: ev.id });
    document.querySelector('dialog input[type="date"]').value = '';
    [...document.querySelectorAll('dialog button')].find((b) => b.textContent === 'Save').click();
    await settle();
    expect(ctx.app.store.get('events', ev.id).date).toBe(ev.date);
    expect(document.querySelector('dialog[open]')).not.toBeNull();
    document.querySelector('dialog .icon-btn[aria-label="Close"]').click();
  });

  it('extends the day to fit a late item that has a start but no end', async () => {
    const job = ctx.app.store.all('jobs').find((j) => j.visits?.some((v) => v.date === '2026-10-13'));
    const v = job.visits.find((x) => x.date === '2026-10-13');
    ctx.app.store.patch('jobs', job.id, (j) => ((j.visits = j.visits.map((x) => (x.id === v.id ? { ...x, start: '21:00', end: '' } : x))), j));
    await go('#/schedule?view=week&date=2026-10-13');
    const col = ctx.main.querySelector('.tg-col[data-date="2026-10-13"]');
    const chip = col.querySelector(`[data-key="v:${job.id}:${v.id}"]`);
    expect(parseFloat(chip.style.top) + parseFloat(chip.style.height)).toBeLessThanOrEqual(parseFloat(col.style.height));
  });

  it('names the day of each week view item for screen readers', async () => {
    await go('#/schedule?view=week&date=2026-10-13');
    const chip = ctx.main.querySelector('.tg-col[data-date="2026-10-13"] .chip-item');
    expect(chip.getAttribute('aria-label')).toMatch(/Tuesday, October 13/);
  });

  it('keeps keyboard focus on an item when the schedule redraws', async () => {
    await go('#/schedule?view=week');
    const chip = visitChip();
    const key = chip.dataset.key;
    chip.focus();
    // A change from elsewhere (say, a sync) redraws every item.
    const ev = ctx.app.store.all('events')[0];
    ctx.app.store.patch('events', ev.id, { notes: 'synced' });
    await settle();
    expect(document.activeElement.dataset.key).toBe(key);
    expect(document.activeElement).not.toBe(chip);
  });

  it('returns focus to an item marked complete from its popover', async () => {
    await go('#/schedule?view=week');
    const chip = visitChip();
    const key = chip.dataset.key;
    chip.focus();
    chip.click();
    await settle();
    const complete = [...document.querySelectorAll('.popover button')].find((b) => /Complete/.test(b.textContent));
    complete.focus();
    complete.click();
    await settle();
    expect(visitOf(key).completedAt).toBeTruthy();
    expect(document.activeElement.dataset.key).toBe(key);
  });
});

describe('job page', () => {
  it('keeps keyboard focus on a visit checkbox and after Show all', async () => {
    const job = ctx.app.store.all('jobs').find((j) => j.visits?.filter((v) => !v.completedAt && v.date).length > 6);
    await go(`#/jobs/${job.id}`);
    const box = ctx.main.querySelector('.visit-row input.agenda-check:not([disabled])');
    const name = box.dataset.focus;
    box.focus();
    box.click();
    await settle();
    expect(document.activeElement.dataset.focus).toBe(name);
    const more = [...ctx.main.querySelectorAll('.show-more button')].find((b) => /open visits/.test(b.textContent));
    more.focus();
    more.click();
    await settle();
    expect(document.activeElement.closest('.visit-row')).not.toBeNull();
  });
});

describe('job form', () => {
  it('shows where a one-off visit was moved to, and keeps it there when the time is changed', async () => {
    const job = ctx.app.store.all('jobs').find((j) => j.schedule?.repeat === 'none' && j.visits.length === 1 && j.visits[0].date && !j.visits[0].completedAt);
    const visit = job.visits[0];
    const { addDays } = await import('../src/core/dates.js');
    const moved = addDays(visit.date, 2);
    ctx.app.store.patch('jobs', job.id, (j) => ((j.visits = [{ ...visit, date: moved, start: '13:00', end: '14:00', notes: 'Side gate' }]), j));
    await go(`#/jobs/${job.id}/edit`);
    const [date, start, end] = ctx.main.querySelectorAll('.schedule-builder input[type="date"], .schedule-builder input[type="time"]');
    expect([date.value, start.value, end.value]).toEqual([moved, '13:00', '14:00']);
    start.value = '15:00';
    start.dispatchEvent(new Event('input', { bubbles: true }));
    ctx.main.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(ctx.app.store.get('jobs', job.id).visits).toMatchObject([{ id: visit.id, date: moved, start: '15:00', end: '16:00', notes: 'Side gate' }]);
  });
});

describe('visit dialog', () => {
  it('leaves an unscheduled job waiting for a date when one of its finished visits is edited', async () => {
    const { visitDialog } = await import('../src/views/visit-dialog.js');
    const { jobStatus } = await import('../src/core/status.js');
    const job = ctx.app.store.all('jobs').find((j) => j.visits.some((v) => v.completedAt));
    const done = job.visits.find((v) => v.completedAt);
    ctx.app.store.patch('jobs', job.id, (j) => ((j.visits = [done, { id: 'later', date: null, start: '', end: '', assignees: [], completedAt: null }]), (j.closedAt = undefined), j));
    visitDialog(job.id, done.id);
    document.querySelector('dialog textarea').value = 'Left the side gate closed';
    [...document.querySelectorAll('dialog button')].find((b) => b.textContent === 'Save visit').click();
    await settle();
    const after = ctx.app.store.get('jobs', job.id);
    expect(after.visits.map((v) => v.id)).toContain('later');
    expect(jobStatus(after, '2026-10-12', [])).toBe('unscheduled');
  });
});

describe('visit dialog saving', () => {
  it('keeps an invoice made for the visit on another device while the dialog was open', async () => {
    const { visitDialog } = await import('../src/views/visit-dialog.js');
    const job = ctx.app.store.all('jobs').find((j) => j.visits.some((v) => v.date && !v.completedAt && !v.invoiceId));
    const visit = job.visits.find((v) => v.date && !v.completedAt && !v.invoiceId);
    visitDialog(job.id, visit.id);
    ctx.app.store.patch('jobs', job.id, (j) => ((j.visits = j.visits.map((v) => (v.id === visit.id ? { ...v, invoiceId: 'inv1' } : v))), j));
    document.querySelector('dialog textarea').value = 'Bring the long ladder';
    [...document.querySelectorAll('dialog button')].find((b) => b.textContent === 'Save visit').click();
    await settle();
    expect(ctx.app.store.get('jobs', job.id).visits.find((v) => v.id === visit.id)).toMatchObject({ invoiceId: 'inv1', notes: 'Bring the long ladder' });
  });
});

describe('timesheets', () => {
  it('keeps keyboard focus on the clock button after clocking out and in', async () => {
    await go('#/timesheets');
    const out = [...ctx.main.querySelectorAll('button')].find((b) => /Clock out/.test(b.textContent));
    const name = out.dataset.focus;
    out.focus();
    out.click();
    await settle();
    expect(document.activeElement.dataset.focus).toBe(name);
    expect(document.activeElement.textContent).toMatch(/Clock in/);
    document.activeElement.click();
    await settle();
    document.querySelector('[role="menu"] button').click();
    await settle();
    expect(document.activeElement.dataset.focus).toBe(name);
    expect(document.activeElement.textContent).toMatch(/Clock out/);
  });

  it('takes the week out of the address when going back to This week', async () => {
    await go('#/timesheets');
    ctx.main.querySelector('[aria-label="Next week"]').click();
    expect(location.hash).toMatch(/week=/);
    [...ctx.main.querySelectorAll('button')].find((b) => /This week/.test(b.textContent)).click();
    expect(location.hash).not.toMatch(/week=/);
  });
});
