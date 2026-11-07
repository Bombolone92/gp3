const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A random id with a short type prefix, safe in file names and URLs. */
export function newId(prefix = '', len = 14) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = prefix;
  for (const b of bytes) out += ALPHABET[b % 62];
  return out;
}

export const ID_RE = /^(app|tbl|fld|viw|rec|sel|att|cmt|flt)[0-9A-Za-z]{14}$/;
