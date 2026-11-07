// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { changeCase, runPieces, paintedAcross, paragraphText, applyCase, CASE_MODES } from '../src/lib/textcase.js';

describe('changeCase', () => {
  it('upper and lower keep every character one to one', () => {
    expect(changeCase('Hello, World 12!', 'upper')).toBe('HELLO, WORLD 12!');
    expect(changeCase('Hello, World 12!', 'lower')).toBe('hello, world 12!');
    expect(changeCase('straße', 'upper')).toBe('STRAßE');
    expect(changeCase('', 'upper')).toBe('');
    expect(changeCase(null, 'lower')).toBe('');
  });

  it('title-cases each word and keeps apostrophes inside words', () => {
    expect(changeCase("the QUICK brown fox's tale", 'title')).toBe("The Quick Brown Fox's Tale");
    expect(changeCase('well-known e-mail (draft)', 'title')).toBe('Well-Known E-Mail (Draft)');
    expect(changeCase('3rd place', 'title')).toBe('3rd Place');
  });

  it('does not end a sentence at a period without a space after it', () => {

    expect(changeCase('visit example.com today. see node.js and e.g. this', 'sentence')).toBe('Visit example.com today. See node.js and e.g. this');

    expect(changeCase('send to a.b@c.com now', 'sentence')).toBe('Send to a.b@c.com now');

    expect(changeCase('the file index.html loads. done.” next', 'sentence')).toBe('The file index.html loads. Done.” Next');

    expect(changeCase('really?! yes. (and so) 3.14 is pi', 'sentence')).toBe('Really?! Yes. (And so) 3.14 is pi');

  });


  it('sentence-cases after full stops, question and exclamation marks', () => {
    expect(changeCase('hello THERE. how are you? fine! ok', 'sentence')).toBe('Hello there. How are you? Fine! Ok');
    expect(changeCase('"quoted." (aside) next', 'sentence')).toBe('"Quoted." (Aside) next');
    expect(changeCase('one… two', 'sentence')).toBe('One… Two');
  });

  it('keeps combining marks inside their word and sentence', () => {
    // Decomposed text (an accent written after its letter) must not start a new word or sentence.
    expect(changeCase('cafe\u0301s au lait', 'title')).toBe('Cafe\u0301s Au Lait');
    expect(changeCase('ha\u0300 no\u0323i', 'title')).toBe('Ha\u0300 No\u0323i');
    expect(changeCase('e\u0301te\u0301. voila\u0300 tout', 'sentence')).toBe('E\u0301te\u0301. Voila\u0300 tout');
  });

  it('leaves unknown modes alone and lists four modes', () => {
    expect(changeCase('MiXed', 'nope')).toBe('MiXed');
    expect(CASE_MODES.map((m) => m.id)).toEqual(['lower', 'upper', 'title', 'sentence']);
  });
});

const para = (...runs) => ({ node: { paragraph: { inlines: runs.map((r) => (typeof r === 'string' ? { kind: 'run', run: { text: r } } : r)) } } });

/** A painted host: one fragment per paragraph, spans with document positions. */
const paintedHost = (paragraphs) => {
  const host = document.createElement('div');
  let pm = 100;
  for (const [blockId, runs] of Object.entries(paragraphs)) {
    const frag = document.createElement('div');
    frag.className = 'document-fragment';
    frag.dataset.sourceNodeId = blockId;
    frag.dataset.pmStart = String(pm);
    for (const text of runs) {
      const span = document.createElement('span');
      span.className = 'document-text-run';
      span.dataset.pmStart = String(pm);
      span.dataset.pmEnd = String(pm + text.length);
      span.textContent = text;
      frag.append(span);
      pm += text.length;
    }
    frag.dataset.pmEnd = String(pm);
    host.append(frag);
    pm += 2;
  }
  return host;
};

describe('paragraphText', () => {
  it('joins runs and refuses paragraphs with anything else', () => {
    expect(paragraphText(para('Hello ', 'world'))).toBe('Hello world');
    expect(paragraphText(para('a', { kind: 'footnoteReference' }, 'b'))).toBeNull();
    expect(paragraphText(null)).toBe('');
  });
});

describe('runPieces', () => {
  const host = paintedHost({ p1: ['Hello ', 'big ', 'world'] });

  it('clips painted runs to the range in paragraph offsets', () => {
    expect(runPieces(host, 'p1', { start: 0, end: 15 }, 'Hello big world')).toEqual([{ start: 0, end: 6, text: 'Hello ' }, { start: 6, end: 10, text: 'big ' }, { start: 10, end: 15, text: 'world' }]);
    expect(runPieces(host, 'p1', { start: 3, end: 12 }, 'Hello big world')).toEqual([{ start: 3, end: 6, text: 'lo ' }, { start: 6, end: 10, text: 'big ' }, { start: 10, end: 12, text: 'wo' }]);
    expect(runPieces(host, 'p1', { start: 6, end: 6 }, 'Hello big world')).toEqual([]);
  });

  it('drops spans that disagree with the paragraph text and unpainted paragraphs', () => {
    expect(runPieces(host, 'p1', { start: 0, end: 15 }, 'Hello BIG world')).toEqual([{ start: 0, end: 6, text: 'Hello ' }, { start: 10, end: 15, text: 'world' }]);
    expect(runPieces(host, 'nope', { start: 0, end: 3 }, 'abc')).toEqual([]);
    expect(runPieces(null, 'p1', { start: 0, end: 3 }, 'abc')).toEqual([]);
  });
});

/** A paragraph painted across a page break: two fragments, the second starting mid-text. */
const splitHost = ({ paintSecond = true } = {}) => {
  const host = document.createElement('div');
  const runs = [['Hello ', 'big '], ['bad ', 'world']];
  let pm = 100;
  runs.forEach((texts, i) => {
    if (i === 1 && !paintSecond) return;
    const frag = document.createElement('div');
    frag.className = 'document-fragment';
    frag.dataset.sourceNodeId = 'p1';
    frag.dataset.pmStart = String(pm);
    for (const text of texts) {
      const span = document.createElement('span');
      span.className = 'document-text-run';
      span.dataset.pmStart = String(pm);
      span.dataset.pmEnd = String(pm + text.length);
      span.textContent = text;
      frag.append(span);
      pm += text.length;
    }
    frag.dataset.pmEnd = String(pm);
    host.append(frag);
  });
  return host;
};

describe('runPieces across a page break', () => {
  it('measures the continuation fragment from the start of the paragraph', () => {
    const pieces = runPieces(splitHost(), 'p1', { start: 0, end: 19 }, 'Hello big bad world');
    expect(pieces).toEqual([{ start: 0, end: 6, text: 'Hello ' }, { start: 6, end: 10, text: 'big ' }, { start: 10, end: 14, text: 'bad ' }, { start: 14, end: 19, text: 'world' }]);
    expect(paintedAcross(splitHost(), 'p1', { start: 0, end: 19 }, 'Hello big bad world')).toBe(true);
  });

  it('reports a range that runs onto a page not painted yet', () => {
    const host = splitHost({ paintSecond: false });
    expect(runPieces(host, 'p1', { start: 0, end: 19 }, 'Hello big bad world')).toEqual([{ start: 0, end: 6, text: 'Hello ' }, { start: 6, end: 10, text: 'big ' }]);
    expect(paintedAcross(host, 'p1', { start: 0, end: 19 }, 'Hello big bad world')).toBe(false);
    expect(paintedAcross(host, 'p1', { start: 2, end: 9 }, 'Hello big bad world')).toBe(true);
    expect(paintedAcross(host, 'nope', { start: 0, end: 3 }, 'abc')).toBe(false);
  });
});

describe('applyCase', () => {
  const fakeApi = (nodes) => {
    const replaced = [];
    return {
      replaced,
      getNodeById: async ({ nodeId }) => nodes[nodeId],
      replace: async ({ target, text }) => { replaced.push({ blockId: target.start.blockId, start: target.start.offset, end: target.end.offset, text }); return { success: true }; },
    };
  };

  it.each([
    ['upper', 'mixed HEADING', 'MIXED HEADING'],
    ['lower', 'mixed HEADING', 'mixed heading'],
    ['title', 'mixed HEADING', 'Mixed Heading'],
    ['sentence', 'mixed HEADING', 'Mixed heading'],
  ])('applies %s to a visible heading instead of reporting it as unpainted', async (mode, text, expected) => {
    // getNodeById projects heading styles under node.heading, not node.paragraph.
    const node = { node: { kind: 'heading', heading: { level: 1, styleRef: 'Heading1', inlines: [{ kind: 'run', run: { text } }] } } };
    const api = fakeApi({ h1: node });
    const result = await applyCase(api, [{ blockId: 'h1', range: { start: 0, end: text.length } }], mode,
      { host: paintedHost({ h1: [text] }) });
    expect(result).toEqual({ changed: 1, skipped: 0 });
    expect(api.replaced).toEqual([{ blockId: 'h1', start: 0, end: text.length, text: expected }]);
  });

  it('asks before every write, so a caller can stop when editing becomes unavailable', async () => {
    const api = fakeApi({ p1: para('Hello ', 'big ', 'bad ', 'world') });
    let writes = 0;
    await expect(applyCase(api, [{ blockId: 'p1', range: { start: 0, end: 19 } }], 'upper', {
      host: splitHost(), beforeWrite: () => { if (writes++ === 2) throw new Error('Editing is unavailable'); },
    })).rejects.toThrow('Editing is unavailable');
    expect(api.replaced).toHaveLength(2);
  });

  it('changes every painted fragment of a paragraph split across pages, and says when part of it is not painted', async () => {
    const text = 'Hello big bad world';
    let api = fakeApi({ p1: para('Hello ', 'big ', 'bad ', 'world') });
    expect(await applyCase(api, [{ blockId: 'p1', range: { start: 0, end: 19 } }], 'upper', { host: splitHost() })).toEqual({ changed: 4, skipped: 0 });
    expect(api.replaced.map((r) => r.text)).toEqual(['WORLD', 'BAD ', 'BIG ', 'HELLO ']);
    api = fakeApi({ p1: para('Hello ', 'big ', 'bad ', 'world') });
    expect(await applyCase(api, [{ blockId: 'p1', range: { start: 0, end: text.length } }], 'upper', { host: splitHost({ paintSecond: false }) })).toEqual({ changed: 2, skipped: 1 });
    expect(api.replaced.map((r) => r.text)).toEqual(['BIG ', 'HELLO ']);
  });

  it('retains the inline safety checks for headings', async () => {
    const node = { node: { kind: 'heading', heading: { level: 1, inlines: [{ kind: 'run', run: { text: 'heading' } }, { kind: 'image' }] } } };
    expect(paragraphText(node)).toBeNull();
    const api = fakeApi({ h1: node });
    expect(await applyCase(api, [{ blockId: 'h1', range: { start: 0, end: 7 } }], 'upper',
      { host: paintedHost({ h1: ['heading'] }) })).toEqual({ changed: 0, skipped: 1 });
    expect(api.replaced).toEqual([]);
  });

  it('replaces run by run, later pieces first, deciding word boundaries across runs', async () => {
    const api = fakeApi({ p1: para('hello world') });
    const host = paintedHost({ p1: ['hel', 'lo wor', 'ld'] });
    const r = await applyCase(api, [{ blockId: 'p1', range: { start: 0, end: 11 } }], 'title', { host });
    expect(r).toEqual({ changed: 2, skipped: 0 });
    expect(api.replaced).toEqual([
      { blockId: 'p1', start: 3, end: 9, text: 'lo Wor' },
      { blockId: 'p1', start: 0, end: 3, text: 'Hel' },
    ]);
  });

  it('skips runs that would not change and paragraphs it cannot map', async () => {
    const api = fakeApi({ p1: para('ABCdef'), p2: para('x', { kind: 'image' }), p3: para('far away') });
    const host = paintedHost({ p1: ['ABC', 'def'], p2: ['x'] });
    const r = await applyCase(api, [{ blockId: 'p1', range: { start: 0, end: 6 } }, { blockId: 'p2', range: { start: 0, end: 2 } }, { blockId: 'p3', range: { start: 0, end: 8 } }, { blockId: 'p1', range: { start: 2, end: 2 } }], 'upper', { host });
    expect(r).toEqual({ changed: 1, skipped: 2 });
    expect(api.replaced).toEqual([{ blockId: 'p1', start: 3, end: 6, text: 'DEF' }]);
  });

  it('uses selected text across unmapped runs to decide title and sentence boundaries', async () => {
    for (const [mode, runs, expected] of [
      ['title', ['hello', ' ', 'world'], ['World', 'Hello']],
      ['sentence', ['hello', '. ', 'world'], ['World', 'Hello']],
      ['title', ['hel', 'lo', 'world'], ['Hel']],
    ]) {
      const text = runs.join('');
      const api = fakeApi({ p1: para(text) });
      const host = paintedHost({ p1: runs });
      // A stale painted run is deliberately skipped, but its actual text
      // must still contribute word/sentence boundaries for the other runs.
      host.querySelectorAll('.document-text-run')[1].textContent = 'stale';
      await applyCase(api, [{ blockId: 'p1', range: { start: 0, end: text.length } }], mode, { host });
      expect(api.replaced.map((r) => r.text)).toEqual(expected);
    }
  });

  it('surfaces a rejected replacement', async () => {
    const api = fakeApi({ p1: para('abc') });
    api.replace = async () => ({ success: false, failure: { message: 'locked' } });
    await expect(applyCase(api, [{ blockId: 'p1', range: { start: 0, end: 3 } }], 'upper', { host: paintedHost({ p1: ['abc'] }) })).rejects.toThrow('locked');
  });
});

it('changes the case of a very long paragraph in linear time', () => {
  const text = 'oNE SENTENCE HERE. '.repeat(20000);
  const t0 = performance.now();
  const out = changeCase(text, 'sentence');
  expect(performance.now() - t0).toBeLessThan(1500);
  expect(out).toBe('One sentence here. '.repeat(20000));
});
