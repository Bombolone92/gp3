/**
 * Actions on one document: preview, download, rename, move to another
 * matter or category, and delete. Shared by the Documents page and the
 * matter's Documents tab.
 */
import '../styles/docs.css';
import { h, downloadBlob } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { openDialog, formDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { field, textInput, textarea, select, spinner, emptyState } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { matterPicker } from './common.js';
import { readFile, fileUrl, deleteFile, fileIcon } from '../files.js';
import { formatBytes, matterLabel } from '../core/format.js';
import { formatDate, today as dayOf } from '../core/dates.js';

const TEXT_LIMIT = 2 * 1024 * 1024;

export function categoryOptions(current = '') {
  const list = [...(app.settings().documentCategories || [])];
  if (current && !list.includes(current)) list.push(current);
  return [{ value: '', label: 'No category' }, ...list.map((c) => ({ value: c, label: c }))];
}

/** What kind of inline preview a file supports. */
export function previewKind(ref) {
  const t = String(ref?.type || '').toLowerCase();
  const name = String(ref?.name || '').toLowerCase();
  if (/^image\/(png|jpe?g|gif|webp|svg\+xml|avif)$/.test(t)) return 'image';
  if (t === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (t === 'text/html' || /\.html?$/.test(name)) return 'html';
  if (/^text\//.test(t) || /\.(txt|md|csv|log)$/.test(name)) return 'text';
  return 'none';
}

export async function downloadDocument(doc) {
  try {
    const blob = await readFile(doc.file);
    downloadBlob(blob, doc.name || doc.file.name || 'document');
  } catch (err) {
    toast(err?.message || 'The file could not be downloaded.', { type: 'error' });
  }
}

/** Open the document in a large preview dialog with its actions. */
export function openDocumentPreview(doc) {
  const body = h('div.doc-preview', { 'aria-busy': 'true' }, h('div.doc-preview-loading', spinner(22), h('span', 'Loading preview')));
  const kind = previewKind(doc.file);
  const meta = [
    lookup.matter(doc.matterId) ? matterLabel(lookup.matter(doc.matterId)) : 'Firm document',
    doc.category,
    formatBytes(doc.file?.size),
    doc.createdAt ? formatDate(dayOf(new Date(doc.createdAt))) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  let pdfUrl = null;
  const api = openDialog({
    title: doc.name,
    subtitle: meta,
    size: 'full',
    cls: 'doc-dialog',
    body,
    onClose: () => pdfUrl && URL.revokeObjectURL(pdfUrl),
    footer: ({ close }) => [
      h(
        'button.btn.ghost.danger-text',
        {
          type: 'button',
          onClick: async () => {
            if (await deleteDocument(doc)) close();
          },
        },
        icon('trash', 16),
        'Delete',
      ),
      h('div.spacer'),
      h('button.btn', { type: 'button', onClick: () => (close(), editDocumentDialog(doc)) }, icon('pencil', 16), 'Edit details'),
      h('button.btn.primary', { type: 'button', onClick: () => downloadDocument(doc) }, icon('download', 16), 'Download'),
    ],
  });
  (async () => {
    try {
      let node;
      // Object URLs share the app's origin, so PDFs are always typed as PDF
      // whatever type the record claims (fileUrl already serves SVG as a data URL).
      if (kind === 'image') {
        node = h('img.doc-img', { src: await fileUrl(doc.file), alt: doc.name });
      } else if (kind === 'pdf') {
        const pdf = new Blob([await readFile(doc.file)], { type: 'application/pdf' });
        if (!body.isConnected) return; // closed while loading
        pdfUrl = URL.createObjectURL(pdf);
        node = h('iframe.doc-frame', { src: pdfUrl, title: `Preview of ${doc.name}` });
      } else if (kind === 'html') {
        const blob = await readFile(doc.file);
        // Generated documents are shown in a fully sandboxed frame: no scripts, no same-origin access.
        node = h('iframe.doc-frame.paper', { sandbox: '', srcdoc: blob.size > TEXT_LIMIT ? '' : await blob.text(), title: `Preview of ${doc.name}` });
      } else if (kind === 'text') {
        const blob = await readFile(doc.file);
        node = h('pre.doc-text', blob.size > TEXT_LIMIT ? `${await blob.slice(0, TEXT_LIMIT).text()}\n\n[Preview truncated. Download the file to see all of it.]` : await blob.text());
      } else {
        node = emptyState({
          icon: fileIcon(doc.file?.type, doc.name),
          title: 'No preview for this file type',
          text: `${doc.name} (${formatBytes(doc.file?.size)}) can be opened after downloading it.`,
          actions: [h('button.btn.primary', { type: 'button', onClick: () => downloadDocument(doc) }, icon('download', 16), 'Download')],
          headingLevel: 3,
        });
      }
      body.replaceChildren(node);
    } catch (err) {
      body.replaceChildren(emptyState({ icon: 'alert', title: 'The preview could not be loaded', text: err?.message || 'Try downloading the file instead.', headingLevel: 3 }));
    } finally {
      body.removeAttribute('aria-busy');
    }
  })();
  return api;
}

/** Rename, recategorize, move to another matter, or describe a document. */
export function editDocumentDialog(doc) {
  const matter = matterPicker({ value: doc.matterId || '', label: 'Matter' });
  return formDialog({
    title: 'Document details',
    body: h(
      'div.stack',
      field('Name', textInput({ name: 'name', value: doc.name, autofocus: true }), { required: true }),
      field('Matter', matter, { hint: 'Leave empty for a firm document that is not tied to a matter.' }),
      field('Category', select({ name: 'category', value: doc.category || '', options: categoryOptions(doc.category) })),
      field('Description', textarea({ name: 'description', value: doc.description || '', rows: 3 })),
    ),
    submitLabel: 'Save changes',
    onSubmit: (fd) => {
      const name = String(fd.get('name') || '').trim();
      if (!name) return false;
      app.store.patch('documents', doc.id, { name, matterId: matter.value || null, category: fd.get('category') || '', description: String(fd.get('description') || '').trim() });
      toast('Document updated');
      return true;
    },
  });
}

/**
 * Delete a document. The file itself is removed permanently, so this asks
 * first and only deletes the file once the record is gone.
 */
export async function deleteDocument(doc) {
  const ok = await confirmDialog({
    title: 'Delete document?',
    message: `${doc.name} will be deleted permanently. This cannot be undone.`,
    confirmLabel: 'Delete document',
    danger: true,
  });
  if (!ok) return false;
  const rec = app.store.get('documents', doc.id) || doc;
  app.store.remove('documents', doc.id);
  try {
    if (rec.file) await deleteFile(rec.file);
    toast('Document deleted');
    return true;
  } catch (err) {
    app.store.restore('documents', rec);
    toast(`The file could not be deleted: ${err?.message || 'unknown error'}`, { type: 'error' });
    return false;
  }
}

/** Row action menu for a document. */
export function documentMenu(anchor, doc) {
  openMenu(anchor, [
    { label: 'Preview', icon: 'eye', run: () => openDocumentPreview(doc) },
    { label: 'Download', icon: 'download', run: () => downloadDocument(doc) },
    { label: 'Edit details', icon: 'pencil', run: () => editDocumentDialog(doc) },
    { separator: true },
    { label: 'Delete', icon: 'trash', danger: true, run: () => deleteDocument(doc) },
  ]);
}
