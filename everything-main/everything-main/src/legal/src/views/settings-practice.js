/** Practice areas with their stages, activity categories, and simple lists. */
import '../styles/settings.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { card, toggle } from '../ui/components.js';
import { listEditor, stringListEditor } from './settings-lists.js';

const store = () => app.store;
const settings = () => app.settings();
const mattersWhere = (fn) => store().all('matters').filter(fn);

function clearOnMatters(list, patch) {
  for (const m of list) store().patch('matters', m.id, patch);
}

/** Dialog to give one practice area its own stage list. */
function openAreaStages(area, onDone) {
  const current = () => settings().practiceAreas.find((p) => p.id === area.id) || area;
  const saveArea = (patch) => store().saveSettings({ practiceAreas: settings().practiceAreas.map((p) => (p.id === area.id ? { ...p, ...patch } : p)) });
  const editorWrap = h('div');
  const usesOwn = () => !!current().stages?.length;
  const drawEditor = () => {
    editorWrap.replaceChildren(
      usesOwn()
        ? listEditor({
            label: `${area.name} stages`,
            items: current().stages,
            idPrefix: 'st',
            addLabel: 'Add stage',
            placeholder: 'New stage name',
            minItems: 1,
            usage: (it) => mattersWhere((m) => m.practiceAreaId === area.id && m.stageId === it.id).length,
            usageText: (n, it) => `${n} ${n === 1 ? 'matter is' : 'matters are'} in "${it.name}". They will have no stage until you move them.`,
            onRemoveUsed: (it) =>
              clearOnMatters(
                mattersWhere((m) => m.practiceAreaId === area.id && m.stageId === it.id),
                { stageId: '' },
              ),
            onChange: (items) => saveArea({ stages: items }),
          })
        : h('p.subtle', `${area.name} uses the firm’s default stages.`),
    );
  };
  const sw = toggle({
    label: 'Use stages specific to this practice area',
    checked: usesOwn(),
    onChange: async (on) => {
      if (!on) {
        // Matters in a stage the default list lacks would be left in a stage that no longer exists.
        const defaults = new Set(settings().stages.map((s) => s.id));
        const stranded = mattersWhere((m) => m.practiceAreaId === area.id && m.stageId && !defaults.has(m.stageId));
        if (stranded.length) {
          const ok = await confirmDialog({
            title: 'Use the default stages?',
            message: `${stranded.length} ${stranded.length === 1 ? 'matter is in a stage' : 'matters are in stages'} that the default list does not have. They will have no stage until you move them.`,
            confirmLabel: 'Use default stages',
            danger: true,
          });
          if (!ok) {
            sw.querySelector('input').checked = true;
            return;
          }
          clearOnMatters(stranded, { stageId: '' });
        }
      }
      // Start from the default list so matters already in a stage keep it.
      saveArea({ stages: on ? settings().stages.map((s) => ({ ...s })) : [] });
      drawEditor();
    },
  });
  drawEditor();
  openDialog({
    title: `${area.name} stages`,
    subtitle: 'Stages are the steps a matter moves through on the stages board.',
    body: h('div.stack', sw, editorWrap),
    footer: ({ close }) => [h('div.spacer'), h('button.btn.primary', { type: 'button', onClick: () => close() }, 'Done')],
    onClose: () => onDone?.(),
  });
}

export function practiceSection() {
  const s = settings();
  const areas = listEditor({
    label: 'Practice areas',
    items: s.practiceAreas,
    idPrefix: 'pa',
    addLabel: 'Add practice area',
    placeholder: 'New practice area',
    usage: (it) => mattersWhere((m) => m.practiceAreaId === it.id).length,
    usageText: (n, it) => `${n} ${n === 1 ? 'matter uses' : 'matters use'} "${it.name}". They will have no practice area.`,
    onRemoveUsed: (it) =>
      clearOnMatters(
        mattersWhere((m) => m.practiceAreaId === it.id),
        { practiceAreaId: '' },
      ),
    onChange: (items) => store().saveSettings({ practiceAreas: items }),
    extra: (it) =>
      h(
        'button.btn.sm.ghost.le-extra',
        {
          type: 'button',
          onClick: () => openAreaStages(settings().practiceAreas.find((p) => p.id === it.id) || it, () => areas.setItems(settings().practiceAreas)),
          'aria-label': `Stages for ${it.name}`,
        },
        icon('kanban', 15),
        h('span.hide-sm', it.stages?.length ? `${it.stages.length} own stages` : 'Default stages'),
      ),
  });
  const stages = listEditor({
    label: 'Default stages',
    items: s.stages,
    idPrefix: 'st',
    addLabel: 'Add stage',
    placeholder: 'New stage name',
    minItems: 1,
    usage: (it) => mattersWhere((m) => m.stageId === it.id && !settings().practiceAreas.find((p) => p.id === m.practiceAreaId)?.stages?.length).length,
    usageText: (n, it) => `${n} ${n === 1 ? 'matter is' : 'matters are'} in "${it.name}". They will have no stage until you move them.`,
    onRemoveUsed: (it) =>
      clearOnMatters(
        mattersWhere((m) => m.stageId === it.id && !settings().practiceAreas.find((p) => p.id === m.practiceAreaId)?.stages?.length),
        { stageId: '' },
      ),
    onChange: (items) => store().saveSettings({ stages: items }),
  });
  return {
    node: h(
      'div.stack',
      card({ title: 'Practice areas', body: h('div.stack', h('p.subtle', 'Every matter belongs to a practice area. Areas can have their own stages, or use the default stages below.'), areas) }),
      card({ title: 'Default stages', body: h('div.stack', h('p.subtle', 'The steps a matter moves through, shown as columns on the stages board.'), stages) }),
    ),
  };
}

export function categoriesSection() {
  const s = settings();
  const used = (id) =>
    store()
      .all('activities')
      .filter((a) => a.categoryId === id).length;
  const editor = (kind, label) =>
    listEditor({
      label,
      items: s.activityCategories.filter((c) => c.kind === kind),
      idPrefix: 'ac',
      addLabel: kind === 'time' ? 'Add time category' : 'Add expense category',
      placeholder: kind === 'time' ? 'For example, Deposition' : 'For example, Postage',
      usage: (it) => used(it.id),
      usageText: (n, it) => `${n} ${n === 1 ? 'entry uses' : 'entries use'} "${it.name}". They will show as uncategorized.`,
      onChange: (items) => {
        const others = settings().activityCategories.filter((c) => c.kind !== kind);
        store().saveSettings({ activityCategories: [...(kind === 'time' ? items : others), ...(kind === 'time' ? others : items)].map((c) => ({ ...c, kind: c.kind || kind })) });
      },
    });
  return h(
    'div.stack',
    card({ title: 'Time categories', body: h('div.stack', h('p.subtle', 'Describe the kind of work on a time entry, and group time in reports.'), editor('time', 'Time categories')) }),
    card({ title: 'Expense categories', body: editor('expense', 'Expense categories') }),
  );
}

export function listsSection() {
  const s = settings();
  return h(
    'div.stack',
    card({
      title: 'Document categories',
      body: h(
        'div.stack',
        h('p.subtle', 'Used to file and filter documents.'),
        stringListEditor({
          label: 'Document categories',
          values: s.documentCategories,
          addLabel: 'Add category',
          placeholder: 'New category',
          usage: (name) =>
            store()
              .all('documents')
              .filter((d) => d.category === name).length,
          usageText: (n, it) => `${n} ${n === 1 ? 'document is' : 'documents are'} filed under "${it.name}". They keep the label, but it will no longer be offered.`,
          onChange: (values) => store().saveSettings({ documentCategories: values }),
          // Categories are stored by name, so a rename moves documents and templates with it.
          onRename: (from, to) => {
            for (const c of ['documents', 'templates']) for (const r of store().all(c)) if (r.category === from) store().patch(c, r.id, { category: to });
          },
        }),
      ),
    }),
    card({
      title: 'Relationship types',
      body: h(
        'div.stack',
        h('p.subtle', 'How related contacts connect to a matter, such as opposing counsel or witness.'),
        stringListEditor({
          label: 'Relationship types',
          values: s.relationships,
          addLabel: 'Add relationship',
          placeholder: 'New relationship',
          onChange: (values) => store().saveSettings({ relationships: values }),
          onRename: (from, to) => {
            for (const m of mattersWhere((x) => (x.related || []).some((r) => r.relationship === from))) {
              store().patch('matters', m.id, { related: m.related.map((r) => (r.relationship === from ? { ...r, relationship: to } : r)) });
            }
          },
        }),
      ),
    }),
  );
}
