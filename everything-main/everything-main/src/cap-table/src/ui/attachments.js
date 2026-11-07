/**
 * Document attachments: the paper behind the records. A signed SPA behind a
 * certificate, the option agreement behind a grant, the 409A report behind a
 * valuation - stored as files in the user's own Puter cloud via puter.fs,
 * with the record keeping only the path and a display name.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { isRefusal } from '../lib/store.js';

const ACCEPT = '.pdf,application/pdf,image/*';

/* The paper behind a record is a signed PDF or a scan, tens of pages at the
   outside. Nothing checked the size, so a mis-picked file of any size went
   straight to the upload: the button read "Attaching…" with no way to stop it
   while a multi-gigabyte video crawled into the user's cloud. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Types safe to render in a tab, by file extension. A blob: URL inherits the
 * origin of the page that made it, so a viewed attachment is a document on
 * CapTable's own origin - and an SVG (which the picker's `image/*` accepts,
 * and which any file can be renamed into) carries script. Nothing outside
 * this table is ever handed to the renderer: PDFs go to the browser's viewer
 * and raster images decode as pixels, neither of which can run script.
 */
const INLINE_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
};

/** The vetted type for a stored file, from its name - never the stored blob's
 *  own type, which is whatever the uploader claimed it was. */
function inlineType(name) {
  const ext = /\.([a-z0-9]+)$/i.exec(String(name || ''))?.[1]?.toLowerCase();
  return (ext && Object.hasOwn(INLINE_TYPES, ext)) ? INLINE_TYPES[ext] : null;
}

/**
 * Open an attachment: PDFs and raster images view in a tab, anything else
 * downloads under its own name rather than rendering in this origin.
 */
export async function openAttachmentFile(att) {
  const type = inlineType(att.name);
  /* The tab is opened inside the click, before anything is awaited: a
     window.open after the file has been read is no longer part of the
     user's gesture, and Safari blocks it every time while Chrome does once
     the read runs long. It shows the file once that arrives. */
  let win = null;
  if (type) {
    win = window.open('', '_blank');
    if (win) win.opener = null;
    else toast('Allow pop-ups to view attachments', { icon: 'alert' });
  }
  try {
    const stored = await puter.fs.read(att.path);
    // Re-wrapped rather than passed through, so the type the browser sees is
    // the one vetted above and not the one the file carried in with.
    const blob = new Blob([await stored.arrayBuffer()],
      { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    if (type) {
      if (win) win.location = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = att.name || 'attachment';
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    console.error(err);
    win?.close();
    toast('Couldn’t open that file. It may have been removed', { icon: 'alert' });
  }
}

/** The added date in the user's own time - going through toISOString would
 *  date an evening upload tomorrow for anyone west of UTC. */
function addedOn(ts) {
  return ts > 0
    ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
}

function prettySize(bytes) {
  if (!(bytes > 0)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, '')} GB`;
}

/**
 * The management block: list, open, remove, upload. `getAttachments` reads
 * fresh state on every render so the block stays true after each change;
 * `upload(file)` and `remove(attachment)` do the store work.
 */
export function attachmentsSection({ getAttachments, upload, remove }) {
  const wrap = el('div', { style: { marginTop: '4px' } });
  // A large file can take a while, and an upload that looks like nothing is
  // happening invites a second click on top of the first.
  let uploading = false;

  const fileInput = el('input', {
    type: 'file', accept: ACCEPT, 'aria-label': 'Attach a file',
    style: { display: 'none' },
    onchange: async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (file.size > MAX_BYTES) {
        toast(`That file is ${prettySize(file.size)}. Attachments go up to ${prettySize(MAX_BYTES)}`,
          { icon: 'alert' });
        return;
      }
      uploading = true;
      render();
      try {
        await upload(file);
        toast('Attachment added');
      } catch (err) {
        console.error(err);
        toast(isRefusal(err) ? err.message : 'Couldn’t upload. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
      }
      uploading = false;
      render();
      /* Each render rebuilds the block, the Attach button that had focus
         included - and with the app inert behind the dialog, focus fell to
         the document body and the next Tab restarted at the top of the
         sheet. Back onto the rebuilt button. */
      attachBtn?.focus();
    },
  });

  let attachBtn = null;

  function render() {
    const attachments = getAttachments();
    wrap.replaceChildren(
      el('h3.card-title', { style: { margin: '10px 0 6px', fontSize: '13.5px' } },
        'Attachments'),
      attachments.length
        ? el('div', {}, attachments.map((a, i) => el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' },
        },
          el('span', { html: icon('paperclip', 14, 2), style: { display: 'inline-flex', color: 'var(--ink-3)', flexShrink: '0' } }),
          el('button.btn-link', {
            type: 'button',
            style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            title: `Open ${a.name}`,
            onclick: () => openAttachmentFile(a),
          }, a.name),
          el('span.small.muted', { style: { flexShrink: '0' } },
            [prettySize(a.size), addedOn(a.addedAt)].filter(Boolean).join(' · ')),
          el('button.icon-btn', {
            html: icon('x', 14, 2), 'aria-label': `Remove ${a.name}`,
            onclick: async () => {
              const ok = await confirmDialog({
                title: `Remove ${a.name}?`,
                message: 'The file is deleted from your Puter cloud along with the reference, unless another company or a restore point still names it.',
                confirmLabel: 'Remove',
              });
              if (!ok) return;
              try {
                await remove(a);
                toast('Attachment removed', { icon: 'trash' });
              } catch (err) {
                console.error(err);
                toast('Couldn’t remove. Check your connection', { icon: 'wifiOff' });
              }
              render();
              // Onto the remove button that took this row's place, or the
              // last one, or Attach file once the list is empty.
              const left = [...wrap.querySelectorAll('.icon-btn')];
              (left[Math.min(i, left.length - 1)] || attachBtn)?.focus();
            },
          }))))
        : el('p.field-hint', { style: { margin: '0 0 6px' } },
          'The paper behind this record: a signed agreement, the instrument itself, a report. PDF and images.'),
      fileInput,
      attachBtn = el('button.btn.btn-ghost', {
        type: 'button', html: icon('paperclip', 14, 2),
        disabled: uploading,
        onclick: () => fileInput.click(),
      }, uploading ? ' Attaching…' : ' Attach file'));
  }
  render();
  return wrap;
}

/** Standalone manager in a modal (valuation rows in Settings use this). */
export function openAttachmentsModal({ title, getAttachments, upload, remove }) {
  openModal({
    title,
    content: el('div', {}, attachmentsSection({ getAttachments, upload, remove })),
  });
}

/**
 * "Delete the record - and its attachments?" A record with paper behind it
 * never deletes silently; the caller gets 'keep' | 'delete' | null.
 *
 * `message` overrides the line above the buttons, for a delete that takes
 * more with it than the one record - a stakeholder and every security they
 * hold - where what else is going has to be said first.
 *
 * Cancel leads, exactly as it does on every other confirmation in the app.
 * It is the escape route, and it is also what the dialog opens focused on -
 * openModal hands focus to the first control it finds, and with two delete
 * buttons and nothing else that was a destructive action one Return away,
 * on the one sheet in the app that had no visible way to back out at all.
 */
export function attachmentChoiceDialog({ title, count, message = null }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    const modal = openModal({
      title,
      onClose: () => settle(null),
      content: el('div', {},
        el('p.confirm-message', {}, message
          || `This record carries ${count} attachment${count === 1 ? '' : 's'} in your Puter cloud. Undo restores the record, but never a deleted file.`),
        /* Wrapping and right-aligned: three labelled buttons want about 380px
           and a phone sheet gives 280, so they stack rather than being cut
           off - the same rule the CSV wizard's template pair follows. */
        el('div.row.row-end', { style: { marginTop: '6px', flexWrap: 'wrap' } },
          el('button.btn.btn-ghost', {
            onclick: () => modal.close(),
          }, 'Cancel'),
          el('button.btn.btn-ghost', {
            onclick: () => { settle('keep'); modal.close(); },
          }, 'Delete, keep files'),
          el('button.btn.btn-danger', {
            onclick: () => { settle('delete'); modal.close(); },
          }, 'Delete files too'))),
    });
  });
}
