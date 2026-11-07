/** Resolve an existing external target from the old workbook's location. For
 * relative filesystem URIs, retain leading parent segments instead of clamping
 * them against an invented absolute origin. */
export function rebaseWorkbookTarget(target, sourceWorkbook) {
  if (!sourceWorkbook || /^[a-z][\w+.-]*:/i.test(target)) return target;
  if (/^[a-z][\w+.-]*:/i.test(sourceWorkbook)) return new URL(target, sourceWorkbook).href;
  if (sourceWorkbook.startsWith('//')) return new URL(target, `https:${sourceWorkbook}`).href.slice(6);
  if (target.startsWith('/')) return target;
  const [, path, suffix = ''] = /^([^?#]*)([\s\S]*)$/.exec(target);
  const base = sourceWorkbook.split(/[?#]/, 1)[0];
  const merged = path ? base.slice(0, base.lastIndexOf('/') + 1) + path : base;
  const absolute = merged.startsWith('/');
  const parts = [];
  for (const part of merged.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length && parts.at(-1) !== '..') parts.pop(); else if (!absolute) parts.push(part);
    } else parts.push(part);
  }
  const inheritedQuery = !path && !suffix.startsWith('?') ? (sourceWorkbook.match(/\?[^#]*/)?.[0] || '') : '';
  return (absolute ? '/' : '') + parts.join('/') + (merged.endsWith('/') && parts.length ? '/' : '') + inheritedQuery + suffix;
}
/** Relative package URI between two paths in the same filesystem namespace. */
export function relativeWorkbookTarget(source, destination) {
  if (![source, destination].every(path => typeof path === 'string' && path && !/^[a-z][\w+.-]*:/i.test(path))) return null;
  if (source.startsWith('/') !== destination.startsWith('/') || source.startsWith('~/') !== destination.startsWith('~/')) return null;
  const segments = path => {
    const result = [];
    for (const part of path.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!result.length) return null; result.pop(); } else result.push(part);
    }
    return result;
  };
  const from = segments(source), to = segments(destination);
  if (!from?.length || !to?.length) return null;
  to.pop(); let common = 0;
  while (common < from.length - 1 && common < to.length && from[common] === to[common]) common++;
  return [...to.slice(common).map(() => '..'), ...from.slice(common).map(encodeURIComponent)].join('/');
}


/** A drive path is a path-absolute URI, not a file:// URL on this computer.
 * Keep the namespace and encode filename characters without inventing an origin. */
export function workbookPathUri(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null;
  return path.split('/').map(encodeURIComponent).join('/');
}
