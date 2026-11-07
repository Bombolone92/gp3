// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFindbar, matchLabel, validPattern } from '../src/ui/findbar.js';
import { fakeUi } from './helpers/fake-ui.js';

describe('matchLabel', () => {
  it('describes the match position', () => {
    expect(matchLabel({ query: '', total: 0 })).toBe('');
    expect(matchLabel({ query: 'x', total: 0 })).toBe('No matches');
    // The engine stops counting at a thousand: that many is at least that many.
    expect(matchLabel({ query: 'x', total: 999, activeIndex: 0 })).toBe('1 of 999');
    expect(matchLabel({ query: 'x', total: 1000, activeIndex: 0 })).toBe('1 of 1,000+');
    expect(matchLabel({ query: 'x', total: 4, activeIndex: 1 })).toBe('2 of 4');
  });
});

describe('createFindbar', () => {
  let ui;
  let fb;
  let focused;
  beforeEach(() => {
    vi.useFakeTimers();
    ui = fakeUi();
    focused = 0;
    fb = createFindbar({ focusEditor: () => { focused += 1; } });
    document.body.append(fb.el);
    fb.bind(ui);
  });

  it('closes on Escape from any of its controls, returning to the document', () => {
    fb.open();
    const press = (target) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const button = [...fb.el.querySelectorAll('button')].find((b) => /match case/i.test(b.getAttribute('aria-label') || b.textContent));
    button.focus();
    expect(press(button)).toBe(false);
    expect(fb.el.hidden).toBe(true);
    expect(focused).toBe(1);
    fb.open();
    press(fb.el.querySelector('input[type="search"]'));
    expect(fb.el.hidden).toBe(true);
  });

  it('reports opening and closing to whoever owns its button', () => {
    const states = [];
    const bar = createFindbar({ onToggle: (open) => states.push(open) });
    document.body.append(bar.el);
    bar.bind(ui);
    bar.open(); bar.close(); bar.close(); bar.toggle();
    expect(states).toEqual([true, false, true]);
  });

  it('is hidden until opened and opens a search session', () => {
    expect(fb.el.hidden).toBe(true);
    fb.open();
    expect(fb.el.hidden).toBe(false);
    expect(ui.searchCalls[0]).toEqual(['open']);
    expect(document.activeElement).toBe(fb.el.querySelector('input[type="search"]'));
  });

  it('searches as you type and reflects the snapshot', () => {
    fb.open();
    const q = fb.el.querySelector('input[type="search"]');
    q.value = 'test';
    q.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(150);
    expect(ui.searchCalls.at(-1)).toEqual(['search', 'test', { caseSensitive: false, regex: false }]);
    expect(fb.el.querySelector('.find-count').textContent).toBe('1 of 3');
    expect(fb.el.querySelector('[aria-label="Next match"]').disabled).toBe(false);
  });

  it('flags no matches and disables replace', () => {
    fb.open();
    const q = fb.el.querySelector('input[type="search"]');
    q.value = 'none';
    q.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(150);
    expect(fb.el.classList.contains('no-match')).toBe(true);
    expect(fb.el.querySelector('.find-count').textContent).toBe('No matches');
    expect([...fb.el.querySelectorAll('.btn-sm')].every((b) => b.disabled)).toBe(true);
    // Enter in the replacement field does nothing either, rather than asking the engine to replace nothing.
    const replace = vi.spyOn(ui.search, 'replace');
    const replaceInput = fb.el.querySelector('input[type="text"]');
    replaceInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(replace).not.toHaveBeenCalled();
    expect(fb.el.querySelector('.find-count').textContent).toBe('No matches');
  });

  it('Enter moves to the next match and Shift+Enter to the previous', () => {
    fb.open();
    const q = fb.el.querySelector('input[type="search"]');
    q.value = 'a';
    q.dispatchEvent(new Event('input'));
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    const kinds = ui.searchCalls.map((c) => c[0]);
    expect(kinds).toEqual(['open', 'search', 'next', 'previous']);
  });

  it.each([['Next match', 'next'], ['Previous match', 'previous']])('uses the latest typed query when clicking %s', (label, direction) => {
    fb.open('old');
    const query = fb.el.querySelector('input[type="search"]');
    query.value = 'new';
    query.dispatchEvent(new Event('input'));
    fb.el.querySelector(`[aria-label="${label}"]`).click();
    expect(ui.searchCalls.slice(-2)).toEqual([
      ['search', 'new', { caseSensitive: false, regex: false }], [direction],
    ]);
    vi.advanceTimersByTime(150);
    expect(ui.searchCalls.at(-1)).toEqual([direction]);
  });

  it('replaces one or all through the session', async () => {
    fb.open();
    const q = fb.el.querySelector('input[type="search"]');
    q.value = 'a';
    q.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(150);
    fb.el.querySelector('input[type="text"]').value = 'b';
    fb.el.querySelectorAll('.btn-sm')[0].click();
    await Promise.resolve();
    fb.el.querySelectorAll('.btn-sm')[1].click();
    await Promise.resolve();
    expect(ui.searchCalls.filter((c) => c[0].startsWith('replace'))).toEqual([['replace', 'b'], ['replaceAll', 'b']]);
  });

  it('does not apply a second replacement while the first is pending', async () => {
    fb.open('word');
    let finish;
    ui.search.replace = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const input = fb.el.querySelector('input[type="text"]');
    const enter = () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    enter();
    enter();
    expect(ui.search.replace).toHaveBeenCalledOnce();
    expect([...fb.el.querySelectorAll('.btn-sm')].every((b) => b.disabled)).toBe(true);
    finish({ ok: true });
    await Promise.resolve();
    expect(fb.el.querySelector('.btn-sm').disabled).toBe(false);
  });

  it('reports a thrown replacement error and allows retrying', async () => {
    fb.open('word');
    ui.search.replace = vi.fn().mockRejectedValue(new Error('Replace failed'));
    fb.el.querySelector('.btn-sm').click();
    await Promise.resolve();
    expect(fb.el.querySelector('.find-count').textContent).toBe('Could not replace. Try again');
    expect(fb.el.querySelector('.btn-sm').disabled).toBe(false);
  });

  it('ignores an old replacement result after binding a different document', async () => {
    fb.open('word');
    let finish;
    ui.search.replace = () => new Promise((resolve) => { finish = resolve; });
    fb.el.querySelector('.btn-sm').click();
    fb.bind(fakeUi());
    fb.open('new');
    finish({ ok: false, reason: 'document-readonly' });
    await Promise.resolve();
    expect(fb.el.querySelector('.find-count').textContent).toBe('1 of 3');
  });

  it('toggles case sensitivity and closes back to the editor', () => {
    fb.open();
    fb.el.querySelector('[aria-label="Match case"]').click();
    expect(fb.el.querySelector('[aria-label="Match case"]').getAttribute('aria-pressed')).toBe('true');
    fb.close();
    expect(fb.el.hidden).toBe(true);
    expect(ui.searchCalls.at(-1)).toEqual(['close']);
    expect(focused).toBe(1);
  });

  it('cancels a pending search when closed and searches the retained query when reopened', () => {
    fb.open();
    const query = fb.el.querySelector('input[type="search"]');
    query.value = 'last query';
    query.dispatchEvent(new Event('input'));
    fb.close();
    vi.advanceTimersByTime(150);
    expect(ui.searchCalls.map((call) => call[0])).toEqual(['open', 'close']);
    expect(fb.el.querySelector('.find-count').textContent).toBe('');
    fb.open();
    expect(ui.searchCalls.at(-1)).toEqual(['search', 'last query', { caseSensitive: false, regex: false }]);
  });

  it('does not carry a pending search into a different bound document', () => {
    fb.open();
    const query = fb.el.querySelector('input[type="search"]');
    query.value = 'old document';
    query.dispatchEvent(new Event('input'));
    const nextUi = fakeUi();
    fb.bind(nextUi);
    vi.advanceTimersByTime(150);
    expect(nextUi.searchCalls).toEqual([]);
  });
});

describe('regular expressions', () => {
  it('knows a valid pattern from a broken one', () => {
    expect(validPattern('w.rld')).toBe(true);
    expect(validPattern('\\bword\\b')).toBe(true);
    expect(validPattern('(unclosed')).toBe(false);
    // The engine compiles without the u flag, so what it accepts, the bar accepts too.
    expect(validPattern('a\\-b')).toBe(true);
    expect(validPattern('\\_')).toBe(true);
  });

  it('passes the regex flag to the engine and flags an invalid pattern without searching', () => {
    const ui = fakeUi();
    const bar = createFindbar();
    bar.bind(ui);
    bar.open();
    const regexBtn = bar.el.querySelector('.find-regex');
    const query = bar.el.querySelector('input[type="search"]');
    regexBtn.click();
    expect(regexBtn.getAttribute('aria-pressed')).toBe('true');
    query.value = 'w.rld';
    query.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(200);
    expect(ui.searchCalls.at(-1)).toEqual(['search', 'w.rld', { caseSensitive: false, regex: true }]);
    query.value = '(oops';
    query.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(200);
    expect(ui.searchCalls.at(-1)[0]).toBe('clear');
    expect(bar.el.querySelector('.find-count').textContent).toBe('Invalid pattern');
  });

  it('reports a pattern the engine itself refused instead of "No matches"', () => {
    const ui = fakeUi();
    const bar = createFindbar();
    bar.bind(ui);
    bar.open();
    ui.search.set({ query: 'a\\-b', total: 0, activeIndex: -1, reason: 'search-invalid-pattern' });
    expect(bar.el.querySelector('.find-count').textContent).toBe('Invalid pattern');
    ui.search.set({ query: 'zzz', total: 0, activeIndex: -1, reason: undefined });
    expect(bar.el.querySelector('.find-count').textContent).toBe('No matches');
  });
});
