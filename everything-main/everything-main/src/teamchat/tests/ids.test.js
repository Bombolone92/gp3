import { describe, it, expect } from 'vitest';
import { uid, inviteCode, normalizeInviteCode, dmConvId, colorSlot } from '../src/shared/ids.js';
import { cleanChannelName, cleanText, extractMentionNames, LIMITS } from '../src/shared/limits.js';

describe('ids', () => {
  it('uids are dot-free base36 of the requested length', () => {
    for (let i = 0; i < 50; i++) {
      const id = uid(10);
      expect(id).toMatch(/^[a-z0-9]{10}$/);
    }
    expect(new Set(Array.from({ length: 200 }, () => uid())).size).toBe(200);
  });

  it('invite codes are 12 symbols and normalize from any spacing or case', () => {
    const code = inviteCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normalizeInviteCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code);
    // Codes minted before the length change still normalize.
    expect(normalizeInviteCode('abc def ghj')).toBe('ABC-DEF-GHJ');
    expect(normalizeInviteCode('abc')).toBeNull();
    expect(normalizeInviteCode('ABCD-EFGH-JKLM-N')).toBeNull();
    expect(normalizeInviteCode('')).toBeNull();
    expect(new Set(Array.from({ length: 100 }, inviteCode)).size).toBe(100);
  });

  it('DM ids depend only on the set of members', () => {
    expect(dmConvId(['b', 'a'])).toBe(dmConvId(['a', 'b']));
    expect(dmConvId(['a', 'b', 'b'])).toBe(dmConvId(['a', 'b']));
    expect(dmConvId(['a', 'b'])).not.toBe(dmConvId(['a', 'c']));
    expect(dmConvId(['a', 'b'])).toMatch(/^dm_[a-z0-9]+$/);
    // Scoped to a workspace: the same two people in two workspaces get two conversations.
    expect(dmConvId(['a', 'b'], 'ws1')).toMatch(/^dm_[a-z0-9]+$/);
    expect(dmConvId(['a', 'b'], 'ws1')).not.toBe(dmConvId(['a', 'b']));
    expect(dmConvId(['a', 'b'], 'ws1')).not.toBe(dmConvId(['a', 'b'], 'ws2'));
    expect(dmConvId(['b', 'a'], 'ws1')).toBe(dmConvId(['a', 'b'], 'ws1'));
  });

  it('color slots are stable and in range', () => {
    for (const s of ['x', 'u-alice-0000', 'smp_ava', '']) {
      const slot = colorSlot(s);
      expect(slot).toBeGreaterThanOrEqual(1);
      expect(slot).toBeLessThanOrEqual(8);
      expect(colorSlot(s)).toBe(slot);
    }
  });
});

describe('limits', () => {
  it('cleans channel names', () => {
    expect(cleanChannelName('  Design Team ')).toBe('design-team');
    expect(cleanChannelName('Launch!! Q3')).toBe('launch-q3');
    expect(cleanChannelName('---')).toBeNull();
    expect(cleanChannelName('a'.repeat(100))).toHaveLength(LIMITS.channelName);
  });

  it('cleans text and clamps its length', () => {
    expect(cleanText('  hi\r\nthere  ', 100)).toBe('hi\nthere');
    expect(cleanText(42, 100)).toBe('');
    expect(cleanText('x'.repeat(10), 4)).toBe('xxxx');
  });

  it('extracts mention usernames once each, ignoring emails', () => {
    expect(extractMentionNames('hey @Alice and @bob, @alice again. mail me@example.com'))
      .toEqual(['alice', 'bob']);
    expect(extractMentionNames('no mentions here')).toEqual([]);
    expect(extractMentionNames('(@carol)')).toEqual(['carol']);
  });
});
