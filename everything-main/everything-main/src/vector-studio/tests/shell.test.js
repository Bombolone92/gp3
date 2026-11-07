import { describe, it, expect, beforeEach } from 'vitest';
import axe from 'axe-core';
import { bootApp } from './helpers.js';

describe('app shell', () => {
  let app;
  beforeEach(() => {
    app = bootApp();
  });

  it('builds the menu bar, tools panel and dock', () => {
    const menus = [...document.querySelectorAll('.menubar-item')].map((b) => b.textContent);
    expect(menus).toEqual(['File', 'Edit', 'Object', 'Type', 'Select', 'Effect', 'View', 'Window', 'Help']);
    expect(document.querySelectorAll('.tool-btn[aria-label]').length).toBeGreaterThan(10);
    expect(document.querySelector('[role="tab"]#tab-properties')).not.toBeNull();
    expect(document.querySelector('[role="tab"]#tab-layers')).not.toBeNull();
  });

  it('opens a document in a tab and switches tools by shortcut', () => {
    app.newDocument();
    expect(document.querySelectorAll('.doc-tab')).toHaveLength(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true }));
    expect(app.toolId).toBe('pen');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', code: 'KeyM', shiftKey: true, bubbles: true }));
    expect(app.toolId).toBe('pen'); // Shift+M belongs to a tool that is not registered in the core build
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', bubbles: true }));
    expect(app.toolId).toBe('rectangle');
  });

  it('hides sign-out inside the Puter desktop (app env)', () => {
    bootApp({ env: 'app', user: { username: 'ada' } });
    document.querySelector('.account-btn').click();
    const labels = [...document.querySelectorAll('.menu-item')].map((m) => m.textContent);
    expect(labels.some((l) => /sign out/i.test(l))).toBe(false);
  });

  it('offers sign-out on the web', () => {
    bootApp({ env: 'web', user: { username: 'ada' } });
    document.querySelector('.account-btn').click();
    const labels = [...document.querySelectorAll('.menu-item')].map((m) => m.textContent);
    expect(labels.some((l) => /sign out/i.test(l))).toBe(true);
  });

  it('has no serious accessibility violations with a document open', async () => {
    app.newDocument();
    const result = await axe.run(document.getElementById('app'), {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
  });
});

describe('stroke units preference', () => {
  it('shows stroke weights in the Stroke units preference, not the document units', async () => {
    const { createPath } = await import('../src/model/nodes.js');
    const { rectangle } = await import('../src/model/shapes.js');
    const app = bootApp();
    const ed = app.newDocument({ name: 'mm', units: 'mm' });
    const p = createPath(rectangle(0, 0, 10, 10), true, { strokeWidth: 2 });
    ed.doc.transact('Add', () => ed.doc.insert(p, ed.targetLayer().id));
    ed.select([p.id]);
    const panel = app.dock.panels.get('properties');
    panel.ensureBuilt();
    panel.update();
    expect(panel.strokeW.input.value).toBe('2 pt');
    app.prefs.set('strokeUnits', 'px');
    panel.update();
    expect(panel.strokeW.input.value).toBe('2 px');
  });
});

describe('document tabs', () => {
  it('scrolls the active tab into view when the tabs overflow', () => {
    const app = bootApp();
    const proto = HTMLElement.prototype;
    const saved = ['offsetLeft', 'offsetWidth', 'clientWidth', 'scrollWidth'].map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)]);
    const tabIndex = (el) => [...el.parentElement.children].indexOf(el);
    Object.defineProperty(proto, 'offsetLeft', { configurable: true, get() { return this.classList.contains('doc-tab') ? tabIndex(this) * 200 : 0; } });
    Object.defineProperty(proto, 'offsetWidth', { configurable: true, get() { return this.classList.contains('doc-tab') ? 200 : 0; } });
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return this === app.tabsEl ? 500 : 0; } });
    Object.defineProperty(proto, 'scrollWidth', { configurable: true, get() { return this === app.tabsEl ? this.children.length * 200 : 0; } });
    try {
      for (let i = 0; i < 8; i++) app.newDocument();
      expect(app.tabsEl.scrollLeft).toBe(8 * 200 - 500);
      app.activate(app.editors[1]);
      expect(app.tabsEl.scrollLeft).toBe(200);
    } finally {
      for (const [k, d] of saved) if (d) Object.defineProperty(proto, k, d);
    }
  });
});
