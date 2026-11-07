/**
 * Channel bookmarks: a strip of named links under the conversation header,
 * and the dialog that manages them (add, rename, reorder, remove). Links
 * open in a new tab with the same rel hardening messages use; a bookmarked
 * attachment downloads through the worker like any attachment.
 */
import { el, fieldId, keepFocus } from './dom.js';
import { icon, fileIcon } from './icons.js';
import { openModal } from './modal.js';
import { textDialog } from './dialogs.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { safeHref } from '../lib/format.js';
import { api } from '../lib/api.js';
import { LIMITS } from '../shared/limits.js';
import { downloadAttachment } from '../lib/files.js';
import { fileLabel, fileLabelShort } from './filename.js';

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function renderBookmarksBar(channel) {
  const list = channel.bookmarks || [];
  const canEdit = store.canCurate(channel.id);
  // A group, not a list: a listitem role would replace the link and button
  // roles, and a screen reader would no longer say these can be activated.
  const bar = el('div.bookmarks-bar', { role: 'group', 'aria-label': 'Bookmarks' });
  for (const b of list) {
    if (b.file) {
      bar.append(el('button.bookmark', {
        type: 'button', title: fileLabel(b.name || b.label), // the file's name as shown (see fileLabel); the download keeps its own
        onclick: () => downloadAttachment(store.hostRef(channel.id), { id: b.file, name: b.name || b.label }).catch(() => toast('Could not download the file', { icon: 'alert' })),
      }, el('span', { html: icon(fileIcon(''), 14, 2) }), el('span.bookmark-label', {}, b.label)));
    } else {
      bar.append(el('a.bookmark', {
        href: safeHref(b.url), target: '_blank', rel: 'noopener noreferrer nofollow', title: b.url,
      }, el('span', { html: icon('link', 14, 2) }), el('span.bookmark-label', {}, b.label), el('span.bookmark-host', {}, hostOf(b.url))));
    }
  }
  if (canEdit) {
    bar.append(el('button.bookmark.bookmark-add', {
      type: 'button', 'aria-label': list.length ? 'Edit bookmarks' : 'Add a bookmark', title: list.length ? 'Edit bookmarks' : 'Add a bookmark',
      onclick: () => bookmarksDialog(channel),
    }, el('span', { html: icon(list.length ? 'pencil' : 'bookmarkPlus', 14, 2) }), !list.length && el('span.bookmark-label', {}, 'Add a bookmark')));
  }
  if (!bar.children.length) bar.hidden = true;
  return bar;
}

/** Manage a channel's bookmarks: reorder with the arrows, rename, remove, add. */
export function bookmarksDialog(channel) {
  let items = (channel.bookmarks || []).map((b) => ({ ...b }));
  const listEl = el('div.bm-list', { role: 'list', 'aria-label': 'Bookmarks' });
  const status = el('p.field-hint', {}, `${items.length} of ${LIMITS.bookmarksPerChannel}`);
  // Every change writes the whole list, so the list written must be the
  // channel's current one: another curator's change landing while this
  // dialog is open is taken in from the workspace event (not while a save
  // of ours is in flight, whose answer is the fresher list).
  let pending = 0; // saves out
  let latest = 0; // the save whose answer stands
  // The list as the worker last confirmed it: what a refused save falls back
  // to. Not the list as it stood before the press: with two saves out (two
  // quick presses of an arrow), the second's "before" was the first's
  // optimistic move, and when both were refused (offline) the list came to
  // rest one move along, showing a change the worker never took, until the
  // dialog was opened again.
  let confirmed = items;
  let acked = 0; // the newest save the worker has answered
  /**
   * `keep`, for a move ({ label, dir }): the bookmark moved and the arrow
   * pressed, so that each redraw the save brings (the move shown at once,
   * the worker's answer, the old order back after a refusal) leaves the
   * keyboard with that bookmark (see keepWith), while the keyboard is in the
   * list at all.
   */
  const save = async (next, msg, keep = null) => {
    // The list shows the change at once, so a second press works from where
    // the first left it: the arrows used to move the list only when the
    // worker had answered, and two quick presses of the same arrow, each
    // reading the list as it still stood, wrote the same one-place move
    // twice. The answer to the last save is what stands (an earlier one
    // landing after it must not undo the later press), and a refusal puts
    // the list back to what the worker has.
    const redraw = () => {
      const inList = listEl.contains(document.activeElement);
      render();
      if (keep && inList) keepWith(keep.label, keep.dir);
    };
    const mine = ++latest;
    // Counted before the list is drawn, so the drawing holds Add and Remove
    // (see syncHold) from the first redraw on.
    pending += 1;
    items = next.map((b) => ({ ...b }));
    redraw();
    try {
      const { channel: updated } = await api.updateChannel(store.wsId, channel.id, { bookmarks: next });
      const taken = (updated.bookmarks || next).map((b) => ({ ...b }));
      // An older save's answer landing after a newer one's says nothing new
      // about what the worker holds now.
      if (mine > acked) {
        acked = mine;
        confirmed = taken;
      }
      if (mine === latest) {
        items = taken;
        redraw();
      }
      await store.refreshAfterChange();
      if (msg) toast(msg);
      return true;
    } catch (e) {
      if (mine === latest) {
        items = confirmed;
        redraw();
      }
      toast(e.message, { icon: 'alert' });
      return false;
    } finally {
      pending -= 1;
      syncHold();
    }
  };
  /**
   * Add and the Remove buttons wait while a save is out; the arrows do not
   * (see save: two quick presses of one arrow are two moves). Remove is the
   * one press that cannot be undone here and moves the list under the
   * pointer as it is pressed, so the second click of a double click landed
   * on the next bookmark's Remove and took that one too; and Enter twice in
   * the Add form (the words still in it until the worker answers) wrote the
   * same bookmark twice. Add is busy, not disabled, while the save is out:
   * a disabled button under the keyboard (pressed with Enter or Space, or
   * clicked) hands its focus to the page body, and after a refusal it came
   * back live with nobody on it, the next Tab starting over from the top of
   * the dialog. Enter in a field of the form meanwhile is refused by the
   * form itself (see onsubmit). Disabled only at the channel's limit, where
   * there is nothing more to add.
   */
  const syncHold = () => {
    addBtn.disabled = items.length >= LIMITS.bookmarksPerChannel;
    if (pending) addBtn.setAttribute('aria-busy', 'true');
    else addBtn.removeAttribute('aria-busy');
    for (const b of listEl.querySelectorAll('[data-remove]')) {
      if (pending) b.setAttribute('aria-busy', 'true');
      else b.removeAttribute('aria-busy');
    }
  };
  const follow = () => {
    if (pending) return;
    const cur = store.channel(channel.id)?.bookmarks;
    if (!cur) return;
    confirmed = cur.map((b) => ({ ...b }));
    if (JSON.stringify(cur) === JSON.stringify(items)) return;
    items = confirmed;
    render();
  };

  /**
   * After a move, the keyboard stays with the bookmark moved: on the arrow
   * just pressed where it still has somewhere to go, else on the row's other
   * arrow. At the end of the list the arrow pressed is disabled, and a
   * disabled button cannot hold the keyboard, so the redraw put it back by
   * place, on the neighbouring row's arrow of the same kind: a press away
   * from undoing the move just made.
   */
  const keepWith = (label, dir) => {
    const row = [...listEl.querySelectorAll('.bm-row')].find((r) => r.querySelector('strong')?.textContent === label);
    const same = row?.querySelector(`[aria-label="Move ${label} ${dir}"]`);
    const other = row?.querySelector(`[aria-label="Move ${label} ${dir === 'up' ? 'down' : 'up'}"]`);
    ((same && !same.disabled ? same : other) || row?.querySelector('button:not([disabled])'))?.focus({ preventScroll: true });
  };

  function render() {
    status.textContent = `${items.length} of ${LIMITS.bookmarksPerChannel}`;
    // Move, rename and remove redraw the list: the button under the keyboard
    // (or its row's) keeps focus, so a reorder by keyboard can go on.
    keepFocus(listEl, () => listEl.replaceChildren(...items.map((b, i) => el('div.bm-row', { role: 'listitem' },
      el('span', { html: icon(b.file ? fileIcon('') : 'link', 16), style: { color: 'var(--ink-3)' } }),
      el('span.pick-text', {}, el('strong', {}, b.label), el('span', { title: b.file ? fileLabel(b.name) : null }, b.file ? (fileLabelShort(b.name) || 'Attachment') : b.url)),
      el('button.icon-btn.icon-btn-sm', {
        type: 'button', html: icon('arrowUp', 15), 'aria-label': `Move ${b.label} up`, disabled: i === 0 || null,
        onclick: () => save(move(items, i, i - 1), undefined, { label: b.label, dir: 'up' }),
      }),
      el('button.icon-btn.icon-btn-sm', {
        type: 'button', html: icon('arrowDown', 15), 'aria-label': `Move ${b.label} down`, disabled: i === items.length - 1 || null,
        onclick: () => save(move(items, i, i + 1), undefined, { label: b.label, dir: 'down' }),
      }),
      el('button.icon-btn.icon-btn-sm', {
        type: 'button', html: icon('pencil', 15), 'aria-label': `Rename ${b.label}`,
        onclick: async () => {
          const name = await textDialog({ title: 'Rename bookmark', label: 'Name', initial: b.label, confirmLabel: 'Rename', maxlength: LIMITS.bookmarkLabel, required: 'Give the bookmark a name' });
          if (name && name !== b.label) save(items.map((x, j) => (j === i ? { ...x, label: name.slice(0, LIMITS.bookmarkLabel) } : x)), 'Renamed');
        },
      }),
      el('button.icon-btn.icon-btn-sm', {
        type: 'button', html: icon('x', 15), 'aria-label': `Remove ${b.label}`, dataset: { remove: '' },
        onclick: () => { if (!pending) save(items.filter((_, j) => j !== i), 'Bookmark removed'); },
      })))));
    if (!items.length) listEl.append(el('div.empty', { style: { padding: '16px' } }, el('p', {}, 'No bookmarks yet')));
    syncHold();
  }

  const labelInput = el('input.input', { id: fieldId('bm'), placeholder: 'Name, e.g. Roadmap', maxlength: LIMITS.bookmarkLabel });
  // type="text": a url field's own validation would refuse "example.com"
  // before the form could add the https:// it means, as the composer's link box does.
  const urlInput = el('input.input', { id: fieldId('bm'), type: 'text', placeholder: 'https://', maxlength: LIMITS.bookmarkUrl, inputmode: 'url', autocapitalize: 'off', autocomplete: 'off', spellcheck: false });
  // Announced when shown, and tied to the field it is about, which takes focus.
  const err = el('p.field-error', { id: fieldId('bm-err'), role: 'alert', hidden: true });
  const addBtn = el('button.btn.btn-primary', { type: 'submit' }, 'Add');
  const form = el('form.bm-form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (pending) return; // a save is out (see syncHold): Enter again is not another bookmark
      const label = labelInput.value.trim();
      let url = urlInput.value.trim();
      // A bare address ("example.com") means https. One typed with another
      // scheme (mailto:, ftp:, javascript:) does not: "https://" was put in
      // front of whatever had none of "http://" or "https://", so
      // mailto:ana@example.com was saved as https://mailto:ana@example.com,
      // a link to example.com signed in as "mailto", without a word. Such a
      // link is refused as the worker refuses it, since bookmarks are
      // http(s) links alone. A host with a port (localhost:5173/admin,
      // grafana.internal:3000) is a bare address, not a scheme: read as one
      // by the letters before its colon, it was refused as "not a full
      // link" where the form had always meant https by it.
      if (url && !/^[a-z][a-z0-9+.-]*:(?!\d{1,5}(?:[/?#]|$))/i.test(url)) url = `https://${url}`;
      clearError();
      if (!label) return show('Give the bookmark a name', labelInput);
      if (!/^https?:\/\/[^\s]+$/i.test(url)) return show('Enter a full link, starting with https://', urlInput);
      // The field's maxlength counts what was typed; the https:// added here
      // does not, and the worker cuts a longer address short without a word.
      if (url.length > LIMITS.bookmarkUrl) return show(`That link is too long (${LIMITS.bookmarkUrl} characters at most)`, urlInput);
      // What was typed stays in the form when the save fails (offline, the
      // list filled by someone else meanwhile), to try again or copy out.
      if (!(await save([...items, { label, url }], 'Bookmark added'))) return;
      labelInput.value = '';
      urlInput.value = '';
      labelInput.focus();
    },
  },
  el('div.bm-form-fields', {},
    el('div.field', {}, el('label.field-label', { for: labelInput.id }, 'Name'), labelInput),
    el('div.field', {}, el('label.field-label', { for: urlInput.id }, 'Link'), urlInput)),
  err,
  el('div.row.row-end', {}, addBtn));
  const clearError = () => {
    err.hidden = true;
    for (const f of [labelInput, urlInput]) {
      f.removeAttribute('aria-invalid');
      f.removeAttribute('aria-describedby');
    }
  };
  const show = (m, field) => {
    err.textContent = m;
    err.hidden = false;
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', err.id);
    field.focus();
  };

  const content = el('div', {},
    el('p.small.muted', { style: { marginBottom: '10px' } }, 'Links everyone in the channel should have at hand: docs, dashboards, the tracker. Attachments can be bookmarked from their message menu.'),
    listEl, status,
    el('h3.field-label', { style: { margin: '18px 0 8px' } }, 'Add a link'),
    form,
    el('div.modal-actions', {}, el('button.btn', { type: 'button', onclick: () => modal.close() }, 'Done')));
  const off = store.on('workspace', follow);
  const modal = openModal({ title: `Bookmarks in #${channel.name}`, content, onClose: off });
  render();
}

function move(list, from, to) {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
