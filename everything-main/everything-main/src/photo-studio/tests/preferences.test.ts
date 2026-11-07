import { describe, expect, it } from 'vitest';
import {
  canvasColorValue,
  checkerColors,
  coerceSetting,
  defaultPreferences,
  exportPreferences,
  gridSpacingPx,
  importPreferences,
  loadPreferences,
  migratePreferences,
  PAGES,
  PREFERENCES_VERSION,
  searchSettings,
  SETTINGS,
  settingFor,
  STORED,
  validatePreferences,
} from '../src/model/preferences';
import { History } from '../src/history/history';
import { newDocument } from '../src/model/document';
import { curlQuotes } from '../src/imaging/text/quotes';
import { glyphRuns } from '../src/imaging/text/glyph-runs';
import { localizedFamilyName } from '../src/imaging/text/font-names';

describe('preferences schema', () => {
  it('has a page for every setting and unique stored definitions', () => {
    const pages = new Set(PAGES.map((p) => p.id));
    for (const s of SETTINGS) expect(pages.has(s.page)).toBe(true);
    for (const p of PAGES) expect(SETTINGS.some((s) => s.page === p.id)).toBe(true);
    expect(new Set(STORED.map((s) => s.key)).size).toBe(STORED.length);
  });
  it('repeats a shared key with the same default on every page', () => {
    for (const s of SETTINGS) {
      if (!s.key) continue;
      const def = settingFor(s.key)!;
      expect(s.type).toBe(def.type);
      expect((s as { default: unknown }).default).toEqual((def as { default: unknown }).default);
    }
  });
  it('defaults are valid values', () => {
    const d = defaultPreferences() as Record<string, unknown>;
    for (const s of STORED) expect(coerceSetting(s, d[s.key])).toEqual(d[s.key]);
    expect(d.version).toBe(PREFERENCES_VERSION);
  });
});

describe('preferences validation', () => {
  it('clamps numbers, rejects unknown choices and bad colors', () => {
    const problems: string[] = [];
    const p = validatePreferences({ historyStates: 5000, recentCount: -3, theme: 'neon', guideColor: 'red', gridColor: '#ABCDEF', uiScale: '125', showRulers: false }, problems);
    expect(p.historyStates).toBe(1000);
    expect(p.recentCount).toBe(0);
    expect(p.theme).toBe('dark');
    expect(p.guideColor).toBe('#00c8ff');
    expect(p.gridColor).toBe('#abcdef');
    expect(p.uiScale).toBe(125);
    expect(p.showRulers).toBe(false);
    expect(problems.sort()).toEqual(['guideColor', 'theme']);
  });
  it('rounds integer settings and accepts custom canvas colors', () => {
    const p = validatePreferences({ gridSubdivisions: 3.6, canvasColorStandard: '#102030', canvasColorFull: 'purple' });
    expect(p.gridSubdivisions).toBe(4);
    expect(p.canvasColorStandard).toBe('#102030');
    expect(p.canvasColorFull).toBe('black');
  });
  it('keeps menu state and drops malformed state', () => {
    const p = validatePreferences({ snapTo: { guides: false, grid: true, layers: true, document: false }, windowLayout: '4-up', extras: ['grid', 3], dismissedWarnings: ['a', 1, 'b'] });
    expect(p.snapTo).toEqual({ guides: false, grid: true, layers: true, document: false });
    expect(p.windowLayout).toBe('4-up');
    expect(p.extras).toBeUndefined();
    expect(p.dismissedWarnings).toEqual(['a', 'b']);
    expect(validatePreferences({ windowLayout: 'mosaic' }).windowLayout).toBeUndefined();
  });
  it('treats non-objects as empty', () => {
    expect(validatePreferences(null)).toEqual(defaultPreferences());
    expect(validatePreferences([1, 2])).toEqual(defaultPreferences());
  });
});

describe('preferences migration', () => {
  it('moves version 1 grid spacing, theme and font preview size', () => {
    const raw = migratePreferences({ gridSize: 32, wheelZooms: true, historyStates: 80 }, { theme: 'light', fontPreview: 'huge' });
    expect(raw).toMatchObject({ gridEvery: 32, gridUnit: 'px', theme: 'light', fontPreviewSize: 'huge', version: PREFERENCES_VERSION });
    expect('gridSize' in raw).toBe(false);
    const p = validatePreferences(raw);
    expect(p.wheelZooms).toBe(true);
    expect(p.historyStates).toBe(80);
  });
  it('does not override values already in the current layout', () => {
    const raw = migratePreferences({ version: 2, theme: 'medium' }, { theme: 'light' });
    expect(raw.theme).toBe('medium');
  });
  it('loads stored text, tolerating garbage and honoring reset on launch', () => {
    expect(loadPreferences('{not json')).toEqual(defaultPreferences());
    expect(loadPreferences(null, { theme: 'light' }).theme).toBe('light');
    const stored = JSON.stringify({ ...defaultPreferences(), historyStates: 12, resetOnLaunch: true });
    const p = loadPreferences(stored);
    expect(p.historyStates).toBe(60);
    expect(p.resetOnLaunch).toBe(false);
  });
});

describe('preferences import and export', () => {
  it('round-trips listed settings only', () => {
    const p = { ...defaultPreferences(), guideColor: '#123456', showRulers: false, checkerSize: 'large' as const };
    const text = exportPreferences(p);
    const data = JSON.parse(text);
    expect(data.format).toBe('photo-studio-preferences');
    expect(data.preferences.showRulers).toBeUndefined();
    const { preferences, ignored } = importPreferences(text, defaultPreferences());
    expect(preferences.guideColor).toBe('#123456');
    expect(preferences.checkerSize).toBe('large');
    expect(preferences.showRulers).toBe(true);
    expect(ignored).toEqual([]);
  });
  it('reports unknown and invalid entries and keeps current values for them', () => {
    const current = { ...defaultPreferences(), theme: 'light' as const };
    const text = JSON.stringify({ format: 'photo-studio-preferences', version: 2, preferences: { theme: 'plaid', mystery: 1, historyStates: 20 } });
    const { preferences, ignored } = importPreferences(text, current);
    expect(preferences.theme).toBe('light');
    expect(preferences.historyStates).toBe(20);
    expect(ignored.sort()).toEqual(['mystery', 'theme']);
  });
  it('migrates imported version 1 files', () => {
    const text = JSON.stringify({ format: 'photo-studio-preferences', version: 1, preferences: { gridSize: 10 } });
    const { preferences } = importPreferences(text, defaultPreferences());
    expect(preferences.gridEvery).toBe(10);
  });
  it('rejects files that are not preferences', () => {
    expect(() => importPreferences('[]', defaultPreferences())).toThrow(/preferences/);
    expect(() => importPreferences('nope', defaultPreferences())).toThrow(/JSON/);
  });
});

describe('preference helpers', () => {
  it('searches labels, help, keywords and page names', () => {
    expect(searchSettings('checkerboard').map((s) => s.key)).toContain('checkerSize');
    expect(searchSettings('guide color').map((s) => s.key)).toEqual(expect.arrayContaining(['guideColor', 'smartGuideColor']));
    expect(searchSettings('cursors').every((s) => s.page === 'cursors')).toBe(true);
    expect(searchSettings('   ')).toEqual([]);
  });
  it('converts grid units to pixels', () => {
    expect(gridSpacingPx({ gridEvery: 1, gridUnit: 'in' }, 300, 1000)).toBe(300);
    expect(gridSpacingPx({ gridEvery: 25, gridUnit: 'percent' }, 72, 800)).toBe(200);
    expect(gridSpacingPx({ gridEvery: 0.01, gridUnit: 'px' }, 72, 800)).toBe(1);
  });
  it('resolves canvas and checkerboard colors', () => {
    expect(canvasColorValue('default')).toBe('');
    expect(canvasColorValue('black')).toBe('#000000');
    expect(canvasColorValue('#abcdef')).toBe('#abcdef');
    const base = defaultPreferences();
    expect(checkerColors(base)).toEqual(['#ffffff', '#cccccc']);
    expect(checkerColors({ ...base, checkerColors: 'custom', checkerCustomA: '#111111', checkerCustomB: '#222222' })).toEqual(['#111111', '#222222']);
    expect(checkerColors({ ...base, checkerSize: 'none' })).toEqual(['#ffffff', '#ffffff']);
  });
});

describe('history states', () => {
  const edit = (h: History, label: string, n: number) => h.execute(label, (d) => void (d.name = `${label}-${n}`));
  it('keeps at most `limit` edits', () => {
    const h = new History(newDocument(), 3);
    for (let i = 0; i < 5; i++) edit(h, 'Edit', i);
    expect(h.labels).toHaveLength(3);
    expect(h.oldest.name).toBe('Edit-1');
    h.limit = 1;
    h.trim();
    expect(h.labels).toHaveLength(1);
  });
  it('drops later states on a new edit in linear mode', () => {
    const h = new History(newDocument());
    edit(h, 'A', 1);
    edit(h, 'B', 2);
    h.undo();
    edit(h, 'C', 3);
    expect(h.labels).toEqual(['A', 'C']);
    expect(h.canRedo).toBe(false);
  });
  it('keeps later states and appends in non-linear mode', () => {
    const h = new History(newDocument());
    h.nonLinear = () => true;
    edit(h, 'A', 1);
    edit(h, 'B', 2);
    h.goto(1);
    expect(h.document.name).toBe('A-1');
    edit(h, 'C', 3);
    expect(h.labels).toEqual(['A', 'B', 'C']);
    // The new state follows from A, not from B.
    expect(h.document.name).toBe('C-3');
    h.undo();
    expect(h.document.name).toBe('B-2');
    h.goto(0);
    expect(h.redoLabels).toEqual(['A', 'B', 'C']);
  });
  it('coalesces repeated labels and drops a step that returns to its start', () => {
    const h = new History(newDocument());
    const name = h.document.name;
    h.execute('Frame', (d) => void (d.name = 'x'), true);
    h.execute('Frame', (d) => void (d.name = 'y'), true);
    expect(h.labels).toEqual(['Frame']);
    expect(h.document.name).toBe('y');
    h.execute('Frame', (d) => void (d.name = name), true);
    expect(h.labels).toEqual([]);
    expect(h.canUndo).toBe(false);
  });
});

describe('type preferences', () => {
  it('curls quotes by context', () => {
    expect(curlQuotes('"Hi," she said.', '')).toBe('“Hi,” she said.');
    expect(curlQuotes("'", 'don')).toBe('’');
    expect(curlQuotes("'", 'say ')).toBe('‘');
    expect(curlQuotes('"', '(')).toBe('“');
    expect(curlQuotes('abc', 'x')).toBe('abc');
  });
  it('splits text into runs a fallback font draws', () => {
    const latin = { family: 'Display', has: (cp: number) => cp < 0x80 };
    const wide = { family: 'Sans', has: (cp: number) => cp < 0x500 };
    expect(glyphRuns('Hi Жук!', latin, [latin, wide])).toEqual([
      ['Hi ', undefined],
      ['Жук', 'Sans'],
      ['!', undefined],
    ]);
    // Characters no font has stay with the base font; whitespace never switches.
    expect(glyphRuns('a一 b', latin, [latin, wide])).toEqual([['a一 b', undefined]]);
    expect(glyphRuns('abc', undefined, [wide])).toEqual([['abc', undefined]]);
  });
  it('reads localized family names from a name table', () => {
    const records: [number, number, number, number, string][] = [
      [3, 1, 0x409, 1, 'Mincho'],
      [3, 1, 0x411, 1, '明朝'],
      [3, 1, 0x804, 16, '宋体'],
      [3, 1, 0x404, 16, '新細明'],
    ];
    const strings = records.map((r) => r[4]);
    const bytes = strings.reduce((n, s) => n + s.length * 2, 0);
    const buf = new DataView(new ArrayBuffer(6 + records.length * 12 + bytes));
    buf.setUint16(2, records.length);
    buf.setUint16(4, 6 + records.length * 12);
    let off = 0;
    records.forEach(([platform, enc, lang, id, s], i) => {
      const o = 6 + i * 12;
      buf.setUint16(o, platform);
      buf.setUint16(o + 2, enc);
      buf.setUint16(o + 4, lang);
      buf.setUint16(o + 6, id);
      buf.setUint16(o + 8, s.length * 2);
      buf.setUint16(o + 10, off);
      for (let k = 0; k < s.length; k++) buf.setUint16(6 + records.length * 12 + off + k * 2, s.charCodeAt(k));
      off += s.length * 2;
    });
    expect(localizedFamilyName(buf, 'ja-JP')).toBe('明朝');
    expect(localizedFamilyName(buf, 'zh-CN')).toBe('宋体');
    expect(localizedFamilyName(buf, 'zh-TW')).toBe('新細明');
    expect(localizedFamilyName(buf, 'en-US')).toBeUndefined();
    expect(localizedFamilyName(buf, 'fr')).toBeUndefined();
  });
});
