// @vitest-environment jsdom
/** Last fixes after the merged review: issue list bulk assign, VIN lookup errors. */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { polyfill, freshStore, settle, viewCtx, clickButton } from './review-vehicles-setup.js';
import { decodeVin } from '../src/core/vin.js';
import { app } from '../src/app.js';
import { fuelWarnings } from '../src/core/fuel.js';

beforeAll(polyfill);

describe('issue list bulk assign', () => {
  beforeEach(async () => {
    await freshStore({ sample: true });
    localStorage.clear();
  });

  it('opens the assign menu at the button that was clicked', async () => {
    const { render } = await import('../src/views/issues.js');
    const ctx = viewCtx({ query: { tab: 'all' } });
    const out = render(ctx);
    document.querySelector('main').replaceChildren(out.node);
    await settle();
    const cb = out.node.querySelector('thead input[type="checkbox"]');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    // Safari and Firefox on macOS leave focus on the body after a click.
    document.activeElement?.blur();
    const btn = clickButton(out.node.querySelector('.bulk-bar'), 'Assign');
    await settle();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.hasAttribute('aria-haspopup')).toBe(false);
    ctx.dispose?.();
  });
});

describe('VIN lookup', () => {
  it('explains an answer that is not VIN data instead of showing a parse error', async () => {
    const html = async () => new Response('<html><body>502 Bad Gateway</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    await expect(decodeVin('1FTBR1C82MKA12345', html)).rejects.toThrow('The VIN lookup service sent an answer the app could not read. Try again later.');
  });
});

describe('editing a completed renewal', () => {
  beforeEach(() => freshStore());

  it('keeps it completed when only its notes change', async () => {
    const { openRenewalDialog } = await import('../src/views/renewals.js');
    const v = app.store.put('vehicles', { name: 'Van 1', status: 'active', meterUnit: 'mi' });
    const r = app.store.put('renewals', { kind: 'vehicle', vehicleId: v.id, type: 'Registration', dueDate: null, done: true, repeat: null, history: [{ date: '2026-09-01', dueDate: '2026-09-15', cost: null }] });
    openRenewalDialog(r);
    await settle();
    const dlg = document.querySelector('dialog[open]');
    const notes = dlg.querySelector('textarea');
    notes.value = 'Paid at the counter';
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    clickButton(dlg, 'Save');
    await settle();
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(app.store.get('renewals', r.id)).toMatchObject({ done: true, dueDate: null, notes: 'Paid at the counter' });
  });

  it('reopens it when a new due date is entered', async () => {
    const { openRenewalDialog } = await import('../src/views/renewals.js');
    const v = app.store.put('vehicles', { name: 'Van 1', status: 'active', meterUnit: 'mi' });
    const r = app.store.put('renewals', { kind: 'vehicle', vehicleId: v.id, type: 'Registration', dueDate: null, done: true, repeat: null, history: [] });
    openRenewalDialog(r);
    await settle();
    const dlg = document.querySelector('dialog[open]');
    const due = dlg.querySelector('input[type="date"]');
    due.value = '2027-09-15';
    due.dispatchEvent(new Event('input', { bubbles: true }));
    due.dispatchEvent(new Event('change', { bubbles: true }));
    clickButton(dlg, 'Save');
    await settle();
    expect(app.store.get('renewals', r.id)).toMatchObject({ done: false, dueDate: '2027-09-15' });
  });
});

describe('fuel tank warning', () => {
  const phev = { specs: { fuelCapacity: 11.3 } };

  it('does not compare a charging session with the fuel tank', () => {
    expect(fuelWarnings({ kind: 'charge', vehicleId: 'v', date: '2026-10-12', volume: 14 }, phev)).toEqual([]);
  });

  it('names the unit of the tank size', () => {
    expect(fuelWarnings({ vehicleId: 'v', date: '2026-10-12', volume: 14 }, phev, [], { volumeUnit: 'gal' })).toEqual(["The volume is more than this vehicle's tank holds (11.3 gal)."]);
  });
});

describe('comments', () => {
  beforeEach(() => freshStore());

  it('can bring back a deleted comment with Undo', async () => {
    const { commentsPanel } = await import('../src/views/common.js');
    app.demo = true;
    const c = app.store.put('comments', { parentType: 'issues', parentId: 'i1', text: 'Checked the brake light', author: 'Olivia' });
    const panel = commentsPanel('issues', 'i1');
    document.querySelector('main').replaceChildren(panel);
    panel.querySelector('.comment-del').click();
    expect(app.store.get('comments', c.id)).toBeFalsy();
    const toastEl = [...document.querySelectorAll('.toast')].find((t) => /Comment deleted/.test(t.textContent));
    expect(toastEl).toBeTruthy();
    clickButton(toastEl, 'Undo');
    expect(app.store.get('comments', c.id)?.text).toBe('Checked the brake light');
  });
});

describe('new part form', () => {
  beforeEach(() => freshStore());

  it('does not print "null" under the stock locations when every location is listed', async () => {
    const { render } = await import('../src/views/part-form.js');
    const out = render(viewCtx());
    document.querySelector('main').replaceChildren(out.node || out);
    const list = document.querySelector('.loc-list');
    expect([...list.childNodes].some((n) => n.nodeType === Node.TEXT_NODE)).toBe(false);
    expect(list.textContent).not.toMatch(/null/);
  });
});
