import { describe, it, expect } from 'vitest';
import { stakeholderIdFromHash } from '../src/views/stakeholder.js';

describe('stakeholderIdFromHash', () => {
  it('reads the id out of a detail route', () => {
    expect(stakeholderIdFromHash('#/stakeholders/abc123')).toBe('abc123');
    expect(stakeholderIdFromHash('#/stakeholders/abc123?x=1')).toBe('abc123');
    expect(stakeholderIdFromHash('#/stakeholders/a%20b')).toBe('a b');
  });

  it('survives a malformed percent-escape instead of throwing', () => {
    expect(stakeholderIdFromHash('#/stakeholders/%')).toBe('%');
    expect(stakeholderIdFromHash('#/stakeholders/%zz')).toBe('%zz');
  });

  it('is null on the list route and elsewhere', () => {
    expect(stakeholderIdFromHash('#/stakeholders')).toBeNull();
    expect(stakeholderIdFromHash('#/stakeholders/')).toBeNull();
    expect(stakeholderIdFromHash('#/cap-table')).toBeNull();
    expect(stakeholderIdFromHash('')).toBeNull();
  });
});
