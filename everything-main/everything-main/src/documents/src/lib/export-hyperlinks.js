import { escapeHtml } from './importers.js';
import { bookmarkTargets } from './export-bookmarks.js';
import { decodeBookmarkName } from './bookmarks.js';
import { bindFieldPictures } from './export-field-pictures.js';
import { deletedFieldLinks } from './export-deleted-fields.js';

const OPEN = '<span data-document-placeholder="hyperlink-unresolved">';
const CLOSE = '</span>';
const INLINE_OPEN = /(?:<(?:strong|em|u|s|del|code|sup|sub|span|mark)(?:\s[^>]*)?>)+$/;
// Pictures and note references between a link's last mapped text and its diagnostic are the link's own; any other text means the diagnostic is another link's.
const INSIDE = /<span data-document-placeholder="(?:image|note)">\[[^\]<]*\]<\/span>/g;
const indexes = new WeakMap();

function index(projection) {
  if (indexes.has(projection)) return indexes.get(projection);
  const value = { text: new Map(), ranges: new Map(), missing: [], missingByBlock: new Map() };
  for (const entry of projection.sourceMap?.entries || []) {
    if (entry.kind === 'text') {
      if (!value.text.has(entry.blockId)) value.text.set(entry.blockId, []);
      value.text.get(entry.blockId).push(entry);
    } else if (entry.role === 'placeholder' && projection.content.slice(entry.output.start - OPEN.length, entry.output.end + CLOSE.length) === `${OPEN}[link unavailable]${CLOSE}`) {
      value.missing.push(entry);
      if (!value.missingByBlock.has(entry.blockId)) value.missingByBlock.set(entry.blockId, []);
      value.missingByBlock.get(entry.blockId).push(entry);
    }
  }
  indexes.set(projection, value);
  return value;
}

function placeholders(projection, blockId) {
  return blockId == null ? index(projection).missing : index(projection).missingByBlock.get(blockId) || [];
}

/** The offset in projected text (HTML entities, Markdown escapes) after `count` characters of source text; null when the text runs out first. */
export function textOffset(text, count, markdown) {
  let offset = 0, decoded = 0;
  while (offset < text.length && decoded < count) {
    const entity = text[offset] === '&' ? text.slice(offset).match(/^&(?:#\d+|#x[\da-f]+|[a-z][a-z0-9]+);/i)?.[0] : null;
    if (entity) {
      // Parsed as a document of its own, a whitespace entity (a tab, "&#9;") would be dropped: a letter in front keeps it.
      decoded += new DOMParser().parseFromString(`<p>x${entity}`, 'text/html').body.textContent.length - 1;
      offset += entity.length;
    } else {
      const next = text.charCodeAt(offset + 1);
      if (markdown && text[offset] === '\\' && ((next >= 33 && next <= 47) || (next >= 58 && next <= 64) || (next >= 91 && next <= 96) || (next >= 123 && next <= 126))) offset += 1;
      const length = text.codePointAt(offset) > 0xffff ? 2 : 1;
      decoded += length; offset += length;
    }
  }
  return decoded === count ? offset : null;
}

function textRange(projection, link) {
  const { start, end } = link.address.anchor;
  const cache = index(projection).ranges, key = rangeKey(link.address.anchor);
  if (cache.has(key)) return cache.get(key);
  const entries = [];
  for (const entry of index(projection).text.get(start.blockId) || []) {
    const length = entry.source.segments.reduce((sum, segment) => sum + segment.range.end - segment.range.start, 0);
    let preceding = 0;
    for (const segment of entry.source.segments) {
      const from = Math.max(start.offset, segment.range.start), to = Math.min(end.offset, segment.range.end);
      if (segment.blockId === start.blockId && from < to) {
        const text = projection.content.slice(entry.output.start, entry.output.end);
        const aCount = preceding + from - segment.range.start, bCount = preceding + to - segment.range.start;
        const a = aCount === 0 ? 0 : textOffset(text, aCount, projection.format === 'markdown');
        const b = bCount === length ? text.length : textOffset(text, bCount, projection.format === 'markdown');
        if (a != null && b != null) entries.push({ output: { start: entry.output.start + a, end: entry.output.start + b } });
      }
      preceding += segment.range.end - segment.range.start;
    }
  }
  const range = entries.length ? { start: entries[0].output.start, end: entries.at(-1).output.end } : null;
  cache.set(key, range);
  return range;
}

function linkRange(projection, link) {
  const text = textRange(projection, link);
  if (!text) return null;
  const placeholder = placeholders(projection, link.address.anchor.start.blockId).find(entry => entry.output.start > text.end);
  if (!placeholder) return null;
  const stop = placeholder.output.start - OPEN.length;
  // Formatting and pictures can follow the last mapped text before the diagnostic.
  if (projection.content.slice(text.end, stop).replace(INSIDE, '').replace(/<[^>]+>|[*_~`]/g, '').trim()) return null;
  return { start: text.start, stop, end: placeholder.output.end + CLOSE.length };
}

function htmlRange(projection, link) {
  const range = linkRange(projection, link);
  if (!range) return null;
  const adjacent = projection.content.slice(0, range.start).match(INLINE_OPEN)?.[0] || '';
  const prefix = containedFormatting(adjacent, projection.content.slice(range.start, range.stop));
  return { ...range, start: range.start - prefix.length, prefix };
}

/** Include a formatting wrapper only when it closes inside this link. */
function containedFormatting(prefix, content) {
  const tags = prefix.match(/<[^>]+>/g) || [];
  while (tags.length) {
    const stack = [];
    let balanced = true;
    for (const [, closing, name] of (tags.join('') + content).matchAll(/<(\/?)(strong|em|u|s|del|code|sup|sub|span|mark)\b[^>]*>/g)) {
      if (!closing) stack.push(name);
      else if (stack.pop() !== name) { balanced = false; break; }
    }
    if (balanced && !stack.length) return tags.join('');
    tags.shift();
  }
  return '';
}

function markdownStart(content, start, prefix) {
  const tags = [...prefix.matchAll(/<(\w+)\b[^>]*>/g)];
  for (const [tag, name] of tags.reverse()) {
    if (content.slice(0, start).endsWith(tag)) { start -= tag.length; continue; }
    const alternatives = { strong: ['**', '__'], em: ['*', '_'], s: ['~~'], del: ['~~'] }[name] || [];
    const marker = alternatives.find(value => content.slice(0, start).endsWith(value));
    if (marker) start -= marker.length;
    else if (name === 'code') start -= content.slice(0, start).match(/`+ ?$/)?.[0].length || 0;
  }
  return start;
}

/** Literal punctuation inside inline HTML must not acquire Markdown meaning. */
function markdownLiteral(html) {
  // A note reference placeholder stays whole for the notes pass; its brackets are not the text's.
  return html.replace(/<span data-document-placeholder="[^"]*">\[[^\]<]*\]<\/span>|<[^>]*>|[^<]+/g, token => token.startsWith('<') ? token
    : token.replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);|[\\`*_{}[\]#+.!|~\-]/gi, value => value.startsWith('&') ? value : `&#${value.charCodeAt(0)};`));
}

/** A shared diagnostic may cover links with one common formatting wrapper. */
function sharedReplacements(projection, html, links, hrefFor, images) {
  const groups = new Map(), handled = new Set(), replacements = [];
  const byRange = new Map(links.filter(link => hrefFor(link.properties)).map(link => [rangeKey(link.address.anchor), link]));
  const nativeImageTargets = new Set(images.filter(image => image.nativeLinked).map(image => `${image.blockId}:${image.sourceRange?.start}:${image.hyperlink?.href}`));
  const unresolved = new Set(links.filter(link => !hrefFor(link.properties)
    && !nativeImageTargets.has(`${link.address.anchor.start.blockId}:${link.address.anchor.start.offset}:${link.properties?.href}`)).map(link => rangeKey(link.address.anchor)));
  const imageGroups = new Map(), imagesByBlock = new Map();
  for (const image of images) {
    if (!imagesByBlock.has(image.blockId)) imagesByBlock.set(image.blockId, []);
    imagesByBlock.get(image.blockId).push(image);
    if (!image.hyperlink || image.nativeLinked) continue;
    const group = imageGroups.get(image.hyperlink.group) || [];
    group.push(image); imageGroups.set(image.hyperlink.group, group);
  }
  for (const diagnostic of html.diagnostics || []) {
    const source = diagnostic.source;
    if (diagnostic.construct !== 'hyperlink' || !source?.range) continue;
    let anchor = { start: { blockId: source.blockId, offset: source.range.start }, end: { blockId: source.blockId, offset: source.range.end } };
    // A picture can split one hyperlink into several text diagnostics. Join
    // each bounded text segment to its unique enclosing discovered link.
    if (anchor.start.offset !== anchor.end.offset && !byRange.has(rangeKey(anchor))) {
      const owners = links.filter(link => link.address.anchor.start.blockId === source.blockId
        && link.address.anchor.start.offset <= anchor.start.offset && link.address.anchor.end.offset >= anchor.end.offset);
      if (owners.length === 1) anchor = owners[0].address.anchor;
    }
    let range = textRange(html, { address: { anchor } });
    let output = textRange(projection, { address: { anchor } });
    const ownImages = (imagesByBlock.get(source.blockId) || []).filter(image => image.hyperlink && !image.nativeLinked && image.sourceRange
      && image.sourceRange.start >= anchor.start.offset && image.sourceRange.end <= anchor.end.offset
      && (anchor.start.offset === anchor.end.offset ? image.hyperlink.empty : !image.hyperlink.empty
        && (image.sourceRange.start !== anchor.start.offset || !image.hyperlink.textBefore)
        && (image.sourceRange.end !== anchor.end.offset || !image.hyperlink.textAfter)));
    if (ownImages.length) {
      range = { start: Math.min(range?.start ?? Infinity, ...ownImages.map(image => image.start)), end: Math.max(range?.end ?? -Infinity, ...ownImages.map(image => image.end)) };
      const primary = ownImages.map(image => image.output);
      output = { start: Math.min(output?.start ?? Infinity, ...primary.map(image => image.start)), end: Math.max(output?.end ?? -Infinity, ...primary.map(image => image.end)) };
    }
    if (!range || !output) continue;
    const placeholder = placeholders(html, source.blockId).find(entry => entry.output.start > range.end);
    const outputPlaceholder = placeholders(projection, source.blockId).find(entry => entry.output.start > output.end);
    if (!placeholder || !outputPlaceholder) continue;
    const group = groups.get(placeholder) || { placeholder, outputPlaceholder, members: [] };
    group.members.push({ anchor, range, output });
    groups.set(placeholder, group);
  }
  for (const { placeholder, outputPlaceholder, members } of groups.values()) {
    if (members.length < 2) continue;
    let start = Math.min(...members.map(member => member.range.start));
    const stop = placeholder.output.start - OPEN.length;
    const prefix = containedFormatting(html.content.slice(0, start).match(INLINE_OPEN)?.[0] || '', html.content.slice(start, stop));
    start -= prefix.length;
    const recovered = [];
    for (const member of members) {
      if (member.anchor.start.offset === member.anchor.end.offset) continue;
      const link = byRange.get(rangeKey(member.anchor));
      if (link && !recovered.some(item => item.link === link)) recovered.push({ link, href: hrefFor(link.properties), range: member.range });
    }
    for (const group of imageGroups.values()) {
      const first = group[0], last = group.at(-1), href = hrefFor(first.hyperlink);
      if (!first.hyperlink.empty || !href || first.start < start || last.end > stop) continue;
      recovered.push({ href, range: { start: first.start, end: last.end } });
    }
    if (!recovered.length) continue;
    const edits = images.filter(image => image.start >= start && image.end <= stop).map(image => ({ at: image.start, end: image.end, text: image.html, order: 0 }));
    for (const [id, item] of recovered.entries()) {
      edits.push({ at: item.range.start, end: item.range.start, order: 0, text: `<span data-export-boundary="s${id}"></span>` },
        { at: item.range.end, end: item.range.end, order: 1, text: `<span data-export-boundary="e${id}"></span>` });
    }
    let fragment = html.content.slice(start, stop);
    for (const edit of edits.sort((a, b) => b.at - a.at || b.end - a.end || a.order - b.order)) fragment = fragment.slice(0, edit.at - start) + edit.text + fragment.slice(edit.end - start);
    const document = new DOMParser().parseFromString(fragment, 'text/html');
    const boundaries = new Map([...document.querySelectorAll('[data-export-boundary]')].map(node => [node.getAttribute('data-export-boundary'), node]));
    for (const [id, item] of recovered.entries()) {
      const first = boundaries.get(`s${id}`), last = boundaries.get(`e${id}`);
      const range = document.createRange();
      range.setStartAfter(first); range.setEndBefore(last);
      const anchor = document.createElement('a');
      anchor.setAttribute('href', item.href);
      anchor.append(range.extractContents());
      range.insertNode(anchor);
      first.remove(); last.remove();
      if (item.link) handled.add(item.link);
    }
    fragment = document.body.innerHTML;
    // One text-and-picture link can emit both a text diagnostic and a
    // zero-width picture diagnostic. Check ownership instead of counting links.
    const complete = members.every(member => {
      const { anchor } = member;
      if (anchor.start.offset !== anchor.end.offset) return handled.has(byRange.get(rangeKey(anchor)));
      const atPoint = (imagesByBlock.get(anchor.start.blockId) || []).filter(image => image.hyperlink && !image.nativeLinked
        && image.sourceRange?.start === anchor.start.offset && image.sourceRange?.end === anchor.end.offset
        && image.start >= start && image.end <= stop);
      return !unresolved.has(rangeKey(anchor)) && atPoint.length > 0 && atPoint.every(image => recovered.some(item => image.start >= item.range.start && image.end <= item.range.end));
    });
    if (!complete) fragment += OPEN + '[link unavailable]' + CLOSE;
    const outputStart = Math.min(...members.map(member => member.output.start));
    replacements.push({ start: projection.format === 'html' ? start : markdownStart(projection.content, outputStart, prefix),
      end: outputPlaceholder.output.end + CLOSE.length, html: projection.format === 'html' ? fragment : markdownLiteral(fragment) });
  }
  return { replacements, handled };
}

function rangeKey(anchor) {
  return `${anchor.start.blockId}:${anchor.start.offset}:${anchor.end.offset}`;
}

/** Recover telephone and bookmark links using source coordinates, not matching labels. */
export async function hyperlinkReplacements(api, projection, images = []) {
  const missing = placeholders(projection);
  if (!missing.length || !api.hyperlinks?.list) return [];
  const links = [], blockIds = new Set(missing.map(entry => entry.blockId));
  const fieldSources = new Map(), hasFieldPictures = images.some(image => image.field);
  const fieldIds = new Set(), tracked = projection.annotations?.some(annotation => annotation.kind === 'trackedChange');
  let fieldPages;
  const listFields = query => {
    fieldPages ??= new Map();
    const key = JSON.stringify(query);
    if (!fieldPages.has(key)) fieldPages.set(key, api.fields.list(query));
    return fieldPages.get(key);
  };
  let offset = 0;
  // Public discovery items belong to this document API's body. Header/note
  // inventories in the engine's additional `stories` field are not used.
  while (true) {
    const result = await api.hyperlinks.list({ limit: 1000, offset });
    const items = result.items || [];
    if (tracked || hasFieldPictures) for (const story of result.stories || []) {
      if (story.partUri !== '/word/document.xml') continue;
      for (const source of story.hyperlinks || []) if (source.sourceKind === 'field') {
        if (tracked && blockIds.has(source.paraId)) fieldIds.add(source.hyperlinkNodeId);
        if (hasFieldPictures) fieldSources.set(source.hyperlinkNodeId, source);
      }
    }
    let fields;
    links.push(...items.filter(link => blockIds.has(link.address?.anchor?.start?.blockId)
      && link.address.anchor.end?.blockId === link.address.anchor.start.blockId).map(link => {
      const anchor = link.properties?.anchor;
      if (!anchor) return link;
      const decoded = decodeBookmarkName(anchor);
      if (decoded === anchor) return link;
      // Field instruction targets are already decoded. Use the main part's
      // source type; a header or note may reuse the same field/paragraph IDs.
      fields ??= new Set((result.stories || []).filter(story => story.partUri === '/word/document.xml')
        .flatMap(story => (story.hyperlinks || []).filter(item => item.sourceKind === 'field').map(item => item.hyperlinkNodeId)));
      return fields.has(link.id) ? link : { ...link, properties: { ...link.properties, anchor: decoded } };
    }));
    offset += items.length;
    if (!items.length || offset >= result.total) break;
  }
  const omitted = await deletedFieldLinks(api, projection, fieldIds, listFields);
  for (let index = links.length - 1; index >= 0; index--) if (omitted.has(links[index].id)) links.splice(index, 1);
  if (hasFieldPictures) await bindFieldPictures(api, images, fieldSources, listFields);
  const candidates = hasFieldPictures ? [...links, ...images.filter(image => image.field && image.hyperlink).map(image => ({ properties: image.hyperlink }))] : links;
  if (!candidates.some(link => /^tel:/i.test(link.properties?.href || '') || link.properties?.anchor)) {
    if (hasFieldPictures && api.info && String((await api.info({})).revision) !== String(projection.evaluatedRevision)) throw new Error('The document changed while exporting. Try again');
    return [];
  }
  const html = projection.format === 'html' ? projection : await api.projectHtml({ includeSourceMap: true });
  if (html.status === 'failed' || html.evaluatedRevision !== projection.evaluatedRevision) throw new Error('The document changed while exporting. Try again');
  const bookmarks = await bookmarkTargets(api, projection, html, candidates);
  const hrefFor = properties => properties?.anchor ? bookmarks.hrefs.get(properties.anchor) : /^tel:/i.test(properties?.href || '') ? properties.href : null;
  const nativeLinks = images.length ? [...html.content.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => ({ start: match.index, end: match.index + match[0].length })) : [];
  const imageCounts = new Map();
  const imagesByKey = new Map(images.map(image => [`${image.blockId}:${image.index}`, image]));
  const htmlImages = (html.sourceMap?.entries || []).flatMap(entry => {
    const open = '<span data-document-placeholder="image">';
    if (entry.kind !== 'synthetic' || html.content.slice(entry.output.start - open.length, entry.output.end + CLOSE.length) !== `${open}[image]${CLOSE}`) return [];
    const index = imageCounts.get(entry.blockId) || 0;
    imageCounts.set(entry.blockId, index + 1);
    const image = imagesByKey.get(`${entry.blockId}:${index}`);
    return image ? [{ ...image, nativeLinked: nativeLinks.some(link => entry.output.start > link.start && entry.output.end < link.end),
      output: { start: image.start, end: image.end }, start: entry.output.start - open.length, end: entry.output.end + CLOSE.length }] : [];
  });
  const replacements = [];
  const imageRanges = (source, sourceImages) => {
    const groups = new Map();
    for (const image of sourceImages) {
      const href = hrefFor(image.hyperlink);
      if (!href) continue;
      if (!groups.has(image.hyperlink.group)) groups.set(image.hyperlink.group, []);
      groups.get(image.hyperlink.group).push({ ...image, hyperlink: { ...image.hyperlink, href } });
    }
    return [...groups.values()].flatMap(group => {
      const first = group[0], last = group.at(-1);
      const placeholder = placeholders(source, last.blockId).find(entry => entry.output.start > last.end);
      if (!placeholder) return [];
      const stop = placeholder.output.start - OPEN.length;
      if (first.hyperlink.empty && source.content.slice(last.end, stop).replace(INSIDE, '').replace(/<[^>]+>|[*_~`]/g, '').trim()) return [];
      return [{ start: first.start, stop, end: placeholder.output.end + CLOSE.length, contentEnd: last.end, blockId: first.blockId, sourceRange: first.sourceRange, ...first.hyperlink }];
    });
  };
  const outputImageRanges = imageRanges(projection, images), htmlImageRanges = imageRanges(html, htmlImages);
  const add = (range, output, href) => {
    let fragment = html.content.slice(range.start, range.stop);
    for (const image of htmlImages.filter(image => image.start >= range.start && image.end <= range.stop).sort((a, b) => b.start - a.start)) {
      fragment = fragment.slice(0, image.start - range.start) + image.html + fragment.slice(image.end - range.start);
    }
    const start = projection.format === 'html' ? range.start : markdownStart(projection.content, output.start, range.prefix || '');
    replacements.push({ start, end: output.end, html: `<a href="${escapeHtml(href)}">${projection.format === 'html' ? fragment : markdownLiteral(fragment)}</a>` });
  };
  const pictureFields = new Set(images.filter(image => image.field && image.hyperlink?.empty).flatMap(image => [...(image.hyperlink.sourceIds || [])]));
  const resolved = [];
  for (let link of links) {
    // Picture-only fields have no text selection. Their XML ownership and image
    // source ranges restore them below, without selecting an atomic field result.
    if (pictureFields.has(link.id) && link.address.anchor.start.offset === link.address.anchor.end.offset) continue;
    if (projection.annotations?.some(annotation => annotation.kind === 'trackedChange')) {
      // Link discovery uses visible offsets; projection maps include deleted text.
      // A scoped read performs the engine's conversion without editing the document.
      const anchor = link.address.anchor;
      const scoped = await api.projectHtml({ scope: { kind: 'selection', start: { kind: 'text', ...anchor.start }, end: { kind: 'text', ...anchor.end } } });
      if (scoped.evaluatedRevision !== projection.evaluatedRevision) throw new Error('The document changed while exporting. Try again');
      if (scoped.scope?.target?.coordinateSpace !== 'tracked') continue;
      link = { ...link, address: { ...link.address, anchor: scoped.scope.target } };
    }
    resolved.push(link);
  }
  const shared = sharedReplacements(projection, html, resolved, hrefFor, htmlImages);
  replacements.push(...shared.replacements);
  for (const link of resolved) {
    if (shared.handled.has(link)) continue;
    const href = hrefFor(link.properties);
    if (!href) continue;
    const range = htmlRange(html, link), output = linkRange(projection, link);
    if (!range || !output) continue;
    const htmlImage = htmlImageRanges.find(image => image.end === range.end && image.href === href);
    const outputImage = outputImageRanges.find(image => image.end === output.end && image.href === href);
    if (htmlImage && htmlImage.start < range.start) { range.start = htmlImage.start; range.prefix = ''; }
    if (outputImage) output.start = Math.min(output.start, outputImage.start);
    add(range, output, href);
  }
  const restoredPoints = new Map();
  for (const image of outputImageRanges) {
    if (!image.empty || replacements.some(replacement => replacement.end === image.end)) continue;
    const range = htmlImageRanges.find(range => range.group === image.group);
    if (!range) continue;
    add({ ...range, stop: range.contentEnd }, { ...image, end: image.contentEnd }, image.href);
    if (image.sourceRange?.start !== image.sourceRange?.end || image.sourceRange == null) continue;
    const key = `${image.blockId}:${image.sourceRange.start}`;
    const point = restoredPoints.get(key) || { image, count: 0 };
    point.count++;
    restoredPoints.set(key, point);
  }
  // Several zero-width image links can share one diagnostic. Retain it if
  // an unresolved target at that position has not been restored.
  for (const { image, count } of restoredPoints.values()) {
    const unresolved = (projection.diagnostics || []).filter(diagnostic => diagnostic.construct === 'hyperlink'
      && diagnostic.source?.blockId === image.blockId && diagnostic.source.range?.start === image.sourceRange.start
      && diagnostic.source.range?.end === image.sourceRange.end).length;
    if (count === unresolved) replacements.push({ start: image.stop, end: image.end, html: '' });
  }
  if (api.info && String((await api.info({})).revision) !== String(projection.evaluatedRevision)) throw new Error('The document changed while exporting. Try again');
  return [...replacements, ...bookmarks.markers];
}
