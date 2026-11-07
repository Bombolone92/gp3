/**
 * Managed roles: the Roles manager dialog (add, rename with cascade,
 * recolor, delete) and the role picker control used by the shift,
 * employee, and coverage editors in place of free-typed text.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { uid } from '../lib/id.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { buttonize, colorSwatches, field, showFormError } from './components.js';
import { EMPLOYEE_COLORS } from '../core/store.js';

const NEW_ROLE = '__new-role__';

/** The managed role entry carrying this label, or null. */
export function roleByName(state, name) {
  const trimmed = String(name ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  return (state.settings.roles ?? []).find((r) => r.name.toLowerCase() === trimmed) ?? null;
}

/**
 * Role picker: a select fed by the managed list, with the record's own
 * legacy label kept selectable and an inline "New role" branch that
 * reveals a text input. Returns { element, id, getValue, onChange };
 * `id` is the select's, so callers can point their label at it.
 */
export function roleField(store, initialValue, { allowEmpty = false } = {}) {
  const roles = store.state.settings.roles ?? [];
  const current = String(initialValue ?? '').trim();
  const known = roles.some((r) => r.name.toLowerCase() === current.toLowerCase());

  const select = el('select', { class: 'select', id: uid('fld') });
  if (allowEmpty) select.appendChild(el('option', { value: '' }, 'No role'));
  else if (!current && roles.length > 0) {
    select.appendChild(el('option', { value: '', selected: true }, 'Choose a role…'));
  }
  if (current && !known) select.appendChild(el('option', { value: current, selected: true }, current));
  for (const role of roles) {
    select.appendChild(
      el(
        'option',
        { value: role.name, selected: role.name.toLowerCase() === current.toLowerCase() },
        role.name
      )
    );
  }
  select.appendChild(el('option', { value: NEW_ROLE }, '+ New role…'));
  if (!allowEmpty && !current && roles.length === 0) select.value = NEW_ROLE;

  const input = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'New role name',
    'aria-label': 'New role name',
  });
  const wrap = el('div', { class: 'role-field' }, select, input);

  function syncInput(focus) {
    const showing = select.value === NEW_ROLE;
    input.style.display = showing ? '' : 'none';
    if (showing && focus) input.focus();
  }
  select.addEventListener('change', () => syncInput(true));
  syncInput(false);

  return {
    element: wrap,
    id: select.id,
    getValue: () => (select.value === NEW_ROLE ? input.value.trim() : select.value),
    onChange(fn) {
      select.addEventListener('change', fn);
      input.addEventListener('change', fn);
    },
  };
}

export function openRolesEditor(ctx) {
  const { store } = ctx;
  const body = el('div', { style: { display: 'contents' } });

  function usage(name) {
    const state = store.state;
    const matches = (v) => String(v ?? '').trim().toLowerCase() === name.toLowerCase();
    const shifts = state.shifts.filter((s) => matches(s.role)).length;
    const people = state.employees.filter((e) => matches(e.role)).length;
    const reqs = (state.settings.coverage ?? []).filter((c) => matches(c.role)).length;
    const parts = [];
    if (shifts) parts.push(`${shifts} shift${shifts === 1 ? '' : 's'}`);
    if (people) parts.push(`${people} ${people === 1 ? 'person' : 'people'}`);
    if (reqs) parts.push(`${reqs} requirement${reqs === 1 ? '' : 's'}`);
    return parts.length ? parts.join(' · ') : 'Not used yet';
  }

  function confirmDelete(role) {
    const used = usage(role.name);
    const inner = openModal({
      title: `Delete “${role.name}”?`,
      content: el(
        'p',
        { style: { color: 'var(--text-2)', fontSize: '13.5px' } },
        used === 'Not used yet'
          ? 'This role is not used by any records.'
          : `It is used by ${used}. Keeping labels leaves every record readable as plain text; clearing removes the label from shifts and people and deletes matching coverage requirements.`
      ),
      footer: [
        el('span', { class: 'grow' }),
        el('button', { class: 'btn', onClick: () => inner.close() }, 'Cancel'),
        used === 'Not used yet'
          ? null
          : el(
              'button',
              {
                class: 'btn btn-danger',
                onClick: async () => {
                  try {
                    await store.deleteRole(role.id, { clearRecords: true });
                    toast(`Role deleted and cleared from records`);
                    inner.close();
                    renderList();
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              'Clear everywhere'
            ),
        el(
          'button',
          {
            // Two buttons when the role is in use, and this is the milder
            // of them: it deletes the role but leaves every label behind
            // as plain text, so it reads as the recommended way out. On a
            // role nothing uses it is the only action, and a plain delete
            // painted in the accent color was the one confirmation in the
            // app asking for a deletion in the color of "yes, safe".
            class: used === 'Not used yet' ? 'btn btn-danger' : 'btn btn-primary',
            onClick: async () => {
              try {
                await store.deleteRole(role.id);
                // Nothing carried the label, so there is none to keep.
                toast(used === 'Not used yet' ? 'Role deleted' : 'Role deleted, labels kept');
                inner.close();
                renderList();
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          },
          used === 'Not used yet' ? 'Delete role' : 'Keep labels'
        ),
      ],
    });
  }

  function renderEdit(role) {
    const nameInput = el('input', { class: 'input', type: 'text', value: role.name });
    let color = role.color ?? null;
    const errorBox = el('div', { style: { display: 'contents' } });

    body.replaceChildren(
      field('Role name', nameInput),
      el(
        'div',
        { class: 'field' },
        el('label', {}, 'Color'),
        colorSwatches(EMPLOYEE_COLORS, color, (c) => (color = c), {
          ariaLabel: 'Role color',
          allowNone: true,
        })
      ),
      el(
        'p',
        { class: 'export-preview' },
        `Renaming updates ${usage(role.name).toLowerCase() === 'not used yet' ? 'nothing yet' : usage(role.name)} in one go.`
      ),
      errorBox,
      el(
        'div',
        { class: 'roles-edit-actions' },
        el(
          'button',
          {
            class: 'btn btn-danger btn-icon',
            'aria-label': `Delete ${role.name}`,
            title: 'Delete role',
            onClick: () => confirmDelete(role),
          },
          icon('trash', 15)
        ),
        el('span', { class: 'grow' }),
        el('button', { class: 'btn', onClick: renderList }, 'Cancel'),
        el(
          'button',
          {
            class: 'btn btn-primary',
            onClick: async (e) => {
              errorBox.replaceChildren();
              const button = e.currentTarget;
              button.disabled = true;
              try {
                await store.updateRole(role.id, { name: nameInput.value, color });
                toast('Role updated');
                renderList();
              } catch (err) {
                button.disabled = false;
                showFormError(errorBox, err.message);
              }
            },
          },
          'Save role'
        )
      )
    );
    nameInput.focus();
  }

  function renderList() {
    const roles = store.state.settings.roles ?? [];
    const nameInput = el('input', { class: 'input', type: 'text', placeholder: 'e.g. Barista, Opening' });
    let color = null;
    const errorBox = el('div', { style: { display: 'contents' } });

    body.replaceChildren(
      roles.length === 0
        ? el(
            'p',
            { class: 'coverage-empty' },
            'No roles yet. Roles keep labels consistent everywhere: shifts, people, and coverage requirements pick from this list.'
          )
        : el(
            'div',
            { class: 'card row-list' },
            roles.map((role) =>
              el(
                'div',
                { ...buttonize(() => renderEdit(role)), class: 'item-row is-clickable', 'aria-label': `Edit role ${role.name}` },
                el('span', {
                  class: `role-dot${role.color ? '' : ' is-none'}`,
                  style: role.color ? { '--emp': role.color } : {},
                }),
                el(
                  'div',
                  { class: 'item-main' },
                  el('div', { class: 'item-title' }, role.name),
                  el('div', { class: 'item-sub' }, usage(role.name))
                ),
                el('div', { class: 'item-actions' }, icon('pencil', 14))
              )
            )
          ),
      el('h3', { class: 'coverage-add-title' }, 'Add role'),
      field('Name', nameInput),
      el(
        'div',
        { class: 'field' },
        el('label', {}, 'Color'),
        colorSwatches(EMPLOYEE_COLORS, null, (c) => (color = c), {
          ariaLabel: 'Role color',
          allowNone: true,
        })
      ),
      errorBox,
      el(
        'button',
        {
          class: 'btn btn-primary btn-block',
          onClick: async (e) => {
            errorBox.replaceChildren();
            const button = e.currentTarget;
            button.disabled = true;
            try {
              await store.addRole({ name: nameInput.value, color });
              toast('Role added');
              renderList();
            } catch (err) {
              button.disabled = false;
              showFormError(errorBox, err.message);
            }
          },
        },
        'Add role'
      )
    );
  }

  renderList();
  openModal({ title: 'Roles', content: body });
}
