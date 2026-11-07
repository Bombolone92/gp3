// @vitest-environment jsdom
/**
 * Second adversarial review: people screens and the shared UI layer.
 * Each test names the issue it guards.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { bootViews, go, type, app, tick } from './review2-people-harness.js';

let main;
beforeAll(async () => {
  main = await bootViews();
});

describe('live regions keep focus', () => {
  it('typing in the children search keeps focus in the search box', async () => {
    await go('#/children');
    const input = main.querySelector('input[type=search]');
    input.focus();
    await type(input, 'a');
    const now = main.querySelector('input[type=search]');
    expect(now.value).toBe('a');
    expect(document.activeElement).toBe(now);
  });

  it('a redraw from another device keeps focus in the families search', async () => {
    await go('#/families');
    const input = main.querySelector('input[type=search]');
    input.focus();
    const g = app.store.all('guardians')[0];
    app.store.patch('guardians', g.id, { phone: '555-0100' });
    await tick(30);
    expect(document.activeElement).toBe(main.querySelector('input[type=search]'));
  });

  it('arrow keys on the room tabs keep focus on the newly selected tab', async () => {
    const room = app.store.all('rooms')[0];
    await go(`#/rooms/${room.id}`);
    main.querySelector('[role=tab][aria-selected=true]').focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await tick(30);
    expect(document.activeElement.getAttribute('role')).toBe('tab');
    expect(document.activeElement.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement.textContent).toMatch(/^Staff/);
  });

  it('arrow keys on the child page tabs keep focus on the newly selected tab', async () => {
    const s = app.store.all('students').find((x) => x.status === 'active');
    await go(`#/children/${s.id}`);
    main.querySelector('[role=tab][aria-selected=true]').focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await tick(30);
    expect(document.activeElement.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement.textContent).toBe('Daily report');
  });

  it('the daily report Previous day button keeps focus after moving a day', async () => {
    const s = app.store.all('students').find((x) => x.status === 'active');
    await go(`#/children/${s.id}?tab=report`);
    await tick(30);
    main.querySelector('[aria-label="Previous day"]').click();
    main.querySelector('[aria-label="Previous day"]').focus();
    main.querySelector('[aria-label="Previous day"]').click();
    await tick(30);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Previous day');
  });

  it('arrow keys on the Messages tabs keep focus on the newly selected tab', async () => {
    await go('#/messages');
    main.querySelector('[role=tab][aria-selected=true]').focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await tick(30);
    expect(document.activeElement.textContent).toBe('Announcements');
    expect(document.activeElement.getAttribute('aria-selected')).toBe('true');
  });
});

describe('forms', () => {
  it('double-clicking Add child adds one child and one family member', async () => {
    await go('#/children/new');
    const before = { kids: app.store.all('students').length, fam: app.store.all('guardians').length };
    const form = main.querySelector('form.form-page');
    const [first] = form.querySelectorAll('input.input');
    first.value = 'Zoe';
    first.dispatchEvent(new Event('input'));
    const famFirst = [...form.querySelectorAll('.card')].find((c) => c.textContent.includes('Family member')).querySelector('input.input');
    famFirst.value = 'Maya';
    famFirst.dispatchEvent(new Event('input'));
    const submit = form.querySelector('button[type=submit]');
    submit.click();
    submit.click();
    await tick(50);
    expect(app.store.all('students').length).toBe(before.kids + 1);
    expect(app.store.all('guardians').length).toBe(before.fam + 1);
  });
});

describe('tables', () => {
  it('choosing a room filter on Children keeps focus on the room select', async () => {
    await go('#/children');
    const sel = main.querySelector('select[aria-label=Room]');
    sel.focus();
    sel.value = sel.options[1].value;
    sel.dispatchEvent(new Event('change'));
    await tick(30);
    expect(document.activeElement).toBe(main.querySelector('select[aria-label=Room]'));
    expect(document.activeElement.value).toBe(sel.options[1].value);
  });

  it('table rows never put a link inside another link', async () => {
    for (const hash of ['#/children', '#/staff']) {
      await go(hash);
      expect(main.querySelectorAll('tbody a[href]').length).toBeGreaterThan(0);
      expect(main.querySelectorAll('a a, a button, button a').length).toBe(0);
    }
  });
});

describe('search palette', () => {
  it('with no results the input no longer points at a removed option', async () => {
    const { openSearch } = await import('../src/ui/search.js');
    openSearch();
    const input = document.querySelector('dialog.palette input');
    expect(document.getElementById(input.getAttribute('aria-activedescendant'))).not.toBeNull();
    input.value = 'zzqqxx';
    input.dispatchEvent(new Event('input'));
    await tick(100);
    const id = input.getAttribute('aria-activedescendant');
    expect(id === null || document.getElementById(id) !== null).toBe(true);
    document.querySelector('dialog.palette').remove();
  });
});
