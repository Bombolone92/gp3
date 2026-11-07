import { describe, it, expect, beforeEach } from 'vitest';
import { wordCount, scrollRate, createTeleprompter } from '../src/ui/teleprompter.js';

describe('teleprompter', () => {
  beforeEach(() => localStorage.clear());

  it('counts words and turns a reading pace into a scroll speed', () => {
    expect(wordCount('  one two\nthree  ')).toBe(3);
    expect(wordCount('')).toBe(0);
    // 120 words in 600 px read at 120 wpm: 600 px per minute.
    expect(scrollRate(600, 120, 120)).toBeCloseTo(10);
    expect(scrollRate(0, 10, 100)).toBe(0);
    expect(scrollRate(100, 0, 100)).toBe(0);
  });

  it('shows the script only when on and kept, and locks editing while recording', () => {
    const tp = createTeleprompter({ overlay: true });
    document.body.append(tp.controls, tp.view);
    const sw = tp.controls.querySelector('[role=switch], input[type=checkbox]');
    const area = tp.controls.querySelector('textarea');
    expect(tp.view.hidden).toBe(true);
    sw.click();
    area.value = 'Hello there, this is my script.';
    area.dispatchEvent(new Event('input'));
    expect(tp.view.hidden).toBe(false);
    expect(tp.view.textContent).toContain('my script');
    expect(tp.controls.querySelector('.tp-count').textContent).toMatch(/^6 words/);
    tp.follow('recording');
    expect(area.disabled).toBe(true);
    tp.follow('idle');
    expect(area.disabled).toBe(false);
    // Remembered for the next dialog.
    const again = createTeleprompter();
    expect(again.controls.querySelector('textarea').value).toBe('Hello there, this is my script.');
    tp.dispose();
    again.dispose();
  });
});
