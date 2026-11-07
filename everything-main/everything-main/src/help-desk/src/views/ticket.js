/**
 * The ticket workspace: ticket properties on the left, the conversation and
 * reply composer in the middle, customer context and knowledge on the right,
 * and the submit bar along the bottom. Field edits collect until Submit, so
 * a change of status, assignee and a reply go out together. The same screen
 * creates new tickets.
 */
import './ticket.css';
import { h, clear, uid, debounce, announce, modKey, preserveFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu, openPicker } from '../ui/popover.js';
import { openDialog, confirmDialog, promptDialog } from '../ui/dialog.js';
import { avatar, statusBadge, selectField, tagsInput, field, spinner } from '../ui/components.js';
import { createEditor } from '../ui/editor.js';
import { toast, toastError } from '../ui/toast.js';
import { relTime, fullDate, fileSize, localTimeIn, shortDate, localDay } from '../ui/format.js';
import { go } from '../ui/router.js';
import { bind } from '../ui/shortcuts.js';
import { STATUS_LABEL, PRIORITY_LABEL, TYPE_LABEL, CHANNEL_LABEL, isUnsolved, normEmail, LIMITS } from '../shared/model.js';
import { renderPlaceholders, slaStatus, shortDuration, SLA_METRIC_LABEL } from '../shared/rules.js';
import { sanitizeHtml, escapeHtml, htmlToText } from '../shared/html.js';
import { app, appBaseUrl } from '../app.js';
import { openBlob } from '../ui/files.js';
import {
  statusOptions, priorityOptions, typeOptions, assigneeOptions, assigneeValue, splitAssignee, assigneeLabel,
  agentOptions, userOption, fieldValueLabel, myGroup,
} from './options.js';
import { playQueue } from './views.js';
import { aiAssist, aiSummary } from './ai.js';

const AFTER_KEY = 'help-desk:after-submit';
const AFTER = { next: 'Next ticket in view', close: 'Close tab', stay: 'Stay on ticket' };

function afterSubmit() {
  try {
    return localStorage.getItem(AFTER_KEY) || 'stay';
  } catch {
    return 'stay';
  }
}

export function mount(main, { id }) {
  const isNew = id === 'new';
  const ticketId = isNew ? null : Number(id);
  if (!isNew && !(ticketId > 0)) {
    go('/views', { replace: true });
    return null;
  }
  const draftKey = isNew ? 'new' : String(ticketId);
  const draft = app.drafts.get(draftKey) || {};
  const me = app.me;

  /* ------------------------------------------------------------ state */
  let ticket = isNew ? null : app.replica.tickets.get(ticketId) || null;
  let events = [];
  let loaded = false;
  let patch = { ...(draft.patch || {}) };
  let mode = draft.mode || 'public';
  let attachments = [...(draft.attachments || [])];
  let macroUsed = draft.macro || null;
  let filter = 'all';
  let pane = 'conversation';
  let submitting = false;
  let destroyed = false;
  let newSubject = draft.subject || '';
  let newRequester = draft.requester || null;
  let summary = null;

  const value = (f) => (f in patch ? patch[f] : ticket ? ticket[f] : f === 'status' ? 'new' : f === 'tags' || f === 'followers' || f === 'ccs' ? [] : f === 'fields' ? {} : null);

  /* ------------------------------------------------------------ frame */
  const props = h('aside.t-props', { 'aria-label': 'Ticket properties' });
  const head = h('header.t-head');
  const presenceEl = h('div.t-presence', { role: 'status', 'aria-live': 'polite' });
  const banner = h('div.t-banner', { hidden: true, role: 'status' });
  const summaryEl = h('div.t-summary', { hidden: true });
  const eventsEl = h('div.t-events', { role: 'log', 'aria-label': 'Conversation', tabindex: '0' });
  const composer = h('div.t-composer');
  const convo = h('section.t-convo', { 'aria-label': 'Conversation' }, head, presenceEl, banner, summaryEl, eventsEl, composer);
  const context = h('aside.t-context', { 'aria-label': 'Customer and knowledge' });
  const foot = h('footer.t-foot');
  const panes = h('div.t-panes', { role: 'tablist', 'aria-label': 'Ticket sections' });
  const ws = h(`div.t-ws${isNew ? '.is-new' : ''}`, { 'data-pane': pane }, panes, props, convo, context, foot);
  main.append(ws);

  /* ------------------------------------------------------- composer */
  const editor = createEditor({
    label: isNew ? 'Description' : 'Reply',
    placeholder: isNew ? 'Describe the request' : 'Write a public reply',
    onChange: () => saveDraft(),
    onSubmit: () => submit(),
    // While the writing assistant works, what would be sent is about to change.
    onBusy: () => paintSubmit(),
    // Mentions only make sense in internal notes, which only agents read.
    mentions: () => (mode === 'internal' ? app.replica.agents().filter((a) => a.uuid !== me?.uuid).map((a) => ({ name: a.name, handle: a.username || '' })) : []),
    extraTools: [
      { sep: true },
      { icon: 'paperclip', label: 'Attach files', run: () => fileInput.click() },
      { icon: 'zap', label: 'Apply a macro', run: () => pickMacro(macroBtn) },
      { icon: 'sparkles', label: 'Writing assistant', run: () => openAiMenu() },
    ],
  });
  editor.onFiles = (files) => upload(files);
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { upload([...fileInput.files]); fileInput.value = ''; } });
  const attachList = h('ul.t-attachments', { 'aria-label': 'Attachments' });
  const modeBtn = h('button.mode-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openModeMenu() });
  const ccWrap = h('div.t-cc');
  const composerHead = h('div.t-composer-head', modeBtn, ccWrap);

  function paintMode() {
    clear(modeBtn);
    const internal = mode === 'internal';
    modeBtn.append(icon(internal ? 'lock' : 'reply', { size: 15 }), internal ? 'Internal note' : 'Public reply', icon('chevron-down', { size: 14 }));
    composer.classList.toggle('internal', internal);
    editor.content.dataset.placeholder = internal ? 'Add an internal note. Only agents see it. Type @name to mention a teammate.' : isNew ? 'Describe the request' : 'Write a public reply';
    editor.content.setAttribute('aria-label', internal ? 'Internal note' : isNew ? 'Description' : 'Public reply');
    paintCc();
    paintSubmit();
  }

  function setMode(m) {
    mode = m;
    paintMode();
    saveDraft();
  }

  function openModeMenu() {
    openMenu(modeBtn, [
      { label: 'Public reply', icon: 'reply', checked: mode === 'public', desc: 'The requester and CCs get it by email', shortcut: 'R', run: () => { setMode('public'); editor.focus(); } },
      { label: 'Internal note', icon: 'lock', checked: mode === 'internal', desc: 'Only agents can see it', shortcut: 'N', run: () => { setMode('internal'); editor.focus(); } },
    ], { label: 'Reply type' });
  }

  function paintCc() {
    clear(ccWrap);
    if (mode !== 'public') return;
    const requester = currentRequester();
    ccWrap.append(h('span.t-to-label', 'To'), requester ? h('span.chip.static', avatar(requester.name, { size: 'sm' }), requester.name) : h('span.subtle', 'Choose a requester'));
    const ccs = value('ccs') || [];
    if (ccs.length || draft.showCc) {
      ccWrap.append(h('span.t-to-label', 'CC'), tagsInput({
        value: ccs,
        label: 'CC email addresses',
        normalize: (v) => normEmail(v),
        suggestions: () => [...app.replica.users.values()].map((u) => u.email).filter(Boolean).slice(0, 200),
        onChange: (v) => setField('ccs', v),
      }));
    } else {
      ccWrap.append(h('button.link-btn.t-cc-btn', { type: 'button', onclick: () => { draft.showCc = true; paintCc(); ccWrap.querySelector('input')?.focus(); } }, 'CC'));
    }
  }

  function paintAttachments() {
    clear(attachList);
    attachList.hidden = !attachments.length;
    for (const a of attachments) {
      attachList.append(h('li.att-chip', icon(a.uploading ? 'loader-circle' : 'paperclip', { size: 14, cls: a.uploading ? 'spin' : '' }), h('span.ellipsis', a.name), h('span.subtle', fileSize(a.size)),
        h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove ${a.name}`, onclick: () => { attachments = attachments.filter((x) => x !== a); paintAttachments(); saveDraft(); } }, icon('x', { size: 13 }))));
    }
    paintSubmit();
  }

  async function upload(files) {
    for (const file of files) {
      if (file.size > LIMITS.attachment) {
        toastError({ message: `${file.name} is larger than 20 MB` });
        continue;
      }
      if (attachments.length >= LIMITS.attachmentsPerComment) {
        toastError({ message: 'You can attach up to 10 files to one message' });
        break;
      }
      const item = { name: file.name, size: file.size, type: file.type, uploading: true };
      attachments.push(item);
      paintAttachments();
      try {
        const res = await app.api.upload(file);
        Object.assign(item, res, { uploading: false });
        announce(`${file.name} attached`);
      } catch (e) {
        attachments = attachments.filter((x) => x !== item);
        toastError(e);
      }
      paintAttachments();
      saveDraft();
    }
  }

  composer.append(composerHead, editor.el, attachList, fileInput);

  /* --------------------------------------------------------- submit */
  const submitMain = h('button.btn.btn-dark.submit-main', { type: 'button', onclick: () => submit() });
  const submitMenu = h('button.btn.btn-dark.submit-more', { type: 'button', 'aria-label': 'Submit as a different status', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openSubmitMenu() }, icon('chevron-up', { size: 16 }));
  const afterBtn = h('button.btn.btn-ghost.after-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openAfterMenu() });
  const macroBtn = h('button.select-btn.macro-btn', { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', onclick: () => pickMacro(macroBtn) }, icon('zap', { size: 15 }), h('span.value', 'Apply macro'), icon('chevron-down', { size: 16 }));
  foot.append(macroBtn, h('span.spacer'), afterBtn, h('div.split', submitMain, submitMenu));
  // Restored after the submit bar exists: setting the content runs onChange,
  // which repaints it.
  if (draft.html) editor.setHtml(draft.html);

  function targetStatus() {
    const s = value('status');
    if (s === 'new' && (hasComment() || value('assignee'))) return 'open';
    return s;
  }

  function hasComment() {
    return !editor.isEmpty() || attachments.some((a) => !a.uploading);
  }

  function dirty() {
    return hasComment() || Object.keys(patch).length > 0 || (isNew && (newSubject || newRequester));
  }

  function paintSubmit() {
    const s = targetStatus();
    clear(submitMain);
    submitMain.append(h('span', 'Submit as '), h('strong', STATUS_LABEL[s] || s));
    submitMain.disabled = submitting || editor.isBusy() || attachments.some((a) => a.uploading) || (!isNew && ticket?.status === 'closed');
    submitMenu.disabled = submitMain.disabled;
    clear(afterBtn);
    afterBtn.append(AFTER[afterSubmit()], icon('chevron-down', { size: 14 }));
    afterBtn.hidden = isNew;
  }

  function openSubmitMenu() {
    const list = statusOptions().filter((o) => o.value !== 'new' || isNew || ticket?.status === 'new');
    openMenu(submitMenu, list.map((o) => ({
      label: `Submit as ${o.label}`,
      icon: null,
      shortcut: { open: 'Alt+Shift+O', pending: 'Alt+Shift+P', hold: 'Alt+Shift+H', solved: 'Alt+Shift+S' }[o.value],
      run: () => submit(o.value),
    })), { label: 'Submit as', align: 'end', side: 'top', focusLast: true });
  }

  function openAfterMenu() {
    openMenu(afterBtn, Object.entries(AFTER).map(([k, label]) => ({
      label, checked: afterSubmit() === k,
      run: () => {
        try {
          localStorage.setItem(AFTER_KEY, k);
        } catch {
          /* ignore */
        }
        paintSubmit();
      },
    })), { label: 'After submitting', side: 'top' });
  }

  function commentPayload() {
    if (!hasComment()) return undefined;
    let html = editor.getHtml();
    if (mode === 'public' && me?.signature && !isNew) html += `<p></p>${me.signature}`;
    return {
      html,
      public: mode === 'public',
      attachments: attachments.filter((a) => !a.uploading && a.id).map(({ id: fid, name, size, type }) => ({ id: fid, name, size, type })),
    };
  }

  async function submit(status) {
    if (submitting) return;
    if (editor.isBusy()) {
      toast('Wait for the writing assistant to finish.');
      return;
    }
    if (attachments.some((a) => a.uploading)) {
      toast('Wait for the attachments to finish uploading.');
      return;
    }
    const finalStatus = status || targetStatus();
    if (isNew) return create(finalStatus);
    if (!dirty() && finalStatus === ticket.status) {
      toast('There are no changes to submit.');
      return;
    }
    const required = (app.replica.cfg.fields || []).filter((f) => f.active && f.required && finalStatus === 'solved');
    const fields = value('fields') || {};
    const missing = required.filter((f) => fields[f.id] == null || fields[f.id] === '');
    if (missing.length) {
      toastError({ message: `Fill in ${missing.map((f) => f.title).join(', ')} before solving.` });
      return;
    }
    submitting = true;
    paintSubmit();
    const prevStatus = ticket?.status;
    const body = { patch: { ...patch, status: finalStatus }, comment: commentPayload(), macro: macroUsed };
    // Only the custom fields this agent changed: sending the rest from this
    // screen's copy would undo a teammate's edit made since.
    if (patch.fields) {
      const base = ticket.fields || {};
      body.patch.fields = Object.fromEntries(Object.entries(patch.fields).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(base[k] ?? null)));
    }
    // What this submit sends; fields changed while it saves stay changed.
    // The reply itself is locked meanwhile: text added to it now would stay
    // behind with the sent text and invite sending that a second time.
    const sent = { html: editor.content.innerHTML, patch: { ...patch }, attachments: [...attachments], macro: macroUsed };
    const typing = editor.content.contains(document.activeElement);
    editor.setBusy(true);
    try {
      const res = await app.updateTicket(ticketId, body);
      ticket = res.ticket || ticket;
      clearSubmitted(sent);
      const notified = (res.notified || []).filter((n) => n.ok);
      toast(`Ticket #${ticketId} updated${finalStatus !== prevStatus ? ` to ${STATUS_LABEL[finalStatus]}` : ''}.${notified.length ? ' The requester was notified.' : ''}`, { kind: 'success' });
      // The agent may have moved on while this was saving; leave them there.
      if (destroyed) return;
      await loadEvents();
      if (!destroyed) afterSubmitted();
    } catch (e) {
      toastError(e);
    } finally {
      submitting = false;
      editor.setBusy(false);
      if (!destroyed) {
        paintSubmit();
        if (typing && document.activeElement === document.body) editor.focus();
      }
    }
  }

  async function create(status) {
    const subject = newSubject.trim();
    if (!newRequester) {
      toastError({ message: 'Choose a requester first.' });
      requesterBtn?.focus();
      return;
    }
    if (!subject) {
      toastError({ message: 'Add a subject.' });
      subjectInput?.focus();
      return;
    }
    if (!hasComment()) {
      toastError({ message: 'Add a description of the request.' });
      editor.focus();
      return;
    }
    submitting = true;
    paintSubmit();
    try {
      const { group, assignee } = { group: value('group'), assignee: value('assignee') };
      const res = await app.api.post('/tickets', {
        subject,
        requester: newRequester,
        comment: commentPayload(),
        status,
        priority: value('priority'),
        type: value('type'),
        assignee,
        group,
        tags: value('tags'),
        followers: value('followers'),
        ccs: value('ccs'),
        fields: value('fields'),
        via: patch.via || 'web',
        dueAt: value('dueAt'),
        problem: value('problem'),
      });
      app.replica.upsert('t', res.ticket);
      if (res.requester) app.replica.upsert('u', res.requester);
      app.drafts.delete('new');
      app.replaceTab('new', { id: String(res.ticket.id) });
      toast(`Ticket #${res.ticket.id} created.`, { kind: 'success' });
      if (!destroyed) go(`/tickets/${res.ticket.id}`, { replace: true });
    } catch (e) {
      toastError(e);
      submitting = false;
      paintSubmit();
    }
  }

  /** Clear what a submit sent, keeping whatever was added while it saved. */
  function clearSubmitted(sent) {
    if (destroyed) {
      clearComposer();
      return;
    }
    if (editor.content.innerHTML === sent.html) editor.clear();
    attachments = attachments.filter((a) => !sent.attachments.includes(a));
    for (const [k, v] of Object.entries(sent.patch)) if (JSON.stringify(patch[k]) === JSON.stringify(v)) delete patch[k];
    if (macroUsed === sent.macro) macroUsed = null;
    saveDraft();
    paintAttachments();
    paintProps();
    paintCc();
  }

  function clearComposer() {
    editor.clear();
    attachments = [];
    patch = {};
    macroUsed = null;
    app.drafts.delete(draftKey);
    paintAttachments();
    paintProps();
    paintCc();
  }

  function afterSubmitted() {
    const how = afterSubmit();
    if (how === 'close') {
      const next = app.closeTab(String(ticketId));
      go(next ? `/tickets/${next.id}` : app.lastListRoute);
    } else if (how === 'next') {
      nextInView(true);
    }
  }

  function nextInView(closeCurrent = false) {
    const ids = playQueue.ids;
    const i = ids.indexOf(ticketId);
    const remaining = ids.slice(i + 1).filter((x) => {
      const t = app.replica.tickets.get(x);
      return t && isUnsolved(t.status);
    });
    if (closeCurrent) app.closeTab(String(ticketId));
    if (remaining.length) go(`/tickets/${remaining[0]}`);
    else {
      toast('That was the last ticket in the view.');
      go(playQueue.viewId ? `/views/${playQueue.viewId}` : app.lastListRoute);
    }
  }

  /* --------------------------------------------------------- macros */
  function pickMacro(anchor) {
    const macros = (app.replica.cfg.macros || []).filter((m) => m.active !== false);
    if (!macros.length) {
      toast(app.isAdmin ? 'There are no macros yet. Create them in Admin.' : 'There are no macros yet.');
      return;
    }
    openPicker(anchor, {
      options: macros.map((m) => ({ value: m.id, label: m.title, desc: m.comment ? (m.comment.public ? 'Reply' : 'Note') : '' })),
      label: 'Apply macro',
      placeholder: 'Search macros',
      search: true,
      onPick: (mid) => applyMacro(macros.find((m) => m.id === mid)),
    });
  }

  function applyMacro(m) {
    if (!m) return;
    const tagSet = new Set(value('tags') || []);
    for (const a of m.actions || []) {
      if (['status', 'priority', 'type', 'group'].includes(a.field)) setField(a.field, a.value || null, { quiet: true });
      else if (a.field === 'assignee') setField('assignee', a.value === 'me' ? me.uuid : a.value || null, { quiet: true });
      else if (a.field === 'add_tags') String(a.value).split(/[\s,]+/).filter(Boolean).forEach((t) => tagSet.add(t));
      else if (a.field === 'remove_tags') String(a.value).split(/[\s,]+/).forEach((t) => tagSet.delete(t));
      else if (a.field === 'set_tags') {
        tagSet.clear();
        String(a.value).split(/[\s,]+/).filter(Boolean).forEach((t) => tagSet.add(t));
      } else if (a.field === 'add_follower') {
        const f = new Set(value('followers') || []);
        f.add(a.value === 'me' ? me.uuid : a.value);
        setField('followers', [...f], { quiet: true });
      } else if (a.field?.startsWith('field:')) {
        setField('fields', { ...(value('fields') || {}), [a.field.slice(6)]: a.value }, { quiet: true });
      }
    }
    if ((m.actions || []).some((a) => a.field.endsWith('_tags'))) setField('tags', [...tagSet], { quiet: true });
    if (m.comment?.html) {
      const requester = currentRequester();
      const html = renderPlaceholders(m.comment.html, {
        ticket: ticket || { id: '', subject: newSubject },
        requester,
        agent: me,
        desk: app.replica.meta,
        link: '',
      }, { escape: escapeHtml });
      setMode(m.comment.public ? 'public' : 'internal');
      editor.insertHtml(html);
    }
    macroUsed = m.id;
    paintProps();
    saveDraft();
    toast(`Applied "${m.title}". Review and submit when ready.`);
  }

  /* --------------------------------------------------------- AI */
  function conversationText() {
    const requester = currentRequester();
    return events
      .filter((e) => e.kind === 'comment')
      .map((e) => `${e.by?.type === 'agent' ? `Agent (${app.memberName(e.by.id) || e.by.name})` : `Customer (${requester?.name || 'customer'})`}${e.public ? '' : ' [internal note]'}: ${htmlToText(e.html)}`)
      .join('\n\n')
      .slice(-12000);
  }

  function openAiMenu() {
    aiAssist({
      anchor: composer.querySelector('[aria-label="Writing assistant"]') || composer,
      editor,
      subject: ticket?.subject || newSubject,
      conversation: conversationText,
      requester: currentRequester(),
      agent: me,
      articles: [...app.replica.articles.values()].filter((a) => a.status === 'published'),
      internal: mode === 'internal',
    });
  }

  /* ------------------------------------------------------ properties */
  let requesterBtn = null;
  let subjectInput = null;

  function currentRequester() {
    const rid = isNew ? newRequester : value('requester');
    return rid ? app.replica.users.get(rid) || null : null;
  }

  function setField(f, v, { quiet = false } = {}) {
    const base = ticket ? ticket[f] : undefined;
    const same = JSON.stringify(base ?? null) === JSON.stringify(v ?? null);
    if (same && !isNew) delete patch[f];
    else patch[f] = v;
    if (!quiet) {
      paintProps();
      saveDraft();
    }
    paintSubmit();
    paintHeadStatus();
  }

  function requesterPicker(anchor) {
    const recent = () => [...app.replica.users.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 30).map(userOption);
    openPicker(anchor, {
      options: recent(),
      label: 'Requester',
      placeholder: 'Search customers by name or email',
      value: isNew ? newRequester : value('requester'),
      loadOptions: async (q) => {
        if (!q) return recent();
        const ql = q.toLowerCase();
        return [...app.replica.users.values()].filter((u) => `${u.name} ${u.email || ''}`.toLowerCase().includes(ql)).slice(0, 50).map(userOption);
      },
      create: {
        label: 'Add customer',
        run: (text) => newCustomerInline(text),
      },
      onPick: (v) => {
        if (isNew) {
          newRequester = v;
          saveDraft();
          paintProps();
          paintCc();
          paintContext();
          paintSubmit();
        } else setField('requester', v);
        paintContext();
        paintCc();
      },
    });
  }

  function newCustomerInline(text) {
    return new Promise((resolve) => {
      const nameId = uid('n');
      const emailId = uid('e');
      const isMail = /@/.test(text);
      const nameIn = h(`input#${nameId}.input`, { value: isMail ? '' : text, autocomplete: 'off' });
      const emailIn = h(`input#${emailId}.input`, { type: 'email', value: isMail ? text : '', autocomplete: 'off' });
      const err = h('p.field-error', { role: 'alert' });
      let created = null;
      openDialog({
        title: 'Add customer',
        size: 'sm',
        body: h('div.stack', field('Name', nameIn, { id: nameId }), field('Email', emailIn, { id: emailId }), err),
        actions: [
          { label: 'Cancel' },
          {
            label: 'Add', primary: true,
            run: async () => {
              try {
                const res = await app.api.post('/users', { name: nameIn.value.trim(), email: emailIn.value.trim() });
                app.replica.upsert('u', res.user);
                created = userOption(res.user);
                return true;
              } catch (e) {
                if (e.code === 'exists' && e.current) {
                  created = userOption(e.current);
                  return true;
                }
                err.textContent = e.message;
                return false;
              }
            },
          },
        ],
        onClose: () => resolve(created),
      });
    });
  }

  function paintProps() {
    clear(props);
    const closed = ticket?.status === 'closed';
    const requester = currentRequester();
    const reqId = uid('req');
    requesterBtn = h(`button#${reqId}.select-btn`, { type: 'button', disabled: closed, 'aria-haspopup': 'listbox', 'aria-expanded': 'false', onclick: () => requesterPicker(requesterBtn) },
      requester ? avatar(requester.name, { size: 'sm' }) : icon('user', { size: 15 }),
      h('span.value', requester ? requester.name : h('span.placeholder', 'Search or add a customer')),
      icon('chevron-down', { size: 16 }));
    props.append(field('Requester', requesterBtn, { id: reqId }));

    const asgId = uid('asg');
    const t = { group: value('group'), assignee: value('assignee') };
    const asg = selectField({
      id: asgId, value: assigneeValue(t), options: assigneeOptions, label: 'Assignee', disabled: closed,
      onChange: (v) => {
        const { group, assignee } = splitAssignee(v);
        setField('group', group, { quiet: true });
        setField('assignee', assignee);
      },
    });
    if (!assigneeOptions().some((o) => o.value === assigneeValue(t))) {
      asg.querySelector('.value').textContent = assigneeLabel(t);
    }
    const takeIt = t.assignee !== me?.uuid && !closed
      ? h('button.link-btn', { type: 'button', onclick: () => { setField('group', value('group') || myGroup(), { quiet: true }); setField('assignee', me.uuid); } }, 'take it')
      : null;
    props.append(field('Assignee', asg, { id: asgId, action: takeIt }));

    const followers = value('followers') || [];
    const folWrap = h('div.chips');
    for (const f of followers) {
      folWrap.append(h('span.chip', avatar(app.memberName(f), { size: 'sm', agent: true }), h('span.ellipsis', app.memberName(f)),
        closed ? null : h('button', { type: 'button', 'aria-label': `Remove follower ${app.memberName(f)}`, onclick: () => setField('followers', followers.filter((x) => x !== f)) }, icon('x', { size: 12 }))));
    }
    const addFol = h('button.btn.btn-sm.btn-ghost', { type: 'button', disabled: closed, 'aria-haspopup': 'listbox', 'aria-expanded': 'false', onclick: () => openPicker(addFol, {
      options: agentOptions(), value: followers, multi: true, label: 'Followers', placeholder: 'Search agents',
      onPick: (v) => setField('followers', v),
    }) }, icon('plus', { size: 14 }), 'Add');
    folWrap.append(addFol);
    const followMe = !followers.includes(me?.uuid) && !closed ? h('button.link-btn', { type: 'button', onclick: () => setField('followers', [...followers, me.uuid]) }, 'follow') : null;
    props.append(h('div.field', h('span.field-label', 'Followers', followMe), folWrap));

    props.append(h('div.props-sep'));

    const tagsId = uid('tags');
    const allTags = () => [...new Set([...app.replica.tickets.values()].flatMap((x) => x.tags || []))].sort();
    const tagsEl = tagsInput({ id: tagsId, value: value('tags') || [], onChange: (v) => setField('tags', v, { quiet: true }), suggestions: allTags, label: 'Tags', placeholder: 'Add tags' });
    if (closed) tagsEl.querySelector('input').disabled = true;
    props.append(field('Tags', tagsEl, { id: tagsId }));

    const row = h('div.props-row');
    const typeId = uid('type');
    row.append(field('Type', selectField({ id: typeId, value: value('type'), options: typeOptions, onChange: (v) => setField('type', v), disabled: closed, label: 'Type' }), { id: typeId }));
    const priId = uid('pri');
    row.append(field('Priority', selectField({ id: priId, value: value('priority'), options: priorityOptions, onChange: (v) => setField('priority', v), disabled: closed, label: 'Priority' }), { id: priId }));
    props.append(row);

    if (value('type') === 'incident') {
      const probId = uid('prob');
      const problems = () => [{ value: null, label: '-' }, ...app.replica.ticketsFor((x) => x.type === 'problem' && x.id !== ticketId && !x.deleted).map((x) => ({ value: x.id, label: `#${x.id} ${x.subject}` }))];
      props.append(field('Linked problem', selectField({ id: probId, value: value('problem'), options: problems, onChange: (v) => setField('problem', v), disabled: closed, label: 'Linked problem' }), { id: probId, hint: 'Solving the problem solves its incidents.' }));
    }
    if (value('type') === 'task') {
      const dueId = uid('due');
      const due = value('dueAt');
      props.append(field('Due date', h(`input#${dueId}.input`, {
        // Saved as local noon on the chosen day, so shown as that local day.
        type: 'date', disabled: closed, value: due ? localDay(due) : '',
        onchange: (e) => setField('dueAt', e.target.value ? new Date(`${e.target.value}T12:00:00`).getTime() : null),
      }), { id: dueId }));
    }

    const defs = (app.replica.cfg.fields || []).filter((f) => f.active);
    if (defs.length) props.append(h('div.props-sep'));
    for (const def of defs) props.append(customField(def, closed));

    if (ticket?.problem && app.replica.tickets.get(ticket.problem)) {
      const p = app.replica.tickets.get(ticket.problem);
      props.append(h('p.props-note', icon('link', { size: 13 }), 'Incident of ', h('a', { href: `#/tickets/${p.id}` }, `#${p.id} ${p.subject}`)));
    }
    if (ticket?.type === 'problem') {
      const incidents = app.replica.ticketsFor((x) => x.problem === ticket.id);
      if (incidents.length) props.append(h('p.props-note', icon('link', { size: 13 }), `${incidents.length} linked incident${incidents.length === 1 ? '' : 's'}`));
    }
  }

  function customField(def, closed) {
    const fid = uid(`f-${def.id}`);
    const v = (value('fields') || {})[def.id];
    // Text fields do not repaint the panel, so build on the latest fields
    // rather than the ones this control was drawn with.
    // A cleared value is sent as null: JSON would drop undefined, and the
    // server would never hear that the field was emptied.
    const set = (nv) => setField('fields', { ...(value('fields') || {}), [def.id]: nv === '' || nv === undefined ? null : nv }, { quiet: def.type !== 'dropdown' && def.type !== 'checkbox' });
    let control;
    switch (def.type) {
      case 'dropdown':
        control = selectField({ id: fid, value: v ?? null, options: () => [{ value: null, label: '-' }, ...def.options.map((o) => ({ value: o.value, label: o.label }))], onChange: (nv) => set(nv), disabled: closed, label: def.title });
        break;
      case 'checkbox':
        control = h('label.checkbox', h(`input#${fid}`, { type: 'checkbox', checked: !!v, disabled: closed, onchange: (e) => set(e.target.checked || undefined) }), def.desc || 'Yes');
        return h('div.field', h('span.field-label', def.title, def.required ? h('span.req', { 'aria-label': 'required' }, '*') : null), control);
      case 'textarea':
        control = h(`textarea#${fid}.textarea`, { rows: 3, disabled: closed, oninput: (e) => set(e.target.value) }, v || '');
        break;
      case 'number':
        control = h(`input#${fid}.input`, { type: 'number', value: v ?? '', disabled: closed, oninput: (e) => set(e.target.value === '' ? '' : Number(e.target.value)) });
        break;
      case 'date':
        control = h(`input#${fid}.input`, { type: 'date', value: v || '', disabled: closed, onchange: (e) => set(e.target.value) });
        break;
      default:
        control = h(`input#${fid}.input`, { type: 'text', value: v || '', disabled: closed, oninput: (e) => set(e.target.value) });
    }
    return field(h('span', def.title, def.required ? h('span.req', { 'aria-label': ' (required to solve)' }, ' *') : null), control, { id: fid, hint: def.type !== 'checkbox' ? def.desc || null : null });
  }

  /* ---------------------------------------------------------- header */
  const headStatus = h('span.t-head-status');
  function paintHeadStatus() {
    clear(headStatus);
    headStatus.append(statusBadge(isNew ? 'new' : value('status')));
    if (patch.status && ticket && patch.status !== ticket.status) headStatus.append(h('span.subtle.t-pending-change', `will be ${STATUS_LABEL[patch.status]}`));
  }

  function paintHead() {
    clear(head);
    paintHeadStatus();
    if (isNew) {
      const sid = uid('subj');
      subjectInput = h(`input#${sid}.input.t-subject-input`, {
        value: newSubject, placeholder: 'Subject', maxlength: LIMITS.subject, 'aria-label': 'Subject',
        oninput: (e) => {
          newSubject = e.target.value;
          saveDraft();
        },
      });
      head.append(h('div.t-title-row', headStatus, subjectInput));
      return;
    }
    const subject = value('subject');
    const title = h('h1.t-subject', { tabindex: ticket?.status === 'closed' ? undefined : '0', title: ticket?.status === 'closed' ? undefined : 'Click to edit the subject', onclick: () => editSubject(), onkeydown: (e) => { if (e.key === 'Enter') editSubject(); } }, subject);
    const sla = ticket ? slaStatus(ticket, app.replica.cfg.sla) : null;
    const metaLine = h('div.t-meta',
      h('span.t-meta-item', icon(ticket.via === 'email' ? 'mail' : ticket.via === 'portal' ? 'globe' : ticket.via === 'phone' ? 'phone' : 'message-square', { size: 13 }), `Via ${CHANNEL_LABEL[ticket.via] || ticket.via}`),
      h('span.t-meta-item', { title: fullDate(ticket.createdAt) }, `Created ${relTime(ticket.createdAt)}`),
      h('span.t-meta-item', `#${ticket.id}`),
      sla ? h(`span.sla${sla.breached ? '.breached' : sla.remaining < 3600000 ? '.soon' : ''}`, { title: `${SLA_METRIC_LABEL[sla.metric]} target ${sla.breached ? 'missed' : 'due'} ${fullDate(sla.dueAt)}` }, `${SLA_METRIC_LABEL[sla.metric]} ${sla.breached ? 'overdue ' : 'in '}${shortDuration(Math.abs(sla.remaining))}`) : null,
      ticket.csat ? h(`span.csat.${ticket.csat.score}`, icon(ticket.csat.score === 'good' ? 'thumbs-up' : 'thumbs-down', { size: 13 }), ticket.csat.score === 'good' ? 'Rated good' : 'Rated bad') : null,
      ticket.mergedInto ? h('span.t-meta-item', 'Merged into ', h('a', { href: `#/tickets/${ticket.mergedInto}` }, `#${ticket.mergedInto}`)) : null,
      ticket.deleted ? h('span.badge', { style: { background: 'var(--danger-soft)', color: 'var(--danger)' } }, 'Deleted') : null,
      ticket.spam ? h('span.badge', 'Spam') : null,
      ticket.unverified ? h('span.badge.unverified', {
        title: `Sent from the help center using ${app.replica.users.get(ticket.requester)?.email || 'this customer\'s address'}, which was not verified. Anyone can type any address, so check before sharing private details.`,
      }, icon('triangle-alert', { size: 12 }), 'Sender not verified') : null,
    );
    const filterBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Filter the conversation', title: 'Filter the conversation', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openMenu(filterBtn, [
      { heading: 'Show' },
      { label: 'Everything', checked: filter === 'all', run: () => setFilter('all') },
      { label: 'Public replies', checked: filter === 'public', run: () => setFilter('public') },
      { label: 'Internal notes', checked: filter === 'internal', run: () => setFilter('internal') },
      { label: 'Changes only', checked: filter === 'events', run: () => setFilter('events') },
    ], { align: 'end' }) }, icon('list-filter', { size: 18 }));
    const aiBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Summarize the conversation', title: 'Summarize the conversation', onclick: () => summarize() }, icon('sparkles', { size: 18 }));
    const moreBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'More ticket actions', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openMoreMenu(moreBtn) }, icon('ellipsis-vertical', { size: 18 }));
    head.append(h('div.t-title-row', headStatus, title, h('div.t-head-actions', aiBtn, filterBtn, moreBtn)), metaLine);
  }

  async function editSubject() {
    if (ticket?.status === 'closed') return;
    const v = await promptDialog({ title: 'Edit subject', label: 'Subject', value: value('subject') });
    if (!v || v === value('subject')) return;
    // setField drops the change again when it goes back to the saved subject.
    setField('subject', v);
    paintHead();
    toast(v === ticket.subject ? 'Subject change undone.' : 'Subject changed. Submit to save it.');
  }

  function setFilter(f) {
    filter = f;
    paintEvents();
  }

  function openMoreMenu(anchor) {
    const items = [
      { label: 'Merge into another ticket', icon: 'git-merge', disabled: ticket.status === 'closed', run: mergeDialog },
      { label: 'Copy link', icon: 'copy', run: () => { navigator.clipboard?.writeText(`${appBaseUrl()}#/tickets/${ticketId}`); toast('Link copied.'); } },
      { label: 'Print', icon: 'printer', run: () => window.print() },
    ];
    const portal = app.helpCenterUrl();
    if (portal) items.push({ label: 'View as the requester', icon: 'external-link', run: () => window.open(`${portal}/requests/${ticketId}?key=${ticket.key}`, '_blank', 'noopener') });
    items.push({ separator: true });
    if (ticket.deleted) items.push({ label: 'Restore ticket', icon: 'archive-restore', run: () => flag('restore') });
    else {
      items.push(ticket.spam ? { label: 'Not spam', icon: 'circle-check', run: () => flag('restore') } : { label: 'Mark as spam', icon: 'ban', run: () => flag('spam') });
      items.push({ label: 'Delete', icon: 'trash', danger: true, run: () => flag('delete') });
    }
    openMenu(anchor, items, { align: 'end', label: 'Ticket actions' });
  }

  async function flag(action) {
    try {
      await app.ticketAction(ticketId, action);
      const verb = { delete: 'moved to Deleted tickets', spam: 'marked as spam', restore: 'restored' }[action];
      toast(`Ticket #${ticketId} ${verb}.`, {
        kind: 'success',
        action: action !== 'restore' ? { label: 'Undo', run: () => app.ticketAction(ticketId, 'restore') } : null,
      });
      if (action !== 'restore') {
        const next = app.closeTab(String(ticketId));
        go(next ? `/tickets/${next.id}` : app.lastListRoute);
      }
    } catch (e) {
      toastError(e);
    }
  }

  function mergeDialog() {
    const candidates = app.replica.ticketsFor((x) => x.id !== ticketId && x.status !== 'closed' && !x.deleted && !x.spam)
      .sort((a, b) => (b.requester === ticket.requester) - (a.requester === ticket.requester) || b.updatedAt - a.updatedAt);
    let target = null;
    const toOption = (x) => ({ value: x.id, label: `#${x.id} ${x.subject}`, desc: app.userName(x.requester) });
    const pickBtn = h('button.select-btn', { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', onclick: () => openPicker(pickBtn, {
      options: candidates.slice(0, 300).map(toOption),
      // Typing searches every open ticket, not only the 300 listed first.
      loadOptions: async (q) => {
        const ql = q.toLowerCase().replace(/^#/, '');
        return (ql ? candidates.filter((x) => `${x.id} ${x.subject} ${app.userName(x.requester)}`.toLowerCase().includes(ql)) : candidates).slice(0, 300).map(toOption);
      },
      label: 'Ticket to merge into', placeholder: 'Search by number or subject',
      onPick: (v, o) => {
        target = v;
        pickBtn.querySelector('.value').textContent = o.label;
      },
    }) }, h('span.value', h('span.placeholder', 'Choose a ticket')), icon('chevron-down', { size: 16 }));
    const pub = h('input', { type: 'checkbox', checked: true });
    openDialog({
      title: `Merge ticket #${ticketId}`,
      description: 'This ticket will be closed and its tags moved to the ticket you choose. Both get a comment explaining the merge.',
      body: h('div.stack', field('Merge into', pickBtn), h('label.checkbox', pub, 'Let the requesters see the merge comments')),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Merge', primary: true,
          run: async () => {
            if (!target) {
              toastError({ message: 'Choose a ticket to merge into.' });
              return false;
            }
            try {
              const res = await app.api.post(`/tickets/${ticketId}/merge`, { into: target, public: pub.checked });
              app.replica.upsert('t', res.ticket);
              toast(`Merged into #${target}.`, { kind: 'success' });
              app.closeTab(String(ticketId));
              go(`/tickets/${target}`);
              return true;
            } catch (e) {
              toastError(e);
              return false;
            }
          },
        },
      ],
    });
  }

  async function summarize() {
    if (!events.length) return;
    summaryEl.hidden = false;
    clear(summaryEl);
    summaryEl.append(h('div.t-summary-head', icon('sparkles', { size: 15 }), h('strong', 'Summary'), h('span.spacer'), h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Close summary', onclick: () => { summaryEl.hidden = true; } }, icon('x', { size: 14 }))), h('div.t-summary-body', spinner('Summarizing')));
    try {
      summary = await aiSummary({ subject: ticket.subject, conversation: conversationText() });
      const body = summaryEl.querySelector('.t-summary-body');
      clear(body);
      body.append(h('p', summary));
      announce('Summary ready');
    } catch (e) {
      summaryEl.querySelector('.t-summary-body').replaceChildren(h('p.muted', e?.message || 'The summary could not be created.'));
    }
  }

  /* --------------------------------------------------------- events */
  async function loadEvents() {
    if (isNew) return;
    try {
      const res = await app.api.get(`/tickets/${ticketId}`);
      if (destroyed) return;
      events = res.events || [];
      if (res.ticket) {
        ticket = res.ticket;
        app.replica.upsert('t', res.ticket);
      }
      loaded = true;
      paintEvents();
    } catch (e) {
      if (destroyed) return;
      if (e.status === 404) {
        clear(eventsEl);
        eventsEl.append(h('div.empty', h('h2', 'This ticket no longer exists'), h('p', 'It may have been deleted permanently.')));
        return;
      }
      toastError(e);
    }
  }

  const changeText = (c) => {
    const fmt = (f, v) => {
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '-';
      switch (f) {
        case 'status': return STATUS_LABEL[v] || v;
        case 'priority': return PRIORITY_LABEL[v] || v;
        case 'type': return TYPE_LABEL[v] || v;
        case 'assignee': return app.memberName(v);
        case 'group': return (app.replica.cfg.groups || []).find((g) => g.id === v)?.name || 'Deleted group';
        case 'requester': return app.userName(v);
        case 'followers': return v.map((x) => app.memberName(x)).join(', ');
        case 'tags': case 'ccs': return v.join(', ');
        case 'deleted': return v ? 'Deleted' : 'Restored';
        case 'spam': return v ? 'Yes' : 'No';
        case 'dueAt': return shortDate(v);
        case 'problem': return `#${v}`;
        default:
          if (f.startsWith('field:')) {
            const def = (app.replica.cfg.fields || []).find((d) => d.id === f.slice(6));
            return def ? fieldValueLabel(def, v) : String(v);
          }
          return String(v);
      }
    };
    const label = c.field.startsWith('field:')
      ? (app.replica.cfg.fields || []).find((d) => d.id === c.field.slice(6))?.title || 'Field'
      : { status: 'Status', priority: 'Priority', type: 'Type', assignee: 'Assignee', group: 'Group', requester: 'Requester', tags: 'Tags', followers: 'Followers', ccs: 'CCs', subject: 'Subject', deleted: 'Trash', spam: 'Spam', dueAt: 'Due date', problem: 'Problem' }[c.field] || c.field;
    return h('span.chg', h('span.chg-field', label), ' ', h('span.chg-from', fmt(c.field, c.from)), icon('chevron-right', { size: 12 }), h('span.chg-to', fmt(c.field, c.to)));
  };

  /** Profile pictures for agents (Puter users); customers get initials. */
  function agentUsername(uuid) {
    if (uuid && uuid === me?.uuid) return '';
    const m = app.replica.members[uuid];
    return m?.username || null;
  }

  function authorName(e) {
    if (e.by?.type === 'agent' && e.by.id) return app.memberName(e.by.id) || e.by.name;
    if (e.by?.type === 'customer') return e.by.name || app.userName(ticket?.requester);
    return e.by?.name || 'System';
  }

  function attachmentChip(a) {
    return h('button.att-chip.att-file', {
      type: 'button',
      onclick: async () => {
        try {
          openBlob(await app.api.fileBlob(a.id), a.name);
        } catch (err) {
          toastError(err);
        }
      },
    }, icon('paperclip', { size: 14 }), h('span.ellipsis', a.name), h('span.subtle', fileSize(a.size)));
  }

  function eventEl(e) {
    if (e.kind === 'comment') {
      const agent = e.by?.type === 'agent';
      const name = authorName(e);
      return h(`article.ev.ev-comment${e.public ? '' : '.ev-internal'}${agent ? '.ev-agent' : '.ev-customer'}`, { 'aria-label': `${e.public ? 'Message' : 'Internal note'} from ${name}` },
        avatar(name, { agent, username: agent ? agentUsername(e.by.id) : null }),
        h('div.ev-main',
          h('div.ev-head', h('strong', name), agent ? null : h('span.ev-tag', 'Requester'), e.public ? null : h('span.ev-note-tag', icon('lock', { size: 12 }), 'Internal note'),
            e.via && e.via !== 'web' && !agent ? h('span.subtle', `via ${CHANNEL_LABEL[e.via] || e.via}`) : null,
            h('time.ev-time', { datetime: new Date(e.at).toISOString(), title: fullDate(e.at) }, relTime(e.at))),
          h('div.ev-body.prose', { html: sanitizeHtml(e.html) }),
          e.attachments?.length ? h('div.ev-atts', e.attachments.map(attachmentChip)) : null));
    }
    if (e.kind === 'rating') {
      return h('div.ev.ev-system', icon(e.score === 'good' ? 'thumbs-up' : 'thumbs-down', { size: 14 }),
        h('span', h('strong', authorName(e)), ` rated the support ${e.score === 'good' ? 'Good' : 'Bad'}`, e.comment ? `: "${e.comment}"` : ''),
        h('time.ev-time', { title: fullDate(e.at) }, relTime(e.at)));
    }
    if (e.kind === 'change' || e.kind === 'create') {
      const changes = (e.changes || []).filter((c) => c.field !== 'subject' || e.kind !== 'create');
      if (e.kind === 'create' && filter !== 'events') {
        return h('div.ev.ev-system', icon('circle-dot', { size: 14 }), h('span', h('strong', authorName(e)), ` created this ticket${e.via && e.via !== 'web' ? ` via ${CHANNEL_LABEL[e.via]}` : ''}`), h('time.ev-time', { title: fullDate(e.at) }, relTime(e.at)));
      }
      if (!changes.length && !e.triggers?.length) return null;
      return h('div.ev.ev-system',
        icon(e.kind === 'create' ? 'circle-dot' : 'pencil', { size: 14 }),
        h('div.ev-changes',
          h('span', h('strong', authorName(e)), e.macro ? ' applied a macro' : e.kind === 'create' ? ' created this ticket' : ' updated'),
          changes.map(changeText),
          e.triggers?.length ? h('span.chg.subtle', icon('workflow', { size: 12 }), e.triggers.map((x) => x.title).join(', ')) : null),
        h('time.ev-time', { title: fullDate(e.at) }, relTime(e.at)));
    }
    return null;
  }

  // What the conversation shows now, so a reload that only brings new
  // events appends them instead of redrawing.
  let painted = null;

  function paintEvents() {
    const atBottom = eventsEl.scrollHeight - eventsEl.scrollTop - eventsEl.clientHeight < 80;
    const list = loaded && !isNew ? events.filter((e) => {
      if (filter === 'public') return e.kind === 'comment' && e.public;
      if (filter === 'internal') return e.kind === 'comment' && !e.public;
      if (filter === 'events') return e.kind !== 'comment';
      return true;
    }) : null;
    const sigs = list ? list.map((e) => JSON.stringify(e)) : null;
    // The conversation is a live region (role=log): appending announces just
    // the new messages, while a redraw would read the whole thread again.
    if (painted && list && painted.filter === filter && painted.sigs.length <= sigs.length && painted.sigs.every((x, i) => x === sigs[i])) {
      if (sigs.length > painted.sigs.length) {
        eventsEl.querySelector('.t-none')?.remove();
        painted.lastDay = appendEvents(list.slice(painted.sigs.length), painted.lastDay);
        painted.sigs = sigs;
        if (atBottom) eventsEl.scrollTop = eventsEl.scrollHeight;
      }
      return;
    }
    eventsEl.setAttribute('aria-live', 'off');
    clearTimeout(paintEvents.live);
    paintEvents.live = setTimeout(() => eventsEl.removeAttribute('aria-live'), 100);
    painted = null;
    clear(eventsEl);
    if (isNew) {
      eventsEl.append(h('div.t-new-hint', icon('info', { size: 15 }), h('p', 'Choose the requester, add a subject and describe the request. Use ', h('strong', 'Public reply'), ' to send the requester a message, or ', h('strong', 'Internal note'), ' to only record it.')));
      return;
    }
    if (!loaded) {
      eventsEl.append(h('div.t-loading', spinner('Loading conversation')));
      return;
    }
    painted = { filter, sigs, lastDay: appendEvents(list, null) };
    if (!list.length) eventsEl.append(h('p.muted.t-none', 'Nothing to show with this filter.'));
    if (atBottom || !paintEvents.done) {
      eventsEl.scrollTop = eventsEl.scrollHeight;
      paintEvents.done = true;
    }
  }

  function appendEvents(list, lastDay) {
    for (const e of list) {
      const day = new Date(e.at).toDateString();
      if (day !== lastDay) {
        lastDay = day;
        eventsEl.append(h('div.ev-day', h('span', shortDate(e.at))));
      }
      const el = eventEl(e);
      if (el) eventsEl.append(el);
    }
    return lastDay;
  }

  /* -------------------------------------------------------- context */
  let contextTab = 'customer';
  /** Arrow keys, Home and End move between tabs (the ARIA tabs pattern). */
  function tabKeys(e, keys, currentKey, select) {
    const i = keys.indexOf(currentKey);
    const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: keys.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(keys[(next + keys.length) % keys.length]);
  }

  const ctxPanelId = uid('ctx-panel');
  function paintContext() {
    const refocus = context.querySelector('.ctx-tabs')?.contains(document.activeElement);
    clear(context);
    const tabs = [['customer', 'user', 'Customer'], ['knowledge', 'book-open', 'Knowledge'], ['details', 'info', 'Ticket details']];
    const select = (k) => { contextTab = k; paintContext(); };
    const bar = h('div.ctx-tabs', {
      role: 'tablist', 'aria-label': 'Context', 'aria-orientation': 'vertical',
      onkeydown: (e) => tabKeys(e, tabs.map((t) => t[0]), contextTab, select),
    }, tabs.map(([k, ic, label]) =>
      h('button.icon-btn', {
        type: 'button', role: 'tab', 'aria-selected': String(contextTab === k), 'aria-controls': ctxPanelId,
        tabindex: contextTab === k ? '0' : '-1', 'aria-label': label, title: label, onclick: () => select(k),
      }, icon(ic, { size: 18 }))));
    const body = h(`div#${ctxPanelId}.ctx-body`, { role: 'tabpanel', 'aria-label': tabs.find((t) => t[0] === contextTab)[2] });
    context.append(body, bar);
    if (contextTab === 'customer') paintCustomer(body);
    else if (contextTab === 'knowledge') paintKnowledge(body);
    else paintDetails(body);
    if (refocus) bar.querySelector('[aria-selected="true"]').focus();
  }

  function paintCustomer(body) {
    const u = currentRequester();
    if (!u) {
      body.append(h('div.ctx-empty', icon('user', { size: 20 }), h('p', 'Choose a requester to see their details and past tickets.')));
      return;
    }
    const org = u.org ? app.replica.orgs.get(u.org) : null;
    const notesId = uid('notes');
    const notes = h(`textarea#${notesId}.textarea.ctx-notes`, { rows: 3, placeholder: 'Add notes about this customer', maxlength: 4000 }, u.notes || '');
    notes.addEventListener('change', async () => {
      try {
        const res = await app.api.post(`/users/${u.id}`, { notes: notes.value });
        app.replica.upsert('u', res.user);
        toast('Notes saved.');
      } catch (e) {
        toastError(e);
      }
    });
    const local = localTimeIn(u.tz);
    body.append(
      h('div.ctx-card',
        h('div.ctx-person', avatar(u.name, { size: 'lg' }), h('div.grow', h('a.ctx-name', { href: `#/customers/${u.id}` }, u.name), org ? h('a.ctx-org', { href: `#/orgs/${org.id}` }, org.name) : null)),
        h('dl.ctx-dl',
          h('dt', 'Email'), h('dd', u.email ? h('a', { href: `mailto:${u.email}` }, u.email) : h('span.subtle', '-')),
          u.phone ? [h('dt', 'Phone'), h('dd', h('a', { href: `tel:${u.phone}` }, u.phone))] : null,
          local ? [h('dt', 'Local time'), h('dd', local)] : null,
          u.locale ? [h('dt', 'Language'), h('dd', u.locale)] : null,
          u.tags?.length ? [h('dt', 'Tags'), h('dd', h('div.chips', u.tags.map((t) => h('span.chip.static', t))))] : null),
        h('label.field-label', { for: notesId }, 'Notes'), notes),
    );
    const history = app.replica.ticketsFor((t) => t.requester === u.id && !t.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
    body.append(h('div.ctx-section', h('h3', `Interaction history`, h('span.count', String(history.length))),
      h('ul.ctx-history', history.slice(0, 30).map((t) => h('li', h(`a.ctx-hist${t.id === ticketId ? '.current' : ''}`, { href: `#/tickets/${t.id}`, 'aria-current': t.id === ticketId ? 'page' : undefined },
        statusBadge(t.status, { compact: true }),
        h('span.grow', h('span.ellipsis.ctx-hist-subj', t.subject), h('span.subtle.ctx-hist-meta', `#${t.id} · ${relTime(t.updatedAt)}`))))))));
  }

  function paintKnowledge(body) {
    const qId = uid('kbq');
    const input = h(`input#${qId}.input`, { type: 'search', placeholder: 'Search articles', value: ticket?.subject || newSubject || '' });
    const results = h('ul.ctx-articles');
    const portal = app.helpCenterUrl();
    const run = () => {
      clear(results);
      const words = input.value.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const scored = [...app.replica.articles.values()]
        .filter((a) => a.status === 'published')
        .map((a) => {
          const hay = `${a.title} ${a.excerpt || ''} ${(a.labels || []).join(' ')}`.toLowerCase();
          return { a, score: words.reduce((s, w) => s + (hay.includes(w) ? (a.title.toLowerCase().includes(w) ? 3 : 1) : 0), 0) };
        })
        .filter((x) => !words.length || x.score > 0)
        .sort((x, y) => y.score - x.score)
        .slice(0, 12);
      if (!scored.length) results.append(h('li.muted.ctx-none', app.replica.articles.size ? 'No matching articles.' : 'No articles yet. Write them in the Knowledge base.'));
      for (const { a } of scored) {
        results.append(h('li.ctx-article',
          h('a', { href: `#/kb/articles/${a.id}` }, a.title),
          a.excerpt ? h('p.subtle', a.excerpt) : null,
          h('button.btn.btn-sm', {
            type: 'button',
            onclick: () => {
              const href = portal ? `${portal}/articles/${a.id}` : null;
              editor.insertHtml(href ? `<a href="${escapeHtml(href)}">${escapeHtml(a.title)}</a>&nbsp;` : `${escapeHtml(a.title)} `);
              if (!href) toast('Turn on the help center to share article links with customers.');
            },
          }, icon('link', { size: 13 }), 'Insert link')));
      }
    };
    input.addEventListener('input', debounce(run, 150));
    body.append(h('div.ctx-section', h('label.field-label', { for: qId }, 'Knowledge base'), h('div.search-input', icon('search', { size: 14 }), input), results));
    run();
  }

  function paintDetails(body) {
    if (isNew) {
      const viaId = uid('via');
      body.append(h('div.ctx-section', field('Channel', selectField({ id: viaId, value: patch.via || 'web', options: [['web', 'Agent'], ['phone', 'Phone'], ['email', 'Email'], ['chat', 'Chat']].map(([v, l]) => ({ value: v, label: l })), onChange: (v) => { patch.via = v; } }), { id: viaId, hint: 'How the request came in.' })));
      return;
    }
    const t = ticket;
    const rows = [
      ['Ticket', `#${t.id}`],
      ['Status', STATUS_LABEL[t.status]],
      ['Channel', CHANNEL_LABEL[t.via] || t.via],
      ['Created', fullDate(t.createdAt)],
      ['Updated', fullDate(t.updatedAt)],
      t.firstReplyAt ? ['First reply', `${fullDate(t.firstReplyAt)} (${shortDuration(t.firstReplyAt - t.createdAt)})`] : null,
      t.solvedAt ? ['Solved', fullDate(t.solvedAt)] : null,
      t.closedAt ? ['Closed', fullDate(t.closedAt)] : null,
      t.submitter ? ['Submitted by', app.memberName(t.submitter)] : null,
      t.csat ? ['Satisfaction', `${t.csat.score === 'good' ? 'Good' : 'Bad'}${t.csat.comment ? `: ${t.csat.comment}` : ''}`] : null,
    ].filter(Boolean);
    body.append(h('div.ctx-section', h('h3', 'Ticket details'), h('dl.ctx-dl', rows.map(([k, v]) => [h('dt', k), h('dd', v)]))));
  }

  /* ------------------------------------------------------- presence */
  let presenceTimer = null;
  let typingUntil = 0;
  async function heartbeat(leave = false) {
    if (isNew || app.api.isLocal || Object.keys(app.replica.members).length < 2) return;
    try {
      const res = await app.api.post(`/tickets/${ticketId}/presence`, { typing: Date.now() < typingUntil, leave });
      if (destroyed || leave) return;
      const viewers = res.viewers || [];
      // The line is a live region: only touch it when it changes, or the
      // same "is also viewing" is announced again every heartbeat.
      const said = JSON.stringify(viewers.map((v) => [v.name, !!v.typing]));
      if (said === presenceEl.dataset.said) return;
      presenceEl.dataset.said = said;
      clear(presenceEl);
      if (viewers.length) {
        presenceEl.append(h('span.presence', viewers.map((v) => avatar(v.name, { size: 'sm', agent: true, title: v.name })),
          h('span', viewers.map((v) => `${v.name}${v.typing ? ' is typing' : ''}`).join(', '), viewers.some((v) => v.typing) ? '' : viewers.length === 1 ? ' is also viewing' : ' are also viewing')));
      }
    } catch {
      /* best effort */
    }
  }
  editor.content.addEventListener('input', () => {
    const was = Date.now() < typingUntil;
    typingUntil = Date.now() + 8000;
    if (!was) heartbeat();
  });

  /* ----------------------------------------------------------- panes */
  // On phones one section shows at a time, chosen with these tabs.
  convo.id ||= uid('pane');
  props.id ||= uid('pane');
  context.id ||= uid('pane');
  const PANES = [['conversation', 'Conversation', convo], ['details', 'Details', props], ['customer', 'Customer', context]];
  panes.onkeydown = (e) => tabKeys(e, PANES.map((p) => p[0]), pane, (k) => {
    pane = k;
    ws.dataset.pane = k;
    paintPanes();
    panes.querySelector('[aria-selected="true"]').focus();
  });
  function paintPanes() {
    clear(panes);
    for (const [k, label, panel] of PANES) {
      panes.append(h('button.pane-tab', {
        type: 'button', role: 'tab', 'aria-selected': String(pane === k), 'aria-controls': panel.id, tabindex: pane === k ? '0' : '-1',
        onclick: () => { pane = k; ws.dataset.pane = k; paintPanes(); },
      }, label));
    }
  }

  /* ------------------------------------------------------ live data */
  const reloadEvents = debounce(loadEvents, 300);
  // Live updates repaint a side panel, but never under the agent's cursor:
  // while they type in it (customer notes, a custom field, tags), wait until
  // they leave the field so their text and focus are kept.
  function repaintPanel(panel, paint) {
    const typing = () => panel.contains(document.activeElement) && document.activeElement.matches('input, textarea, select, [contenteditable]');
    if (!typing()) {
      preserveFocus(panel, paint);
      return;
    }
    if (panel.dataset.stale) return;
    panel.dataset.stale = '1';
    panel.addEventListener('focusout', function later() {
      setTimeout(() => {
        if (destroyed || typing()) return;
        panel.removeEventListener('focusout', later);
        delete panel.dataset.stale;
        paint();
      }, 0);
    });
  }

  const onChange = (e) => {
    const { kinds, ids } = e.detail || {};
    if (isNew) {
      if (kinds?.has('u')) paintCc();
      return;
    }
    if (ids && !ids.t?.has(ticketId)) {
      // Another record changed: only this ticket's customer, their
      // organization, the desk's settings or its team affect the panels.
      const requester = currentRequester();
      const relevant = kinds.has('c') || kinds.has('m')
        || (requester && (ids.u?.has(requester.id) || (requester.org && ids.o?.has(requester.org))));
      if (relevant) {
        repaintPanel(props, paintProps);
        repaintPanel(context, paintContext);
      }
      return;
    }
    const next = app.replica.tickets.get(ticketId);
    if (!next) return;
    const byOther = next.updatedBy && next.updatedBy !== me?.uuid && (!ticket || next.updatedAt > ticket.updatedAt);
    const newCustomer = !ids || next.requester !== ticket?.requester;
    ticket = next;
    preserveFocus(head, paintHead);
    repaintPanel(props, paintProps);
    if (newCustomer) repaintPanel(context, paintContext);
    paintSubmit();
    if (byOther) {
      banner.hidden = false;
      clear(banner);
      banner.append(icon('info', { size: 15 }), h('span', `${app.memberName(next.updatedBy) || 'Someone'} updated this ticket ${relTime(next.updatedAt)}.`), Object.keys(patch).length ? h('span.subtle', ' Your unsaved changes are kept.') : null,
        h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Dismiss', onclick: () => { banner.hidden = true; } }, icon('x', { size: 13 })));
      reloadEvents();
    } else if (next.updatedAt > (events[events.length - 1]?.at || 0) + 1000) reloadEvents();
  };
  app.replica.addEventListener('change', onChange);

  function saveDraft() {
    const html = editor.isEmpty() ? '' : editor.content.innerHTML;
    if (!html && !Object.keys(patch).length && !attachments.length && !(isNew && (newSubject || newRequester))) {
      app.drafts.delete(draftKey);
      return;
    }
    app.drafts.set(draftKey, { html, patch, mode, attachments: attachments.filter((a) => !a.uploading), macro: macroUsed, subject: newSubject, requester: newRequester, showCc: draft.showCc });
    paintSubmit();
  }

  /* ------------------------------------------------------- shortcuts */
  const unbind = bind('ticket', {
    r: () => { setMode('public'); editor.focus(); },
    n: () => { setMode('internal'); editor.focus(); },
    m: () => pickMacro(macroBtn),
    a: () => { if (!isNew) { setField('group', value('group') || myGroup(), { quiet: true }); setField('assignee', me.uuid); announce('Assigned to you. Submit to save.'); } },
    'mod+enter': () => submit(),
    'alt+shift+o': () => submit('open'),
    'alt+shift+p': () => submit('pending'),
    'alt+shift+h': () => submit('hold'),
    'alt+shift+s': () => submit('solved'),
    'alt+j': () => nextInView(false),
  });

  /* ------------------------------------------------------------ init */
  if (!isNew && !ticket) {
    // Not in the local copy yet (a link from elsewhere): fetch it.
    clear(head);
    head.append(h('div.t-loading', spinner()));
  }
  if (isNew) {
    app.openTab({ id: 'new' });
    document.title = 'New ticket - Help Desk';
  } else document.title = `#${ticketId} ${ticket?.subject || ''} - Help Desk`;
  if (ticket || isNew) {
    paintHead();
    paintProps();
    paintContext();
  }
  paintPanes();
  paintMode();
  paintAttachments();
  paintEvents();
  paintSubmit();
  if (!isNew) {
    loadEvents().then(() => {
      if (destroyed) return;
      if (ticket) {
        // The agent may already be moving around the panels.
        preserveFocus(head, paintHead);
        repaintPanel(props, paintProps);
        repaintPanel(context, paintContext);
        document.title = `#${ticketId} ${ticket.subject} - Help Desk`;
      }
    });
    heartbeat();
    presenceTimer = setInterval(() => heartbeat(), 15000);
  }
  requestAnimationFrame(() => {
    if (isNew) (newRequester ? subjectInput : requesterBtn)?.focus();
  });

  return () => {
    destroyed = true;
    // Keep the draft only while its tab is open: creating the ticket, or
    // closing, deleting or merging it, has already let it go.
    if (app.tabs.some((t) => t.id === draftKey)) saveDraft();
    unbind();
    clearInterval(presenceTimer);
    heartbeat(true);
    app.replica.removeEventListener('change', onChange);
    document.title = 'Help Desk';
  };
}

export { modKey, confirmDialog };
