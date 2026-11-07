// File → Export → Paths to Vector File: saved paths and the work path as an
// SVG drawing the size of the document, for use in vector applications.
import type { Editor } from '../../editor';
import type { PhotoDocument } from '../../model/document';
import { escapeXML } from '../../model/assets';
import { download } from '../../persistence/puter';
import { formDialog } from '../../ui/dialog';
import { maskToSvg } from '../vector/geometry';

type Named = { id: string; name: string; d: string };
/** Exportable paths of a document: saved paths, then the work path. */
export function documentPaths(doc: PhotoDocument): Named[] {
  const out: Named[] = (doc.paths ?? []).map((p) => ({ id: p.id, name: p.name, d: maskToSvg(p.mask) }));
  if (doc.workPath?.paths.length) out.push({ id: 'work-path', name: 'Work Path', d: maskToSvg(doc.workPath) });
  return out.filter((p) => p.d);
}

/** An SVG document with one outlined path per entry (and optional document bounds). */
export function pathsSvg(width: number, height: number, paths: Named[], bounds: boolean): string {
  const items = paths.map((p) => `  <path id="${escapeXML(p.id.replace(/[^A-Za-z0-9_-]/g, '_'))}" d="${p.d}"><title>${escapeXML(p.name)}</title></path>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${bounds ? `  <rect id="document-bounds" x="0" y="0" width="${width}" height="${height}" fill="none" stroke="#999" stroke-width="1"><title>Document bounds</title></rect>\n` : ''}  <g fill="none" stroke="#000" stroke-width="1">
${items.join('\n')}
  </g>
</svg>
`;
}

export async function exportPathsDialog(e: Editor) {
  const paths = documentPaths(e.doc);
  if (!paths.length) return e.message('This document has no paths. Draw one with the Pen tool or save a work path first.');
  const v = await formDialog(
    'Paths to Vector File',
    [
      { name: 'which', label: 'Paths', value: 'all', type: 'select', options: [['all', 'All Paths'], ...paths.map((p): [string, string] => [p.id, p.name])] },
      { name: 'bounds', label: 'Include document bounds', value: 'no', type: 'checkbox' },
    ],
    'Export',
    'Writes an SVG file at the document’s pixel size.',
  );
  if (!v) return;
  const chosen = v.which === 'all' ? paths : paths.filter((p) => p.id === v.which);
  const name = chosen.length === 1 && v.which !== 'all' ? `${e.doc.name} - ${chosen[0].name}` : `${e.doc.name} paths`;
  download(new Blob([pathsSvg(e.doc.width, e.doc.height, chosen, v.bounds === 'yes')], { type: 'image/svg+xml' }), `${name.replace(/[\\/:*?"<>|]+/g, '_')}.svg`);
  e.message(`Exported ${chosen.length} path${chosen.length === 1 ? '' : 's'} as SVG.`);
}
