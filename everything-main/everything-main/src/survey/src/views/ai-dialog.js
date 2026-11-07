/**
 * Draft a survey with AI: describe the goal, optionally steer length,
 * audience and tone, review an outline of the draft, then create it. Every
 * state has a way out: generation can be cancelled, errors offer a retry,
 * and a hung request times out instead of spinning forever.
 */
import '../styles/create.css';
import { h, replace, announce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openDialog } from '../lib/ui.js';
import { plural } from '../lib/format.js';
import { questionCount } from '../model/survey.js';
import { generateSurvey } from '../model/ai.js';
import { surveyOutline } from './templates-dialog.js';

const TIMEOUT_MS = 90_000;

function errorMessage(err) {
  if (err && err.name === 'AbortError') return '';
  const msg = String((err && (err.message || err.error || err.code)) || '');
  if (/insufficient|funds|credit|quota|limit/i.test(msg)) return 'Your Puter account has run out of AI credits for now. Try again later.';
  if (/network|fetch|connection|offline/i.test(msg)) return 'Could not reach the AI service. Check your connection and try again.';
  if (/JSON|survey|usable|empty/i.test(msg)) return 'The AI reply could not be turned into a survey. Try again, or describe your goal in more detail.';
  return 'Something went wrong while drafting. Please try again.';
}

export function openAiDialog(app, prompt = '') {
  const ai = app && app.backend ? app.backend.ai : null;
  let controller = null;

  return openDialog({
    title: 'Draft a survey with AI',
    className: 'ai-dialog',
    build: (close) => {
      if (!ai) {
        return {
          body: h(
            'div',
            { class: 'ai-unavailable' },
            h('div', { class: 'empty-icon' }, icon('sparkles', { size: 22 })),
            h('p', null, 'AI drafting needs a Puter account. Sign in with Puter to describe a survey and have AI write the first draft.'),
            h('p', { class: 'muted' }, 'You can still start from a template or import questions you already have.'),
          ),
          foot: h('button', { type: 'button', class: 'btn btn-primary', autofocus: true, onclick: () => close(null) }, 'Close'),
        };
      }

      let result = null;
      const goal = h('textarea', {
        class: 'textarea',
        id: 'ai-goal',
        rows: '4',
        maxlength: '2000',
        placeholder: 'For example: Find out how customers feel about our new delivery service and what would make them order more often.',
        required: true,
      });
      goal.value = prompt || '';
      const count = h(
        'select',
        { class: 'select', id: 'ai-count' },
        h('option', { value: '0' }, 'Let AI decide'),
        [5, 10, 15, 20].map((n) => h('option', { value: String(n) }, `About ${n}`)),
      );
      const audience = h('input', { class: 'input', id: 'ai-audience', maxlength: '200', placeholder: 'Customers, employees, students…' });
      const tone = h(
        'select',
        { class: 'select', id: 'ai-tone' },
        ['Neutral', 'Friendly', 'Formal', 'Playful'].map((t) => h('option', { value: t.toLowerCase() }, t)),
      );
      const formError = h('p', { class: 'ai-field-error', role: 'alert' });
      const form = h(
        'form',
        { class: 'ai-form', onsubmit: (e) => (e.preventDefault(), generate()) },
        h('div', { class: 'field' }, h('label', { for: 'ai-goal' }, 'What do you want to learn?'), goal, formError),
        h(
          'div',
          { class: 'ai-row' },
          h('div', { class: 'field' }, h('label', { for: 'ai-count' }, 'Questions'), count),
          h('div', { class: 'field' }, h('label', { for: 'ai-audience' }, 'Audience (optional)'), audience),
          h('div', { class: 'field' }, h('label', { for: 'ai-tone' }, 'Tone'), tone),
        ),
        h('p', { class: 'field-hint' }, 'AI drafts can contain mistakes. You can edit every question before you share the survey.'),
      );
      const body = h('div', { class: 'ai-body' });
      const foot = h('div', { class: 'ai-foot' });

      function showForm() {
        result = null;
        replace(body, form);
        replace(
          foot,
          h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Cancel'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => form.requestSubmit() }, icon('sparkles', { size: 14 }), 'Generate'),
        );
        requestAnimationFrame(() => goal.focus());
      }

      async function generate() {
        const text = goal.value.trim();
        if (text.length < 8) {
          formError.textContent = 'Describe your goal in a few more words.';
          goal.setAttribute('aria-invalid', 'true');
          goal.focus();
          return;
        }
        formError.textContent = '';
        goal.removeAttribute('aria-invalid');
        controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), TIMEOUT_MS);
        replace(
          body,
          h('div', { class: 'ai-loading', role: 'status' }, h('div', { class: 'spinner' }), h('p', null, 'Drafting your survey…'), h('p', { class: 'muted' }, 'This usually takes 10 to 30 seconds.')),
        );
        const stop = h('button', { type: 'button', class: 'btn', onclick: () => controller && controller.abort() }, 'Stop');
        replace(foot, stop);
        // Generate is gone with the old footer: keep focus in the dialog.
        stop.focus();
        const signal = controller.signal;
        try {
          const request = generateSurvey(ai, text, { questions: Number(count.value), audience: audience.value.trim(), tone: tone.value === 'neutral' ? '' : tone.value }, { signal });
          request.catch(() => {});
          // Race the abort too: Stop and the timeout must work even if the SDK
          // ignores the signal and keeps waiting.
          const aborted = new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason || new DOMException('Aborted', 'AbortError')), { once: true });
          });
          result = await Promise.race([request, aborted]);
          showResult();
        } catch (err) {
          const timedOut = signal.aborted && signal.reason && signal.reason.name === 'TimeoutError';
          if (signal.aborted && !timedOut) {
            showForm();
            announce('Generation stopped');
            return;
          }
          showError(timedOut ? 'The AI took too long to answer. Please try again.' : errorMessage(err));
        } finally {
          clearTimeout(timer);
          controller = null;
        }
      }

      function showError(message) {
        replace(
          body,
          h('div', { class: 'banner banner-error', role: 'alert' }, icon('alert'), h('span', { class: 'grow' }, message)),
          form,
        );
        const retry = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => form.requestSubmit() }, icon('refresh', { size: 14 }), 'Try again');
        replace(foot, h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Cancel'), retry);
        retry.focus();
      }

      function showResult() {
        const n = questionCount(result);
        replace(
          body,
          h(
            'div',
            { class: 'ai-result' },
            h('div', { class: 'ai-result-head' }, h('h3', { tabindex: '-1' }, result.title), h('p', { class: 'muted' }, `${plural(n, 'question')} · ${plural(result.pages.length, 'page')}`)),
            result.description ? h('p', { class: 'tpl-intro' }, result.description) : null,
            h('div', { class: 'ai-outline scroll' }, surveyOutline(result)),
          ),
        );
        replace(
          foot,
          h('button', { type: 'button', class: 'btn', onclick: showForm }, 'Edit request'),
          h('button', { type: 'button', class: 'btn', onclick: () => generate() }, icon('refresh', { size: 14 }), 'Try again'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => close(result) }, 'Create survey'),
        );
        body.querySelector('h3').focus();
        announce(`Draft ready with ${plural(n, 'question')}`);
      }

      showForm();
      return { body, foot };
    },
  }).then((v) => {
    // Closing the dialog mid-request (Escape) abandons the request.
    if (controller) controller.abort();
    return v || null;
  });
}
