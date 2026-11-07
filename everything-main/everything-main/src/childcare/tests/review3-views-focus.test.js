// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { setupApp, button, mountView } from './review2-billing-helpers.js';

describe('redrawing a screen never moves focus to another control', () => {
  it('Menus: "This week" does not leave focus on "Copy last week"', async () => {
    await setupApp({});
    const menus = await import('../src/views/menus.js');
    const node = mountView(menus, {}, { week: '2026-10-19' });
    const thisWeek = button('This week', node);
    thisWeek.focus();
    thisWeek.click();
    expect(node.querySelector('.month-label').textContent).toBe('Week of October 12');
    expect(document.activeElement).not.toBe(button('Copy last week', node));
  });
});
