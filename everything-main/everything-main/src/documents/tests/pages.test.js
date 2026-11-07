// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parsePageNumber, pageElement, scrollToPage } from '../src/lib/pages.js';

const fakeHost = (n) => {
  const host = document.createElement('div');
  const scroller = document.createElement('div');
  scroller.className = 'document-scroller';
  scroller.getBoundingClientRect = () => ({ top: 100 });
  let scrollTop = 0;
  Object.defineProperty(scroller, 'scrollTop', { get: () => scrollTop, set: (v) => { scrollTop = v; } });
  scroller.scrollTo = ({ top }) => { scrollTop = top; };
  for (let i = 1; i <= n; i++) {
    const p = document.createElement('div');
    p.className = 'document-page';
    p.dataset.pageNumber = String(i);
    p.getBoundingClientRect = () => ({ top: 100 + (i - 1) * 1080 - scrollTop });
    scroller.append(p);
  }
  host.append(scroller);
  return { host, scroller };
};

describe('parsePageNumber', () => {
  it('accepts whole numbers within the document', () => {
    expect(parsePageNumber('3', 5)).toBe(3);
    expect(parsePageNumber(' 5 ', 5)).toBe(5);
    expect(parsePageNumber('1')).toBe(1);
  });

  it('rejects nonsense and pages past the end', () => {
    expect(parsePageNumber('0', 5)).toBeNull();
    expect(parsePageNumber('6', 5)).toBeNull();
    expect(parsePageNumber('abc', 5)).toBeNull();
    expect(parsePageNumber('', 5)).toBeNull();
    expect(parsePageNumber(null, 5)).toBeNull();
  });
});

describe('pageElement / scrollToPage', () => {
  it('finds pages by number and scrolls the engine box to them', () => {
    const { host, scroller } = fakeHost(4);
    expect(pageElement(host, 3)?.dataset.pageNumber).toBe('3');
    expect(pageElement(host, 9)).toBeNull();
    expect(scrollToPage(host, 3)).toBe(true);
    expect(scroller.scrollTop).toBe(2 * 1080 - 12);
    expect(scrollToPage(host, 1)).toBe(true);
    expect(scroller.scrollTop).toBe(0);
  });

  it('reports when there is nothing to scroll to', () => {
    const { host } = fakeHost(2);
    expect(scrollToPage(host, 7)).toBe(false);
    expect(scrollToPage(null, 1)).toBe(false);
    expect(scrollToPage(document.createElement('div'), 1)).toBe(false);
  });
});
