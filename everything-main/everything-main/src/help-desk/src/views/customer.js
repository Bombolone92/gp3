/**
 * Customer profile: who they are, their requests and how support has gone
 * for them. Details save as you edit them.
 */
import { h, clear, uid, preserveFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu } from '../ui/popover.js';
import { confirmDialog } from '../ui/dialog.js';
import { avatar, statusBadge, priorityLabel, selectField, tagsInput, field, emptyState, spinner } from '../ui/components.js';
import { toast, toastError } from '../ui/toast.js';
import { relTime, fullDate, shortDate, plural, localTimeIn, timeZones } from '../ui/format.js';
import { go } from '../ui/router.js';
import { isUnsolved, STATUS_LABEL } from '../shared/model.js';
import { app } from '../app.js';
import { satisfaction } from './people-data.js';
import { dataTable, saveStatus, orgOptions, localeOptions, tzOptions, segmented } from './people-ui.js';

export function mount(main, { id }) {
  const page = h('div.page.profile-page');
  main.append(page);
  let tab = 'tickets';
  let table = null;
  let lastPaint = null;
  let shown = new Set();
  let head = null;
  let headStatus = null;

  function user() {
    return app.replica.users.get(id) || null;
  }

  function tickets() {
    return app.replica.ticketsFor((t) => t.requester === id && !t.deleted && !t.spam).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function paint() {
    const u = user();
    clear(page);
    table?.destroy();
    table = null;
    if (!u && app.replica.status !== 'live') {
      page.append(h('div.page-inner.profile-loading', spinner('Loading customer')));
      return;
    }
    if (!u) {
      page.append(h('div.page-inner', emptyState({
        glyph: 'user', title: 'Customer not found',
        text: 'This customer may have been deleted, or the link is wrong.',
        action: h('a.btn', { href: '#/customers' }, icon('arrow-left', { size: 14 }), 'All customers'),
      })));
      document.title = 'Customer not found - Help Desk';
      return;
    }
    document.title = `${u.name} - Help Desk`;
    lastPaint = JSON.stringify(u);
    const list = tickets();
    shown = new Set(list.map((t) => t.id));
    const open = list.filter((t) => isUnsolved(t.status)).length;
    const status = saveStatus();
    headStatus = status;

    /* Header */
    const header = profileHead(u, status);

    /* Stats */
    const csat = satisfaction(list);
    const stats = h('div.profile-stats', { role: 'list', 'aria-label': 'Summary' },
      stat('Open tickets', open),
      stat('All tickets', list.length),
      stat('Satisfaction', csat.percent === null ? '-' : `${csat.percent}%`, csat.rated ? plural(csat.rated, 'rating') : 'No ratings'),
      stat('Customer since', shortDate(u.createdAt)));

    /* Tickets / activity */
    const body = h('div.profile-tab');
    const seg = segmented({
      label: 'Customer sections',
      value: tab,
      items: [{ value: 'tickets', label: `Requests (${list.length})` }, { value: 'activity', label: 'Activity' }],
      onChange: (v) => {
        tab = v;
        paintTab();
      },
    });
    function paintTab() {
      clear(body);
      table?.destroy();
      table = null;
      if (tab === 'tickets') {
        if (!list.length) {
          body.append(emptyState({ glyph: 'inbox', title: 'No requests yet', text: `Tickets ${u.name} asks for will show up here.`, action: h('button.btn', { type: 'button', onclick: newTicket }, icon('plus', { size: 14 }), 'New ticket') }));
          return;
        }
        table = ticketList(list);
        body.append(table.el);
        table.update(list);
      } else body.append(activity(u, list));
    }
    paintTab();

    /* Details panel */
    const details = detailsPanel(u, status);

    page.append(h('div.profile-inner', header, h('div.profile-grid', h('section.profile-main', { 'aria-label': 'Requests and activity' }, stats, h('div.profile-tabs', seg), body), details)));
  }

  /** The header: name, contact details and actions. Repainted on its own after a save. */
  function profileHead(u, status) {
    const org = u.org ? app.replica.orgs.get(u.org) : null;
    const moreBtn = h('button.btn.icon-only', { type: 'button', 'aria-label': 'More actions', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openMenu(moreBtn, [
      { label: u.suspended ? 'Unsuspend' : 'Suspend', icon: u.suspended ? 'circle-check' : 'ban', desc: u.suspended ? 'Accept their requests again' : 'Quietly file their new requests as spam', run: () => setSuspended(!u.suspended) },
      u.email ? { label: 'Copy email address', icon: 'copy', run: () => { navigator.clipboard?.writeText(u.email); toast('Email address copied.'); } } : null,
      app.isAdmin ? { separator: true } : null,
      app.isAdmin ? { label: 'Delete customer', icon: 'trash', danger: true, run: remove } : null,
    ], { align: 'end', label: 'Customer actions' }) }, icon('ellipsis', { size: 18 }));
    head = h('header.profile-head',
      h('a.back-link', { href: '#/customers' }, icon('arrow-left', { size: 15 }), 'Customers'),
      h('div.profile-id',
        avatar(u.name, { size: 'xl' }),
        h('div.profile-name',
          h('h1', u.name, u.suspended ? h('span.badge.badge-danger', 'Suspended') : null),
          h('div.profile-sub',
            u.email ? h('a', { href: `mailto:${u.email}` }, icon('mail', { size: 14 }), u.email) : null,
            org ? h('a', { href: `#/orgs/${org.id}` }, icon('building', { size: 14 }), org.name) : null,
            u.tz ? h('span', icon('clock', { size: 14 }), `${localTimeIn(u.tz)} local time`) : null)),
        h('div.profile-actions',
          status,
          h('button.btn.btn-primary', { type: 'button', onclick: newTicket }, icon('plus', { size: 15 }), h('span.btn-text', 'New ticket')),
          moreBtn)),
    );
    return head;
  }

  function stat(label, value, sub = '') {
    return h('div.pstat', { role: 'listitem' }, h('div.pstat-value', String(value)), h('div.pstat-label', label), sub ? h('div.pstat-sub', sub) : null);
  }

  function newTicket() {
    app.drafts.set('new', { ...(app.drafts.get('new') || {}), requester: id });
    go('/tickets/new');
  }

  async function save(patch, status) {
    status?.set('saving');
    try {
      const res = await app.api.post(`/users/${id}`, patch);
      lastPaint = JSON.stringify(res.user);
      app.replica.upsert('u', res.user);
      status?.set('saved');
      // The rest of the page is left alone while it is being edited, but the
      // header and title follow the saved name, email and organization at once.
      if (head?.isConnected) {
        document.title = `${res.user.name} - Help Desk`;
        const old = head;
        preserveFocus(old.parentNode, () => old.replaceWith(profileHead(res.user, headStatus)));
      }
      return res.user;
    } catch (e) {
      status?.set('error', e.message);
      throw e;
    }
  }

  async function setSuspended(on) {
    try {
      await save({ suspended: on });
      toast(on ? 'Customer suspended. Their new requests go to Suspended tickets.' : 'Customer unsuspended.', { kind: 'success' });
      paint();
    } catch (e) {
      toastError(e);
    }
  }

  async function remove() {
    const u = user();
    // Tickets in the trash count too: the server keeps the customer until
    // those are deleted for good.
    const count = app.replica.ticketsFor((t) => t.requester === id).length;
    if (count) {
      await confirmDialog({
        title: 'This customer has tickets',
        message: `${u.name} has ${plural(count, 'ticket')}. Delete those tickets for good (from Deleted tickets) or change their requester before deleting this customer.`,
        confirmLabel: 'Got it',
        cancelLabel: 'Close',
      });
      return;
    }
    const ok = await confirmDialog({ title: `Delete ${u.name}?`, message: 'Their profile and notes will be removed. This cannot be undone.', confirmLabel: 'Delete customer', danger: true });
    if (!ok) return;
    try {
      await app.api.del(`/users/${id}`);
      app.replica.drop('u', id);
      toast(`${u.name} was deleted.`, { kind: 'success' });
      go('/customers');
    } catch (e) {
      toastError(e);
    }
  }

  function detailsPanel(u, status) {
    const ids = { name: uid('n'), email: uid('e'), phone: uid('p'), org: uid('o'), tz: uid('tz'), locale: uid('l'), tags: uid('t'), notes: uid('notes') };
    const emailErr = h('p.field-error', { role: 'alert' });
    const nameErr = h('p.field-error', { role: 'alert' });
    const text = (key, type, idKey, err) => {
      const input = h(`input#${ids[idKey]}.input`, { type, value: u[key] || '', maxlength: key === 'email' ? 254 : key === 'phone' ? 40 : 120, autocomplete: 'off' });
      input.addEventListener('change', async () => {
        const v = input.value.trim();
        if ((u[key] || '') === v) {
          // Back to the saved value: an error from a failed save no longer applies.
          if (err) err.textContent = '';
          input.removeAttribute('aria-invalid');
          return;
        }
        if (key === 'name' && !v) {
          err.textContent = 'A customer needs a name';
          input.setAttribute('aria-invalid', 'true');
          input.value = u.name;
          return;
        }
        if (err) err.textContent = '';
        input.removeAttribute('aria-invalid');
        try {
          const saved = await save({ [key]: v }, status);
          u = saved;
        } catch (e) {
          if (err) err.textContent = e.message;
          input.setAttribute('aria-invalid', 'true');
        }
      });
      return input;
    };
    const tzSel = selectField({ id: ids.tz, value: u.tz || null, options: () => tzOptions(timeZones()), label: 'Time zone', placeholder: 'Not set', onChange: (v) => save({ tz: v }, status).catch(() => {}) });
    const localeSel = selectField({ id: ids.locale, value: u.locale || null, options: localeOptions, label: 'Language', placeholder: 'Not set', onChange: (v) => save({ locale: v }, status).catch(() => {}) });
    const orgSel = selectField({ id: ids.org, value: u.org || null, options: orgOptions, label: 'Organization', placeholder: 'No organization', onChange: (v) => save({ org: v }, status).catch(() => {}) });
    const tags = tagsInput({ id: ids.tags, value: u.tags || [], label: 'Tags', placeholder: 'Add tags', onChange: (v) => save({ tags: v }, status).catch(() => {}), suggestions: () => [...new Set([...app.replica.users.values()].flatMap((x) => x.tags || []))].sort() });
    const notes = h(`textarea#${ids.notes}.textarea`, { rows: 5, maxlength: 4000, placeholder: 'Notes are visible to your team, never to the customer' }, u.notes || '');
    notes.addEventListener('change', () => save({ notes: notes.value }, status).catch(() => {}));
    return h('aside.profile-details', { 'aria-label': 'Customer details' },
      h('div.card',
        h('div.card-head', h('h2', 'Details')),
        h('div.card-body.stack',
          field('Name', text('name', 'text', 'name', nameErr), { id: ids.name, error: nameErr }),
          field('Email', text('email', 'email', 'email', emailErr), { id: ids.email, error: emailErr }),
          field('Phone', text('phone', 'tel', 'phone'), { id: ids.phone }),
          field('Organization', orgSel, { id: ids.org }),
          field('Time zone', tzSel, { id: ids.tz }),
          field('Language', localeSel, { id: ids.locale }),
          field('Tags', tags, { id: ids.tags }),
          field('Notes', notes, { id: ids.notes }),
          h('p.field-hint', `Added ${fullDate(u.createdAt)}. Changes save automatically.`))));
  }

  function ticketList(list) {
    return dataTable({
      label: 'Requests',
      href: (t) => `#/tickets/${t.id}`,
      onOpen: (t) => go(`/tickets/${t.id}`),
      sort: { id: 'updated', dir: 'desc' },
      columns: [
        { id: 'status', label: 'Status', width: 92, sort: (t) => Object.keys(STATUS_LABEL).indexOf(t.status), render: (t) => statusBadge(t.status) },
        { id: 'subject', label: 'Subject', sort: (t) => t.subject, render: (t) => h('a.row-link.subject-link', { href: `#/tickets/${t.id}`, tabindex: '-1' }, h('span.ellipsis', t.subject), h('span.subtle.mono', ` #${t.id}`)) },
        { id: 'priority', label: 'Priority', cls: 'hide-sm', width: 100, sort: (t) => ({ low: 1, normal: 2, high: 3, urgent: 4 }[t.priority] || 0), defaultDir: 'desc', render: (t) => priorityLabel(t.priority) },
        { id: 'assignee', label: 'Assignee', cls: 'hide-md', width: 160, sort: (t) => app.memberName(t.assignee), render: (t) => (t.assignee ? h('span.ellipsis', app.memberName(t.assignee)) : h('span.subtle', 'Unassigned')) },
        { id: 'updated', label: 'Updated', cls: 'hide-sm', width: 120, defaultDir: 'desc', sort: (t) => t.updatedAt, render: (t) => h('span', { title: fullDate(t.updatedAt) }, relTime(t.updatedAt)) },
      ],
    });
  }

  function activity(u, list) {
    const events = [];
    events.push({ at: u.createdAt, icon: 'user-plus', text: 'Became a customer' });
    for (const t of list) {
      events.push({ at: t.createdAt, icon: 'inbox', text: h('span', 'Requested ', h('a', { href: `#/tickets/${t.id}` }, t.subject)) });
      if (t.solvedAt) events.push({ at: t.solvedAt, icon: 'circle-check', text: h('span', 'Request solved: ', h('a', { href: `#/tickets/${t.id}` }, t.subject)) });
      if (t.csat?.at) events.push({ at: t.csat.at, icon: t.csat.score === 'good' ? 'thumbs-up' : 'thumbs-down', text: h('span', `Rated support ${t.csat.score === 'good' ? 'good' : 'bad'}`, t.csat.comment ? h('span.muted', `: "${t.csat.comment}"`) : '') });
    }
    events.sort((a, b) => b.at - a.at);
    return h('ol.timeline', { 'aria-label': 'Activity' }, events.slice(0, 100).map((e) => h('li.tl-item',
      h('span.tl-icon', icon(e.icon, { size: 14 })),
      h('div.tl-body', h('div', e.text), h('time.subtle', { datetime: new Date(e.at).toISOString(), title: fullDate(e.at) }, relTime(e.at))))));
  }

  const onChange = (e) => {
    const k = e.detail?.kinds;
    if (k && !k.has('u') && !k.has('t') && !k.has('o')) return;
    const u = user();
    const focused = document.activeElement;
    const editing = focused && page.contains(focused) && /INPUT|TEXTAREA/.test(focused.tagName);
    // Repaint for changes made elsewhere, but never under someone's cursor.
    if (editing) return;
    if (k?.has('u') && !k.has('t') && u && JSON.stringify(u) === lastPaint) return;
    // Only this customer, their organization and their tickets matter here.
    const ids = e.detail?.ids;
    if (ids && !ids.u?.has(id) && !(u?.org && ids.o?.has(u.org))
      && ![...(ids.t || [])].some((tid) => shown.has(tid) || app.replica.tickets.get(tid)?.requester === id)) return;
    preserveFocus(page, paint);
  };
  app.replica.addEventListener('change', onChange);
  paint();
  return () => {
    app.replica.removeEventListener('change', onChange);
    table?.destroy();
    document.title = 'Help Desk';
  };
}
