/**
 * The ruler's margin handles, made to take.
 *
 * Dragging a margin on the engine's ruler commits through
 * `pageLayout.setMargins`, which writes through a document API the engine
 * keeps beside the layout. Documents here open on a worker, where that
 * reference is never set, so every drag comes back
 * `host-not-ready`/`doc-api-missing`, the handle springs back, and the text
 * never moves. The same edit goes through `doc.sections`, which is what the
 * page setup dialog writes margins with, so a commit rejected for the missing
 * API is retried there and the ruler is told the margin took.
 */

/** Margin fields a drag can carry; the ruler sends the one side it moved. */
const SIDES = ['top', 'right', 'bottom', 'left', 'gutter'];

/** Frames to wait for the relayout the ruler reads its handles back from. */
const SETTLE_FRAMES = 20;

/**
 * Retry rejected ruler margin commits through the document API.
 *
 * @param {object} controller The controller instance, once its editor is ready.
 * @param {{ onCommit?: () => void }} [options] `onCommit` runs after a margin
 *   the engine rejected has been written; the document has changed.
 * @returns {() => void} Puts the engine's own commit back.
 */
export function bindRulerMargins(controller, { onCommit } = {}) {
  const editor = controller?.activeEditor;
  const layout = editor?.pageLayout;
  if (typeof layout?.setMargins !== 'function') return () => {};

  const engineCommit = layout.setMargins.bind(layout);
  const commit = async (payload) => {
    const rejection = await engineCommit(payload);
    if (!documentApiMissing(rejection)) return rejection;
    const committed = await writeMargins(editor, payload);
    if (!committed) return rejection;
    onCommit?.();
    return committed;
  };

  layout.setMargins = commit;
  return () => { if (layout.setMargins === commit) layout.setMargins = engineCommit; };
}

/** The engine had no document API of its own to write through; this one does. */
function documentApiMissing(result) {
  return result?.status === 'rejected'
    && result.reason === 'host-not-ready'
    && result.detail === 'doc-api-missing';
}

/**
 * Write the dragged margin through the document API and answer in the shape
 * the ruler expects from a commit, or null to leave the rejection standing.
 */
async function writeMargins(editor, payload) {
  const api = editor?.doc;
  if (!api?.sections?.list || !api.sections.setPageMargins) return null;

  const margins = {};
  for (const side of SIDES) if (Number.isFinite(payload?.[side])) margins[side] = payload[side];
  if (!Object.keys(margins).length) return null;

  let section = null;
  try { section = pickSection((await api.sections.list())?.items || [], payload); } catch { return null; }
  if (!section) return null;

  const layout = editor.pageLayout;
  const before = layout?.getActiveRulerContext?.()?.renderEpoch ?? null;
  let result = null;
  try {
    const target = section.address || { kind: 'section', sectionId: section.id };
    result = await api.sections.setPageMargins({ target, ...margins });
  } catch { return null; }
  // A margin already at the dragged value writes nothing and still leaves the
  // handle where the drag put it.
  if (result == null || (result.success === false && result.failure?.code !== 'NO_OP')) return null;

  await relaidOut(layout, before);
  return {
    status: 'committed',
    sectionId: section.id ?? null,
    sectionIndex: section.index ?? 0,
    applied: margins,
    // The ruler moves its handles to the ruler context once the context is at
    // this epoch or past it, so this is the epoch the relayout just published.
    renderEpoch: layout?.getActiveRulerContext?.()?.renderEpoch ?? before ?? 0,
  };
}

/** The section a drag names, by id, by index, or the only one there is. */
function pickSection(items, payload) {
  if (typeof payload?.sectionId === 'string') return items.find((s) => s.id === payload.sectionId) || null;
  if (Number.isInteger(payload?.sectionIndex)) return items.find((s) => s.index === payload.sectionIndex) || null;
  return items[0] || null;
}

/**
 * The write returns before the pages are laid out again, and the ruler reads
 * the margins back from the layout. Waiting for the next epoch hands it the
 * margin that was just written instead of the one it replaced.
 */
async function relaidOut(layout, before) {
  if (typeof layout?.getActiveRulerContext !== 'function' || before == null) return;
  for (let frame = 0; frame < SETTLE_FRAMES; frame++) {
    if ((layout.getActiveRulerContext()?.renderEpoch ?? before) > before) return;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}
