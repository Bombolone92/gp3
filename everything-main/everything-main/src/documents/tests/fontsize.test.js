// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { stepFontSize, stepMixedSizes } from '../src/lib/fontsize.js';

/** A painted paragraph: one fragment starting at document position 1, one span per run. */
function host(runs, { blockId = 'p1', base = 1 } = {}) {
  const root = document.createElement('div');
  const frag = document.createElement('div');
  frag.className = 'document-fragment';
  frag.dataset.sourceNodeId = blockId; frag.dataset.pmStart = String(base);
  let at = base;
  for (const [text, px] of runs) {
    const span = document.createElement('span');
    span.className = 'document-text-run'; span.textContent = text;
    span.dataset.pmStart = String(at); span.dataset.pmEnd = String(at + text.length);
    span.style.fontSize = `${px}px`;
    frag.append(span); at += text.length;
  }
  frag.dataset.pmEnd = String(at);
  root.append(frag);
  return root;
}
const text = 'Small text and big text here';
const api = (fontSize = vi.fn(async () => ({ success: true })), paragraph = text) => ({ getNodeById: async () => ({ node: { paragraph: { inlines: [{ kind: 'run', run: { text: paragraph } }] } } }), format: { fontSize } });

describe('stepMixedSizes', () => {
  it('steps each run from its own painted size, joining neighbors of one size', async () => {
    const fontSize = vi.fn(async () => ({ success: true }));
    // 32px is 24pt, 16px is 12pt, 24px is 18pt: three sizes, the middle one over two runs.
    const painted = host([['Small', 32], [' text and', 16], [' big', 16], [' text here', 24]]);
    const changes = [];
    const result = await stepMixedSizes(api(fontSize), [{ blockId: 'p1', range: { start: 0, end: 20 } }], 1, { host: painted, onChange: () => changes.push(1) });
    expect(result).toEqual({ changed: 3, skipped: 0 });
    expect(changes).toHaveLength(3);
    const story = { kind: 'story', storyType: 'body' };
    const target = (start, end) => ({ kind: 'selection', start: { kind: 'text', blockId: 'p1', offset: start, story }, end: { kind: 'text', blockId: 'p1', offset: end, story }, story });
    expect(fontSize.mock.calls.map(([input]) => input)).toEqual([
      { target: target(0, 5), value: 28 },
      { target: target(5, 18), value: 14 },
      { target: target(18, 20), value: 20 },
    ]);
    await stepMixedSizes(api(fontSize), [{ blockId: 'p1', range: { start: 0, end: 5 } }], -1, { host: painted });
    expect(fontSize.mock.calls.at(-1)[0].value).toBe(20);
  });

  it('reads a superscript or subscript run at its own size, not the smaller size it is painted at', async () => {
    const fontSize = vi.fn(async () => ({ success: true }));
    // A 12pt superscript paints at 7.8pt (10.4px) with a vertical shift.
    const painted = host([['E = mc', 16], ['2', 10.4], [' next', 18.67]]);
    painted.querySelectorAll('.document-text-run')[1].style.verticalAlign = '4px';
    await stepMixedSizes(api(fontSize, 'E = mc2 next'), [{ blockId: 'p1', range: { start: 0, end: 12 } }], 1, { host: painted });
    // The superscript reads as 12pt like its neighbor, so the two step together to 14; the 14pt tail goes to 16.
    expect(fontSize.mock.calls.map(([input]) => [input.target.start.offset, input.target.end.offset, input.value])).toEqual([[0, 7, 14], [7, 12, 16]]);
  });

  it('leaves unpainted paragraphs alone, tolerates a no-op, and stops at a refused write', async () => {
    expect(await stepMixedSizes(api(), [{ blockId: 'p1', range: { start: 0, end: 5 } }], 1, { host: document.createElement('div') })).toEqual({ changed: 0, skipped: 1 });
    const noop = vi.fn(async () => ({ success: false, failure: { code: 'NO_OP' } }));
    const changes = vi.fn();
    expect(await stepMixedSizes(api(noop), [{ blockId: 'p1', range: { start: 0, end: 5 } }], 1, { host: host([['Small', 32]]), onChange: changes })).toEqual({ changed: 1, skipped: 0 });
    // A write that changed nothing does not mark the document as changed.
    expect(changes).not.toHaveBeenCalled();
    const refused = vi.fn(async () => ({ success: false, failure: { message: 'Locked' } }));
    await expect(stepMixedSizes(api(refused), [{ blockId: 'p1', range: { start: 0, end: 5 } }], 1, { host: host([['Small', 32]]) })).rejects.toThrow('Locked');
    const before = vi.fn(() => { throw new Error('Switch to editing'); });
    await expect(stepMixedSizes(api(), [{ blockId: 'p1', range: { start: 0, end: 5 } }], 1, { host: host([['Small', 32]]), beforeWrite: before })).rejects.toThrow('Switch to editing');
  });

  it('keeps the ladder for single sizes', () => {
    expect(stepFontSize('12', 1)).toBe(14);
    expect(stepFontSize(24, -1)).toBe(20);
  });
});
