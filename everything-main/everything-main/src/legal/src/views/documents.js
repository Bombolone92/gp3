/** Documents: every file across the firm, plus document templates. */
import '../styles/docs.css';
import { h } from '../ui/dom.js';
import { pageHeader, navTabs } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { app } from '../app.js';
import { documentsTable } from './docs-table.js';
import { templatesPanel } from './docs-templates.js';
import { openUploadDocuments } from './docs-upload.js';

export function render(ctx) {
  const tab = ctx.params.tab === 'templates' ? 'templates' : 'all';
  const header = pageHeader({
    title: 'Documents',
    tabs: navTabs(
      [
        { href: '#/documents', label: 'All documents', current: tab === 'all', count: app.store.all('documents').length },
        { href: '#/documents/templates', label: 'Templates', current: tab === 'templates', count: app.store.all('templates').length },
      ],
      'Document views',
    ),
  });

  if (tab === 'templates') {
    return { title: 'Document templates', node: h('div.page', header, h('section.card.list-card', { 'aria-label': 'Templates' }, templatesPanel(ctx))) };
  }

  const table = documentsTable({ ctx, initial: { q: ctx.query.q, category: ctx.query.category, matter: ctx.query.matter }, syncQuery: true });
  if (ctx.query.upload) {
    setQuery({ upload: '' });
    queueMicrotask(() => openUploadDocuments({ matterId: ctx.query.matter || '' }));
  }
  return {
    title: 'Documents',
    node: h('div.page.fill', header, h('section.card.list-card.docs-card', { 'aria-label': 'Documents' }, table)),
  };
}
