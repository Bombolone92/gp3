import { describe, it, expect, beforeEach } from 'vitest';
import { bootAppWithFeatures } from './helpers.js';
import { createText } from '../src/model/nodes.js';
import { applyRunStyle, styleAt } from '../src/model/text-runs.js';
import { smartEdits, smartPunctuateNode, applySmartPunctuation } from '../src/features/type/smart-punctuation.js';

const ALL = { quotes: true, dashes: true, ellipses: true, fractions: true, spaces: true, ligatures: false };

function apply(text, opts = ALL) {
  const { patch } = smartPunctuateNode(createText(text, 0, 0), opts);
  return patch ? patch.text : text;
}

describe('smart punctuation transform', () => {
  it('curls double and single quotes and apostrophes', () => {
    expect(apply('"Hello," she said. \'Yes.\'')).toBe('\u201cHello,\u201d she said. \u2018Yes.\u2019');
    expect(apply("It's the dogs' toys")).toBe('It\u2019s the dogs\u2019 toys');
    expect(apply("back in the '90s")).toBe('back in the \u201990s');
    expect(apply('("quoted")')).toBe('(\u201cquoted\u201d)');
    expect(apply('He said "no"\nand "yes"')).toBe('He said \u201cno\u201d\nand \u201cyes\u201d');
  });

  it('makes dashes, ellipses and single spaces after sentences', () => {
    expect(apply('pages 4--9 --- or not')).toBe('pages 4\u20139 \u2014 or not');
    expect(apply('Wait... what....')).toBe('Wait\u2026 what....');
    expect(apply('End.  Next!   Then "it."  Done')).toBe('End. Next! Then \u201cit.\u201d Done');
    expect(apply('a ---- b')).toBe('a ---- b');
  });

  it('replaces common fractions with fraction characters and leaves dates alone', () => {
    expect(apply('add 1/2 cup and 3/4 tsp')).toBe('add \u00bd cup and \u00be tsp');
    expect(apply('on 12/25/2024')).toBe('on 12/25/2024');
    expect(apply('1/2', { fractions: false })).toBe('1/2');
  });

  it('marks other fractions with the fractions feature', () => {
    const node = createText('use 5/16 inch', 0, 0);
    const edits = smartEdits(node.text, { ...ALL, quotes: false });
    expect(edits).toEqual([{ start: 4, end: 8, insert: null, kind: 'fractions', attr: true }]);
    const { patch, counts } = smartPunctuateNode(node, ALL);
    expect(patch.text).toBe('use 5/16 inch');
    expect(counts.fractions).toBe(1);
    const n2 = { ...node, ...patch };
    expect(styleAt(n2, 5).fractions).toBe(true);
    expect(styleAt(n2, 0).fractions).toBe(false);
  });

  it('makes ligature characters only when asked', () => {
    expect(apply('office flow', ALL)).toBe('office flow');
    expect(apply('office flow affluent', { ...ALL, ligatures: true })).toBe('o\ufb03ce \ufb02ow a\ufb04uent');
  });

  it('keeps character styles with their characters', () => {
    const t = createText('say "bold" -- ok', 0, 0);
    const node = { ...t, runs: applyRunStyle(t, 5, 9, { fontWeight: 700 }) };
    const { patch, counts } = smartPunctuateNode(node, ALL);
    const n2 = { ...node, ...patch };
    expect(n2.text).toBe('say \u201cbold\u201d \u2013 ok');
    expect(styleAt(n2, 4).fontWeight).toBe(400);
    expect(styleAt(n2, 5).fontWeight).toBe(700);
    expect(styleAt(n2, 8).fontWeight).toBe(700);
    expect(styleAt(n2, 9).fontWeight).toBe(400);
    expect(counts).toEqual({ quotes: 2, dashes: 1 });
  });
});

describe('Smart Punctuation command', () => {
  let app;
  beforeEach(async () => {
    app = await bootAppWithFeatures();
    app.newDocument();
  });

  const add = (text) => {
    const t = createText(text, 100, 100);
    app.editor.doc.transact('Add', () => app.editor.doc.insert(t, app.editor.targetLayer().id));
    return t.id;
  };

  it('applies to the whole document as one undo step and reports counts', () => {
    const a = add('"one" -- two...');
    const b = add("it's 1/2");
    const counts = applySmartPunctuation(app, ALL, 'document');
    expect(app.editor.doc.get(a).text).toBe('\u201cone\u201d \u2013 two\u2026');
    expect(app.editor.doc.get(b).text).toBe('it\u2019s \u00bd');
    expect(counts).toEqual({ quotes: 3, dashes: 1, ellipses: 1, fractions: 1 });
    app.editor.doc.undo();
    expect(app.editor.doc.get(a).text).toBe('"one" -- two...');
    expect(app.editor.doc.get(b).text).toBe("it's 1/2");
  });

  it('applies only to the selected characters while editing', () => {
    const a = add('"a" "b"');
    app.setTool('type');
    const s = app.getTool('type').editText(a, null);
    s.setSelection(4, 7);
    applySmartPunctuation(app, ALL, 'selection');
    expect(app.editor.doc.get(a).text).toBe('"a" \u201cb\u201d');
  });

  it('opens a dialog with the options and a report', async () => {
    add('"x"');
    const done = app.commands.run('type.smartPunctuation');
    await new Promise((r) => setTimeout(r, 0));
    const dlg = document.querySelector('dialog');
    expect(dlg.textContent).toMatch(/Smart quotes/);
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'OK').click();
    await new Promise((r) => setTimeout(r, 0));
    const report = document.querySelector('dialog .punct-report');
    expect(report.textContent).toMatch(/2 replacements/);
    [...document.querySelector('dialog').querySelectorAll('button')].find((b) => b.textContent === 'OK').click();
    await done;
  });
});
