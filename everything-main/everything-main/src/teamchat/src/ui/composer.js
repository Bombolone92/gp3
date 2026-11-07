/**
 * The message composer: an auto-growing textarea with Enter-to-send,
 * attachments (button, paste, drop), and @mention autocomplete. Editing a
 * message happens in place, in its row (see message.js).
 */
import { el, fieldId, coarsePointer, enterSends, keepFocus, composing, toolbarNav } from './dom.js';
import { icon } from './icons.js';
import { avatar, statusChip } from './avatar.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { api } from '../lib/api.js';
import { LIMITS } from '../shared/limits.js';
import { formatBytes } from '../lib/format.js';
import { searchEmoji, emojiReady, loadEmoji, noteEmojiUse, withTone, preferredTone, keyFor } from '../lib/emoji.js';
import { openEmojiPicker } from './emojipicker.js';
import { openMenu } from './menu.js';
import { sendPresets, aroundText } from '../lib/schedule.js';
import { pickTimeDialog } from './dialogs.js';
import { applyFormat, formatForKey, FORMATS } from '../lib/formatting.js';
import { openPopover } from './menu.js';
import { getDraft, setDraft } from '../lib/drafts.js';
import { matchMembers } from '../lib/mentions.js';
import { fileLabel, fileLabelShort } from './filename.js';

const FMTBAR_KEY = 'teamchat:fmtbar';
/**
 * Files still going up, by draft key (a conversation, a thread), and the
 * box now open on each. A box goes as its conversation is left, or is
 * rebuilt under a change of the channel's rules, and a file dropped into
 * it a moment before is still on its way: the box opened next on the same
 * conversation showed no sign of it, and when the upload landed the box
 * that was gone wrote the draft with its words as it had last seen them,
 * over whatever had been typed since. The entries are shared: the box
 * opened next takes them over (its chips say "uploading", and Send waits
 * for them as it does for its own), and an upload that lands after its
 * box went is handed to the box then open, or written into the draft
 * beside the words already saved there when none is.
 */
const inflight = new Map(); // draft key -> Set of attachment entries still uploading
const openBoxes = new Map(); // draft key -> the box open on it: { landed(entry, error) }
/**
 * Files picked while the connection was away, by draft key, of a box that
 * has gone (the conversation left, the box rebuilt): their bytes are on this
 * device alone (the draft keeps the ids of files that have gone up, and these
 * have none), so the box opened next on the conversation takes them back as
 * they were, rather than the chips going without a word as the conversation
 * was left. Kept for the session: a reload loses them, as it loses all that
 * is held in memory. Let go of with the message they went with, or when
 * their chips were taken out.
 */
const parked = new Map(); // draft key -> [entry], each with `offline` and its `file`
/** Whether the formatting row is shown: remembered, and on by default where there is a keyboard. */
function fmtBarShown() {
  try {
    const v = localStorage.getItem(FMTBAR_KEY);
    if (v != null) return v === '1';
  } catch { /* ignore */ }
  return !matchMedia('(pointer: coarse)').matches;
}


/**
 * createComposer({ placeholder, onSend, onEditLast, autofocus, draftKey })
 *   onSend(text, attachments) -> Promise; resolves when accepted.
 *   onEditLast() called when ArrowUp is pressed in an empty box.
 *   draftKey: identifies the conversation, so what was typed comes back.
 * Returns { el, focus, setDisabled, destroy }.
 */
/**
 * `beforeSend(text)` may ask the sender something (the @channel
 * confirmation) and answer false to keep the message: it runs before the
 * box is cleared, so the words stay in view behind the question and the
 * draft stands until the message really goes.
 */
export function createComposer({ placeholder = 'Message', onSend, onSendLater = null, onEditLast, beforeSend = null, autofocus = false, draftKey = null, convId = null, typingConv = null }) {
  const textareaId = fieldId('composer');
  const textarea = el('textarea', {
    id: textareaId,
    rows: 1,
    placeholder,
    'aria-label': placeholder,
    'aria-autocomplete': 'list',
    autocomplete: 'off',
    // Typed right to left when the words are (Hebrew, Arabic), as the message will read.
    dir: 'auto',
  });
  // The on-screen keyboard's Enter is labelled by what Enter does here: a
  // newline on phones and when Enter-sends is off, Send otherwise.
  const enterSendsNow = () => enterSends(store.profile?.prefs);
  const labelEnter = () => textarea.setAttribute('enterkeyhint', enterSendsNow() ? 'send' : 'enter');
  labelEnter();
  const offProfile = store.on('profile', labelEnter);
  const attachInput = el('input', { type: 'file', multiple: true, hidden: true, 'aria-hidden': 'true', tabindex: -1 });
  // The "+" at the start of the row: what can go into the message
  // besides typing. The menu opens upward so it never covers the text.
  const attachBtn = el('button.icon-btn.composer-plus', {
    type: 'button', html: icon('plus', 18, 2.2), 'aria-label': 'Attach', title: 'Attach', 'aria-haspopup': 'menu',
    onclick: (e) => openMenu(e.currentTarget, [
      { label: 'Upload from your computer', icon: 'upload', sub: `Up to ${LIMITS.attachmentsPerMessage} files, ${formatBytes(LIMITS.attachmentBytes)} each`, onSelect: () => attachInput.click() },
      { label: 'Code snippet', icon: 'codeBlock', sub: 'A fenced block with a language label', onSelect: () => { format('codeBlock'); textarea.focus(); } },
    ], { align: 'start', side: 'top', label: 'Attach' }),
  });
  const mentionBtn = el('button.icon-btn', {
    type: 'button', html: icon('at', 18), 'aria-label': 'Mention someone', title: 'Mention someone',
    onclick: () => {
      insertAtCursor('@');
      textarea.focus();
      updateMention();
    },
  });
  const emojiBtn = el('button.icon-btn', {
    type: 'button', html: icon('smilePlus', 18), 'aria-label': 'Add emoji', title: 'Add emoji', 'aria-haspopup': 'dialog',
    onclick: (e) => openEmojiPicker(e.currentTarget, {
      label: 'Add an emoji',
      onPick: (key, char) => {
        insertAtCursor(char);
        textarea.focus();
      },
    }),
  });
  /* ---- formatting ---------------------------------------------------- */

  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const shortcutLabel = (f) => `${mac ? '\u2318' : 'Ctrl+'}${f.shift ? (mac ? '\u21e7' : 'Shift+') : ''}${f.alt ? (mac ? '\u2325' : 'Alt+') : ''}${f.key.toUpperCase()}`;
  const fmtBtn = (kind, ic) => el('button.icon-btn.fmt-btn', {
    type: 'button', html: icon(ic, 16, 2.1), 'aria-label': FORMATS[kind].label, title: `${FORMATS[kind].label} (${shortcutLabel(FORMATS[kind])})`,
    onmousedown: (e) => e.preventDefault(), // keep the selection in the textarea
    onclick: (e) => (kind === 'link' ? askLink(e.currentTarget) : format(kind)),
  });
  const fmtBar = el('div.composer-fmt', { role: 'toolbar', 'aria-label': 'Formatting' },
    fmtBtn('bold', 'bold'), fmtBtn('italic', 'italic'), fmtBtn('strike', 'strike'),
    el('span.fmt-sep', { 'aria-hidden': 'true' }),
    fmtBtn('link', 'link'),
    el('span.fmt-sep', { 'aria-hidden': 'true' }),
    fmtBtn('quote', 'quote'),
    el('span.fmt-sep', { 'aria-hidden': 'true' }),
    fmtBtn('code', 'code'), fmtBtn('codeBlock', 'codeBlock'));
  // One tab stop for the row, the arrows between its buttons (the ARIA
  // toolbar): Shift+Tab out of the box used to walk every button one by one.
  const roveFmt = toolbarNav(fmtBar);
  fmtBar.hidden = !fmtBarShown();
  const fmtToggle = el('button.icon-btn.fmt-toggle', {
    type: 'button', html: icon('type', 18), 'aria-label': 'Formatting', title: 'Show formatting',
    'aria-pressed': String(!fmtBar.hidden),
    onclick: () => {
      fmtBar.hidden = !fmtBar.hidden;
      fmtToggle.setAttribute('aria-pressed', String(!fmtBar.hidden));
      fmtToggle.title = fmtBar.hidden ? 'Show formatting' : 'Hide formatting';
      fmtToggle.classList.toggle('active', !fmtBar.hidden);
      try { localStorage.setItem(FMTBAR_KEY, fmtBar.hidden ? '0' : '1'); } catch { /* ignore */ }
      textarea.focus();
    },
  });
  fmtToggle.classList.toggle('active', !fmtBar.hidden);
  if (!fmtBar.hidden) fmtToggle.title = 'Hide formatting';

  /** Apply a format to the selection and put the caret back where the helper says. */
  function format(kind, extra) {
    if (disabled) return;
    const state = { value: textarea.value, start: textarea.selectionStart ?? textarea.value.length, end: textarea.selectionEnd ?? textarea.value.length };
    const next = applyFormat(state, kind, extra);
    if (next === state) return;
    textarea.focus();
    // setRangeText keeps the browser's undo stack, unlike assigning value.
    textarea.setSelectionRange(0, textarea.value.length);
    textarea.setRangeText(next.value, 0, textarea.value.length, 'end');
    textarea.setSelectionRange(next.start, next.end);
    textarea.dispatchEvent(new Event('input'));
  }

  /** The link button: a small popover asking for the address. */
  function askLink(anchor) {
    const input = el('input.input', { type: 'text', inputmode: 'url', placeholder: 'https://', 'aria-label': 'Link address', autocomplete: 'off', spellcheck: false });
    const sel = textarea.value.slice(textarea.selectionStart ?? 0, textarea.selectionEnd ?? 0).trim();
    if (/^https?:\/\//i.test(sel)) input.value = sel;
    const done = () => {
      const url = input.value.trim();
      pop.close(false);
      if (!url) { textarea.focus(); return; }
      // A bare address means https; one typed with a scheme of its own
      // (mailto:, ftp:) goes in as typed, rather than dressed as https
      // ("https://mailto:ana@example.com", a link to the wrong place). The
      // message links http(s) addresses alone; anything else stands as words.
      // A host with a port (localhost:5173/admin, example.com:8080) is a
      // bare address, not a scheme: read as one by the letters before its
      // colon, it went into the message as words, where it had always been
      // made an https link (the same rule as the bookmarks form's).
      format('link', /^[a-z][a-z0-9+.-]*:(?!\d{1,5}(?:[/?#]|$))/i.test(url) ? url : `https://${url}`);
    };
    const form = el('form.link-pop', {
      onsubmit: (e) => { e.preventDefault(); done(); },
    }, input, el('button.btn.btn-sm.btn-primary', { type: 'submit' }, 'Add'));
    // The box is where the writer was, whether the popover was opened with
    // the shortcut or the toolbar's button (whose press keeps the caret in
    // the box): Escape used to leave the keyboard on that button instead.
    const pop = openPopover(anchor, form, { label: 'Add a link', side: 'top', onClose: () => textarea.focus({ preventScroll: true }) });
    input.focus();
  }

  const sendBtn = el('button.send-btn', {
    type: 'button', html: icon('send', 17, 2), 'aria-label': 'Send message', disabled: true,
    // The keyboard stays in the box through a press of the pointer on Send
    // (as through the formatting buttons'): a browser moves it to the button
    // pressed, and the button goes disabled a moment later with the box
    // emptied (see refreshSend), which dropped it to the page, so the next
    // words typed landed nowhere until the worker had answered, and on a
    // phone the on-screen keyboard went down with every message sent.
    onmousedown: (e) => e.preventDefault(),
    onclick: () => submit(),
  });
  // "Send later": presets in the sender's zone, or a custom time.
  const laterBtn = onSendLater ? el('button.send-later', {
    type: 'button', html: icon('chevDown', 15, 2.4), 'aria-label': 'Send later', title: 'Send later', 'aria-haspopup': 'menu', disabled: true,
    onclick: (e) => scheduling || openMenu(e.currentTarget, [
      { header: 'Send later' },
      ...sendPresets().map((p) => ({ label: p.label, sub: aroundText(p.at), onSelect: () => submit({ dueAt: p.at }) })),
      'sep',
      { label: 'Custom time\u2026', icon: 'clock', onSelect: async () => { const t = await pickTimeDialog({ title: 'Send later' }); if (t) submit({ dueAt: t }); } },
    ], { align: 'end', side: 'top', label: 'Send later' }),
  }) : null;
  // Shown near the limit, and announced once when the message goes over it,
  // rather than on every keystroke.
  const count = el('span.composer-count', { 'aria-hidden': 'true', hidden: true });
  const limitNote = el('span.visually-hidden', { role: 'status' });
  const attachmentsRow = el('div.composer-attachments', { hidden: true });
  const box = el('div.composer', {},
    fmtBar,
    attachmentsRow,
    textarea,
    el('div.composer-bar', {}, attachBtn, fmtToggle, emojiBtn, mentionBtn, el('span.spacer'), count, limitNote, el('span.send-group', {}, sendBtn, laterBtn)));
  const root = el('div.composer-wrap', {}, box, attachInput);

  let attachments = []; // { id?, name, size, type, uploading, file }
  let draftTimer = null; // pending draft write, see saveDraft
  let disabled = false;
  let scheduling = false; // a "Send later" request is out; see submit
  let mention = null; // { start, query, items, index, node }
  let wasOver = false;

  /* ---- sizing & state ---------------------------------------------------- */

  function autosize() {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, window.innerHeight * 0.4)}px`;
  }

  /** Characters left before the server would start cutting the message. */
  function remaining() {
    return LIMITS.messageText - textarea.value.trim().length;
  }

  function refreshSend() {
    const hasText = textarea.value.trim().length > 0;
    const hasFiles = attachments.some((a) => a.id || a.offline);
    const uploading = attachments.some((a) => a.uploading);
    const left = remaining();
    const over = left < 0;
    count.hidden = left > LIMITS.messageText / 20;
    count.textContent = String(left);
    count.classList.toggle('over', over);
    textarea.setAttribute('aria-invalid', String(over));
    if (over !== wasOver) {
      wasOver = over;
      limitNote.textContent = over ? `Message is ${-left} characters over the ${LIMITS.messageText} character limit` : '';
    }
    const off = disabled || uploading || over || !(hasText || hasFiles);
    sendBtn.disabled = off;
    if (laterBtn) laterBtn.disabled = off;
    // Busy, not disabled, while a "Send later" request is out (the words
    // stay in the box meanwhile, see submit): a disabled button under the
    // keyboard hands its focus to the page body, and the keyboard had just
    // come back to Send later from its menu of times. A press meanwhile
    // does nothing (see submit and the menu's opener).
    for (const b of [sendBtn, laterBtn]) {
      if (!b) continue;
      if (scheduling) b.setAttribute('aria-busy', 'true');
      else b.removeAttribute('aria-busy');
    }
  }

  function insertAtCursor(text) {
    const s = textarea.selectionStart ?? textarea.value.length;
    const e = textarea.selectionEnd ?? s;
    const before = textarea.value.slice(0, s);
    const needsSpace = before.length && !/\s$/.test(before) && text.startsWith('@');
    const insert = (needsSpace ? ' ' : '') + text;
    // Emoji typed with the button read better with a space after them,
    // unless one is already there.
    if (!text.startsWith('@') && /\p{Extended_Pictographic}/u.test(text)) {
      const after = textarea.value.slice(e);
      textarea.setRangeText(insert + (/^\s/.test(after) ? '' : ' '), s, e, 'end');
      textarea.dispatchEvent(new Event('input'));
      return;
    }
    textarea.setRangeText(insert, s, e, 'end');
    textarea.dispatchEvent(new Event('input'));
  }

  /* ---- submit ------------------------------------------------------------ */

  async function submit({ dueAt = null } = {}) {
    // Say why rather than doing nothing: the send button is disabled while
    // the message is too long, and Enter goes through the same path.
    if (remaining() < 0) {
      toast(`Messages can be up to ${LIMITS.messageText.toLocaleString()} characters`, { icon: 'alert' });
      return;
    }
    if (sendBtn.disabled || scheduling) return;
    const text = textarea.value.replace(/\s+$/, '');
    if (dueAt && onSendLater) {
      // The words stay in the box until the worker has them (the @channel
      // question is asked over them, see beforeSend), so Send and Send later
      // are off meanwhile: a second press while the request is out (Enter,
      // the button, another time from the menu) would post the same message
      // now as well as later, or schedule it twice.
      scheduling = true;
      refreshSend();
      let ok = false;
      // The message as it stands in this box while the request is out (the
      // words untrimmed, as the draft keeps them), for the box opened next
      // on the conversation should this one go meanwhile (below).
      let scheduled = null;
      try {
        // A file picked while offline has its bytes here and no id yet. A
        // send carries such bytes in the outbox; a scheduled message lives
        // on the worker, which can only be handed ids, so the file goes up
        // first (the chip says so), or the message stays as it is.
        for (const a of attachments) {
          if (!a.offline || !a.file) continue;
          // Going up now (`up`, the mark the chip reads; see addFiles): the
          // chip said "waiting", the word for a file behind another in line.
          Object.assign(a, { uploading: true, up: true });
          renderAttachments();
          try {
            Object.assign(a, await store.uploadFor(convId, a.file), { offline: false });
          } finally {
            Object.assign(a, { uploading: false, up: false });
            renderAttachments();
          }
        }
        const files = attachments.filter((a) => a.id).map(({ id, name, size, type }) => ({ id, name, size, type }));
        scheduled = snapshot(textarea.value, files);
        await onSendLater(text, files, dueAt);
        ok = true;
      } catch (e) {
        // The sender thought again at the @channel question: the words stay
        // in the box, and there is nothing to report (a refusal has already
        // said why).
        if (e?.code !== 'cancelled') toast(e.message || 'Could not schedule', { icon: 'alert' });
      }
      scheduling = false;
      if (ok) {
        textarea.value = '';
        attachments = [];
        renderAttachments();
        autosize();
        closeMention();
        clearTimeout(draftTimer);
        // Scheduled after this box had gone (the conversation left while
        // the worker answered): what it held goes where it went (see
        // releaseElsewhere), not from here.
        if (!gone) saveDraft();
        else releaseElsewhere(scheduled);
        // The box is empty, and nothing is being typed any more: said so
        // now, as a send says it, rather than leaving "is typing" under
        // everyone else's box until the signal gives up on its own.
        if (typingConv) store.stopTyping(typingConv);
        toast(`Scheduled, sends ${aroundText(dueAt)}`, { icon: 'clock', duration: 4000 });
      }
      refreshSend();
      textarea.focus();
      return;
    }
    // The message as it stands in this box while the question is asked (the
    // words untrimmed, as the draft keeps them), for the box opened next on
    // the conversation should this one go meanwhile (below).
    const asked = snapshot(textarea.value, attachments.filter((a) => a.id).map(({ id, name, size, type }) => ({ id, name, size, type })));
    if (beforeSend && !(await beforeSend(text))) {
      textarea.focus();
      return;
    }
    const files = attachments.filter((a) => a.id).map(({ id, name, size, type }) => ({ id, name, size, type }));
    const blobs = attachments.filter((a) => a.offline && a.file).map((a) => ({ name: a.name, type: a.type, blob: a.file }));
    const kept = attachments;
    textarea.value = '';
    attachments = [];
    renderAttachments();
    autosize();
    refreshSend();
    closeMention();
    clearTimeout(draftTimer);
    // Answered after this box had gone (the box rebuilt under the @channel
    // question, a rule of the channel having changed meanwhile): the box
    // that stands in its place took the words up from the draft, and lets
    // go of them as the message goes (see releaseElsewhere); written from
    // here, this box's emptiness took the draft from under that box while
    // the words stood on in it, as a message still to send.
    if (!gone) saveDraft();
    else releaseElsewhere(asked);
    // The keyboard is back in the box as the message goes, not when the
    // worker has answered: Send pressed from the keyboard (Tab to it, then
    // Enter or Space) held it, and went disabled with the box emptied
    // (above), which dropped it to the page for the length of the send, so
    // the next message's first words, typed at once, went nowhere.
    if (!gone) textarea.focus({ preventScroll: true });
    try {
      await onSend(text, files, blobs);
    } catch (e) {
      if (e?.code === 'cancelled') {
        // The sender thought again: give the message back untouched, the
        // files picked offline (their bytes still here) included.
        textarea.value = e.text ?? text;
        attachments = kept;
        renderAttachments();
        autosize();
        refreshSend();
        saveDraft();
      } else if (e?.code !== 'not_joined') toast(e.message || 'Message not sent', { icon: 'alert' });
    }
    textarea.focus();
  }

  /* ---- attachments ------------------------------------------------------- */

  function renderAttachments() {
    // Redrawn on a removal and as each upload lands: the Remove button under
    // the keyboard is found again by its name, or the next chip's stands in
    // for one whose chip is gone (see keepFocus).
    keepFocus(attachmentsRow, () => {
      attachmentsRow.replaceChildren();
      attachmentsRow.hidden = attachments.length === 0;
      for (const a of attachments) {
        // The name as shown (see fileLabel): its letters in their order, whatever direction marks it carries.
        // On the chip cut in the middle when long, the end kept (see fileLabelShort); whole in the title and for Remove.
        const shown = fileLabel(a.name);
        // The one going up says so; the ones behind it wait their turn (the uploads run one after another, see addFiles).
        attachmentsRow.append(el(`div.chip${a.uploading ? '.uploading' : ''}`, { title: shown },
          el('span.chip-name', {}, fileLabelShort(a.name)),
          a.uploading ? el('span.muted.small', {}, a.up ? 'uploading' : 'waiting') : el('span.muted.small', {}, formatBytes(a.size)),
          el('button', {
            type: 'button', html: icon('x', 14, 2.4), 'aria-label': `Remove ${shown}`,
            onclick: (e) => {
              // The second click of a double click (the browser counts it):
              // the chips close up as the first click takes its file, and
              // the second landed on the next chip's Remove, which took a
              // second file the reader had not meant to take out. One
              // gesture, one file; a key's click counts nothing and goes on.
              if (e.detail > 1) return;
              attachments = attachments.filter((x) => x !== a);
              // A file already up and taken out again is nobody's: the worker lets its bytes go (see DELETE /files/:id; one a message names by now stays, and is not ours to worry about).
              if (a.id && !a.uploading) api.deleteFile(store.hostRef(convId), a.id).catch(() => {});
              // Taken out while still going up: the upload is nobody's now
              // (see inflight). Left among the files on their way, it was
              // taken over by the box opened next on the conversation, or
              // written into the draft when none was open, and the file the
              // reader had taken out came back.
              if (a.uploading) {
                a.dropped = true;
                const going = draftKey ? inflight.get(draftKey) : null;
                if (going) {
                  going.delete(a);
                  if (!going.size) inflight.delete(draftKey);
                }
              }
              renderAttachments();
              refreshSend();
              saveDraft();
              // The last chip removed leaves no button to land on: the box,
              // then, where there is a keyboard to Tab from (on a phone a
              // focused box raises the on-screen keyboard over the tap).
              if (document.activeElement === document.body && !coarsePointer()) textarea.focus({ preventScroll: true });
            },
          })));
      }
    });
  }

  async function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    if (attachments.length + files.length > LIMITS.attachmentsPerMessage) {
      toast(`Up to ${LIMITS.attachmentsPerMessage} files per message`, { icon: 'alert' });
      files.length = Math.max(0, LIMITS.attachmentsPerMessage - attachments.length);
    }
    // Every file picked takes its chip now, and the uploads follow one after
    // another, the chip of the one going up saying so and the others
    // "waiting". Each chip used to be drawn as its file's turn came, so three
    // files picked together showed as one for as long as the first took to
    // go up, as if the pick had lost the other two (and a second pick
    // meanwhile, counted against the chips so far, could put six where five
    // are allowed, the worker keeping the first five without a word).
    // Counted at each file all the same: a file may be picked while an
    // earlier pick's chips stand.
    const batch = [];
    // The files on their way, or waiting their turn, by the conversation:
    // the box opened next on it, should this one go meanwhile, takes them
    // over and shows them (see inflight).
    const going = draftKey ? inflight.get(draftKey) || new Set() : null;
    for (const file of files) {
      if (file.size > LIMITS.attachmentBytes) {
        toast(`${fileLabel(file.name)} is over 10 MB`, { icon: 'alert' });
        continue;
      }
      if (attachments.length >= LIMITS.attachmentsPerMessage) {
        toast(`Up to ${LIMITS.attachmentsPerMessage} files per message`, { icon: 'alert' });
        break;
      }
      const entry = { name: file.name, size: file.size, type: file.type, uploading: true, file };
      attachments.push(entry);
      if (navigator.onLine === false) {
        // Offline: keep the bytes with the message; they upload when the send goes out.
        Object.assign(entry, { uploading: false, offline: true });
        continue;
      }
      batch.push(entry);
      if (going) {
        going.add(entry);
        inflight.set(draftKey, going);
      }
    }
    renderAttachments();
    refreshSend();
    for (const entry of batch) {
      // Taken out of the box before its turn came (its chip's Remove, in
      // this box or the one that took it over): nothing goes up for it.
      if (entry.dropped) continue;
      const { file } = entry;
      if (navigator.onLine === false) {
        // The connection went while the files before it went up: kept with
        // the message, bytes and all, as a file picked offline is.
        Object.assign(entry, { uploading: false, offline: true });
        letGo(going, entry);
        if (!gone) {
          renderAttachments();
          refreshSend();
          continue;
        }
        // This box has gone (the conversation left while the files before
        // it went up): the box now open on the conversation has the file
        // among those it took over when it opened, and shows it kept; with
        // none open, the file is kept for the box opened next (see parked),
        // as a box that goes keeps its own files picked offline. Let go of
        // here with nobody to hand it to, its bytes, which are on this
        // device alone, were gone without a word.
        const box = draftKey ? openBoxes.get(draftKey) : null;
        if (box) {
          box.carry(entry);
          box.redraw();
        } else if (draftKey) {
          const kept = parked.get(draftKey) || [];
          if (!kept.includes(entry)) parked.set(draftKey, [...kept, entry]);
        }
        continue;
      }
      // Its turn come after this box went (the conversation left while the
      // files before it went up): the box now open takes it as it took the
      // entries waiting when it opened, and shows it going up. Handed only
      // when it lands, the box open then had never seen it, and drew and
      // saved without it.
      if (gone && going) openBoxes.get(draftKey)?.carry(entry);
      entry.up = true;
      if (!gone) renderAttachments();
      else openBoxes.get(draftKey)?.redraw();
      let error = null;
      try {
        // Where the conversation lives (a shared channel's host, or here).
        const res = await store.uploadFor(convId, file);
        Object.assign(entry, res, { uploading: false });
      } catch (e) {
        error = e;
      }
      entry.up = false;
      letGo(going, entry);
      // Taken out of the box while it was going up (its chip's Remove, in
      // this box or the one that took it over): landed for nobody, and
      // nothing said of it, a failure included; what landed is let go of.
      if (entry.dropped) {
        if (entry.id) api.deleteFile(store.hostRef(convId), entry.id).catch(() => {});
        continue;
      }
      if (error) toast(error.message || `Could not upload ${fileLabel(file.name)}`, { icon: 'alert' });
      if (gone) {
        // Landed after this box went (see inflight): the box now open on the
        // conversation takes the file (or lets go of a failed one), else it
        // goes into the draft beside the words saved there, never the words
        // this box last held.
        const box = draftKey ? openBoxes.get(draftKey) : null;
        if (box) box.landed(entry, error);
        else if (draftKey && !error) {
          const cur = getDraft(draftKey);
          const { id, name, size, type } = entry;
          setDraft(draftKey, { text: cur?.text || '', attachments: [...(cur?.attachments || []), { id, name, size, type }] });
        }
        continue;
      }
      if (error) attachments = attachments.filter((x) => x !== entry);
      renderAttachments();
      refreshSend();
      // The draft is written when typing pauses; an upload that finishes
      // with nothing typed after it (or after the user has moved on) is
      // written now, or the file would be gone from the draft on return.
      saveDraft();
    }
  }

  /**
   * An entry's upload is over (landed, failed, or not begun, the connection
   * gone): it leaves the conversation's set of files on their way. Only the
   * set still standing for the conversation is let go of when it empties: a
   * chip removed while its file went up emptied the set and took it out
   * (see the chip's Remove), a file dropped in after that began a fresh
   * set, and the first upload landing then took the fresh set out in its
   * turn, with the second file still in it. The box opened next found
   * nothing on its way, and the second file landed for nobody: not in the
   * box, not in the draft.
   */
  function letGo(going, entry) {
    if (!going) return;
    going.delete(entry);
    if (!going.size && inflight.get(draftKey) === going) inflight.delete(draftKey);
  }

  attachInput.addEventListener('change', () => {
    addFiles(attachInput.files);
    attachInput.value = '';
  });
  textarea.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    addFiles(files);
    // The words that come with a picture (cells copied from a spreadsheet or
    // a table in a document arrive as their text and a rendering of them; a
    // picture copied from a page may bring its address) go into the box as
    // any pasted words do, and the picture is attached beside them: the
    // paste used to be stopped whole for the picture, and the words went
    // nowhere. A picture alone (a screenshot) is attached, and the paste,
    // which has nothing else to put in the box, is stopped as before.
    let text = '';
    try { text = e.clipboardData.getData('text/plain') || ''; } catch { /* a clipboard that hands out files alone */ }
    if (!text.trim()) e.preventDefault();
  });
  /** The box lit as a drop target (files dragged over it, or over the conversation it stands under; see the view's own handlers). */
  function hintDrop(on) {
    box.style.borderColor = on ? 'var(--accent)' : '';
  }
  /**
   * Files dropped: into the box, or anywhere over the conversation the box
   * stands under (the view hands such a drop here; the browser would have
   * opened the file in the app's place, and the page-wide guard that keeps
   * it from doing so made the drop inert, so a file let go over the
   * messages, the widest target there is, did nothing without a word).
   */
  function dropFiles(e) {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    hintDrop(false);
    // A folder dropped from the desktop arrives among the files as a File
    // with no type and no bytes (its name, and nothing to read), and went up
    // as an empty attachment called after the folder. Its entry knows what
    // it is; the folder is left out and said so, and the files beside it go.
    const items = [...(e.dataTransfer.items || [])].filter((it) => it.kind === 'file');
    let folders = 0;
    const files = items.length ? items.map((it) => {
      if (it.webkitGetAsEntry?.()?.isDirectory) { folders += 1; return null; }
      return it.getAsFile();
    }).filter(Boolean) : [...e.dataTransfer.files];
    if (folders) toast(folders === 1 ? 'Folders cannot be attached; drop the files inside it' : 'Folders cannot be attached; drop the files inside them', { icon: 'alert' });
    if (files.length) addFiles(files);
  }
  root.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      hintDrop(true);
    }
  });
  root.addEventListener('dragleave', () => hintDrop(false));
  root.addEventListener('drop', dropFiles);

  /* ---- mentions ---------------------------------------------------------- */

  /**
   * What is being completed at the cursor: an @mention (`@ali`) or an emoji
   * shortcode (`:tad`, at least two letters so a plain colon in a sentence
   * does not open the list). The same popup serves both.
   */
  function mentionContext() {
    const pos = textarea.selectionStart ?? 0;
    const before = textarea.value.slice(0, pos);
    // An @ opens the list wherever the worker (and the renderer) read a
    // mention: at the start, or after anything but a letter, digit or
    // underscore, so "(@ana", "\"@ana" and "cc:@ana" complete as "@ana"
    // does, and an address (nj@puter.com) opens nothing, as it mentions
    // nobody. Only after whitespace, the list stayed shut on a name typed
    // in brackets that would then ring the person all the same.
    const m = /(^|[^a-z0-9_])@([a-z0-9_.-]*)$/i.exec(before);
    if (m) return { kind: 'mention', start: pos - m[2].length - 1, query: m[2].toLowerCase() };
    const e = /(^|[\s(])(:[a-z0-9_+-]{2,40})$/i.exec(before);
    if (e) return { kind: 'emoji', start: pos - e[2].length, query: e[2].slice(1).toLowerCase() };
    return null;
  }

  function updateMention() {
    const ctx = mentionContext();
    if (!ctx || !store.ws) return closeMention();
    let items;
    if (ctx.kind === 'mention') {
      // The people of the conversation's own workspace: a shared channel's
      // host's, with their labels. Matched with accents folded (see
      // lib/mentions.js): "@jose" finds José.
      items = matchMembers(Object.entries(store.membersFor(convId)).map(([uuid, m]) => ({ uuid, ...m })), ctx.query, 8);
      // Broadcasts sit at the top, only where the caller may send them, and
      // say who they reach so the choice is made knowingly.
      if (convId) {
        const access = store.broadcastAccess(convId);
        const ch = store.channel(convId);
        // How far each reaches, the sender left out (the store never counts
        // below nought), in a few words that follow the row's name after a
        // comma and fit the popup at its narrowest: "1 person", "about 3
        // active now", and with nobody else active "nobody else active now"
        // rather than "about 0" (the row stays: the worker rings whoever is
        // active when the message goes).
        const reach = (kind) => {
          const r = store.broadcastReach(convId, kind);
          if (kind === 'here') return r.count === 0 ? 'nobody else active now' : `${r.exact ? '' : 'about '}${r.count} active now`;
          // Alone (a channel just made, a workspace of one): said as that, as
          // @here says it, rather than as "0 people".
          if (r.count === 0) return kind === 'everyone' ? 'nobody else in the workspace' : 'nobody else in the channel';
          return `${r.count} ${r.count === 1 ? 'person' : 'people'}`;
        };
        const groups = [
          access.channel && { username: 'channel', group: true, name: ch ? `Notify everyone in #${ch.name}` : 'Notify everyone here', sub: reach('channel') },
          access.channel && { username: 'here', group: true, name: 'Notify people active now', sub: reach('here') },
          access.everyone && { username: 'everyone', group: true, name: 'Notify the whole workspace', sub: reach('everyone') },
        ].filter(Boolean).filter((g) => !ctx.query || g.username.startsWith(ctx.query));
        items = groups.concat(items).slice(0, 8);
      }
    } else {
      if (!emojiReady()) {
        loadEmoji().then(updateMention).catch(() => {});
        return closeMention();
      }
      items = searchEmoji(ctx.query, 8);
    }
    if (!items.length) return closeMention();
    if (!mention) {
      mention = { node: el('div.mention-pop', { role: 'listbox', id: fieldId('mentions') }), index: 0 };
      root.append(mention.node);
      textarea.setAttribute('aria-controls', mention.node.id);
      textarea.setAttribute('aria-expanded', 'true');
    }
    mention.node.setAttribute('aria-label', ctx.kind === 'mention' ? 'People' : 'Emoji');
    // Another letter typed (or another token under the caret) is a new
    // list, and the highlight starts over at its first match: the arrows
    // chose a place in the old list, and the row at that place in the new
    // one is someone else, whom Enter would have picked. A click or a caret
    // move that leaves the token as it was keeps the choice.
    if (mention.kind !== ctx.kind || mention.start !== ctx.start || mention.query !== ctx.query) mention.index = 0;
    mention.kind = ctx.kind;
    mention.start = ctx.start;
    mention.query = ctx.query;
    mention.items = items;
    mention.index = Math.min(mention.index, items.length - 1);
    renderMention();
  }

  function renderMention() {
    const tone = preferredTone();
    mention.node.replaceChildren(...mention.items.map((m, i) => {
      const id = `${mention.node.id}-${i}`;
      const btn = el('button.pick-item', {
        type: 'button', role: 'option', id, 'aria-selected': String(i === mention.index), tabindex: -1,
        onmousedown: (e) => e.preventDefault(),
        onclick: () => pickMention(i),
      },
      mention.kind === 'mention'
        ? (m.group
          // The line under a broadcast's name says what it does and how far
          // it reaches; it wraps rather than being cut short with an ellipsis
          // where the popup is narrow (a phone), unlike a person's handle.
          ? [el('span.pick-emoji', { html: icon('megaphone', 18, 2), style: { color: 'var(--ink-3)' } }), el('span.pick-text', {}, el('strong', {}, `@${m.username}`), el('span.pick-wrap', {}, `${m.name}, ${m.sub}`))]
          : [avatar(m, { size: 'sm' }), el('span.pick-text', {}, el('strong', {}, m.name, statusChip(m.uuid, { compact: true })), el('span', {}, `@${m.username}${m.role === 'guest' ? ' · Guest' : m.role === 'external' ? ` · ${m.org?.name || 'Another workspace'}` : ''}`))])
        : [el('span.pick-emoji', { 'aria-hidden': 'true' }, withTone(m, tone)), el('span.pick-text', {}, el('strong', {}, `:${m.code}:`), m.codes.length > 1 && el('span', {}, m.codes.slice(1).map((c) => `:${c}:`).join(' ')))]);
      if (i === mention.index) textarea.setAttribute('aria-activedescendant', id);
      return btn;
    }));
  }

  function pickMention(i) {
    const m = mention?.items[i];
    if (!m) return;
    // The caret may have moved since the list opened (arrow keys, Home, End
    // change the selection without an input event): the token is read again,
    // and if it is not under the caret any more the list simply closes.
    const ctx = mentionContext();
    if (!ctx || ctx.kind !== mention.kind || ctx.start !== mention.start) return closeMention();
    const end = textarea.selectionStart ?? textarea.value.length;
    // The rest of the token past the caret goes with it: a handle being
    // fixed from the middle ("@an|na", the caret moved back into it, the
    // list offering Ana) used to have the name laid over the part before
    // the caret alone, and the rest stood on after it ("@ana na"). And no
    // second space where one already follows the token.
    const rest = textarea.value.slice(end);
    const tail = (mention.kind === 'mention' ? /^[a-z0-9_.-]*/i : /^[a-z0-9_+-]*:?/i).exec(rest)[0].length;
    // A space on the same line; a line break is not one: read as the space
    // that follows, it took the caret with it (below) to the start of the
    // next line, and the words typed after a name picked at the end of a
    // line went onto the line under it.
    const sep = /^[^\S\r\n]/.test(rest.slice(tail)) ? '' : ' ';
    let inserted;
    if (mention.kind === 'mention') {
      inserted = `@${m.username}${sep}`;
    } else {
      const tone = preferredTone();
      noteEmojiUse(keyFor(m, tone));
      inserted = `${withTone(m, tone)}${sep}`;
    }
    textarea.setRangeText(inserted, mention.start, end + tail, 'end');
    // The caret goes past the space that follows, as past the one inserted.
    if (!sep) textarea.setSelectionRange(mention.start + inserted.length + 1, mention.start + inserted.length + 1);
    closeMention();
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
  }

  function closeMention() {
    if (!mention) return;
    mention.node.remove();
    mention = null;
    textarea.removeAttribute('aria-controls');
    textarea.removeAttribute('aria-activedescendant');
    textarea.setAttribute('aria-expanded', 'false');
  }

  /* ---- keys -------------------------------------------------------------- */

  textarea.addEventListener('input', () => {
    autosize();
    refreshSend();
    updateMention();
    // Others see "typing" while text is being written.
    if (typingConv) {
      if (textarea.value.trim()) store.noteTyping(typingConv);
      else store.stopTyping(typingConv);
    }
  });
  textarea.addEventListener('click', updateMention);
  // The list closes a moment after the box loses the keyboard, unless it
  // went to the list itself. Not for a box that is gone: destroyed (the
  // conversation switched, the box rebuilt) with the keyboard still in it,
  // the box loses it as it leaves the page, and the timer ran on a view
  // that no longer existed.
  let blurTimer = null;
  let gone = false;
  textarea.addEventListener('blur', () => {
    if (gone) return;
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      blurTimer = null;
      if (!gone && !root.contains(document.activeElement)) closeMention();
    }, 120);
  });
  textarea.addEventListener('keydown', (e) => {
    if (mention) {
      // A modified arrow is a shortcut's (Alt+Up/Down steps between
      // conversations), and one during an IME composition is the IME's: a
      // pinyin composition is letters until its candidate is chosen, so an
      // @ followed by them keeps the list open through it, and the arrows
      // meant for the candidates used to move the list's highlight instead.
      const bare = !e.altKey && !e.metaKey && !e.ctrlKey && !composing(e);
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && bare) {
        e.preventDefault();
        const n = mention.items.length;
        mention.index = (mention.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        renderMention();
        return;
      }
      // Tab picks, as Enter does; Shift+Tab is the way back out of the box
      // to the formatting row, and must stay so with the list open.
      if ((e.key === 'Enter' && !composing(e)) || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        pickMention(mention.index);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMention();
        return;
      }
      // Caret moves fire no input event: re-read the token once they land.
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) setTimeout(updateMention, 0);
    }
    const fmt = formatForKey(e);
    if (fmt) {
      e.preventDefault();
      if (fmt === 'link') askLink(fmtBar.hidden ? fmtToggle : fmtBar.querySelector('[aria-label="Link"]'));
      else format(fmt);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !composing(e)) {
      if (enterSendsNow() || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        submit();
      }
      return;
    }
    // A bare arrow: with a modifier it is a shortcut (Alt+Up steps to the previous conversation).
    if (e.key === 'ArrowUp' && !e.altKey && !e.metaKey && !e.ctrlKey && !textarea.value && onEditLast) {
      const handled = onEditLast();
      if (handled) e.preventDefault();
    }
  });

  function setDisabled(v) {
    disabled = v;
    textarea.disabled = v;
    attachBtn.disabled = v;
    mentionBtn.disabled = v;
    for (const b of fmtBar.querySelectorAll('button')) b.disabled = v;
    roveFmt();
    refreshSend();
  }

  /* ---- drafts ------------------------------------------------------------ */

  // Unsent text and finished uploads are kept per conversation (see
  // lib/drafts.js), so leaving, reloading, or closing the tab loses nothing.
  // What this box last read from the draft store or wrote to it (the words
  // and the files that have landed), so that a box nothing has changed in
  // writes nothing (see saveDraft). The tabs of this browser share the
  // store: a box left untouched in one tab (opened on the conversation and
  // never typed in) wrote its emptiness over the draft another tab had just
  // saved there, each time it was hidden or the page went, and the words
  // and the uploaded files the member had put in the other tab were gone at
  // its next reload.
  let known = null;
  const snapshot = (text, files) => JSON.stringify([text, files]);
  /**
   * What this box held has gone out, sent or scheduled, after the box
   * itself had gone (the conversation left, the box rebuilt while the worker
   * answered or the @channel question stood; see submit). This box left the
   * words in the draft as it went, as every box does, and the box opened
   * next on the conversation took them up and showed them as an unsent
   * message. That box lets go of them, while it holds them as they were
   * (`snap`); words typed or a file picked there since are the reader's and
   * stay, in the box and in the draft. Not written by this box, whose
   * emptiness is nobody's now: written over the draft the box now open had
   * saved (the reader typed on there while the worker answered), it took
   * the reader's words from the store while they still stood in the box,
   * whose next write found nothing changed and wrote nothing, so they were
   * gone when the conversation was next opened. With no box open, the draft
   * goes only while it is still the message that went, and stays where a
   * file landed into it meanwhile (see addFiles) or another tab wrote there.
   */
  function releaseElsewhere(snap) {
    if (!draftKey) return;
    const box = openBoxes.get(draftKey);
    if (box) {
      box.clearIf(snap);
      return;
    }
    const cur = getDraft(draftKey);
    const held = cur ? snapshot(cur.text || '', (cur.attachments || []).map(({ id, name, size, type }) => ({ id, name, size, type }))) : null;
    if (held === snap) setDraft(draftKey, {});
  }
  function saveDraft() {
    if (!draftKey) return;
    const text = textarea.value;
    const files = attachments.filter((a) => a.id).map(({ id, name, size, type }) => ({ id, name, size, type }));
    const now = snapshot(text, files);
    if (now === known) return;
    known = now;
    setDraft(draftKey, { text, attachments: files });
  }
  // Written a moment after typing stops rather than on every keystroke.
  textarea.addEventListener('input', () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 600);
  });
  // The pause is not waited for when the page goes: a reload or a closed tab
  // a moment after the last keystroke (and a phone putting the browser away,
  // which may never bring the page back) took the last words with it.
  const flushDraft = () => {
    clearTimeout(draftTimer);
    saveDraft();
  };
  const onHidden = () => { if (document.hidden) flushDraft(); };
  window.addEventListener('pagehide', flushDraft);
  document.addEventListener('visibilitychange', onHidden);

  const draft = draftKey ? getDraft(draftKey) : null;
  if (draft) {
    textarea.value = draft.text || '';
    attachments = (draft.attachments || []).map((a) => ({ ...a }));
  }
  // What the box holds as it opens, draft or nothing: written back only once something here has changed (see saveDraft).
  known = snapshot(textarea.value, attachments.filter((a) => a.id).map(({ id, name, size, type }) => ({ id, name, size, type })));
  // Files dropped into the box that stood here before, still on their way
  // (see inflight): shown as uploading, and taken when they land. The very
  // entries, so the box that started the upload lands it in them.
  const carried = draftKey ? [...(inflight.get(draftKey) || [])] : [];
  if (carried.length) attachments = [...attachments, ...carried];
  // And the files picked while the connection was away in the box that
  // stood here before (see parked): back in the box, bytes and all.
  const kept = draftKey ? parked.get(draftKey) || [] : [];
  if (kept.length) {
    parked.delete(draftKey);
    attachments = [...attachments, ...kept];
  }
  if (draft || carried.length || kept.length) renderAttachments();
  const seat = {
    /**
     * A file begun in a box that is gone (see inflight): shown here going
     * up, where there is room for it under the message's limit (the box
     * that began it counted against its own chips, and more may have been
     * picked here since). Whether it is here now.
     */
    carry(entry) {
      if (attachments.includes(entry)) return true;
      if (attachments.length >= LIMITS.attachmentsPerMessage) {
        toast(`Up to ${LIMITS.attachmentsPerMessage} files per message`, { icon: 'alert' });
        return false;
      }
      attachments.push(entry);
      renderAttachments();
      refreshSend();
      return true;
    },
    landed(entry, error) {
      if (error) attachments = attachments.filter((x) => x !== entry);
      // One never taken (no room for it when it began; said so then) is not taken now.
      else if (!attachments.includes(entry)) return;
      renderAttachments();
      refreshSend();
      saveDraft();
    },
    /** A file taken over has moved on (from waiting to going up, or to kept offline; see addFiles): its chip says so, and Send follows. */
    redraw() {
      renderAttachments();
      refreshSend();
    },
    /**
     * The words and files this box holds were a message the box that stood
     * here before has since scheduled (see submit): they go, while the box
     * holds them as they were and nothing more (a file picked here since,
     * with no id yet, is the reader's, and so are words typed since).
     */
    clearIf(snap) {
      if (attachments.some((a) => !a.id)) return;
      if (snapshot(textarea.value, attachments.map(({ id, name, size, type }) => ({ id, name, size, type }))) !== snap) return;
      textarea.value = '';
      attachments = [];
      renderAttachments();
      autosize();
      closeMention();
      clearTimeout(draftTimer);
      saveDraft();
      refreshSend();
    },
  };
  if (draftKey) openBoxes.set(draftKey, seat);

  if (autofocus && !coarsePointer()) {
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 0);
  }
  refreshSend();
  setTimeout(autosize, 0);
  // Measured again when the box's width changes (the thread panel opening
  // or closing beside it, the window resized, a phone turned): the height
  // was set as the words were typed, so a draft of three lines written in a
  // narrow column kept a box of five once the column widened, and one
  // written wide ran out of its box when the column narrowed, until the
  // next letter typed set it right.
  const sizer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (!gone) autosize(); }) : null;
  sizer?.observe(box);

  return {
    el: root,
    textarea,
    focus: () => textarea.focus(),
    setDisabled,
    /** For the conversation the box stands under: files dragged over it light the box, and let go over it land in the box (see dropFiles). */
    hintDrop,
    dropFiles,
    destroy: () => {
      gone = true;
      if (draftKey && openBoxes.get(draftKey) === seat) openBoxes.delete(draftKey);
      // The files picked offline still here go to the box opened next on the
      // conversation (see parked); none left (sent, or their chips taken
      // out) means none for it, whatever an earlier box left.
      if (draftKey) {
        const offline = attachments.filter((a) => a.offline && a.file && !a.id);
        if (offline.length) parked.set(draftKey, offline);
        else parked.delete(draftKey);
      }
      sizer?.disconnect();
      clearTimeout(blurTimer);
      flushDraft();
      window.removeEventListener('pagehide', flushDraft);
      document.removeEventListener('visibilitychange', onHidden);
      closeMention();
      offProfile();
      if (typingConv) store.stopTyping(typingConv);
    },
  };
}
