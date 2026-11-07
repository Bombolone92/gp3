// @vitest-environment jsdom
import { describe, it, expect, vi, afterAll } from 'vitest';
import { PAPER_SIZES, VERTICAL_ALIGNMENTS, toUnit, fromUnit, matchPaper, buildPageSetup, openPageSetup } from '../src/ui/pagesetup.js';
import { closeAllModals } from '../src/ui/modal.js';

afterAll(async () => {
  closeAllModals();
  // Finish the modal's closing animation before JSDOM removes its document.
  await new Promise(resolve => setTimeout(resolve, 220));
});

describe('page setup helpers', () => {
  it('converts between inches and centimeters', () => {
    expect(toUnit(1, 'cm')).toBe(2.54);
    expect(toUnit(8.5, 'in')).toBe(8.5);
    expect(fromUnit('2.54', 'cm')).toBeCloseTo(1);
    expect(fromUnit('abc', 'in')).toBeNaN();
  });

  it('recognizes presets in either orientation', () => {
    expect(matchPaper(8.5, 11).id).toBe('letter');
    expect(matchPaper(11, 8.5).id).toBe('letter');
    expect(matchPaper(8.27, 11.69).id).toBe('a4');
    expect(matchPaper(7, 7)).toBeNull();
    expect(PAPER_SIZES.every((p) => p.width < p.height)).toBe(true);
  });

  it('builds section settings in inches, swapping for landscape', () => {
    const m = { top: '1', bottom: '1', left: '0.75', right: '0.75' };
    expect(buildPageSetup({ paper: 'a4', orientation: 'landscape', margins: m, unit: 'in' })).toEqual({
      pageSetup: { width: 11.69, height: 8.27, orientation: 'landscape' },
      margins: { top: 1, bottom: 1, left: 0.75, right: 0.75 },
    });
    const cm = buildPageSetup({ paper: 'custom', orientation: 'portrait', width: '20', height: '30', margins: { top: '2.54', bottom: '2.54', left: '2.54', right: '2.54' }, unit: 'cm' });
    expect(cm.pageSetup).toEqual({ width: 7.874, height: 11.811, orientation: 'portrait' });
    expect(cm.margins.top).toBe(1);
  });

  it('keeps a page already of the chosen size exactly as the document has it, and margins to the twip', () => {
    // A4 in existing documents is 11906 by 16838 twips; the preset's rounded inches would rewrite it by a few twips on every Apply.
    const width = 11906 / 1440, height = 16838 / 1440, cm2 = 1134 / 1440;
    const built = buildPageSetup({ paper: 'a4', orientation: 'portrait', width, height, margins: { top: cm2, bottom: cm2, left: cm2, right: cm2 }, unit: 'in' });
    expect(built.pageSetup).toEqual({ width, height, orientation: 'portrait' });
    expect(built.margins).toEqual({ top: cm2, bottom: cm2, left: cm2, right: cm2 });
    // Turned to landscape it keeps the same exact edges, swapped.
    expect(buildPageSetup({ paper: 'a4', orientation: 'landscape', width, height, margins: { top: 1, bottom: 1, left: 1, right: 1 }, unit: 'in' }).pageSetup).toEqual({ width: height, height: width, orientation: 'landscape' });
    // Another preset chosen for that page takes the preset's size.
    expect(buildPageSetup({ paper: 'letter', orientation: 'portrait', width, height, margins: { top: 1, bottom: 1, left: 1, right: 1 }, unit: 'in' }).pageSetup).toEqual({ width: 8.5, height: 11, orientation: 'portrait' });
    // A metric margin typed in centimeters goes in as converted, for the document to store to the twip.
    expect(buildPageSetup({ paper: 'letter', orientation: 'portrait', margins: { top: '2', bottom: '2', left: '2', right: '2' }, unit: 'cm' }).margins.top).toBe(2 / 2.54);
  });

  it('carries header and footer distances and the vertical alignment when given', () => {
    const m = { top: 1, bottom: 1, left: 1, right: 1 };
    const built = buildPageSetup({ paper: 'letter', orientation: 'portrait', margins: m, unit: 'in', headerDistance: '0.4', footerDistance: '0.6', verticalAlign: 'center' });
    expect(built.headerFooter).toEqual({ header: 0.4, footer: 0.6 });
    expect(built.verticalAlign).toBe('center');
    const cm = buildPageSetup({ paper: 'a4', orientation: 'portrait', margins: m, unit: 'cm', headerDistance: '2.54', footerDistance: '1.27', verticalAlign: 'both' });
    expect(cm.headerFooter).toEqual({ header: 1, footer: 0.5 });
    expect(typeof buildPageSetup({ paper: 'letter', orientation: 'portrait', margins: m, unit: 'in', headerDistance: '-1', footerDistance: '0.5' })).toBe('string');
    expect(typeof buildPageSetup({ paper: 'letter', orientation: 'portrait', margins: m, unit: 'in', headerDistance: '9', footerDistance: '0.5' })).toBe('string');
    expect(typeof buildPageSetup({ paper: 'letter', orientation: 'portrait', margins: m, unit: 'in', verticalAlign: 'middle' })).toBe('string');
    expect(VERTICAL_ALIGNMENTS.map((a) => a.id)).toEqual(['top', 'center', 'bottom', 'both']);
  });

  it('rejects impossible sizes and margins with a message', () => {
    expect(typeof buildPageSetup({ paper: 'custom', orientation: 'portrait', width: '0.5', height: '11', margins: { top: 1, bottom: 1, left: 1, right: 1 }, unit: 'in' })).toBe('string');
    expect(typeof buildPageSetup({ paper: 'letter', orientation: 'portrait', margins: { top: '-1', bottom: 1, left: 1, right: 1 }, unit: 'in' })).toBe('string');
    expect(typeof buildPageSetup({ paper: 'letter', orientation: 'portrait', margins: { top: 1, bottom: 1, left: 4.5, right: 4.5 }, unit: 'in' })).toBe('string');
  });
});

describe('openPageSetup', () => {
  it('prefills from the current section and applies the edited values', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    window.matchMedia = () => ({ matches: true, addEventListener() {} });
    let applied = null;
    const p = openPageSetup({ current: { width: 8.5, height: 11, orientation: 'portrait', margins: { top: 1, bottom: 1, left: 1, right: 1 }, headerFooterMargins: { header: 0.5, footer: 0.5 }, verticalAlign: 'top' }, unit: 'in', onApply: async (v) => { applied = v; return null; } });
    const panel = document.querySelector('.modal-panel');
    expect(panel.querySelector('select').value).toBe('letter');
    expect(panel.querySelector('[aria-label="Header from the top edge"]').value).toBe('0.5');
    panel.querySelector('[aria-label="Left margin"]').value = '0.5';
    panel.querySelector('[aria-label="Footer from the bottom edge"]').value = '0.3';
    [...panel.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Landscape').click();
    [...panel.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Center').click();
    panel.querySelector('form').requestSubmit();
    const result = await p;
    expect(applied.pageSetup).toEqual({ width: 11, height: 8.5, orientation: 'landscape' });
    expect(applied.margins.left).toBe(0.5);
    expect(applied.headerFooter).toEqual({ header: 0.5, footer: 0.3 });
    expect(applied.verticalAlign).toBe('center');
    expect(result).toEqual(applied);
  });

  it('applies untouched measurements exactly, even when shown rounded in centimeters', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    window.matchMedia = () => ({ matches: true, addEventListener() {} });
    let applied = null;
    const p = openPageSetup({ current: { width: 8.5, height: 11, orientation: 'portrait', margins: { top: 0.75, bottom: 1.25, left: 0.625, right: 1 }, headerFooterMargins: { header: 0.5, footer: 0.375 } }, unit: 'cm', onApply: async (v) => { applied = v; return null; } });
    const panel = document.querySelector('.modal-panel');
    // 0.75 in reads as 1.91 cm; converting that back would give 0.752 in.
    expect(panel.querySelector('[aria-label="Top margin"]').value).toBe('1.91');
    // Switching units and back keeps the exact values too.
    [...panel.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Inches').click();
    expect(panel.querySelector('[aria-label="Left margin"]').value).toBe('0.63');
    [...panel.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Centimeters').click();
    expect(panel.querySelector('[aria-label="Left margin"]').value).toBe('1.59');
    // An edited field is taken as typed, in the unit shown.
    const right = panel.querySelector('[aria-label="Right margin"]');
    right.value = '2';
    right.dispatchEvent(new Event('input'));
    panel.querySelector('form').requestSubmit();
    await p;
    expect(applied.margins).toEqual({ top: 0.75, bottom: 1.25, left: 0.625, right: 2 / 2.54 });
    expect(applied.headerFooter).toEqual({ header: 0.5, footer: 0.375 });
  });

  it('keeps a custom size and the orientation in step', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    window.matchMedia = () => ({ matches: true, addEventListener() {} });
    let applied = null;
    const p = openPageSetup({ current: { width: 8.5, height: 11, orientation: 'portrait', margins: { top: 1, bottom: 1, left: 1, right: 1 } }, unit: 'in', onApply: async (v) => { applied = v; return null; } });
    const panel = document.querySelector('.modal-panel');
    const radio = (text) => [...panel.querySelectorAll('[role="radio"]')].find((b) => b.textContent === text);
    const paper = panel.querySelector('select');
    paper.value = 'custom';
    paper.dispatchEvent(new Event('change'));
    const width = panel.querySelector('[aria-label="Page width"]');
    const height = panel.querySelector('[aria-label="Page height"]');
    // Typing a wide page turns the choice to Landscape.
    width.value = '11'; width.dispatchEvent(new Event('input'));
    height.value = '8.5'; height.dispatchEvent(new Event('input'));
    expect(radio('Landscape').getAttribute('aria-checked')).toBe('true');
    // Choosing Portrait again swaps the fields instead of ignoring them.
    radio('Portrait').click();
    expect([width.value, height.value]).toEqual(['8.5', '11']);
    radio('Landscape').click();
    expect([width.value, height.value]).toEqual(['11', '8.5']);
    panel.querySelector('form').requestSubmit();
    await p;
    expect(applied.pageSetup).toEqual({ width: 11, height: 8.5, orientation: 'landscape' });
  });
});

describe('page setup fields and assistive technology', () => {
  it('describe each measurement field by the unit shown beside it, following the unit switch', async () => {
    const { closeAllModals } = await import('../src/ui/modal.js');
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
    openPageSetup({ current: { width: 8.5, height: 11, orientation: 'portrait', margins: { top: 1, bottom: 1, left: 1, right: 1 } }, unit: 'in', onApply: async () => null });
    // Dialogs of earlier tests may still be closing: this one is the newest.
    const panel = [...document.querySelectorAll('.modal-root:not(.closing) .modal-panel')].at(-1);
    const left = panel.querySelector('[aria-label="Left margin"]');
    const describedBy = () => document.getElementById(left.getAttribute('aria-describedby'))?.textContent;
    expect(describedBy()).toBe('in');
    [...panel.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Centimeters').click();
    expect(describedBy()).toBe('cm');
    closeAllModals();
    vi.unstubAllGlobals();
  });
});
