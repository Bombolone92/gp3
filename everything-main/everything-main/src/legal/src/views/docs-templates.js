/** Document templates: list, editor with a merge field inserter, and actions. */
import '../styles/docs.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { formDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { openMenu } from '../ui/menu.js';
import { field, textInput, textarea, select, emptyState, searchBox } from '../ui/components.js';
import { MERGE_FIELDS } from '../core/merge.js';
import { matches } from '../core/format.js';
import { formatDate, today as dayOf } from '../core/dates.js';
import { categoryOptions } from './docs-actions.js';

const FIELD_RE = /\{\{\s*([a-z_.]+)\s*\}\}/gi;

export function templateFieldCount(body) {
  return new Set([...String(body || '').matchAll(FIELD_RE)].map((m) => m[1].toLowerCase())).size;
}

/** Insert text at the textarea's cursor, keeping undo history where supported. */
function insertAtCursor(ta, text) {
  ta.focus();
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.setRangeText(text, start, end, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

export function openTemplateDialog(tpl = null) {
  const body = textarea({ name: 'body', value: tpl?.body || '', rows: 16, placeholder: 'Dear {{client.first_name}},\n\nType the letter here. Blank lines start new paragraphs.' });
  body.classList.add('tpl-body');
  const inserter = h(
    'div.merge-fields',
    { role: 'group', 'aria-label': 'Insert a merge field' },
    MERGE_FIELDS.map((g) =>
      h(
        'div.merge-group',
        h('div.small-head', g.group),
        h(
          'div.merge-list',
          g.fields.map(([key, label]) => h('button.merge-chip', { type: 'button', title: `Insert {{${key}}}`, onClick: () => insertAtCursor(body, `{{${key}}}`) }, label)),
        ),
      ),
    ),
  );
  return formDialog({
    title: tpl ? 'Edit template' : 'New template',
    size: 'full',
    body: h(
      'div.tpl-editor',
      h(
        'div.stack',
        h(
          'div.grid-2',
          field('Template name', textInput({ name: 'name', value: tpl?.name || '', autofocus: true }), { required: true }),
          field('Category', select({ name: 'category', value: tpl?.category || '', options: categoryOptions(tpl?.category) })),
        ),
        field('Template text', body, { required: true, hint: 'Merge fields like {{client.name}} are filled in from the matter when you generate a document.' }),
      ),
      h('aside.tpl-side', h('h3', 'Merge fields'), h('p.subtle.small', 'Click a field to insert it at the cursor.'), inserter),
    ),
    submitLabel: tpl ? 'Save template' : 'Create template',
    onSubmit: (fd) => {
      const rec = app.store.put('templates', {
        ...(tpl || {}),
        name: String(fd.get('name')).trim(),
        category: fd.get('category') || '',
        body: String(fd.get('body') || ''),
      });
      toast(tpl ? 'Template saved' : 'Template created');
      return rec;
    },
  });
}

async function deleteTemplate(t) {
  const ok = await confirmDialog({ title: 'Delete template?', message: `"${t.name}" will be deleted. Documents already generated from it are kept.`, confirmLabel: 'Delete template', danger: true });
  if (!ok) return;
  app.store.remove('templates', t.id);
  toast('Template deleted', { action: { label: 'Undo', run: () => app.store.restore('templates', t) } });
}

function generate(t) {
  import('./docs-generate.js').then((m) => m.openGenerateDocument({ templateId: t.id }));
}

/** The Templates tab content. */
export function templatesPanel(ctx) {
  let q = '';
  const list = h('div.tpl-grid');
  const search = searchBox({ placeholder: 'Search templates', label: 'Search templates', onInput: (v) => ((q = v), draw()) });
  function draw() {
    const all = [...app.store.all('templates')].sort((a, b) => a.name.localeCompare(b.name));
    const rows = all.filter((t) => matches(`${t.name} ${t.category || ''}`, q));
    if (!rows.length) {
      list.replaceChildren(
        all.length
          ? emptyState({ compact: true, icon: 'search', title: 'No matching templates', headingLevel: 3 })
          : emptyState({
              icon: 'wand',
              title: 'No templates yet',
              text: 'Templates turn letters and forms you write often into documents filled in from any matter.',
              actions: [h('button.btn.primary', { type: 'button', onClick: () => openTemplateDialog() }, icon('plus', 16), 'New template')],
              headingLevel: 3,
            }),
      );
      list.classList.add('is-empty');
      return;
    }
    list.classList.remove('is-empty');
    list.replaceChildren(
      ...rows.map((t) =>
        h(
          'article.tpl-card',
          h(
            'div.tpl-card-head',
            h('span.tpl-icon', icon('file-pen', 18)),
            h(
              'div.grow',
              h('h3.truncate', h('button.link-btn.tpl-title', { type: 'button', onClick: () => openTemplateDialog(t) }, t.name)),
              h('div.subtle.small', [t.category || 'No category', `${templateFieldCount(t.body)} merge fields`].join(' · ')),
            ),
            h(
              'button.icon-btn.sm',
              {
                type: 'button',
                'aria-label': `Actions for ${t.name}`,
                onClick: (e) =>
                  openMenu(e.currentTarget, [
                    { label: 'Generate document', icon: 'wand', run: () => generate(t) },
                    { label: 'Edit', icon: 'pencil', run: () => openTemplateDialog(t) },
                    { label: 'Duplicate', icon: 'copy', run: () => app.store.put('templates', { name: `${t.name} (copy)`, category: t.category, body: t.body }) },
                    { separator: true },
                    { label: 'Delete', icon: 'trash', danger: true, run: () => deleteTemplate(t) },
                  ]),
              },
              icon('more', 16),
            ),
          ),
          h(
            'p.tpl-excerpt',
            String(t.body || '')
              .replace(/\s+/g, ' ')
              .slice(0, 180),
          ),
          h(
            'div.tpl-card-foot',
            h('span.subtle.small', t.updatedAt ? `Updated ${formatDate(dayOf(new Date(t.updatedAt)))}` : ''),
            h('div.spacer'),
            h('button.btn.sm', { type: 'button', onClick: () => generate(t) }, icon('wand', 15), 'Generate'),
          ),
        ),
      ),
    );
  }
  draw();
  ctx.watch(['templates', 'settings'], draw);
  return h('div.tpl-panel', h('div.toolbar', search, h('div.spacer'), h('button.btn.primary', { type: 'button', onClick: () => openTemplateDialog() }, icon('plus', 16), 'New template')), list);
}
