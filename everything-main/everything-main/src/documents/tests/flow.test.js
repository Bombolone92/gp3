import { describe, it, expect } from 'vitest';
import { FLOW_OPTIONS, FLOW_DEFAULTS, flowFromProps, flowKnown, applyFlow, parseFlowFlags } from '../src/lib/flow.js';

describe('line and page breaks', () => {
  it('lists the four supported options', () => {
    expect(FLOW_OPTIONS.map((o) => o.id)).toEqual(['keepNext', 'keepLines', 'widowControl', 'pageBreakBefore']);
    expect(FLOW_DEFAULTS).toEqual({ keepNext: false, keepLines: false, widowControl: true, pageBreakBefore: false });
  });

  it('reads props when the paragraph sets them and falls back to defaults otherwise', () => {
    expect(flowFromProps(null)).toEqual(FLOW_DEFAULTS);
    expect(flowFromProps({ keepWithNext: true, widowControl: false })).toEqual({ keepNext: true, keepLines: false, widowControl: false, pageBreakBefore: false });
    expect(flowFromProps({ keepNext: true, pageBreakBefore: true, keepLines: 'yes' })).toEqual({ keepNext: true, keepLines: false, widowControl: true, pageBreakBefore: true });
  });

  it('tells which options the paragraph sets itself', () => {
    expect(flowKnown(null)).toEqual({ keepNext: false, keepLines: false, widowControl: false, pageBreakBefore: false });
    expect(flowKnown({ keepWithNext: false, widowControl: true, keepLines: 'yes' })).toEqual({ keepNext: true, keepLines: false, widowControl: true, pageBreakBefore: false });
  });

  it('applies only the options named, to every paragraph', async () => {
    const calls = [];
    const api = { format: { paragraph: {
      setKeepOptions: async (i) => { calls.push(['keep', i.target.nodeId, { ...i, target: undefined }]); return { success: true }; },
      setFlowOptions: async (i) => { calls.push(['flow', i.target.nodeId, i.pageBreakBefore]); return { success: true }; },
    } } };
    expect(await applyFlow(api, ['a', 'b'], { keepNext: true, pageBreakBefore: true })).toBe(2);
    // An option left out is not written: the paragraph keeps what its style says for it.
    expect(calls).toEqual([
      ['keep', 'a', { keepNext: true }], ['flow', 'a', true],
      ['keep', 'b', { keepNext: true }], ['flow', 'b', true],
    ]);
    calls.length = 0;
    expect(await applyFlow(api, ['a'], { widowControl: false })).toBe(1);
    expect(calls).toEqual([['keep', 'a', { widowControl: false }]]);
    expect(await applyFlow(api, ['a'], {})).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('stops at the first rejected write but tolerates no-ops', async () => {
    const api = { format: { paragraph: {
      setKeepOptions: async () => ({ success: false, failure: { code: 'NO_OP' } }),
      setFlowOptions: async (i) => (i.target.nodeId === 'b' ? { success: false, failure: { message: 'locked' } } : { success: true }),
    } } };
    await expect(applyFlow(api, ['a', 'b', 'c'], { keepNext: true, pageBreakBefore: false })).rejects.toThrow('locked');
  });
});

describe('flow flags read from the paragraph XML', () => {
  it('takes a present element as on, an off value as off, and leaves out what the XML does not mention', () => {
    expect(parseFlowFlags('<w:keepNext/><w:pageBreakBefore/><w:widowControl w:val="0"/><w:spacing w:after="0"/>')).toEqual({ keepNext: true, pageBreakBefore: true, widowControl: false });
    expect(parseFlowFlags('<w:keepLines w:val="false"/><w:keepNext w:val="true"/><w:widowControl w:val="off"/>')).toEqual({ keepLines: false, keepNext: true, widowControl: false });
    expect(parseFlowFlags('<w:jc w:val="center"/>')).toEqual({});
    expect(parseFlowFlags(null)).toEqual({});
    expect(parseFlowFlags('')).toEqual({});
    // A namespace declaration a serializer adds does not hide the flag.
    expect(parseFlowFlags('<w:pPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:keepNext xmlns:w="x"/></w:pPr>')).toEqual({ keepNext: true });
  });
});
