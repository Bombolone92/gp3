const fail = reason => { throw new Error(`Unsupported EMF: ${reason}.`); };

// MS-EMFPLUS 1.3.1: Dual streams carry a complete EMF representation.
// Validate the envelope before ignoring the alternate EMF+ playback commands.
// Only streams need EMF+ rendering and must not silently lose their artwork.
export function emfDualComment(view, length, state, recordIndex) {
  let at = 16;
  const end = 12 + length;
  if (at === end) fail('empty EMF+ comment');
  while (at < end) {
    if (at + 12 > end || state.ended || (state.records = (state.records || 0) + 1) > 10000) fail('invalid EMF+ record sequence');
    const type = view.getUint16(at, true), flags = view.getUint16(at + 2, true);
    const size = view.getUint32(at + 4, true), dataSize = view.getUint32(at + 8, true);
    if (size < 12 || size % 4 || at + size > end || dataSize > size - 12) fail('invalid EMF+ record length');
    if (!state.started) {
      if (recordIndex !== 2 || at !== 16 || type !== 0x4001 || size !== 28 || dataSize !== 16) fail('missing EMF+ header');
      if (!(flags & 1)) fail('EMF+ Only drawing');
      state.started = true;
    } else if (type === 0x4001) fail('duplicate EMF+ header');
    else if (type === 0x4002) {
      if (size !== 12 || dataSize) fail('invalid EMF+ end record');
      state.ended = true;
    }
    at += size;
  }
}
