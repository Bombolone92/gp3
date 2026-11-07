/**
 * Shared editor for quotes and invoices: client, title, details, line items,
 * totals, client-facing message, and internal notes.
 *
 * config: {
 *   coll: 'quotes' | 'invoices',
 *   noun: 'quote' | 'invoice',
 *   blank(query) -> draft,
 *   detailsFields(draft, markDirty) -> node[],
 *   titleKey: 'title' | 'subject',
 *   showDeposit, allowOptional,
 *   create(store, draft) -> Promise<record>,
 * }
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, field, textInput, textarea, emptyState } from '../ui/components.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { clientPicker, propertySelect, lineItemsEditor, totalsBlock } from './common.js';
import { applyEdits } from '../core/workflow.js';

export function renderDocForm(ctx, config) {
  const store = app.store;
  const { coll, noun } = config;
  const Noun = noun[0].toUpperCase() + noun.slice(1);
  const existing = ctx.params.id ? store.get(coll, ctx.params.id) : null;
  if (ctx.params.id && !existing) {
    return h('div.page', emptyState({ icon: 'file', title: `${Noun} not found`, headingLevel: 1, actions: [h('a.btn.primary', { href: `#/${coll}` }, `Back to ${coll}`)] }));
  }
  const draft = existing ? structuredClone(existing) : config.blank(ctx.query);
  draft.items ??= [];
  let saved = false;
  const titleKey = config.titleKey || 'title';

  // ---- Client -------------------------------------------------------------
  const propWrap = h('div');
  const drawProperty = () => {
    const client = lookup.client(draft.clientId);
    const sel = propertySelect(client, draft.propertyId, (v) => (draft.propertyId = v));
    propWrap.replaceChildren(...(sel ? [field('Property', sel)] : []));
  };
  const clientError = h('span.error-text', { role: 'alert', hidden: true }, `Choose who this ${noun} is for.`);
  const picker = clientPicker({
    value: draft.clientId,
    autofocus: !existing && !draft.clientId,
    onChange: (c) => {
      draft.clientId = c?.id || null;
      draft.propertyId = c?.properties?.[0]?.id || null;
      clientError.hidden = true;
      drawProperty();
    },
  });
  drawProperty();

  const titleInput = textInput({ value: draft[titleKey] || '', placeholder: config.titlePlaceholder || 'e.g. Spring cleanup', autofocus: (existing || draft.clientId) ? true : null });
  titleInput.addEventListener('input', () => (draft[titleKey] = titleInput.value));

  const clientCard = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Client')),
    h('div.card-body.stack', h('div.field', h('span.field-label#client-label', 'Client'), picker, clientError), propWrap, field(config.titleLabel || 'Title', titleInput)),
  );

  const detailsCard = h('section.card', h('div.card-head', h('h2.grow', `${Noun} details`)), h('div.card-body.stack', config.detailsFields(draft)));

  // ---- Items and totals ---------------------------------------------------
  const totals = totalsBlock(draft, { editable: true, showDeposit: !!config.showDeposit, onChange: () => {} });
  const items = lineItemsEditor(draft, {
    allowOptional: !!config.allowOptional,
    onChange: () => totals.refresh(),
  });
  const itemsCard = h('section.card', h('div.card-head', h('h2.grow', 'Products and services')), h('div.card-body.flush', items, h('hr.divider'), totals));

  // ---- Messages -------------------------------------------------------------
  const msg = textarea({ value: draft.message || '', rows: 3, placeholder: `A short note shown on the ${noun}` });
  msg.addEventListener('input', () => (draft.message = msg.value));
  const disc = textarea({ value: draft.disclaimer || '', rows: 3, placeholder: 'Terms, warranty, or other fine print' });
  disc.addEventListener('input', () => (draft.disclaimer = disc.value));
  const notes = textarea({ value: draft.notes || '', rows: 3, placeholder: 'Only visible to your team' });
  notes.addEventListener('input', () => (draft.notes = notes.value));

  const messagesCard = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Message and terms')),
    h('div.card-body.form-grid', field('Client message', msg), field(config.disclaimerLabel || 'Contract or disclaimer', disc)),
  );
  const notesCard = h('section.card', h('div.card-head', h('h2.grow', 'Internal notes')), h('div.card-body', field('Notes', notes, { hint: 'Never shown to the client' })));

  // ---- Save -----------------------------------------------------------------
  const saveBtn = h('button.btn.primary', { type: 'submit' }, existing ? 'Save changes' : `Save ${noun}`);
  const form = h(
    'form.doc-form',
    { novalidate: true },
    h('div.doc-top', clientCard, detailsCard),
    itemsCard,
    messagesCard,
    notesCard,
    h(
      'div.form-actions',
      h('div.spacer'),
      h('a.btn', { href: existing ? `#/${coll}/${existing.id}` : `#/${coll}` }, 'Cancel'),
      saveBtn,
    ),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!draft.clientId) {
      clientError.hidden = false;
      picker.querySelector('input')?.focus();
      return;
    }
    const problem = config.validate?.(draft);
    if (problem) {
      toast(problem, { type: 'error' });
      return;
    }
    draft.items = draft.items.filter((it) => it.name?.trim() || it.unitPrice || it.description?.trim());
    saveBtn.disabled = true;
    try {
      let rec;
      if (existing) {
        rec = store.put(coll, applyEdits(store.get(coll, existing.id) || existing, JSON.parse(initial), draft));
        toast(`${Noun} updated`);
      } else {
        rec = await config.create(store, draft);
        toast(`${Noun} #${rec.number} created`);
      }
      saved = true;
      navigate(`/${coll}/${rec.id}`);
    } finally {
      saveBtn.disabled = false;
    }
  });

  const header = pageHeader({
    title: existing ? `Edit ${noun} #${existing.number}` : `New ${noun}`,
    crumbs: [{ label: Noun + 's', href: `#/${coll}` }, ...(existing ? [{ label: `#${existing.number}`, href: `#/${coll}/${existing.id}` }] : [])],
  });

  // Snapshot after the form is built: building it may normalize the draft.
  const initial = JSON.stringify(draft);
  return {
    node: h('div.page', header, form),
    title: existing ? `Edit ${noun} #${existing.number}` : `New ${noun}`,
    dirty: () => !saved && JSON.stringify(draft) !== initial,
  };
}
