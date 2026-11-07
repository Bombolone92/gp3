// File → Package: the document as a .photo project plus every linked file
// in a "Links" folder, in one ZIP. Linked files are read from their source
// when possible, otherwise from the copy kept in the project.
import type { Editor } from '../../editor';
import { serialize } from '../../model/serialization';
import { download } from '../../persistence/puter';
import { readLinkedFile } from '../embedded/linked';
import { uniqueName, zipStore, type ZipEntry } from './zip';

export type PackagedLink = { name: string; file: string; from: 'source' | 'copy' | 'missing' };

/** Report text listing what the package contains. */
export function packageReport(docName: string, links: PackagedLink[], date = new Date()): string {
  const lines = [`Package of “${docName}”`, `Created ${date.toLocaleString()}`, '', `${docName}.photo — the layered project`];
  if (!links.length) lines.push('', 'The document has no linked files.');
  else {
    lines.push('', 'Links/');
    for (const l of links)
      lines.push(`  ${l.file}${l.from === 'copy' ? ' — copy kept in the project (the original could not be read)' : l.from === 'missing' ? ' — not available' : ''}`);
  }
  return lines.join('\n') + '\n';
}

export async function packageDocument(e: Editor) {
  const s = e.session;
  const doc = structuredClone(e.doc);
  const base = (s.fileName?.replace(/\.[^.]+$/, '') || doc.name).replace(/[\\/:*?"<>|]+/g, '_') || 'Untitled';
  const used = new Set<string>();
  const entries: ZipEntry[] = [];
  const links: PackagedLink[] = [];
  for (const c of Object.values(doc.embeds ?? {})) {
    if (!c.link) continue;
    const fresh = await readLinkedFile(c);
    const blob = fresh ?? (c.source && e.assets.has(c.source) ? e.assets.blob(c.source) : undefined);
    const file = uniqueName(c.link.name || `${c.name}.png`, used);
    links.push({ name: c.name, file, from: fresh ? 'source' : blob ? 'copy' : 'missing' });
    if (!blob) continue;
    entries.push({ name: `${base}/Links/${file}`, data: new Uint8Array(await blob.arrayBuffer()) });
    // The packaged project points its links at the packaged files.
    c.link = { ...c.link, kind: 'local', name: file, path: `Links/${file}` };
  }
  const project = await serialize(doc, s.assets);
  entries.unshift({ name: `${base}/${base}.photo`, data: new Uint8Array(await project.arrayBuffer()) });
  entries.push({ name: `${base}/Package report.txt`, data: new TextEncoder().encode(packageReport(doc.name, links)) });
  download(new Blob([zipStore(entries) as BlobPart], { type: 'application/zip' }), `${base} Package.zip`);
  const copied = links.filter((l) => l.from !== 'missing').length;
  e.message(links.length ? `Packaged ${base} with ${copied} of ${links.length} linked file${links.length === 1 ? '' : 's'}.` : `Packaged ${base} (no linked files).`);
}
