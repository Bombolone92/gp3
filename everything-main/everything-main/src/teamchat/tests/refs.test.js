/**
 * Workspace references and invite parsing: a link or a code must carry the
 * worker a workspace lives on, and round-trip without loss.
 */
import { describe, it, expect } from 'vitest';
import { serverKeyOf, serverUrl, makeRef, parseRef, makeInviteToken, trustServer, isTrustedServer } from '../src/lib/refs.js';
import { parseHash, buildHash, parseInviteInput, parseConnectInput } from '../src/lib/router.js';

describe('server keys', () => {
  it('shortens puter.work hosts and keeps others whole', () => {
    expect(serverKeyOf('https://teamchat-x7k2q9pw1a.puter.work')).toBe('teamchat-x7k2q9pw1a');
    expect(serverKeyOf('https://teamchat-x7k2q9pw1a.puter.work/')).toBe('teamchat-x7k2q9pw1a');
    expect(serverKeyOf('https://api.example.com/base')).toBe('api.example.com');
    expect(serverKeyOf('')).toBeNull();
  });

  it('round-trips puter.work workers through serverUrl', () => {
    expect(serverUrl(serverKeyOf('https://teamchat-abc.puter.work'))).toBe('https://teamchat-abc.puter.work');
    expect(serverUrl('teamchat-abc.puter.work')).toBe('https://teamchat-abc.puter.work');
    expect(serverUrl('')).toBeNull();
  });

  it('files a reference to a puter.work host under the worker\'s short name', () => {
    // Typed the long way, a reference must compare equal to what the worker's
    // own answer is filed under, or the workspace would appear twice.
    expect(parseRef('abc123def0@teamchat-abc.puter.work')).toEqual({ id: 'abc123def0', server: 'teamchat-abc', url: 'https://teamchat-abc.puter.work' });
    expect(parseRef('abc123def0@Teamchat-ABC.puter.work').server).toBe(parseRef('abc123def0@teamchat-abc').server);
    expect(parseInviteInput('ABCD-EFGH-JKLM@teamchat-abc.puter.work').server).toBe('teamchat-abc');
    expect(parseConnectInput('ABCD-EFGH-JKLM@teamchat-abc.puter.work').server).toBe('teamchat-abc');
  });

  it('only resolves a host outside puter.work once the app was told about it', () => {
    // exec() attaches the user's Puter token to whatever URL it is given, so
    // a link must not be able to point the app at an arbitrary host.
    expect(isTrustedServer('teamchat-abc')).toBe(true);
    expect(isTrustedServer('api.example.com')).toBe(false);
    expect(serverUrl('api.example.com')).toBeNull();
    expect(serverUrl('evil.example:8443')).toBeNull();
    expect(parseRef('abc123def0@api.example.com')).toBeNull();
    expect(trustServer('https://api.example.com/')).toBe('api.example.com');
    expect(isTrustedServer('api.example.com')).toBe(true);
    expect(serverUrl('api.example.com')).toBe('https://api.example.com');
    expect(parseRef('abc123def0@API.example.com')).toEqual({ id: 'abc123def0', server: 'api.example.com', url: 'https://api.example.com' });
    // Trusting a puter.work URL changes nothing: those always resolve.
    expect(trustServer('https://teamchat-xyz.puter.work')).toBe('teamchat-xyz');
    expect(serverUrl('teamchat-xyz')).toBe('https://teamchat-xyz.puter.work');
  });
});

describe('workspace refs', () => {
  it('parses id and server', () => {
    const ref = makeRef('abc123def0', 'teamchat-x7k2q9pw1a');
    expect(ref).toBe('abc123def0@teamchat-x7k2q9pw1a');
    expect(parseRef(ref)).toEqual({ id: 'abc123def0', server: 'teamchat-x7k2q9pw1a', url: 'https://teamchat-x7k2q9pw1a.puter.work' });
    expect(parseRef('abc123def0@teamchat-api.mock')).toBeNull(); // a host nobody configured
    trustServer('https://teamchat-api.mock');
    expect(parseRef('abc123def0@teamchat-api.mock').url).toBe('https://teamchat-api.mock');
  });

  it('rejects malformed refs', () => {
    expect(parseRef('abc123def0')).toBeNull();
    expect(parseRef('@teamchat-x')).toBeNull();
    expect(parseRef('ab@teamchat-x')).toBeNull(); // id too short
    expect(parseRef('abc123def0@bad host')).toBeNull();
    expect(parseRef('')).toBeNull();
  });

  it('does not throw on a link whose escapes were mangled', () => {
    // A search link cut short by a mail client, or a stray percent sign:
    // the segment stays as typed instead of taking the whole app down.
    expect(parseHash('#/ws/abc123def0@teamchat-x/search/hello%2')).toMatchObject({ name: 'search', query: 'hello%2' });
    expect(parseHash('#/ws/abc123def0@teamchat-x/c/gen%ZZ')).toMatchObject({ name: 'conversation', conv: 'gen%ZZ' });
    expect(parseInviteInput('https://app.example/#/join/teamchat-abc/ABCD-EFGH-JKLM%')).toEqual({ code: 'ABCD-EFGH-JKLM', server: 'teamchat-abc' });
  });

  it('survives the hash router', () => {
    const ref = 'abc123def0@teamchat-x7k2q9pw1a';
    const h = buildHash({ ws: ref, conv: 'general01', thread: 42 });
    const r = parseHash(h);
    expect(r).toMatchObject({ name: 'conversation', ws: ref, conv: 'general01', thread: 42 });
  });
});

describe('invites', () => {
  it('builds join links with the server and parses them back', () => {
    const h = buildHash({ server: 'teamchat-abc', code: 'ABCD-EFGH-JKLM' });
    expect(h).toBe('#/join/teamchat-abc/ABCD-EFGH-JKLM');
    expect(parseHash(h)).toMatchObject({ name: 'join', server: 'teamchat-abc', code: 'ABCD-EFGH-JKLM' });
    // Links from the single-worker era have no server.
    expect(parseHash('#/join/ABCD-EFGH-JKLM')).toMatchObject({ name: 'join', server: null, code: 'ABCD-EFGH-JKLM' });
  });

  it('reads a pasted link, token, or bare code', () => {
    expect(parseInviteInput('https://app.example/teamchat/#/join/teamchat-abc/abcd-efgh-jklm'))
      .toEqual({ code: 'ABCD-EFGH-JKLM', server: 'teamchat-abc' });
    expect(parseInviteInput(makeInviteToken('ABCD-EFGH-JKLM', 'teamchat-abc')))
      .toEqual({ code: 'ABCD-EFGH-JKLM', server: 'teamchat-abc' });
    expect(parseInviteInput(' abcd efgh jklm @ TEAMCHAT-ABC '))
      .toEqual({ code: 'ABCD-EFGH-JKLM', server: 'teamchat-abc' });
    expect(parseInviteInput('ABCD-EFGH-JKLM@https://teamchat-abc.puter.work'))
      .toEqual({ code: 'ABCD-EFGH-JKLM', server: 'teamchat-abc' });
    expect(parseInviteInput('ABCD-EFGH-JKLM')).toEqual({ code: 'ABCD-EFGH-JKLM', server: null });
    expect(parseInviteInput('https://app.example/#/join/ABCD-EFGH-JKLM')).toEqual({ code: 'ABCD-EFGH-JKLM', server: null });
    expect(parseInviteInput('hello')).toBeNull();
    expect(parseInviteInput('')).toBeNull();
  });
});

describe('share links (shared channels)', () => {
  it('build and parse a connect route of their own, apart from invites', () => {
    const h = buildHash({ server: 'teamchat-abc', code: 'ABCD-EFGH-JKLM', connect: true });
    expect(h).toBe('#/connect/teamchat-abc/ABCD-EFGH-JKLM');
    expect(parseHash(h)).toMatchObject({ name: 'connect', server: 'teamchat-abc', code: 'ABCD-EFGH-JKLM' });
    // Without the flag the same code builds an invite link, as before.
    expect(buildHash({ server: 'teamchat-abc', code: 'ABCD-EFGH-JKLM' })).toBe('#/join/teamchat-abc/ABCD-EFGH-JKLM');
    // A share link that lost its server part is still a share link, with no server: the app then says it is not valid (see handleConnect) rather than landing at home in silence.
    expect(parseHash('#/connect/ABCD-EFGH-JKLM')).toMatchObject({ name: 'connect', server: null, code: 'ABCD-EFGH-JKLM' });
  });

  it('reads a pasted share link or token, never a plain invite link', () => {
    expect(parseConnectInput('https://app.example/teamchat/#/connect/teamchat-abc/abcd-efgh-jklm'))
      .toEqual({ code: 'ABCD-EFGH-JKLM', server: 'teamchat-abc' });
    expect(parseConnectInput(makeInviteToken('ABCD-EFGH-JKLM', 'teamchat-abc')))
      .toEqual({ code: 'ABCD-EFGH-JKLM', server: 'teamchat-abc' });
    expect(parseConnectInput('https://app.example/#/join/teamchat-abc/ABCD-EFGH-JKLM')).toBeNull();
    expect(parseConnectInput('ABCD-EFGH-JKLM')).toBeNull();
    expect(parseConnectInput('')).toBeNull();
  });
});
