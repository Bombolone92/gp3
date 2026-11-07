// Inline SVGs need document-unique IDs. Compare their structure with a stable
// bijection, retaining distinct definitions and every reference to each one.
export function canonicalSvgDefinitionIds(svg) {
  const ids = new Map();
  return svg.replace(/pkdef-[a-z0-9]+/g, (id) => {
    if (!ids.has(id)) ids.set(id, `test-definition-${ids.size}`);
    return ids.get(id);
  });
}
