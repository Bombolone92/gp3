/**
 * Templates tab: ready-made sequences (titles, slideshows, countdowns...)
 * that drop into the open project at the playhead, ready to edit.
 */
import { h } from '../../lib/dom.js';
import { TEMPLATES, TEMPLATE_CATEGORIES } from '../../model/templates.js';
import { templateCard, openTemplateDialog } from '../home-templates.js';
import { tabLayout, emptyState } from './common.js';
import { insertTemplate } from '../template-insert.js';
import { toast } from '../dialog.js';

export function templatesTab(ctx) {
  const choose = (tpl) => openTemplateDialog(tpl, {
    actionLabel: 'Insert at playhead',
    busyLabel: 'Adding the template',
    onUse: async (t, opts) => {
      await insertTemplate(ctx, t, opts);
      toast(`${t.name} added. Use Replace clip on the placeholders to put in your own media.`, { kind: 'success', duration: 6000 });
    },
  });
  const layout = tabLayout({
    title: 'Templates',
    categories: [{ id: 'all', label: 'All' }, ...TEMPLATE_CATEGORIES],
    render(cat, q) {
      const list = TEMPLATES.filter((t) => (cat === 'all' || t.category === cat) && (!q || `${t.name} ${t.description}`.toLowerCase().includes(q)));
      if (!list.length) return emptyState('search', 'No templates match', 'Try another word or category.');
      return h('div.tpl-grid.in-panel', { role: 'list', 'aria-label': 'Templates' }, list.map((t) => h('div.tpl-item', { role: 'listitem' }, templateCard(t, { onChoose: choose }))));
    },
  });
  return { el: layout.el, dispose: layout.dispose };
}
