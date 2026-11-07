/** New and edit quote. */
import { h } from '../ui/dom.js';
import { app } from '../app.js';
import { field, select, textInput } from '../ui/components.js';
import { renderDocForm } from './doc-form.js';
import { createQuote, blankItem, defaultTaxRate } from '../core/workflow.js';
import { addDays, formatDate } from '../core/dates.js';

export function render(ctx) {
  return renderDocForm(ctx, {
    coll: 'quotes',
    noun: 'quote',
    titleLabel: 'Quote title',
    titlePlaceholder: 'e.g. Backyard landscaping',
    showDeposit: true,
    allowOptional: true,
    blank: (query) => {
      const s = app.settings();
      const client = query.client ? app.store.get('clients', query.client) : null;
      return {
        clientId: client?.id || null,
        propertyId: client?.properties?.[0]?.id || null,
        title: '',
        items: [blankItem()],
        taxRate: defaultTaxRate(s),
        discount: null,
        deposit: null,
        message: s.quotes.message,
        disclaimer: s.quotes.disclaimer,
        notes: '',
        status: 'draft',
        salespersonId: app.store.all('team').find((m) => m.role === 'owner')?.id || null,
      };
    },
    detailsFields: (draft) => {
      // An inactive salesperson stays listed while the quote names them.
      const team = app.store.all('team').filter((m) => m.active !== false || m.id === draft.salespersonId);
      const sales = select({
        value: draft.salespersonId || '',
        options: [{ value: '', label: 'None' }, ...team.map((m) => ({ value: m.id, label: m.active === false ? `${m.name} (inactive)` : m.name }))],
      });
      sales.addEventListener('change', () => (draft.salespersonId = sales.value || null));
      const validDays = app.settings().quotes.validDays || 30;
      const valid = textInput({ type: 'date', value: draft.validUntil || addDays(app.today(), validDays) });
      draft.validUntil ??= valid.value;
      valid.addEventListener('input', () => (draft.validUntil = valid.value));
      return [
        h('dl.kv', h('dt', 'Quote number'), h('dd', draft.number ? `#${draft.number}` : 'Assigned when saved'), draft.createdAt ? [h('dt', 'Created'), h('dd', formatDate(draft.createdAt))] : null),
        field('Salesperson', sales),
        field('Valid until', valid),
      ];
    },
    create: (store, draft) => createQuote(store, { ...draft, extra: { salespersonId: draft.salespersonId, validUntil: draft.validUntil } }),
  });
}
