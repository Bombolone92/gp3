// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mostVisible, marginPoint, openHeaderFooter, inHeaderFooter, PAGE_SELECTOR } from '../src/lib/headerfooter.js';

const rect = (top, bottom, left = 0, right = 100) => ({ top, bottom, left, right, width: right - left, height: bottom - top });

describe('mostVisible', () => {
  it('picks the page with the most overlap, earlier pages winning ties', () => {
    const view = rect(100, 500);
    expect(mostVisible([rect(0, 300), rect(320, 620), rect(640, 940)], view)).toBe(0);
    expect(mostVisible([rect(-500, -200), rect(-190, 110), rect(120, 420)], view)).toBe(2);
    expect(mostVisible([rect(0, 300), rect(300, 600)], rect(0, 600))).toBe(0);
  });

  it('returns -1 when no page is on screen', () => {
    expect(mostVisible([rect(600, 900)], rect(0, 500))).toBe(-1);
    expect(mostVisible([], rect(0, 500))).toBe(-1);
  });
});

describe('marginPoint', () => {
  it('lands mid-band at the top for headers and the bottom for footers', () => {
    const page = rect(100, 1156, 200, 1016);
    expect(marginPoint(page, 'header', 48)).toEqual({ x: 608, y: 124 });
    expect(marginPoint(page, 'footer', 48)).toEqual({ x: 608, y: 1132 });
  });

  it('stays on the page for tiny or huge margins', () => {
    const page = rect(0, 400, 0, 300);
    expect(marginPoint(page, 'header', 0).y).toBe(4);
    expect(marginPoint(page, 'footer', 10000).y).toBe(300);
  });
});

describe('openHeaderFooter', () => {
  it('double-clicks the header band of the page and reports the engine session', async () => {
    const host = document.createElement('div');
    const page = document.createElement('div');
    page.className = PAGE_SELECTOR.slice(1);
    host.append(page);
    document.body.append(host);
    host.getBoundingClientRect = () => rect(0, 800, 0, 1000);
    page.getBoundingClientRect = () => rect(20, 780, 100, 900);
    document.elementFromPoint = () => page;
    const seen = [];
    page.addEventListener('dblclick', (e) => {
      seen.push([e.clientX, e.clientY, e.detail]);
      const exit = document.createElement('button');
      exit.className = 'v2-hf-exit';
      host.append(exit);
    });
    expect(inHeaderFooter(host)).toBe(false);
    expect(await openHeaderFooter(host, 'header', { marginIn: 0.5, zoom: 100 })).toBe(true);
    expect(seen).toEqual([[500, 44, 2]]);
    expect(inHeaderFooter(host)).toBe(true);
    host.remove();
  });

  it('reports failure when there is no page or the engine does not respond', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    expect(await openHeaderFooter(host, 'footer')).toBe(false);
    const page = document.createElement('div');
    page.className = 'document-page';
    host.append(page);
    host.getBoundingClientRect = () => rect(0, 800, 0, 1000);
    page.getBoundingClientRect = () => rect(20, 780, 100, 900);
    document.elementFromPoint = () => page;
    expect(await openHeaderFooter(host, 'footer')).toBe(false);
    host.remove();
  });
});
