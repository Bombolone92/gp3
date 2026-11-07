import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { formatHours, isoToday, startOfWeek, dayShort } from '../../lib/time.js';
import { weeklyMinutes } from '../../core/scheduling.js';
import { avatar, emptyState, isMobileViewport } from '../components.js';
import { openEmployeeEditor } from '../editors.js';
import { renderEmployeeProfile } from './employee.js';
import { openRolesEditor } from '../roles.js';
import { confirmDialog } from '../modal.js';
import { toast, undoToast } from '../toast.js';

/** Monday-first order for listing days; data stays indexed 0 = Sunday. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function availabilitySummary(availability) {
  const days = availability?.days;
  if (!days) return 'Availability not set';
  const on = DAY_ORDER.filter((i) => days[i] && !days[i].off);
  if (on.length === 7) return 'Available every day';
  if (on.length === 0) return 'Unavailable all week';
  return `Available ${on.map((i) => dayShort(i)).join(', ')}`;
}

export function renderEmployees(ctx) {
  const { store, ui } = ctx;
  const state = store.state;
  // #/team/<id> is the same route with a person on it.
  if (ui.teamEmployee) return renderEmployeeProfile(ctx, ui.teamEmployee);
  const week = startOfWeek(isoToday());
  const isMobile = isMobileViewport();

  const active = state.employees.filter((e) => e.active);
  const archived = state.employees.filter((e) => !e.active);

  async function archive(employee) {
    try {
      const undo = await store.archiveEmployee(employee.id);
      undoToast(`${employee.name} archived`, undo);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function restore(employee) {
    try {
      await store.unarchiveEmployee(employee.id);
      toast(`${employee.name} is back on the team`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /**
   * Unlike archiving, this drops the person's availability and time off
   * and takes their name off every past shift, so it asks first. The
   * undo toast that follows only lasts a few seconds.
   */
  async function remove(employee) {
    const ok = await confirmDialog({
      title: `Delete ${employee.name} permanently?`,
      message:
        'Their availability and time off are deleted and upcoming shifts become open. Past shifts stay on reports, but under “Former employee” instead of their name. Leaving them archived keeps all of it.',
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    try {
      const undo = await store.deleteEmployee(employee.id);
      undoToast(`${employee.name} deleted`, undo);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function activeRow(employee) {
    return el(
      'div',
      { class: 'item-row' },
      // The body of the row opens their page and the controls beside it
      // do their own jobs, so it is a button rather than a click handler
      // on the row: a row is not focusable and answers no key, which put
      // the person's page out of reach of a keyboard entirely.
      el(
        'button',
        { class: 'item-hit', onClick: () => ctx.navigate(`team/${employee.id}`) },
        avatar(employee, 'avatar-lg'),
        el(
          'div',
          { class: 'item-main' },
          el('div', { class: 'item-title' }, employee.name),
          el(
            'div',
            { class: 'item-sub' },
            `${employee.role || 'No role'} · ${formatHours(weeklyMinutes(state.shifts, employee.id, week))} this week · ${availabilitySummary(state.availability[employee.id])}`
          )
        )
      ),
      el(
        'div',
        { class: 'item-actions' },
        el(
          'button',
          {
            class: 'btn btn-ghost btn-sm btn-icon',
            'aria-label': `Edit ${employee.name}`,
            title: 'Edit',
            onClick: () => openEmployeeEditor(ctx, { employee }),
          },
          icon('pencil', 15)
        ),
        // On a phone the row is only wide enough for one of these: the
        // person's name or this button's label. Drop to the icon there
        // so the names stay readable.
        el(
          'button',
          {
            class: `btn btn-ghost btn-sm${isMobile ? ' btn-icon' : ''}`,
            'aria-label': isMobile ? `Availability for ${employee.name}` : null,
            title: isMobile ? 'Availability' : null,
            onClick: () => ctx.navigate(`availability/${employee.id}`),
          },
          icon('clock', 15),
          isMobile ? null : 'Availability'
        ),
        el(
          'button',
          {
            class: 'btn btn-ghost btn-sm btn-icon',
            'aria-label': `Archive ${employee.name}`,
            title: 'Archive',
            onClick: () => archive(employee),
          },
          icon('archive', 15)
        )
      )
    );
  }

  function archivedRow(employee) {
    return el(
      'div',
      { class: 'item-row row-muted' },
      el(
        'button',
        { class: 'item-hit', onClick: () => ctx.navigate(`team/${employee.id}`) },
        avatar(employee, 'avatar-lg'),
        el(
          'div',
          { class: 'item-main' },
          el('div', { class: 'item-title' }, employee.name),
          el('div', { class: 'item-sub' }, `${employee.role || 'No role'} · History and availability kept`)
        )
      ),
      el(
        'div',
        { class: 'item-actions' },
        el(
          'button',
          { class: 'btn btn-ghost btn-sm', onClick: () => restore(employee) },
          icon('archive-restore', 15),
          'Restore'
        ),
        el(
          'button',
          {
            class: 'btn btn-ghost btn-sm btn-icon',
            'aria-label': `Delete ${employee.name} permanently`,
            title: 'Delete permanently',
            onClick: () => remove(employee),
          },
          icon('trash', 15)
        )
      )
    );
  }

  const subtitleParts = [`${active.length} ${active.length === 1 ? 'person' : 'people'}`];
  if (archived.length > 0) subtitleParts.push(`${archived.length} archived`);

  const activeList =
    state.employees.length === 0
      ? el(
          'div',
          { class: 'card' },
          emptyState({
            iconName: 'users',
            title: 'No employees yet',
            message: 'Add the people you schedule. Each gets a weekly availability you can edit any time.',
            actions: [
              el(
                'button',
                { class: 'btn btn-primary', onClick: () => openEmployeeEditor(ctx) },
                icon('user-plus', 16),
                'Add employee'
              ),
            ],
          })
        )
      : active.length === 0
        ? el(
            'div',
            { class: 'card' },
            emptyState({
              iconName: 'users',
              title: 'No active employees',
              message: 'Everyone is archived. Restore someone below or add a new employee.',
            })
          )
        : el('div', { class: 'card row-list' }, active.map(activeRow));

  const archivedSection =
    archived.length > 0
      ? el(
          'div',
          {},
          el(
            'button',
            {
              class: 'archived-toggle',
              'aria-expanded': String(Boolean(ui.teamArchivedOpen)),
              // Expanding re-renders the view, which rebuilds this button;
              // the key hands focus back to it (see render() in app.js).
              dataset: { focusKey: 'team:archived' },
              onClick: () => {
                ui.teamArchivedOpen = !ui.teamArchivedOpen;
                ctx.refresh();
              },
            },
            icon('chevron-right', 15),
            `Archived (${archived.length})`
          ),
          ui.teamArchivedOpen ? el('div', { class: 'card row-list' }, archived.map(archivedRow)) : null
        )
      : null;

  return el(
    'div',
    {},
    el(
      'div',
      { class: 'view-header' },
      el(
        'div',
        {},
        el('h1', {}, 'Team'),
        el('p', { class: 'subtitle' }, subtitleParts.join(' · '))
      ),
      el(
        'div',
        { class: 'view-actions' },
        el(
          'button',
          { class: 'btn', title: 'Manage roles', onClick: () => openRolesEditor(ctx) },
          icon('tags', 15),
          'Roles'
        ),
        el(
          'button',
          { class: 'btn btn-primary', onClick: () => openEmployeeEditor(ctx) },
          icon('user-plus', 16),
          'Add employee'
        )
      )
    ),
    activeList,
    archivedSection
  );
}
