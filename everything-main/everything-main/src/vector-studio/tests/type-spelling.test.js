import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bootAppWithFeatures } from './helpers.js';
import { createText } from '../src/model/nodes.js';
import { createSpeller, setSpeller, parseAffixes } from '../src/features/type/spell-dict.js';
import { findIssues, wordsOf, acceptor, setCustomWords, customWords, spellOverlay } from '../src/features/type/spelling.js';

const dir = path.resolve(import.meta.dirname, '../public/dictionaries');
let speller;

beforeAll(() => {
  speller = createSpeller({ aff: fs.readFileSync(path.join(dir, 'en-US.aff'), 'utf8'), dic: fs.readFileSync(path.join(dir, 'en-US.dic'), 'utf8') });
  setSpeller(speller);
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('spelling dictionary', () => {
  it('parses affix rules', () => {
    const a = parseAffixes('PFX A Y 1\nPFX A 0 re .\nSFX S Y 2\nSFX S y ies [^aeiou]y\nSFX S 0 s [^sxzhy]\nREP f ph\n');
    expect(a.pfx).toHaveLength(1);
    expect(a.sfx).toHaveLength(2);
    expect(a.sfx[0]).toMatchObject({ flag: 'S', strip: 'y', add: 'ies' });
    expect(a.rep).toEqual([['f', 'ph']]);
  });

  it('accepts stems, affixed forms and capitalized forms', () => {
    for (const w of ['quick', 'jumped', 'running', 'happiness', 'unhappy', 'reprocessing', "don't", 'don\u2019t', 'The', 'THE', 'Paris', 'PARIS', 'cities', 'boxes']) expect(speller.correct(w), w).toBe(true);
  });

  it('rejects misspellings and lowercase names', () => {
    for (const w of ['teh', 'jumpd', 'recieve', 'accomodate']) expect(speller.correct(w), w).toBe(false);
    expect(speller.correct('paris')).toBe(false);
    expect(speller.correct('paris', { matchCase: false })).toBe(true);
  });

  it('suggests the likely word first, keeping the case', () => {
    expect(speller.suggest('Teh')[0]).toBe('The');
    expect(speller.suggest('recieve')[0]).toBe('receive');
    expect(speller.suggest('accomodate')).toContain('accommodate');
    expect(speller.suggest('paris')[0]).toBe('Paris');
    expect(speller.suggest('helloworld')).toContain('hello world');
    expect(speller.suggest('TEH')[0]).toBe('THE');
  });
});

describe('finding issues', () => {
  it('splits words keeping apostrophes', () => {
    expect(wordsOf("It's a dog's life").map((w) => w.word)).toEqual(["It's", 'a', "dog's", 'life']);
  });

  it('finds unknown and repeated words and honors the options', () => {
    const text = 'Teh fox jumpd over the the dog in 2024 at MCMXC with abc123 and NASAQ.';
    const issues = findIssues(text, speller);
    expect(issues.map((i) => [i.word, i.kind])).toEqual([
      ['Teh', 'spelling'],
      ['jumpd', 'spelling'],
      ['the', 'repeated'],
      ['NASAQ', 'spelling'],
    ]);
    expect(text.slice(issues[2].from, issues[2].end)).toBe(' the');
    const opts = { repeated: false, ignoreUpper: true, ignoreNumbers: false, ignoreRoman: false };
    const words = findIssues(text, speller, opts).map((i) => i.word);
    expect(words).toContain('abc123');
    expect(words).not.toContain('NASAQ');
    expect(words).not.toContain('the');
    expect(words).not.toContain('MCMXC');
    expect(findIssues(text, speller, { ignoreRoman: false }).map((i) => i.word)).toContain('MCMXC');
  });

  it('accepts words from the custom dictionary', async () => {
    const app = await bootAppWithFeatures();
    setCustomWords(app.prefs, ['jumpd', 'Zorblax']);
    expect(customWords(app.prefs)).toEqual(['jumpd', 'Zorblax']);
    const issues = findIssues('Teh jumpd zorblax', speller, undefined, acceptor(app.prefs));
    expect(issues.map((i) => i.word)).toEqual(['Teh']);
  });
});

describe('Check Spelling and Auto Spell Check', () => {
  let app;
  beforeEach(async () => {
    app = await bootAppWithFeatures();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
  });

  const add = (text, x = 100, y = 100) => {
    const t = createText(text, x, y);
    app.editor.doc.transact('Add', () => app.editor.doc.insert(t, app.editor.targetLayer().id));
    return t.id;
  };

  const dialog = () => document.querySelector('dialog.spell-dialog');
  const button = (label) => [...dialog().querySelectorAll('button')].find((b) => b.textContent === label);

  it('registers the commands with Mod+I for Check Spelling', () => {
    expect(app.commands.get('type.spelling.check').shortcut).toBe('Mod+I');
    expect(app.commands.get('type.spelling.auto')).toBeTruthy();
    expect(app.commands.get('type.spelling.dictionary')).toBeTruthy();
  });

  it('walks unknown words, changes one, changes all and undoes', async () => {
    const a = add('Teh cat saw teh dog');
    const b = add('teh end', 100, 200);
    app.commands.run('type.spelling.check');
    await tick();
    await tick();
    expect(dialog()).toBeTruthy();
    expect(dialog().querySelector('.sp-status').textContent).toContain('Teh');
    expect(dialog().querySelector('mark').textContent).toBe('Teh');
    expect(dialog().querySelector('#sp-change').value).toBe('The');
    // The word is selected on the canvas.
    expect(app.typeSession.id).toBe(a);
    expect(app.typeSession.range()).toEqual([0, 3]);
    button('Change').click();
    expect(app.editor.doc.get(a).text).toBe('The cat saw teh dog');
    expect(dialog().querySelector('mark').textContent).toBe('teh');
    dialog().querySelector('#sp-change').value = 'the';
    button('Change All').click();
    expect(app.editor.doc.get(a).text).toBe('The cat saw the dog');
    expect(app.editor.doc.get(b).text).toBe('the end');
    expect(dialog().querySelector('.sp-status').textContent).toMatch(/complete/);
    app.editor.doc.undo();
    expect(app.editor.doc.get(a).text).toBe('The cat saw teh dog');
    expect(app.editor.doc.get(b).text).toBe('teh end');
    button('Done')?.click();
  });

  it('deletes a repeated word and adds words to the dictionary', async () => {
    const a = add('the the Zorblax');
    app.commands.run('type.spelling.check');
    await tick();
    await tick();
    expect(dialog().querySelector('.sp-status').textContent).toMatch(/Repeated/);
    button('Change').click();
    expect(app.editor.doc.get(a).text).toBe('the Zorblax');
    expect(dialog().querySelector('mark').textContent).toBe('Zorblax');
    button('Add to Dictionary').click();
    expect(customWords(app.prefs)).toContain('Zorblax');
    expect(dialog().querySelector('.sp-status').textContent).toMatch(/complete/);
  });

  it('underlines unknown words on the overlay when auto spell check is on', async () => {
    add('Teh quick fox');
    const hook = spellOverlay(app);
    const lines = [];
    const ctx = new Proxy({ lineTo: (x, y) => lines.push([x, y]), moveTo: (x, y) => lines.push([x, y]) }, { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });
    hook(ctx, app.editor);
    expect(lines.length).toBe(0); // off by default
    app.commands.run('type.spelling.auto');
    expect(app.prefs.get('autoSpellCheck')).toBe(true);
    hook(ctx, app.editor);
    await tick();
    hook(ctx, app.editor);
    expect(lines.length).toBeGreaterThan(2);
    // Every wave point lies under the first word (x from 100 to about 118 with the stub's 6px characters).
    expect(Math.max(...lines.map((p) => p[0]))).toBeLessThan(100 + 3 * 6 + 3);
  });
});
