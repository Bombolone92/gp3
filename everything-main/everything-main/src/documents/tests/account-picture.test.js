// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '../src/lib/session.js';
import * as P from '../src/lib/puter.js';

const picture = 'data:image/png;base64,aGVsbG8=';
let auth;

beforeEach(async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  auth = {
    isSignedIn: vi.fn(() => true),
    getUser: async () => ({ username: 'alex', uuid: 'alex-id' }),
    getProfilePicture: vi.fn(async () => picture),
  };
  vi.stubGlobal('puter', { auth });
  await session.refresh();
});

afterEach(async () => {
  auth.isSignedIn.mockReturnValue(false);
  await session.refresh();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shares an in-flight lookup without delaying session initialization', async () => {
  let resolve;
  auth.getProfilePicture.mockImplementation(() => new Promise(r => { resolve = r; }));
  const first = session.getProfilePicture(), second = session.getProfilePicture();
  await session.init();
  expect(session.signedIn).toBe(true);
  expect(auth.getProfilePicture).toHaveBeenCalledExactlyOnceWith();
  resolve(picture);
  expect(await Promise.all([first, second])).toEqual([picture, picture]);
  expect(await session.getProfilePicture()).toBe(picture);
  expect(auth.getProfilePicture).toHaveBeenCalledOnce();
});

it('reuses the picture across refreshes and theme changes, then expires it on demand', async () => {
  vi.useFakeTimers();
  expect(await session.getProfilePicture()).toBe(picture);
  await session.refresh();
  session.setTheme('light');
  vi.advanceTimersByTime(5 * 60_000 - 1);
  expect(await session.getProfilePicture()).toBe(picture);
  expect(auth.getProfilePicture).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1);
  auth.getProfilePicture.mockResolvedValue(null);
  expect(await session.getProfilePicture()).toBeNull();
  expect(auth.getProfilePicture).toHaveBeenCalledTimes(2);
});

it.each(['missing', 'failed'])('caches a %s picture briefly before retrying', async (kind) => {
  vi.useFakeTimers();
  if (kind === 'failed') auth.getProfilePicture.mockRejectedValue(new Error('offline'));
  else auth.getProfilePicture.mockResolvedValue(null);
  expect(await session.getProfilePicture()).toBeNull();
  vi.advanceTimersByTime(60_000 - 1);
  expect(await session.getProfilePicture()).toBeNull();
  expect(auth.getProfilePicture).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1);
  auth.getProfilePicture.mockResolvedValue(picture);
  expect(await session.getProfilePicture()).toBe(picture);
  expect(auth.getProfilePicture).toHaveBeenCalledTimes(2);
});

it('discards late responses when switching accounts, even with the same display name', async () => {
  let resolve;
  auth.getProfilePicture.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const old = session.getProfilePicture();
  session.signedInAs({ username: 'alex', uuid: 'another-id' });
  auth.getProfilePicture.mockResolvedValue(null);
  expect(await session.getProfilePicture()).toBeNull();
  resolve(picture);
  expect(await old).toBeNull();
  expect(await session.getProfilePicture()).toBeNull();
  expect(auth.getProfilePicture).toHaveBeenCalledTimes(2);
});

it('clears the cache on sign-out and ignores pending results after signing back in', async () => {
  let resolve;
  auth.getProfilePicture.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const old = session.getProfilePicture();
  auth.isSignedIn.mockReturnValue(false);
  await session.refresh();
  expect(await session.getProfilePicture()).toBeNull();
  expect(auth.getProfilePicture).toHaveBeenCalledOnce();
  auth.isSignedIn.mockReturnValue(true);
  await session.refresh();
  auth.getProfilePicture.mockResolvedValue(null);
  expect(await session.getProfilePicture()).toBeNull();
  resolve(picture);
  expect(await old).toBeNull();
  expect(await session.getProfilePicture()).toBeNull();
});

it('does not look up pictures until a signed-in account is known', async () => {
  session.state = 'unknown';
  expect(await session.getProfilePicture()).toBeNull();
  session.signedInAs(null);
  session.user = null;
  expect(await session.getProfilePicture()).toBeNull();
  expect(auth.getProfilePicture).not.toHaveBeenCalled();
});

describe('optional SDK support', () => {
  it('works without the SDK or a profile picture method', async () => {
    delete auth.getProfilePicture;
    expect(await P.getProfilePicture()).toBeNull();
    vi.stubGlobal('puter', undefined);
    expect(await P.getProfilePicture()).toBeNull();
  });

  it.each([null, {}, 'https://example.com/photo.png', 'data:text/html;base64,aGVsbG8='])('rejects unexpected picture values: %s', async (value) => {
    auth.getProfilePicture.mockResolvedValue(value);
    expect(await P.getProfilePicture()).toBeNull();
  });
});
