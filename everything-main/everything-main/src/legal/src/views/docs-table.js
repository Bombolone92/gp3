/**
 * The documents table with its toolbar (search, filters, upload) and a drop
 * zone over the whole block. Used by the Documents page and embedded in a
 * matter's Documents tab (pass matterId to scope it to that matter).
 */
import '../styles/docs.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { searchBox, select, dataTable, emptyState } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { matterPicker, matterLink, userChip, rememberSort, saveSort } from './common.js';
import { fileIcon } from '../files.js';
import { formatBytes, matches, matterLabel } from '../core/format.js';
import { formatDate, today as dayOf } from '../core/dates.js';
import { openDocumentPreview, documentMenu, categoryOptions } from './docs-actions.js';
import { openUploadDocuments, uploadFiles, bindDrop } from './docs-upload.js';

/**
 * documentsTable({ ctx, matterId, initial: { q, category, matter }, syncQuery })
 * Returns a node.
 */
export function documentsTable({ ctx, matterId = null, initial = {}, syncQuery = false }) {
  const store = app.store;
  const state = { q: initial.q || '', category: initial.category || '', matter: matterId || initial.matter || '' };
  const query = (patch) => syncQuery && setQuery(patch);

  const search = searchBox({
    value: state.q,
    placeholder: 'Search documents',
    label: 'Search documents',
    onInput: (v) => {
      state.q = v;
      query({ q: v });
      refresh();
    },
  });
  const catSel = select({ name: 'category', value: state.category, 'aria-label': 'Category', options: [{ value: '', label: 'All categories' }, ...categoryOptions(state.category).slice(1)] });
  catSel.addEventListener('change', () => {
    state.category = catSel.value;
    query({ category: state.category });
    refresh();
  });
  const matterFilter = matterId
    ? null
    : matterPicker({
        value: state.matter,
        label: 'Filter by matter',
        placeholder: 'All matters',
        onChange: (v) => {
          state.matter = v;
          query({ matter: v });
          refresh();
        },
      });

  const columns = [
    {
      id: 'name',
      label: 'Name',
      fixed: true,
      width: '38%',
      render: (d) => h('button.doc-name', { type: 'button', onClick: () => openDocumentPreview(d) }, h('span.doc-file-icon', icon(fileIcon(d.file?.type, d.name), 16)), h('span.truncate', d.name)),
      sort: (d) => d.name.toLowerCase(),
    },
    ...(matterId
      ? []
      : [
          {
            id: 'matter',
            label: 'Matter',
            render: (d) => (d.matterId ? matterLink(d.matterId, { short: true }) : h('span.subtle', 'Firm')),
            sort: (d) => lookup.matter(d.matterId)?.displayNumber || '',
          },
        ]),
    { id: 'category', label: 'Category', render: (d) => d.category || h('span.subtle', 'None'), sort: (d) => d.category || '' },
    { id: 'size', label: 'Size', align: 'r', render: (d) => h('span.num', formatBytes(d.file?.size)), sort: (d) => d.file?.size || 0 },
    { id: 'author', label: 'Uploaded by', render: (d) => userChip(d.authorId), sort: (d) => lookup.userName(d.authorId) },
    { id: 'date', label: 'Date', width: '120px', render: (d) => (d.createdAt ? formatDate(dayOf(new Date(d.createdAt))) : ''), sort: (d) => d.createdAt || '' },
    {
      id: 'actions',
      label: '',
      srLabel: 'Actions',
      fixed: true,
      width: '52px',
      render: (d) => h('button.icon-btn.sm', { type: 'button', 'aria-label': `Actions for ${d.name}`, onClick: (e) => documentMenu(e.currentTarget, d) }, icon('more', 16)),
    },
  ];

  const table = dataTable({
    caption: 'Documents',
    columns,
    columnsKey: matterId ? 'matter-documents' : 'documents',
    sort: rememberSort('documents', { id: 'date', dir: 'desc' }),
    onSort: (s) => saveSort('documents', s),
    mobile: (d) =>
      h(
        'button.list-item.doc-mobile',
        { type: 'button', onClick: () => openDocumentPreview(d) },
        h('span.doc-file-icon', icon(fileIcon(d.file?.type, d.name), 18)),
        h(
          'span.grow',
          h('span.title.truncate', d.name),
          h(
            'span.sub',
            [d.matterId && !matterId ? lookup.matter(d.matterId)?.displayNumber : '', d.category, formatBytes(d.file?.size), d.createdAt ? formatDate(dayOf(new Date(d.createdAt))) : '']
              .filter(Boolean)
              .join(' · '),
          ),
        ),
      ),
    empty: () => {
      const any = matterId ? store.all('documents').some((d) => d.matterId === matterId) : store.all('documents').length;
      return any
        ? emptyState({ compact: true, icon: 'search', title: 'No matching documents', text: 'Try a different search or category.', headingLevel: 3 })
        : emptyState({
            compact: !!matterId,
            icon: 'folder-open',
            title: 'No documents yet',
            text: 'Upload files or drop them here. You can also generate documents from templates.',
            actions: [h('button.btn.primary', { type: 'button', onClick: () => upload() }, icon('upload', 16), 'Upload')],
            headingLevel: 3,
          });
    },
  });

  // A click anywhere on a row (outside its controls) opens the preview.
  table.node.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, select, label')) return;
    const tr = e.target.closest('tbody tr');
    tr?.querySelector('.doc-name')?.click();
  });

  function rows() {
    return store.all('documents').filter((d) => {
      if (state.matter && d.matterId !== state.matter) return false;
      if (state.category && d.category !== state.category) return false;
      if (state.q) {
        const m = lookup.matter(d.matterId);
        if (!matches(`${d.name} ${d.category || ''} ${d.description || ''} ${m ? matterLabel(m) : ''}`, state.q)) return false;
      }
      return true;
    });
  }

  function refresh() {
    table.setRows(rows());
  }

  const upload = () => openUploadDocuments({ matterId: matterId || state.matter || '', category: state.category });

  const generateBtn = h(
    'button.btn',
    { type: 'button', onClick: () => import('./docs-generate.js').then((m) => m.openGenerateDocument({ matterId: matterId || state.matter || '' })) },
    icon('wand', 16),
    h('span.hide-sm', 'Generate'),
  );

  const dropHint = h('div.drop-overlay', { 'aria-hidden': 'true' }, icon('upload', 26), h('span', 'Drop files to upload'));
  const node = h(
    'div.docs-block',
    h(
      'div.toolbar',
      search,
      matterFilter ? h('div.docs-matter-filter', matterFilter) : null,
      catSel,
      h('div.spacer'),
      table.columnsButton(),
      generateBtn,
      h('button.btn.primary', { type: 'button', onClick: upload }, icon('upload', 16), 'Upload'),
    ),
    table.node,
    dropHint,
  );
  bindDrop(node, (files) => uploadFiles(files, { matterId: matterId || state.matter || null, category: state.category }));

  refresh();
  ctx.watch(['documents', 'matters', 'users', 'settings'], refresh);
  node.refresh = refresh;
  return node;
}
