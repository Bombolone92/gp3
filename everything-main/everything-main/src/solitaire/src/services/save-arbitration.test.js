import { describe, it, expect } from 'vitest';
import { shouldAdoptRemote } from './save-arbitration.js';

describe('shouldAdoptRemote', () => {
  it('never adopts once the player owns the board, no matter how much newer the remote is', () => {
    expect(shouldAdoptRemote({ bootTs: 0, remoteTs: 999999, playerOwnsBoard: true })).toBe(false);
  });

  it('adopts when the remote is newer and the player is idle', () => {
    expect(shouldAdoptRemote({ bootTs: 100, remoteTs: 200, playerOwnsBoard: false })).toBe(true);
  });

  it('does not adopt when the remote is older than the boot save', () => {
    expect(shouldAdoptRemote({ bootTs: 200, remoteTs: 100, playerOwnsBoard: false })).toBe(false);
  });

  it('does not adopt when the remote and boot timestamps are equal', () => {
    expect(shouldAdoptRemote({ bootTs: 100, remoteTs: 100, playerOwnsBoard: false })).toBe(false);
  });

  it('treats a missing boot timestamp as 0', () => {
    expect(shouldAdoptRemote({ remoteTs: 1, playerOwnsBoard: false })).toBe(true);
  });

  it('treats a missing remote timestamp as 0, so it never beats an existing boot save', () => {
    expect(shouldAdoptRemote({ bootTs: 1, playerOwnsBoard: false })).toBe(false);
  });

  it('treats both timestamps missing as 0 vs 0, which is not "newer"', () => {
    expect(shouldAdoptRemote({ playerOwnsBoard: false })).toBe(false);
  });
});
