/**
 * A file's name as it is shown. The bidirectional control characters are
 * taken out: an override in a name (U+202E, right-to-left override) makes
 * the letters after it read backwards, so a file called "invoice‮fdp.exe"
 * showed as "invoiceexe.pdf" in the composer's chip, on the message's card
 * and in the viewer, and a reader downloaded a program thinking it a PDF.
 * The file itself keeps its name; only what is drawn is plain, so what is
 * read is what the letters are, in their order.
 */
import { graphemes } from '../lib/format.js';

const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/g;

export function fileLabel(name) {
  return String(name ?? '').replace(BIDI_CONTROLS, '');
}

/**
 * A file's name for one line, cut in the middle when it is long, the end
 * kept: "quarterly-report-fi…-09-07.pdf". The end is what tells a file
 * apart from its neighbours (the date, the version) and what it is (the
 * extension), and a name cut at the end by the line's width lost both. For
 * a chip, a card, a row that shows the name in one line; the full name (see
 * fileLabel) goes in the title and the accessible name. `max` characters
 * at most, the last `tail` of them kept.
 */
export function fileLabelShort(name, max = 32, tail = 12) {
  const full = fileLabel(name);
  // Whole characters as the reader sees them (see graphemes), not code
  // points: a flag is two code points and a family joined with zero-width
  // joiners five, and a cut between them showed a lone regional letter, or
  // half a family, beside the ellipsis. Counted in code points all the same,
  // as the budget always was.
  const chars = graphemes(full);
  if ([...full].length <= max) return full;
  const take = (list, budget) => {
    const out = [];
    let used = 0;
    for (const g of list) {
      const n = [...g].length;
      if (used + n > budget) break;
      out.push(g);
      used += n;
    }
    return out;
  };
  const head = take(chars, max - tail - 1).join('');
  const end = take([...chars].reverse(), tail).reverse().join('');
  return `${head}…${end}`;
}
