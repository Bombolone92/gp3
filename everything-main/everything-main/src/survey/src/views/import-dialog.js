/**
 * Import: paste questions from anywhere (parsed by model/text-import.js with
 * a live preview), or open a survey file exported from the surveys list.
 * Resolves with a new, unsaved survey (always a fresh id, so an import can
 * never overwrite an existing survey), or null.
 */
import '../styles/create.css';
import { h, replace, debounce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openDialog } from '../lib/ui.js';
import { plural } from '../lib/format.js';
import { makeSurvey, normalizeSurvey, questionCount } from '../model/survey.js';
import { surveyId } from '../lib/ids.js';
import { parseQuestions, toSurveyPages } from '../model/text-import.js';
import { surveyOutline } from './templates-dialog.js';

const MAX_FILE = 5 * 1024 * 1024;

const EXAMPLE = `How did you hear about us?
- Search engine
- A friend
- Social media
- Other (please specify)

* How satisfied are you with our service?
a) Very satisfied
b) Satisfied
c) Neutral
d) Dissatisfied

Which features do you use? Select all that apply.
[ ] Reports
[ ] Sharing
[ ] Reminders

Any other comments?`;

/** A survey from an exported file's JSON, or an error message. */
export function surveyFromFile(data) {
  if (!data || typeof data !== 'object') return { error: 'This file does not contain a survey.' };
  const raw = data.format === 'puter-survey' ? data.survey : data;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pages)) return { error: 'This file does not contain a survey.' };
  const survey = normalizeSurvey({ ...raw, id: surveyId() });
  if (!questionCount(survey) && !survey.pages.some((p) => p.questions.length)) return { error: 'This survey file has no questions.' };
  return { survey };
}

export function openImportDialog() {
  let tab = 'paste';
  let fileSurvey = null;

  return openDialog({
    title: 'Import questions',
    wide: true,
    className: 'import-dialog',
    build: (close) => {
      const tabs = h('div', { class: 'seg import-tabs', role: 'tablist', 'aria-label': 'Import from' });
      const panel = h('div', { class: 'import-panel', role: 'tabpanel' });
      const importBtn = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Import');

      /* ---- Paste ---- */
      const title = h('input', { class: 'input', id: 'imp-title', maxlength: '300', value: 'Imported survey' });
      const text = h('textarea', {
        class: 'textarea import-text',
        id: 'imp-text',
        spellcheck: 'false',
        placeholder: EXAMPLE,
        'aria-describedby': 'imp-help',
      });
      const preview = h('div', { class: 'import-preview scroll', 'aria-live': 'polite' });
      let parsed = { pages: [], count: 0 };

      const reparse = debounce(() => {
        parsed = parseQuestions(text.value);
        renderPastePreview();
      }, 150);
      text.addEventListener('input', reparse);

      function renderPastePreview() {
        if (!parsed.count) {
          replace(preview, h('div', { class: 'import-empty' }, icon('clipboard', { size: 20 }), h('p', null, 'Detected questions appear here as you paste.')));
        } else {
          replace(
            preview,
            h('p', { class: 'import-count' }, `${plural(parsed.count, 'question')} detected`, parsed.pages.length > 1 ? ` on ${plural(parsed.pages.length, 'page')}` : ''),
            surveyOutline({ pages: parsed.pages }),
          );
        }
        if (tab === 'paste') importBtn.disabled = !parsed.count;
      }

      const pasteView = h(
        'div',
        { class: 'import-paste' },
        h(
          'div',
          { class: 'import-input' },
          h('div', { class: 'field' }, h('label', { for: 'imp-title' }, 'Survey title'), title),
          h(
            'div',
            { class: 'field import-text-field' },
            h('label', { for: 'imp-text' }, 'Questions'),
            text,
            h(
              'p',
              { class: 'field-hint', id: 'imp-help' },
              'Put each question on its own line with its answer choices below it. Leave a blank line between questions. Start a line with * to make a question required, and use --- to start a new page.',
            ),
          ),
        ),
        h('div', { class: 'import-side' }, h('div', { class: 'field-label' }, 'Preview'), preview),
      );

      /* ---- File ---- */
      const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', id: 'imp-file' });
      const fileInfo = h('div', { class: 'import-file-info', 'aria-live': 'polite' });
      const drop = h(
        'label',
        { class: 'dropzone', for: 'imp-file' },
        icon('upload', { size: 22 }),
        h('strong', null, 'Choose a survey file'),
        h('span', { class: 'muted' }, 'or drop it here. Survey files are exported from the surveys list (.json).'),
      );

      async function readFile(file) {
        fileSurvey = null;
        importBtn.disabled = true;
        if (!file) return;
        if (file.size > MAX_FILE) return showFileError('This file is too large to be a survey file.');
        let data;
        try {
          data = JSON.parse(await file.text());
        } catch {
          return showFileError('This file is not a valid survey file.');
        }
        const r = surveyFromFile(data);
        if (r.error) return showFileError(r.error);
        fileSurvey = r.survey;
        replace(
          fileInfo,
          h(
            'div',
            { class: 'import-file-ok' },
            icon('ok', { size: 18 }),
            h('div', null, h('strong', null, fileSurvey.title), h('p', { class: 'muted' }, `${plural(questionCount(fileSurvey), 'question')} · ${plural(fileSurvey.pages.length, 'page')} · from ${file.name}`)),
          ),
        );
        if (tab === 'file') importBtn.disabled = false;
      }

      function showFileError(message) {
        replace(fileInfo, h('div', { class: 'banner banner-error', role: 'alert' }, icon('alert'), h('span', { class: 'grow' }, message)));
      }

      fileInput.addEventListener('change', () => readFile(fileInput.files[0]));
      drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('over');
      });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('over');
        readFile(e.dataTransfer.files[0]);
      });
      const fileView = h('div', { class: 'import-file' }, fileInput, drop, fileInfo);

      /* ---- Tabs ---- */
      const TABS = [
        ['paste', 'Paste questions'],
        ['file', 'Survey file'],
      ];
      function renderTabs() {
        replace(
          tabs,
          TABS.map(([id, label]) =>
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                id: `imp-tab-${id}`,
                'aria-selected': String(tab === id),
                'aria-controls': 'imp-panel',
                tabindex: tab === id ? '0' : '-1',
                onclick: () => switchTo(id),
                onkeydown: (e) => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                  e.preventDefault();
                  switchTo(tab === 'paste' ? 'file' : 'paste');
                  tabs.querySelector('[aria-selected="true"]').focus();
                },
              },
              label,
            ),
          ),
        );
      }
      function switchTo(id) {
        tab = id;
        renderTabs();
        panel.id = 'imp-panel';
        panel.setAttribute('aria-labelledby', `imp-tab-${id}`);
        replace(panel, id === 'paste' ? pasteView : fileView);
        importBtn.disabled = id === 'paste' ? !parsed.count : !fileSurvey;
      }

      importBtn.addEventListener('click', () => {
        if (tab === 'file') {
          if (fileSurvey) close(fileSurvey);
          return;
        }
        parsed = parseQuestions(text.value);
        if (!parsed.count) return;
        const survey = normalizeSurvey(makeSurvey({ title: title.value.trim() || 'Imported survey', pages: toSurveyPages(parsed) }));
        close(survey);
      });

      switchTo('paste');
      renderPastePreview();
      requestAnimationFrame(() => text.focus());

      return {
        body: h('div', { class: 'import' }, tabs, panel),
        foot: [h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Cancel'), importBtn],
      };
    },
  }).then((v) => v || null);
}
