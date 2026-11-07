/**
 * The conversation side (review pass 21, lead): stylesheet rules read from
 * the source where a layout defect has no DOM to drive in node.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = () => readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');

describe('the thread panel reads from its first message down', () => {
  it('keeps the root at the top of the panel rather than pushed onto the reply box under a panel of nothing', () => {
    const s = css();
    // The conversation's list still sits at the foot of its column...
    expect(s).toMatch(/\.msg-list \{[^}]*margin-top: auto;[^}]*\}/);
    // ...and the thread panel's list, inside .panel-body, starts at the top.
    const rule = s.match(/\.panel-body \.msg-list \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/margin-top: 0;/);
    // Written after the general rule, so it wins at equal specificity or better.
    expect(s.indexOf('.panel-body .msg-list {')).toBeGreaterThan(s.indexOf('.msg-list { display: flex;'));
  });
});

describe('Home and End in a menu', () => {
  it('go to the first and last item, as the ARIA menu pattern has them, where only the arrows walked and wrapped before', async () => {
    const { installDom } = await import('./helpers/dom.js');
    const dom = installDom({ hash: '', width: 1280, height: 800 });
    const { vi } = await import('vitest');
    vi.resetModules();
    const { openMenu, pointAnchor, closeMenu } = await import('../src/ui/menu.js');
    const pop = openMenu(pointAnchor(300, 300), [
      { label: 'First', onSelect() {} },
      { label: 'Second', onSelect() {} },
      { label: 'Third', onSelect() {} },
    ]);
    await dom.tick(1);
    const items = [...pop.node.querySelectorAll('[role="menuitem"]')];
    expect(items.map((n) => n.textContent.trim())).toEqual(['First', 'Second', 'Third']);
    items[1].focus();
    const end = dom.key(document.activeElement, 'End');
    expect(document.activeElement).toBe(items[2]);
    expect(end.defaultPrevented).toBe(true);
    const home = dom.key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(items[0]);
    expect(home.defaultPrevented).toBe(true);
    // The arrows still wrap at the ends.
    dom.key(document.activeElement, 'ArrowUp');
    expect(document.activeElement).toBe(items[2]);
    closeMenu();
    await dom.tick(5);
    dom.uninstall();
  });
});
