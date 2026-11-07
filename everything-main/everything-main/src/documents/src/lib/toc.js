/**
 * Tables of contents are fields: the engine fills one in when it is
 * inserted, and it goes stale as headings change until it is refreshed.
 * `updateTocs` refreshes every table of contents in the document.
 */

/** Refresh all tables of contents. Resolves how many were updated (0 when there are none). */
export async function updateTocs(api, { beforeWrite = () => {}, onChange = () => {} } = {}) {
  const items = (await api.toc.list())?.items || [];
  for (const t of items) {
    const target = t.address || { kind: 'block', nodeType: 'tableOfContents', nodeId: t.id };
    beforeWrite();
    const r = await api.toc.update({ target, mode: 'all' });
    if (r == null || (r.success === false && r.failure?.code !== 'NO_OP')) throw new Error(r?.failure?.message || 'The table of contents was not updated');
    if (r.success !== false) onChange();
  }
  return items.length;
}
