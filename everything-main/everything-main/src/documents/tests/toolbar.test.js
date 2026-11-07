// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createToolbar, normalizeAlignment, normalizeFontSize, isUsable, styleLabel, TABLE_ACTIONS, stepFontSize } from '../src/ui/toolbar.js';
import { fakeUi } from './helpers/fake-ui.js';
import { closeMenu } from '../src/ui/menu.js';

afterEach(() => { closeMenu(); document.body.replaceChildren(); });

describe('toolbar helpers', () => {
  it('normalizes alignment and font size values from the engine', () => {
    expect(normalizeAlignment('both')).toBe('justify');
    expect(normalizeAlignment('Center')).toBe('center');
    expect(normalizeAlignment(undefined)).toBe('left');
    expect(normalizeFontSize('12pt')).toBe('12');
    expect(normalizeFontSize(11.5)).toBe('11.5');
    expect(normalizeFontSize(null)).toBe('');
  });

  it('keeps inline formats usable at a collapsed caret, but not in viewing mode', () => {
    expect(isUsable({ enabled: true })).toBe(true);
    expect(isUsable({ enabled: false, reason: 'range-selection-required' })).toBe(true);
    expect(isUsable({ enabled: false, reason: 'not-ready' })).toBe(false);
    expect(isUsable({ enabled: true }, { editing: false })).toBe(false);
  });

  it('title-cases style names as authored in the DOCX', () => {
    expect(styleLabel('heading 1')).toBe('Heading 1');
    expect(styleLabel('Normal')).toBe('Normal');
    expect(styleLabel('')).toBe('');
  });
});

describe('createToolbar', () => {
  let ui;
  let tb;
  beforeEach(() => {
    ui = fakeUi({ commands: { undo: { enabled: false }, bold: { active: true }, 'text-align': { value: 'center' }, 'text-color': { value: 'FF0000' }, 'font-family': { value: 'Arial' }, 'font-size': { value: 12 } } });
    tb = createToolbar({ focusEditor: () => {} });
    document.body.append(tb.el);
  });

  it('renders every control disabled until bound, with accessible names', () => {
    const buttons = [...tb.el.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(15);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(buttons.every((b) => b.getAttribute('aria-label'))).toBe(true);
    expect(tb.el.getAttribute('role')).toBe('toolbar');
    for (const s of tb.el.querySelectorAll('select')) expect(s.getAttribute('aria-label')).toBeTruthy();
  });

  it('mirrors command state after binding', () => {
    tb.bind(ui);
    const q = (cmd) => tb.el.querySelector(`[data-cmd="${cmd}"]`);
    expect(q('undo').disabled).toBe(true);
    expect(q('redo').disabled).toBe(false);
    expect(q('bold').getAttribute('aria-pressed')).toBe('true');
    expect(q('italic').getAttribute('aria-pressed')).toBe('false');
    expect(q('superscript').getAttribute('aria-pressed')).toBe('false');
    expect(q('subscript').getAttribute('aria-label')).toBe('Subscript');
    expect(q('text-color').querySelector('.tb-color-bar').style.background).toBe('rgb(255, 0, 0)');
    expect(q('text-align').querySelector('svg')).toBeTruthy();
  });

  it('updates live as command state changes', () => {
    tb.bind(ui);
    ui.commands.get('bold').set({ active: false });
    ui.commands.get('undo').set({ enabled: true });
    expect(tb.el.querySelector('[data-cmd="bold"]').getAttribute('aria-pressed')).toBe('false');
    expect(tb.el.querySelector('[data-cmd="undo"]').disabled).toBe(false);
  });

  it('routes clicks through the command controller', async () => {
    tb.bind(ui);
    tb.el.querySelector('[data-cmd="italic"]').click();
    await Promise.resolve();
    expect(ui.executed).toEqual([{ id: 'italic', payload: undefined }]);
  });

  it('fills pickers from the fonts and styles slices and applies picks', async () => {
    tb.bind(ui);
    const style = tb.el.querySelector('.tb-style');
    const font = tb.el.querySelector('.tb-font');
    const size = tb.el.querySelector('.tb-size');
    expect([...style.options].map((o) => o.textContent)).toEqual(['Normal', 'Heading 1']);
    expect(style.value).toBe('Normal');
    expect([...font.options].map((o) => o.value)).toEqual(['Arial', 'Georgia']);
    expect(font.value).toBe('Arial');
    expect(size.value).toBe('12');
    style.value = 'Heading1';
    style.dispatchEvent(new Event('change'));
    size.value = '12';
    size.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(ui.executed).toEqual([{ id: 'linked-style', payload: 'Heading1' }, { id: 'font-size', payload: '12' }]);
  });

  it('shows the current value as a placeholder when it is not in the list', () => {
    tb.bind(ui);
    ui.commands.get('font-family').set({ value: 'Garamond' });
    const font = tb.el.querySelector('.tb-font');
    expect(font.value).toBe('');
    expect(font.querySelector('option[data-ph]').textContent).toBe('Garamond');
    ui.styles.set({ mixedSelection: true, activeParagraphStyleId: null });
    expect(tb.el.querySelector('.tb-style').querySelector('option[data-ph]').textContent).toBe('Mixed');
  });

  it('disables editing controls in viewing mode and re-enables them after', () => {
    tb.bind(ui);
    ui.document.set({ mode: 'viewing' });
    expect(tb.el.querySelector('[data-cmd="bold"]').disabled).toBe(true);
    expect(tb.el.querySelector('.tb-style').disabled).toBe(true);
    expect(tb.el.classList.contains('is-readonly')).toBe(true);
    ui.document.set({ mode: 'editing' });
    expect(tb.el.querySelector('[data-cmd="bold"]').disabled).toBe(false);
  });

  it('hides controls the engine does not support', () => {
    ui.commands.get('table-insert').set({ supported: false });
    tb.bind(ui);
    expect(tb.el.querySelector('[data-cmd="table-insert"]').hidden).toBe(true);
  });

  it('moves focus with arrow keys and stops observing on unbind', () => {
    tb.bind(ui);
    const bold = tb.el.querySelector('[data-cmd="bold"]');
    bold.focus();
    tb.el.dispatchEvent(Object.assign(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(document.activeElement).toBe(tb.el.querySelector('[data-cmd="italic"]'));
    ui.commands.get('bold').set({ active: false });
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    tb.unbind();
    ui.commands.get('bold').set({ active: true });
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    expect(bold.disabled).toBe(true);
  });

  it('is one tab stop that follows the control last used and leaves disabled ones', async () => {
    tb.bind(ui);
    const stops = () => [...tb.el.querySelectorAll('button, select')].filter((control) => control.tabIndex === 0);
    expect(stops()).toHaveLength(1);
    expect(stops()[0].disabled).toBe(false);
    const bold = tb.el.querySelector('[data-cmd="bold"]');
    bold.focus();
    expect(stops()).toEqual([bold]);
    tb.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(stops()).toEqual([tb.el.querySelector('[data-cmd="italic"]')]);
    ui.commands.get('italic').set({ enabled: false, reason: 'unavailable' });
    await Promise.resolve();
    expect(stops()).toHaveLength(1);
    expect(stops()[0].disabled).toBe(false);
    expect(stops()[0]).not.toBe(tb.el.querySelector('[data-cmd="italic"]'));
    tb.unbind();
    expect(stops()).toHaveLength(0);
  });

  it('skips hidden list options during keyboard navigation', () => {
    tb.bind(ui);
    const numbers = tb.el.querySelector('[data-cmd="numbered-list"]');
    numbers.focus();
    numbers.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(tb.el.querySelector('[data-cmd="indent-decrease"]'));
  });

  it('moves along the toolbar with Left and Right from the style, font, and size selects', () => {
    tb.bind(ui);
    const press = (key) => { const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); document.activeElement.dispatchEvent(event); return event; };
    tb.el.querySelector('[data-cmd="redo"]').focus();
    press('ArrowRight');
    expect(document.activeElement).toBe(tb.el.querySelector('.tb-style'));
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(tb.el.querySelector('.tb-font'));
    press('ArrowRight');
    expect(document.activeElement).toBe(tb.el.querySelector('.tb-size'));
    press('ArrowRight');
    expect(document.activeElement).toBe(tb.el.querySelector('[data-cmd="bold"]'));
    press('ArrowLeft'); press('ArrowLeft');
    expect(document.activeElement).toBe(tb.el.querySelector('.tb-font'));
    // Up and Down stay with the select's own options.
    expect(press('ArrowDown').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(tb.el.querySelector('.tb-font'));
  });

  it('reports a command that threw and shows the document\'s own value in the select again', async () => {
    const errors = [];
    const failing = createToolbar({ focusEditor: () => {}, onError: (message) => errors.push(message) });
    document.body.append(failing.el);
    failing.bind(ui);
    ui.commands.get('font-size').executeAsync = async () => { throw new Error('The engine is busy'); };
    const size = failing.el.querySelector('.tb-size');
    expect(size.value).toBe('12');
    size.value = '11';
    size.dispatchEvent(new Event('change'));
    await Promise.resolve(); await Promise.resolve();
    expect(errors).toEqual(['The engine is busy']);
    expect(size.value).toBe('12');
    failing.unbind();
  });

  it('leaves Home and End to native font and size selects', () => {
    tb.bind(ui);
    for (const select of tb.el.querySelectorAll('select')) {
      select.focus();
      const event = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
      select.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(select);
    }
  });

  it('closes its palette when switching documents', () => {
    tb.bind(ui);
    tb.el.querySelector('[data-cmd="text-color"]').click();
    expect(document.querySelector('.menu')).not.toBeNull();
    tb.unbind();
    expect(document.querySelector('.menu')).toBeNull();
  });

  it('reports a refused caps or script change and swallows other refusals', async () => {
    const onError = vi.fn(), onMutate = vi.fn();
    tb = createToolbar({ onError, onMutate });
    document.body.append(tb.el);
    tb.bind(ui);
    const refusal = { success: false, failure: { code: 'UNAVAILABLE', message: 'Select the text to change first' } };
    for (const id of ['superscript', 'all-caps', 'bold']) ui.commands.get(id).executeAsync = async () => refusal;
    await tb.exec('superscript');
    await tb.exec('all-caps');
    expect(onError.mock.calls.map(([m]) => m)).toEqual(['Select the text to change first', 'Select the text to change first']);
    await tb.exec('bold');
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onMutate).not.toHaveBeenCalled();
  });

  it('routes text, highlight, and custom color removal through dirty tracking', async () => {
    const onMutate = vi.fn(), focusEditor = vi.fn();
    tb = createToolbar({ onMutate, focusEditor });
    document.body.append(tb.el);
    tb.bind(ui);
    for (const [id, value] of [['text-color', '#ff0000'], ['highlight-color', '#ffff00'], ['text-color', null], ['highlight-color', null]]) {
      tb.el.querySelector(`[data-cmd="${id}"]`).click();
      const menu = document.querySelector('.menu');
      if (value) menu.querySelector(`[aria-label="${value === '#ff0000' ? 'Red' : 'Yellow'}"]`).click();
      else menu.querySelector('.menu-item').click();
      await Promise.resolve();
      expect(ui.executed.at(-1)).toEqual({ id, payload: value });
      expect(onMutate).toHaveBeenLastCalledWith(id);
    }
    tb.el.querySelector('[data-cmd="text-color"]').click();
    const hex = document.querySelector('.color-hex');
    hex.value = '#123456';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.menu button[type="submit"]').click();
    await Promise.resolve();
    expect(ui.executed.at(-1)).toEqual({ id: 'text-color', payload: '#123456' });
    expect(onMutate).toHaveBeenCalledTimes(5);
    expect(focusEditor).toHaveBeenCalledTimes(5);
  });
});

describe('table options', () => {
  it('appears only inside a table and routes actions through the controller', async () => {
    const ui = fakeUi({ commands: { 'table-split-cell': { enabled: false } } });
    const tb = createToolbar({ focusEditor: () => {} });
    document.body.append(tb.el);
    tb.bind(ui);
    const btn = tb.el.querySelector('[data-cmd="table-options"]');
    expect(btn.hidden).toBe(true);
    expect(tb.openTableMenu()).toBeNull();

    ui.tables.set({ inTable: true, rows: 2, columns: 3 });
    expect(btn.hidden).toBe(false);
    expect(btn.disabled).toBe(false);

    const m = tb.openTableMenu({ anchor: btn });
    const menu = document.querySelector('.menu[aria-label="Table"]');
    expect(menu).toBeTruthy();
    expect(menu.querySelector('.menu-header').textContent).toContain('2 × 3');
    const labels = [...menu.querySelectorAll('.menu-item')].map((b) => b.textContent.trim());
    expect(labels).toEqual(TABLE_ACTIONS.filter((a) => !a.separator).map((a) => a.label));
    expect([...menu.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Split cell')).disabled).toBe(true);
    [...menu.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Delete row')).click();
    await Promise.resolve();
    expect(ui.executed.at(-1).id).toBe('table-delete-row');
    m?.close();

    ui.document.set({ mode: 'viewing' });
    expect(btn.hidden).toBe(true);
    tb.el.remove();
  });
});

describe('stepFontSize', () => {
  it('walks the size ladder and extrapolates past its ends', () => {
    expect(stepFontSize('12', 1)).toBe(14);
    expect(stepFontSize(12, -1)).toBe(11);
    expect(stepFontSize('11.5', 1)).toBe(12);
    expect(stepFontSize('11.5', -1)).toBe(11);
    expect(stepFontSize(72, 1)).toBe(84);
    expect(stepFontSize(8, -1)).toBe(7);
    expect(stepFontSize('', 1)).toBe(12);
  });
});

describe('line spacing menu', () => {
  it('offers a custom entry only when the host provides a dialog', () => {
    const ui = fakeUi();
    const plain = createToolbar({ focusEditor: () => {} });
    document.body.append(plain.el);
    plain.bind(ui);
    plain.el.querySelector('[data-cmd="line-height"]').click();
    expect([...document.querable?.('x') || document.querySelectorAll('.menu .menu-item')].map((b) => b.textContent.trim())).toEqual(['Single', '1.15', '1.5', 'Double']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    plain.el.remove();

    let opened = 0;
    const withCustom = createToolbar({ focusEditor: () => {}, onSpacing: () => opened++ });
    document.body.append(withCustom.el);
    withCustom.bind(ui);
    withCustom.el.querySelector('[data-cmd="line-height"]').click();
    const items = [...document.querySelectorAll('.menu .menu-item')];
    expect(items.map((b) => b.textContent.trim())).toEqual(['Single', '1.15', '1.5', 'Double', 'Custom spacing']);
    items.at(-1).click();
    expect(opened).toBe(1);
    withCustom.el.remove();
  });
});

describe('color selection preservation', () => {
  const range = { kind: 'selection', start: { blockId: 'p1', offset: 2 }, end: { blockId: 'p2', offset: 7 }, story: { kind: 'story', storyType: 'headerFooterPart', refId: 'header1' } };
  const caret = { kind: 'selection', start: { blockId: 'p3', offset: 3 }, end: { blockId: 'p3', offset: 3 } };
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  function setup({ empty = false, readColorSelection } = {}) {
    const snapshot = { status: 'ready', empty, selectionTarget: empty ? caret : range };
    const ui = fakeUi({ selection: snapshot });
    ui.selection.restore = vi.fn((saved) => { ui.selection.set(saved); return { ok: true, success: true }; });
    const onMutate = vi.fn(), onColorError = vi.fn();
    const tb = createToolbar({ onMutate, onColorError, readColorSelection });
    document.body.append(tb.el); tb.bind(ui);
    return { ui, tb, snapshot, onMutate, onColorError };
  }
  function choose(value) {
    const menu = document.querySelector('.menu');
    if (value === '#123456') {
      const input = menu.querySelector('.color-hex');
      input.focus(); input.value = value;
      menu.querySelector('form').requestSubmit();
    } else menu.querySelector(value ? '[aria-label="Yellow"]' : '.menu-item').click();
  }

  it.each(['text-color', 'highlight-color'].flatMap(id => [false, true].flatMap(empty => ['#ffff00', '#123456', null].map(value => ({ id, empty, value })))))('restores the original selection for $id ($value, caret=$empty)', async ({ id, empty, value }) => {
    const { ui, tb, snapshot, onMutate, onColorError } = setup({ empty });
    const selections = [];
    ui.commands.get(id).executeAsync = vi.fn(async () => { selections.push(ui.selection.getSnapshot()); return { success: true }; });
    // Opening/focusing the palette can replace the live browser selection.
    document.addEventListener('focusin', () => ui.selection.set({ empty: true, selectionTarget: caret }), { once: true });
    tb.el.querySelector(`[data-cmd="${id}"]`).click();
    expect(ui.selection.getSnapshot().selectionTarget).toEqual(caret);
    choose(value); await flush();
    expect(ui.selection.restore).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(selections).toEqual([snapshot]);
    expect(ui.commands.get(id).executeAsync).toHaveBeenCalledExactlyOnceWith(value);
    expect(onMutate).toHaveBeenCalledExactlyOnceWith(id);
    expect(onColorError).not.toHaveBeenCalled();
    tb.unbind();
  });

  it('keeps pointer focus in the editor until its selection is captured', () => {
    const { tb } = setup();
    for (const id of ['text-color', 'highlight-color']) {
      const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
      tb.el.querySelector(`[data-cmd="${id}"]`).dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    tb.unbind();
  });

  it('waits for the settled selection before the palette takes focus', async () => {
    let settle;
    const { ui, tb, snapshot } = setup({ readColorSelection: () => new Promise(resolve => { settle = resolve; }) });
    ui.selection.set({ status: 'pending' });
    tb.el.querySelector('[data-cmd="highlight-color"]').click();
    expect(document.querySelector('.menu')).toBeNull();
    settle(snapshot); await flush();
    ui.selection.set({ status: 'ready', empty: true, selectionTarget: caret });
    choose('#ffff00'); await flush();
    expect(ui.selection.restore).toHaveBeenCalledWith(snapshot);
    tb.unbind();
  });

  it('reports a failed restore without applying color to another selection', async () => {
    const { ui, tb, onMutate, onColorError } = setup();
    ui.selection.restore.mockReturnValue({ ok: false, reason: 'target-unresolved' });
    tb.el.querySelector('[data-cmd="highlight-color"]').click();
    choose('#ffff00'); await flush();
    expect(ui.executed).toEqual([]);
    expect(onMutate).not.toHaveBeenCalled();
    expect(onColorError).toHaveBeenCalledOnce();
    tb.unbind();
  });

  it.each(['viewing', 'unready', 'rebind'])('ignores a color choice after %s', async state => {
    const { ui, tb } = setup();
    tb.el.querySelector('[data-cmd="highlight-color"]').click();
    const swatch = document.querySelector('[aria-label="Yellow"]');
    const next = fakeUi();
    if (state === 'rebind') tb.bind(next);
    else ui.document.set(state === 'viewing' ? { mode: 'viewing' } : { ready: false });
    swatch.click(); await flush();
    expect(ui.selection.restore).not.toHaveBeenCalled();
    expect(ui.executed).toEqual([]);
    expect(next.executed).toEqual([]);
    tb.unbind();
  });

  it('does not open a late palette after switching documents', async () => {
    let settle;
    const { tb, snapshot } = setup({ readColorSelection: () => new Promise(resolve => { settle = resolve; }) });
    tb.el.querySelector('[data-cmd="highlight-color"]').click();
    tb.bind(fakeUi()); settle(snapshot); await flush();
    expect(document.querySelector('.menu')).toBeNull();
    tb.unbind();
  });
});

describe('table options from a right-click', () => {
  it('opens at the pointer without marking the toolbar as the expanded control, and closes with the toolbar', () => {
    const ui = fakeUi();
    const onTableExtras = vi.fn(() => [{ label: 'Cell background', onSelect() {} }]);
    const tb = createToolbar({ focusEditor: () => {}, onTableExtras });
    document.body.append(tb.el);
    tb.bind(ui);
    ui.tables.set({ inTable: true, rows: 2, columns: 2, tableNodeId: 't1' });
    const opened = tb.openTableMenu({ x: 120, y: 80 });
    expect(opened?.menu).toBeTruthy();
    expect(tb.el.hasAttribute('aria-expanded')).toBe(false);
    expect(onTableExtras).toHaveBeenCalledWith(expect.objectContaining({ tableNodeId: 't1' }), { anchor: null, x: 120, y: 80 });
    tb.unbind();
    expect(document.querySelector('.menu[aria-label="Table"]')).toBeNull();

    // From the toolbar button, the button stays the anchor.
    tb.bind(ui);
    ui.tables.set({ inTable: true, rows: 2, columns: 2, tableNodeId: 't1' });
    const btn = tb.el.querySelector('[data-cmd="table-options"]');
    const anchored = tb.openTableMenu({ anchor: btn });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(onTableExtras).toHaveBeenLastCalledWith(expect.anything(), { anchor: btn, x: null, y: null });
    anchored.close();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('palette toggling', () => {
  it('lets a second press on the color button close the palette even though the selection is read first', async () => {
    const ui = fakeUi({ commands: { 'text-color': { value: 'FF0000' } } });
    let settle;
    const tb = createToolbar({ focusEditor: () => {}, readColorSelection: () => new Promise((resolve) => { settle = resolve; }) });
    document.body.append(tb.el);
    tb.bind(ui);
    const button = tb.el.querySelector('[data-cmd="text-color"]');
    const press = () => { button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); button.click(); };
    press(); settle({ status: 'ready', empty: false }); await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('.menu')).not.toBeNull();
    // The press lands on the open palette's own button: pointerdown closes it, and the click must not bring it back.
    press(); settle({ status: 'ready', empty: false }); await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('.menu')).toBeNull();
    tb.unbind?.();
  });
});

describe('keyboard picks in the selects', () => {
  it('keeps the keyboard on a select stepped with the arrow keys, and hands it back on Enter', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const focusEditor = vi.fn();
    const tb = createToolbar({ focusEditor });
    document.body.append(tb.el);
    const ui = fakeUi();
    tb.bind(ui);
    const font = tb.el.querySelector('.tb-font');
    font.focus();
    // Windows: Down on the closed select changes the value at once.
    font.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    font.value = 'Georgia';
    font.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve(); await Promise.resolve();
    expect(ui.executed.at(-1)).toEqual({ id: 'font-family', payload: 'Georgia' });
    expect(focusEditor).not.toHaveBeenCalled();
    font.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(focusEditor).toHaveBeenCalledTimes(1);
    // A pointer pick (no arrow key before the change) returns to the document as before.
    font.value = 'Arial';
    font.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve(); await Promise.resolve();
    expect(focusEditor).toHaveBeenCalledTimes(2);
    tb.unbind();
  });

  it('forgets an arrow press that picked nothing, so a later mouse pick hands the keyboard back', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const focusEditor = vi.fn();
    const tb = createToolbar({ focusEditor });
    document.body.append(tb.el);
    tb.bind(fakeUi());
    const font = tb.el.querySelector('.tb-font');
    font.focus();
    // macOS: Down opens the native list, which the user dismisses; nothing changed.
    font.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    font.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    font.value = 'Georgia';
    font.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve(); await Promise.resolve();
    expect(focusEditor).toHaveBeenCalledTimes(1);
    // Leaving the select for something else forgets the press as well.
    font.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    font.dispatchEvent(new FocusEvent('blur'));
    font.value = 'Arial';
    font.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve(); await Promise.resolve();
    expect(focusEditor).toHaveBeenCalledTimes(2);
  });
});

describe('image options', () => {
  it('appears while the caret touches a picture and opens that picture\'s menu', () => {
    const ui = fakeUi();
    const image = document.createElement('img');
    let atCaret = null;
    const onImageOptions = vi.fn();
    const tb = createToolbar({ focusEditor: () => {}, imageAtCaret: () => atCaret, onImageOptions });
    document.body.append(tb.el);
    tb.bind(ui);
    const btn = tb.el.querySelector('[data-cmd="image-options"]');
    expect(btn.hidden).toBe(true);
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    atCaret = image;
    ui.selection.set({ selectionTarget: { start: { kind: 'text', blockId: 'p1', offset: 1 } } });
    expect(btn.hidden).toBe(false);
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(onImageOptions).toHaveBeenCalledWith(image, btn);
    // The caret moves away: the button goes with it. In viewing mode it stays away.
    atCaret = null;
    ui.selection.set({ selectionTarget: { start: { kind: 'text', blockId: 'p1', offset: 5 } } });
    expect(btn.hidden).toBe(true);
    atCaret = image;
    ui.document.set({ mode: 'viewing' });
    ui.selection.set({ selectionTarget: { start: { kind: 'text', blockId: 'p1', offset: 1 } } });
    expect(btn.hidden).toBe(true);
    tb.el.remove();
  });
});
