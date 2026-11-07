const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** `len` random characters from [0-9a-z], from the platform CSPRNG. */
export function randomId(len = 10) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  // 252 is the largest multiple of 36 below 256: rejecting bytes above it
  // keeps every character equally likely.
  let i = 0;
  while (out.length < len) {
    if (i >= bytes.length) {
      crypto.getRandomValues(bytes);
      i = 0;
    }
    const b = bytes[i++];
    if (b < 252) out += ALPHABET[b % 36];
  }
  return out;
}

/** Ids for parts of a survey (questions, choices, pages). They only need to
 *  be unique within one survey, and they start with a letter so they are
 *  safe to use as DOM ids and object keys. */
export function partId(prefix = 'x') {
  return `${prefix}${randomId(7)}`;
}

export const surveyId = () => `s${randomId(11)}`;
export const collectorId = () => randomId(10);
export const folderId = () => `f${randomId(9)}`;
