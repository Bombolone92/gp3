import { decodeBookmarkName } from './bookmarks.js';

/** Restore paragraph destinations for internal links omitted by native projection. */
export async function bookmarkTargets(api, projection, html, links) {
  const wanted = new Set(links.map(link => link.properties?.anchor).filter(Boolean));
  const hrefs = new Map(), markers = [];
  if (!wanted.size || !api.bookmarks?.list) return { hrefs, markers };
  const blocks = new Map((projection.blocks || []).map(block => [block.blockId, block]));
  const names = new Map();
  let offset = 0;
  while (true) {
    // Unlike hyperlink discovery, bookmark discovery defaults to all stories.
    const result = await api.bookmarks.list({ in: { kind: 'story', storyType: 'body' }, limit: 1000, offset });
    const items = result.items || [];
    for (const item of items) {
      const name = decodeBookmarkName(item.name);
      if (!wanted.has(name) || (item.address?.story && item.address.story.storyType !== 'body')) continue;
      const blockId = item.range?.from?.blockId;
      if (!names.has(name)) names.set(name, blockId);
      else if (names.get(name) !== blockId) names.set(name, null);
    }
    offset += items.length;
    if (!items.length || offset >= result.total) break;
  }
  const occupied = new Set([...html.content.matchAll(/\bid="([^"]*)"/g)].map(match => match[1]));
  let serial = 0;
  for (const [name, blockId] of names) {
    const block = blocks.get(blockId);
    if (!block || !['paragraph', 'heading', 'listItem'].includes(block.nodeType)) continue;
    let id;
    do { id = `document-bookmark-${++serial}`; } while (occupied.has(id));
    // The current public bookmark API reports paragraph ranges, including for
    // imported inline bookmarks. Keep navigation at that paragraph's start.
    let start = block.output.start;
    const content = projection.content.slice(start, block.output.end);
    const open = content.match(/^<(?:p|h[1-6]|li|pre)\b[^>]*>/)?.[0];
    let marker = `<span id="${id}"></span>`;
    if (open) start += open.length;
    else if (projection.format === 'markdown') {
      if (/^(?:`{3,}|~{3,})/.test(content) || !content) marker = `<div id="${id}"></div>\n\n`;
      else if (block.nodeType === 'heading') start += content.match(/^#{1,6} +/)?.[0].length || 0;
    } else continue;
    hrefs.set(name, `#${id}`);
    markers.push({ start, end: start, html: marker });
  }
  return { hrefs, markers };
}
