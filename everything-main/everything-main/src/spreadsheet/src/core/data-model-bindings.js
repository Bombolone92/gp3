import { parseModelXml, modelChildren } from './data-model-metadata.js';
import { decodeXlsxString } from './xlsx-string.js';
import { sheetKey } from './refs.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X15 = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
const fail = reason => { throw new Error(`Cannot transfer Data Model: ${reason}`); };

// Connection IDs are xsd:unsignedInt values, not lexical XML identities.
export function modelConnectionId(value) {
  const text = String(value ?? '').replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, ''), id = Number(text);
  // XSD whitespace is limited to these four characters. The unsigned integer
  // lexical space permits a minus sign only for zero; normalize its JS sign.
  return /^[+-]?\d+$/.test(text) && Number.isInteger(id) && id >= 0 && id <= 4294967295 ? (id === 0 ? 0 : id) : null;
}

/** Parse the workbook model's actual worksheet-source bindings. */
export function linkedModelBindings(model) {
  const root = parseModelXml(model.connectionsXml), binding = parseModelXml(model.modelXml);
  if (root.localName !== 'connections' || root.namespaceURI !== MAIN || binding.localName !== 'dataModel' || binding.namespaceURI !== X15) fail('invalid model bindings');
  const connections = modelChildren(root, 'connection', MAIN), connectionIds = new Set(), byName = new Map(), idCounts = new Map();
  for (const connection of connections) {
    const name = sheetKey(decodeXlsxString(connection.getAttribute('name'))), id = modelConnectionId(connection.getAttribute('id'));
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(connection); idCounts.set(id, (idCounts.get(id) || 0) + 1);
  }
  for (const connection of connections) {
    const ext = Array.from(connection.getElementsByTagNameNS(X15, 'connection'));
    if (ext.some(n => ['1', 'true'].includes(n.getAttribute('model')))) {
      const id = modelConnectionId(connection.getAttribute('id'));
      if (id == null || idCounts.get(id) !== 1) fail('missing or ambiguous model connection ID');
      connectionIds.add(id);
    }
  }
  const linked = new Map();
  for (const table of Array.from(binding.getElementsByTagNameNS(X15, 'modelTable'))) {
    const name = decodeXlsxString(table.getAttribute('connection'));
    const matches = byName.get(sheetKey(name)) || [];
    if (matches.length !== 1) fail('missing or ambiguous model connection');
    const connection = matches[0]; if (linked.has(connection)) continue;
    const ranges = Array.from(connection.getElementsByTagNameNS(X15, 'rangePr'));
    if (connection.getAttribute('type') !== '102' || ranges.length !== 1) fail('unsupported model source connection');
    linked.set(connection, ranges[0]);
  }
  return { root, binding, connections, connectionIds, linked };
}
