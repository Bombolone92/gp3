import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, canEdit } from '../app.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { formatInterval, relativeDays, addInterval } from '../core/dates.js';
import { answerable, starterForm, inspectionsDue } from '../core/inspections.js';
import { newId } from '../core/ids.js';
import { pill, emptyState } from '../ui/components.js';
import { moreMenuButton } from './common.js';

export function render(ctx) {
  const store = app.store;
  const editable = canEdit('inspectionForms');
  // Until the builder opens, a second click (a double-click) must not add
  // the template twice.
  let added = false;
  const useStarter = () => {
    if (added) return;
    added = true;
    const f = store.put('inspectionForms', { ...starterForm(newId), archived: false });
    toast('Pre-trip inspection form added');
    navigate(`/inspection-forms/${f.id}`);
  };
  const body = ctx.live(() => {
    const today = app.today();
    const forms = store.all('inspectionForms').filter((f) => !f.archived);
    const archived = store.all('inspectionForms').filter((f) => f.archived);
    const subs = store.all('inspections');
    const vehicles = store.all('vehicles').filter((v) => !v.archived);
    const due = inspectionsDue(forms, vehicles, subs, today, addInterval);
    if (!forms.length && !archived.length) {
      return h('section.card', emptyState({ icon: 'clipboard-check', title: 'No inspection forms yet', text: 'Start from a ready-made pre-trip checklist and adjust it, or build your own.', actions: editable ? [h('button.btn.primary', { type: 'button', onClick: useStarter }, icon('sparkles', 16), 'Use pre-trip template'), h('a.btn', { href: '#/inspection-forms/new' }, 'Build from scratch')] : null }));
    }
    const card = (f) => {
      const count = subs.filter((s) => s.formId === f.id).length;
      const fdue = due.filter((d) => d.form.id === f.id);
      const overdue = fdue.filter((d) => d.overdue).length;
      return h(
        'li.form-card',
        h('div.form-card-head', h('span.form-card-icon', icon('clipboard-check', 20)), h('a.grow.form-card-title', { href: editable ? `#/inspection-forms/${f.id}` : `#/inspections?f_form=${f.id}` }, f.name), editable ? moreMenuButton([
          f.archived ? null : { label: 'Start inspection', icon: 'clipboard-check', run: () => navigate(`/inspections/start?form=${f.id}`) },
          { label: 'Duplicate', icon: 'copy', run: () => { const c = store.put('inspectionForms', { ...structuredClone(f), id: undefined, createdAt: undefined, archived: false, sample: false, name: `${f.name} (copy)`, items: f.items.map((it) => ({ ...it, id: newId() })) }); navigate(`/inspection-forms/${c.id}`); } },
          { label: f.archived ? 'Restore' : 'Archive', icon: f.archived ? 'unarchive' : 'archive', run: () => (store.patch('inspectionForms', f.id, { archived: !f.archived }), toast(f.archived ? 'Form restored' : 'Form archived')) },
        ]) : null),
        f.description ? h('p.form-card-desc', f.description) : null,
        h(
          'dl.form-card-stats',
          h('div', h('dt', 'Items'), h('dd', String(answerable(f).length))),
          h('div', h('dt', 'Vehicles'), h('dd', f.vehicleIds?.length ? String(f.vehicleIds.length) : 'All')),
          h('div', h('dt', 'Schedule'), h('dd', f.schedule?.every ? formatInterval(f.schedule) : 'None')),
          h('div', h('dt', 'Submissions'), h('dd', h('a', { href: `#/inspections?f_form=${f.id}` }, String(count)))),
        ),
        f.schedule?.every ? h('div.form-card-due', overdue ? pill(`${overdue} vehicle${overdue === 1 ? '' : 's'} overdue`, 'red') : pill('All vehicles up to date', 'green')) : null,
        h('div.form-card-foot', f.archived ? pill('Archived', 'gray') : h('a.btn.sm', { href: `#/inspections/start?form=${f.id}` }, icon('clipboard-check', 15), 'Start')),
      );
    };
    const overdueList = due.filter((d) => d.overdue).slice(0, 12);
    return h(
      'div.stack',
      h('ul.form-cards', forms.map(card)),
      overdueList.length
        ? h(
            'section.card.panel',
            h('div.card-head', h('h2.grow', 'Overdue scheduled inspections')),
            h('ul.widget-list.no-top', overdueList.map((d) => h('li', h('a.widget-row', { href: `#/inspections/start?vehicle=${d.vehicle.id}&form=${d.form.id}` }, pill('Overdue', 'red'), h('span.grow.truncate', `${d.vehicle.name} · ${d.form.name}`), h('span.subtle', d.lastDate ? `last ${relativeDays(d.lastDate, today)}` : 'never inspected'))))),
          )
        : null,
      archived.length ? h('details.archived-forms', h('summary', `Archived forms (${archived.length})`), h('ul.form-cards', archived.map(card))) : null,
    );
  }, ['inspectionForms', 'inspections', 'vehicles']);
  return {
    node: h('div.page', h('header.page-header', h('div.titles', h('h1', 'Inspection forms'), h('div.subtitle', 'Checklists drivers and technicians fill in. Failed items open issues automatically.')), h('div.actions', editable ? h('button.btn', { type: 'button', onClick: useStarter }, icon('sparkles', 15), 'Pre-trip template') : null, editable ? h('a.btn.primary', { href: '#/inspection-forms/new' }, icon('plus', 16), 'New form') : null)), body),
    title: 'Inspection forms',
  };
}
