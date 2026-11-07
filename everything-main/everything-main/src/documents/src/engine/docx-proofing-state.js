import { strToU8 } from 'fflate';
import { parseXml, wordText } from './docx-xml.js';
import { relatedPartPath } from './docx-relationships.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const STORY_TYPES = new Set(['document.main', 'header', 'footer', 'footnotes', 'endnotes', 'comments'].map(name =>
  `application/vnd.openxmlformats-officedocument.wordprocessingml.${name}+xml`));

// Run boundaries, formatting, proofErr caches and drawing geometry do not
// change checked text. Paragraph and word separators do. Include text boxes
// and deleted text so tracked edits cannot retain an obsolete completion claim.
function checkedText(bytes) {
  if (!bytes) return '';
  const root = parseXml(bytes).documentElement, result = [];
  function visit(node) {
    const ns = node.namespaceURI, name = node.localName;
    if ((ns === W && (name === 't' || name === 'delText')) || (ns === A && name === 't')) {
      result.push(ns === W ? wordText(node) : node.textContent); return;
    }
    // Tab stop definitions share the w:tab name with tab characters but are not text.
    if (ns === W && name === 'tabs') return;
    if (ns === W && (name === 'tab' || name === 'br' || name === 'cr')) result.push(name === 'tab' ? '\t' : '\n');
    for (const child of node.children) visit(child);
    if ((ns === W || ns === A) && name === 'p') result.push('\n');
  }
  visit(root);
  return result.join('');
}

// Change only the clean proofState values, keeping every other settings byte,
// including the XML declaration that XMLSerializer would drop. Reserialize only
// when the source text cannot be edited unambiguously.
function dirtySettings(bytes, settings, state, names) {
  const utf16 = (bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 254 && bytes[1] === 255);
  const text = new TextDecoder(utf16 ? (bytes[0] === 255 ? 'utf-16le' : 'utf-16be') : 'utf-8', { ignoreBOM: true }).decode(bytes);
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tags = [...text.matchAll(new RegExp(`<${escape(state.tagName)}(?=[\\s/>])[^>]*>`, 'g'))];
  if (!utf16 && tags.length === 1 && settings.getElementsByTagNameNS(W, 'proofState').length === 1) {
    let tag = tags[0][0];
    const edited = names.every(name => {
      const pattern = new RegExp(`(\\s${escape(state.getAttributeNodeNS(W, name).name)}\\s*=\\s*)(["'])clean\\2`, 'g');
      if ([...tag.matchAll(pattern)].length !== 1) return false;
      tag = tag.replace(pattern, '$1$2dirty$2');
      return true;
    });
    if (edited) return strToU8(text.slice(0, tags[0].index) + tag + text.slice(tags[0].index + tags[0][0].length));
  }
  for (const name of names) state.setAttributeNS(W, `w:${name}`, 'dirty');
  const declaration = text.replace(/^﻿/, '').match(/^<\?xml[^?]*\?>/)?.[0].replace(/(encoding\s*=\s*)["'][^"']*["']/i, '$1"UTF-8"');
  return strToU8((declaration ? declaration + '\n' : '') + new XMLSerializer().serializeToString(settings));
}

/** §17.15.1.65: invalidate completed checking when exported story text changes. */
export function invalidateProofingState(parts, original, proofingScopeChanged = false) {
  const changed = new Set([...Object.keys(parts), ...Object.keys(original)].filter(path => parts[path] !== original[path]));
  if (!changed.size) return;
  const path = relatedPartPath(parts, 'settings');
  if (!path) return;
  const settings = parseXml(parts[path]);
  const state = [...settings.documentElement.children].find(n => n.namespaceURI === W && n.localName === 'proofState');
  const clean = ['spelling', 'grammar'].filter(name => state?.getAttributeNS(W, name) === 'clean');
  if (!clean.length) return;
  const invalidate = () => { parts[path] = dirtySettings(parts[path], settings, state, clean); };
  if (proofingScopeChanged) { invalidate(); return; }
  const storyPaths = new Set();
  for (const packageParts of [original, parts]) {
    for (const node of parseXml(packageParts['[Content_Types].xml']).documentElement.children) {
      if (node.localName === 'Override' && STORY_TYPES.has(node.getAttribute('ContentType'))) storyPaths.add(node.getAttribute('PartName').slice(1));
    }
  }
  for (const story of storyPaths) {
    if (!changed.has(story) || checkedText(parts[story]) === checkedText(original[story])) continue;
    invalidate();
    return;
  }
}
