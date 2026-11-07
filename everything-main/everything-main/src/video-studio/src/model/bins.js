/**
 * Media bin folders and media list ordering.
 *
 * Folders live in project.bins = [{ id, name, parent }] (parent is another
 * folder id or null for the top level) and media point at their folder with
 * asset.folder. Both fields are optional so older projects load unchanged:
 * no bins means everything is at the top level. All functions that change a
 * project mutate it in place and are meant to run inside store.update().
 */
import { uid } from '../lib/ids.js';

const MAX_BINS = 500;
const MAX_NAME = 80;

const cleanName = (v, d = 'Folder') => String(typeof v === 'string' ? v : '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_NAME) || d;

/**
 * Validate untrusted bins: unique ids, names, parents that exist and no
 * cycles (a folder in a cycle moves to the top level).
 */
export function normalizeBins(raw) {
  const out = [];
  const ids = new Set();
  for (const b of Array.isArray(raw) ? raw : []) {
    if (!b || typeof b !== 'object') continue;
    const id = typeof b.id === 'string' && /^[\w-]{1,64}$/.test(b.id) && !ids.has(b.id) ? b.id : null;
    if (!id) continue;
    ids.add(id);
    out.push({ id, name: cleanName(b.name), parent: typeof b.parent === 'string' ? b.parent : null });
    if (out.length >= MAX_BINS) break;
  }
  const byId = new Map(out.map((b) => [b.id, b]));
  for (const b of out) {
    if (b.parent && (!byId.has(b.parent) || b.parent === b.id)) b.parent = null;
  }
  // Break cycles: walk up from each folder; one that meets itself goes to the top.
  for (const b of out) {
    const seen = new Set([b.id]);
    let p = b.parent;
    while (p) {
      if (seen.has(p)) {
        b.parent = null;
        break;
      }
      seen.add(p);
      p = byId.get(p)?.parent || null;
    }
  }
  return out;
}

/** Drop asset.folder values that point at no folder. Mutates assets. */
export function fixAssetFolders(assets, bins) {
  const ids = new Set((bins || []).map((b) => b.id));
  for (const a of Object.values(assets || {})) {
    if (a.folder !== undefined && !ids.has(a.folder)) delete a.folder;
  }
}

export const binsOf = (project) => (Array.isArray(project.bins) ? project.bins : []);

export function findBin(project, id) {
  return binsOf(project).find((b) => b.id === id) || null;
}

/** Folders directly inside parent (null: top level), sorted by name. */
export function childBins(project, parent = null) {
  return binsOf(project).filter((b) => (b.parent || null) === (parent || null)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

/** Folder ids from the top level down to id (inclusive); [] for the top level. */
export function binPath(project, id) {
  const out = [];
  const seen = new Set();
  let b = id ? findBin(project, id) : null;
  while (b && !seen.has(b.id)) {
    seen.add(b.id);
    out.unshift(b);
    b = b.parent ? findBin(project, b.parent) : null;
  }
  return out;
}

/** id and all folders inside it, at any depth. */
export function descendantIds(project, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of binsOf(project)) {
      if (b.parent && out.has(b.parent) && !out.has(b.id)) {
        out.add(b.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Media directly in a folder (null: top level). */
export function assetsInBin(project, binId = null) {
  return Object.values(project.assets).filter((a) => (a.folder || null) === (binId || null));
}

/** Number of media in a folder including its subfolders. */
export function binItemCount(project, id) {
  const ids = descendantIds(project, id);
  return Object.values(project.assets).filter((a) => a.folder && ids.has(a.folder)).length;
}

/** A name not used by a sibling: "New folder", "New folder 2", ... */
export function uniqueBinName(project, base = 'New folder', parent = null, exceptId = null) {
  const taken = new Set(childBins(project, parent).filter((b) => b.id !== exceptId).map((b) => b.name.toLowerCase()));
  const clean = cleanName(base, 'New folder');
  if (!taken.has(clean.toLowerCase())) return clean;
  for (let i = 2; ; i++) {
    const n = `${clean} ${i}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
}

export function createBin(project, name = 'New folder', parent = null) {
  if (!Array.isArray(project.bins)) project.bins = [];
  if (project.bins.length >= MAX_BINS) throw new Error('Too many folders');
  const p = parent && findBin(project, parent) ? parent : null;
  const bin = { id: uid('f'), name: uniqueBinName(project, name, p), parent: p };
  project.bins.push(bin);
  return bin;
}

export function renameBin(project, id, name) {
  const b = findBin(project, id);
  if (!b) return false;
  const next = cleanName(name, b.name);
  if (next === b.name) return false;
  b.name = uniqueBinName(project, next, b.parent, b.id);
  return true;
}

/**
 * Delete a folder. Its media and subfolders move up to its parent (the top
 * level for a top-level folder); nothing is removed from the project.
 */
export function deleteBin(project, id) {
  const b = findBin(project, id);
  if (!b) return false;
  const up = b.parent || null;
  for (const a of Object.values(project.assets)) {
    if (a.folder === id) {
      if (up) a.folder = up;
      else delete a.folder;
    }
  }
  for (const c of binsOf(project)) if (c.parent === id) c.parent = up;
  project.bins = binsOf(project).filter((x) => x.id !== id);
  if (!project.bins.length) delete project.bins;
  return true;
}

/** Move media into a folder (null: top level). Returns how many moved. */
export function moveAssets(project, assetIds, binId = null) {
  const target = binId && findBin(project, binId) ? binId : null;
  if (binId && !target) return 0;
  let n = 0;
  for (const id of assetIds) {
    const a = project.assets[id];
    if (!a || (a.folder || null) === target) continue;
    if (target) a.folder = target;
    else delete a.folder;
    n++;
  }
  return n;
}

/** Move a folder into another one (null: top level); refuses to move into itself. */
export function moveBin(project, id, parent = null) {
  const b = findBin(project, id);
  if (!b) return false;
  const target = parent && findBin(project, parent) ? parent : null;
  if (parent && !target) return false;
  if (target && descendantIds(project, id).has(target)) return false;
  if ((b.parent || null) === target) return false;
  b.parent = target;
  b.name = uniqueBinName(project, b.name, target, b.id);
  return true;
}

/* Sorting and filtering the media list ------------------------------------------ */

export const MEDIA_SORTS = [
  { id: 'added', label: 'Date added' },
  { id: 'name', label: 'Name' },
  { id: 'duration', label: 'Duration' },
  { id: 'type', label: 'Type' },
  { id: 'size', label: 'File size' },
];

export const MEDIA_TYPES = [
  { id: 'video', label: 'Videos' },
  { id: 'image', label: 'Photos' },
  { id: 'audio', label: 'Audio' },
];

const TYPE_ORDER = { video: 0, image: 1, audio: 2 };
const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });

/**
 * A sorted copy of assets. key: added | name | duration | type | size;
 * dir: 'asc' | 'desc'. Ties fall back to name, then id, so order is stable.
 */
export function sortAssets(assets, { key = 'added', dir = 'desc' } = {}) {
  const k = MEDIA_SORTS.some((s) => s.id === key) ? key : 'added';
  const sign = dir === 'asc' ? 1 : -1;
  const cmp = {
    added: (a, b) => (a.added || 0) - (b.added || 0),
    name: byName,
    duration: (a, b) => (a.kind === 'image' ? 0 : a.duration || 0) - (b.kind === 'image' ? 0 : b.duration || 0),
    type: (a, b) => (TYPE_ORDER[a.kind] ?? 9) - (TYPE_ORDER[b.kind] ?? 9),
    size: (a, b) => (a.size || 0) - (b.size || 0),
  }[k];
  return [...assets].sort((a, b) => sign * cmp(a, b) || byName(a, b) || String(a.id).localeCompare(String(b.id)));
}

/** Assets of the given kinds (all when types is empty) whose name contains query. */
export function filterAssets(assets, { types = null, query = '' } = {}) {
  const set = types && types.length ? new Set(types) : null;
  const q = String(query || '').trim().toLowerCase();
  return assets.filter((a) => (!set || set.has(a.kind)) && (!q || String(a.name).toLowerCase().includes(q)));
}

/** Readable file size: 900 B, 12 KB, 3.4 MB, 1.2 GB. */
export function formatBytes(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v < 1000) return `${v} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = v / 1000;
  let i = 0;
  while (x >= 1000 && i < units.length - 1) {
    x /= 1000;
    i++;
  }
  return `${x >= 10 ? Math.round(x) : x.toFixed(1)} ${units[i]}`;
}
