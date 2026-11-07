// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { pageRule, pageRulesFor, pageSizeOf, isPainted, allPagesPainted, capturePages, printPages } from '../src/lib/print.js';

const page = (content, { kids = 1, width = '816px', height = '1056px' } = {}) => {
  const p = document.createElement('div');
  p.className = 'document-page';
  p.dataset.v2PageContent = content;
  p.style.width = width;
  p.style.height = height;
  for (let i = 0; i < kids; i++) p.append(document.createElement('span'));
  return p;
};

describe('print failure recovery', () => {
  let host;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    host = document.createElement('div');
    const scroller = document.createElement('div');
    scroller.className = 'document-scroller';
    scroller.append(page('filled')); host.append(scroller);
    document.body.append(host);
  });
  afterEach(() => {
    vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
    document.body.replaceChildren(); document.body.classList.remove('printing');
    delete document.fonts;
  });

  it.each(['page painting', 'images', 'fonts', 'print timer'])('cancels during %s and removes temporary print content', async (step) => {
    vi.spyOn(window, 'print').mockImplementation(() => window.dispatchEvent(new Event('afterprint')));
    const controller = new AbortController();
    if (step === 'page painting') {
      host.querySelector('.document-page').dataset.v2PageContent = 'shell';
      host.querySelector('.document-page').replaceChildren();
    }
    if (step === 'images') {
      const image = document.createElement('img');
      image.src = 'https://example.com/pending.png';
      host.querySelector('.document-page').append(image);
    }
    if (step === 'fonts') Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise(() => {}) } });
    const settled = vi.fn();
    printPages({ host, signal: controller.signal }).then(settled);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(window.print).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledWith(false);
    expect(document.querySelector('.print-stage, #print-page-rule')).toBeNull();
    expect(document.body.classList.contains('printing')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a native print failure so the editor can offer its fallback', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => { throw new Error('Printing unavailable'); });
    const result = printPages({ host });
    await vi.advanceTimersByTimeAsync(80);
    expect(await result).toBe(false);
    expect(document.querySelector('.print-stage, #print-page-rule')).toBeNull();
    expect(document.body.classList.contains('printing')).toBe(false);
  });

  it('removes temporary print content if preparation fails', async () => {
    await expect(printPages({ host, onReady: () => { throw new Error('Preparation failed'); } })).rejects.toThrow('Preparation failed');
    expect(document.querySelector('.print-stage, #print-page-rule')).toBeNull();
    expect(document.body.classList.contains('printing')).toBe(false);
  });

  it('clears the watchdog after the browser finishes printing', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => window.dispatchEvent(new Event('afterprint')));
    const result = printPages({ host });
    await vi.advanceTimersByTimeAsync(80);
    expect(await result).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('pageRule', () => {
  it('sizes the sheet to the page in inches with no printer margin', () => {
    expect(pageRule(8.5, 11)).toBe('@page { size: 8.5in 11in; margin: 0; }');
    expect(pageRule(8.2677, 11.6929)).toBe('@page { size: 8.268in 11.693in; margin: 0; }');
  });

  it('falls back to Letter for missing or bad sizes', () => {
    expect(pageRule(undefined, undefined)).toBe('@page { size: 8.5in 11in; margin: 0; }');
    expect(pageRule(0, -1)).toBe('@page { size: 8.5in 11in; margin: 0; }');
    expect(pageRule(NaN, 14)).toBe('@page { size: 8.5in 14in; margin: 0; }');
  });
});

describe('pageSizeOf', () => {
  it('reads the paper size from the painted page at 96 px per inch', () => {
    expect(pageSizeOf(page('filled'))).toEqual({ width: 8.5, height: 11 });
    expect(pageSizeOf(page('filled', { width: '1056px', height: '816px' }))).toEqual({ width: 11, height: 8.5 });
    expect(pageSizeOf(page('filled', { width: '', height: '' }))).toBeNull();
    expect(pageSizeOf(null)).toBeNull();
  });
});

describe('isPainted / allPagesPainted', () => {
  it('treats shells and empty pages as unpainted', () => {
    expect(isPainted(page('shell', { kids: 0 }))).toBe(false);
    expect(isPainted(page('filled', { kids: 0 }))).toBe(false);
    expect(isPainted(page('filled'))).toBe(true);
    expect(allPagesPainted([])).toBe(false);
    expect(allPagesPainted(null)).toBe(false);
    expect(allPagesPainted([page('filled'), page('shell', { kids: 0 })])).toBe(false);
    expect(allPagesPainted([page('filled'), page('filled', { kids: 3 })])).toBe(true);
  });
});

describe('capturePages', () => {
  /** A host whose scroll box paints pages when scrolled to them, like the engine. */
  const fakeHost = (n, { paintOnScroll = true } = {}) => {
    const host = document.createElement('div');
    const scroller = document.createElement('div');
    scroller.className = 'document-scroller';
    host.append(scroller);
    const pages = [];
    for (let i = 0; i < n; i++) {
      const p = page(i === 0 ? 'filled' : 'shell', { kids: i === 0 ? 1 : 0 });
      if (i === 0) p.firstChild.textContent = 'page 1';
      p.getBoundingClientRect = () => ({ top: i * 1080 - scroller.scrollTop });
      pages.push(p);
      scroller.append(p);
    }
    scroller.getBoundingClientRect = () => ({ top: 0 });
    let scrollTop = 0;
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => scrollTop,
      set: (v) => {
        scrollTop = v;
        if (!paintOnScroll) return;
        // Paint the page at the top of the scroll box shortly after.
        const i = Math.round(v / 1080);
        setTimeout(() => { if (pages[i]) { pages[i].dataset.v2PageContent = 'filled'; pages[i].replaceChildren(Object.assign(document.createElement('span'), { textContent: `page ${i + 1}` })); } }, 10);
      },
    });
    return { host, scroller, pages };
  };

  it('copies every page in order and restores the scroll position', async () => {
    const { host, scroller } = fakeHost(4);
    scroller.scrollTop = 0;
    const into = document.createElement('div');
    expect(await capturePages(host, into)).toBe(true);
    expect([...into.children].map((c) => c.textContent)).toEqual(['page 1', 'page 2', 'page 3', 'page 4']);
    expect(into.children[0].className).toBe('document-page');
    expect(scroller.scrollTop).toBe(0);
  });

  it('gives up when a page never paints', async () => {
    const { host } = fakeHost(3, { paintOnScroll: false });
    const into = document.createElement('div');
    expect(await capturePages(host, into, { pageTimeout: 60 })).toBe(false);
    expect(into.children.length).toBe(0);
  });

  it('needs the engine scroll box and at least one page', async () => {
    const empty = document.createElement('div');
    expect(await capturePages(empty, document.createElement('div'))).toBe(false);
  });
});

describe('page rules for mixed paper sizes', () => {
  it('gives each distinct sheet size its own page rule and assigns the sheets to them', () => {
    const sheets = [page('filled'), page('filled', { width: '1056px', height: '816px' }), page('filled'), page('filled', { width: '1056px', height: '816px' })];
    const css = pageRulesFor(sheets, { width: 8.5, height: 11 });
    expect(css).toBe('@page { size: 8.5in 11in; margin: 0; }\n@page document-page-1 { size: 11in 8.5in; margin: 0; }');
    expect(sheets.map((s) => s.style.page)).toEqual(['', 'document-page-1', '', 'document-page-1']);
    // One size: the plain rule as before.
    expect(pageRulesFor([page('filled')], { width: 8.5, height: 11 })).toBe('@page { size: 8.5in 11in; margin: 0; }');
    expect(pageRulesFor([], { width: 8.27, height: 11.69 })).toBe('@page { size: 8.27in 11.69in; margin: 0; }');
  });
});
