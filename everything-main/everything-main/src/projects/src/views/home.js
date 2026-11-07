import { el, clear } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { store, docBrief, TRASH_DAYS } from '../lib/store.js';
import { toast } from '../ui/toast.js';
import { openMenu } from '../ui/menu.js';
import { confirmDialog } from '../ui/modal.js';
import { openProjectForm } from '../ui/projectform.js';
import { menuButton } from '../ui/navdrawer.js';
import { sampleBanner } from '../ui/shell.js';
import { avatarStack, progressBar, emptyState } from '../ui/bits.js';
import { projectProgress, doneColumnIds } from '../lib/board.js';
import { dueStatus } from '../lib/dates.js';
import { projectHash } from '../lib/routes.js';
import { plainSummary } from '../lib/markdown.js';
import { orderedProjects } from '../lib/projects.js';

export function homeView({ navigate }) {
  const grid = el('div.project-grid');
  const archivedWrap = el('div');
  const banner = sampleBanner();

  const root = el('section.view.home-view', {},
    el('header.view-head', {},
      menuButton(),
      el('h1.view-title', {}, 'Projects'),
      el('button.btn.btn-primary', {
        html: icon('plus', 16, 2.2),
        onclick: () => openProjectForm({
          onDone: (p) => navigate(projectHash(p.id), { replace: true }),
        }),
      }, ' New project')
    ),
    banner,
    grid,
    archivedWrap
  );

  function projectCard(entry) {
    const stats = el('div.card-stats', {}, el('span.skeleton', { style: { width: '60%' } }));
    const menuBtn = el('button.icon-btn.card-menu', {
      html: icon('more', 18, 2),
      'aria-label': `Options for ${entry.name}`,
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(menuBtn, [
          { label: 'Edit project', icon: 'pencil', onClick: () => openProjectForm({ project: entry }) },
          {
            label: entry.pinned ? 'Unpin project' : 'Pin project',
            icon: entry.pinned ? 'unpin' : 'pin',
            onClick: () => togglePinned(entry),
          },
          {
            label: 'Archive project',
            icon: 'archive',
            onClick: async () => {
              try {
                await store.setProjectArchived(entry.id, true);
                toast('Project archived', {
                  icon: 'archive',
                  duration: 7000,
                  action: {
                    label: 'Undo',
                    onClick: () => store.setProjectArchived(entry.id, false).catch(() => {}),
                  },
                });
              } catch (err) {
                console.error(err);
                toast('Could not save. Check your connection', { icon: 'cloudOff' });
              }
            },
          },
          { label: 'Delete project', icon: 'trash', danger: true, onClick: () => deleteProject(entry) },
        ]);
      },
    });

    // The fastest way to tell two similarly-named projects apart, so it sits
    // between the name and the numbers. Empty until the document arrives.
    const summary = el('p.project-card-brief', { hidden: true });

    const card = el('a.project-card', { href: `#/p/${entry.id}` },
      el('div.card-top', {},
        el('span.dot.dot-lg', { style: { background: entry.color }, 'aria-hidden': 'true' }),
        el('h2.project-card-title', {}, entry.name),
        entry.pinned && el('span.card-pin', {
          html: icon('pin', 13, 2.2),
          role: 'img',
          'aria-label': 'Pinned',
          title: 'Pinned to the top',
        }),
        entry.sample && el('span.nav-tag', {}, 'sample'),
        menuBtn
      ),
      summary,
      stats
    );

    // Stats need the full doc; render them as they arrive.
    store.loadProject(entry.id).then((doc) => {
      const { done, total } = projectProgress(doc);
      const doneIds = doneColumnIds(doc);
      const overdue = doc.tasks.filter((t) =>
        dueStatus(t.dueDate, doneIds.has(t.columnId)) === 'overdue').length;
      // Markdown flattened to one line: a card showing "## Goals - ship it"
      // would be worse than a card showing nothing.
      const brief = plainSummary(docBrief(doc), 120);
      summary.textContent = brief;
      summary.hidden = !brief;
      clear(stats);
      stats.append(
        progressBar(done, total, { label: `${entry.name}: ${done} of ${total} tasks done` }),
        el('div.card-meta', {},
          el('span', {}, total ? `${done}/${total} tasks done` : 'No tasks yet'),
          overdue > 0 && el('span.card-overdue', {}, `${overdue} overdue`),
          el('span.grow'),
          avatarStack(doc.members, { size: 22 })
        )
      );
    }).catch(() => {
      clear(stats);
      stats.append(el('span.card-meta', {}, 'Could not load this project'));
    });

    return card;
  }

  async function togglePinned(entry) {
    try {
      await store.setProjectPinned(entry.id, !entry.pinned);
      toast(entry.pinned ? 'Project unpinned' : 'Project pinned to the top', {
        icon: entry.pinned ? 'unpin' : 'pin',
      });
    } catch (err) {
      console.error(err);
      toast('Could not save. Check your connection', { icon: 'cloudOff' });
    }
  }

  async function deleteProject(entry) {
    const ok = await confirmDialog({
      title: `Delete "${entry.name}"?`,
      message: `The project moves to the trash, where it can be restored for ${TRASH_DAYS} days.`,
      confirmLabel: 'Delete project',
    });
    if (!ok) return;
    try {
      await store.deleteProject(entry.id);
      toast('Project moved to trash', {
        icon: 'trash',
        duration: 7000,
        action: {
          label: 'Undo',
          onClick: () => store.restoreProject(entry.id).catch((err) => {
            console.error(err);
            toast('Could not restore. Check your connection', { icon: 'cloudOff' });
          }),
        },
      });
    } catch (err) {
      console.error(err);
      toast('Could not delete. Check your connection', { icon: 'cloudOff' });
    }
  }

  /**
   * Archived projects collapse into their own section so a finished project
   * neither clutters the grid nor disappears.
   */
  function archivedSection(entries) {
    const rows = entries.map((entry) => el('a.archived-row', { href: projectHash(entry.id) },
      el('span.dot', { style: { background: entry.color }, 'aria-hidden': 'true' }),
      el('span.archived-name', {}, entry.name),
      el('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        html: icon('unarchive', 14, 2),
        // One "Unarchive" per row, all identical without the project name.
        'aria-label': `Unarchive ${entry.name}`,
        onclick: async (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            await store.setProjectArchived(entry.id, false);
            toast('Project unarchived', { icon: 'unarchive' });
          } catch (err) {
            console.error(err);
            toast('Could not save. Check your connection', { icon: 'cloudOff' });
          }
        },
      }, ' Unarchive')
    ));
    return el('details.archived-section', {
      // When everything is archived the section is the page, not an aside.
      open: entries.length === store.projects.length,
    },
      el('summary.archived-summary', {},
        el('span.archived-chevron', { html: icon('chevDown', 15, 2), 'aria-hidden': 'true' }),
        `Archived (${entries.length})`
      ),
      el('div.archived-list', {}, rows)
    );
  }

  function render() {
    clear(grid);
    clear(archivedWrap);
    // One arrangement, not two that disagree: the grid follows the sidebar.
    const ordered = orderedProjects(store.projects);
    const active = ordered.filter((p) => !p.archived);
    const archived = ordered.filter((p) => p.archived);
    if (archived.length) archivedWrap.append(archivedSection(archived));
    if (!active.length && archived.length) {
      grid.append(emptyState({
        icon: 'archive',
        title: 'Every project is archived',
        sub: 'Unarchive one below to pick it back up, or start something new.',
      }));
      return;
    }
    if (!store.projects.length) {
      grid.append(emptyState({
        icon: 'folder',
        title: 'No projects yet',
        sub: 'A project holds one board, its timeline, and its milestones.',
        action: el('button.btn.btn-primary', {
          onclick: () => openProjectForm({
          onDone: (p) => navigate(projectHash(p.id), { replace: true }),
        }),
        }, 'Create a project'),
      }));
      return;
    }
    for (const entry of active) grid.append(projectCard(entry));
  }

  const onChange = (e) => {
    if (e.detail?.scope === 'projects' || e.detail?.scope === 'doc') render();
  };
  store.addEventListener('change', onChange);
  root.destroy = () => {
    store.removeEventListener('change', onChange);
    banner.destroy();
  };

  render();
  return root;
}
