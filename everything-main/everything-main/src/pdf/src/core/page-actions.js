import { PDFArray, PDFDict, PDFName } from 'pdf-lib';

const n = PDFName.of;

/** Map local page destinations without walking their target pages or appearance resources. */
export function mapPageDestinations(doc, pages, map) {
  const ctx = doc.context,
    roots = [];
  const root = (dict, key) => {
    if (dict?.has(n(key))) roots.push({ dict, key: n(key) });
  };
  const additional = (dict) => {
    const aa = dict.lookup(n('AA'));
    if (aa instanceof PDFDict) for (const [key] of aa.entries()) roots.push({ dict: aa, key });
  };
  const nodes = new Set();
  for (const page of pages) {
    additional(page.node);
    const annotations = page.node.lookup(n('Annots'));
    if (annotations instanceof PDFArray)
      for (const ref of annotations.asArray()) {
        const annot = ctx.lookup(ref);
        if (!(annot instanceof PDFDict)) continue;
        if (annot.has(n('Dest')) && map(annot, n('Dest')) === false) annot.delete(n('Dest'));
        root(annot, 'A');
        additional(annot);
      }
    const pending = [page.node.get(n('PresSteps'))];
    while (pending.length) {
      const node = ctx.lookup(pending.pop());
      if (!(node instanceof PDFDict) || nodes.has(node)) continue;
      nodes.add(node);
      root(node, 'NA');
      root(node, 'PA');
      pending.push(node.get(n('Next')), node.get(n('Prev')));
    }
  }

  const pending = roots.map(({ dict, key }) => dict.get(key));
  const seen = new Set(),
    actions = new Set(),
    omitted = new Set();
  let edges = roots.length;
  while (pending.length) {
    const value = ctx.lookup(pending.pop());
    if (!(value instanceof PDFDict || value instanceof PDFArray) || seen.has(value)) continue;
    seen.add(value);
    if (value instanceof PDFArray) {
      edges += value.size();
      for (const entry of value.asArray()) pending.push(entry);
    } else {
      actions.add(value);
      if (value.lookup(n('S')) === n('GoTo') && map(value, n('D')) === false) omitted.add(value);
      pending.push(value.get(n('Next')));
      edges++;
    }
  }
  if (!omitted.size) return;

  // An omitted GoTo must not discard the useful actions following it. Resolve only the
  // removed nodes into their successors; valid actions retain their own Next chains.
  // Snapshot all rewrites before applying them, so aliases and cycles are order independent.
  let expansionSteps = 0;
  const successors = (entry) => {
    const out = [],
      active = new Set(),
      stack = [{ entry }];
    while (stack.length) {
      // Skipping shared invalid nodes can expand a compact graph exponentially, even
      // when every path is empty. Bound that expansion relative to the input graph.
      if (++expansionSteps > 100000 + 8 * edges)
        throw new Error('This PDF’s action sequence is too complex to copy safely.');
      const frame = stack.pop(),
        value = ctx.lookup(frame.entry);
      if (frame.exit) {
        active.delete(value);
        continue;
      }
      if (!(value instanceof PDFArray || value instanceof PDFDict) || active.has(value)) continue;
      if (value instanceof PDFDict && !omitted.has(value)) {
        out.push(frame.entry);
        continue;
      }
      active.add(value);
      stack.push({ entry: frame.entry, exit: true });
      const next = value instanceof PDFArray ? value.asArray() : [value.get(n('Next'))];
      for (let i = next.length - 1; i >= 0; i--) stack.push({ entry: next[i] });
    }
    return out;
  };
  const next = new Map();
  for (const action of actions)
    if (!omitted.has(action)) next.set(action, successors(action.get(n('Next'))));
  const replacements = roots
    .filter(({ dict, key }) => omitted.has(ctx.lookup(dict.get(key))))
    .map((owner) => ({ ...owner, sequence: successors(owner.dict.get(owner.key)) }));
  const setNext = (action, entries) => {
    if (!entries.length) action.delete(n('Next'));
    else action.set(n('Next'), entries.length === 1 ? entries[0] : ctx.obj(entries));
  };
  for (const [action, entries] of next) setNext(action, entries);
  for (const { dict, key, sequence } of replacements) {
    if (!sequence.length) {
      dict.delete(key);
      continue;
    }
    if (sequence.length === 1) {
      dict.set(key, sequence[0]);
      continue;
    }
    const first = ctx.lookup(sequence[0]);
    const copy = first.clone(ctx);
    setNext(copy, [...(next.get(first) || []), ...sequence.slice(1)]);
    dict.set(key, ctx.register(copy));
  }
}
