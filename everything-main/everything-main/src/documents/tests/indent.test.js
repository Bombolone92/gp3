import { describe, it, expect } from 'vitest';
import { ptToUnit, unitToTwips, indentFromProps, indentToPayload, applyIndent } from '../src/lib/indent.js';

describe('indent units', () => {
  it('converts points to inches or centimeters and back to twips', () => {
    expect(ptToUnit(36, 'in')).toBe(0.5);
    expect(ptToUnit(72, 'cm')).toBe(2.54);
    expect(ptToUnit(undefined, 'in')).toBe(0);
    expect(unitToTwips(0.5, 'in')).toBe(720);
    expect(unitToTwips('1,27', 'cm')).toBe(720);
    expect(unitToTwips('abc', 'in')).toBeNull();
  });

  it('reads the special indent from paragraph props', () => {
    expect(indentFromProps({ left: 36, right: 0, firstLine: 18 }, 'in')).toEqual({ left: 0.5, right: 0, special: 'firstLine', by: 0.25 });
    expect(indentFromProps({ left: 36, right: 0, hanging: 18 }, 'in')).toEqual({ left: 0.5, right: 0, special: 'hanging', by: 0.25 });
    // What the paragraph does not set itself comes from its style or list: an empty field, and no special indent chosen.
    expect(indentFromProps({ left: 36, firstLine: 18 }, 'in')).toEqual({ left: 0.5, right: '', special: 'firstLine', by: 0.25 });
    expect(indentFromProps({ left: 36, firstLine: 0 }, 'in')).toEqual({ left: 0.5, right: '', special: 'none', by: 0 });
    expect(indentFromProps(null, 'in')).toEqual({ left: '', right: '', special: 'inherit', by: 0 });
  });

  it.each(['in', 'cm'])('preserves twip precision through dialog values in %s', (unit) => {
    for (const twips of [1, 5, 200, 1001, 1440]) {
      const values = indentFromProps({ left: twips / 20, right: -twips / 20, hanging: twips / 20 }, unit);
      expect(indentToPayload(values, unit)).toEqual({ left: twips, right: -twips, hanging: twips });
      expect(values.by).toBeGreaterThan(0);
    }
  });

  it('builds a payload in twips and rejects bad values', () => {
    expect(indentToPayload({ left: 1, right: 0, special: 'hanging', by: 0.5 }, 'in')).toEqual({ left: 1440, right: 0, hanging: 720 });
    expect(indentToPayload({ left: 0, right: 0, special: 'firstLine', by: 0.25 }, 'in')).toEqual({ left: 0, right: 0, firstLine: 360 });
    expect(indentToPayload({ left: 0.5, right: 0.5, special: 'none', by: 9 }, 'in')).toEqual({ left: 720, right: 720, firstLine: 0 });
    expect(indentToPayload({ left: 0, right: 0, special: 'hanging', by: 0 }, 'in')).toEqual({ left: 0, right: 0, firstLine: 0 });
    expect(indentToPayload({ left: -1, right: -0.5, special: 'none', by: 0 }, 'in')).toEqual({ left: -1440, right: -720, firstLine: 0 });
    expect(indentToPayload({ left: '-2,54', right: '-1,27', special: 'hanging', by: 1.27 }, 'cm')).toEqual({ left: -1440, right: -720, hanging: 720 });
    expect(indentToPayload({ left: -23, right: 0, special: 'none', by: 0 }, 'in')).toBeNull();
    expect(indentToPayload({ left: 0, right: -23, special: 'none', by: 0 }, 'in')).toBeNull();
    expect(indentToPayload({ left: 0, right: 0, special: 'hanging', by: -1 }, 'in')).toBeNull();
    expect(indentToPayload({ left: 'x', right: 0, special: 'none', by: 0 }, 'in')).toBeNull();
    expect(indentToPayload({ left: 30, right: 0, special: 'none', by: 0 }, 'in')).toBeNull();
  });

  it('leaves empty fields and an unchosen special indent out of the payload', () => {
    expect(indentToPayload({ left: '', right: '', special: 'inherit', by: 0 }, 'in')).toEqual({});
    expect(indentToPayload({ left: 1, right: NaN, special: 'inherit', by: 0.5 }, 'in')).toEqual({ left: 1440 });
    expect(indentToPayload({ left: '', right: 0.5, special: 'hanging', by: 0.25 }, 'in')).toEqual({ right: 720, hanging: 360 });
    expect(indentToPayload({ left: '', right: '', special: 'none', by: 0 }, 'in')).toEqual({ firstLine: 0 });
    expect(indentToPayload({ left: 'x', right: '', special: 'inherit', by: 0 }, 'in')).toBeNull();
  });

  it('applies the payload to each paragraph', async () => {
    const calls = [];
    const api = { format: { paragraph: { setIndentation: async (input) => { calls.push(input); return { success: true }; } } } };
    await applyIndent(api, ['a', 'b'], { left: 720, right: 0, firstLine: 0 });
    expect(calls.map((c) => c.target.nodeId)).toEqual(['a', 'b']);
    expect(calls[0]).toMatchObject({ left: 720, target: { kind: 'block', nodeType: 'paragraph' } });
    api.format.paragraph.setIndentation = async () => ({ success: false, failure: { message: 'no' } });
    await expect(applyIndent(api, ['a'], { left: 0 })).rejects.toThrow('no');
  });
});
