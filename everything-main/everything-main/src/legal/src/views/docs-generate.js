/**
 * Document automation: fill a template's merge fields from a matter and save
 * the result as a printable HTML document in that matter's documents.
 */
import '../styles/docs.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, meId } from '../app.js';
import { formDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { navigate } from '../ui/router.js';
import { field, select, textInput } from '../ui/components.js';
import { matterPicker } from './common.js';
import { saveFile } from '../files.js';
import { mergeValues, fillTemplate, missingFields, templateToHtml } from '../core/merge.js';

/** Merge values for a matter (or firm-only values without one). */
export function valuesFor(matterId) {
  const matter = lookup.matter(matterId);
  return mergeValues({
    matter,
    client: matter ? lookup.contact(matter.clientId) : null,
    settings: app.settings(),
    user: app.me(),
    responsible: matter ? lookup.user(matter.responsibleId) : null,
    today: app.today(),
  });
}

/** A safe file name from free text. */
export function docFileName(text) {
  return (
    String(text || 'Document')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90) || 'Document'
  );
}

export function openGenerateDocument({ matterId = '', templateId = '' } = {}) {
  const templates = [...app.store.all('templates')].sort((a, b) => a.name.localeCompare(b.name));
  if (!templates.length) {
    toast('Create a document template first.', { type: 'info' });
    navigate('/documents/templates');
    return Promise.resolve(null);
  }
  const tplSel = select({ name: 'templateId', value: templateId || templates[0].id, options: templates.map((t) => ({ value: t.id, label: t.name })) });
  const matter = matterPicker({ value: matterId || '', label: 'Matter', onChange: () => update() });
  const nameInput = textInput({ name: 'name', value: '' });
  let nameTouched = false;
  nameInput.addEventListener('input', () => (nameTouched = true));
  const warn = h('div.notice.warning', { hidden: true, role: 'status' });
  const preview = h('div.gen-preview', { tabindex: '0', role: 'region', 'aria-label': 'Document preview' });

  function update() {
    const t = app.store.get('templates', tplSel.value);
    const m = lookup.matter(matter.value);
    if (!nameTouched) nameInput.value = docFileName(`${t?.name || 'Document'}${m ? `, ${m.displayNumber}` : ''}`);
    const values = valuesFor(matter.value);
    const text = fillTemplate(t?.body || '', values);
    const missing = missingFields(t?.body || '', values);
    warn.hidden = !missing.length;
    warn.replaceChildren(
      icon('warning', 16),
      h('span', h('strong', `${missing.length} ${missing.length === 1 ? 'field has' : 'fields have'} no value. `), `They appear as [[field]] in the document: ${missing.join(', ')}.`),
    );
    preview.replaceChildren(
      ...String(text)
        .split(/\n{2,}/)
        .map((p) => h('p', ...p.split('\n').flatMap((line, i) => (i ? [h('br'), line] : [line])))),
    );
  }
  tplSel.addEventListener('change', () => update());
  update();
  let saving = false;

  return formDialog({
    title: 'Generate document',
    subtitle: 'Fill a template with details from a matter and save it to the matter’s documents.',
    size: 'wide',
    body: h(
      'div.stack',
      h('div.grid-2', field('Template', tplSel, { required: true }), field('Matter', matter)),
      field('Document name', nameInput, { required: true }),
      warn,
      h('div.field', h('span.small-head', 'Preview'), preview),
    ),
    submitLabel: 'Save document',
    onSubmit: async (fd, form) => {
      // A second click while the file is being saved must not save it twice.
      if (saving) return false;
      const t = app.store.get('templates', tplSel.value);
      if (!t) return false;
      saving = true;
      const btn = form.closest('dialog')?.querySelector('.dialog-foot .btn.primary');
      if (btn) btn.disabled = true;
      const name = `${docFileName(fd.get('name'))}.html`;
      const text = fillTemplate(t.body, valuesFor(matter.value));
      try {
        const ref = await saveFile(new Blob([templateToHtml(name.replace(/\.html$/, ''), text)], { type: 'text/html' }), { folder: matter.value || 'firm', name });
        const rec = app.store.put('documents', {
          matterId: matter.value || null,
          name,
          category: t.category || '',
          folder: '',
          description: `Generated from the "${t.name}" template`,
          authorId: meId(),
          templateId: t.id,
          file: ref,
        });
        toast(`${name} saved`, {
          action: { label: 'Open', run: () => import('./docs-actions.js').then((m) => m.openDocumentPreview(rec)) },
        });
        return rec;
      } catch (err) {
        toast(err?.message || 'The document could not be saved.', { type: 'error' });
        saving = false;
        if (btn) btn.disabled = false;
        return false;
      }
    },
  });
}
