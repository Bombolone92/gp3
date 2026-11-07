/** Transfer outline trees without exceeding structured clone's nesting limit. */
export function packOutline(items) {
  if (!items) return null;
  const entries = [];
  const stack = [{ items, parent: -1, next: 0 }];
  while (stack.length) {
    const frame = stack.at(-1);
    if (frame.next === frame.items.length) {
      stack.pop();
      continue;
    }
    const { items: children, ...item } = frame.items[frame.next++];
    const index = entries.length;
    entries.push({ item, parent: frame.parent });
    if (children?.length) stack.push({ items: children, parent: index, next: 0 });
  }
  return { format: 'pdf-editor-outline-v1', entries };
}

/** Restore PDF.js's public outline shape without recursive calls. */
export function unpackOutline(data) {
  if (data?.format !== 'pdf-editor-outline-v1') return data;
  const root = [];
  const items = [];
  for (const { item, parent } of data.entries) {
    const entry = { ...item, items: [] };
    items.push(entry);
    (parent < 0 ? root : items[parent].items).push(entry);
  }
  return root;
}

/**
 * Adapt only GetOutline responses on one document's PDF.js message port. The pinned
 * engine's other messages, transfer lists, errors and listener lifetimes pass through.
 */
export function outlinePort(port, docId) {
  const requests = new Set();
  return {
    addEventListener(type, listener, options) {
      port.addEventListener(
        type,
        (event) => {
          const message = event.data;
          if (message?.targetName === `${docId}_worker`) {
            if (message.action === 'GetOutline') requests.add(message.callbackId);
            else if (message.action === 'Terminate') requests.clear();
          }
          listener(event);
        },
        options,
      );
    },
    postMessage(message, ...options) {
      const outline =
        message.callback && requests.delete(message.callbackId) && Array.isArray(message.data);
      try {
        return port.postMessage(message, ...options);
      } catch (error) {
        // Keep ordinary outlines on the original path. Failed structured clones dispatch
        // no message, so only a nesting overflow needs a second, flat transfer.
        if (!outline || error.name !== 'RangeError') throw error;
        return port.postMessage({ ...message, data: packOutline(message.data) }, ...options);
      }
    },
  };
}
