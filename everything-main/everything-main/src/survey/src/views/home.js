/**
 * Surveys home: every survey with its status and response count, folders,
 * search, filters, bulk actions, and the ways to start a new survey.
 */
import { h, replace, debounce, announce, isEditable } from '../lib/dom.js';
import { icon, githubMark, REPO_URL } from '../lib/icons.js';
import { showMenu, toast, toastError, confirmDialog, promptDialog } from '../lib/ui.js';
import { fmtDate, fmtRelative, plural, fmtNum, downloadText, slugify } from '../lib/format.js';
import { makeSurvey } from '../model/survey.js';
import { surveyStatus } from '../data/publish.js';
import { chooseTemplate, generateWithAI, importSurvey } from './create.js';
import { singleKeysOn } from './shortcuts.js';

const STATUS_LABEL = { draft: 'Draft', open: 'Open', closed: 'Closed' };
const SORTS = {
  updated: { label: 'Last updated', fn: (a, b) => (b.meta.updatedAt || 0) - (a.meta.updatedAt || 0) },
  created: { label: 'Date created', fn: (a, b) => (b.meta.createdAt || 0) - (a.meta.createdAt || 0) },
  title: { label: 'Title', fn: (a, b) => (a.meta.title || '').localeCompare(b.meta.title || '') },
  responses: { label: 'Most responses', fn: (a, b) => (b.meta.responses || 0) - (a.meta.responses || 0) },
};

export async function mount(container, route, app) {
  const { repo } = app;
  const state = {
    folder: route.folder || '',
    query: '',
    status: 'all',
    sort: (app.settings && app.settings.sort) || 'updated',
    selected: new Set(),
  };
  let index = {};
  let folders = {};

  const side = h('nav', { class: 'side scroll', 'aria-label': 'Folders' });
  const mainCol = h('div', { class: 'home-main' });
  const scrim = h('div', { class: 'side-scrim', hidden: true, onclick: () => toggleSide(false) });
  const layout = h('div', { class: 'home' }, side, scrim, mainCol);
  container.append(layout);

  function toggleSide(open) {
    layout.classList.toggle('side-open', open);
    scrim.hidden = !open;
    sideBtn.setAttribute('aria-expanded', String(open));
    if (open) side.querySelector('.side-item')?.focus();
  }

  const sideBtn = h(
    'button',
    { type: 'button', class: 'btn btn-ghost btn-icon side-toggle', 'aria-label': 'Show folders', 'aria-expanded': 'false', onclick: () => toggleSide(!layout.classList.contains('side-open')) },
    icon('menu'),
  );
  app.setAppbar({ left: [sideBtn, app.homeBrand()] });
  // The folders drawer (narrow screens) closes on Escape, back to its
  // button, and when focus leaves it.
  side.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && layout.classList.contains('side-open')) {
      e.preventDefault();
      toggleSide(false);
      sideBtn.focus();
    }
  });
  side.addEventListener('focusout', (e) => {
    if (!layout.classList.contains('side-open') || !e.relatedTarget) return;
    if (!side.contains(e.relatedTarget) && e.relatedTarget !== sideBtn && !e.relatedTarget.closest('.menu, dialog')) toggleSide(false);
  });

  /* ---- Data ---- */

  async function load() {
    [index, folders] = await Promise.all([repo.loadIndex(), repo.loadFolders()]);
    render();
    refreshCounts();
  }

  /** Response counts come from the collector in one call; only changed
   *  counts are written back to the index. */
  async function refreshCounts() {
    const cfg = await app.client.peek();
    if (!cfg) return;
    try {
      const stats = await app.client.stats();
      const counts = {};
      for (const [sid, meta] of Object.entries(index)) {
        const n = stats.surveys[sid] || 0;
        if ((meta.responses || 0) !== n) counts[sid] = { responses: n };
      }
      if (Object.keys(counts).length) {
        await repo.patchMany(counts);
        index = repo.index;
        render();
      }
    } catch {
      /* counts stay as last known */
    }
  }

  /* ---- Actions ---- */

  // One creation at a time: a double click must not make two surveys.
  let creating = false;
  async function createFrom(survey) {
    if (!survey || creating) return;
    creating = true;
    try {
      const doc = await repo.createSurvey(survey, { folder: state.folder });
      app.go(`/s/${doc.id}/design`);
    } catch (err) {
      console.error(err);
      toastError('Could not create the survey. Check your connection and try again.');
    } finally {
      creating = false;
    }
  }

  function createMenu(anchor) {
    showMenu(
      anchor,
      [
        { label: 'Start from scratch', icon: 'file', run: () => createFrom(makeSurvey()) },
        { label: 'Use a template', icon: 'template', run: async () => createFrom(await chooseTemplate(app)) },
        app.backend.ai ? { label: 'Generate with AI', icon: 'sparkles', run: async () => createFrom(await generateWithAI(app, '')) } : null,
        { label: 'Import questions', icon: 'upload', run: async () => createFrom(await importSurvey(app)) },
      ],
      { align: 'end', label: 'Create survey' },
    );
  }

  async function rename(sid) {
    const meta = index[sid];
    const title = await promptDialog({ title: 'Rename survey', label: 'Survey title', value: meta.title, maxLength: 300 });
    if (!title || title === meta.title) return;
    try {
      const s = await app.session(sid, { refresh: true });
      s.apply((doc) => ({ ...doc, title }));
      await s.flush();
      index = repo.index;
      render();
    } catch {
      toastError('Could not rename the survey.');
    }
  }

  async function duplicate(sid) {
    try {
      const copy = await repo.duplicateSurvey(sid);
      index = repo.index;
      render();
      toast(`Created “${copy.title}”`);
    } catch {
      toastError('Could not copy the survey.');
    }
  }

  async function remove(sids) {
    const list = [...sids];
    const one = list.length === 1;
    const withResponses = list.filter((sid) => (index[sid] && index[sid].responses) > 0).length;
    const ok = await confirmDialog({
      title: one ? 'Delete survey?' : `Delete ${list.length} surveys?`,
      message: `${one ? `“${index[list[0]].title}”` : 'These surveys'} and ${withResponses ? 'all of their responses' : 'their share links'} will be deleted permanently. This can’t be undone.`,
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    let failed = 0;
    for (const sid of list) {
      try {
        const collectors = await repo.loadCollectors(sid);
        const cfg = await app.client.peek();
        if (cfg && (Object.keys(collectors).length || index[sid].publishedAt)) {
          await app.client.deleteSurvey(sid, Object.keys(collectors));
        }
        await app.responses.forget(sid);
        await repo.deleteSurvey(sid);
        app.sessions.delete(sid);
        app.surveyDeleted?.(sid);
        state.selected.delete(sid);
      } catch (err) {
        console.error(err);
        failed++;
      }
    }
    index = repo.index;
    render();
    if (failed) toastError(`${failed} ${failed === 1 ? 'survey' : 'surveys'} could not be deleted.`);
    else announce(one ? 'Survey deleted' : `${list.length} surveys deleted`);
  }

  async function moveTo(sids, folder) {
    let failed = false;
    try {
      // One index write for all of them: all move, or none.
      await repo.patchMany(Object.fromEntries(sids.map((sid) => [sid, { folder }])));
    } catch {
      failed = true;
    }
    index = repo.index;
    state.selected.clear();
    render();
    if (failed) toastError('Could not move the surveys. Check your connection and try again.');
    else toast(folder ? `Moved to ${folders[folder] ? folders[folder].name : 'folder'}` : 'Removed from folder');
  }

  function folderPicker(anchor, sids) {
    const items = Object.entries(folders)
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([fid, f]) => ({ label: f.name, icon: 'folder', run: () => moveTo(sids, fid) }));
    showMenu(
      anchor,
      [
        ...(items.length ? items : [{ heading: 'No folders yet' }]),
        'sep',
        { label: 'New folder…', icon: 'folderPlus', run: async () => {
          const id = await newFolder();
          if (id) moveTo(sids, id);
        } },
        sids.some((sid) => index[sid] && index[sid].folder) ? { label: 'Remove from folder', icon: 'x', run: () => moveTo(sids, '') } : null,
      ],
      { label: 'Move to folder' },
    );
  }

  async function newFolder() {
    const name = await promptDialog({ title: 'New folder', label: 'Folder name', confirm: 'Create', maxLength: 100 });
    if (!name) return null;
    try {
      const id = await repo.createFolder(name);
      folders = await repo.loadFolders();
      render();
      return id;
    } catch {
      toastError('Could not create the folder.');
      return null;
    }
  }

  async function exportSurvey(sid) {
    try {
      const doc = await repo.loadSurvey(sid);
      downloadText(`${slugify(doc.title)}.survey.json`, JSON.stringify({ format: 'puter-survey', version: 1, survey: doc }, null, 2), 'application/json');
    } catch {
      toastError('Could not export the survey.');
    }
  }

  function rowMenu(anchor, sid) {
    const meta = index[sid];
    showMenu(
      anchor,
      [
        { label: 'Edit', icon: 'edit', run: () => app.go(`/s/${sid}/design`) },
        { label: 'Share and collect', icon: 'link', run: () => app.go(`/s/${sid}/collect`) },
        { label: 'Analyze results', icon: 'chartBar', run: () => app.go(`/s/${sid}/analyze`) },
        'sep',
        { label: 'Rename', icon: 'edit', run: () => rename(sid) },
        { label: 'Make a copy', icon: 'duplicate', run: () => duplicate(sid) },
        { label: 'Move to folder', icon: 'folder', run: () => folderPicker(anchor, [sid]) },
        { label: 'Export survey file', icon: 'download', run: () => exportSurvey(sid) },
        'sep',
        { label: 'Delete', icon: 'trash', danger: true, run: () => remove([sid]) },
      ],
      { align: 'end', label: `Actions for ${meta.title}` },
    );
  }

  /* ---- Rendering ---- */

  function entries() {
    return Object.entries(index).map(([sid, meta]) => ({ sid, meta }));
  }

  function filtered() {
    const q = state.query.trim().toLowerCase();
    return entries()
      .filter((e) => !state.folder || e.meta.folder === state.folder)
      .filter((e) => state.status === 'all' || surveyStatus(e.meta) === state.status)
      .filter((e) => !q || (e.meta.title || '').toLowerCase().includes(q))
      .sort(SORTS[state.sort] ? SORTS[state.sort].fn : SORTS.updated.fn);
  }

  function renderSide() {
    const all = entries();
    const counts = {};
    for (const e of all) if (e.meta.folder) counts[e.meta.folder] = (counts[e.meta.folder] || 0) + 1;
    const item = (label, iconName, href, current, count) =>
      h('a', { class: 'side-item', href, 'aria-current': current ? 'page' : undefined, onclick: () => toggleSide(false) },
        icon(iconName), h('span', { class: 'label' }, label), count != null ? h('span', { class: 'count' }, fmtNum(count)) : null);
    const folderRows = Object.entries(folders)
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([fid, f]) => {
        const menuBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm row-menu', 'aria-label': `Folder actions for ${f.name}`, 'aria-haspopup': 'menu' }, icon('more'));
        menuBtn.addEventListener('click', () =>
          showMenu(menuBtn, [
            { label: 'Rename', icon: 'edit', run: async () => {
              const name = await promptDialog({ title: 'Rename folder', label: 'Folder name', value: f.name, maxLength: 100 });
              if (!name) return;
              try {
                await repo.renameFolder(fid, name);
                folders = await repo.loadFolders();
                render();
              } catch {
                toastError('Could not rename the folder.');
              }
            } },
            { label: 'Delete folder', icon: 'trash', danger: true, run: async () => {
              const ok = await confirmDialog({ title: 'Delete folder?', message: `The surveys in “${f.name}” are kept and move back to All surveys.`, confirm: 'Delete folder', danger: true });
              if (!ok) return;
              try {
                await repo.deleteFolder(fid);
                [index, folders] = [repo.index, await repo.loadFolders()];
              } catch {
                toastError('Could not delete the folder.');
                return;
              }
              if (state.folder === fid) app.go('/');
              else render();
            } },
          ], { label: 'Folder actions' }),
        );
        const row = h('div', { class: 'side-row' }, item(f.name, state.folder === fid ? 'folderOpen' : 'folder', `#/?folder=${fid}`, state.folder === fid, counts[fid] || 0), menuBtn);
        // Drop surveys on a folder to file them.
        row.addEventListener('dragover', (e) => {
          if (e.dataTransfer.types.includes('application/x-survey-ids')) {
            e.preventDefault();
            row.classList.add('drop-target');
          }
        });
        row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
        row.addEventListener('drop', (e) => {
          row.classList.remove('drop-target');
          const ids = e.dataTransfer.getData('application/x-survey-ids');
          if (ids) {
            e.preventDefault();
            moveTo(ids.split(','), fid);
          }
        });
        return row;
      });
    replace(
      side,
      item('All surveys', 'clipboard', '#/', !state.folder, all.length),
      h('div', { class: 'side-head' }, h('span', { id: 'folders-head' }, 'Folders'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'New folder', onclick: () => newFolder() }, icon('plus'))),
      folderRows.length ? folderRows : h('p', { class: 'side-hint' }, 'Group related surveys into folders.'),
      h('div', { class: 'side-foot' },
        h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, githubMark(13), 'Open source on GitHub'),
        h('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Powered by Puter')),
    );
  }

  const searchInput = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search surveys',
    'aria-label': 'Search surveys',
    oninput: debounce(() => {
      state.query = searchInput.value;
      renderList();
    }, 120),
  });
  const statusSelect = h(
    'select',
    { class: 'select', 'aria-label': 'Filter by status', onchange: () => ((state.status = statusSelect.value), renderList()) },
    h('option', { value: 'all' }, 'All statuses'),
    h('option', { value: 'draft' }, 'Drafts'),
    h('option', { value: 'open' }, 'Open'),
    h('option', { value: 'closed' }, 'Closed'),
  );
  const sortSelect = h(
    'select',
    {
      class: 'select',
      'aria-label': 'Sort by',
      onchange: () => {
        state.sort = sortSelect.value;
        app.setSetting({ sort: state.sort });
        renderList();
      },
    },
    Object.entries(SORTS).map(([k, s]) => h('option', { value: k, selected: k === state.sort }, `Sort: ${s.label}`)),
  );
  const listBody = h('div');
  const listHost = h(
    'section',
    { class: 'list-panel', 'aria-labelledby': 'list-title' },
    h('h2', { class: 'sr-only', id: 'list-title' }, 'Your surveys'),
    h('div', { class: 'list-tools' }, h('div', { class: 'search' }, icon('search'), searchInput), statusSelect, sortSelect),
    listBody,
  );

  // Each redraw replaces the rows. Where focus was: which control, on which
  // survey (for the selection bar, the first survey selected), and where
  // that survey was in the list.
  function focusSpot() {
    const a = document.activeElement;
    if (!a || !listBody.contains(a) || !a.dataset.fk) return null;
    const row = a.closest('.survey-row') || listBody.querySelector('.survey-row.selected');
    const at = row ? [...listBody.querySelectorAll('.survey-row')].indexOf(row) : 0;
    return { fk: a.dataset.fk, sid: row && row.dataset.sid, at, bar: !a.closest('.survey-row') };
  }

  // Back to the same control, or, with the survey or the selection bar gone
  // (deleted, moved out of this folder, selection cleared), the same place
  // in the survey now nearest.
  function restoreFocus(spot) {
    if (!spot || (document.activeElement && document.activeElement !== document.body)) return;
    const rows = [...listBody.querySelectorAll('.survey-row')];
    const same = rows.find((r) => r.dataset.sid === spot.sid);
    const row = same || rows[Math.min(spot.at, rows.length - 1)];
    const bar = spot.bar && listBody.querySelector(`[data-fk="${spot.fk}"]`);
    const target =
      bar ||
      (row && row.querySelector(`[data-fk="${spot.bar ? 'select' : spot.fk}"]`)) ||
      listBody.querySelector('a[href], button') ||
      searchInput;
    // A background refresh must not scroll back to a control left in place.
    target.focus({ preventScroll: !!(bar || same) });
  }

  function renderList(spot = focusSpot()) {
    const rows = filtered();
    const total = entries().filter((e) => !state.folder || e.meta.folder === state.folder).length;
    // Bulk actions apply to what is on screen: a search or filter that hides
    // a selected survey drops it from the selection.
    const shown = new Set(rows.map((e) => e.sid));
    for (const sid of [...state.selected]) if (!index[sid] || !shown.has(sid)) state.selected.delete(sid);
    const sel = state.selected;
    const bulk = sel.size
      ? h(
          'div',
          { class: 'bulk-bar', role: 'region', 'aria-label': 'Selected surveys' },
          h('span', { class: 'grow' }, `${sel.size} selected`),
          h('button', { type: 'button', class: 'btn btn-sm', 'data-fk': 'bulk-move', onclick: (e) => folderPicker(e.currentTarget, [...sel]) }, icon('folder'), 'Move'),
          h('button', { type: 'button', class: 'btn btn-sm btn-danger', 'data-fk': 'bulk-delete', onclick: () => remove(sel) }, icon('trash'), 'Delete'),
          h('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'data-fk': 'bulk-clear', onclick: () => (sel.clear(), renderList()) }, 'Clear'),
        )
      : null;

    let body;
    if (!total) {
      body = h(
        'div',
        { class: 'empty' },
        h('div', { class: 'empty-icon' }, icon('clipboard', { size: 22 })),
        h('h3', null, state.folder ? 'This folder is empty' : 'No surveys yet'),
        h('p', null, state.folder ? 'Move surveys here from their menu, or drag them onto the folder.' : 'Start from scratch, pick a template, or describe what you want to learn.'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => createFrom(makeSurvey()) }, icon('plus'), 'Create a survey'),
      );
    } else if (!rows.length) {
      body = h('div', { class: 'empty' }, h('h3', null, 'No matching surveys'), h('p', null, 'Try a different search or filter.'));
    } else {
      body = h(
        'ul',
        { class: 'survey-list', 'aria-label': 'Surveys' },
        rows.map(({ sid, meta }) => {
          const status = surveyStatus(meta);
          const box = h('input', {
            type: 'checkbox',
            checked: sel.has(sid),
            'aria-label': `Select ${meta.title}`,
            'data-fk': 'select',
            onchange: () => {
              if (box.checked) sel.add(sid);
              else sel.delete(sid);
              renderList();
            },
          });
          const more = h('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': `More actions for ${meta.title}`, 'aria-haspopup': 'menu', 'data-fk': 'more' }, icon('more'));
          more.addEventListener('click', () => rowMenu(more, sid));
          const primaryHref = status === 'draft' ? `#/s/${sid}/design` : `#/s/${sid}/analyze`;
          const li = h(
            'li',
            // Selection is the row's checkbox: aria-selected is not for list items.
            { class: `survey-row${sel.has(sid) ? ' selected' : ''}`, 'data-sid': sid, draggable: 'true' },
            box,
            h('span', { class: 'chip-cell' }, h('span', { class: `chip chip-${status}` }, STATUS_LABEL[status])),
            h(
              'div',
              { class: 'survey-info' },
              h('a', { class: 'survey-title', href: `#/s/${sid}/design`, 'data-fk': 'title' }, meta.title || 'Untitled survey'),
              h(
                'div',
                { class: 'survey-sub' },
                h('span', { title: fmtDate(meta.updatedAt) }, icon('clock', { size: 12 }), `Edited ${fmtRelative(meta.updatedAt)}`),
                h('span', null, plural(meta.questions || 0, 'question')),
                meta.folder && folders[meta.folder] && !state.folder ? h('span', null, icon('folder', { size: 12 }), folders[meta.folder].name) : null,
              ),
            ),
            h('div', { class: 'survey-count' }, h('strong', null, fmtNum(meta.responses || 0)), h('span', null, meta.responses === 1 ? 'response' : 'responses')),
            h('a', { class: 'btn btn-sm action-cell', href: primaryHref, 'data-fk': 'open' }, status === 'draft' ? 'Edit survey' : 'View results'),
            more,
          );
          li.addEventListener('dragstart', (e) => {
            const ids = sel.has(sid) ? [...sel] : [sid];
            e.dataTransfer.setData('application/x-survey-ids', ids.join(','));
            e.dataTransfer.effectAllowed = 'move';
          });
          return li;
        }),
      );
    }
    // The toolbar is built once and never redrawn, so the search box keeps
    // focus (and the selects keep keyboard focus) while the list updates.
    replace(
      listBody,
      bulk,
      body,
      rows.length ? h('div', { class: 'list-foot', role: 'status' }, rows.length === total ? plural(total, 'survey') : `Showing ${fmtNum(rows.length)} of ${plural(total, 'survey')}`) : null,
    );
    restoreFocus(spot);
  }

  // Built once, so redraws (a new folder, a rename, a background count
  // refresh) keep what is being typed.
  const aiInput = h('input', { type: 'text', placeholder: 'Describe what you want to learn, and AI drafts the questions', 'aria-label': 'Describe your survey for AI', maxlength: '2000' });
  const aiForm = app.backend.ai
    ? h(
        'form',
        {
          class: 'ai-prompt',
          onsubmit: async (e) => {
            e.preventDefault();
            createFrom(await generateWithAI(app, aiInput.value.trim()));
          },
        },
        icon('sparkles'),
        aiInput,
        h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Generate'),
      )
    : null;

  function render() {
    // A link to a folder that no longer exists shows all surveys, so new
    // ones are not filed into a folder nobody can see.
    if (state.folder && !folders[state.folder]) {
      state.folder = '';
      if (/[?&]folder=/.test(location.hash)) history.replaceState(history.state, '', '#/');
    }
    renderSide();
    const folderName = state.folder && folders[state.folder] ? folders[state.folder].name : '';
    // Moving these into the new page blurs them: noted to give focus back
    // to someone typing or choosing.
    const kept = [aiInput, searchInput, statusSelect, sortSelect].find((n) => n && n === document.activeElement);
    const typing = kept && kept.tagName === 'INPUT' ? [kept.selectionStart, kept.selectionEnd] : null;
    // Noted before the list moves into the new page, which blurs it.
    const spot = focusSpot();
    const starters = folderName
      ? null
      : h(
          'div',
          { class: 'starters' },
          starter('file', 'Start from scratch', 'A blank survey', () => createFrom(makeSurvey())),
          starter('template', 'Use a template', 'Ready-made, fully editable', async () => createFrom(await chooseTemplate(app))),
          starter('upload', 'Import questions', 'Paste a list or open a file', async () => createFrom(await importSurvey(app))),
        );
    replace(
      mainCol,
      h(
        'div',
        { class: 'home-inner' },
        h('div', { class: 'home-head' }, h('h1', null, folderName || 'Surveys'),
          h('button', { type: 'button', class: 'btn btn-primary', 'aria-haspopup': 'menu', onclick: (e) => createMenu(e.currentTarget) }, icon('plus'), 'Create survey')),
        starters,
        folderName ? null : aiForm,
        listHost,
      ),
    );
    if (kept && kept.isConnected) {
      kept.focus({ preventScroll: true });
      if (typing) kept.setSelectionRange(typing[0], typing[1]);
    }
    renderList(spot);
  }

  function starter(iconName, title, sub, run) {
    return h('button', { type: 'button', class: 'starter', onclick: run }, h('span', { class: 'starter-icon' }, icon(iconName, { size: 18 })), h('span', null, h('strong', null, title), h('span', null, sub)));
  }

  function onKey(e) {
    if (!singleKeysOn() || document.querySelector('dialog[open], .menu') || isEditable(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      searchInput.focus();
    } else if (e.key === 'n' || e.key === 'N') {
      // Not on the error screen, which has no Create button to open from.
      const createBtn = mainCol.querySelector('.home-head .btn-primary');
      if (!createBtn) return;
      e.preventDefault();
      createMenu(createBtn);
    }
  }
  document.addEventListener('keydown', onKey);

  replace(mainCol, h('div', { class: 'view-loading' }, h('div', { class: 'spinner' })));
  await load().catch((err) => {
    console.error(err);
    replace(mainCol, h('div', { class: 'empty' }, h('h3', null, 'Could not load your surveys'), h('p', null, 'Check your connection and reload.'),
      h('button', { type: 'button', class: 'btn', onclick: () => location.reload() }, 'Reload')));
  });
  document.title = 'Surveys';

  return {
    update(r) {
      state.folder = r.folder || '';
      state.selected.clear();
      render();
    },
    unmount() {
      document.removeEventListener('keydown', onKey);
    },
  };
}

