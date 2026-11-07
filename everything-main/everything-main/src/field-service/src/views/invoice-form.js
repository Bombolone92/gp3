/** New and edit invoice. */
import { h } from '../ui/dom.js';
import { app } from '../app.js';
import { field, select, textInput } from '../ui/components.js';
import { renderDocForm } from './doc-form.js';
import { createInvoice, blankItem, defaultTaxRate } from '../core/workflow.js';
import { addDays } from '../core/dates.js';
import { PAYMENT_TERMS, termDays } from '../core/settings.js';

export function render(ctx) {
  return renderDocForm(ctx, {
    coll: 'invoices',
    noun: 'invoice',
    titleKey: 'subject',
    titleLabel: 'Subject',
    titlePlaceholder: 'For services rendered',
    disclaimerLabel: 'Payment terms and notes',
    blank: (query) => {
      const s = app.settings();
      const client = query.client ? app.store.get('clients', query.client) : null;
      const issueDate = app.today();
      return {
        clientId: client?.id || null,
        propertyId: client?.properties?.[0]?.id || null,
        subject: 'For services rendered',
        items: [blankItem()],
        taxRate: defaultTaxRate(s),
        discount: null,
        issueDate,
        terms: s.invoices.terms,
        dueDate: addDays(issueDate, termDays(s.invoices.terms) ?? 30),
        message: s.invoices.message,
        disclaimer: s.invoices.disclaimer,
        notes: '',
        jobIds: [],
      };
    },
    detailsFields: (draft) => {
      const issue = textInput({ type: 'date', value: draft.issueDate || app.today() });
      const terms = select({ value: draft.terms || 'net30', options: PAYMENT_TERMS.map((t) => ({ value: t.id, label: t.label })) });
      const due = textInput({ type: 'date', value: draft.dueDate || '' });
      const recompute = () => {
        if (draft.terms !== 'custom') {
          draft.dueDate = addDays(draft.issueDate, termDays(draft.terms) ?? 30);
          due.value = draft.dueDate;
        }
        due.disabled = draft.terms !== 'custom';
      };
      issue.addEventListener('input', () => {
        draft.issueDate = issue.value || app.today();
        recompute();
      });
      terms.addEventListener('change', () => {
        draft.terms = terms.value;
        recompute();
      });
      due.addEventListener('input', () => (draft.dueDate = due.value));
      due.disabled = draft.terms !== 'custom';
      return [
        h('dl.kv', h('dt', 'Invoice number'), h('dd', draft.number ? `#${draft.number}` : 'Assigned when saved')),
        h('div.form-grid', field('Issue date', issue), field('Payment terms', terms), field('Due date', due, { span2: true })),
      ];
    },
    validate: (draft) => (draft.terms === 'custom' && draft.dueDate && draft.issueDate && draft.dueDate < draft.issueDate ? 'The due date cannot be before the issue date.' : null),
    create: (store, draft) => createInvoice(store, { ...draft }),
  });
}
