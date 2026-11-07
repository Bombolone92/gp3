import { el, clear, requireValue } from '../lib/dom.js';
import { icon } from './icons.js';
import { store, PROJECT_COLORS, LABEL_COLORS } from '../lib/store.js';
import { openModal, confirmDialog } from './modal.js';
import { avatar } from './bits.js';

/**
 * One modal to manage a project's people and labels. Assignees are plain
 * named members (this is a single-account app; members are whoever you
 * plan work for), labels are colored tags.
 */
export function openMembersLabels(projectId) {
  const doc = store.getDoc(projectId);
  if (!doc) return;

  const membersList = el('div.manage-list');
  const labelsList = el('div.manage-list');

  function usageCount(kind, id) {
    return doc.tasks.filter((t) =>
      (kind === 'member' ? t.assigneeIds : t.labelIds).includes(id)).length;
  }

  function renderMembers() {
    clear(membersList);
    if (!doc.members.length) membersList.append(el('p.form-hint', {}, 'No members yet.'));
    for (const m of doc.members) {
      const n = usageCount('member', m.id);
      membersList.append(el('div.manage-row', {},
        avatar(m, 26),
        el('span.manage-name', {}, m.name),
        el('span.manage-sub', {}, n ? `${n} task${n === 1 ? '' : 's'}` : ''),
        el('button.icon-btn.small', {
          html: icon('trash', 15, 2),
          'aria-label': `Remove ${m.name}`,
          onclick: async () => {
            const ok = !n || await confirmDialog({
              title: `Remove ${m.name}?`,
              message: `They are unassigned from ${n} task${n === 1 ? '' : 's'}.`,
              confirmLabel: 'Remove member',
            });
            if (!ok) return;
            store.removeMember(projectId, m.id);
            renderMembers();
          },
        })
      ));
    }
  }

  function renderLabels() {
    clear(labelsList);
    if (!doc.labels.length) labelsList.append(el('p.form-hint', {}, 'No labels yet.'));
    for (const l of doc.labels) {
      const n = usageCount('label', l.id);
      labelsList.append(el('div.manage-row', {},
        el('span.dot.dot-lg', { style: { background: l.color }, 'aria-hidden': 'true' }),
        el('span.manage-name', {}, l.name),
        el('span.manage-sub', {}, n ? `${n} task${n === 1 ? '' : 's'}` : ''),
        el('button.icon-btn.small', {
          html: icon('trash', 15, 2),
          'aria-label': `Delete label ${l.name}`,
          onclick: async () => {
            const ok = !n || await confirmDialog({
              title: `Delete label "${l.name}"?`,
              message: `It is removed from ${n} task${n === 1 ? '' : 's'}.`,
              confirmLabel: 'Delete label',
            });
            if (!ok) return;
            store.removeLabel(projectId, l.id);
            renderLabels();
          },
        })
      ));
    }
  }

  /**
   * Colours cycle through the palette by how many entries there already are,
   * rather than being picked at random: two labels created one after the other
   * must not be able to come out the same colour, since colour is the whole of
   * what a label chip on a card says. (The quick-add composer, which creates
   * labels from `#token`, has always worked this way.)
   */
  function addForm({ placeholder, emptyMessage, nextColor, onAdd }) {
    const input = el('input.input', { type: 'text', placeholder, maxLength: 40, 'aria-label': placeholder });
    const btn = el('button.btn.btn-ghost.btn-sm', {
      type: 'submit', html: icon('plus', 14, 2.2),
    }, ' Add');
    return el('form.manage-add', {
      onsubmit: (e) => {
        e.preventDefault();
        const name = requireValue(input, emptyMessage);
        if (!name) return;
        onAdd(name, nextColor());
        input.value = '';
        input.focus();
      },
    }, input, btn);
  }

  const content = el('div', {},
    el('div.field', {},
      el('span.label', {}, 'Members'),
      el('p.form-hint', {}, 'Anyone you plan work for. Assign them to tasks from the task sheet.'),
      membersList,
      addForm({
        placeholder: 'Add member by name',
        emptyMessage: 'Type a name to add someone.',
        nextColor: () => PROJECT_COLORS[doc.members.length % PROJECT_COLORS.length],
        onAdd: (name, color) => { store.addMember(projectId, { name, color }); renderMembers(); },
      })
    ),
    el('div.field', {},
      el('span.label', {}, 'Labels'),
      labelsList,
      addForm({
        placeholder: 'Add label',
        emptyMessage: 'Type a name for the label.',
        nextColor: () => LABEL_COLORS[doc.labels.length % LABEL_COLORS.length],
        onAdd: (name, color) => { store.addLabel(projectId, { name, color }); renderLabels(); },
      })
    )
  );

  renderMembers();
  renderLabels();
  openModal({ title: 'Members and labels', content, dismissOnBack: true });
}
