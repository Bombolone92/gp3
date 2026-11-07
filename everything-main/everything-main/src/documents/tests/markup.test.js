import { describe, it, expect } from 'vitest';
import { MARKUP_VIEWS, isMarkupView, applyMarkupView } from '../src/lib/markup.js';

describe('tracked changes view', () => {
  it('offers the marked-up and original views and applies them to the engine', () => {
    expect(MARKUP_VIEWS.map((v) => v.id)).toEqual(['review', 'original']);
    expect(isMarkupView('original')).toBe(true);
    expect(isMarkupView('final')).toBe(false);
    const calls = [];
    const controller = { setTrackedChangesPreferences: (p) => calls.push(p) };
    expect(applyMarkupView(controller, 'original')).toBe(true);
    expect(calls).toEqual([{ mode: 'original', enabled: true }]);
    expect(applyMarkupView(controller, 'final')).toBe(false);
    expect(applyMarkupView(null, 'review')).toBe(false);
  });
});
