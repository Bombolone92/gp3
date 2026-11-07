// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createSheetTabs } from '../src/ui/sheettabs.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

let tabs;
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { closeMenu(); closeAllModals(); tabs?.destroy(); document.body.replaceChildren(); });

function setup() {
  const wb = new Workbook({ sheets: [{ name: 'First' }, { name: 'Second' }] });
  tabs = createSheetTabs({ wb });
  document.body.append(tabs.el);
  return wb;
}

function key(target, key) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('sheet tab keyboard controls', () => {
  it.each(['Enter', ' '])('allows the options button to activate with %j', (press) => {
    const wb = setup();
    const button = tabs.el.querySelector('.tab-menu-btn');
    button.focus();
    expect(key(button, press).defaultPrevented).toBe(false);
    // jsdom does not synthesize a button's native keyboard click.
    button.click();
    expect(document.querySelector('[role="menu"]').getAttribute('aria-label')).toBe('First options');
    expect(wb.activeSheet.name).toBe('First');
  });

  it('still switches sheets with arrows when the tab itself is focused', () => {
    const wb = setup();
    const tab = tabs.el.querySelector('[role="tab"]');
    tab.focus();
    expect(key(tab, 'ArrowRight').defaultPrevented).toBe(true);
    expect(wb.activeSheet.name).toBe('Second');
    expect(document.activeElement).toBe(tabs.el.querySelector('.tab.active'));
  });
});

describe('focus across a tab rebuild', () => {
  it('stays on the tab strip when a click switches sheets, so shortcuts keep working', () => {
    const wb = setup();
    const [first, second] = tabs.el.querySelectorAll('[role="tab"]');
    first.focus();
    second.click();
    expect(wb.activeSheet.name).toBe('Second');
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement.getAttribute('role')).toBe('tab');
    expect(document.activeElement.textContent).toBe('Second');
    // A rebuild while focus is elsewhere leaves it there.
    document.activeElement.blur();
    wb.addSheet('Third');
    expect(document.activeElement).toBe(document.body);
  });
});

describe('moving a tab past a hidden sheet', () => {
  const item = (label) => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((b) => b.textContent.includes(label));
  const names = (wb) => wb.visibleSheets.map((s) => s.name);

  it('lands beyond the hidden neighbour, so the tab visibly changes place', () => {
    const wb = setup();
    wb.addSheet('Third');
    wb.setSheetHidden(wb.sheets[1].id, true);
    wb.setActiveSheet(wb.sheets[0].id);
    expect(names(wb)).toEqual(['First', 'Third']);
    tabs.el.querySelector('.tab-menu-btn').click();
    expect(item('Move left').disabled).toBe(true);
    item('Move right').click();
    expect(names(wb)).toEqual(['Third', 'First']);
    expect(wb.sheets.map((s) => s.name)).toEqual(['Second', 'Third', 'First']);
    tabs.el.querySelector('.tab-menu-btn').click();
    expect(item('Move right').disabled).toBe(true);
    item('Move left').click();
    expect(names(wb)).toEqual(['First', 'Third']);
  });
});

describe('deleting a sheet from the tab menu', () => {
  const deleteItem = () => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((b) => b.textContent.includes('Delete'));
  const confirmation = () => document.querySelector('.modal-panel[aria-label=\'Delete "First"?\']');

  it('asks first when the sheet holds only an image or a note, not just when it holds cells', () => {
    const wb = setup();
    const id = wb.sheets[0].id;
    wb.addChart(id, { type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', anchor: { r: 0, c: 0 }, w: 120, h: 80, title: 'logo.png' });
    tabs.el.querySelector('.tab-menu-btn').click();
    deleteItem().click();
    expect(confirmation()).toBeTruthy();
    expect(wb.sheets).toHaveLength(2);
    closeAllModals();
    wb.deleteChart(id, wb.sheet(id).charts[0].id);
    wb.setNote(id, 0, 0, 'remember this');
    tabs.el.querySelector('.tab-menu-btn').click();
    deleteItem().click();
    expect(confirmation()).toBeTruthy();
    expect(wb.sheets).toHaveLength(2);
  });

  it('deletes an empty sheet without asking', () => {
    const wb = setup();
    tabs.el.querySelector('.tab-menu-btn').click();
    deleteItem().click();
    expect(confirmation()).toBeNull();
    expect(wb.sheets).toHaveLength(1);
  });
});

describe('after the workbook is replaced', () => {
  it('shows the restored sheets, as after a draft or version restore', () => {
    const wb = setup();
    const other = new Workbook({ sheets: [{ name: 'Draft A' }, { name: 'Draft B' }] });
    other.setActiveSheet(other.sheets[1].id);
    wb.replaceWith(other.toJSON());
    expect([...tabs.el.querySelectorAll('.tab-name')].map((n) => n.textContent)).toEqual(['Draft A', 'Draft B']);
    expect(tabs.el.querySelector('.tab.active .tab-name').textContent).toBe('Draft B');
  });
});

describe('the active tab and its options button', () => {
  // Everything inside role="tab" is presentational to assistive technology, so the options
  // button nested in the tab was never announced; and a tablist may own nothing but tabs, so
  // it cannot sit among them either. It lives beside the tablist and is laid over the active chip.
  it('keeps the button outside the tab and the tablist, beside the active chip', () => {
    const wb = setup();
    wb.setSheetColor(wb.sheets[0].id, '#ff0000');
    wb.setProtected?.(wb.sheets[0].id, true);
    const tab = tabs.el.querySelector('.tab.active');
    const button = tabs.el.querySelector('.tab-menu-btn');
    const tablist = tabs.el.querySelector('[role="tablist"]');
    expect(tab.getAttribute('role')).toBe('tab');
    expect(tab.contains(button)).toBe(false);
    expect(tablist.contains(button)).toBe(false);
    expect(button.parentElement).toBe(tabs.el.querySelector('.tab-list'));
    const chip = tab.parentElement;
    expect(chip.classList.contains('tab-item')).toBe(true);
    expect(chip.classList.contains('colored')).toBe(true);
    expect(chip.style.getPropertyValue('--tab-color')).toBe('#ff0000');
    expect(button.getAttribute('aria-label')).toBe('First options');
    const lock = tabs.el.querySelector('.tab-lock');
    if (lock) expect(lock.getAttribute('role')).toBe('img');
    // Inactive tabs stay bare: no chip.
    const inactive = [...tabs.el.querySelectorAll('.tab')].find((t) => !t.classList.contains('active'));
    expect(inactive.parentElement).toBe(tablist);
    expect(tabs.el.querySelectorAll('.tab-menu-btn')).toHaveLength(1);
  });
});

it('keeps meaningful leading and trailing spaces in the rename dialog', async () => {
  const wb = setup();
  tabs.el.querySelector('[role="tab"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const input = document.querySelector('.modal-root input');
  input.value = '  First  ';
  document.querySelector('.modal-root form').requestSubmit();
  await Promise.resolve();
  expect(wb.sheets[0].name).toBe('  First  ');
});
