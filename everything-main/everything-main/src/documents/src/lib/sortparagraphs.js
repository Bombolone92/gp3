/**
 * Sort the selected paragraphs: A to Z, Z to A, or by the number each one
 * starts with. Paragraphs are moved into place one at a time through the
 * block API, so their formatting, list membership, and ids all travel with
 * them. It is what lists of names and figures need.
 */

import { paragraphTarget, readParagraph } from './paragraphs.js';

export const PARAGRAPH_SORTS = [
  { id: 'textAsc', label: 'A to Z' },
  { id: 'textDesc', label: 'Z to A' },
  { id: 'numberAsc', label: 'Smallest number first' },
  { id: 'numberDesc', label: 'Largest number first' },
];

/** The number a paragraph leads with ("3. Pears" -> 3, "$1,200" -> 1200), or null. */
export function leadingNumber(text) {
  // The first number in the text; ".75" counts, the dots of an ellipsis do not.
  // A minus sign counts only when nothing attaches it to a word: "Room A-5" is room five, not minus five.
  const m = /(?:(?<![\p{L}\p{N}])-)?(?:\d[\d,.]*|(?<![.\d])\.\d+)/u.exec(String(text || ''));
  if (!m) return null;
  // "1,5" and "1.234,5" are European decimals; "1,200" and "1,200.50" use the comma for thousands.
  let digits = m[0].replace(/[.,]+$/, '');
  if (/^-?\d+,\d{1,2}$/.test(digits) || /^-?\d{1,3}(?:\.\d{3})+,\d+$/.test(digits)) digits = digits.replace(/\./g, '').replace(',', '.');
  else digits = digits.replace(/,/g, '');
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) ? n : null;
}

/**
 * The ids of `items` ([{ id, text }]) in sorted order. Text sorts are
 * locale-aware and case-insensitive with numbers in natural order; number
 * sorts put paragraphs without a number last. Ties keep document order.
 */
export function sortedIds(items, choiceId) {
  const choice = PARAGRAPH_SORTS.find((c) => c.id === choiceId);
  if (!choice) throw new Error('Unknown sort');
  const desc = choice.id.endsWith('Desc');
  const byNumber = choice.id.startsWith('number');
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const decorated = items.map((it, index) => ({ id: it.id, text: String(it.text || '').trim(), n: byNumber ? leadingNumber(it.text) : null, index }));
  decorated.sort((a, b) => {
    let cmp;
    if (byNumber) {
      if (a.n == null && b.n == null) cmp = 0;
      else if (a.n == null) return 1;
      else if (b.n == null) return -1;
      else cmp = a.n - b.n;
    } else cmp = collator.compare(a.text, b.text);
    if (desc) cmp = -cmp;
    return cmp || a.index - b.index;
  });
  return decorated.map((d) => d.id);
}

/**
 * The block moves that turn `current` (ids in document order) into `target`:
 * each paragraph that is out of place goes right after its sorted
 * predecessor (the first one goes before whatever leads now). Paragraphs
 * already in place are left alone.
 */
export function movesToOrder(current, target) {
  // Keep neighbours by id so each lookup and move takes constant time. Array
  // scans and splices made even an already sorted selection quadratic.
  const nodes = new Map(current.map((id) => [id, { id, previous: null, next: null }]));
  let head = null, tail = null;
  for (const id of current) {
    const node = nodes.get(id);
    node.previous = tail;
    if (tail) tail.next = node;
    else head = node;
    tail = node;
  }
  const moves = [];
  for (let i = 0; i < target.length; i++) {
    const id = target[i];
    const node = nodes.get(id);
    if (!node) continue;
    const previous = i === 0 ? null : nodes.get(target[i - 1]);
    if ((previous ? previous.next : head) === node) continue;
    const destination = i === 0 ? head.id : target[i - 1];

    if (node.previous) node.previous.next = node.next;
    else head = node.next;
    if (node.next) node.next.previous = node.previous;

    const anchor = previous === node ? null : previous;
    node.previous = anchor || null;
    node.next = anchor ? anchor.next : head;
    if (node.next) node.next.previous = node;
    if (anchor) anchor.next = node;
    else head = node;
    moves.push({ source: id, destination, placement: i === 0 ? 'before' : 'after' });
  }
  return moves;
}

/** Plain text of a paragraph or heading from the Document API. */
export function paragraphText(node) {
  const content = node?.node?.paragraph || node?.node?.heading;
  return (content?.inlines || []).map((i) => i.run?.text || '').join('');
}

/**
 * Sort the paragraphs with `nodeIds` (in document order) by `choiceId`.
 * Resolves the number of paragraphs that moved. Report each completed move
 * so a later failure cannot leave the earlier changes outside autosave.
 */
export async function sortParagraphs(api, nodeIds, choiceId, { story, beforeWrite = () => {}, onChange = () => {}, onProgress = () => {} } = {}) {
  if (!Array.isArray(nodeIds) || nodeIds.length < 2) throw new Error('Select at least two paragraphs to sort');
  const items = [];
  for (const id of nodeIds) {
    // Read every paragraph successfully before moving any of them. A failed
    // read is not an empty paragraph and must not change the sort order.
    const text = paragraphText(await readParagraph(api, id, story));
    items.push({ id, text });
  }
  const moves = movesToOrder(nodeIds, sortedIds(items, choiceId));
  const addr = (nodeId) => paragraphTarget(nodeId, story);
  onProgress(0, moves.length);
  for (const [index, m] of moves.entries()) {
    beforeWrite();
    const r = await api.blocks.move({ source: addr(m.source), destination: addr(m.destination), placement: m.placement });
    if (r == null || r.success === false) throw new Error(r?.failure?.message || 'A paragraph could not be moved');
    onChange();
    onProgress(index + 1, moves.length);
  }
  return moves.length;
}
