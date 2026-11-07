// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { recallGoal, rememberGoal, moveGoal } from '../src/lib/goal.js';
import { recallPosition, rememberPosition, movePosition, forgetPosition } from '../src/lib/position.js';
import { recallZoom, rememberZoom } from '../src/lib/viewprefs.js';

afterEach(() => vi.restoreAllMocks());

it('treats denied browser storage as unavailable for all document preferences', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Storage is blocked', 'SecurityError');
  });
  expect(recallGoal('Documents/A.docx')).toBeNull();
  expect(recallPosition('Documents/A.docx')).toBeNull();
  expect(recallZoom()).toBeNull();
  expect(() => {
    rememberGoal('Documents/A.docx', 500);
    moveGoal('Documents/A.docx', 'Documents/B.docx');
    rememberPosition('Documents/A.docx', { blockId: 'p1', offset: 2 });
    movePosition('Documents/A.docx', 'Documents/B.docx');
    forgetPosition('Documents/B.docx');
    rememberZoom({ value: 125 });
  }).not.toThrow();
});
