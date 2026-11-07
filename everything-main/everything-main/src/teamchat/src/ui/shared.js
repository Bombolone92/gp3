/**
 * What the UI says about a shared channel: the workspaces in it, as the
 * "Organizations" card lists them, and the line above the composer. Shared
 * by the conversation header, its strips, and the details dialog.
 */
import { store } from '../lib/store.js';
import { isSharedChannel } from './icons.js';

/**
 * The workspaces a channel is shared between: the host first (marked
 * `owner`), then each connected workspace with how many of its people are
 * in the channel. `us` marks the reader's own workspace. Empty for a channel
 * that is not shared.
 */
export function organizationsOf(ch) {
  if (!isSharedChannel(ch)) return [];
  if (ch.shared && ch.hostName === undefined) {
    // The host has not answered yet (the member is not in the entry, or it
    // is still connecting): who else is in the channel, and how many, is
    // not known; the entry's own count is the people of this workspace.
    return [
      { name: ch.shared.host || 'Another workspace', ref: ch.shared.ref, count: null, owner: true },
      { name: store.ws?.name || 'This workspace', ref: store.wsId, count: ch.count || 0, us: true },
    ];
  }
  const conns = Object.entries(ch.connections || {}).map(([conn, c]) => ({
    conn, name: c.name || 'Another workspace', ref: c.ref, count: c.count || 0, us: !!c.ref && c.ref === store.wsId,
  }));
  const external = conns.reduce((n, c) => n + c.count, 0);
  const hostCount = Math.max(0, (ch.count || 0) - external);
  if (ch.shared) return [{ name: ch.shared.host || ch.hostName || 'Another workspace', ref: ch.shared.ref, count: hostCount, owner: true }, ...conns];
  return [{ name: store.ws?.name || 'This workspace', ref: store.wsId, count: hostCount, owner: true, us: true }, ...conns];
}

/** The other workspaces in a channel, from the reader's side. */
export function otherOrganizations(ch) {
  return organizationsOf(ch).filter((o) => !o.us);
}

function people(n) {
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

/**
 * The pill beside a shared channel's name: the other side, from the
 * reader's point of view. For a channel hosted elsewhere, its host; for one
 * hosted here, the workspace it is shared with, or how many there are.
 */
export function sharedPillText(ch) {
  if (ch.shared) return ch.shared.host || 'Shared';
  const others = otherOrganizations(ch);
  if (others.length === 1) return others[0].name;
  return others.length ? `${others.length} workspaces` : 'Shared';
}

/** "Shared with Globex and Initech" / "Hosted by Acme", for titles and pills. */
export function sharedSummary(ch) {
  const others = otherOrganizations(ch);
  if (!others.length) return '';
  const names = others.map((o) => o.name);
  const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  return ch.shared ? `Shared by ${others.find((o) => o.owner)?.name || list}` : `Shared with ${list}`;
}

/** The banner above the composer: who else reads here, and how many of them. */
export function sharedBannerText(ch) {
  const others = otherOrganizations(ch);
  // Nothing to say until the host has said who is in the channel.
  if (!others.length || others.some((o) => o.count == null)) return '';
  const outside = others.reduce((n, o) => n + o.count, 0);
  const names = others.map((o) => `${o.name} (${people(o.count)})`);
  const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  if (ch.shared) {
    return `This channel is hosted by ${others.find((o) => o.owner)?.name || 'another workspace'} and shared with your workspace: ${people(outside)} from outside it can read everything here.`;
  }
  return `This channel is shared with ${list}. What is posted here is read outside this workspace.`;
}
