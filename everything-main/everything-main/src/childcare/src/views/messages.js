/**
 * Messages: one conversation per child between the school and the family,
 * plus school-wide or room announcements.
 */
import { h, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, tabs, searchBox, emptyState, field, textInput, textarea, pill } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { navigate, setQuery } from '../ui/router.js';
import { app, isFamily, myName, myStudents } from '../app.js';
import { personName, matches, pluralize, firstName } from '../core/format.js';
import { sortRooms, guardiansOf } from '../core/people.js';
import { messagesName, sendMessage, markRead, isUnread, sortMessages } from '../core/messages.js';
import { formatDate, formatTime, timeAgo, toISODate } from '../core/dates.js';
import { saveFile, isImage } from '../files.js';
import { childAvatar, mediaGrid, roomDot } from './common.js';
import { pickChildren } from './log.js';

const who = () => ({ role: isFamily() ? 'family' : 'staff', uuid: app.user?.uuid || 'family' });

export function render(ctx) {
  const store = app.store;
  let tab = ctx.query.tab === 'announcements' ? 'announcements' : 'conversations';
  let current = ctx.params.id || null;
  let q = '';
  let unreadOnly = false;
  let lastLog = null; // { sid, el, count }: to keep the reader's place in the conversation across redraws
  let picked = false; // a family's first conversation opens by itself, once
  let draft = null; // { sid, node }: the composer, kept across redraws so a sync never wipes what is being typed

  const header = h('div');
  const drawHeader = () =>
    keepFocus(header, () =>
      header.replaceChildren(
        pageHeader({
          title: 'Messages',
          actions: isFamily()
            ? null
            : tab === 'announcements'
              ? [h('button.btn.primary', { type: 'button', onClick: () => openAnnouncementForm() }, icon('megaphone', 16), 'New announcement')]
              : [h('button.btn', { type: 'button', onClick: sendToMany }, icon('users', 16), 'Message several families'), h('button.btn.primary', { type: 'button', onClick: newConversation }, icon('plus', 16), 'New message')],
        }),
        tabs({ label: 'Messages', items: [{ id: 'conversations', label: 'Conversations' }, { id: 'announcements', label: 'Announcements' }], selected: tab, onSelect: (t) => ((tab = t), setQuery({ tab: t === 'announcements' ? 'announcements' : null }), drawHeader(), body.redraw()) }),
      ),
    );
  drawHeader();

  if (current) store.open([messagesName(current)]);

  const body = ctx.live(() => (tab === 'announcements' ? announcements(ctx) : conversations()), ['threads', 'messages', 'students', 'announcements', 'rooms']);

  function conversations() {
    const kids = myStudents().filter((s) => s.status !== 'inactive' && s.status !== 'graduated');
    const threads = new Map(store.all('threads').map((t) => [t.id, t]));
    const rows = kids
      .map((s) => ({ s, t: threads.get(s.id) || null }))
      .filter(({ s, t }) => matches(personName(s), q) && (!unreadOnly || isUnread(t, who())))
      .sort((a, b) => String(b.t?.lastAt || '').localeCompare(String(a.t?.lastAt || '')) || personName(a.s).localeCompare(personName(b.s)));
    if (isFamily() && !current && !picked && kids.length) current = kids[0].id;
    if (kids.length) picked = true;
    if (current && !store.isOpen(messagesName(current))) store.open([messagesName(current)]);
    const list = h(
      'div.inbox-list',
      !isFamily() || kids.length > 1
        ? h(
            'div.inbox-tools',
            searchBox({ value: q, placeholder: 'Search by child', onInput: (v) => ((q = v), body.redraw()) }),
            !isFamily() ? h('label.check.inline.small', h('input', { type: 'checkbox', checked: unreadOnly, onChange: (e) => ((unreadOnly = e.target.checked), body.redraw()) }), h('span', 'Unread only')) : null,
          )
        : null,
      h(
        'ul.threads',
        { 'aria-label': 'Conversations' },
        rows.slice(0, 300).map(({ s, t }) => {
          const unread = isUnread(t, who());
          return h(
            'li',
            h(
              `a.thread-item${current === s.id ? '.active' : ''}${unread ? '.unread' : ''}`,
              { href: `#/messages/${s.id}`, 'aria-current': current === s.id ? 'true' : null, onClick: (e) => (e.preventDefault(), openThread(s.id)) },
              childAvatar(s),
              h('span.thread-text', h('span.thread-top', h('span.thread-name', isFamily() ? `${firstName(s)}'s teachers` : personName(s)), t?.lastAt ? h('time.thread-time', timeAgo(t.lastAt)) : null), h('span.thread-preview', t?.lastText ? `${t.lastFrom === (isFamily() ? 'family' : 'staff') ? 'You: ' : ''}${t.lastText}` : 'No messages yet')),
              unread ? h('span.unread-dot', h('span.sr-only', 'Unread')) : null,
            ),
          );
        }),
      ),
      !rows.length ? h('p.subtle.pick-empty', unreadOnly ? 'No unread conversations.' : 'No conversations.') : null,
    );
    return h(`div.inbox${current ? '.has-thread' : ''}`, list, h('div.thread-pane', current ? threadView(current) : emptyState({ icon: 'messages', title: 'Choose a conversation', text: 'Each child has one conversation shared by their family and your staff.', compact: true })));
  }

  function openThread(id) {
    current = id;
    history.replaceState(null, '', `#/messages/${id}`);
    store.open([messagesName(id)]);
    body.redraw();
  }

  function threadView(sid) {
    const s = store.get('students', sid);
    // The school server never sends a family other children, but the family demo holds the whole sample school.
    if (!s || (isFamily() && !myStudents().some((k) => k.id === sid))) return emptyState({ icon: 'search', title: 'Conversation not found', compact: true });
    const name = messagesName(sid);
    const loaded = store.isOpen(name);
    const msgs = sortMessages(store.all(name));
    const t = store.get('threads', sid);
    if (loaded && isUnread(t, who())) queueMicrotask(() => markRead(store, sid, who()));
    const fam = guardiansOf(store.all('guardians'), sid).filter((g) => !g.pickupOnly);
    const canSend = !isFamily() || app.settings().access?.parentsCanMessage !== false;
    let lastDay = '';
    const log = h(
      'div.msg-log',
      { role: 'log', 'aria-label': `Conversation about ${personName(s)}`, 'aria-live': 'polite' },
      !loaded
        ? h('div.skeleton-feed', h('div.skeleton'), h('div.skeleton'))
        : msgs.length
          ? msgs.map((m) => {
              const when = new Date(m.at);
              const day = toISODate(when);
              const mine = isFamily() ? m.from === 'family' && (!m.authorUuid || m.authorUuid === app.user?.uuid || app.demo) : m.from === 'staff';
              const sep = day !== lastDay ? h('div.msg-day', formatDate(day, { weekday: 'long', month: 'short', day: 'numeric' })) : null;
              lastDay = day;
              return [
                sep,
                h(
                  `div.msg${mine ? '.mine' : ''}`,
                  h('div.msg-meta', h('span', m.author || (m.from === 'staff' ? 'Staff' : 'Family')), h('time', formatTime(when.toTimeString().slice(0, 5)))),
                  m.text ? h('div.msg-bubble', m.text) : null,
                  m.media?.length ? mediaGrid(m.media, { ref: name, id: m.id }) : null,
                ),
              ];
            })
          : h('div.msg-empty', h('p', isFamily() ? `Send a note to ${firstName(s)}'s teachers.` : `Start the conversation with ${firstName(s)}'s family.`), !isFamily() && fam.length ? h('p.subtle.small', `${fam.map((g) => personName(g)).join(', ')} will see it${fam.some((g) => g.memberUuid) ? '' : ' once they join the family app'}.`) : null),
    );
    // Stay where the reader is, unless they were at the end or just sent something.
    // A log redrawn before its own scroll ran (the next frame can come first) passes on where it was headed.
    const prev = lastLog?.sid === sid && lastLog.count && lastLog.el.isConnected ? lastLog : null;
    const atEnd = !prev || (prev.pending ? prev.top === null : prev.el.scrollHeight - prev.el.scrollTop - prev.el.clientHeight < 48);
    const sentNow = prev && msgs.length > prev.count && msgs[msgs.length - 1].from === (isFamily() ? 'family' : 'staff');
    const keepTop = prev && !atEnd && !sentNow ? (prev.pending ? prev.top : prev.el.scrollTop) : null;
    const entry = (lastLog = { sid, el: log, count: loaded ? msgs.length : 0, top: keepTop, pending: true });
    setTimeout(() => {
      log.scrollTop = keepTop ?? log.scrollHeight;
      entry.pending = false;
    }, 0);
    return h(
      'section.thread',
      h(
        'header.thread-head',
        h('button.icon-btn.show-mobile', { type: 'button', 'aria-label': 'Back to conversations', onClick: () => ((current = null), history.replaceState(null, '', '#/messages'), body.redraw()) }, icon('arrow-left')),
        childAvatar(s),
        h('div.grow', h('h2', isFamily() ? `${firstName(s)}'s teachers` : personName(s)), h('p.subtle.small', isFamily() ? store.get('rooms', s.roomId)?.name || '' : fam.map((g) => `${personName(g)}${g.relation ? ` (${g.relation})` : ''}`).join(', ') || 'No family members on file')),
        !isFamily() ? h('a.btn.sm.ghost', { href: `#/children/${sid}` }, 'Profile') : null,
      ),
      log,
      canSend ? composerFor(sid) : h('p.subtle.small.card-pad', 'Messaging is turned off by the school.'),
    );
  }

  function composerFor(sid) {
    if (draft?.sid !== sid) draft = { sid, node: composer(sid) };
    return draft.node;
  }

  function composer(sid) {
    const input = h('textarea.textarea.msg-input', { rows: 1, placeholder: 'Write a message', 'aria-label': 'Message' });
    const files = [];
    const previews = h('div.upload-previews');
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    const drawPrev = () =>
      previews.replaceChildren(
        ...files.map((f, i) => {
          const url = URL.createObjectURL(f);
          return h('span.upload-thumb', h('img', { src: url, alt: '', onLoad: () => URL.revokeObjectURL(url) }), h('button.icon-btn.xs', { type: 'button', 'aria-label': `Remove ${f.name}`, onClick: () => (files.splice(i, 1), drawPrev()) }, icon('x', 13)));
        }),
      );
    fileInput.addEventListener('change', () => {
      files.push(...[...fileInput.files].filter((f) => isImage(f.type)).slice(0, 6));
      fileInput.value = '';
      drawPrev();
    });
    const send = h('button.btn.primary', { type: 'submit', 'aria-label': 'Send' }, icon('send', 16), h('span.hide-mobile', 'Send'));
    const form = h('form.composer', previews, h('div.composer-row', h('button.icon-btn', { type: 'button', 'aria-label': 'Attach photos', onClick: () => fileInput.click() }, icon('camera')), fileInput, input, send));
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    let sending = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // Enter calls requestSubmit, which a disabled Send button does not stop.
      if (sending) return;
      const text = input.value.trim();
      const sent = [...files];
      if (!text && !sent.length) return;
      sending = true;
      send.disabled = true;
      try {
        const media = [];
        for (const f of sent) media.push(await saveFile(f, { area: 'messages', owner: sid }));
        sendMessage(store, { studentId: sid, text, from: isFamily() ? 'family' : 'staff', author: myName(), authorUuid: app.user?.uuid || '', media });
        // Keep anything typed or attached while the photos were uploading.
        if (input.value.trim() === text) {
          input.value = '';
          input.style.height = '';
        }
        // A sent photo may already have been taken out with its remove button.
        for (const f of sent) if (files.includes(f)) files.splice(files.indexOf(f), 1);
        drawPrev();
      } catch (err) {
        toast(err.message || 'The message could not be sent.', { type: 'error' });
      } finally {
        sending = false;
        send.disabled = false;
      }
    });
    setTimeout(() => !matchMedia('(max-width: 767px)').matches && input.focus(), 0);
    return form;
  }

  async function newConversation() {
    const ids = await pickChildren({ title: 'Message a family', onlyIn: false });
    if (ids?.length) openThread(ids[0]);
  }

  async function sendToMany() {
    const ids = await pickChildren({ title: 'Choose families to message', onlyIn: false });
    if (!ids?.length) return;
    const text = textarea({ rows: 5, placeholder: 'Your message', required: true });
    openDialog({
      title: `Message ${pluralize(ids.length, 'family', 'families')}`,
      body: h('div.stack', h('p.subtle.small', 'Each family gets this in their own private conversation. Replies come back to that conversation.'), field('Message', text)),
      footer: ({ close }) => [
        h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
        h(
          'button.btn.primary',
          {
            type: 'button',
            onClick: () => {
              const body = text.value.trim();
              if (!body) return text.focus();
              for (const sid of ids) sendMessage(store, { studentId: sid, text: body, from: 'staff', author: myName(), authorUuid: app.user?.uuid || '' });
              toast(`Sent to ${pluralize(ids.length, 'family', 'families')}`);
              close();
            },
          },
          'Send',
        ),
      ],
    });
  }

  return h('div.page.wide-page.messages-page', header, body);
}

// ---- Announcements ----------------------------------------------------------------

function announcements(ctx) {
  const store = app.store;
  const kidsRooms = new Set(myStudents().map((s) => s.roomId));
  const list = store
    .all('announcements')
    .filter((a) => !isFamily() || !a.roomIds?.length || a.roomIds.some((r) => kidsRooms.has(r)))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.at).localeCompare(String(a.at)));
  if (!list.length) return emptyState({ icon: 'megaphone', title: 'No announcements', text: isFamily() ? 'News from the school appears here.' : 'Post closures, reminders, and news for everyone or for one room.', actions: isFamily() ? null : [h('button.btn.primary', { type: 'button', onClick: () => openAnnouncementForm() }, 'New announcement')] });
  const focus = ctx.query.id;
  // Once per visit: a later redraw (any sync) must not pull the reader back.
  if (focus && ctx.scrolledTo !== focus) {
    ctx.scrolledTo = focus;
    setTimeout(() => document.getElementById(`ann-${focus}`)?.scrollIntoView({ block: 'center' }), 50);
  }
  return h(
    'div.announcements',
    list.map((a) =>
      h(
        `article.announcement${a.pinned ? '.pinned' : ''}`,
        { id: `ann-${a.id}` },
        h(
          'header',
          h('h2', a.pinned ? h('span.pin-flag', icon('pin', 14), h('span.sr-only', 'Pinned')) : null, a.title),
          !isFamily()
            ? h(
                'div.row',
                h('button.icon-btn.sm', { type: 'button', 'aria-label': `Edit ${a.title}`, onClick: () => openAnnouncementForm(a) }, icon('pencil', 15)),
                h('button.icon-btn.sm', { type: 'button', 'aria-label': `Delete ${a.title}`, onClick: async () => (await confirmDialog({ title: 'Delete this announcement?', message: a.title, confirmLabel: 'Delete', danger: true })) && store.remove('announcements', a.id) }, icon('trash', 15)),
              )
            : null,
        ),
        h('p.ann-meta', [a.author, a.at ? timeAgo(a.at) : ''].filter(Boolean).join(' · '), ' ', a.roomIds?.length ? a.roomIds.map((r) => roomDot(store.get('rooms', r))) : pill('Everyone', 'plain')),
        h('p.ann-body', a.body),
      ),
    ),
  );
}

export function openAnnouncementForm(existing = null) {
  const store = app.store;
  const a = structuredClone(existing || { title: '', body: '', roomIds: [], pinned: false });
  const rooms = new Set(a.roomIds || []);
  const title = textInput({ value: a.title, required: true, placeholder: 'Closed Monday for staff training' });
  const body = textarea({ value: a.body, rows: 6 });
  const pinned = h('input', { type: 'checkbox', checked: !!a.pinned });
  openDialog({
    title: existing ? 'Edit announcement' : 'New announcement',
    size: 'wide',
    body: h(
      'div.stack',
      field('Title', title, { required: true }),
      field('Message', body),
      h('div.field', h('span.field-label', 'Who sees it'), h('div.check-grid', sortRooms(store.all('rooms')).map((r) => {
        const c = h('input', { type: 'checkbox', checked: rooms.has(r.id), onChange: () => (c.checked ? rooms.add(r.id) : rooms.delete(r.id)) });
        return h('label.check', c, roomDot(r));
      })), h('span.hint', 'Leave all unchecked to share with every family.')),
      h('label.check', pinned, h('span', 'Pin to the top')),
    ),
    footer: ({ close }) => [
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            if (!title.value.trim()) return title.focus();
            store.put('announcements', { ...a, title: title.value.trim(), body: body.value.trim(), roomIds: [...rooms], pinned: pinned.checked, author: a.author || myName(), at: a.at || new Date().toISOString() });
            toast(existing ? 'Announcement saved' : 'Announcement posted');
            close();
            if (!existing) navigate('/messages?tab=announcements');
          },
        },
        existing ? 'Save' : 'Post',
      ),
    ],
  });
}

