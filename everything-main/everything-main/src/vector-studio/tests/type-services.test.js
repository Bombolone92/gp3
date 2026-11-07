import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bootAppWithFeatures } from './helpers.js';
import { resolveItems } from '../src/ui/menubar.js';
import { createText } from '../src/model/nodes.js';
import { applyRunStyle, styleAt } from '../src/model/text-runs.js';
import { lastFind, findNext } from '../src/features/type/find.js';
import { documentFonts, replaceFontPatch, changeFont, missingFonts, recentFonts } from '../src/features/type/font-tools.js';
import { pastePlainText } from '../src/features/type/text-tools-install.js';
import { setFontFamily } from '../src/features/type/commands.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('type text services', () => {
  let app;
  let doc;
  beforeEach(async () => {
    app = await bootAppWithFeatures();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    doc = app.editor.doc;
  });

  const add = (text, extra = {}, y = 100) => {
    const t = createText(text, 100, y, extra);
    doc.transact('Add', () => doc.insert(t, app.editor.targetLayer().id));
    return t.id;
  };
  const edit = (id) => {
    app.setTool('type');
    return app.getTool('type').editText(id, null);
  };

  it('Find Next repeats the last query across objects and wraps', async () => {
    const a = add('cat and cat');
    const b = add('a cat', {}, 200);
    Object.assign(lastFind, { query: 'cat', matchCase: false, wholeWord: true, current: null });
    expect(findNext(app)).toBe('found');
    expect(app.typeSession.id).toBe(a);
    expect(app.typeSession.range()).toEqual([0, 3]);
    await app.commands.run('edit.findNext');
    expect(app.typeSession.range()).toEqual([8, 11]);
    await app.commands.run('edit.findNext');
    expect(app.typeSession.id).toBe(b);
    expect(app.typeSession.range()).toEqual([2, 5]);
    await app.commands.run('edit.findNext');
    expect(app.typeSession.id).toBe(a);
    expect(app.typeSession.range()).toEqual([0, 3]);
    lastFind.query = 'dog';
    expect(findNext(app)).toBe('none');
    lastFind.query = '';
  });

  it('pastes our own copied characters with their formatting, and plainly on request', async () => {
    const t = createText('Hello world', 100, 100);
    const id = t.id;
    doc.transact('Add', () => doc.insert({ ...t, runs: applyRunStyle(t, 0, 5, { fontWeight: 700 }) }, app.editor.targetLayer().id));
    const target = add('X', {}, 200);
    let clip = '';
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (s) => (clip = s), readText: async () => clip } });
    try {
      const s = edit(id);
      s.setSelection(0, 5);
      await s.clipboardCopy(false);
      expect(clip).toBe('Hello');
      const s2 = edit(target);
      s2.setSelection(1, 1);
      app.commands.run('edit.paste');
      await tick();
      let n = doc.get(target);
      expect(n.text).toBe('XHello');
      expect(styleAt(n, 3).fontWeight).toBe(700);
      expect(styleAt(n, 0).fontWeight).toBe(400);
      app.commands.run('edit.pastePlain');
      await tick();
      n = doc.get(target);
      expect(n.text).toBe('XHelloHello');
      expect(styleAt(n, 8).fontWeight).toBe(700); // takes the insertion-point style (the bold before it)
      s2.setSelection(0, 0);
      app.commands.run('edit.pastePlain');
      await tick();
      n = doc.get(target);
      expect(n.text).toBe('HelloXHelloHello');
      expect(styleAt(n, 1).fontWeight).toBe(400);
      // Text copied elsewhere pastes plainly.
      clip = 'zz';
      s2.setSelection(0, 0);
      app.commands.run('edit.paste');
      await tick();
      expect(styleAt(doc.get(target), 0).fontWeight).toBe(400);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Paste Without Formatting outside type creates point type', () => {
    const id = pastePlainText(app, 'pasted');
    expect(doc.get(id).text).toBe('pasted');
    expect(app.editor.selection.has(id)).toBe(true);
    expect(app.commands.get('edit.pastePlain').shortcut).toBe('Alt+Mod+V');
  });

  it('inserts special, whitespace and break characters from the menus and shortcuts', () => {
    const id = add('ab');
    const items = (src) => resolveItems(app, app.menuSources.get(src)(app));
    expect(items('insertSpecial').every((g) => g.items.every((i) => i.type === 'sep' || i.enabled === false))).toBe(true);
    const s = edit(id);
    s.setSelection(1, 1);
    const symbols = items('insertSpecial').find((g) => g.label === 'Symbols').items;
    symbols.find((i) => i.label === 'Copyright Symbol').run(app);
    expect(doc.get(id).text).toBe('a\u00a9b');
    items('insertWhitespace').find((i) => i.label === 'Em Space').run(app);
    items('insertBreak').find((i) => i.label === 'Forced Line Break').run(app);
    expect(doc.get(id).text).toBe('a\u00a9\u2003\u2028b');
    // Shift+Mod+M types an em space while editing instead of opening Move.
    const mod = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
    const handled = s.handleKey(new KeyboardEvent('keydown', { key: 'M', code: 'KeyM', shiftKey: true, ...mod }), app.getTool('type').keyActions());
    expect(handled).toBe(true);
    expect(doc.get(id).text).toBe('a\u00a9\u2003\u2028\u2003b');
    expect(s.handleKey(new KeyboardEvent('keydown', { key: '_', code: 'Minus', shiftKey: true, ...mod }), app.getTool('type').keyActions())).toBe(true);
    expect(doc.get(id).text.includes('\u00ad')).toBe(true);
  });

  it('records recent fonts and offers them in the Recent Fonts menu', () => {
    const id = add('abc');
    app.editor.select([id]);
    setFontFamily(app, 'Lato');
    setFontFamily(app, 'Lora');
    setFontFamily(app, 'Lato');
    expect(recentFonts(app)).toEqual(['Lato', 'Lora']);
    const items = resolveItems(app, app.menuSources.get('recentFonts')(app));
    expect(items.map((i) => i.label)).toEqual(['Lato', 'Lora']);
    expect(items[0].checked).toBe(true);
    items[1].run(app);
    expect(doc.get(id).char.fontFamily).toBe('Lora');
  });

  it('lists, changes and selects document fonts, undoably', () => {
    const t = createText('Hello world', 100, 100);
    const a = t.id;
    doc.transact('Add', () => doc.insert({ ...t, runs: applyRunStyle(t, 6, 11, { fontFamily: 'Comic Gothic Pro', fontWeight: 700 }) }, app.editor.targetLayer().id));
    const b = add('Other', { char: { ...t.char, fontFamily: 'Lato' } }, 200);
    const fonts = documentFonts(doc);
    expect(fonts.map((f) => [f.family, f.weight, f.missing, f.objects.size])).toEqual([
      ['Comic Gothic Pro', 700, true, 1],
      ['Inter', 400, false, 1],
      ['Lato', 400, false, 1],
    ]);
    expect(missingFonts(doc).map((f) => f.family)).toEqual(['Comic Gothic Pro']);
    // Change within a range only.
    const p = replaceFontPatch(doc.get(a), 'Inter|400|normal', { fontFamily: 'Roboto', fontWeight: 400, fontStyle: 'normal' }, 0, 2);
    expect(styleAt({ ...doc.get(a), ...p }, 0).fontFamily).toBe('Roboto');
    expect(styleAt({ ...doc.get(a), ...p }, 3).fontFamily).toBe('Inter');
    // Change all: the missing bold font becomes Roboto Bold.
    const count = changeFont(doc, 'Comic Gothic Pro|700|normal', { fontFamily: 'Roboto', fontWeight: 700, fontStyle: 'normal' });
    expect(count).toBe(1);
    expect(styleAt(doc.get(a), 7)).toMatchObject({ fontFamily: 'Roboto', fontWeight: 700 });
    expect(styleAt(doc.get(a), 0).fontFamily).toBe('Inter');
    expect(missingFonts(doc)).toEqual([]);
    changeFont(doc, 'Lato|400|normal', { fontFamily: 'Lora', fontWeight: 400, fontStyle: 'normal' });
    expect(doc.get(b).char.fontFamily).toBe('Lora');
    doc.undo();
    doc.undo();
    expect(styleAt(doc.get(a), 7).fontFamily).toBe('Comic Gothic Pro');
    expect(doc.get(b).char.fontFamily).toBe('Lato');
  });

  it('Find Font dialog finds, changes all and selects', async () => {
    const a = add('one');
    const b = add('two', {}, 200);
    app.commands.run('type.findFont');
    await tick();
    const dlg = document.querySelector('dialog.find-font-dialog');
    const btn = (l) => [...dlg.querySelectorAll('button')].find((x) => x.textContent === l);
    expect(dlg.querySelectorAll('.ff-item').length).toBe(1);
    btn('Find').click();
    expect(app.typeSession.id).toBe(a);
    expect(app.typeSession.range()).toEqual([0, 3]);
    btn('Select Objects').click();
    expect([...app.editor.selection].sort()).toEqual([a, b].sort());
    dlg.querySelector('#ff-family').value = 'Lora';
    dlg.querySelector('#ff-family').dispatchEvent(new Event('change'));
    btn('Change All').click();
    expect(doc.get(a).char.fontFamily).toBe('Lora');
    expect(doc.get(b).char.fontFamily).toBe('Lora');
    expect(recentFonts(app)[0]).toBe('Lora');
    btn('Done').click();
  });

  it('Resolve Missing Fonts replaces each missing family', async () => {
    const a = add('one', { char: { ...createText('', 0, 0).char, fontFamily: 'Courier Prime X' } });
    expect(app.commands.isEnabled('type.resolveFonts')).toBe(true);
    const done = app.commands.run('type.resolveFonts');
    await tick();
    const dlg = document.querySelector('dialog');
    expect(dlg.querySelector('select').value).toBe('Roboto Mono');
    [...dlg.querySelectorAll('button')].find((x) => x.textContent === 'Replace Fonts').click();
    await done;
    expect(doc.get(a).char.fontFamily).toBe('Roboto Mono');
    expect(app.commands.isEnabled('type.resolveFonts')).toBe(false);
  });

  it('selects type with the same font, size and colors, and point or area type', () => {
    const base = createText('', 0, 0).char;
    const a = add('one', { char: { ...base, fontFamily: 'Lato', fontSize: 12 } });
    const b = add('two', { char: { ...base, fontFamily: 'Lato', fontSize: 24 } }, 150);
    const c = add('three', { char: { ...base, fontFamily: 'Lora', fontSize: 12 }, fill: { type: 'solid', color: '#FF0000' } }, 200);
    const t = createText('mixed', 100, 250);
    const d = t.id;
    doc.transact('Add', () => doc.insert({ ...t, kind: 'area', width: 100, height: 40, runs: applyRunStyle(t, 0, 2, { fontFamily: 'Lato', fontSize: 12 }) }, app.editor.targetLayer().id));
    const sel = () => [...app.editor.selection].sort();
    app.editor.select([a]);
    app.commands.run('select.same.fontFamily');
    expect(sel()).toEqual([a, b, d].sort());
    app.editor.select([a]);
    app.commands.run('select.same.fontSize');
    expect(sel()).toEqual([a, d].sort());
    app.editor.select([c]);
    app.commands.run('select.same.textFill');
    expect(sel()).toEqual([c]);
    app.editor.select([a]);
    app.commands.run('select.same.text');
    expect(sel()).toEqual([a, d].sort());
    app.commands.run('select.object.areaType');
    expect(sel()).toEqual([d]);
    app.commands.run('select.object.pointType');
    expect(sel()).toEqual([a, b, c].sort());
  });
});
