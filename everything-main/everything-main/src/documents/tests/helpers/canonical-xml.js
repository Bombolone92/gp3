// Namespace-aware form of an XML element for equality checks. Export may move
// in-scope namespace declarations (bindUsedNamespaces hoists local prefixes to
// the part root), which changes serialized text without changing the XML.
// Keeps prefixes, namespace URIs, attribute values, text, comments and order;
// drops only the xmlns declarations themselves.
const XMLNS = 'http://www.w3.org/2000/xmlns/';

export function canonicalXml(input) {
  const node = typeof input === 'string' ? new DOMParser().parseFromString(input, 'application/xml').documentElement : input;
  if (node.getElementsByTagName('parsererror').length) throw new Error('canonicalXml: input is not well-formed');
  return canonical(node);
}

function canonical(node) {
  if (node.nodeType === 3 || node.nodeType === 4) return escape(node.data);
  if (node.nodeType === 8) return `<!--${node.data}-->`;
  if (node.nodeType === 7) return `<?${node.target} ${node.data}?>`;
  if (node.nodeType !== 1) return '';
  const name = `${node.prefix ? node.prefix + ':' : ''}${node.localName}{${node.namespaceURI || ''}}`;
  const attributes = [...node.attributes].filter(a => a.namespaceURI !== XMLNS)
    .map(a => `${a.prefix ? a.prefix + ':' : ''}${a.localName}{${a.namespaceURI || ''}}="${escape(a.value)}"`).sort();
  return `<${[name, ...attributes].join(' ')}>${[...node.childNodes].map(canonical).join('')}</${name}>`;
}

const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
