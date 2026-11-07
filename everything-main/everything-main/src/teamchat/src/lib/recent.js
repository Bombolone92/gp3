/**
 * Where you have been: the conversations opened most recently in each
 * workspace, kept on this device, for the top bar's history menu (the clock
 * next to the back and forward arrows). Also the searches run
 * most recently, for the search box's dropdown.
 */

import { LIMITS, cleanText } from '../shared/limits.js';

const CONV_KEY = 'teamchat:recent';
const SEARCH_KEY = 'teamchat:searches';
const MAX_CONVS = 20;
const MAX_SEARCHES = 8;

function read(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function write(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* unavailable: this tab still has what it saw */
  }
}

/** Note that a conversation was opened; the newest is first. */
export function noteRecent(wsId, convId) {
  if (!wsId || !convId) return;
  const all = read(CONV_KEY);
  const list = (all[wsId] || []).filter((id) => id !== convId);
  list.unshift(convId);
  all[wsId] = list.slice(0, MAX_CONVS);
  write(CONV_KEY, all);
}

/** Conversations opened in this workspace, newest first. */
export function recentConvs(wsId) {
  return wsId ? read(CONV_KEY)[wsId] || [] : [];
}

/** Forget one (a conversation that no longer exists, say). */
export function forgetRecent(wsId, convId) {
  const all = read(CONV_KEY);
  if (!all[wsId]) return;
  all[wsId] = all[wsId].filter((id) => id !== convId);
  write(CONV_KEY, all);
}

export function noteSearch(wsId, query) {
  // As long as the worker reads a query, and no longer (see the search
  // route's cleanText): what is remembered is what was searched for, and a
  // paste of many kilobytes into the box is not kept eight times over per
  // workspace in the browser's storage, listed whole in the dropdown.
  const q = cleanText(String(query || ''), LIMITS.searchQuery);
  if (!wsId || q.length < 2) return;
  const all = read(SEARCH_KEY);
  const list = (all[wsId] || []).filter((s) => s !== q);
  list.unshift(q);
  all[wsId] = list.slice(0, MAX_SEARCHES);
  write(SEARCH_KEY, all);
}

export function recentSearches(wsId) {
  return wsId ? read(SEARCH_KEY)[wsId] || [] : [];
}

export function forgetSearch(wsId, query) {
  const all = read(SEARCH_KEY);
  if (!all[wsId]) return;
  all[wsId] = all[wsId].filter((s) => s !== query);
  write(SEARCH_KEY, all);
}

export function clearSearches(wsId) {
  const all = read(SEARCH_KEY);
  delete all[wsId];
  write(SEARCH_KEY, all);
}

/**
 * Forget one workspace's conversations and searches (left, removed from,
 * or deleted; see the store's forgetWorkspace): its history menu would list
 * conversations nothing can open, and each workspace left kept its lists
 * in the browser's storage for good.
 */
export function forgetWorkspaceRecent(wsId) {
  for (const key of [CONV_KEY, SEARCH_KEY]) {
    const all = read(key);
    if (!Object.hasOwn(all, wsId)) continue;
    delete all[wsId];
    write(key, all);
  }
}

/** Forget everything (another account signs in on this device). */
export function clearRecent() {
  try {
    localStorage.removeItem(CONV_KEY);
    localStorage.removeItem(SEARCH_KEY);
  } catch {
    /* unavailable */
  }
}
