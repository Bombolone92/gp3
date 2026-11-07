import { describe, it, expect } from 'vitest';
import { BULLET_PRESETS, NUMBER_PRESETS, presetFor, failed, applyListPreset, restartList, continueList } from '../src/lib/lists.js';

function fakeApi({ states = {} } = {}) {
  const calls = [];
  return {
    calls,
    lists: {
      getState: async ({ target }) => states[target.nodeId] || { success: true, isListItem: false, numId: null, ilvl: 0 },
      apply: async (input) => { calls.push(['apply', input.target.nodeId, input.seed]); states[input.target.nodeId] = { success: true, isListItem: true, numId: 'n1', ilvl: 0, seed: input.seed }; return { success: true }; },
      applyPreset: async (input) => { calls.push(['preset', input.target.nodeId, input.target.nodeType, input.preset]); return { success: true }; },
      restart: async (input) => { calls.push(['restart', input.target.nodeId, input.startAt]); return { success: true }; },
      continue: async (input) => { calls.push(['continue', input.target.nodeId]); return { success: false, failure: { code: 'TARGET_NOT_FOUND' } }; },
    },
  };
}

describe('presetFor', () => {
  it('recognizes the stock bullets and number formats', () => {
    expect(presetFor({ isListItem: true, numFmt: 'bullet', lvlText: '•' })).toBe('disc');
    expect(presetFor({ isListItem: true, numFmt: 'bullet', lvlText: 'o' })).toBe('circle');
    expect(presetFor({ isListItem: true, numFmt: 'bullet', lvlText: '' })).toBe('disc');
    expect(presetFor({ isListItem: true, numFmt: 'decimal', lvlText: '%1.' })).toBe('decimal');
    expect(presetFor({ isListItem: true, numFmt: 'decimal', lvlText: '%1)' })).toBe('decimalParenthesis');
    expect(presetFor({ isListItem: true, numFmt: 'lowerRoman', lvlText: '%3.' })).toBe('lowerRoman');
  });

  it('returns null for plain paragraphs and custom formats', () => {
    expect(presetFor(null)).toBeNull();
    expect(presetFor({ isListItem: false })).toBeNull();
    expect(presetFor({ isListItem: true, numFmt: 'decimal', lvlText: 'Step %1:' })).toBeNull();
    expect(presetFor({ isListItem: true, numFmt: 'bullet', lvlText: '➢' })).toBeNull();
  });

  it('lists every preset once', () => {
    const ids = [...BULLET_PRESETS, ...NUMBER_PRESETS].map((p) => p.id);
    expect(new Set(ids).size).toBe(12);
  });
});

describe('applyListPreset', () => {
  it('seeds plain paragraphs with a list of the matching kind, then applies the preset', async () => {
    const api = fakeApi();
    await applyListPreset(api, ['p1'], 'square');
    expect(api.calls).toEqual([['apply', 'p1', 'bullet'], ['preset', 'p1', 'listItem', 'square']]);
    const api2 = fakeApi();
    await applyListPreset(api2, ['p1'], 'upperRoman');
    expect(api2.calls[0]).toEqual(['apply', 'p1', 'ordered']);
  });

  it('touches a shared list once and reports failures', async () => {
    const shared = { success: true, isListItem: true, numId: 'n9', ilvl: 0 };
    const api = fakeApi({ states: { a: shared, b: shared } });
    await applyListPreset(api, ['a', 'b'], 'dash');
    expect(api.calls).toEqual([['preset', 'a', 'listItem', 'dash']]);
    api.lists.applyPreset = async () => ({ success: false, failure: { code: 'X', message: 'nope' } });
    await expect(applyListPreset(api, ['a'], 'disc')).rejects.toThrow('nope');
  });
});

describe('restart and continue', () => {
  it('routes to the v2 list operations and explains a missing previous list', async () => {
    const api = fakeApi();
    await restartList(api, 'p1');
    expect(api.calls).toEqual([['restart', 'p1', 1]]);
    await expect(continueList(api, 'p1')).rejects.toThrow('no earlier list');
  });

  it('treats a no-op as success', () => {
    expect(failed({ success: false, failure: { code: 'NO_OP' } })).toBe(false);
    expect(failed({ success: false, failure: { code: 'PERMISSION_DENIED' } })).toBe(true);
    expect(failed(null)).toBe(true);
    expect(failed({ success: true })).toBe(false);
  });
});
