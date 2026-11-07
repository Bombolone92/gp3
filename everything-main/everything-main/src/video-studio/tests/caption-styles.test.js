import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CAPTION_STYLES, applyCaptionStyle } from '../src/model/caption-styles.js';
import { wordsOf, normalizeMarks, pickKeywords, marksForNamed, bareWord } from '../src/model/text-marks.js';
import { keywordsForLines } from '../src/media/transcript.js';
import { TEXT_ANIMS } from '../src/engine/text-anim.js';
import { TEXT_PRESETS } from '../src/model/catalog.js';
import { createProject, makeClip, normalizeClip, DEFAULT_TEXT_STYLE } from '../src/model/project.js';
import { EditorStore } from '../src/model/store.js';
import { createActions } from '../src/ui/actions.js';
import { createInspector } from '../src/ui/inspector/index.js';
import * as T from '../src/model/timeline.js';
import { US } from '../src/lib/time.js';

describe('highlighted words', () => {
  it('splits words like the renderer and keeps valid marks only', () => {
    expect(wordsOf('  Hello   big\nworld ')).toEqual(['Hello', 'big', 'world']);
    expect(normalizeMarks([2, 0, 2, 7, -1, 1.5, 'x'], 'a b c')).toEqual([0, 2]);
    expect(normalizeMarks(null, 'a')).toEqual([]);
    const clip = normalizeClip({ ...makeClip('text', { text: 'one two three', duration: US }), marks: [1, 9] });
    expect(clip.marks).toEqual([1]);
    expect('marks' in normalizeClip(makeClip('text', { text: 'x', duration: US }))).toBe(false);
  });

  it('picks long, meaningful words and numbers, not filler', () => {
    expect(pickKeywords('so I think we should really celebrate')).toEqual([6]);
    expect(pickKeywords('we sold 3000 copies in a week', 1)).toEqual([2]);
    expect(pickKeywords('ok so um yeah')).toEqual([]);
    const ten = 'the quick brown elephant crossed a wide river near the old mill';
    expect(pickKeywords(ten).length).toBe(2);
    expect(bareWord('"Hello!"')).toBe('hello');
  });

  it('maps words an AI named back onto the line, dropping inventions', () => {
    expect(marksForNamed('We shipped Version Two today!', ['version two', 'today', 'banana'])).toEqual([2, 3, 4]);
    expect(marksForNamed('We shipped it', ['nothing'])).toEqual([]);
    expect(marksForNamed('a b', 'not a list')).toEqual([]);
  });

  it('asks the AI per line and validates the answer', async () => {
    const chat = async () => 'Sure: [["launch"], [], ["100", "users"]]';
    expect(await keywordsForLines(['The launch went well', 'and then', 'we hit 100 users'], { chat })).toEqual([[1], [], [2, 3]]);
    await expect(keywordsForLines(['a', 'b'], { chat: async () => '[["a"]]' })).rejects.toThrow(/unexpected/);
    await expect(keywordsForLines(['a'], { chat: async () => 'no json here' })).rejects.toThrow(/unexpected/);
  });
});

describe('caption styles', () => {
  it('use known presets and animations', () => {
    const ids = new Set(TEXT_PRESETS.map((p) => p.id));
    for (const s of CAPTION_STYLES) {
      expect(ids.has(s.preset), s.id).toBe(true);
      for (const a of [s.in, s.loop].filter(Boolean)) expect(TEXT_ANIMS[a], `${s.id}:${a}`).toBeTruthy();
      expect(s.style.highlightColor).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(new Set(CAPTION_STYLES.map((s) => s.id)).size).toBe(CAPTION_STYLES.length);
  });

  it('restyle a caption but keep its words, timing, wrap and highlights', () => {
    const c = makeClip('text', { text: 'Hello there friend', start: US, duration: 2 * US, caption: true, style: { ...DEFAULT_TEXT_STYLE, boxWidth: 800, size: 40 } });
    c.marks = [2];
    applyCaptionStyle(c, CAPTION_STYLES.find((s) => s.id === 'pop-sweep'), DEFAULT_TEXT_STYLE, 1920);
    expect(c.style.boxWidth).toBe(800);
    expect(c.style.highlightColor).toBe('#ffe14d');
    expect(c.animLoop).toEqual({ id: 'karaoke', duration: 2 * US });
    expect(c.animIn).toBeNull();
    expect(c.marks).toEqual([2]);
    expect(c.captionStyle).toBe('pop-sweep');
    const d = makeClip('text', { text: 'x', duration: 2 * US, caption: true });
    applyCaptionStyle(d, CAPTION_STYLES.find((s) => s.id === 'word-pop'), DEFAULT_TEXT_STYLE, 1000);
    expect(d.style.boxWidth).toBe(900);
    expect(d.animIn.id).toBe('word-pop');
    expect(d.animIn.duration).toBeLessThanOrEqual(600_000);
  });
});

describe('highlight words section', () => {
  let env;
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
    const p = createProject();
    const text = makeClip('text', { start: 0, duration: 2 * US, text: 'Make every word count' });
    T.addClip(p, text);
    const store = new EditorStore(p);
    const ctx = { store };
    ctx.actions = createActions(ctx);
    const insp = createInspector(ctx);
    document.body.append(insp.el);
    store.select(text.id);
    env = { store, el: insp.el, id: text.id };
  });
  afterEach(() => env.el.remove());
  const clip = () => T.findClip(env.store.project, env.id).clip;

  it('toggles words, picks key words and clears', () => {
    const chips = () => [...env.el.querySelectorAll('.mark-chip')];
    expect(chips().map((b) => b.textContent)).toEqual(['Make', 'every', 'word', 'count']);
    chips()[2].click();
    expect(clip().marks).toEqual([2]);
    expect(chips()[2].getAttribute('aria-pressed')).toBe('true');
    chips()[2].click();
    expect(clip().marks).toBeUndefined();
    [...env.el.querySelectorAll('button')].find((b) => b.textContent === 'Pick key words').click();
    expect(clip().marks?.length).toBeGreaterThan(0);
    [...env.el.querySelectorAll('.mark-actions button')].find((b) => b.textContent === 'Clear').click();
    expect(clip().marks).toBeUndefined();
    env.store.undo();
    expect(clip().marks?.length).toBeGreaterThan(0);
  });
});
