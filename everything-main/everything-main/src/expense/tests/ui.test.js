import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { el, append, inlineError } from '../src/ui/dom.js';
import { applyTheme, currentTheme } from '../src/ui/theme.js';
import { icon, normalizeIconName } from '../src/ui/icons.js';
import { canSignOut } from '../src/views/settings.js';
import { routeFor, ROUTES } from '../src/ui/shell.js';
import { openModal, closeAllModals } from '../src/ui/modal.js';
import { shouldOnboard } from '../src/ui/onboarding.js';

describe('el / append', () => {
  it('builds elements from a tag.class spec with attributes, handlers and children', () => {
    let clicked = 0;
    const node = el('button.btn.btn-primary', { type: 'button', 'aria-label': 'Go', onclick: () => { clicked += 1; }, dataset: { id: 'x' } }, 'Go', null, false, 0, ['a', el('span', {}, 'b')]);
    expect(node.tagName).toBe('BUTTON');
    expect(node.className).toBe('btn btn-primary');
    expect(node.getAttribute('aria-label')).toBe('Go');
    expect(node.dataset.id).toBe('x');
    node.click();
    expect(clicked).toBe(1);
    // Falsy children, including 0, are dropped so `list.length && el()` never renders a "0".
    expect(node.textContent).toBe('Goab');
    expect(append(el('div'), [[['x']]]).textContent).toBe('x');
  });
  it('wires an inline error to its input for assistive tech', () => {
    const input = el('input');
    const err = inlineError(input);
    expect(err.node.hidden).toBe(true);
    err.show('Required');
    expect(err.node.hidden).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(err.node.id);
    err.show(null);
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });
});

describe('theme', () => {
  beforeEach(() => {
    document.head.append(el('meta', { name: 'theme-color', content: '' }));
  });
  afterEach(() => { delete document.documentElement.dataset.theme; localStorage.clear(); });
  it('stamps light/dark and clears the stamp for system', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('expenses:theme')).toBe('dark');
    expect(currentTheme()).toBe('dark');
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('expenses:theme')).toBeNull();
    expect(currentTheme()).toBe('system');
  });
  it('updates the theme-color meta tag', () => {
    applyTheme('dark');
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#0e0e0d');
    applyTheme('light');
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#f8f8f6');
  });
});

describe('icons', () => {
  it('renders Lucide SVG with a11y hidden and falls back for unknown names', () => {
    const html = icon('camera', 20);
    expect(html).toContain('<svg');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="20"');
    expect(normalizeIconName('constructor')).toBe('tag');
    expect(normalizeIconName('nope')).toBe('tag');
    expect(normalizeIconName('plane')).toBe('plane');
  });
});

describe('sign-out visibility follows puter.env', () => {
  it('hides sign-out inside the Puter desktop and shows it on the web', () => {
    expect(canSignOut({ env: 'app' })).toBe(false);
    expect(canSignOut({ env: 'web' })).toBe(true);
    expect(canSignOut({ env: 'gui' })).toBe(true);
    expect(canSignOut(undefined)).toBe(true);
  });
});

describe('routing', () => {
  it('maps hashes to routes and extracts ids', () => {
    expect(routeFor('#/').route.hash).toBe('#/');
    expect(routeFor('').route.hash).toBe('#/');
    expect(routeFor('#/reports').route.label).toBe('Reports');
    const r = routeFor('#/reports/abc%20d?x=1');
    expect(r.route.label).toBe('Reports');
    expect(r.params.id).toBe('abc d');
    expect(routeFor('#/nowhere').route).toBe(ROUTES[0]);
    expect(routeFor('#/expenses?filter=unreported').route.label).toBe('Expenses');
  });
});

describe('modal', () => {
  afterEach(() => { closeAllModals(); document.body.innerHTML = ''; });
  it('is a labelled dialog, makes the app inert, and closes on Escape', () => {
    document.body.append(el('div', { id: 'app' }));
    const { panel } = openModal({ title: 'Test dialog', content: el('p', {}, 'hi') });
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-label')).toBe('Test dialog');
    expect(document.getElementById('app').hasAttribute('inert')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.modal-root').classList.contains('closing')).toBe(true);
  });
});

describe('shouldOnboard', () => {
  it('only triggers on a fresh, empty account', () => {
    expect(shouldOnboard({ settings: { onboarded: false, sampleData: false }, months: [], reports: [] })).toBe(true);
    expect(shouldOnboard({ settings: { onboarded: true, sampleData: false }, months: [], reports: [] })).toBe(false);
    expect(shouldOnboard({ settings: { onboarded: false, sampleData: false }, months: ['2026-08'], reports: [] })).toBe(false);
    expect(shouldOnboard({ settings: { onboarded: false, sampleData: true }, months: [], reports: [] })).toBe(false);
  });
});
