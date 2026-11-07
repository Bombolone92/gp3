// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { caretAtPoint, offsetInRun, blockStart, blockOffsetAtPoint, caretSelection, pointInRects, pointInSegments } from '../src/lib/caretpoint.js';

/** A painted page: one paragraph in two fragments (split across pages), one with two runs. */
function page() {
  const host = document.createElement('div');
  host.innerHTML = `
    <div class="document-page">
      <div class="document-fragment" data-source-node-id="p1" data-layout-block-ref="ref-p1" data-layout-story="body" data-pm-start="1" data-pm-end="20">
        <div class="document-line"><span class="document-text-run" data-pm-start="1" data-pm-end="9">He said </span><span class="document-text-run" data-pm-start="9" data-pm-end="20">"hi" there.</span></div>
      </div>
      <div class="document-fragment" data-source-node-id="p2" data-layout-block-ref="ref-p2" data-layout-story="body" data-pm-start="22" data-pm-end="30">
        <div class="document-line"><span class="document-text-run" data-pm-start="22" data-pm-end="30">First bit</span></div>
      </div>
    </div>
    <div class="document-page">
      <div class="document-fragment" data-source-node-id="p2" data-layout-block-ref="ref-p2" data-layout-story="body" data-pm-start="30" data-pm-end="40">
        <div class="document-line"><span class="document-text-run" data-pm-start="30" data-pm-end="40">second bit</span></div>
      </div>
      <div class="document-fragment" data-source-node-id="h1" data-layout-block-ref="ref-h1" data-layout-story="header" data-pm-start="1" data-pm-end="5">
        <div class="document-line"><span class="document-text-run" data-pm-start="1" data-pm-end="5">Head</span></div>
      </div>
    </div>`;
  document.body.append(host);
  return host;
}

describe('caret from point', () => {
  it('maps a point inside a run to the block and text offset', () => {
    const host = page();
    const runs = host.querySelectorAll('.document-text-run');
    const at = (run, offset) => () => ({ node: run.firstChild, offset });
    expect(blockOffsetAtPoint(host, 0, 0, { caret: at(runs[0], 3) })).toEqual({ blockId: 'p1', offset: 3, story: 'body' });
    expect(blockOffsetAtPoint(host, 0, 0, { caret: at(runs[1], 2) })).toEqual({ blockId: 'p1', offset: 10, story: 'body' });
    // The second fragment of a split paragraph counts from the paragraph's start.
    expect(blockOffsetAtPoint(host, 0, 0, { caret: at(runs[3], 4) })).toEqual({ blockId: 'p2', offset: 12, story: 'body' });
    // Header text is not body text.
    expect(blockOffsetAtPoint(host, 0, 0, { caret: at(runs[4], 1) })).toBeNull();
    expect(blockOffsetAtPoint(host, 0, 0, { caret: () => null })).toBeNull();
    expect(blockOffsetAtPoint(host, 0, 0, { caret: () => ({ node: document.body, offset: 0 }) })).toBeNull();
    host.remove();
  });

  it('counts characters before a node inside a run and reads fragment starts', () => {
    const run = document.createElement('span');
    run.innerHTML = 'ab<i>cd</i>ef';
    expect(offsetInRun(run, run.childNodes[2], 1)).toBe(5);
    expect(offsetInRun(run, run.childNodes[1].firstChild, 1)).toBe(3);
    expect(offsetInRun(run, run, 2)).toBe(4);
    const host = page();
    expect(blockStart(host, 'ref-p2', 99)).toBe(22);
    expect(blockStart(host, 'missing', 99)).toBe(99);
    host.remove();
  });

  it('counts preceding text at every nesting level within a painted run', () => {
    const run = document.createElement('span');
    run.innerHTML = 'ab<span>cd<strong>ef<em>gh</em>ij</strong>kl</span>mn';
    const strong = run.querySelector('strong');
    const em = run.querySelector('em');
    expect(offsetInRun(run, em.firstChild, 1)).toBe(7);
    expect(offsetInRun(run, strong.lastChild, 1)).toBe(9);
    expect(offsetInRun(run, strong, 2)).toBe(8);
    expect(offsetInRun(run, run.lastChild, 1)).toBe(13);
  });

  it('builds a collapsed selection and tests points against rectangles', () => {
    expect(caretSelection({ blockId: 'p1', offset: 4 })).toEqual({
      kind: 'selection',
      start: { kind: 'text', blockId: 'p1', offset: 4, story: { kind: 'story', storyType: 'body' } },
      end: { kind: 'text', blockId: 'p1', offset: 4, story: { kind: 'story', storyType: 'body' } },
      story: { kind: 'story', storyType: 'body' },
    });
    const rects = [{ left: 10, top: 10, width: 100, height: 20 }, { left: 10, top: 40, width: 0, height: 20 }];
    expect(pointInRects(rects, 50, 20)).toBe(true);
    expect(pointInRects(rects, 5, 20)).toBe(false);
    expect(pointInRects(rects, 10, 45)).toBe(false);
    expect(pointInRects(null, 1, 1)).toBe(false);
    const segments = [{ blockId: 'p1', range: { start: 6, end: 11 } }, { blockId: 'p2', range: { start: 0, end: 3 } }];
    expect(pointInSegments(segments, { blockId: 'p1', offset: 8 })).toBe(true);
    expect(pointInSegments(segments, { blockId: 'p1', offset: 11 })).toBe(true);
    expect(pointInSegments(segments, { blockId: 'p1', offset: 12 })).toBe(false);
    expect(pointInSegments(segments, { blockId: 'p3', offset: 1 })).toBe(false);
    expect(pointInSegments(segments, null)).toBe(false);
  });

  it('falls back from caretPositionFromPoint to caretRangeFromPoint', () => {
    const node = document.createTextNode('x');
    expect(caretAtPoint(1, 1, { caretPositionFromPoint: () => ({ offsetNode: node, offset: 1 }) })).toEqual({ node, offset: 1 });
    expect(caretAtPoint(1, 1, { caretRangeFromPoint: () => ({ startContainer: node, startOffset: 0 }) })).toEqual({ node, offset: 0 });
    expect(caretAtPoint(1, 1, {})).toBeNull();
  });
});
