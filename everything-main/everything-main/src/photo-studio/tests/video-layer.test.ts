import { describe, expect, it } from 'vitest';
import {
  blankVideo,
  deleteFrame,
  duplicateFrame,
  footageFrame,
  footageVideo,
  frameAtSeconds,
  insertBlankFrame,
  interpretAlpha,
  normalizeRuns,
  videoRuns,
  videoSeconds,
} from '../src/model/video-layer';
import { FrameCache } from '../src/model/frame-cache';
import { emptyGrid } from '../src/model/tiles';

const footage = (frames: number) => footageVideo({ asset: 'a', name: 'f.webm', type: 'video/webm', width: 4, height: 4, frames, fps: 10 });
const frames = (v: ReturnType<typeof footage>) => Array.from({ length: v.frames }, (_, k) => footageFrame(v, k));

describe('video layer frames', () => {
  it('maps layer frames to footage frames', () => {
    const v = footage(5);
    expect(frames(v)).toEqual([0, 1, 2, 3, 4]);
    expect(footageFrame(v, -1)).toBe(-1);
    expect(footageFrame(v, 5)).toBe(-1);
    expect(frames({ ...blankVideo(4, 4, 3, 10) })).toEqual([-1, -1, -1]);
  });

  it('inserts, duplicates and deletes frames, keeping altered frames with them', () => {
    const v = footage(5);
    const g = emptyGrid();
    v.altered = { 1: g, 3: g };
    expect(insertBlankFrame(v, 2)).toBe(true);
    expect(frames(v)).toEqual([0, 1, -1, 2, 3, 4]);
    expect(Object.keys(v.altered)).toEqual(['1', '4']);
    expect(duplicateFrame(v, 4)).toBe(true);
    expect(frames(v)).toEqual([0, 1, -1, 2, 3, 3, 4]);
    expect(Object.keys(v.altered)).toEqual(['1', '4', '5']);
    expect(deleteFrame(v, 1)).toBe(true);
    expect(frames(v)).toEqual([0, -1, 2, 3, 3, 4]);
    expect(Object.keys(v.altered!)).toEqual(['3', '4']);
    // Undoing the edits by hand returns to the implicit map.
    deleteFrame(v, 4);
    deleteFrame(v, 1);
    insertBlankFrame(v, 1);
    deleteFrame(v, 1);
    expect(frames(v)).toEqual([0, 2, 3, 4]);
    expect(v.map).toEqual([[0, 1], [2, 3]]);
    insertBlankFrame(v, 0);
    expect(v.map).toEqual([[-1, 1], [0, 1], [2, 3]]);
  });

  it('keeps at least one frame', () => {
    const v = footage(1);
    expect(deleteFrame(v, 0)).toBe(false);
    expect(v.frames).toBe(1);
    expect(deleteFrame(v, 3)).toBe(false);
    expect(v.map).toBeUndefined();
  });

  it('normalizes runs', () => {
    expect(normalizeRuns([[0, 2], [2, 3], [-1, 1], [-1, 2], [9, 0], [5, 1]])).toEqual([[0, 5], [-1, 3], [5, 1]]);
    expect(videoRuns({ ...footage(3), frames: 5 })).toEqual([[0, 3], [-1, 2]]);
  });

  it('finds frames by time with loops', () => {
    const v = footage(4);
    expect(frameAtSeconds(v, 0)).toBe(0);
    expect(frameAtSeconds(v, 0.25)).toBe(2);
    expect(frameAtSeconds(v, 0.3)).toBe(3);
    // Played once: the last frame holds.
    expect(frameAtSeconds(v, 2)).toBe(3);
    expect(videoSeconds(v)).toBeCloseTo(0.4);
    v.loops = 2;
    expect(frameAtSeconds(v, 0.5)).toBe(1);
    expect(frameAtSeconds(v, 0.9)).toBe(3);
    v.loops = 0;
    expect(frameAtSeconds(v, 10.1)).toBe(1);
    expect(videoSeconds(v)).toBe(Infinity);
  });

  it('interprets alpha', () => {
    const px = () => new Uint8ClampedArray([100, 50, 0, 128, 10, 20, 30, 0, 9, 9, 9, 255]);
    expect(Array.from(interpretAlpha(px(), 'straight'))).toEqual(Array.from(px()));
    expect(Array.from(interpretAlpha(px(), 'ignore'))).toEqual([100, 50, 0, 255, 10, 20, 30, 255, 9, 9, 9, 255]);
    expect(Array.from(interpretAlpha(px(), 'premultiplied'))).toEqual([199, 100, 0, 128, 10, 20, 30, 0, 9, 9, 9, 255]);
  });
});

describe('frame cache', () => {
  it('evicts the least recently used frames beyond its budget', () => {
    const evicted: string[] = [];
    const cache = new FrameCache<number>(300, (k) => evicted.push(k));
    cache.set('a', 1, 100);
    cache.set('b', 2, 100);
    cache.set('c', 3, 100);
    expect(cache.get('a')).toBe(1);
    cache.set('d', 4, 100);
    // "b" was the oldest after "a" was used.
    expect(evicted).toEqual(['b']);
    expect(cache.keys()).toEqual(['c', 'a', 'd']);
    expect(cache.bytes).toBe(300);
    expect(cache.peek('c')).toBe(3);
    cache.set('e', 5, 150);
    expect(evicted).toEqual(['b', 'c', 'a']);
    expect(cache.bytes).toBe(250);
    // A frame larger than the whole budget still stays until the next one.
    cache.set('huge', 6, 1000);
    expect(cache.keys()).toEqual(['huge']);
    expect(cache.has('huge')).toBe(true);
    cache.setLimit(2000);
    cache.set('f', 7, 10);
    expect(cache.size).toBe(2);
    cache.deleteWhere((k) => k === 'huge');
    expect(cache.keys()).toEqual(['f']);
    // Replacing an entry updates the total.
    cache.set('f', 8, 20);
    expect(cache.bytes).toBe(20);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });
});
