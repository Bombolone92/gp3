/**
 * Cut, copy, and paste from the app's own menus. The keyboard shortcuts go
 * straight through the engine, which handles the browser's clipboard events
 * itself; a menu item has no such event, so the selection is serialized by
 * the engine and written with the asynchronous clipboard API, and pasting
 * reads the clipboard back into the engine's paste pipeline.
 *
 * Browsers only let a page write standard types (text, HTML, PNG) plus, in
 * Chromium, custom formats prefixed with "web ". The engine's own fragment
 * format travels that way when it can, so a copy and paste inside the app
 * keeps everything the HTML would lose; elsewhere the HTML is enough.
 */

const STANDARD_TYPES = new Set(['text/plain', 'text/html', 'image/png']);
const WEB_PREFIX = 'web ';

/** Whether a clipboard type can be written as-is (without the "web " prefix). */
export function isStandardType(type) {
  return STANDARD_TYPES.has(String(type || '').toLowerCase());
}

/** The type name to write for a payload item: standard types as-is, custom ones prefixed. */
export function clipboardTypeFor(type) {
  return isStandardType(type) ? String(type).toLowerCase() : `${WEB_PREFIX}${type}`;
}

/** The payload type for a type read from the clipboard: "web " prefixes come off. */
export function payloadTypeFor(type) {
  const t = String(type || '');
  return t.startsWith(WEB_PREFIX) ? t.slice(WEB_PREFIX.length) : t;
}

/**
 * The `{ type: Blob }` map for one ClipboardItem from the engine's payload
 * items (`{ type, kind, data }`). With `custom` false only standard types are
 * kept, for browsers that reject custom formats.
 */
export function clipboardEntries(items, { custom = true, BlobCtor = Blob } = {}) {
  const out = {};
  for (const it of items || []) {
    if (!it?.type || it.data == null) continue;
    if (!custom && !isStandardType(it.type)) continue;
    const key = clipboardTypeFor(it.type);
    if (out[key]) continue;
    const data = it.kind === 'bytes' ? it.data : String(it.data);
    out[key] = new BlobCtor([data], { type: isStandardType(it.type) ? key : 'application/octet-stream' });
  }
  return out;
}

/** The plain text of a payload, or ''. */
export function payloadText(payload) {
  const it = (payload?.items || []).find((i) => String(i?.type).toLowerCase() === 'text/plain' && i.kind !== 'bytes');
  return it ? String(it.data) : '';
}

/**
 * Write a payload to the system clipboard. Tries the full set of types
 * first, then standard types only, then plain text; throws when none works.
 */
export async function writePayload(payload, { clipboard = navigator.clipboard, ItemCtor = typeof ClipboardItem !== 'undefined' ? ClipboardItem : null } = {}) {
  if (!clipboard) throw new Error('The clipboard is not available');
  const items = payload?.items || [];
  if (ItemCtor && typeof clipboard.write === 'function') {
    for (const custom of [true, false]) {
      const entries = clipboardEntries(items, { custom });
      if (!Object.keys(entries).length) continue;
      try {
        await clipboard.write([new ItemCtor(entries)]);
        return true;
      } catch { /* try a smaller set */ }
    }
  }
  const text = payloadText(payload);
  if (!text) throw new Error('Nothing to copy');
  await clipboard.writeText(text);
  return true;
}

/**
 * Read the system clipboard into an engine payload. Text types come back as
 * strings, everything else as bytes; the "web " prefix is dropped so the
 * engine recognizes its own fragment.
 */
export async function readPayload({ clipboard = navigator.clipboard } = {}) {
  if (!clipboard) throw new Error('The clipboard is not available');
  const items = [];
  if (typeof clipboard.read === 'function') {
    const clipItems = await clipboard.read();
    for (const ci of clipItems) {
      for (const type of ci.types || []) {
        const blob = await ci.getType(type);
        const payloadType = payloadTypeFor(type);
        const textual = /^text\/|^application\/json(?:;|$)/i.test(payloadType);
        items.push(textual
          ? { type: payloadType, kind: 'string', data: await blob.text() }
          : { type: payloadType, kind: 'bytes', data: new Uint8Array(await blob.arrayBuffer()) });
      }
    }
  } else {
    const text = await clipboard.readText();
    if (text) items.push({ type: 'text/plain', kind: 'string', data: text });
  }
  if (!items.length) throw new Error('The clipboard is empty');
  return { source: 'browser', items };
}

/**
 * How long a clipboard read may take before it counts as unanswered. A
 * browser that has to ask the user first (its permission prompt, Safari's
 * and Firefox's Paste button) keeps the read pending until they answer, so
 * the wait is long while permission is still to be given and short once it
 * has been, when a read that does not return is a clipboard that will not.
 */
export async function clipboardReadWait({ granted = 4000, asking = 60000, permissions = globalThis.navigator?.permissions } = {}) {
  try {
    const status = await permissions.query({ name: 'clipboard-read' });
    return status?.state === 'granted' ? granted : asking;
  } catch { return asking; }
}

/** Resolve with `promise`, or reject with `message` after `ms` when the clipboard never answers. */
export function withTimeout(promise, ms, message = 'The clipboard did not respond') {
  let timer = null;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(message), { name: 'TimeoutError' })), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * Copy or cut through the browser's command, which fires the same clipboard
 * event a keyboard shortcut does, so the focused editor writes its own
 * formats. Needs a user gesture; resolves whether the browser ran it.
 */
export function execClipboardCommand(kind, doc = document) {
  try { return typeof doc.execCommand === 'function' && doc.execCommand(kind) === true; } catch { return false; }
}

/** Whether an error means the browser did not allow reading the clipboard. */
export function isPermissionError(err) {
  const name = err?.name || '';
  return name === 'NotAllowedError' || name === 'SecurityError' || /denied|not allowed|permission/i.test(err?.message || '');
}

/**
 * The collapsed selection just after the text a paste receipt reports as
 * inserted, or null when the receipt does not say. The engine's authoring
 * paste leaves the caret where it was, in front of the pasted text; a native
 * paste puts it after, which is where typing should continue.
 */
export function caretAfterPaste(result) {
  const inserted = result?.receipt?.effects?.insertedText;
  const last = Array.isArray(inserted) && inserted.length ? inserted[inserted.length - 1]?.selectionTarget : null;
  const end = last?.end;
  if (!end || typeof end.blockId !== 'string' || !Number.isInteger(end.offset) || end.offset < 0) return null;
  return { kind: 'selection', start: { ...end }, end: { ...end }, ...(last.story ? { story: last.story } : {}) };
}
