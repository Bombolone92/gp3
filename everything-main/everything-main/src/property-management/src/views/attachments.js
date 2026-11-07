/** "Files and photos" card for properties, leases, tenants, work orders and more. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { saveFile, fileUrl, deleteFile, isImage, formatBytes } from '../files.js';

const io = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        e.target.dispatchEvent(new Event('visible'));
      }
    }, { rootMargin: '200px' })
  : null;

export function attachmentsCard(coll, record, { title = 'Files and photos', folder } = {}) {
  const store = app.store;
  const list = record.attachments || [];
  const input = h('input', { type: 'file', multiple: true, accept: 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt', hidden: true });
  const status = h('span.subtle', { 'aria-live': 'polite', style: { fontSize: '12px' } });

  async function upload(files) {
    if (!files?.length) return;
    const added = [];
    status.textContent = `Uploading ${files.length} file${files.length === 1 ? '' : 's'}...`;
    for (const f of files) {
      try {
        added.push(await saveFile(f, folder || `files/${coll}`));
      } catch (err) {
        toast(err?.message || `Could not upload ${f.name}`, { type: 'error' });
      }
    }
    status.textContent = '';
    if (!added.length) return;
    store.patch(coll, record.id, (r) => ((r.attachments = [...(r.attachments || []), ...added]), r));
    toast(`${added.length} file${added.length === 1 ? '' : 's'} added`);
  }

  input.addEventListener('change', () => {
    upload([...input.files]);
    input.value = '';
  });

  const grid = h(
    'div.att-grid',
    list.map((att) => tile(att)),
    h(
      'button.att-add',
      { type: 'button', onClick: () => input.click() },
      icon('upload', 20),
      h('span', 'Add files'),
      h('span.subtle', { style: { fontSize: '11px' } }, 'or drop them here'),
    ),
  );

  function tile(att) {
    const thumb = h('span.att-thumb', isImage(att.type) ? icon('image', 22) : icon('file', 22));
    if (isImage(att.type)) {
      const load = async () => {
        try {
          const url = await fileUrl(att);
          thumb.replaceChildren(h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }));
        } catch {}
      };
      if (io) {
        thumb.addEventListener('visible', load, { once: true });
        requestAnimationFrame(() => io.observe(thumb));
      } else load();
    }
    return h(
      'div.att-tile',
      h('button.att-open', { type: 'button', 'aria-label': `Open ${att.name}`, onClick: () => preview(att) }, thumb, h('span.att-name.truncate', att.name), h('span.att-size', formatBytes(att.size))),
      h(
        'button.icon-btn.sm.att-del',
        {
          type: 'button',
          'aria-label': `Remove ${att.name}`,
          title: 'Remove',
          onClick: async () => {
            if (!(await confirmDialog({ title: `Remove ${att.name}?`, message: 'The file is deleted from your storage.', confirmLabel: 'Remove', danger: true }))) return;
            store.patch(coll, record.id, (r) => ((r.attachments = (r.attachments || []).filter((a) => a.id !== att.id)), r));
            deleteFile(att).catch(() => toast('The file reference was removed, but deleting it from storage failed.', { type: 'error' }));
          },
        },
        icon('x', 14),
      ),
    );
  }

  const card = h(
    'section.card.att-card',
    h('div.card-head', h('h2.grow', title, list.length ? h('span.count', ` ${list.length}`) : null), status, h('button.btn.sm', { type: 'button', onClick: () => input.click() }, icon('paperclip', 14), 'Attach')),
    h('div.card-body', grid, input),
  );
  card.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    card.classList.add('drop-target');
  });
  card.addEventListener('dragleave', (e) => !card.contains(e.relatedTarget) && card.classList.remove('drop-target'));
  card.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files?.length) return;
    e.preventDefault();
    card.classList.remove('drop-target');
    upload([...e.dataTransfer.files]);
  });
  return card;
}

export async function preview(att) {
  let url;
  try {
    url = await fileUrl(att);
  } catch {
    toast('This file could not be opened.', { type: 'error' });
    return;
  }
  if (!isImage(att.type)) {
    const a = h('a', { href: url, download: att.name, target: '_blank', rel: 'noopener' });
    document.body.append(a);
    a.click();
    a.remove();
    return;
  }
  openDialog({
    title: att.name,
    size: 'wide',
    body: h('div.att-preview', h('img', { src: url, alt: att.name })),
    footer: ({ close }) => [h('a.btn', { href: url, download: att.name }, icon('download', 16), 'Download'), h('div.spacer'), h('button.btn.primary', { type: 'button', onClick: () => close() }, 'Done')],
  });
}
