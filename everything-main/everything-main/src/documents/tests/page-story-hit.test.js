import { it, expect } from 'vitest';
import { pageStoryAtPoint } from '../src/engine/page-story-hit.js';

const path = 'word/header.xml';
const body = () => ({ page: { width: 816, height: 1056 }, lines: [], floatingObjects: [] });
const drawing = (patch = {}) => ({ page: 0, pageStory: path, x: 100, y: 30, width: 200, height: 100, image: {}, ...patch });
const line = (patch = {}) => ({ page: 0, pageStory: path, y: 200, height: 20, baseline: 216, stops: [{ x: 100, offset: 0 }, { x: 200, offset: 10 }], fragments: [], ...patch });
const stories = (patch = {}) => ({ lines: [line()], floatingObjects: [drawing()], cells: [], ...patch });

it('finds a drawing by its frame away from the anchoring paragraph and on the correct page', () => {
  expect(pageStoryAtPoint(body(), stories(), 0, 150, 50)).toEqual({ page: 0, pageStory: path });
  expect(pageStoryAtPoint(body(), stories(), 1, 150, 50)).toBeNull();
  expect(pageStoryAtPoint(body(), stories(), 0, 400, 50)).toBeNull();
});

it('preserves body text priority over header backgrounds until header mode is active', () => {
  const b = body(); b.lines = [line({ y: 40, pageStory: undefined })];
  expect(pageStoryAtPoint(b, stories(), 0, 150, 50)).toBeNull();
  expect(pageStoryAtPoint(b, stories(), 0, 150, 50, false)).toEqual({ page: 0, pageStory: path });
  b.lines = []; b.floatingObjects = [drawing({ pageStory: undefined })];
  expect(pageStoryAtPoint(b, stories(), 0, 150, 50)).toBeNull();
});

it('honors drawing rotation and cell clipping instead of its unrotated bounding rectangle', () => {
  const s = stories({ floatingObjects: [drawing({ image: { rotation: 90 * 60000 }, cellClip: { top: 40, bottom: 100 } })] });
  expect(pageStoryAtPoint(body(), s, 0, 200, 50)).toEqual({ page: 0, pageStory: path });
  expect(pageStoryAtPoint(body(), s, 0, 110, 50)).toBeNull();
  expect(pageStoryAtPoint(body(), s, 0, 200, 110)).toBeNull();
});

it('finds inline drawings through their owning line and keeps ordinary story text selectable', () => {
  const s = stories({ floatingObjects: [], lines: [line({ fragments: [{ image: {}, x: 100, width: 100, ascent: 60, descent: 0 }] })] });
  expect(pageStoryAtPoint(body(), s, 0, 150, 160)).toEqual({ page: 0, pageStory: path });
  expect(pageStoryAtPoint(body(), s, 0, 205, 210)).toBe(s.lines[0]);
  s.lines[0].cellClip = { top: 205, bottom: 210 };
  expect(pageStoryAtPoint(body(), s, 0, 150, 202)).toBeNull();
});
