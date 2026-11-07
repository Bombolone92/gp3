import { MC, WPS, activeDescendants } from './docx-compatibility.js';
import { controlSignature } from './content-controls.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const SVG = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const imageReference = (node, a) => a.namespaceURI === R && a.localName === 'embed' &&
  (node.namespaceURI === A && node.localName === 'blip' || node.namespaceURI === SVG && node.localName === 'svgBlip');

const paragraphSessionIds = new Set(['rsidR', 'rsidRPr', 'rsidDel', 'rsidP', 'rsidRDefault']);
const runSessionIds = new Set(['rsidR', 'rsidRPr', 'rsidDel']);
const isSessionId = (node, attribute) => node.namespaceURI === W && attribute.namespaceURI === W &&
  (node.localName === 'p' ? paragraphSessionIds : node.localName === 'r' ? runSessionIds : null)?.has(attribute.localName) && /^[\da-f]{8}$/i.test(attribute.value);
const temporaryPlaceholderReference = (node, attribute) => {
  if (node.namespaceURI !== W || node.localName !== 'docPart' || attribute.namespaceURI !== W || attribute.localName !== 'val' || !attribute.value) return false;
  const placeholder = node.parentElement, properties = placeholder?.parentElement;
  if (placeholder?.namespaceURI !== W || placeholder.localName !== 'placeholder' ||
      properties?.namespaceURI !== W || properties.localName !== 'sdtPr' ||
      properties.parentElement?.namespaceURI !== W || properties.parentElement.localName !== 'sdt') return false;
  const flags = [...properties.children].filter(n => n.namespaceURI === W && n.localName === 'temporary');
  return flags.length === 1 && (flags[0].getAttributeNS(W, 'val') === null || ['true', '1', 'on'].includes(flags[0].getAttributeNS(W, 'val')));
};
const attributeOrder = (a, b) => {
  for (let i = 0; i < 3; i++) {
    const left = a[i] ?? '', right = b[i] ?? '';
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
};

// Session IDs describe editing provenance, not text/formatting correspondence.
// An empty sdtEndPr contributes no end-marker run properties. Normalize only
// comparison keys: each alternate branch retains its own original source XML.
// A temporary control never restores a glossary prompt: its cached contents
// are edited directly and content edits expire the wrapper. Its placeholder
// reference is branch-owned metadata, retained by drawingBranchOwnership on
// formatting edits. Persistent prompts still participate in correspondence.
// Other semantic attributes, identities, run boundaries and spaces still match.
export function drawingTextSourceKey(content, imageKey, temporaryPlaceholders = false) {
  // Exact stories retain the ordinary comparison path. Only an unmatched
  // alternate story needs this disposable projection; retained XML is never
  // normalized or serialized from it.
  if (temporaryPlaceholders) {
    content = content.cloneNode(true);
    for (const node of content.getElementsByTagNameNS(W, 'docPart')) {
      const value = node.getAttributeNodeNS(W, 'val');
      if (value && temporaryPlaceholderReference(node, value)) node.removeAttributeNS(W, 'val');
    }
  }
  const read = node => {
    if (node.nodeType === 1 && node.namespaceURI === W && node.localName === 'sdtEndPr' &&
        node.parentElement?.namespaceURI === W && node.parentElement.localName === 'sdt' &&
        !node.children.length && !node.textContent.trim() && [...node.attributes].every(a => a.namespaceURI === XMLNS)) return null;
    if (node.nodeType === 1) return [node.namespaceURI, node.localName,
      [...node.attributes].filter(a => a.namespaceURI !== XMLNS && !isSessionId(node, a)).map(a => [a.namespaceURI, a.localName,
        imageKey && imageReference(node, a) ? ['image', imageKey(a.value) ?? ['unresolved', a.value]] : a.value]).sort(attributeOrder),
      [...node.childNodes].map(read).filter(value => value !== null)];
    if ((node.nodeType === 3 || node.nodeType === 4) && (node.textContent.trim() || node.parentElement?.namespaceURI === W && node.parentElement.localName === 't')) return node.textContent;
    return null;
  };
  return JSON.stringify(read(content));
}

// The painted WPS scene follows active source traversal. Alternate frames need
// unique whole-story correspondence, rather than text labels or producer IDs.
// Hidden/cached or ambiguous projections stay guarded.
export function drawingTextFrames(image, asset, imageKey) {
  if (!image?.retainedDrawing || !asset?.scene || !image.shell) return [];
  const doc = new DOMParser().parseFromString(image.shell, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return [];
  const frames = [];
  const visit = (node, path = []) => {
    if (node.text) frames.push({ node, path });
    node.children?.forEach((child, i) => visit(child, [...path, i]));
  };
  visit(asset.scene);
  const sources = activeDescendants(doc.documentElement).filter(n => n.namespaceURI === WPS && n.localName === 'txbx');
  const alternates = [...doc.getElementsByTagNameNS(MC, 'AlternateContent')];
  const root = doc.documentElement;
  const branches = alternates.length === 1 && root === alternates[0] ? [...root.children] : null;
  const keys = new Map(), sourceKey = content => {
    if (!keys.has(content)) keys.set(content, drawingTextSourceKey(content));
    return keys.get(content);
  };
  // Exact markup correspondence needs no resource lookup. Resolve aliases only
  // for unmatched picture stories, keeping ordinary and non-picture paths cheap.
  const imageKeys = new Map(), imageSourceKey = content => {
    if (!imageKeys.has(content)) imageKeys.set(content, drawingTextSourceKey(content, imageKey));
    return imageKeys.get(content);
  };
  const placeholderKeys = new Map(), placeholderSourceKey = content => {
    if (!placeholderKeys.has(content)) placeholderKeys.set(content, drawingTextSourceKey(content, imageKey, true));
    return placeholderKeys.get(content);
  };
  const branchContents = branches?.map(branch => [...branch.getElementsByTagNameNS(W, 'txbxContent')].map(content => ({ content, key: sourceKey(content) })));
  return frames.map((frame, index) => {
    const content = sources[index]?.getElementsByTagNameNS(W, 'txbxContent')[0];
    let contents = content ? [content] : [];
    let reason = null;
    if (sources.length !== frames.length || !content) reason = 'This drawing text has no editable source mapping.';
    else if (alternates.length) {
      if (!branches) reason = 'Editing nested drawing text alternatives is not supported yet.';
      else {
        const key = sourceKey(content);
        let matches = branchContents.map(entries => entries.filter(entry => entry.key === key));
        if (imageKey && matches.some(entries => entries.length !== 1) &&
            branchContents.some(entries => entries.some(({ content }) =>
              content.getElementsByTagNameNS(A, 'blip').length || content.getElementsByTagNameNS(SVG, 'svgBlip').length))) {
          const imageSource = imageSourceKey(content);
          matches = branchContents.map(entries => entries.filter(entry => imageSourceKey(entry.content) === imageSource));
        }
        if (matches.some(entries => entries.length !== 1) && branchContents.some(entries =>
          entries.some(({ content }) => content.getElementsByTagNameNS(W, 'temporary').length))) {
          const placeholderSource = placeholderSourceKey(content);
          matches = branchContents.map(entries => entries.filter(entry => placeholderSourceKey(entry.content) === placeholderSource));
        }
        if (branchContents.some(entries => entries.length !== sources.length)) reason = 'An alternate representation has no corresponding text frames.';
        else if (matches.some(entries => entries.length !== 1)) reason = 'Alternate text frames differ or have ambiguous source correspondence.';
        else contents = matches.map(entries => entries[0].content);
      }
    }
    if (!reason) {
      if ([...content.children].some(n => n.namespaceURI !== W || !['p', 'tbl', 'sdt'].includes(n.localName))) reason = 'Editing these drawing blocks is not supported yet.';
      else if (frame.node.text.paragraphs.some(p => p.runs.some(r => r.noteMark))) reason = 'Editing notes inside drawing text is not supported yet.';
    }
    return { ...frame, index, content, contents, doc, reason };
  });
}

export function sceneAtPath(scene, path) {
  return path.reduce((node, index) => node.children[index], scene);
}

// Rebase retained shells, not edited text/properties, onto each equivalent
// branch. Model IDs belong to the draft; source IDs belong to the parser call.
export function drawingBranchOwnership(original, source, content) {
  if (original.length !== source.length) throw new Error('An alternate drawing story changed its paragraph structure.');
  const paragraphs = new Map(), controls = new Map(), pictures = new Map();
  const collect = p => [...(p.blockControls || []), ...p.runs.map(r => r.contentControl).filter(Boolean)];
  const pictureSources = new Map();
  if (content && original.some(p => p.runs.some(r => r.image))) for (const node of content.getElementsByTagNameNS(WP, 'docPr')) {
    const id = node.getAttribute('id'), sources = pictureSources.get(id) || [];
    sources.push(node); pictureSources.set(id, sources);
  }
  for (let i = 0; i < original.length; i++) {
    paragraphs.set(original[i].id, source[i]);
    const before = collect(original[i]), own = collect(source[i]);
    if (before.length !== own.length) throw new Error('An alternate drawing story changed its control structure.');
    before.forEach((control, index) => controls.set(control.id, own[index].shell));
    for (const run of original[i].runs) if (run.image && content) {
      const matches = pictureSources.get(String(run.image.id)) || [];
      if (matches.length !== 1) throw new Error('An alternate drawing picture has no unique source identity.');
      let drawing = matches[0];
      while (drawing && !(drawing.namespaceURI === W && drawing.localName === 'drawing')) drawing = drawing.parentElement;
      if (!drawing || !content.contains(drawing)) throw new Error('An alternate drawing picture has no source drawing.');
      const svg = drawing.getElementsByTagNameNS(SVG, 'svgBlip')[0], blip = drawing.getElementsByTagNameNS(A, 'blip')[0];
      pictures.set(run.image.id, { shell: new XMLSerializer().serializeToString(drawing),
        relId: (run.image.fallbackRelId ? svg : blip)?.getAttributeNS(R, 'embed'),
        ...(run.image.fallbackRelId ? { fallbackRelId: blip?.getAttributeNS(R, 'embed') } : {}) });
    }
  }
  const pictureRun = r => r.image && pictures.has(r.image.id) ? { ...r, image: { ...r.image, ...pictures.get(r.image.id) } } : r;
  // A branch-specific reference is source ownership, not a content edit. Rebase
  // the unchanged inline-control baseline too, so neighboring edits retain its
  // full source subtree rather than regenerating an untouched picture run.
  const inlineRuns = new Map();
  for (const p of original) for (const r of p.runs) if (r.contentControl) {
    const id = r.contentControl.id, runs = inlineRuns.get(id) || [];
    runs.push(pictureRun(r)); inlineRuns.set(id, runs);
  }
  const signatures = new Map([...inlineRuns].map(([id, runs]) => [id, controlSignature(runs)]));
  const control = value => controls.has(value.id) ? { ...value, shell: controls.get(value.id),
    ...(signatures.has(value.id) ? { signature: signatures.get(value.id) } : {}) } : value;
  return {
    paragraph(p) {
      const own = paragraphs.get(p.id);
      return { ...p, ...(own ? { shell: own.shell, storySource: own.storySource } : {}),
        runs: p.runs.map(r => ({ ...pictureRun(r),
          ...(r.contentControl ? { contentControl: control(r.contentControl) } : {}),
        })),
        ...(p.blockControls ? { blockControls: p.blockControls.map(control) } : {}) };
    },
    table(t) { return t.blockControls ? { ...t, blockControls: t.blockControls.map(control) } : t; },
  };
}
