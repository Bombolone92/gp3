/**
 * Uploading documents: a dialog with a drop zone, and a helper that stores
 * dropped files directly. Files go to the app's Puter folder (files.js);
 * only a small reference is kept on the document record.
 */
import '../styles/docs.css';
import { h, uniqueId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, meId } from '../app.js';
import { formDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { field, select } from '../ui/components.js';
import { matterPicker } from './common.js';
import { saveFile, fileIcon, MAX_BYTES, TEAM_MAX_BYTES } from '../files.js';
import { formatBytes } from '../core/format.js';
import { categoryOptions } from './docs-actions.js';

/**
 * Store files as documents. Resolves the saved records. Failures are
 * reported per file and do not stop the others.
 */
export async function uploadFiles(files, { matterId = null, category = '' } = {}) {
  const list = [...files].filter((f) => f && f.size !== undefined);
  if (!list.length) return [];
  const limit = app.team?.url ? TEAM_MAX_BYTES : MAX_BYTES;
  const saved = [];
  const failed = [];
  const closeProgress = list.length > 1 ? toast(`Uploading ${list.length} files`, { type: 'info', duration: 60000 }) : null;
  for (const f of list) {
    if (f.size > limit) {
      failed.push(`${f.name} is larger than ${formatBytes(limit)}`);
      continue;
    }
    try {
      const ref = await saveFile(f, { folder: matterId || 'firm' });
      saved.push(
        app.store.put('documents', {
          matterId: matterId || null,
          name: f.name || ref.name,
          category: category || '',
          folder: '',
          description: '',
          authorId: meId(),
          file: ref,
        }),
      );
    } catch (err) {
      failed.push(`${f.name}: ${err?.message || 'upload failed'}`);
    }
  }
  closeProgress?.();
  if (saved.length) toast(saved.length === 1 ? `${saved[0].name} uploaded` : `${saved.length} documents uploaded`);
  if (failed.length) toast(failed.length === 1 ? failed[0] : `${failed.length} files could not be uploaded. ${failed[0]}`, { type: 'error', duration: 8000 });
  return saved;
}

/** Upload dialog with matter, category, and a drop zone. Resolves the saved records. */
export function openUploadDocuments({ matterId = '', category = '' } = {}) {
  let files = [];
  const inputId = uniqueId('files');
  const input = h('input.sr-only', { type: 'file', id: inputId, multiple: true });
  const list = h('ul.upload-list', { 'aria-live': 'polite' });
  const matter = matterPicker({ value: matterId || '', label: 'Matter' });
  const cat = select({ name: 'category', value: category, options: categoryOptions(category) });

  function drawList() {
    list.replaceChildren(
      ...files.map((f, i) =>
        h(
          'li.upload-item',
          icon(fileIcon(f.type, f.name), 18),
          h('span.grow.truncate', f.name),
          h('span.subtle.num', formatBytes(f.size)),
          h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove ${f.name}`, onClick: () => ((files = files.filter((_, j) => j !== i)), drawList()) }, icon('x', 15)),
        ),
      ),
    );
  }
  function add(more) {
    for (const f of more) if (!files.some((x) => x.name === f.name && x.size === f.size)) files.push(f);
    drawList();
  }
  input.addEventListener('change', () => {
    add(input.files);
    input.value = '';
  });

  const zone = h(
    'label.drop-zone',
    { for: inputId },
    h('span.drop-icon', icon('upload', 22)),
    h('span.drop-title', 'Drop files here or ', h('span.link-like', 'browse')),
    h('span.subtle.small', `Up to ${formatBytes(app.team?.url ? TEAM_MAX_BYTES : MAX_BYTES)} per file`),
  );
  bindDrop(zone, add);

  return formDialog({
    title: 'Upload documents',
    body: h('div.stack', field('Matter', matter, { hint: 'Leave empty for a firm document.' }), field('Category', cat), h('div', input, zone), list),
    submitLabel: 'Upload',
    onSubmit: async (fd, form) => {
      if (!files.length) {
        toast('Choose at least one file to upload.', { type: 'error' });
        return false;
      }
      const btn = form.closest('dialog')?.querySelector('.dialog-foot .btn.primary');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Uploading';
      }
      const saved = await uploadFiles(files, { matterId: matter.value || null, category: fd.get('category') || '' });
      if (!saved.length) {
        // Nothing went up (the error toast says why): keep the dialog and its files to try again.
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Upload';
        }
        return false;
      }
      return saved;
    },
  });
}

const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
let guarded = false;

/**
 * Files dropped anywhere else on the page would make the browser open them
 * in place of the app. Once a drop target exists, refuse those drops.
 */
function guardWindow() {
  if (guarded) return;
  guarded = true;
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'none';
  });
  window.addEventListener('drop', (e) => hasFiles(e) && e.preventDefault());
}

/** Make `el` accept dropped files. `onFiles(fileList)` gets the files. */
export function bindDrop(el, onFiles) {
  let depth = 0;
  guardWindow();
  el.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    el.classList.add('dragging');
  });
  el.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) el.classList.remove('dragging');
  });
  el.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    el.classList.remove('dragging');
    if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
  });
}
