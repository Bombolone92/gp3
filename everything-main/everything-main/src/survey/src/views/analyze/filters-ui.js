/**
 * The filter editor: one dialog for every kind of filter, so the choices
 * stay together and the results only re-render once, on Apply.
 */
import { h, replace } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { openDialog } from '../../lib/ui.js';
import { DEVICE_LABELS, OUTCOME_LABELS, emptyFilters, filterableQuestions, ruleVerb } from '../../analysis/filters.js';

function checkList(name, options, picked) {
  return h(
    'div',
    { class: 'an-checks' },
    options.map(([value, label]) =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name, value, checked: picked.includes(value) }), h('span', null, label)),
    ),
  );
}

function group(title, ...content) {
  return h('fieldset', { class: 'an-fgroup' }, h('legend', null, title), ...content);
}

/** Resolves with new filters, or undefined when cancelled. */
export function editFilters({ filters, survey, collectors, devicesSeen }) {
  const fq = filterableQuestions(survey);
  // Only rules the dialog can show: one whose question is gone is dropped.
  let answers = filters.answers.filter((a) => fq.some((x) => x.q.id === a.qid)).map((a) => ({ ...a }));

  return openDialog({
    title: 'Filter responses',
    wide: true,
    build: (close) => {
      const form = h('form', { class: 'an-filter-form' });
      const colOpts = Object.values(collectors)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        .map((c) => [c.id, c.name || 'Untitled link']);
      for (const cid of filters.collectors) if (!collectors[cid]) colOpts.push([cid, 'Removed link']);
      const devices = [...new Set(['desktop', 'tablet', 'mobile', ...devicesSeen])];

      const from = h('input', { class: 'input', type: 'date', name: 'from', value: filters.from, 'aria-label': 'From date' });
      const to = h('input', { class: 'input', type: 'date', name: 'to', value: filters.to, 'aria-label': 'To date' });
      const outcome = h(
        'select',
        { class: 'select', name: 'outcome', 'aria-label': 'Completion' },
        h('option', { value: 'all', selected: filters.outcome === 'all' }, 'All responses'),
        Object.entries(OUTCOME_LABELS).map(([v, l]) => h('option', { value: v, selected: filters.outcome === v }, l)),
      );

      const answerHost = h('div', { class: 'an-answer-rules' });
      const drawAnswers = () => {
        replace(
          answerHost,
          answers.map((a, i) => {
            const info = fq.find((x) => x.q.id === a.qid);
            const verb = h('span', { class: 'faint' }, ruleVerb(info && info.q));
            const qSel = h(
              'select',
              {
                class: 'select',
                'aria-label': `Rule ${i + 1} question`,
                // Only the answer list changes, in place: redrawing the rule
                // would take focus from this list (arrow keys change it on
                // every press on some systems).
                onchange: () => {
                  const next = fq.find((x) => x.q.id === qSel.value);
                  answers[i] = { qid: next.q.id, value: next.values[0].value };
                  replace(vSel, next.values.map((v) => h('option', { value: v.value }, v.label)));
                  vSel.value = answers[i].value;
                  verb.textContent = ruleVerb(next.q);
                },
              },
              fq.map((x) => h('option', { value: x.q.id, selected: x.q.id === a.qid }, `Q${x.number}. ${(x.q.title || 'Untitled').slice(0, 80)}`)),
            );
            const vSel = h(
              'select',
              { class: 'select', 'aria-label': `Rule ${i + 1} answer`, onchange: () => (answers[i].value = vSel.value) },
              info.values.map((v) => h('option', { value: v.value, selected: v.value === a.value }, v.label)),
            );
            return h(
              'div',
              { class: 'an-rule' },
              qSel,
              verb,
              vSel,
              h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': `Remove rule ${i + 1}`, onclick: () => {
                answers.splice(i, 1);
                drawAnswers();
                // On to the rule that took its place, or to adding one.
                const rules = answerHost.querySelectorAll('.an-rule');
                (rules[Math.min(i, rules.length - 1)]?.querySelector('select') || answerHost.querySelector(':scope > button'))?.focus();
              } }, icon('x', { size: 14 })),
            );
          }),
          fq.length
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn-sm',
                  onclick: () => {
                    answers.push({ qid: fq[0].q.id, value: fq[0].values[0].value });
                    drawAnswers();
                    answerHost.querySelector('.an-rule:last-of-type select')?.focus();
                  },
                },
                icon('plus', { size: 14 }),
                'Add answer rule',
              )
            : h('p', { class: 'faint' }, 'Answer rules work with choice, star rating and 0 to 10 questions.'),
        );
      };
      drawAnswers();

      form.append(
        group('Links', colOpts.length ? checkList('collectors', colOpts, filters.collectors) : h('p', { class: 'faint' }, 'No share links yet.')),
        group('Completion', outcome),
        group('Submitted between', h('div', { class: 'an-range' }, from, h('span', { class: 'faint' }, 'and'), to)),
        group('Device', checkList('devices', devices.map((d) => [d, DEVICE_LABELS[d] || d]), filters.devices)),
        group('Answers', h('p', { class: 'faint an-note' }, 'Only include responses where every rule matches.'), answerHost),
      );

      const read = () => {
        const fd = new FormData(form);
        let f = fd.get('from') || '';
        let t = fd.get('to') || '';
        if (f && t && f > t) [f, t] = [t, f];
        return {
          collectors: fd.getAll('collectors'),
          devices: fd.getAll('devices'),
          outcome: fd.get('outcome') || 'all',
          from: f,
          to: t,
          answers,
        };
      };
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        close(read());
      });
      return {
        body: form,
        foot: [
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close(emptyFilters()) }, 'Clear all'),
          h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Cancel'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => form.requestSubmit() }, 'Apply'),
        ],
      };
    },
  });
}
