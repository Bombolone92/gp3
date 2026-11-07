// Bounds belong to physical pages. Nested cell padding and repeated table
// headers add local insets without losing the selected page-story clearance.
export function pageBounds(page, index = 0) {
  const base = page.boundsBase;
  const physical = base && page.height === base.height && page.pageBounds?.((page.boundsOrigin || 0) + index);
  return physical ? {
    top: physical.top + page.top - base.top,
    bottom: physical.bottom - page.bottom + base.bottom,
  } : { top: page.top, bottom: page.height - page.bottom };
}
export const offsetPage = (page, offset) => page.pageBounds
  ? { ...page, boundsOrigin: (page.boundsOrigin || 0) + offset } : page;
export const cellPageAt = (cellPage, enclosingPage, offset) => {
  // Intrinsic table measurement replaces the physical height with an unbounded
  // space. Nested cells must not revive a stale physical-page callback there:
  // page numbers and header/footer selection are assigned only at pagination.
  const physical = enclosingPage.pageBounds && enclosingPage.height === enclosingPage.boundsBase?.height;
  return offsetPage({ ...cellPage,
    pageBounds: physical ? enclosingPage.pageBounds : undefined,
    boundsBase: physical ? enclosingPage.boundsBase : undefined,
    boundsOrigin: physical ? enclosingPage.boundsOrigin || 0 : 0,
  }, offset);
};
