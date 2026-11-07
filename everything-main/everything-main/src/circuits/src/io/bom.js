// Bill of materials from the schematic: parts grouped by component, value
// and footprint. Parts marked "do not populate" are left out.

import { defOf, schDocs, naturalCompare, csvRows } from './common.js';

const BASE_COLUMNS = ['Designator', 'Quantity', 'Value', 'Footprint', 'Description'];

/**
 * @param {{documents:object[], library:object}} project
 * @returns {{designators:string[], quantity:number, value:string, footprint:string, description:string, comp:string, params:Record<string,string>}[]}
 */
export function buildBom(project) {
  const groups = new Map();
  for (const doc of schDocs(project)) {
    for (const o of doc.objects || []) {
      if (o.t !== 'part' || o.dnp) continue;
      const def = defOf(project.library, o.comp);
      if (def && !def.footprint && !o.footprint) continue; // symbols with no physical part
      const value = o.value ?? def?.value ?? '';
      const footprint = o.footprint || def?.footprint?.name || '';
      const key = `${o.comp}\u0000${value}\u0000${footprint}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          designators: [], quantity: 0, value, footprint,
          description: def?.description || def?.name || '',
          comp: o.comp,
          params: { ...(def?.params || {}) },
        };
        groups.set(key, g);
      }
      if (!g.designators.includes(o.designator)) {
        g.designators.push(o.designator);
        g.quantity++;
      }
      for (const [k, v] of Object.entries(o.params || {})) if (v !== '' && v != null) g.params[k] = v;
    }
  }
  const rows = [...groups.values()];
  for (const r of rows) r.designators.sort(naturalCompare);
  rows.sort((a, b) => naturalCompare(a.designators[0], b.designators[0]));
  return rows;
}

/** BOM rows to CSV, with one column per parameter found on any row. */
export function toCsv(rows) {
  const paramCols = [];
  for (const r of rows) for (const k of Object.keys(r.params || {})) if (!paramCols.includes(k)) paramCols.push(k);
  const table = [[...BASE_COLUMNS, ...paramCols]];
  for (const r of rows) {
    table.push([
      r.designators.join(', '), r.quantity, r.value, r.footprint, r.description,
      ...paramCols.map((k) => r.params?.[k] ?? ''),
    ]);
  }
  return csvRows(table);
}
