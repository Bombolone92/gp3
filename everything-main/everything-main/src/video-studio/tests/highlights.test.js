import { describe, it, expect, vi } from 'vitest';
import { US } from '../src/lib/time.js';
import { normalizeProject } from '../src/model/project.js';
import { EditorStore } from '../src/model/store.js';
import { evaluate } from '../src/engine/scene.js';
import {
  transcriptLines, highlightsPrompt, parseHighlights, findHighlights, wordSpan, excerpt, highlightClip,
  highlightCaptions, highlightProject, highlightCompound, wordsInClip,
} from '../src/media/highlights.js';
import { fixture, s, onMain, clip } from './helpers.js';

/** n words, one every 0.5 s (0.4 s long), with a sentence end every 10 words. */
function talk(n, { from = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => ({ text: `w${i}${i % 10 === 9 ? '.' : ''}`, start: from + i * 500_000, end: from + i * 500_000 + 400_000 }));
}

describe('highlights: prompt', () => {
  it('numbers transcript lines by their first and last word', () => {
    const lines = transcriptLines(talk(25));
    expect(lines.map((l) => [l.first, l.last])).toEqual([[0, 9], [10, 19], [20, 24]]);
    expect(lines[1].text.startsWith('w10 w11')).toBe(true);
    const p = highlightsPrompt(talk(25), { count: 3, length: 'short' });
    expect(p).toMatch(/\[10-19\] \(0:05\) w10/);
    expect(p).toMatch(/3 most engaging/);
    expect(p).toMatch(/15 to 30 seconds/);
    expect(p).toMatch(/"highlights"/);
  });

  it('starts a new line after a long pause and caps line length', () => {
    const words = [{ text: 'a', start: 0, end: s(0.3) }, { text: 'b', start: s(3), end: s(3.3) }];
    expect(transcriptLines(words).map((l) => [l.first, l.last])).toEqual([[0, 0], [1, 1]]);
    const noStops = Array.from({ length: 50 }, (_, i) => ({ text: `x${i}`, start: i * 300_000, end: i * 300_000 + 200_000 }));
    expect(transcriptLines(noStops, { maxWords: 20 }).every((l) => l.last - l.first < 20)).toBe(true);
  });
});

describe('highlights: checking the answer', () => {
  const words = talk(400); // 200 s of speech

  it('reads good answers and pads them into the silence around the words', () => {
    const list = parseHighlights('{"highlights":[{"title":"The big idea","start":40,"end":89},{"title":"A story","start":200,"end":249}]}', words, { count: 5, length: 'short' });
    expect(list.map((h) => [h.title, h.first, h.last])).toEqual([['The big idea', 40, 89], ['A story', 200, 249]]);
    expect(list[0].start).toBe(words[40].start - 50_000); // half the gap before the word
    expect(list[0].end).toBe(words[89].end + 50_000);
    expect(list[0].duration).toBe(list[0].end - list[0].start);
    expect(list[0].excerpt.startsWith('w40 w41')).toBe(true);
    expect(list[0].id).toBeTruthy();
  });

  it('clamps, orders and parses numbers it was not meant to get', () => {
    const list = parseHighlights('```json\n[{"title":"Backwards","start":"99","end":60.4},{"title":"Way out","start":-5,"end":9999}]\n```', words, { length: 'short' });
    expect(list[0]).toMatchObject({ first: 60, last: 99 });
    // -5..9999 clamps to the whole talk, then shrinks to fit the longest allowed length.
    expect(list[1].first).toBe(0);
    expect(words[list[1].last].end - words[0].start).toBeLessThanOrEqual(30 * US * 1.25);
    expect(words[list[1].last].text.endsWith('.')).toBe(true);
  });

  it('grows moments that are too short to a sentence end', () => {
    const [h] = parseHighlights('{"highlights":[{"title":"Tiny","start":100,"end":102}]}', words, { length: 'short' });
    expect(words[h.last].end - words[h.first].start).toBeGreaterThanOrEqual(15 * US * 0.6);
    expect(words[h.last].text.endsWith('.')).toBe(true);
  });

  it('drops overlaps, junk entries and extras, and cleans titles', () => {
    const reply = JSON.stringify({ highlights: [
      { title: '"Great #moment"\n', start: 10, end: 59 },
      { title: 'Overlap', start: 20, end: 69 },
      null, 'text', { title: 'No numbers' }, { start: 'abc', end: 3 },
      { start: 300, end: 349 },
      { title: 'Too many', start: 150, end: 199 },
    ] });
    const list = parseHighlights(reply, words, { count: 2, length: 'short' });
    expect(list.map((h) => h.title)).toEqual(['Great', 'Highlight 2']);
    expect(list[1].first).toBe(300);
  });

  it('returns nothing for answers without highlights', () => {
    expect(parseHighlights('I could not find any.', words)).toEqual([]);
    expect(parseHighlights('{"highlights":"none"}', words)).toEqual([]);
    expect(parseHighlights('{"highlights":[{"start":1,"end":2}]}', [])).toEqual([]);
  });

  it('asks the injected chat and reports unusable answers', async () => {
    const chat = vi.fn(async () => ({ message: { content: '{"highlights":[{"title":"One","start":0,"end":49}]}' } }));
    const list = await findHighlights(words, { count: 3, chat });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(list).toHaveLength(1);
    await expect(findHighlights(words, { chat: async () => 'sorry' })).rejects.toThrow(/no usable moments/);
    await expect(findHighlights(talk(3), { chat })).rejects.toThrow(/not enough speech/);
  });

  it('keeps padding inside the clip at the edges', () => {
    expect(wordSpan(words, 0, 3).start).toBe(0);
    expect(excerpt(talk(200), 0, 199, 40).length).toBeLessThanOrEqual(41);
    expect(excerpt(talk(200), 0, 199, 40).endsWith('…')).toBe(true);
  });
});

describe('highlights: building clips', () => {
  function source() {
    const p = fixture();
    p.assets.vid.duration = s(300);
    const [c] = onMain(p, clip('video', 2, 200, { in: s(10) }));
    return { p, c };
  }
  const words = talk(400);
  const h = parseHighlights('{"highlights":[{"title":"Best bit","start":40,"end":89}]}', words)[0];

  it('cuts the source clip to the moment', () => {
    const { c } = source();
    const out = highlightClip(c, h);
    expect(out.id).not.toBe(c.id);
    expect(out.start).toBe(0);
    expect(out.duration).toBe(h.end - h.start);
    expect(out.in).toBe(s(10) + h.start);
    expect(out.transition).toBe(null);
  });

  it('times captions from the start of the moment', () => {
    const caps = highlightCaptions(words, h, { presetId: 'yellow-caption', width: 1080 });
    expect(caps.length).toBeGreaterThan(5);
    expect(caps[0].start).toBe(words[40].start - h.start);
    expect(caps.every((x) => x.caption && x.start + x.duration <= h.end - h.start + 1)).toBe(true);
    expect(caps.map((x) => x.text.replace(/\n/g, ' ')).join(' ')).toMatch(/^w40 w41/);
  });

  it('makes a vertical short project with captions', () => {
    const { p, c } = source();
    const short = normalizeProject(highlightProject(p, c, words, h, { ratio: '9:16', captions: 'yellow-caption' }));
    expect(short.name).toBe('Best bit');
    expect(short.settings).toMatchObject({ width: 1080, height: 1920, ratio: '9:16', fps: p.settings.fps });
    expect(Object.keys(short.assets)).toEqual(['vid']);
    expect(short.tracks.map((t) => (t.main ? 'main' : t.kind))).toEqual(['text', 'main']);
    expect(short.tracks[1].clips[0]).toMatchObject({ assetId: 'vid', start: 0, in: s(10) + h.start });
    const keep = highlightProject(p, c, words, h, { ratio: 'keep', captions: '' });
    expect(keep.settings).toMatchObject({ width: 1920, height: 1080 });
    expect(keep.tracks).toHaveLength(1);
  });

  it('nests a moment in a compound clip and adds it as one undo step', () => {
    const { p, c } = source();
    const store = new EditorStore(p);
    const comp = highlightCompound(p, c, words, h, { captions: 'clean-caption', start: s(202) });
    expect(comp.type).toBe('compound');
    expect(comp.name).toBe('Best bit');
    expect(comp.sequence.tracks.map((t) => (t.main ? 'main' : t.kind))).toEqual(['text', 'main']);
    store.update('Add highlights', (proj) => {
      proj.tracks.find((t) => t.main).clips.push(comp);
    });
    expect(store.history.undoStack).toHaveLength(1);
    const layers = evaluate(store.project, s(203));
    expect(layers.some((l) => l.clip?.assetId === 'vid')).toBe(true);
    expect(layers.some((l) => l.clip?.type === 'text')).toBe(true);
  });

  it('takes the transcript words that fall inside a clip', () => {
    const { c } = source();
    const t = talk(2).concat(talk(10, { from: s(2) })).concat(talk(4, { from: s(203) }));
    const local = wordsInClip(t, c);
    expect(local).toHaveLength(10);
    expect(local[0].start).toBe(0);
  });
});
