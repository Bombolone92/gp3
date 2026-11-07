import { describe, it, expect, vi } from 'vitest';
import { splitForSpeech, createReader, speechIsTruncated, SPEECH_CHUNK_MAX } from '../src/lib/readaloud.js';

/** A stand-in for an HTMLAudioElement that ends when told to. */
function fakeAudio(text) {
  const listeners = {};
  return {
    text, played: false, paused: false,
    addEventListener: (k, fn) => { (listeners[k] ||= []).push(fn); },
    removeEventListener: (k, fn) => { listeners[k] = (listeners[k] || []).filter((f) => f !== fn); },
    play() { this.played = true; return Promise.resolve(); },
    pause() { this.paused = true; },
    end() { for (const fn of listeners.ended || []) fn(); },
  };
}

describe('splitForSpeech', () => {
  it('splits Chinese and Japanese text at its own sentence ends, and after its punctuation when a run is too long', () => {
    expect(splitForSpeech('这是第一句。这是第二句！这是第三句？', 12)).toEqual(['这是第一句。', '这是第二句！', '这是第三句？']);
    expect(splitForSpeech('第一部分、第二部分、第三部分', 9)).toEqual(['第一部分、', '第二部分、第三部分']);
    expect(splitForSpeech('第一部分、第二部分、第三部分', 6)).toEqual(['第一部分、', '第二部分、', '第三部分']);
    // Western sentences are unaffected.
    expect(splitForSpeech('One sentence. Two sentences.', 15)).toEqual(['One sentence.', 'Two sentences.']);
  });

  it('keeps short text whole and drops object replacement characters', () => {
    expect(splitForSpeech('Hello there.￼ How are you?')).toEqual(['Hello there. How are you?']);
    expect(splitForSpeech('   ')).toEqual([]);
    expect(splitForSpeech(null)).toEqual([]);
  });

  it.each([
    '.5 liters',
    'The price is 3.14 dollars. Visit example.com for details.',
    '...and then we left.',
    'Wait...really?',
    'He said, “Yes.” Then left.',
    '?! ...',
  ])('preserves punctuation and numbers in %j', (text) => {
    expect(splitForSpeech(text)).toEqual([text]);
  });

  it('preserves decimal values across sentence chunks', () => {
    expect(splitForSpeech('.5 liters. Next: 3.14.', 12)).toEqual(['.5 liters.', 'Next: 3.14.']);
  });

  it.each(['𠮷', '😊'])('keeps %s intact at the speech request limit', (character) => {
    const text = 'a'.repeat(SPEECH_CHUNK_MAX - 1) + character + 'b';
    const chunks = splitForSpeech(text);
    expect(chunks.every((chunk) => chunk.isWellFormed())).toBe(true);
    expect(chunks.every((chunk) => chunk.length <= SPEECH_CHUNK_MAX)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });

  it('preserves consecutive supplementary characters across small chunks', () => {
    const text = '𠮷😊𠮷😊';
    const chunks = splitForSpeech(text, 3);
    expect(chunks.every((chunk) => chunk.isWellFormed() && chunk.length <= 3)).toBe(true);
    expect(chunks.join('')).toBe(text);
    expect(splitForSpeech('a😊b', 1)).toEqual(['a', '😊', 'b']);
  });

  it('breaks at paragraphs and sentences before the limit, and at words when it must', () => {
    const chunks = splitForSpeech('One two. Three four! Five six?\n\nSeven eight.', 12);
    expect(chunks).toEqual(['One two.', 'Three four!', 'Five six?', 'Seven eight.']);
    const long = splitForSpeech('word '.repeat(10).trim(), 12);
    expect(long.every((c) => c.length <= 12)).toBe(true);
    expect(long.join(' ')).toBe('word '.repeat(10).trim());
    const glued = splitForSpeech('a'.repeat(30), 12);
    expect(glued).toEqual(['a'.repeat(12), 'a'.repeat(12), 'a'.repeat(6)]);
    expect(splitForSpeech('x'.repeat(SPEECH_CHUNK_MAX * 2 + 10)).length).toBe(3);
    expect(speechIsTruncated('Short.')).toBe(false);
    expect(speechIsTruncated('Sentence. '.repeat(20), { max: 12, limit: 3 })).toBe(true);
  });
});

describe('createReader', () => {
  it('reports rejected audio playback instead of claiming it read the document', async () => {
    const speak = vi.fn(async (text) => ({ ...fakeAudio(text), play: async () => { throw new Error('Playback blocked'); } }));
    const reader = createReader({ speak, chunkMax: 12 });
    await expect(reader.start('First one. Second one. Third one.')).rejects.toThrow('Playback blocked');
    expect(reader.state).toBe('idle');
    expect(speak.mock.calls.length).toBeLessThan(3);
  });

  it('removes playback listeners when reading is stopped', async () => {
    const audio = new EventTarget();
    audio.play = async () => {}; audio.pause = vi.fn();
    const remove = vi.spyOn(audio, 'removeEventListener');
    const reader = createReader({ speak: async () => audio });
    const reading = reader.start('Hello.');
    await new Promise((resolve) => setTimeout(resolve, 0));
    reader.stop(); expect(await reading).toBe(false);
    expect(remove.mock.calls.map(([event]) => event).sort()).toEqual(['ended', 'error']);
  });

  it('releases a passage that was still being fetched when reading stopped', async () => {
    const first = fakeAudio('one'), second = fakeAudio('two');
    for (const audio of [first, second]) { audio.removeAttribute = vi.fn(); audio.load = vi.fn(); }
    let releaseSecond;
    const speak = vi.fn((text) => (text.startsWith('One') ? Promise.resolve(first) : new Promise((resolve) => { releaseSecond = () => resolve(second); })));
    const reader = createReader({ speak, chunkMax: 12 });
    const reading = reader.start('One sentence. Two sentence.');
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The second passage is fetched while the first plays.
    expect(speak).toHaveBeenCalledTimes(2);
    reader.stop();
    expect(first.paused).toBe(true);
    expect(first.removeAttribute).toHaveBeenCalledWith('src');
    releaseSecond();
    expect(await reading).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The clip that arrived after Stop never plays and is let go of too.
    expect(second.played).toBe(false);
    expect(second.paused).toBe(true);
    expect(second.removeAttribute).toHaveBeenCalledWith('src');
    expect(second.load).toHaveBeenCalled();
  });

  it('reports a media decoding failure and returns to idle', async () => {
    const audio = new EventTarget(); audio.play = async () => {};
    const reader = createReader({ speak: async () => audio });
    const reading = reader.start('Hello.');
    const failed = expect(reading).rejects.toThrow('audio could not be played');
    await new Promise((resolve) => setTimeout(resolve, 0));
    audio.dispatchEvent(new Event('error'));
    await failed;
    expect(reader.state).toBe('idle');
  });

  it('does not start audio if stopped before the scheduled play call', async () => {
    const audio = fakeAudio('Hello.');
    const reader = createReader({ speak: async () => audio,
      onState: (state) => { if (state === 'playing') queueMicrotask(() => reader.stop()); },
    });
    expect(await reader.start('Hello.')).toBe(false);
    expect(audio.played).toBe(false);
    expect(reader.state).toBe('idle');
  });

  it('speaks the chunks in order, fetching the next while one plays', async () => {
    const audios = [];
    const states = [];
    const reader = createReader({ speak: async (t) => { const a = fakeAudio(t); audios.push(a); return a; }, onState: (s) => states.push(s), chunkMax: 12 });
    const p = reader.start('First one. Second one.');
    await new Promise((r) => setTimeout(r, 0));
    expect(audios.map((a) => a.text)).toEqual(['First one.', 'Second one.']);
    expect(audios[0].played).toBe(true);
    expect(reader.state).toBe('playing');
    audios[0].end();
    await new Promise((r) => setTimeout(r, 0));
    expect(audios[1].played).toBe(true);
    audios[1].end();
    expect(await p).toBe(true);
    expect(states).toEqual(['loading', 'playing', 'idle']);
    expect(await reader.start('')).toBe(false);
  });

  it('stops playback and reports failures', async () => {
    const audios = [];
    const reader = createReader({ speak: async (t) => { const a = fakeAudio(t); audios.push(a); return a; } });
    const p = reader.start('Alpha beta.');
    await new Promise((r) => setTimeout(r, 0));
    expect(reader.state).toBe('playing');
    reader.stop();
    expect(audios[0].paused).toBe(true);
    expect(await p).toBe(false);
    expect(reader.state).toBe('idle');
    const failing = createReader({ speak: async () => { throw new Error('offline'); } });
    await expect(failing.start('Hello.')).rejects.toThrow('offline');
    expect(failing.state).toBe('idle');
  });
});
