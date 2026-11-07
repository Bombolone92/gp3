// Batch links: a URL that opens Photo Studio ready to run a recorded action
// on the photos dropped into it (File → Automate → Create Batch Link). The
// link carries the action's steps and the output settings; nothing runs
// until the user adds files and presses Run.

export type BatchLinkStep = { command: string; arg?: unknown };
export type BatchLink = {
  v: 1;
  name: string;
  steps: BatchLinkStep[];
  format: 'jpeg' | 'png' | 'webp' | 'tiff';
  quality: number;
  // Resize to fit within these pixel dimensions (no enlarging).
  fit?: { width: number; height: number };
};
export const BATCH_LINK_PREFIX = '#batch=';
const MAX_LINK = 16 * 1024;
const MAX_STEPS = 100;

// Commands a link may carry: recorded document edits. Scripts, windows,
// files and other links are left out, so a link cannot reach beyond the
// photos it is given.
const blockedPrefixes = ['script.', 'scripts.', 'actions.', 'window.', 'help.', 'view.', 'file.', 'edit.preferences', 'edit.keyboard', 'edit.menus'];
const allowedFile = new Set(['file.fit-image', 'file.conditional-mode']);
export function linkableCommand(id: string) {
  return allowedFile.has(id) || !blockedPrefixes.some((p) => id.startsWith(p));
}

function toBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(s: string) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** The hash part of a link (`#batch=…`). */
export function encodeBatchLink(link: BatchLink): string {
  const hash = BATCH_LINK_PREFIX + toBase64Url(JSON.stringify(link));
  if (hash.length > MAX_LINK) throw new Error('This action is too long for a link. Remove steps or settings with large values.');
  return hash;
}

/** Read and check a link's hash. `known` tells whether a command exists here. */
export function decodeBatchLink(hash: string, known: (id: string) => boolean): BatchLink {
  if (!hash.startsWith(BATCH_LINK_PREFIX)) throw new Error('This is not a batch link.');
  if (hash.length > MAX_LINK) throw new Error('The batch link is too long.');
  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64Url(hash.slice(BATCH_LINK_PREFIX.length)));
  } catch {
    throw new Error('The batch link is damaged.');
  }
  const o = raw as Partial<BatchLink> | null;
  if (!o || o.v !== 1 || !Array.isArray(o.steps) || !o.steps.length || o.steps.length > MAX_STEPS) throw new Error('The batch link is damaged.');
  const steps: BatchLinkStep[] = o.steps.map((s) => {
    const step = s as BatchLinkStep | null;
    if (!step || typeof step.command !== 'string') throw new Error('The batch link is damaged.');
    if (!linkableCommand(step.command)) throw new Error(`The batch link asks for “${step.command}”, which links cannot run.`);
    if (!known(step.command)) throw new Error(`This version of Photo Studio does not have “${step.command}”.`);
    return step.arg === undefined ? { command: step.command } : { command: step.command, arg: step.arg };
  });
  const format = o.format && ['jpeg', 'png', 'webp', 'tiff'].includes(o.format) ? o.format : 'jpeg';
  const quality = typeof o.quality === 'number' && o.quality >= 1 && o.quality <= 100 ? Math.round(o.quality) : 85;
  const fit =
    o.fit && Number.isInteger(o.fit.width) && Number.isInteger(o.fit.height) && o.fit.width >= 1 && o.fit.height >= 1 && o.fit.width <= 8192 && o.fit.height <= 8192
      ? { width: o.fit.width, height: o.fit.height }
      : undefined;
  return { v: 1, name: typeof o.name === 'string' && o.name.trim() ? o.name.slice(0, 80) : 'Batch', steps, format, quality, fit };
}
