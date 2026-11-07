/**
 * Individual responses: a list on the left, one response read out in full
 * on the right. J and K step through them. On narrow screens the detail
 * takes the whole width and the list opens on demand.
 */
import { h, replace, isEditable, announce } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { confirmDialog, toast, toastError } from '../../lib/ui.js';
import { fmtDateTime, fmtDuration, fmtNum } from '../../lib/format.js';
import { questionNumbers, isAnswerable } from '../../shared/runtime.js';
import { allQuestions } from '../../model/survey.js';
import { answerLines } from '../../analysis/answers.js';
import { DEVICE_LABELS, OUTCOME_LABELS } from '../../analysis/filters.js';
import { singleKeysOn } from '../shortcuts.js';

const LIST_STEP = 200;

export function mountResponses(host, { getSurvey, getCollectors, onDelete }) {
  let all = [];
  let shown = [];
  let numberOf = new Map();
  let selected = null;
  let listLimit = LIST_STEP;

  const list = h('ul', { class: 'an-resp-items', 'aria-label': 'Responses' });
  const listFoot = h('div', { class: 'an-resp-more' });
  const listPane = h('nav', { class: 'an-resp-list scroll', 'aria-label': 'Response list' }, list, listFoot);
  const detail = h('section', { class: 'an-resp-detail scroll', 'aria-live': 'off' });
  const root = h('div', { class: 'an-resp' }, listPane, detail);
  host.append(root);

  /** Open or close the list (it covers the response on narrow screens),
   *  moving focus into it and back out. */
  const toggleList = (open, { focus = false } = {}) => {
    const was = root.classList.contains('list-open');
    root.classList.toggle('list-open', open);
    if (!focus || was === open) return;
    if (open) (list.querySelector('[aria-current="true"]') || list.querySelector('button'))?.focus();
    else detail.querySelector('.an-resp-title h2')?.focus();
  };

  /** Redraw `pane` with `draw`, giving focus back to the control that had
   *  it (by its data-rk key), or to the response title when that control is
   *  gone or disabled, instead of letting it fall to the page. */
  function keepFocus(pane, draw) {
    const a = document.activeElement;
    const key = pane.contains(a) && a.dataset.rk;
    draw();
    if (!key) return;
    let target = pane.querySelector(`[data-rk="${CSS.escape(key)}"]`);
    if (!target || target.disabled) target = detail.querySelector('.an-resp-title h2');
    target?.focus({ preventScroll: true });
  }

  function label(r) {
    return `Response #${numberOf.get(r.key)}`;
  }

  function select(key, { focus = false } = {}) {
    selected = key;
    for (const b of list.querySelectorAll('button[data-key]')) {
      const on = b.dataset.key === key;
      b.setAttribute('aria-current', on ? 'true' : 'false');
      if (on && focus) b.focus();
    }
    const item = list.querySelector(`button[data-key="${key}"]`);
    item?.scrollIntoView?.({ block: 'nearest' });
    keepFocus(detail, drawDetail);
    // Picked from the open list (narrow screens): go on to the response.
    toggleList(false, { focus: true });
  }

  function step(delta) {
    if (!shown.length) return;
    const i = Math.max(0, shown.findIndex((r) => r.key === selected));
    const j = Math.min(shown.length - 1, Math.max(0, i + delta));
    if (j >= listLimit) {
      listLimit = j + LIST_STEP;
      drawList();
    }
    select(shown[j].key);
    announce(`${label(shown[j])}, ${j + 1} of ${shown.length}`);
  }

  function drawList() {
    const collectors = getCollectors();
    replace(
      list,
      shown.slice(0, listLimit).map((r) =>
        h(
          'li',
          null,
          h(
            'button',
            { type: 'button', class: 'an-resp-item', 'data-key': r.key, 'data-rk': `item:${r.key}`, 'aria-current': r.key === selected ? 'true' : 'false', onclick: () => select(r.key) },
            h('span', { class: 'an-resp-num' }, label(r)),
            r.outcome === 'disqualified' ? h('span', { class: 'chip chip-warn' }, 'Disqualified') : null,
            h('span', { class: 'an-resp-sub' }, fmtDateTime(r.at)),
            h('span', { class: 'an-resp-sub' }, (collectors[r.cid] && collectors[r.cid].name) || 'Removed link'),
          ),
        ),
      ),
    );
    replace(
      listFoot,
      shown.length > listLimit
        ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
            const first = listLimit;
            listLimit += LIST_STEP;
            drawList();
            // The button may be gone: go on to the first response added.
            list.querySelectorAll('button[data-key]')[first]?.focus();
          } }, `Show ${fmtNum(Math.min(LIST_STEP, shown.length - listLimit))} more`)
        : null,
    );
  }

  function drawDetail() {
    const r = shown.find((x) => x.key === selected);
    if (!r) {
      replace(detail, h('div', { class: 'empty' }, h('h2', null, all.length ? 'No responses match the filters' : 'No responses yet'), all.length ? h('p', null, 'Change or clear the filters to see more.') : null));
      return;
    }
    const survey = getSurvey();
    const collectors = getCollectors();
    const nums = questionNumbers(survey);
    const i = shown.indexOf(r);
    const took = r.st && r.at > r.st ? fmtDuration(r.at - r.st) : '';
    const answers = r.answers || {};
    const qs = allQuestions(survey).filter(isAnswerable);
    const knownIds = new Set(qs.map((q) => q.id));
    const orphanCount = Object.keys(answers).filter((k) => !knownIds.has(k)).length;
    replace(
      detail,
      h(
        'div',
        { class: 'an-resp-head' },
        h('button', { type: 'button', class: 'btn btn-sm an-resp-listbtn', 'aria-label': 'Show all responses', 'data-rk': 'list', onclick: () => toggleList(true, { focus: true }) }, icon('menu', { size: 14 }), 'All'),
        h('div', { class: 'an-resp-title' }, h('h2', { tabindex: '-1' }, label(r)), h('p', { class: 'faint' }, `${fmtNum(i + 1)} of ${fmtNum(shown.length)}`)),
        h('div', { class: 'an-resp-nav' },
          h('button', { type: 'button', class: 'btn btn-sm btn-icon', 'aria-label': 'Previous response (K)', title: 'Previous (K)', 'data-rk': 'prev', disabled: i === 0, onclick: () => step(-1) }, icon('chevUp', { size: 16 })),
          h('button', { type: 'button', class: 'btn btn-sm btn-icon', 'aria-label': 'Next response (J)', title: 'Next (J)', 'data-rk': 'next', disabled: i === shown.length - 1, onclick: () => step(1) }, icon('chevDown', { size: 16 })),
          h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: () => remove(r) }, icon('trash', { size: 14 }), 'Delete')),
      ),
      h(
        'dl',
        { class: 'an-meta' },
        meta('Link', (collectors[r.cid] && collectors[r.cid].name) || 'Removed link'),
        meta('Started', fmtDateTime(r.st)),
        meta('Submitted', fmtDateTime(r.at)),
        took ? meta('Time taken', took) : null,
        meta('Device', DEVICE_LABELS[(r.meta && r.meta.device) || 'unknown'] || 'Unknown device'),
        meta('Outcome', OUTCOME_LABELS[r.outcome || 'complete'] || r.outcome),
      ),
      h(
        'ol',
        { class: 'an-answers' },
        qs.map((q) => {
          const lines = answerLines(q, answers[q.id]);
          return h(
            'li',
            null,
            h('p', { class: 'an-answer-q' }, h('span', { class: 'an-qnum' }, `Q${nums[q.id]}`), q.title || 'Untitled question'),
            lines.length ? h('div', { class: 'an-answer-a' }, lines.map((l) => h('p', null, l))) : h('p', { class: 'an-answer-a faint' }, 'Skipped'),
          );
        }),
      ),
      orphanCount ? h('p', { class: 'an-note' }, `This response also answered ${orphanCount === 1 ? 'a question' : `${orphanCount} questions`} that no longer exist in the survey. They are kept in exports as JSON.`) : null,
    );
  }

  function meta(k, v) {
    return h('div', null, h('dt', null, k), h('dd', null, v));
  }

  async function remove(r) {
    const ok = await confirmDialog({
      title: 'Delete this response?',
      message: `${label(r)} will be removed from your results permanently. This can’t be undone.`,
      confirm: 'Delete response',
      danger: true,
    });
    if (!ok) return;
    // Pick the neighbor first: deleting redraws through setData, which keeps
    // the selection only if it still exists.
    const i = shown.indexOf(r);
    const next = shown[i + 1] || shown[i - 1];
    selected = next ? next.key : null;
    try {
      await onDelete([r.key]);
      // On to the next response's title, not its Delete button.
      detail.querySelector('.an-resp-title h2')?.focus({ preventScroll: true });
      toast('Response deleted');
    } catch (err) {
      selected = r.key;
      console.error(err);
      toastError('Could not delete the response. Check your connection and try again.');
    }
  }

  // Escape closes the open list (narrow screens).
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('list-open')) {
      e.preventDefault();
      e.stopPropagation();
      toggleList(false);
      detail.querySelector('.an-resp-listbtn')?.focus();
    }
  });

  function onKey(e) {
    if (!singleKeysOn() || e.metaKey || e.ctrlKey || e.altKey || isEditable(document.activeElement) || document.querySelector('dialog[open], .menu')) return;
    if (e.key === 'j' || e.key === 'J') (e.preventDefault(), step(1));
    else if (e.key === 'k' || e.key === 'K') (e.preventDefault(), step(-1));
  }
  document.addEventListener('keydown', onKey);

  return {
    /** `allResponses` oldest first (numbers stay stable under filters);
     *  `filtered` is what to list. */
    setData(allResponses, filtered) {
      all = allResponses;
      numberOf = new Map(all.map((r, i) => [r.key, i + 1]));
      shown = filtered.slice().sort((a, b) => b.at - a.at);
      if (!shown.some((r) => r.key === selected)) selected = shown.length ? shown[0].key : null;
      const idx = shown.findIndex((r) => r.key === selected);
      if (idx >= listLimit) listLimit = idx + LIST_STEP;
      keepFocus(list, drawList);
      keepFocus(detail, drawDetail);
    },
    unmount() {
      document.removeEventListener('keydown', onKey);
    },
  };
}
