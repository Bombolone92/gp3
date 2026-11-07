/** Apply palette colors to an explicit range, independently of the UI selection cache. */
export async function applyRangeColor(api, snapshot, command, value, mode = 'editing') {
  if (mode === 'viewing') throw new Error('Editing is unavailable.');
  const method = { 'text-color': 'color', 'highlight-color': 'highlight' }[command];
  let target = snapshot?.selectionTarget;
  if (!target && snapshot?.target?.kind === 'text') {
    const { segments, story } = snapshot.target;
    if (segments?.length && segments.every(s => typeof s.blockId === 'string' && Number.isInteger(s.range?.start) && Number.isInteger(s.range?.end) && s.range.start >= 0 && s.range.end >= s.range.start)) {
      target = {
        kind: 'selection',
        start: { kind: 'text', blockId: segments[0].blockId, offset: segments[0].range.start },
        end: { kind: 'text', blockId: segments.at(-1).blockId, offset: segments.at(-1).range.end },
        ...(story ? { story } : {}),
      };
    }
  }
  if (snapshot?.empty !== false || !target) throw new Error('Select the text to color and try again.');
  if (!method || !api?.format?.[method]) throw new Error('Color formatting is unavailable.');
  const input = { target, value };
  const result = mode === 'suggesting'
    ? await api.format[method](input, { changeMode: 'tracked' })
    : await api.format[method](input);
  if (!result || (result.success === false && result.failure?.code !== 'NO_OP')) {
    throw new Error(result?.failure?.message || 'The color was not applied. Try again.');
  }
  return result;
}

/** Store a color for the next typed text without consulting a stale range cache. */
export function applyCaretColor(editor, ui, snapshot, command, value) {
  const method = { 'text-color': 'color', 'highlight-color': 'highlight' }[command];
  if (snapshot?.empty !== true || !method || typeof editor?.host?.setPendingInlineFormat !== 'function') {
    throw new Error('Could not set the typing color. Try again.');
  }
  if (snapshot.selectionTarget || snapshot.target) {
    const restored = ui.selection.restore(snapshot);
    if (restored?.ok !== true) throw new Error('Could not restore the text cursor. Try again.');
  }
  // This is the same host store used by the engine's built-in color command.
  // Set it synchronously after restoring the caret; restoring again after
  // setting it would clear the pending mark on the selection-change event.
  editor.host.setPendingInlineFormat(method, value);
  return { success: true };
}
