/**
 * The builder canvas: the survey drawn on its theme, page by page, with each
 * question as a card that opens into the inline editor.
 *
 * Rendering is keyed: pages and cards are cached by id and only redrawn
 * when their object changed (edits share untouched objects, see
 * model/edit.js). Nodes are reordered in place rather than recreated, so a
 * focused control keeps focus through unrelated updates. Typing (origin
 * 'input') skips the canvas entirely, since the DOM already shows it.
 */
import { h, replace } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { showMenu } from '../../lib/ui.js';
import { QUESTION_TYPES, TYPE_BY_ID, LOGIC_TYPES, lintQuestion, findQuestion } from '../../model/survey.js';
import * as edit from '../../model/edit.js';
import { isAnswerable, questionNumbers, OTHER_ID, NONE_ID } from '../../shared/runtime.js';
import { applySurveyTheme, trackWidth } from '../../respond/render.js';
import { questionPreview } from './question-preview.js';
import { createEditor, setEditorTab } from './question-editor.js';

function reconcile(parent, nodes) {
  let cur = parent.firstChild;
  for (const n of nodes) {
    if (n === cur) {
      cur = cur.nextSibling;
      continue;
    }
    parent.insertBefore(n, cur);
  }
  while (cur) {
    const next = cur.nextSibling;
    cur.remove();
    cur = next;
  }
}

function autosize(ta) {
  const fit = () => {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
  };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return ta;
}

/** Plain-language summary of a question's logic, for the card badges. */
function logicBadges(q, survey, numbers) {
  const out = [];
  if (q.logic && Object.keys(q.logic).length) {
    out.push(h('span', { class: 'q-badge' }, icon('logic', { size: 12 }), `Skip logic on ${Object.keys(q.logic).length} ${Object.keys(q.logic).length === 1 ? 'answer' : 'answers'}`));
  }
  if (q.display) {
    const src = findQuestion(survey, q.display.qid);
    let what = '';
    if (src) {
      const sq = src.question;
      const n = numbers[sq.id] ? `Q${numbers[sq.id]}` : 'an earlier question';
      if (q.display.op === 'answered') what = `${n} is answered`;
      else if (q.display.op === 'notAnswered') what = `${n} is not answered`;
      else {
        let label = q.display.value;
        if (q.display.value === OTHER_ID) label = (sq.other && sq.other.label) || 'Other';
        else if (q.display.value === NONE_ID) label = (sq.none && sq.none.label) || 'None';
        else {
          const c = (sq.choices || []).find((x) => x.id === q.display.value);
          if (c) label = c.label;
        }
        const [yes, no] = sq.type === 'multi' ? ['includes', 'does not include'] : ['is', 'is not'];
        what = `${n} ${q.display.op === 'is' ? yes : no} ${String(label).trim() ? `“${label}”` : 'an answer with no text'}`;
      }
    }
    out.push(h('span', { class: 'q-badge' }, icon('eye', { size: 12 }), `Shown only if ${what}`));
  }
  return out;
}

export function createCanvas({ session, state, actions }) {
  const paper = h('div', { class: 'paper sv-root' });
  // Narrow layout of questions on a narrow canvas, as respondents get it.
  trackWidth(paper);
  const root = h('div', { class: 'canvas scroll', id: 'builder-canvas' }, h('div', { class: 'canvas-inner' }, paper));
  const header = h('div', { class: 'paper-head' });
  const pagesHost = h('div', { class: 'pages' });
  paper.append(header, pagesHost);

  const cards = new Map(); // qid -> { q, num, mode, extra, node, editor }
  const pages = new Map(); // pid -> { page, index, count, node, head, list, foot }
  let lastTheme = null;
  let lastHead = null;

  /* ---- Survey header (logo, title, welcome text) ---- */

  function renderHeader(survey) {
    const key = `${survey.title}\u0000${survey.description}\u0000${survey.theme.logo}\u0000${survey.theme.logoAlign}`;
    if (key === lastHead) return;
    lastHead = key;
    const title = autosize(h('textarea', {
      class: 'paper-title',
      rows: 1,
      maxlength: '300',
      'aria-label': 'Survey title',
      placeholder: 'Survey title',
      'data-fk': 'survey-title',
      oninput: (e) => {
        const v = e.target.value.replace(/\n/g, ' ');
        // A blank title (spaces only) would leave nothing to show anywhere.
        session.apply((s) => ({ ...s, title: v.trim() ? v : 'Untitled survey' }), { coalesce: 'title', origin: 'input' });
      },
      onkeydown: (e) => e.key === 'Enter' && (e.preventDefault(), desc.focus()),
    }));
    title.value = survey.title;
    const desc = autosize(h('textarea', {
      class: 'paper-desc',
      rows: 1,
      maxlength: '5000',
      'aria-label': 'Welcome message',
      placeholder: 'Add a welcome message or instructions (optional)',
      'data-fk': 'survey-desc',
      oninput: (e) => session.apply((s) => ({ ...s, description: e.target.value }), { coalesce: 'desc', origin: 'input' }),
    }));
    desc.value = survey.description;
    replace(
      header,
      survey.theme.logo
        ? h('div', { class: `sv-logo sv-logo-${survey.theme.logoAlign || 'left'}` }, h('img', { src: survey.theme.logo, alt: 'Survey logo' }))
        : h('button', { type: 'button', class: 'logo-slot', onclick: () => actions.openPanel('style', 'logo') }, icon('plus', { size: 14 }), 'Add logo'),
      title,
      desc,
    );
  }

  /* ---- Question cards ---- */

  function addMenu(anchor, pageId, index) {
    showMenu(
      anchor,
      QUESTION_TYPES.map((t) => ({ label: t.label, icon: t.icon, run: () => actions.addQuestion(t.type, pageId, index) })),
      { label: 'Add question' },
    );
  }

  /** The insert point before question `qid`. Slots are cached by that
   *  question, so a redraw never reorders nodes needlessly (moving a node
   *  that holds focus would blur it). The index is looked up on click. */
  const slots = new Map();
  function slot(pageId, qid) {
    const key = `${pageId}:${qid}`;
    if (slots.has(key)) return slots.get(key);
    const b = h('button', { type: 'button', class: 'insert-btn', 'aria-label': 'Insert a question here', 'aria-haspopup': 'menu', title: 'Insert a question here' }, icon('plus', { size: 14 }));
    b.addEventListener('click', () => {
      const page = session.survey.pages.find((p) => p.id === pageId);
      const index = page ? page.questions.findIndex((q) => q.id === qid) : -1;
      addMenu(b, pageId, index < 0 ? null : index);
    });
    const node = h('div', { class: 'insert-slot' }, b);
    slots.set(key, node);
    return node;
  }

  function viewCard(q, num, survey, numbers) {
    const issues = lintQuestion(q, survey);
    const answerable = isAnswerable(q);
    const titleText = q.title.trim() || (q.type === 'statement' ? '' : 'Untitled question');
    const tools = h('div', { class: 'q-tools' },
      h('span', { class: 'q-grip', title: 'Drag to move', 'aria-hidden': 'true' }, icon('grip', { size: 16 })),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', tabindex: '-1', onclick: (e) => (e.stopPropagation(), actions.edit(q.id, 'edit')) }, icon('edit', { size: 14 }), 'Edit'),
      answerable ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', tabindex: '-1', onclick: (e) => (e.stopPropagation(), actions.edit(q.id, 'options')) }, 'Options') : null,
      LOGIC_TYPES.includes(q.type) ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', tabindex: '-1', onclick: (e) => (e.stopPropagation(), actions.edit(q.id, 'logic')) }, 'Logic') : null,
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', tabindex: '-1', 'aria-label': 'Duplicate', title: 'Duplicate', onclick: (e) => (e.stopPropagation(), actions.duplicate(q.id)) }, icon('duplicate', { size: 14 })),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', tabindex: '-1', 'aria-label': 'More actions', 'aria-haspopup': 'menu', onclick: (e) => {
        e.stopPropagation();
        showMenu(e.currentTarget, [
          { label: 'Move up', icon: 'up', hint: 'Alt+↑', run: () => actions.nudge(q.id, -1) },
          { label: 'Move down', icon: 'down', hint: 'Alt+↓', run: () => actions.nudge(q.id, 1) },
          { label: 'Start a new page after this', icon: 'split', run: () => actions.splitAfter(q.id) },
          'sep',
          { label: 'Delete question', icon: 'trash', danger: true, hint: 'Del', run: () => actions.remove(q.id) },
        ], { align: 'end', label: 'Question actions' });
      } }, icon('more', { size: 14 })),
    );
    const card = h(
      'div',
      {
        class: `q-card${issues.length ? ' has-issues' : ''}`,
        tabindex: '0',
        'data-qid': q.id,
        role: 'group',
        'aria-label': `${answerable ? `Question ${num}` : 'Text block'}: ${titleText || 'empty'}. ${TYPE_BY_ID[q.type].label}${q.required ? ', required' : ''}. Press Enter to edit.`,
      },
      tools,
      h('div', { class: 'sv-q-like' },
        q.type === 'statement'
          ? [titleText ? h('div', { class: 'sv-statement-title' }, titleText) : null, q.description ? h('div', { class: 'sv-desc' }, q.description) : null,
            !titleText && !q.description ? h('div', { class: 'faint' }, 'Empty text block') : null]
          : [
              h('div', { class: 'sv-qtitle' },
                session.survey.options.numbering !== false ? h('span', { class: 'sv-num' }, `${num}.`) : null,
                h('span', { class: q.title.trim() ? '' : 'faint' }, titleText),
                q.required && session.survey.options.requiredMark !== false ? h('span', { class: 'sv-req' }, '*') : null),
              q.description ? h('div', { class: 'sv-desc' }, q.description) : null,
              questionPreview(q),
            ]),
      h('div', { class: 'q-foot' },
        h('span', { class: 'q-type' }, icon(TYPE_BY_ID[q.type].icon, { size: 12 }), TYPE_BY_ID[q.type].label),
        logicBadges(q, survey, numbers),
        issues.map((t) => h('span', { class: 'q-issue' }, icon('alert', { size: 12 }), t))),
    );
    card.addEventListener('click', (e) => {
      if (e.target.closest('.q-tools')) return;
      actions.edit(q.id);
    });
    const grip = tools.querySelector('.q-grip');
    grip.addEventListener('pointerdown', () => (card.draggable = true));
    card.addEventListener('dragstart', (e) => {
      if (!card.draggable) return;
      e.dataTransfer.setData('application/x-question', q.id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
      state.dragging = q.id;
    });
    card.addEventListener('dragend', () => {
      card.draggable = false;
      card.classList.remove('dragging');
      state.dragging = null;
      clearDrop();
    });
    return card;
  }

  function cardFor(q, num, survey, numbers) {
    const editing = state.editingId === q.id;
    // A card also shows facts about other questions (a display condition
    // names its source question and answer), so those are part of its key.
    let condKey = '';
    if (q.display) {
      const src = findQuestion(survey, q.display.qid);
      const sq = src && src.question;
      const choice = sq && (sq.choices || []).find((c) => c.id === q.display.value);
      // Other and None have their labels on the question, not in choices.
      const label = !sq ? '' : q.display.value === OTHER_ID ? sq.other && sq.other.label : q.display.value === NONE_ID ? sq.none && sq.none.label : choice && choice.label;
      condKey = JSON.stringify([q.display, numbers[q.display.qid], label, sq && sq.type]);
    }
    const extra = `${num}|${survey.options.numbering}|${survey.options.requiredMark}|${condKey}`;
    // An open editor's Logic tab lists the pages it can jump to.
    const pagesKey = editing && LOGIC_TYPES.includes(q.type) ? survey.pages.map((p) => `${p.id}:${p.title}`).join('|') : '';
    const prev = cards.get(q.id);
    if (prev && prev.mode === (editing ? 'edit' : 'view')) {
      if (editing) {
        if (prev.num !== num || prev.q !== q || prev.pagesKey !== pagesKey) {
          prev.q = q;
          prev.num = num;
          prev.pagesKey = pagesKey;
          prev.editorNeedsRebuild = true;
        }
        return prev;
      }
      if (prev.q === q && prev.extra === extra) return prev;
    }
    let entry;
    if (editing) {
      const editor = createEditor({
        session,
        qid: q.id,
        onDone: () => actions.closeEditor(),
        onDelete: () => actions.remove(q.id),
        onDuplicate: () => actions.duplicate(q.id),
        onMove: (d) => actions.nudge(q.id, d),
      });
      const node = h('div', { class: 'q-card editing', 'data-qid': q.id }, editor.node);
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !document.querySelector('.menu')) {
          e.stopPropagation();
          actions.closeEditor();
        }
      });
      entry = { q, num, mode: 'edit', node, editor, extra, pagesKey };
    } else {
      entry = { q, num, mode: 'view', node: viewCard(q, num, survey, numbers), extra };
    }
    cards.set(q.id, entry);
    return entry;
  }

  /** An empty page offers the common types right where the question will
   *  go, so the first question is one click away. */
  const QUICK = ['single', 'multi', 'rating', 'nps', 'text', 'textarea'];
  function emptyPage(pageId, survey) {
    const first = survey.pages.every((p) => !p.questions.length);
    const more = h('button', { type: 'button', class: 'quick-type more', 'aria-haspopup': 'menu' }, icon('more', { size: 16 }), 'More types');
    more.addEventListener('click', () => addMenu(more, pageId, null));
    return h(
      'div',
      { class: 'page-empty' },
      h('p', { class: 'page-empty-title' }, first ? 'Add your first question' : 'This page is empty'),
      h('p', { class: 'page-empty-hint' }, 'Pick a type, or drag one here from the Build panel.'),
      h('div', { class: 'quick-types' },
        QUICK.map((t) => h('button', { type: 'button', class: 'quick-type', onclick: () => actions.addQuestion(t, pageId, null) },
          icon(TYPE_BY_ID[t].icon, { size: 16 }), TYPE_BY_ID[t].label)),
        more),
    );
  }

  /* ---- Pages ---- */

  function pageHead(page, index, count) {
    const title = h('input', {
      class: 'page-title-input',
      value: page.title,
      maxlength: '1000',
      placeholder: count > 1 ? `Page ${index + 1} title (optional)` : 'Page title (optional)',
      'aria-label': `Page ${index + 1} title`,
      'data-fk': `page-title:${page.id}`,
      oninput: (e) => session.apply((s) => edit.updatePage(s, page.id, { title: e.target.value }), { coalesce: `pt:${page.id}`, origin: 'input' }),
    });
    const desc = autosize(h('textarea', {
      class: 'page-desc-input',
      rows: 1,
      maxlength: '5000',
      placeholder: 'Page description (optional)',
      'aria-label': `Page ${index + 1} description`,
      'data-fk': `page-desc:${page.id}`,
      oninput: (e) => session.apply((s) => edit.updatePage(s, page.id, { description: e.target.value }), { coalesce: `pd:${page.id}`, origin: 'input' }),
    }));
    desc.value = page.description;
    // data-fk: the page head is redrawn after most of these actions, and
    // render() gives focus back to the redrawn button by this key.
    const menuBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': `Page ${index + 1} actions`, 'aria-haspopup': 'menu', 'data-fk': `page-menu:${page.id}` }, icon('more', { size: 16 }));
    menuBtn.addEventListener('click', () =>
      showMenu(menuBtn, [
        { label: 'Duplicate page', icon: 'duplicate', run: () => actions.duplicatePage(page.id) },
        index > 0 ? { label: 'Move page up', icon: 'up', run: () => actions.movePage(page.id, index - 1) } : null,
        index < count - 1 ? { label: 'Move page down', icon: 'down', run: () => actions.movePage(page.id, index + 1) } : null,
        index > 0 ? { label: 'Merge with previous page', icon: 'merge', run: () => {
          const prevId = session.survey.pages[index - 1].id;
          session.apply((s) => edit.mergeWithPrevious(s, page.id));
          // This page is gone: on to the one it merged into.
          root.querySelector(`[data-fk="page-menu:${prevId}"]`)?.focus({ preventScroll: true });
        } } : null,
        { label: page.randomize ? 'Keep question order' : 'Shuffle question order', icon: 'shuffle', run: () => session.apply((s) => edit.updatePage(s, page.id, { randomize: !page.randomize })) },
        { label: 'Page logic', icon: 'logic', run: () => actions.openPanel('logic') },
        'sep',
        { label: count > 1 ? 'Delete page' : 'Clear page', icon: 'trash', danger: true, run: () => actions.removePage(page.id) },
      ], { align: 'end', label: 'Page actions' }),
    );
    const flags = [];
    if (page.randomize) flags.push(h('span', { class: 'q-badge' }, icon('shuffle', { size: 12 }), 'Questions shuffled'));
    if (page.logic) {
      const t = page.logic;
      const target = t.type === 'end' ? 'the end' : t.type === 'disqualify' ? 'disqualification' : `page ${session.survey.pages.findIndex((p) => p.id === t.pageId) + 1}`;
      flags.push(h('span', { class: 'q-badge' }, icon('logic', { size: 12 }), `Then goes to ${target}`));
    }
    return h('div', { class: 'page-head' },
      h('div', { class: 'page-label' }, h('span', { class: 'page-chip' }, count > 1 ? `Page ${index + 1} of ${count}` : 'Page 1'), flags, h('span', { class: 'grow' }), menuBtn),
      title,
      desc);
  }

  function pageFor(page, index, count) {
    let entry = pages.get(page.id);
    if (!entry) {
      const list = h('div', { class: 'q-list', 'data-page': page.id });
      const head = h('div');
      const foot = h('div', { class: 'page-foot' });
      const node = h('section', { class: 'page-block', 'aria-label': `Page ${index + 1}` }, head, list, foot);
      entry = { page: null, index: -1, count: -1, node, head, list, foot, headKey: '' };
      pages.set(page.id, entry);
      wireDrop(list, page.id);
    }
    // The logic badge names the target page by number, so its index is part
    // of the key too.
    const target = page.logic && page.logic.type === 'page' ? session.survey.pages.findIndex((p) => p.id === page.logic.pageId) : -1;
    const headKey = `${index}|${count}|${page.randomize}|${JSON.stringify(page.logic)}|${target}|${page.title}|${page.description}`;
    if (entry.headKey !== headKey) {
      replace(entry.head, pageHead(page, index, count));
      entry.headKey = headKey;
      entry.node.setAttribute('aria-label', `Page ${index + 1}`);
    }
    if (entry.index !== index || entry.count !== count) {
      const addBtn = h('button', { type: 'button', class: 'btn add-q-btn', 'aria-haspopup': 'menu' }, icon('plus', { size: 16 }), 'Add question');
      addBtn.addEventListener('click', () => addMenu(addBtn, page.id, null));
      replace(entry.foot,
        addBtn,
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => actions.addPage(index + 1) }, icon('file', { size: 16 }), 'New page'));
    }
    entry.page = page;
    entry.index = index;
    entry.count = count;
    return entry;
  }

  /* ---- Drag and drop (cards, and types from the Build panel) ---- */

  const indicator = h('div', { class: 'drop-line', 'aria-hidden': 'true' });
  let dropAt = null;

  function clearDrop() {
    indicator.remove();
    dropAt = null;
  }

  function wireDrop(list, pageId) {
    list.addEventListener('dragover', (e) => {
      const types = e.dataTransfer.types;
      if (!types.includes('application/x-question') && !types.includes('application/x-qtype')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = types.includes('application/x-question') ? 'move' : 'copy';
      const items = [...list.querySelectorAll(':scope > .q-card')];
      let index = items.length;
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) {
          index = i;
          break;
        }
      }
      dropAt = { pageId, index };
      const ref = items[index];
      if (ref) ref.before(indicator);
      else list.append(indicator);
    });
    list.addEventListener('dragleave', (e) => {
      if (!list.contains(e.relatedTarget)) clearDrop();
    });
    list.addEventListener('drop', (e) => {
      if (!dropAt) return;
      e.preventDefault();
      const qid = e.dataTransfer.getData('application/x-question');
      const type = e.dataTransfer.getData('application/x-qtype');
      const at = dropAt;
      clearDrop();
      if (qid) {
        // Indexes counted with the dragged card still in place: adjust.
        const page = session.survey.pages.find((p) => p.id === at.pageId);
        const from = page ? page.questions.findIndex((x) => x.id === qid) : -1;
        const to = from >= 0 && from < at.index ? at.index - 1 : at.index;
        actions.moveQuestion(qid, at.pageId, to);
      } else if (type) {
        actions.addQuestion(type, at.pageId, at.index);
      }
    });
  }

  /* ---- Render ---- */

  function render(change = {}) {
    if (change.origin === 'input') return;
    const survey = session.survey;
    // Typing never updates the cache keys below, so undo and redo, which can
    // restore the very objects last drawn, must redraw every text field, as
    // must a copy saved in another tab.
    if (change.type === 'undo' || change.type === 'redo' || change.type === 'external') {
      lastHead = null;
      for (const e of pages.values()) e.headKey = '';
      for (const c of cards.values()) if (c.mode === 'edit') c.editorNeedsRebuild = true;
    }
    const active = document.activeElement;
    const sel = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    if (survey.theme !== lastTheme) {
      applySurveyTheme(paper, survey.theme);
      lastTheme = survey.theme;
    }
    renderHeader(survey);
    const numbers = questionNumbers(survey);
    const seenQ = new Set();
    const pageNodes = survey.pages.map((page, pi) => {
      const entry = pageFor(page, pi, survey.pages.length);
      const children = [];
      if (!page.questions.length) children.push(emptyPage(page.id, survey));
      page.questions.forEach((q, qi) => {
        seenQ.add(q.id);
        if (qi > 0) children.push(slot(page.id, q.id));
        const c = cardFor(q, numbers[q.id] || 0, survey, numbers);
        children.push(c.node);
      });
      reconcile(entry.list, children);
      return entry.node;
    });
    for (const id of [...pages.keys()]) if (!survey.pages.some((p) => p.id === id)) pages.delete(id);
    for (const id of [...cards.keys()]) if (!seenQ.has(id)) cards.delete(id);
    for (const key of [...slots.keys()]) if (!seenQ.has(key.slice(key.indexOf(':') + 1))) slots.delete(key);
    reconcile(pagesHost, pageNodes);
    // A node that had to move loses focus; give it back. A field that was
    // redrawn (undo and redo redraw the titles) hands focus to its new self.
    let target = null;
    if (active && active !== document.activeElement && active.isConnected && root.contains(active)) target = active;
    else if (active && !active.isConnected && active.dataset && active.dataset.fk && !root.contains(document.activeElement)) {
      target = root.querySelector(`[data-fk="${CSS.escape(active.dataset.fk)}"]`);
    }
    if (target) {
      target.focus({ preventScroll: true });
      if (sel && typeof target.setSelectionRange === 'function') {
        const end = (target.value || '').length;
        try {
          target.setSelectionRange(Math.min(sel[0], end), Math.min(sel[1], end));
        } catch {
          /* not a text control */
        }
      }
    }
    // The open editor redraws itself after its node is in place, so it can
    // put focus back where it was.
    for (const c of cards.values()) {
      if (c.mode === 'edit' && c.editorNeedsRebuild) {
        c.editorNeedsRebuild = false;
        c.editor.rebuild();
      }
    }
  }

  return {
    node: root,
    paper,
    render,
    /** Re-render one card in a different mode (open or close the editor). */
    refreshCard(qid) {
      cards.delete(qid);
      render();
    },
    editorFor(qid) {
      const c = cards.get(qid);
      return c && c.mode === 'edit' ? c.editor : null;
    },
    cardNode(qid) {
      const c = cards.get(qid);
      return c ? c.node : null;
    },
    setTab: setEditorTab,
  };
}

