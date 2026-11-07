/**
 * A compact rich text editor for replies, notes, macros and articles, built
 * on contenteditable. Pasted content is cleaned through the same sanitizer
 * the server uses, so what you see is what gets stored.
 */
import { h, modKey, composing } from './dom.js';
import { icon } from './icons.js';
import { sanitizeHtml, htmlToText, escapeHtml } from '../shared/html.js';
import { promptDialog } from './dialog.js';

const TOOLS = [
  { cmd: 'bold', icon: 'bold', label: 'Bold', key: 'B' },
  { cmd: 'italic', icon: 'italic', label: 'Italic', key: 'I' },
  { cmd: 'underline', icon: 'underline', label: 'Underline', key: 'U' },
  { cmd: 'strikeThrough', icon: 'strikethrough', label: 'Strikethrough' },
  { sep: true },
  { cmd: 'insertUnorderedList', icon: 'list', label: 'Bulleted list' },
  { cmd: 'insertOrderedList', icon: 'list-ordered', label: 'Numbered list' },
  { cmd: 'formatBlock', arg: 'blockquote', icon: 'quote', label: 'Quote' },
  { cmd: 'code', icon: 'code', label: 'Code' },
  { cmd: 'link', icon: 'link', label: 'Link', key: 'K' },
  { cmd: 'heading', icon: 'heading-2', label: 'Heading', articleOnly: true },
  { sep: true },
  { cmd: 'removeFormat', icon: 'eraser', label: 'Clear formatting' },
];

/** execCommand where the browser has it; a Range-based insert otherwise. */
function run(cmd, arg = null) {
  if (typeof document.execCommand === 'function') {
    try {
      if (document.execCommand(cmd, false, arg)) return true;
    } catch {
      /* fall through */
    }
  }
  if (cmd !== 'insertHTML' && cmd !== 'insertText') return false;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const frag = cmd === 'insertText' ? document.createTextNode(arg) : range.createContextualFragment(arg);
  const last = frag.lastChild;
  range.insertNode(frag);
  if (last) {
    range.setStartAfter(last);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  return true;
}

export function createEditor({ placeholder = '', label = 'Message', onChange = null, onSubmit = null, onBusy = null, extraTools = [], article = false, minHeight = 96, mentions = null } = {}) {
  const content = h('div.editor-content.prose', {
    contenteditable: 'true',
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': label,
    'data-placeholder': placeholder,
    spellcheck: 'true',
    style: { minHeight: `${minHeight}px` },
  });
  let savedRange = null;

  const exec = (cmd, arg = null) => {
    content.focus();
    restore();
    run(cmd, arg);
    changed();
  };

  function save() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && content.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  }

  function restore() {
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  async function link() {
    save();
    const sel = window.getSelection();
    const text = sel ? sel.toString() : '';
    const url = await promptDialog({
      title: 'Insert link',
      label: 'Address',
      placeholder: 'https://',
      value: /^https?:\/\//.test(text) ? text : '',
      confirmLabel: 'Insert',
      validate: (v) => (/^(https?:\/\/|mailto:)\S+$/i.test(v) ? null : 'Enter a full address starting with https://'),
    });
    content.focus();
    restore();
    if (!url) return;
    if (text) run('createLink', url);
    else run('insertHTML', `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    changed();
  }

  function code() {
    const sel = window.getSelection();
    const text = sel ? sel.toString() : '';
    if (text.includes('\n')) run('insertHTML', `<pre><code>${escapeHtml(text)}</code></pre>`);
    else run('insertHTML', `<code>${escapeHtml(text || 'code')}</code>&nbsp;`);
    changed();
  }

  const toolbar = h('div.editor-toolbar', { role: 'toolbar', 'aria-label': 'Formatting' });
  const buttons = [];
  for (const t of [...TOOLS, ...extraTools]) {
    if (t.articleOnly && !article) continue;
    if (t.sep) {
      toolbar.append(h('span.toolbar-sep', { 'aria-hidden': 'true' }));
      continue;
    }
    const btn = h('button.icon-btn.sm', {
      type: 'button',
      tabindex: buttons.length ? '-1' : '0',
      'aria-label': t.key ? `${t.label} (${modKey}+${t.key})` : t.label,
      title: t.key ? `${t.label} (${modKey}+${t.key})` : t.label,
      onmousedown: (e) => e.preventDefault(),
      onclick: () => {
        if (t.run) return t.run(api);
        if (t.cmd === 'link') return link();
        if (t.cmd === 'code') return code();
        if (t.cmd === 'heading') return exec('formatBlock', 'h3');
        return exec(t.cmd, t.arg ? `<${t.arg}>` : null);
      },
    }, icon(t.icon, { size: 15 }));
    buttons.push(btn);
    toolbar.append(btn);
  }
  // Roving focus inside the toolbar.
  toolbar.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    let next = null;
    if (e.key === 'ArrowRight') next = buttons[(i + 1) % buttons.length];
    if (e.key === 'ArrowLeft') next = buttons[(i - 1 + buttons.length) % buttons.length];
    if (e.key === 'Home') next = buttons[0];
    if (e.key === 'End') next = buttons[buttons.length - 1];
    if (next) {
      e.preventDefault();
      buttons[i].tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    }
  });

  function changed() {
    content.classList.toggle('is-empty', isEmpty());
    onChange?.();
  }

  function isEmpty() {
    return !htmlToText(content.innerHTML).trim() && !content.querySelector('img');
  }

  content.addEventListener('input', changed);
  content.addEventListener('keyup', save);
  content.addEventListener('mouseup', save);
  content.addEventListener('blur', save);
  content.addEventListener('paste', (e) => {
    const dt = e.clipboardData;
    if (!dt) return;
    const html = dt.getData('text/html');
    const text = dt.getData('text/plain');
    // Word, Excel and Sheets put a picture of the selection on the clipboard
    // next to its text; the text is what was meant. Files copied on their
    // own, or a copied image (HTML that is just the picture), attach.
    if (dt.files && dt.files.length && api.onFiles && !htmlToText(html).trim()) {
      e.preventDefault();
      api.onFiles([...dt.files]);
      return;
    }
    e.preventDefault();
    if (html) run('insertHTML', sanitizeHtml(html));
    else run('insertText', text);
    changed();
  });
  content.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length && api.onFiles) {
      e.preventDefault();
      api.onFiles([...e.dataTransfer.files]);
    }
  });
  content.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      onSubmit?.(e);
      return;
    }
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); exec('bold'); }
      else if (k === 'i') { e.preventDefault(); exec('italic'); }
      else if (k === 'u') { e.preventDefault(); exec('underline'); }
      else if (k === 'k') { e.preventDefault(); link(); }
    }
  });


  /* @mentions: typing @ suggests people from `mentions()` ({ name, handle }). */
  const mentionList = h('ul.mention-list', { role: 'listbox', 'aria-label': 'Mention a teammate', hidden: true });
  let mentionState = null;

  function mentionQuery() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3 || !content.contains(node)) return null;
    const before = node.textContent.slice(0, sel.anchorOffset);
    const m = /(^|\s)@([\w.-]{0,30})$/.exec(before);
    return m ? { node, end: sel.anchorOffset, start: sel.anchorOffset - m[2].length - 1, q: m[2].toLowerCase() } : null;
  }

  function closeMentions() {
    mentionState = null;
    mentionList.hidden = true;
    content.removeAttribute('aria-activedescendant');
  }

  function paintMentions() {
    const ctx = mentionQuery();
    if (!mentions || !ctx) return closeMentions();
    const people = mentions().filter((p) => `${p.name} ${p.handle}`.toLowerCase().includes(ctx.q)).slice(0, 6);
    if (!people.length) return closeMentions();
    mentionState = { ...ctx, people, active: Math.min(mentionState?.active || 0, people.length - 1) };
    mentionList.replaceChildren(...people.map((p, i) => h(`li#${listId}-${i}.mention-option${i === mentionState.active ? '.active' : ''}`, {
      role: 'option', 'aria-selected': String(i === mentionState.active),
      onmousedown: (e) => { e.preventDefault(); pickMention(i); },
    }, h('strong', p.name), p.handle ? h('span.subtle', `@${p.handle}`) : null)));
    mentionList.hidden = false;
    content.setAttribute('aria-activedescendant', `${listId}-${mentionState.active}`);
    const r = document.createRange();
    r.setStart(ctx.node, ctx.start);
    r.setEnd(ctx.node, ctx.end);
    const rect = r.getBoundingClientRect();
    const host = el.getBoundingClientRect();
    mentionList.style.left = `${Math.max(0, rect.left - host.left)}px`;
    mentionList.style.bottom = `${Math.max(0, host.bottom - rect.top + 4)}px`;
  }

  function pickMention(i) {
    const st = mentionState;
    if (!st) return;
    const p = st.people[i];
    const r = document.createRange();
    r.setStart(st.node, st.start);
    r.setEnd(st.node, st.end);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    run('insertText', `@${p.handle || p.name.split(' ')[0]} `);
    closeMentions();
    changed();
  }

  const listId = `mention-${Math.random().toString(36).slice(2, 8)}`;
  if (mentions) {
    content.addEventListener('input', paintMentions);
    content.addEventListener('blur', () => setTimeout(closeMentions, 100));
    content.addEventListener('keydown', (e) => {
      if (!mentionState || composing(e)) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        const n = mentionState.people.length;
        mentionState.active = (mentionState.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        paintMentions();
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopImmediatePropagation();
        pickMention(mentionState.active);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeMentions();
      }
    }, true);
  }

  const el = h('div.editor', toolbar, content, mentionList);
  const api = {
    el,
    toolbar,
    content,
    onFiles: null,
    getHtml: () => (isEmpty() ? '' : sanitizeHtml(content.innerHTML)),
    getText: () => htmlToText(content.innerHTML),
    setHtml(html) {
      content.innerHTML = sanitizeHtml(html || '');
      changed();
    },
    /** Replace all the content as one edit that Undo can take back. */
    replaceHtml(html) {
      const clean = sanitizeHtml(html || '');
      content.focus();
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(content);
      sel?.removeAllRanges();
      sel?.addRange(r);
      if (!clean || !run('insertHTML', clean)) content.innerHTML = clean;
      changed();
    },
    /** Lock or unlock typing, for example while text is being generated. */
    setBusy(busy) {
      const was = content.hasAttribute('aria-busy');
      content.setAttribute('contenteditable', busy ? 'false' : 'true');
      if (busy) content.setAttribute('aria-busy', 'true');
      else content.removeAttribute('aria-busy');
      if (was !== busy) onBusy?.(busy);
    },
    isBusy: () => content.hasAttribute('aria-busy'),
    insertHtml(html) {
      content.focus();
      restore();
      const clean = sanitizeHtml(html);
      if (!content.contains(window.getSelection()?.anchorNode) || !run('insertHTML', clean)) content.insertAdjacentHTML('beforeend', clean);
      changed();
    },
    focus() {
      content.focus();
      const sel = window.getSelection();
      if (sel && !content.contains(sel.anchorNode)) {
        const r = document.createRange();
        r.selectNodeContents(content);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    },
    isEmpty,
    clear() {
      content.innerHTML = '';
      changed();
    },
  };
  content.classList.toggle('is-empty', true);
  return api;
}
