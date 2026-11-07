/**
 * The request timeout: a plain call gets the short one; a multipart upload
 * gets time in proportion to what it carries, so a large attachment on a
 * slow connection is not cut off and retried forever.
 */
import { describe, it, expect } from 'vitest';
import { timeoutFor, ApiError, isOldServer } from '../src/lib/api.js';

describe('timeoutFor', () => {
  it('keeps plain requests short', () => {
    expect(timeoutFor(null)).toBe(20_000);
  });

  it('scales with the bytes of an upload, within a ceiling', () => {
    const small = new FormData();
    small.append('file', new Blob(['x'.repeat(1000)]), 'a.txt');
    expect(timeoutFor(small)).toBe(20_020);
    const big = new FormData();
    big.append('file', new Blob([new Uint8Array(5 * 1024 * 1024)]), 'b.bin');
    expect(timeoutFor(big)).toBe(20_000 + Math.ceil((5 * 1024 * 1024) / 50));
    const huge = new FormData();
    huge.append('file', new Blob([new Uint8Array(20 * 1024 * 1024)]), 'c.bin');
    expect(timeoutFor(huge)).toBe(5 * 60_000);
  });
});

describe('isOldServer', () => {
  it('tells a worker built before a route from the route saying not found', () => {
    expect(isOldServer(new ApiError(404, 'no_backend', 'No Teamchat server answers at this address'))).toBe(true);
    expect(isOldServer(new ApiError(404, 'not_found', 'No such endpoint'))).toBe(true);
    expect(isOldServer(new ApiError(404, 'not_found', 'Conversation not found'))).toBe(false);
    expect(isOldServer(new ApiError(0, 'network', 'Could not reach the workspace server'))).toBe(false);
    expect(isOldServer(new Error('x'))).toBe(false);
  });
});
