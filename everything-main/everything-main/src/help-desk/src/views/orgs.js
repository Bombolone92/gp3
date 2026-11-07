/**
 * Organizations: the companies your customers belong to. Customers whose
 * email domain matches an organization join it automatically.
 */
import { h, clear, uid, debounce, preserveFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import { tagsInput, field, emptyState } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { relTime, fullDate, plural } from '../ui/format.js';
import { go } from '../ui/router.js';
import { bind } from '../ui/shortcuts.js';
import { normDomain } from '../shared/model.js';
import { app } from '../app.js';
import { ticketCounts, memberCounts } from './people-data.js';
import { dataTable, orgMark } from './people-ui.js';

export function mount(main, { route }) {
  let query = route.query.q || '';
  let counts = ticketCounts(app.replica.tickets.values());
  let members = memberCounts(app.replica.users.values());

  const searchId = uid('org-q');
  const search = h(`input#${searchId}.input`, { type: 'search', placeholder: 'Search by name, domain or tag', value: query, autocomplete: 'off', 'aria-label': 'Search organizations' });
  const titleSub = h('p.page-sub', { role: 'status', 'aria-live': 'polite' });
  const table = dataTable({
    label: 'Organizations',
    href: (o) => `#/orgs/${o.id}`,
    onOpen: (o) => go(`/orgs/${o.id}`),
    sort: { id: 'name', dir: 'asc' },
    columns: [
      { id: 'name', label: 'Name', sort: (o) => o.name, render: (o) => h('a.row-link.org-cell', { href: `#/orgs/${o.id}`, tabindex: '-1' }, orgMark(o.name, 'sm'), h('span.ellipsis.person-name', o.name)) },
      { id: 'domains', label: 'Domains', cls: 'hide-sm', width: 220, sort: (o) => (o.domains || [])[0] || '', render: (o) => ((o.domains || []).length ? h('span.ellipsis.mono-ish', o.domains.join(', ')) : h('span.subtle', '-')) },
      { id: 'members', label: 'Customers', numeric: true, width: 110, defaultDir: 'desc', sort: (o) => members.get(o.id) || 0, render: (o) => h('span', String(members.get(o.id) || 0)) },
      { id: 'open', label: 'Open tickets', numeric: true, width: 120, defaultDir: 'desc', sort: (o) => counts.byOrg.get(o.id)?.open || 0, render: (o) => {
        const n = counts.byOrg.get(o.id)?.open || 0;
        return n ? h('span.open-count', String(n)) : h('span.subtle', '0');
      } },
      { id: 'updated', label: 'Updated', cls: 'hide-md', width: 130, defaultDir: 'desc', sort: (o) => o.updatedAt || 0, render: (o) => h('span', { title: fullDate(o.updatedAt) }, relTime(o.updatedAt)) },
    ],
  });
  const emptyEl = h('div.people-empty');
  main.append(h('div.page.people-page',
    h('div.people-main.people-wide',
      h('header.people-head',
        h('div.people-title', h('h1', 'Organizations'), titleSub),
        h('div.people-actions',
          h('a.btn', { href: '#/customers' }, icon('users', { size: 15 }), h('span.btn-text', 'Customers')),
          h('button.btn.btn-primary', { type: 'button', onclick: () => newOrgDialog() }, icon('plus', { size: 15 }), h('span.btn-text', 'Add organization')))),
      h('div.people-tools', h('div.search-input', icon('search', { size: 15 }), search)),
      table.el,
      emptyEl)));

  function list() {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return [...app.replica.orgs.values()].filter((o) => {
      if (!words.length) return true;
      const hay = `${o.name} ${(o.domains || []).join(' ')} ${(o.tags || []).join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  function refresh() {
    const rows = list();
    titleSub.textContent = query ? `${plural(rows.length, 'organization')} matching "${query}"` : plural(rows.length, 'organization');
    table.update(rows);
    table.el.hidden = !rows.length;
    clear(emptyEl);
    if (!rows.length) {
      emptyEl.append(query
        ? emptyState({ glyph: 'search', title: 'No organizations match your search', action: h('button.btn', { type: 'button', onclick: () => { search.value = ''; query = ''; sync(); refresh(); search.focus(); } }, 'Clear search') })
        : emptyState({ glyph: 'building', title: 'No organizations yet', text: 'Group customers by company to see all of a company\'s requests in one place. Add email domains and new customers join automatically.', action: h('button.btn.btn-primary', { type: 'button', onclick: () => newOrgDialog() }, icon('plus', { size: 14 }), 'Add organization') }));
    }
  }

  function sync() {
    history.replaceState(null, '', `#/orgs${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  }

  const onSearch = debounce(() => {
    query = search.value.trim();
    sync();
    refresh();
  }, 120);
  search.addEventListener('input', onSearch);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      table.focusFirst();
    }
  });
  const onChange = (e) => {
    const k = e.detail?.kinds;
    if (!k || k.has('o') || k.has('u') || k.has('t')) {
      counts = ticketCounts(app.replica.tickets.values());
      members = memberCounts(app.replica.users.values());
      preserveFocus(main, () => refresh());
    }
  };
  app.replica.addEventListener('change', onChange);
  const unbind = bind('orgs', { '/': () => search.focus(), j: () => table.focusFirst() });
  refresh();
  document.title = 'Organizations - Help Desk';
  return () => {
    app.replica.removeEventListener('change', onChange);
    unbind();
    table.destroy();
    document.title = 'Help Desk';
  };
}

/** Add an organization. Resolves to the created organization or null. */
export function newOrgDialog({ navigate = true } = {}) {
  return new Promise((resolve) => {
    const ids = { name: uid('on'), domains: uid('od'), tags: uid('ot'), notes: uid('onotes') };
    const nameIn = h(`input#${ids.name}.input`, { maxlength: 120, autocomplete: 'organization', placeholder: 'Northwind Traders' });
    let domains = [];
    let tags = [];
    const domainsEl = tagsInput({ id: ids.domains, label: 'Email domains', placeholder: 'example.com', normalize: normDomain, onChange: (v) => { domains = v; } });
    const tagsEl = tagsInput({ id: ids.tags, label: 'Tags', placeholder: 'Add tags', onChange: (v) => { tags = v; } });
    const notesIn = h(`textarea#${ids.notes}.textarea`, { rows: 3, maxlength: 4000 });
    const nameErr = h('p.field-error', { role: 'alert' });
    const formId = uid('new-org');
    let created = null;
    let dlg = null;
    const form = h(`form#${formId}.stack`, {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        const name = nameIn.value.trim();
        if (!name) {
          nameErr.textContent = 'Give the organization a name';
          nameIn.setAttribute('aria-invalid', 'true');
          nameIn.focus();
          return;
        }
        const pending = domainsEl.querySelector('input').value.trim();
        if (pending && normDomain(pending) && !domains.includes(normDomain(pending))) domains.push(normDomain(pending));
        const btn = dlg.el.querySelector('.dialog-foot .btn-primary');
        btn.disabled = true;
        try {
          const res = await app.api.post('/orgs', { name, domains, tags, notes: notesIn.value });
          app.replica.upsert('o', res.org);
          created = res.org;
          dlg.close('created');
          toast(`${res.org.name} was added.`, { kind: 'success' });
          if (navigate) go(`/orgs/${res.org.id}`);
        } catch (err) {
          nameErr.textContent = err.message;
          btn.disabled = false;
        }
      },
    },
    field('Name', nameIn, { id: ids.name, error: nameErr }),
    field('Email domains', domainsEl, { id: ids.domains, hint: 'Customers with an email address at these domains join this organization automatically.' }),
    field('Tags', tagsEl, { id: ids.tags }),
    field('Notes', notesIn, { id: ids.notes }));
    dlg = openDialog({
      title: 'Add organization',
      body: form,
      actions: [{ label: 'Cancel' }, { label: 'Add organization', primary: true, submit: true, form: formId }],
      onClose: () => resolve(created),
      initialFocus: `#${ids.name}`,
    });
  });
}
