/**
 * What the UI says about a shared channel: the workspaces in it and the
 * banner above the composer, from either side, before and after the host
 * has answered.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { store } from '../src/lib/store.js';
import { organizationsOf, otherOrganizations, sharedSummary, sharedBannerText, sharedPillText } from '../src/ui/shared.js';

afterEach(() => {
  store.wsId = null;
  store.ws = null;
});

describe('the workspaces in a shared channel', () => {
  it('lists none for a channel that is not shared', () => {
    expect(organizationsOf({ id: 'c', name: 'general', count: 4 })).toEqual([]);
    expect(sharedBannerText({ id: 'c', name: 'general', count: 4 })).toBe('');
  });

  it('from the host: this workspace first, then each partner with how many of its people are here', () => {
    store.wsId = 'acme000000@teamchat-test';
    store.ws = { id: 'acme000000', name: 'Acme' };
    const ch = { id: 'c', name: 'design', count: 6, connections: { k1: { ref: 'glob000000@teamchat-test', name: 'Globex', count: 2 }, k2: { ref: 'init000000@teamchat-test', name: 'Initech', count: 1 } } };
    expect(organizationsOf(ch)).toEqual([
      { name: 'Acme', ref: store.wsId, count: 3, owner: true, us: true },
      { conn: 'k1', name: 'Globex', ref: 'glob000000@teamchat-test', count: 2, us: false },
      { conn: 'k2', name: 'Initech', ref: 'init000000@teamchat-test', count: 1, us: false },
    ]);
    expect(sharedSummary(ch)).toBe('Shared with Globex and Initech');
    expect(sharedBannerText(ch)).toBe('This channel is shared with Globex (2 people) and Initech (1 person). What is posted here is read outside this workspace.');
    // The pill names the other side when there is one, counts them otherwise.
    expect(sharedPillText(ch)).toBe('2 workspaces');
    expect(sharedPillText({ ...ch, connections: { k1: ch.connections.k1 } })).toBe('Globex');
    expect(sharedPillText({ id: 'c', name: 'design', count: 1, connections: {} })).toBe('Shared');
  });

  it('from a partner, once the host has answered: the host first, and this workspace marked as ours', () => {
    store.wsId = 'glob000000@teamchat-test';
    store.ws = { id: 'glob000000', name: 'Globex' };
    const ch = {
      id: 'e', name: 'design-acme', count: 6, hostName: 'design', shared: { ref: 'acme000000@teamchat-test', ch: 'c', conn: 'k1', host: 'Acme' },
      connections: { k1: { ref: 'glob000000@teamchat-test', name: 'Globex', count: 2 }, k2: { ref: 'init000000@teamchat-test', name: 'Initech', count: 1 } },
    };
    expect(organizationsOf(ch).map((o) => [o.name, o.count, !!o.owner, !!o.us])).toEqual([['Acme', 3, true, false], ['Globex', 2, false, true], ['Initech', 1, false, false]]);
    expect(sharedSummary(ch)).toBe('Shared by Acme');
    expect(sharedBannerText(ch)).toBe('This channel is hosted by Acme and shared with your workspace: 4 people from outside it can read everything here.');
    expect(sharedPillText(ch)).toBe('Acme');
  });

  it('from a partner, before the host has answered: the host with no count (the entry\'s own count is this workspace\'s people), and no banner', () => {
    store.wsId = 'glob000000@teamchat-test';
    store.ws = { id: 'glob000000', name: 'Globex' };
    // count: 2 here is the two people of Globex in the entry, not the host's channel.
    const ch = { id: 'e', name: 'design-acme', count: 2, shared: { ref: 'acme000000@teamchat-test', ch: 'c', conn: 'k1', host: 'Acme' } };
    expect(organizationsOf(ch)).toEqual([
      { name: 'Acme', ref: 'acme000000@teamchat-test', count: null, owner: true },
      { name: 'Globex', ref: store.wsId, count: 2, us: true },
    ]);
    expect(otherOrganizations(ch).map((o) => o.name)).toEqual(['Acme']);
    expect(sharedSummary(ch)).toBe('Shared by Acme');
    expect(sharedBannerText(ch)).toBe('');
  });
});
