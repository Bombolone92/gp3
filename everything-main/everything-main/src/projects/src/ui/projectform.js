import { el, requireValue } from '../lib/dom.js';
import { fieldId } from '../lib/util.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { radioGroupKeys } from './bits.js';
import { toast } from './toast.js';
import { store, docBrief, colorName, PROJECT_COLORS } from '../lib/store.js';

/**
 * Create (no `project`) or rename/recolor (with `project`) a project.
 *
 * `onDone` runs while the dialog is still open (see the dismissOnBack
 * contract in modal.js): a callback that navigates must use
 * location.replace, so the destination consumes the form's history entry
 * instead of leaving a dead one behind.
 */
export function openProjectForm({ project = null, onDone } = {}) {
  let color = project?.color || PROJECT_COLORS[store.projects.length % PROJECT_COLORS.length];

  const nameId = fieldId('project-name');
  const nameInput = el('input.input', {
    id: nameId,
    type: 'text',
    value: project?.name || '',
    placeholder: 'e.g. Website redesign',
    maxLength: 60,
    required: true,
  });

  const swatches = el('div.swatch-row', { role: 'radiogroup', 'aria-label': 'Project color' });
  function renderSwatches() {
    swatches.replaceChildren(...PROJECT_COLORS.map((c) =>
      el('button.swatch', {
        type: 'button',
        role: 'radio',
        style: { background: c },
        'aria-checked': c === color ? 'true' : 'false',
        tabindex: c === color ? 0 : -1,
        'aria-label': colorName(c),
        title: colorName(c),
        className: `swatch${c === color ? ' selected' : ''}`,
        onclick: () => { color = c; renderSwatches(); },
      })
    ));
  }
  renderSwatches();
  radioGroupKeys(swatches, '.swatch');

  /* Templates: "Blank" plus whatever the user saved from a project menu.
     Only offered when creating — editing a project never re-templates it. */
  let templateId = null;
  const templateWrap = el('div.field.template-field');

  function renderTemplates() {
    templateWrap.replaceChildren();
    if (project || !store.templates.length) return;
    const options = [{ id: null, name: 'Blank', sub: 'To do, In progress, Done' },
      ...store.templates.map((t) => ({
        id: t.id,
        name: t.name,
        sub: [
          `${t.columnCount ?? t.doc?.columns?.length ?? 0} columns`,
          t.labelCount ? `${t.labelCount} labels` : null,
          t.milestoneCount ? `${t.milestoneCount} milestones` : null,
        ].filter(Boolean).join(' · '),
      }))];

    const list = el('div.template-list', { role: 'radiogroup', 'aria-label': 'Start from' },
      options.map((o) => {
        const selected = o.id === templateId;
        const row = el('div.template-row', {
          className: `template-row${selected ? ' selected' : ''}`,
        },
          el('button.template-pick', {
            type: 'button',
            role: 'radio',
            'aria-checked': selected ? 'true' : 'false',
            tabindex: selected ? 0 : -1,
            onclick: () => { templateId = o.id; renderTemplates(); },
          },
            el('span.template-name', {}, o.name),
            o.sub && el('span.template-sub', {}, o.sub)
          ),
          o.id && el('button.icon-btn.small', {
            type: 'button',
            html: icon('trash', 14, 2),
            'aria-label': `Delete template ${o.name}`,
            onclick: async () => {
              try {
                await store.deleteTemplate(o.id);
              } catch (err) {
                // Every other write in this form says when it could not land.
                console.error(err);
                toast('Could not delete that template. Check your connection', { icon: 'cloudOff' });
                return;
              }
              if (templateId === o.id) templateId = null;
              renderTemplates();
            },
          })
        );
        return row;
      })
    );
    radioGroupKeys(list, '.template-pick');
    templateWrap.append(el('span.label', {}, 'Start from'), list);
  }
  renderTemplates();

  /* The brief is prose about the project, so it lives on the document rather
     than the index entry — which means the field waits for that document.
     Editing a project whose document has never been read is normal: the
     sidebar and the home grid only ever need the index. */
  const briefId = fieldId('project-brief');
  const briefInput = el('textarea.input.brief-form-input', {
    id: briefId,
    rows: 4,
    placeholder: 'What is this project for? What does done mean? Markdown is supported',
    disabled: !!project,
  });
  const briefHint = el('p.form-hint', {}, project ? 'Loading the brief…' : '');
  let briefLoaded = false;

  if (project) {
    store.loadProject(project.id).then((doc) => {
      briefLoaded = true;
      briefInput.value = docBrief(doc);
      briefInput.disabled = false;
      briefHint.textContent = 'Shown as an Overview panel at the top of the board.';
    }).catch((err) => {
      console.error(err);
      briefHint.textContent = 'The brief could not be loaded, so it is left as it is.';
    });
  }

  const submitBtn = el('button.btn.btn-primary', { type: 'submit' },
    project ? 'Save changes' : 'Create project');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      // `required` catches an empty field; a name of only spaces gets past it
      // and would otherwise leave the button looking broken.
      const name = requireValue(nameInput, 'A project needs a name.');
      if (!name) return;
      submitBtn.disabled = true;
      try {
        // onDone may navigate, which must happen before close() so the
        // dialog's history entry is consumed rather than popped afterwards
        // (see the dismissOnBack contract in modal.js).
        if (project) {
          await store.updateProjectMeta(project.id, { name, color });
          // Only when the field is showing what is actually stored: a failed
          // load must not save an empty brief over a real one.
          if (briefLoaded && briefInput.value.trim() !== docBrief(store.getDoc(project.id))) {
            store.setProjectBrief(project.id, briefInput.value.trim());
          }
          onDone?.(store.projectEntry(project.id));
          modal.close();
        } else {
          const doc = templateId
            ? await store.createFromTemplate(templateId, { name, color })
            : await store.createProject({ name, color });
          onDone?.(doc);
          modal.close();
        }
      } catch (err) {
        console.error(err);
        submitBtn.disabled = false;
        toast('Could not save the project. Check your connection', { icon: 'cloudOff' });
      }
    },
  },
    el('div.field', {}, el('label.label', { htmlFor: nameId }, 'Name'), nameInput),
    // A radiogroup is not a labelable control, so this one stays a span and
    // the group names itself.
    el('div.field', {}, el('span.label', {}, 'Color'), swatches),
    // Only when editing: a new project is a name and a colour, and asking
    // for a brief up front is the one thing this feature must not do.
    project && el('div.field', {},
      el('label.label', { htmlFor: briefId }, 'Brief'),
      briefInput,
      briefHint
    ),
    templateWrap,
    !project && !store.templates.length && el('p.form-hint', {},
      'You get a board with To do, In progress, and Done. Rename or add columns anytime.'),
    el('div.row.row-end', {},
      el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
      submitBtn
    )
  );

  const modal = openModal({
    title: project ? 'Edit project' : 'New project',
    content: form,
    dismissOnBack: true,
  });
}
