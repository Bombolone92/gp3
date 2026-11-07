/**
 * The inline editor a question opens into on the canvas: Edit (text, type,
 * answers), Options (required, layout, validation, display condition) and
 * Logic (skip logic per answer).
 *
 * Typing goes straight to the session with origin 'input', and the canvas
 * leaves the editor alone for those edits, so the caret never jumps. Any
 * other change (add a choice, switch type, undo) rebuilds the editor, and
 * rebuild() puts focus back on the same control by its data-fk key.
 */
import { h, replace, domId } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { showMenu, openDialog } from '../../lib/ui.js';
import {
  QUESTION_TYPES,
  TYPE_BY_ID,
  CHOICE_TYPES,
  LOGIC_TYPES,
  CONDITION_TYPES,
  ANSWER_PRESETS,
  makeChoice,
  allQuestions,
} from '../../model/survey.js';
import { updateQuestion, convertQuestion } from '../../model/edit.js';
import { splitPastedLines } from '../../model/list-lines.js';
import { CONTACT_FIELDS, OTHER_ID, NONE_ID, isAnswerable, ratingMax, questionNumbers, defaultRequiredMessage } from '../../shared/runtime.js';

/** Per-question editor UI state that outlives rebuilds. */
const uiState = new Map();
function stateFor(qid) {
  if (!uiState.has(qid)) uiState.set(qid, { tab: 'edit', showDesc: false, pendingFocus: null });
  return uiState.get(qid);
}

export function setEditorTab(qid, tab) {
  stateFor(qid).tab = tab;
}

/** Grow a textarea to fit its text. */
function autosize(ta) {
  const fit = () => {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
  };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return ta;
}

function switchRow(label, checked, onChange, { fk, hint } = {}) {
  const id = domId('sw');
  const input = h('input', { type: 'checkbox', role: 'switch', id, checked, 'data-fk': fk, onchange: (e) => onChange(e.target.checked) });
  return h('div', { class: 'opt-row' }, h('label', { class: 'switch', for: id }, h('span', null, label, hint ? h('span', { class: 'field-hint block' }, hint) : null), input));
}

function field(label, control, hint) {
  const id = control.id || domId('f');
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('div', { class: 'field-hint' }, hint) : null);
}

export function createEditor({ session, qid, onDone, onDelete, onDuplicate, onMove }) {
  const st = stateFor(qid);
  const node = h('div', { class: 'q-editor', 'data-qid': qid });
  let q = null;

  const getQ = () => {
    for (const p of session.survey.pages) for (const x of p.questions) if (x.id === qid) return x;
    return null;
  };

  /** Edit this question. Typing passes `input: key` so it coalesces into
   *  one undo step and does not rebuild the editor. */
  function apply(fn, { input = null } = {}) {
    session.apply((s) => updateQuestion(s, qid, fn), input ? { coalesce: `${qid}:${input}`, origin: 'input' } : { origin: 'editor' });
  }
  const patch = (obj, opts) => apply((x) => ({ ...x, ...obj }), opts);

  /* ---- Lists (choices, rows, columns, fields) ---- */

  function listEditor({ key, items, label, addLabel, placeholder, withWeight = false, presets = false, bulk = true }) {
    const list = h('ol', { class: 'list-edit', 'aria-label': label });
    const setItems = (next, focusId) => {
      if (focusId) st.pendingFocus = `${key}:${focusId}`;
      apply((x) => ({ ...x, [key]: next }));
    };
    const current = () => getQ()[key] || [];
    let dragId = null;
    items.forEach((item, i) => {
      const input = h('input', {
        class: 'input input-sm',
        value: item.label,
        placeholder: placeholder(i),
        'aria-label': `${label} ${i + 1}`,
        maxlength: '1000',
        'data-fk': `${key}:${item.id}`,
        oninput: (e) => {
          const v = e.target.value;
          apply((x) => ({ ...x, [key]: x[key].map((c) => (c.id === item.id ? { ...c, label: v } : c)) }), { input: `${key}:${item.id}` });
        },
        onkeydown: (e) => {
          const list2 = current();
          const idx = list2.findIndex((c) => c.id === item.id);
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            // Move into the next blank slot before making new ones: new
            // questions start with empty slots to fill.
            const nextItem = list2[idx + 1];
            if (nextItem && !nextItem.label.trim()) {
              node.querySelector(`[data-fk="${key}:${nextItem.id}"]`)?.focus();
              return;
            }
            const added = withWeight ? { ...makeChoice(''), weight: list2.length + 1 } : makeChoice('');
            const next = list2.slice();
            next.splice(idx + 1, 0, added);
            setItems(next, added.id);
          } else if (e.key === 'Backspace' && !e.target.value && list2.length > 1) {
            e.preventDefault();
            const prev = list2[idx - 1] || list2[idx + 1];
            setItems(list2.filter((c) => c.id !== item.id), prev && prev.id);
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const sib = list2[idx + (e.key === 'ArrowDown' ? 1 : -1)];
            if (sib) {
              e.preventDefault();
              node.querySelector(`[data-fk="${key}:${sib.id}"]`)?.focus();
            }
          }
        },
        onpaste: (e) => {
          // Pasting several lines makes one item per line.
          const text = (e.clipboardData || window.clipboardData).getData('text');
          const lines = splitPastedLines(text);
          if (lines.length < 2) return;
          e.preventDefault();
          const list2 = current();
          const idx = list2.findIndex((c) => c.id === item.id);
          const made = lines.map((l, k) => (withWeight ? { ...makeChoice(l), weight: idx + k + 1 } : makeChoice(l)));
          const next = list2.slice();
          // Lines go into this slot when it is blank and into the blank
          // slots after it (new questions start with some), then add more.
          // A blank slot that skip logic or a condition points at is kept:
          // filling it would drop that rule unseen.
          const survey = session.survey;
          const q0 = getQ();
          const referenced = (id) => !!(q0.logic && q0.logic[id]) || allQuestions(survey).some((x) => x.display && x.display.qid === qid && x.display.value === id);
          const at = e.target.value.trim() ? idx + 1 : idx;
          let fill = 0;
          while (fill < made.length && at + fill < list2.length && (at + fill === idx || (!list2[at + fill].label.trim() && !referenced(list2[at + fill].id)))) fill++;
          next.splice(at, fill, ...made);
          setItems(next, made[made.length - 1].id);
        },
      });
      const weight = withWeight
        ? h('input', {
            class: 'input input-sm weight',
            type: 'number',
            step: 'any',
            value: item.weight != null ? item.weight : i + 1,
            'aria-label': `Score for ${item.label || `column ${i + 1}`}`,
            title: 'Score used for averages',
            'data-fk': `${key}:w:${item.id}`,
            oninput: (e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) apply((x) => ({ ...x, [key]: x[key].map((c) => (c.id === item.id ? { ...c, weight: v } : c)) }), { input: `${key}:w:${item.id}` });
            },
          })
        : null;
      const handle = h('span', { class: 'drag-handle', title: 'Drag to reorder', 'aria-hidden': 'true' }, icon('grip', { size: 14 }));
      const row = h(
        'li',
        { class: 'list-row', 'data-id': item.id },
        handle,
        input,
        weight,
        h('button', {
          type: 'button',
          class: 'btn btn-ghost btn-icon btn-sm',
          'aria-label': `Remove ${item.label || `${label.toLowerCase()} ${i + 1}`}`,
          disabled: items.length <= 1,
          onclick: () => {
            const list2 = current();
            const idx = list2.findIndex((c) => c.id === item.id);
            const sib = list2[idx + 1] || list2[idx - 1];
            setItems(list2.filter((c) => c.id !== item.id), sib && sib.id);
          },
        }, icon('x', { size: 14 })),
      );
      // Reorder by dragging the handle (keyboard users: Alt+Up/Down below).
      handle.addEventListener('pointerdown', () => (row.draggable = true));
      row.addEventListener('dragstart', (e) => {
        dragId = item.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.label);
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        row.draggable = false;
        row.classList.remove('dragging');
        dragId = null;
        // A drag cancelled (Escape) or dropped elsewhere fires no drop or
        // leave here: clear the drop line wherever it was left.
        for (const r of list.querySelectorAll('.drop-before, .drop-after')) r.classList.remove('drop-before', 'drop-after');
      });
      row.addEventListener('dragover', (e) => {
        if (!dragId || dragId === item.id) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        row.classList.toggle('drop-before', e.clientY < r.top + r.height / 2);
        row.classList.toggle('drop-after', e.clientY >= r.top + r.height / 2);
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
      row.addEventListener('drop', (e) => {
        if (!dragId) return;
        e.preventDefault();
        const after = row.classList.contains('drop-after');
        row.classList.remove('drop-before', 'drop-after');
        const list2 = current().slice();
        const from = list2.findIndex((c) => c.id === dragId);
        const [moved] = list2.splice(from, 1);
        let to = list2.findIndex((c) => c.id === item.id);
        if (after) to++;
        list2.splice(to, 0, moved);
        setItems(list2, moved.id);
      });
      input.addEventListener('keydown', (e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        e.stopPropagation();
        const list2 = current().slice();
        const idx = list2.findIndex((c) => c.id === item.id);
        const to = idx + (e.key === 'ArrowUp' ? -1 : 1);
        if (to < 0 || to >= list2.length) return;
        [list2[idx], list2[to]] = [list2[to], list2[idx]];
        setItems(list2, item.id);
      });
      list.append(row);
    });

    const tools = h('div', { class: 'list-tools-row' },
      h('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        onclick: () => {
          const added = withWeight ? { ...makeChoice(''), weight: current().length + 1 } : makeChoice('');
          setItems([...current(), added], added.id);
        },
      }, icon('plus', { size: 14 }), addLabel),
    );
    if (presets) {
      const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-haspopup': 'menu' }, icon('sparkles', { size: 14 }), 'Answer scales');
      btn.addEventListener('click', () =>
        showMenu(btn, ANSWER_PRESETS.map((p) => ({
          label: p.name,
          hint: `${p.items.length}`,
          run: () => {
            const made = p.items.map((l, k) => (withWeight ? { ...makeChoice(l), weight: k + 1 } : makeChoice(l)));
            setItems(made);
          },
        })), { label: 'Answer scales' }),
      );
      tools.append(btn);
    }
    if (bulk) {
      tools.append(h('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        onclick: async () => {
          const text = await bulkDialog(label, current().map((c) => c.label).join('\n'));
          if (text == null) return;
          const old = current();
          const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 500);
          // Keep ids for lines that did not change, so logic and existing
          // results stay attached to them.
          const byLabel = new Map(old.map((c) => [c.label, c]));
          const next = lines.map((l, k) => {
            const keep = byLabel.get(l);
            if (keep) {
              byLabel.delete(l);
              return withWeight ? { ...keep, weight: keep.weight ?? k + 1 } : keep;
            }
            return withWeight ? { ...makeChoice(l), weight: k + 1 } : makeChoice(l);
          });
          setItems(next.length ? next : [makeChoice('')]);
        },
      }, icon('edit', { size: 14 }), 'Edit as text'));
    }
    return h('div', { class: 'list-block' }, h('div', { class: 'field-label' }, label), list, tools);
  }

  function bulkDialog(label, value) {
    return openDialog({
      title: `Edit ${label.toLowerCase()} as text`,
      build: (close) => {
        const ta = h('textarea', { class: 'textarea', rows: 10, value, autofocus: true, 'aria-label': `${label}, one per line` });
        ta.value = value;
        return {
          body: h('div', { class: 'field' }, h('p', { class: 'field-hint' }, 'One per line. Lines you leave unchanged keep their results and logic.'), ta),
          foot: [
            h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Cancel'),
            h('button', { type: 'button', class: 'btn btn-primary', onclick: () => close(ta.value) }, 'Apply'),
          ],
        };
      },
    });
  }

  /* ---- Type-specific bodies ---- */

  function otherControls() {
    const out = [];
    if (q.other) {
      out.push(switchRow('Add an "Other" answer with a text box', q.other.enabled, (v) => patch({ other: { ...getQ().other, enabled: v } }), { fk: 'other' }));
      if (q.other.enabled) {
        out.push(h('div', { class: 'indent' }, h('input', {
          class: 'input input-sm',
          value: q.other.label,
          'aria-label': 'Label for the Other answer',
          'data-fk': 'other-label',
          oninput: (e) => patch({ other: { ...getQ().other, label: e.target.value } }, { input: 'other-label' }),
        })));
      }
    }
    if (q.none) {
      out.push(switchRow('Add a "None of the above" answer', q.none.enabled, (v) => patch({ none: { ...getQ().none, enabled: v } }), { fk: 'none' }));
      if (q.none.enabled) {
        out.push(h('div', { class: 'indent' }, h('input', {
          class: 'input input-sm',
          value: q.none.label,
          'aria-label': 'Label for the None answer',
          'data-fk': 'none-label',
          oninput: (e) => patch({ none: { ...getQ().none, label: e.target.value } }, { input: 'none-label' }),
        })));
      }
    }
    return out;
  }

  function numInput(value, label, fk, onValue, extra = {}) {
    return h('input', {
      class: 'input input-sm',
      type: 'number',
      value,
      'aria-label': label,
      'data-fk': fk,
      oninput: (e) => onValue(e.target.value),
      ...extra,
    });
  }

  function textInput(value, label, fk, onValue, extra = {}) {
    return h('input', { class: 'input input-sm', value, 'aria-label': label, 'data-fk': fk, maxlength: '200', oninput: (e) => onValue(e.target.value), ...extra });
  }

  function labelsRow() {
    return h('div', { class: 'grid2' },
      field('Low end label', textInput(q.minLabel || '', 'Low end label', 'minLabel', (v) => patch({ minLabel: v }, { input: 'minLabel' }), { placeholder: 'Optional' })),
      field('High end label', textInput(q.maxLabel || '', 'High end label', 'maxLabel', (v) => patch({ maxLabel: v }, { input: 'maxLabel' }), { placeholder: 'Optional' })),
    );
  }

  function typeBody() {
    switch (q.type) {
      case 'single':
      case 'multi':
      case 'dropdown':
        return [listEditor({ key: 'choices', items: q.choices, label: 'Answer choices', addLabel: 'Add choice', placeholder: (i) => `Choice ${i + 1}`, presets: true }), ...otherControls()];
      case 'ranking':
        return listEditor({ key: 'choices', items: q.choices, label: 'Items to rank', addLabel: 'Add item', placeholder: (i) => `Item ${i + 1}` });
      case 'matrix':
        return [
          listEditor({ key: 'rows', items: q.rows, label: 'Rows', addLabel: 'Add row', placeholder: (i) => `Row ${i + 1}` }),
          listEditor({ key: 'columns', items: q.columns, label: 'Columns', addLabel: 'Add column', placeholder: (i) => `Column ${i + 1}`, withWeight: true, presets: true }),
          switchRow('Allow more than one answer per row', q.multi, (v) => patch({ multi: v }), { fk: 'multi' }),
        ];
      case 'rating': {
        const sel = h('select', { class: 'select select-sm', 'data-fk': 'scale', onchange: (e) => patch({ scale: Number(e.target.value) }) },
          Array.from({ length: 9 }, (_, i) => i + 2).map((n) => h('option', { value: n, selected: n === ratingMax(q) }, `${n} points`)));
        const shapes = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Symbol' },
          [['star', 'Stars', 'rating'], ['heart', 'Hearts', 'heart'], ['thumb', 'Thumbs', 'thumb'], ['circle', 'Circles', 'circle']].map(([v, l, ic]) =>
            h('button', { type: 'button', role: 'radio', 'aria-checked': String((q.shape || 'star') === v), 'data-fk': `shape:${v}`, onclick: () => patch({ shape: v }) }, icon(ic, { size: 14 }), l)));
        return [h('div', { class: 'grid2' }, field('Scale', sel), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Symbol'), shapes)), labelsRow()];
      }
      case 'nps':
        return [h('p', { class: 'field-hint' }, 'Respondents pick a number from 0 to 10. Results show the share of promoters (9 and 10) minus detractors (0 to 6).'), labelsRow()];
      case 'slider':
        return [
          h('div', { class: 'grid3' },
            field('Minimum', numInput(q.min, 'Minimum', 'min', (v) => v !== '' && patch({ min: Number(v) }, { input: 'min' }))),
            field('Maximum', numInput(q.max, 'Maximum', 'max', (v) => v !== '' && patch({ max: Number(v) }, { input: 'max' }))),
            field('Step', numInput(q.step, 'Step', 'step', (v) => Number(v) > 0 && patch({ step: Number(v) }, { input: 'step' }), { min: '0', step: 'any' })),
          ),
          labelsRow(),
        ];
      case 'text':
      case 'textarea':
        return [field('Placeholder', textInput(q.placeholder || '', 'Placeholder', 'placeholder', (v) => patch({ placeholder: v }, { input: 'placeholder' }), { placeholder: 'Shown in the empty box (optional)' }))];
      case 'multitext':
        return listEditor({ key: 'fields', items: q.fields, label: 'Boxes', addLabel: 'Add box', placeholder: (i) => `Box ${i + 1} label` });
      case 'contact':
        return h('table', { class: 'contact-table' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Field'), h('th', { scope: 'col' }, 'Show'), h('th', { scope: 'col' }, 'Required'))),
          h('tbody', null, CONTACT_FIELDS.map(([id, def]) => {
            const f = q.fields[id] || { enabled: false, required: false, label: def };
            const set = (p, opts) => apply((x) => ({ ...x, fields: { ...x.fields, [id]: { ...x.fields[id], ...p } } }), opts);
            return h('tr', null,
              h('td', null, h('input', { class: 'input input-sm', value: f.label, 'aria-label': `Label for ${def}`, 'data-fk': `cf:${id}`, oninput: (e) => set({ label: e.target.value }, { input: `cf:${id}` }) })),
              h('td', null, h('input', { type: 'checkbox', checked: f.enabled, 'aria-label': `Show ${def}`, 'data-fk': `cfe:${id}`, onchange: (e) => set({ enabled: e.target.checked, required: e.target.checked ? f.required : false }) })),
              h('td', null, h('input', { type: 'checkbox', checked: f.required, disabled: !f.enabled, 'aria-label': `${def} is required`, 'data-fk': `cfr:${id}`, onchange: (e) => set({ required: e.target.checked }) })));
          })));
      case 'datetime':
        // One of the two is always asked: turning off the only one turns
        // the other on.
        return h('div', { class: 'opt-stack' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: q.date !== false, 'data-fk': 'date', onchange: (e) => patch({ date: e.target.checked, time: e.target.checked ? !!q.time : true }) }), 'Ask for a date'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!q.time, 'data-fk': 'time', onchange: (e) => patch({ time: e.target.checked, date: e.target.checked ? q.date !== false : true }) }), 'Ask for a time'));
      default:
        return null;
    }
  }

  /* ---- Tabs ---- */

  function editTab() {
    const title = autosize(h('textarea', {
      class: 'textarea q-title-input',
      rows: 1,
      placeholder: q.type === 'statement' ? 'Heading (optional)' : 'Type your question',
      'aria-label': q.type === 'statement' ? 'Heading' : 'Question text',
      maxlength: '5000',
      'data-fk': 'title',
      oninput: (e) => patch({ title: e.target.value }, { input: 'title' }),
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey && q.type !== 'statement') {
          // Enter moves on to the first answer, the way people expect.
          e.preventDefault();
          node.querySelector('.list-edit input, .q-body input, .q-body select')?.focus();
        }
      },
    }));
    title.value = q.title;
    const typeBtn = h('button', { type: 'button', class: 'btn type-btn', 'aria-haspopup': 'menu', 'data-fk': 'type', 'aria-label': `Question type: ${TYPE_BY_ID[q.type].label}. Change` },
      icon(TYPE_BY_ID[q.type].icon), h('span', null, TYPE_BY_ID[q.type].label), icon('chevDown', { size: 14 }));
    typeBtn.addEventListener('click', () =>
      showMenu(typeBtn, QUESTION_TYPES.map((t) => ({
        label: t.label,
        icon: t.icon,
        checked: t.type === q.type,
        run: () => {
          st.pendingFocus = 'type';
          apply((x) => convertQuestion(x, t.type));
        },
      })), { label: 'Question type' }),
    );
    const showDesc = st.showDesc || !!q.description;
    const desc = showDesc
      ? autosize(h('textarea', {
          class: 'textarea q-desc-input',
          rows: 1,
          placeholder: q.type === 'statement' ? 'Text shown to respondents' : 'Add instructions or context (optional)',
          'aria-label': 'Description',
          maxlength: '5000',
          'data-fk': 'desc',
          oninput: (e) => patch({ description: e.target.value }, { input: 'desc' }),
        }))
      : null;
    if (desc) desc.value = q.description;
    const addDesc = !showDesc
      ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-fk': 'add-desc', onclick: () => {
          st.showDesc = true;
          st.pendingFocus = 'desc';
          rebuild();
        } }, icon('plus', { size: 14 }), q.type === 'statement' ? 'Add text' : 'Add description')
      : null;
    return h('div', { class: 'q-edit-body' },
      h('div', { class: 'q-title-row' }, title, typeBtn),
      desc,
      addDesc,
      h('div', { class: 'q-body' }, typeBody()),
    );
  }

  function conditionEditor() {
    const survey = session.survey;
    const before = [];
    for (const x of allQuestions(survey)) {
      if (x.id === qid) break;
      if (isAnswerable(x)) before.push(x);
    }
    const cond = q.display || null;
    const mode = h('select', { class: 'select select-sm', 'data-fk': 'cond-mode', 'aria-label': 'When to show this question', onchange: (e) => {
      if (e.target.value === 'always') apply((x) => {
        const n = { ...x };
        delete n.display;
        return n;
      });
      else {
        const src = before[before.length - 1];
        if (src) patch({ display: { qid: src.id, op: 'answered', value: '' } });
      }
    } },
    h('option', { value: 'always', selected: !cond }, 'Always'),
    h('option', { value: 'if', selected: !!cond, disabled: !before.length }, 'Only if an earlier answer matches'));
    const out = [field('Show this question', mode, before.length ? null : 'Conditions can only look at questions earlier in the survey.')];
    const src = cond && (before.find((x) => x.id === cond.qid) || before[before.length - 1]);
    if (src) {
      const numbers = new Map(allQuestions(survey).filter(isAnswerable).map((x, i) => [x.id, i + 1]));
      const qSel = h('select', { class: 'select select-sm', 'aria-label': 'Earlier question', 'data-fk': 'cond-q', onchange: (e) => patch({ display: { qid: e.target.value, op: 'answered', value: '' } }) },
        before.map((x) => h('option', { value: x.id, selected: x.id === src.id }, `Q${numbers.get(x.id)}. ${(x.title || 'Untitled').slice(0, 60)}`)));
      const canCompare = CONDITION_TYPES.includes(src.type);
      const ops = [['answered', 'is answered'], ['notAnswered', 'is not answered']];
      // A checkbox answer can hold several choices: it includes one.
      if (canCompare) ops.unshift(...(src.type === 'multi' ? [['is', 'includes'], ['isNot', 'does not include']] : [['is', 'is'], ['isNot', 'is not']]));
      const opSel = h('select', { class: 'select select-sm', 'aria-label': 'Condition', 'data-fk': 'cond-op', onchange: (e) => {
        const op = e.target.value;
        const values = valueOptions(src);
        patch({ display: { qid: src.id, op, value: op === 'is' || op === 'isNot' ? cond.value || (values[0] && values[0][0]) || '' : '' } });
      } }, ops.map(([v, l]) => h('option', { value: v, selected: v === cond.op }, l)));
      const parts = [qSel, opSel];
      if (cond.op === 'is' || cond.op === 'isNot') {
        const values = valueOptions(src);
        parts.push(h('select', { class: 'select select-sm', 'aria-label': 'Answer', 'data-fk': 'cond-v', onchange: (e) => patch({ display: { ...cond, qid: src.id, value: e.target.value } }) },
          values.map(([v, l]) => h('option', { value: v, selected: String(v) === String(cond.value) }, l))));
      }
      out.push(h('div', { class: 'cond-row' }, parts));
    }
    return out;
  }

  function valueOptions(src) {
    if (src.type === 'rating') return Array.from({ length: ratingMax(src) }, (_, i) => [String(i + 1), String(i + 1)]);
    if (src.type === 'nps') return Array.from({ length: 11 }, (_, i) => [String(i), String(i)]);
    // A chosen answer whose text was cleared stays listed, so the list
    // shows what is set rather than seeming to pick the first answer.
    const chosen = q.display && q.display.qid === src.id ? q.display.value : null;
    const list = (src.choices || []).filter((c) => c.label.trim() || c.id === chosen).map((c) => [c.id, c.label.trim() ? c.label : '(answer with no text)']);
    if (src.other && src.other.enabled) list.push([OTHER_ID, src.other.label || 'Other']);
    if (src.none && src.none.enabled) list.push([NONE_ID, src.none.label || 'None of the above']);
    return list;
  }

  function optionsTab() {
    const out = [];
    if (isAnswerable(q)) {
      out.push(switchRow('Require an answer', q.required, (v) => patch({ required: v }), { fk: 'required' }));
      if (q.required) {
        out.push(h('div', { class: 'indent' }, field('Message when unanswered',
          textInput(q.requiredMessage || '', 'Message when unanswered', 'reqmsg', (v) => patch({ requiredMessage: v }, { input: 'reqmsg' }), { placeholder: defaultRequiredMessage(q), maxlength: '300' }))));
      }
    }
    if (CHOICE_TYPES.includes(q.type) || q.type === 'matrix') {
      out.push(switchRow(q.type === 'matrix' ? 'Show rows in random order' : 'Show choices in random order', !!q.randomize, (v) => patch({ randomize: v }), { fk: 'randomize', hint: 'Reduces order bias. Each respondent gets their own order.' }));
    }
    if (q.type === 'single' || q.type === 'multi') {
      out.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Layout'),
        h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Choice layout' },
          [['vertical', 'List'], ['horizontal', 'In a row'], ['columns', 'Columns']].map(([v, l]) =>
            h('button', { type: 'button', role: 'radio', 'aria-checked': String((q.layout || 'vertical') === v), 'data-fk': `layout:${v}`, onclick: () => patch({ layout: v }) }, l)))));
    }
    if (q.type === 'multi') {
      out.push(h('div', { class: 'grid2' },
        field('Minimum choices', numInput(q.minSelect || '', 'Minimum choices', 'minSelect', (v) => patch({ minSelect: Math.max(0, Math.round(Number(v) || 0)) }, { input: 'minSelect' }), { min: '0', placeholder: 'Any' })),
        field('Maximum choices', numInput(q.maxSelect || '', 'Maximum choices', 'maxSelect', (v) => patch({ maxSelect: Math.max(0, Math.round(Number(v) || 0)) }, { input: 'maxSelect' }), { min: '0', placeholder: 'Any' }))));
    }
    if (q.type === 'text' || q.type === 'textarea') {
      const v = q.validation || { kind: 'none' };
      const kinds = q.type === 'text'
        ? [['none', 'Any text'], ['email', 'Email address'], ['number', 'Number'], ['integer', 'Whole number'], ['length', 'Text length']]
        : [['none', 'Any text'], ['length', 'Text length']];
      const setV = (p, opts) => apply((x) => ({ ...x, validation: { ...x.validation, ...p } }), opts);
      out.push(field('Accept', h('select', { class: 'select select-sm', 'data-fk': 'vkind', onchange: (e) => setV({ kind: e.target.value }) },
        kinds.map(([k, l]) => h('option', { value: k, selected: k === v.kind }, l)))));
      if (v.kind === 'number' || v.kind === 'integer' || v.kind === 'length') {
        const unit = v.kind === 'length' ? ' (characters)' : '';
        out.push(h('div', { class: 'grid2' },
          field(`Minimum${unit}`, numInput(v.min, 'Minimum', 'vmin', (x) => setV({ min: x === '' ? '' : Number(x) }, { input: 'vmin' }), { placeholder: 'None' })),
          field(`Maximum${unit}`, numInput(v.max, 'Maximum', 'vmax', (x) => setV({ max: x === '' ? '' : Number(x) }, { input: 'vmax' }), { placeholder: 'None' }))));
      }
      if (v.kind !== 'none') {
        out.push(field('Message when the answer does not fit', textInput(v.message || '', 'Validation message', 'vmsg', (x) => setV({ message: x }, { input: 'vmsg' }), { placeholder: 'Default message', maxlength: '300' })));
      }
    }
    out.push(h('div', { class: 'divider' }));
    out.push(...conditionEditor());
    return h('div', { class: 'opt-stack' }, out);
  }

  function logicTab() {
    if (!LOGIC_TYPES.includes(q.type)) {
      return h('div', { class: 'opt-stack' }, h('p', { class: 'muted' }, 'Skip logic works on multiple choice, checkbox and dropdown questions. To show or hide this question based on an earlier answer, use the condition in Options.'));
    }
    const survey = session.survey;
    const pi = survey.pages.findIndex((p) => p.questions.some((x) => x.id === qid));
    const later = survey.pages.map((p, i) => ({ p, i })).filter(({ i }) => i > pi);
    const items = (q.choices || []).filter((c) => c.label.trim()).map((c) => [c.id, c.label]);
    if (q.other && q.other.enabled) items.push([OTHER_ID, q.other.label || 'Other']);
    if (q.none && q.none.enabled) items.push([NONE_ID, q.none.label || 'None of the above']);
    const valueOf = (t) => (!t ? '' : t.type === 'page' ? `page:${t.pageId}` : t.type);
    const setTarget = (cid, v) => apply((x) => {
      const logic = { ...(x.logic || {}) };
      if (!v) delete logic[cid];
      else if (v.startsWith('page:')) logic[cid] = { type: 'page', pageId: v.slice(5) };
      else logic[cid] = { type: v };
      const n = { ...x, logic };
      if (!Object.keys(logic).length) delete n.logic;
      return n;
    });
    return h('div', { class: 'opt-stack' },
      h('p', { class: 'field-hint' }, q.type === 'multi'
        ? 'Send respondents somewhere else depending on their answer. With several answers picked, the first one in the list with a rule wins.'
        : 'Send respondents somewhere else depending on their answer. The jump happens when they leave this page.'),
      items.length
        ? h('table', { class: 'logic-table' },
            h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'If the answer is'), h('th', { scope: 'col' }, 'Then go to'))),
            h('tbody', null, items.map(([cid, label]) => h('tr', null, h('td', null, label),
              h('td', null, h('select', { class: 'select select-sm', 'aria-label': `Destination for ${label}`, 'data-fk': `logic:${cid}`, onchange: (e) => setTarget(cid, e.target.value) },
                h('option', { value: '' }, 'Next page (default)'),
                later.map(({ p, i }) => h('option', { value: `page:${p.id}`, selected: valueOf(q.logic && q.logic[cid]) === `page:${p.id}` }, `Page ${i + 1}${p.title ? `: ${p.title.slice(0, 40)}` : ''}`)),
                h('option', { value: 'end', selected: valueOf(q.logic && q.logic[cid]) === 'end' }, 'End of survey (submit)'),
                h('option', { value: 'disqualify', selected: valueOf(q.logic && q.logic[cid]) === 'disqualify' }, 'Disqualify (end without counting as complete)')))))))
        : h('p', { class: 'muted' }, 'Add answer choices first.'),
      later.length ? null : h('p', { class: 'field-hint' }, 'Tip: add pages after this one to jump ahead to them.'),
    );
  }

  /* ---- Assembly ---- */

  function rebuild() {
    q = getQ();
    if (!q) return;
    const active = document.activeElement;
    let focusKey = st.pendingFocus;
    let sel = null;
    if (!focusKey && active && node.contains(active) && active.dataset.fk) {
      focusKey = active.dataset.fk;
      if (typeof active.selectionStart === 'number') sel = [active.selectionStart, active.selectionEnd];
    }
    st.pendingFocus = null;

    const tabs = [['edit', 'Edit'], ['options', 'Options']];
    if (LOGIC_TYPES.includes(q.type)) tabs.push(['logic', 'Logic']);
    if (!tabs.some(([t]) => t === st.tab)) st.tab = 'edit';
    const tabIds = Object.fromEntries(tabs.map(([t]) => [t, domId('tab')]));
    const panelId = domId('panel');
    const tablist = h('div', { class: 'tabs q-tabs', role: 'tablist', 'aria-label': 'Question settings' },
      tabs.map(([t, l]) => h('button', {
        type: 'button',
        class: 'tab',
        role: 'tab',
        id: tabIds[t],
        'aria-selected': String(st.tab === t),
        'aria-controls': panelId,
        tabindex: st.tab === t ? '0' : '-1',
        'data-fk': `tab:${t}`,
        onclick: () => {
          st.tab = t;
          st.pendingFocus = `tab:${t}`;
          rebuild();
        },
        onkeydown: (e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          const i = tabs.findIndex(([x]) => x === st.tab);
          const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length][0];
          st.tab = n;
          st.pendingFocus = `tab:${n}`;
          rebuild();
        },
      }, l, t === 'logic' && q.logic ? h('span', { class: 'dot', 'aria-label': '(has rules)' }) : null, t === 'options' && q.display ? h('span', { class: 'dot', 'aria-label': '(has a condition)' }) : null)));
    const body = st.tab === 'options' ? optionsTab() : st.tab === 'logic' ? logicTab() : editTab();
    replace(
      node,
      h('div', { class: 'q-editor-head' }, h('span', { class: 'q-num' }, isAnswerable(q) ? `Q${questionNumbers(session.survey)[qid]}` : 'Text'), tablist),
      h('div', { class: 'q-editor-panel', role: 'tabpanel', id: panelId, 'aria-labelledby': tabIds[st.tab] }, body),
      h('div', { class: 'q-editor-foot' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Move question up', title: 'Move up (Alt+Up)', onclick: () => onMove(-1) }, icon('up', { size: 16 })),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Move question down', title: 'Move down (Alt+Down)', onclick: () => onMove(1) }, icon('down', { size: 16 })),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Duplicate question', title: 'Duplicate', onclick: onDuplicate }, icon('duplicate', { size: 16 })),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm btn-danger', 'aria-label': 'Delete question', title: 'Delete', onclick: onDelete }, icon('trash', { size: 16 })),
        h('span', { class: 'grow' }),
        isAnswerable(q)
          ? h('label', { class: 'switch foot-switch' }, h('span', null, 'Required'),
              h('input', { type: 'checkbox', role: 'switch', checked: q.required, 'data-fk': 'foot-required', onchange: (e) => patch({ required: e.target.checked }) }))
          : null,
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-fk': 'done', onclick: onDone }, 'Done'),
      ),
    );
    if (focusKey) {
      const target = node.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`);
      if (target) {
        target.focus({ preventScroll: false });
        if (sel && typeof target.setSelectionRange === 'function') {
          try {
            target.setSelectionRange(sel[0], sel[1]);
          } catch {
            /* not a text control */
          }
        }
      }
    }
  }

  rebuild();
  return {
    node,
    rebuild,
    focusTitle() {
      const t = node.querySelector('[data-fk="title"]');
      if (t) {
        t.focus();
        t.setSelectionRange(t.value.length, t.value.length);
      }
    },
    setTab(t) {
      st.tab = t;
      rebuild();
    },
  };
}
