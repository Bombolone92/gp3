import { it, expect } from 'vitest';
import { emptyControlPointerCaret } from '../src/engine/content-control-caret.js';
const control = (id, extra = {}) => ({ text: '', contentControl: { id, persistent: true, ...extra } });
it('owns empty rich-text controls and keeps the existing adjacent owner', () => {
  const paragraphs = [{ runs: [{ text: 'A' }, control('a'), control('b'), { text: 'D' }] }];
  expect(emptyControlPointerCaret(paragraphs, 1)).toEqual({ id: 'a', side: 'inside' });
  expect(emptyControlPointerCaret(paragraphs, 1, { id: 'b', side: 'inside' })).toEqual({ id: 'b', side: 'inside' });
  expect(emptyControlPointerCaret(paragraphs, 0)).toBeUndefined();
  expect(emptyControlPointerCaret(paragraphs, 2)).toBeUndefined();
});
it('does not assign empty rich-text ownership to other control kinds or filled text', () => {
  for (const extra of [{ plainText: true }, { picture: true }, { persistent: false }])
    expect(emptyControlPointerCaret([{ runs: [control('a', extra)] }], 0)).toBeUndefined();
  expect(emptyControlPointerCaret([{ runs: [{ ...control('a'), text: 'filled' }] }], 0)).toBeUndefined();
});
