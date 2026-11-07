// Typographic ("smart") quotes for typed text.

// A quote after these characters (or at the start) opens; otherwise it closes.
const OPENS_AFTER = /[\s([{<—–\-/“‘]/;

/** Replace straight quotes in `text` with curly quotes, given the text
 * before the insertion point. Apostrophes inside words become ’. */
export function curlQuotes(text: string, before: string): string {
  let prev = before.slice(-1);
  let out = '';
  for (const ch of text) {
    if (ch === '"' || ch === "'") {
      const opening = prev === '' || OPENS_AFTER.test(prev);
      out += ch === '"' ? (opening ? '“' : '”') : opening ? '‘' : '’';
    } else out += ch;
    prev = out.slice(-1);
  }
  return out;
}
