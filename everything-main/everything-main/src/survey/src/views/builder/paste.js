/**
 * Paste a list of questions into the survey being built. The parser is the
 * one the import dialog uses (src/model/text-import.js); here every parsed
 * question lands at the current position, ignoring page breaks.
 */
import { h, replace, debounce } from '../../lib/dom.js';
import { openDialog } from '../../lib/ui.js';
import { TYPE_BY_ID } from '../../model/survey.js';
import { parseQuestions } from '../../model/text-import.js';

const EXAMPLE = `How did you hear about us?
- Search engine
- A friend
- Social media

* How satisfied are you, on a scale of 1 to 5?

What could we do better?`;

export function openPasteQuestions() {
  return openDialog({
    title: 'Paste questions',
    wide: true,
    build: (close) => {
      let found = [];
      const preview = h('ol', { class: 'paste-preview', 'aria-live': 'polite' });
      const count = h('p', { class: 'field-hint' });
      const ta = h('textarea', { class: 'textarea paste-input', rows: 14, placeholder: EXAMPLE, 'aria-label': 'Questions to paste', autofocus: true });
      const add = h('button', { type: 'button', class: 'btn btn-primary', disabled: true, onclick: () => close(found) }, 'Add questions');
      const update = () => {
        found = parseQuestions(ta.value).pages.flatMap((p) => p.questions);
        add.disabled = !found.length;
        add.textContent = found.length ? `Add ${found.length} ${found.length === 1 ? 'question' : 'questions'}` : 'Add questions';
        count.textContent = found.length ? '' : 'Questions you paste show up here.';
        replace(preview, found.map((q) => h('li', null, h('span', null, q.title || q.description || 'Text'), h('span', { class: 'chip chip-plain' }, TYPE_BY_ID[q.type].label))));
      };
      ta.addEventListener('input', debounce(update, 150));
      update();
      return {
        body: h('div', { class: 'paste-layout' },
          h('div', { class: 'field' },
            h('p', { class: 'field-hint' }, 'One question per paragraph. Put answer choices on the lines below a question, with or without bullets. Start a line with * to make a question required.'),
            ta),
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Will be added'), count, preview)),
        foot: [h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Cancel'), add],
      };
    },
  });
}
