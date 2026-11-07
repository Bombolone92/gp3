/**
 * Move the paragraph (or the selected paragraphs) up or down: the block
 * steps over its neighbour, carrying its style,
 * list membership, and id. It is done by moving the one neighbour across the
 * selected span through the block API, so the selection keeps its ids and
 * only its position changes.
 */

/** Block ids in document order, read from the painted page (deduped across page splits). */
export function documentBlockOrder(host) {
  const ids = [];
  const seen = new Set();
  for (const frag of host?.querySelectorAll?.('[data-source-node-id]') || []) {
    const id = frag.dataset.sourceNodeId;
    if (id && !seen.has(id)) { ids.push(id); seen.add(id); }
  }
  return ids;
}

/**
 * The block move that shifts the selected span one step in `direction`
 * ('up' | 'down'), or null when it is already at that edge. `order` is the
 * document's block ids; `selectedIds` the paragraphs to move. The span from
 * the first to the last selected block moves together.
 */
export function moveForSelection(order, selectedIds, direction) {
  if (!Array.isArray(order) || !order.length) return null;
  const idx = selectedIds.map((id) => order.indexOf(id)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const first = Math.min(...idx);
  const last = Math.max(...idx);
  if (direction === 'up') {
    if (first === 0) return null;
    return { source: order[first - 1], destination: order[last], placement: 'after' };
  }
  if (direction === 'down') {
    if (last === order.length - 1) return null;
    return { source: order[last + 1], destination: order[first], placement: 'before' };
  }
  return null;
}

/**
 * Move the paragraphs with `selectedIds` one step in `direction`. Read the
 * complete story order from the API: the host only paints nearby pages.
 * Resolves the move applied, null when there was nothing to move (the
 * paragraphs are already at that end), or false when the move was called
 * off before it was made.
 */
export async function moveParagraphs(api, _host, selectedIds, direction, { story, stillWanted = () => true } = {}) {
  if (!api?.blocks?.move || !selectedIds?.length) return null;
  const result = await api.blocks.list(story ? { in: story } : {});
  if (!stillWanted()) return false;
  const blocks = result?.blocks;
  if (!Array.isArray(blocks) || (result.total != null && result.total !== blocks.length)) throw new Error('Could not read the document order');
  const byId = new Map(blocks.map((block) => [block.nodeId, block]));
  if (selectedIds.some((id) => !byId.has(id))) throw new Error('Could not locate all selected paragraphs');
  const move = moveForSelection(blocks.map((block) => block.nodeId), selectedIds, direction);
  if (!move) return null;
  const addr = (nodeId) => {
    const nodeType = byId.get(nodeId).nodeType;
    if (!['paragraph', 'heading', 'listItem'].includes(nodeType)) throw new Error('Paragraphs cannot be moved across tables or other non-paragraph blocks');
    return { kind: 'block', nodeType, nodeId, ...(story ? { story } : {}) };
  };
  const r = await api.blocks.move({ source: addr(move.source), destination: addr(move.destination), placement: move.placement });
  if (r == null || r.success === false) throw new Error(r?.failure?.message || 'The paragraph could not be moved');
  return move;
}
