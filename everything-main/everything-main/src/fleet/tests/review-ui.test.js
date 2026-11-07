// @vitest-environment jsdom
/**
 * Regression tests for the shared UI layer: router, dialogs, menus,
 * toasts, the search palette, forms, charts, and the list grid.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

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
});

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const key = (target, k, init = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

describe('router', () => {
  it('treats a malformed percent escape as an unknown page instead of throwing', async () => {
    const { route, parse } = await import('../src/ui/router.js');
    route('/things/:id', 'thing');
    expect(parse('#/things/abc').params.id).toBe('abc');
    expect(() => parse('#/things/%E0%A4%A')).not.toThrow();
    expect(parse('#/things/%E0%A4%A').name).toBe('not-found');
  });
});

describe('forms', () => {
  const type = (input, text) => {
    for (const ch of text) {
      input.value += ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  it('lets a label be typed in full before it becomes a tag', async () => {
    const { buildForm } = await import('../src/ui/form.js');
    const form = buildForm({ sections: [{ fields: [{ id: 'name', label: 'Name' }, { id: 'labels', label: 'Labels', type: 'tags' }] }], onChange: () => {} });
    document.body.replaceChildren(form.node);
    const entry = form.node.querySelector('.tag-entry');
    type(entry, 'urgent');
    expect(entry.value).toBe('urgent');
    expect(form.node.querySelectorAll('.tag')).toHaveLength(0);
    // Saving with the label still in the box keeps it.
    expect(form.values().labels).toEqual(['urgent']);
    expect(form.dirty()).toBe(true);
  });

  it('asks before Escape or a click outside throws away a filled-in form dialog', async () => {
    const { openFormDialog } = await import('../src/ui/form.js');
    document.body.replaceChildren();
    const done = openFormDialog({ title: 'Add expense', fields: [{ id: 'note', label: 'Note' }], onSave: () => true });
    const dlg = document.querySelector('dialog[open]');
    const input = dlg.querySelector('input');
    input.value = 'Tolls for the week';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    dlg.dispatchEvent(new Event('cancel', { cancelable: true }));
    await tick();
    const open = () => [...document.querySelectorAll('dialog[open]')];
    expect(open()).toHaveLength(2);
    [...open()[1].querySelectorAll('button')].find((b) => /Keep editing/.test(b.textContent)).click();
    await tick();
    expect(open()).toEqual([dlg]);
    expect(input.value).toBe('Tolls for the week');
    dlg.dispatchEvent(new Event('cancel', { cancelable: true }));
    await tick();
    [...open()[1].querySelectorAll('button')].find((b) => /Discard/.test(b.textContent)).click();
    expect(await done).toBe(null);
    expect(open()).toHaveLength(0);
    // An untouched form closes straight away.
    const again = openFormDialog({ title: 'Add expense', fields: [{ id: 'note', label: 'Note' }], onSave: () => true });
    document.querySelector('dialog[open]').dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(await again).toBe(null);
    expect(open()).toHaveLength(0);
  });

  it('scrolls to an error without animation when reduced motion is preferred', async () => {
    const { buildForm } = await import('../src/ui/form.js');
    const mm = window.matchMedia;
    window.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView');
    try {
      const form = buildForm({ sections: [{ fields: [{ id: 'name', label: 'Name', required: true }] }] });
      document.body.replaceChildren(form.node);
      expect(form.validate()).toBe(false);
      expect(spy).toHaveBeenCalled();
      for (const [opts] of spy.mock.calls) expect(opts?.behavior).not.toBe('smooth');
    } finally {
      spy.mockRestore();
      window.matchMedia = mm;
    }
  });

  it('keeps focus in the field after removing a label or a chosen item', async () => {
    const { buildForm } = await import('../src/ui/form.js');
    const form = buildForm({
      sections: [{ fields: [
        { id: 'labels', label: 'Labels', type: 'tags' },
        { id: 'vehicles', label: 'Vehicles', type: 'multipicker', options: () => [{ value: 'a', label: 'Van 1' }, { value: 'b', label: 'Van 2' }] },
      ] }],
      record: { labels: ['urgent', 'tires'], vehicles: ['a', 'b'] },
    });
    document.body.replaceChildren(form.node);
    const removeLabel = form.node.querySelector('.tag-input .tag button');
    removeLabel.focus();
    removeLabel.click();
    expect(form.values().labels).toEqual(['tires']);
    expect(form.node.querySelector('.tag-input').contains(document.activeElement)).toBe(true);
    const removeVehicle = form.node.querySelector('.multi-picker .tag button');
    removeVehicle.focus();
    removeVehicle.click();
    expect(form.values().vehicles).toEqual(['b']);
    expect(form.node.querySelector('.multi-picker').contains(document.activeElement)).toBe(true);
  });

  it('ties the label, hint and error of a multi-select to its button', async () => {
    const { buildForm } = await import('../src/ui/form.js');
    const form = buildForm({
      sections: [{ fields: [{ id: 'vehicles', label: 'Vehicles', type: 'multipicker', required: true, hint: 'Pick at least one.', options: () => [{ value: 'a', label: 'Van 1' }] }] }],
      record: { vehicles: [] },
    });
    document.body.replaceChildren(form.node);
    const btn = form.node.querySelector('.picker-btn');
    expect(form.node.querySelector('label').htmlFor).toBe(btn.id);
    expect(form.validate()).toBe(false);
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute('aria-invalid')).toBe('true');
    const described = btn.getAttribute('aria-describedby').split(' ').map((id) => document.getElementById(id).textContent);
    expect(described).toEqual(['Vehicles is required.', 'Pick at least one.']);
    // With items already chosen, the label still points at the add button.
    const filled = buildForm({ sections: [{ fields: [{ id: 'vehicles', label: 'Vehicles', type: 'multipicker', options: () => [{ value: 'a', label: 'Van 1' }, { value: 'b', label: 'Van 2' }] }] }], record: { vehicles: ['a'] } });
    expect(filled.node.querySelector('label').htmlFor).toBe(filled.node.querySelector('.picker-btn').id);
  });

  it('points the Labels field label and hint at its text box', async () => {
    const { buildForm } = await import('../src/ui/form.js');
    const form = buildForm({ sections: [{ fields: [{ id: 'labels', label: 'Labels', type: 'tags', hint: 'Press Enter after each label.' }] }], record: { labels: ['urgent'] } });
    document.body.replaceChildren(form.node);
    const entry = form.node.querySelector('.tag-entry');
    expect(form.node.querySelector('label').htmlFor).toBe(entry.id);
    expect(document.getElementById(entry.getAttribute('aria-describedby'))?.textContent).toBe('Press Enter after each label.');
  });

  it('offers a keyboard with a minus sign for numbers that may be negative', async () => {
    const { buildForm } = await import('../src/ui/form.js');
    const form = buildForm({ sections: [{ fields: [
      { id: 'change', label: 'Change by', type: 'number', required: true },
      { id: 'meter', label: 'Meter', type: 'number', min: 0 },
      { id: 'volume', label: 'Volume', type: 'number', min: 0, step: 0.001 },
    ] }] });
    const mode = (id) => form.field(id).getAttribute('inputmode');
    // iOS numeric and decimal keypads have no minus key.
    expect(['numeric', 'decimal']).not.toContain(mode('change'));
    expect(mode('meter')).toBe('numeric');
    expect(mode('volume')).toBe('decimal');
    form.field('change').value = '-2';
    expect(form.values().change).toBe(-2);
  });

  it('flags a money amount that is not a number instead of saving it as empty', async () => {
    const { buildForm } = await import('../src/ui/form.js');
    const form = buildForm({ sections: [{ fields: [{ id: 'cost', label: 'Cost', type: 'money' }] }] });
    document.body.replaceChildren(form.node);
    const input = form.node.querySelector('input');
    input.value = 'twelve';
    expect(form.validate()).toBe(false);
    expect(form.node.querySelector('.error-text').textContent).toBe('Enter a number.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    input.value = '$1,234.5';
    expect(form.validate()).toBe(true);
    expect(form.values().cost).toBe(123450);
    input.value = '';
    expect(form.values().cost).toBe(null);
  });

  it('ignores Enter that confirms an IME composition in pickers and label fields', async () => {
    const { buildForm } = await import('../src/ui/form.js');
    const onChange = vi.fn();
    const form = buildForm({
      sections: [{ fields: [
        { id: 'labels', label: 'Labels', type: 'tags' },
        { id: 'who', label: 'Driver', type: 'picker', options: () => [{ value: 'a', label: '山田' }, { value: 'b', label: '佐藤' }] },
      ] }],
      onChange,
    });
    document.body.replaceChildren(form.node);
    const entry = form.node.querySelector('.tag-entry');
    entry.value = 'きゅう';
    key(entry, 'Enter', { isComposing: true });
    expect(form.node.querySelectorAll('.tag')).toHaveLength(0);
    expect(entry.value).toBe('きゅう');
    form.node.querySelector('.picker-btn').click();
    const search = document.querySelector('.popover input');
    search.value = 'やま';
    key(search, 'Enter', { isComposing: true });
    expect(document.querySelector('.popover')).not.toBeNull();
    expect(form.values().who).toBe(null);
    key(search, 'Escape');
  });
});

describe('dialogs', () => {
  it('cleans up when the browser closes a dialog without a cancel event', async () => {
    const { openFormDialog } = await import('../src/ui/form.js');
    document.body.replaceChildren();
    const done = openFormDialog({ title: 'Add expense', fields: [{ id: 'note', label: 'Note' }], onSave: () => true });
    const dlg = document.querySelector('dialog[open]');
    // Chrome closes a dialog outright on a repeated Escape once the page
    // has cancelled the previous one without user activation in between.
    HTMLDialogElement.prototype.close.call(dlg);
    dlg.dispatchEvent(new Event('close'));
    expect(await Promise.race([done, tick(50).then(() => 'still pending')])).toBe(null);
    expect(dlg.isConnected).toBe(false);
  });
});

describe('menus', () => {
  it('closes when its button is clicked again', async () => {
    const { openMenu } = await import('../src/ui/menu.js');
    const run = vi.fn();
    const btn = document.createElement('button');
    btn.addEventListener('click', () => openMenu(btn, [{ label: 'Edit', run }, { label: 'Delete', run }]));
    document.body.replaceChildren(btn);
    btn.click();
    expect(document.querySelector('.popover')).not.toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    btn.click();
    expect(document.querySelector('.popover')).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    expect(document.querySelector('.popover')).not.toBeNull();
    key(document.activeElement, 'Escape');
    expect(document.querySelector('.popover')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});

describe('charts', () => {
  it('keeps focus on the "View as table" toggle', async () => {
    const { columnChart } = await import('../src/ui/chart.js');
    const chart = columnChart({ title: 'Costs', categories: [{ label: 'Jan', values: [100] }, { label: 'Feb', values: [250] }], series: [{ name: 'Fuel', color: 'red' }], format: String, short: String });
    document.body.replaceChildren(chart);
    const toggle = () => chart.querySelector('.chart-top button');
    toggle().focus();
    toggle().click();
    expect(chart.querySelector('table')).not.toBeNull();
    expect(document.activeElement).toBe(toggle());
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    toggle().click();
    expect(chart.querySelector('svg')).not.toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it('keeps the tooltip of the first and last column inside the chart', async () => {
    const { columnChart } = await import('../src/ui/chart.js');
    const chart = columnChart({ title: 'Costs', categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((label, i) => ({ label, values: [100 * (i + 1)] })), series: [{ name: 'Fuel', color: 'red' }], format: String, short: String });
    document.body.replaceChildren(chart);
    // A 320px phone: the plot is 288px wide and the tooltip 170px.
    const plot = chart.querySelector('.chart-plot');
    const tip = chart.querySelector('.chart-tip');
    Object.defineProperty(plot, 'clientWidth', { value: 288 });
    Object.defineProperty(tip, 'offsetWidth', { value: 170 });
    const bands = chart.querySelectorAll('.chart-band');
    for (const band of [bands[0], bands[bands.length - 1]]) {
      band.dispatchEvent(new Event('pointerenter'));
      const left = parseFloat(tip.style.left);
      expect(tip.style.left).toMatch(/px$/);
      expect(left - 85).toBeGreaterThanOrEqual(0);
      expect(left + 85).toBeLessThanOrEqual(288);
    }
  });

  it('does not repeat the same axis label when there is no data yet', async () => {
    const { columnChart } = await import('../src/ui/chart.js');
    const { formatMoneyShort } = await import('../src/core/money.js');
    const chart = columnChart({ title: 'Costs', categories: ['Jan', 'Feb', 'Mar'].map((label) => ({ label, values: [0, 0] })), series: [{ name: 'Fuel', color: 'red' }, { name: 'Service', color: 'blue' }], format: String, short: (c) => formatMoneyShort(c), stacked: true });
    const labels = [...chart.querySelectorAll('svg > text.chart-axis')].map((t) => t.textContent);
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
    // A few cents: the quarter ticks all round to "$0".
    const small = columnChart({ title: 'Costs', categories: [{ label: 'Jan', values: [3] }], series: [{ name: 'Fuel', color: 'red' }], format: String, short: (c) => formatMoneyShort(c) });
    const smallLabels = [...small.querySelectorAll('svg > text.chart-axis')].map((t) => t.textContent);
    expect(new Set(smallLabels).size).toBe(smallLabels.length);
  });
});

describe('toasts', () => {
  it('shows toasts inside an open modal dialog, where they are not inert', async () => {
    const { openDialog } = await import('../src/ui/dialog.js');
    const { toast } = await import('../src/ui/toast.js');
    document.body.replaceChildren();
    const { dialog, close } = openDialog({ title: 'Import', body: 'Choose a file' });
    toast('Choose a CSV file with data first.', { type: 'error' });
    const region = document.querySelector('.toast-region');
    expect(dialog.contains(region)).toBe(true);
    expect(region.textContent).toContain('Choose a CSV file');
    // Closing the dialog keeps the toast on screen.
    close();
    expect(document.body.contains(region)).toBe(true);
    expect(region.parentNode).toBe(document.body);
    expect(region.textContent).toContain('Choose a CSV file');
    toast('Imported 3 records');
    expect(document.querySelectorAll('.toast-region')).toHaveLength(1);
  });

  it('waits while a toast has keyboard focus before timing out', async () => {
    const { toast } = await import('../src/ui/toast.js');
    document.body.replaceChildren();
    vi.useFakeTimers();
    try {
      const run = vi.fn();
      toast('Issue deleted', { action: { label: 'Undo', run } });
      const mine = () => [...document.querySelectorAll('.toast')].find((t) => t.textContent.includes('Issue deleted')) || null;
      const undo = mine().querySelector('.toast-action');
      undo.focus();
      vi.advanceTimersByTime(20000);
      expect(mine()).not.toBeNull();
      undo.blur();
      vi.advanceTimersByTime(3000);
      expect(mine()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('theme', () => {
  it('follows a theme change made in another tab', async () => {
    const { initTheme, onThemeChange } = await import('../src/ui/theme.js');
    initTheme();
    const seen = [];
    onThemeChange((m) => seen.push(m));
    // Another tab chose Dark: storage changes and this tab gets an event.
    localStorage.setItem('fleet.theme', 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'fleet.theme', newValue: 'dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(seen).toContain('dark');
    localStorage.removeItem('fleet.theme');
    window.dispatchEvent(new StorageEvent('storage', { key: 'fleet.theme', newValue: null }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
