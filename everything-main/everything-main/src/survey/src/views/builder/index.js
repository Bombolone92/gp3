/**
 * Design step: a panel toolbar (Build, Style, Logic, Options), the panel,
 * and the canvas where the survey is edited in place.
 */
import '../../styles/respond.css';
import '../../styles/builder.css';
import { h, isEditable, announce, modKey, scrollMotion } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { showMenu, toast, confirmDialog } from '../../lib/ui.js';
import { QUESTION_TYPES, makeQuestion, findQuestion } from '../../model/survey.js';
import * as edit from '../../model/edit.js';
import { createCanvas } from './canvas.js';
import { createPanelHost, PANELS } from './panels.js';
import { openPreview } from '../preview.js';
import { singleKeysOn } from '../shortcuts.js';

const PANEL_KEY = 'sv:builder-panel';

export async function mount(container, { app, session, sid, frame }) {
  const state = { editingId: null, dragging: null };
  const narrow = () => window.matchMedia('(max-width: 900px)').matches;
  let panelKind = (() => {
    try {
      const v = localStorage.getItem(PANEL_KEY);
      return v === '' ? null : v || 'build';
    } catch {
      return 'build';
    }
  })();
  if (narrow()) panelKind = null;

  const actions = {};
  const canvas = createCanvas({ session, state, actions });
  const panelHost = createPanelHost({ session, actions });

  const panelTitle = h('h2', { class: 'panel-title', id: 'panel-title' });
  const panel = h('aside', { class: 'panel', 'aria-labelledby': 'panel-title', id: 'builder-panel' },
    h('div', { class: 'panel-head' }, panelTitle,
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Close panel', onclick: () => openPanel(null) }, icon('x', { size: 16 }))),
    panelHost.node);
  const scrim = h('div', { class: 'panel-scrim', hidden: true, onclick: () => openPanel(null) });

  const undoBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': 'Undo', title: `Undo (${modKey()}+Z)`, onclick: () => undo() }, icon('undo'));
  const redoBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': 'Redo', title: `Redo (${modKey()}+Shift+Z)`, onclick: () => redo() }, icon('redo'));
  const tabs = h('div', { class: 'builder-tabs', role: 'toolbar', 'aria-label': 'Builder panels' },
    PANELS.map((p) => h('button', {
      type: 'button',
      class: 'btn btn-ghost panel-tab',
      'data-panel': p.id,
      // Named without the text, which narrow screens hide.
      'aria-label': p.label,
      title: p.label,
      'aria-pressed': 'false',
      'aria-controls': 'builder-panel',
      onclick: () => openPanel(panelKind === p.id ? null : p.id),
    }, icon(p.icon), h('span', null, p.label))));
  const bar = h('div', { class: 'builder-bar' }, tabs, h('span', { class: 'grow' }), undoBtn, redoBtn);
  const mainArea = h('div', { class: 'builder-main' }, panel, scrim, canvas.node);
  const root = h('div', { class: 'builder' }, bar, mainArea);
  container.append(root);

  function openPanel(kind, focus = null) {
    panelKind = kind;
    try {
      localStorage.setItem(PANEL_KEY, kind || '');
    } catch {
      /* ignore */
    }
    mainArea.classList.toggle('panel-open', !!kind);
    scrim.hidden = !(kind && narrow());
    // Over the canvas (narrow screens) the panel acts as a dialog: what is
    // under its backdrop cannot be reached.
    canvas.node.inert = !!(kind && narrow());
    for (const b of tabs.querySelectorAll('.panel-tab')) b.setAttribute('aria-pressed', String(b.dataset.panel === kind));
    if (kind) {
      panelTitle.textContent = PANELS.find((p) => p.id === kind).label;
      panelHost.show(kind, focus);
      // A given focus target is the panel's to focus (show() does): the
      // first control is only for a panel opened over the canvas.
      if (narrow() && !focus) requestAnimationFrame(() => panel.querySelector('button, input, select, textarea')?.focus());
    }
  }

  /* ---- Selection ---- */

  // The last question card that had focus on the canvas (null once focus
  // moves elsewhere on the canvas).
  let lastCardId = null;
  canvas.node.addEventListener('focusin', (e) => {
    const card = e.target.closest && e.target.closest('.q-card');
    lastCardId = card ? card.dataset.qid : null;
  });

  /** The question shortcuts act on: the card with focus (in or out of its
   *  editor), else the one being edited. */
  function selectedId() {
    const card = document.activeElement && document.activeElement.closest && document.activeElement.closest('.q-card');
    if (card && canvas.node.contains(card)) return card.dataset.qid;
    return state.editingId || null;
  }

  function focusCard(qid) {
    requestAnimationFrame(() => {
      const node = canvas.cardNode(qid);
      if (node) {
        node.focus({ preventScroll: true });
        node.scrollIntoView({ block: 'nearest', behavior: scrollMotion() });
      }
    });
  }

  function openEditor(qid, tab) {
    if (!findQuestion(session.survey, qid)) return;
    const prev = state.editingId;
    if (tab) canvas.setTab(qid, tab);
    state.editingId = qid;
    session.seal();
    if (prev && prev !== qid) canvas.refreshCard(prev);
    canvas.refreshCard(qid);
    const ed = canvas.editorFor(qid);
    const node = canvas.cardNode(qid);
    if (node) node.scrollIntoView({ block: 'nearest', behavior: scrollMotion() });
    if (ed) {
      if (!tab || tab === 'edit') ed.focusTitle();
      else node.querySelector('[role=tab][aria-selected=true]')?.focus();
    }
  }

  function closeEditor() {
    const qid = state.editingId;
    if (!qid) return;
    state.editingId = null;
    session.seal();
    canvas.refreshCard(qid);
    focusCard(qid);
  }

  /* ---- Actions ---- */

  /** Where a new question goes: after the selected one, else at the end
   *  of the last page. */
  function insertionPoint() {
    // Clicking a type in the panel moves focus off the card first: the
    // card focused last still counts as the selected one.
    const sel = selectedId() || (lastCardId && findQuestion(session.survey, lastCardId) ? lastCardId : null);
    const loc = sel && findQuestion(session.survey, sel);
    if (loc) return { pageId: loc.page.id, index: loc.index + 1 };
    const last = session.survey.pages[session.survey.pages.length - 1];
    return { pageId: last.id, index: last.questions.length };
  }

  function insertQuestion(q, pageId, index) {
    const at = pageId ? { pageId, index: index == null ? Infinity : index } : insertionPoint();
    session.apply((s) => edit.addQuestion(s, at.pageId, at.index === Infinity ? null : at.index, q));
    announce('Question added');
    if (narrow()) openPanel(null);
    openEditor(q.id);
  }

  Object.assign(actions, {
    addQuestion: (type, pageId, index) => insertQuestion(makeQuestion(type), pageId, index),
    insertQuestion: (q) => insertQuestion(q),
    // From a panel on a narrow screen, the panel covers the canvas: close
    // it, or the editor opens behind it.
    edit: (qid, tab) => {
      if (narrow() && panelKind) openPanel(null);
      openEditor(qid, tab);
    },
    closeEditor,
    duplicate(qid) {
      let copy = null;
      session.apply((s) => {
        const r = edit.duplicateQuestion(s, qid);
        copy = r.question;
        return r.survey;
      });
      if (copy) {
        announce('Question duplicated');
        if (state.editingId) openEditor(copy.id);
        else focusCard(copy.id);
      }
    },
    remove(qid) {
      const loc = findQuestion(session.survey, qid);
      if (!loc) return;
      // The next card to land on after the deletion.
      const flat = session.survey.pages.flatMap((p) => p.questions.map((q) => q.id));
      const i = flat.indexOf(qid);
      const next = flat[i + 1] || flat[i - 1];
      if (state.editingId === qid) state.editingId = null;
      session.apply((s) => edit.removeQuestion(s, qid));
      toast('Question deleted', { action: undoAction() });
      if (next) focusCard(next);
    },
    nudge(qid, dir) {
      if (!applyMove((s) => edit.nudgeQuestion(s, qid, dir), dir < 0 ? 'Moved up' : 'Moved down')) return;
      if (state.editingId !== qid) focusCard(qid);
      else canvas.cardNode(qid)?.scrollIntoView({ block: 'nearest', behavior: scrollMotion() });
    },
    moveQuestion(qid, pageId, index) {
      applyMove((s) => edit.moveQuestion(s, qid, pageId, index), 'Moved');
    },
    movePage(pid, index) {
      applyMove((s) => edit.movePage(s, pid, index), `Moved to page ${index + 1}`);
    },
    splitAfter(qid) {
      session.apply((s) => edit.splitPageAfter(s, qid));
      announce('New page started');
    },
    addPage(index) {
      let page = null;
      session.apply((s) => {
        const r = edit.addPage(s, index);
        page = r.page;
        return r.survey;
      });
      announce(`Page ${index + 1} added`);
      requestAnimationFrame(() => canvas.node.querySelector(`[data-fk="page-title:${page.id}"]`)?.focus());
    },
    duplicatePage(pid) {
      session.apply((s) => edit.duplicatePage(s, pid).survey);
      announce('Page duplicated');
    },
    async removePage(pid) {
      const page = session.survey.pages.find((p) => p.id === pid);
      if (!page) return;
      if (page.questions.length) {
        const ok = await confirmDialog({
          title: session.survey.pages.length > 1 ? 'Delete this page?' : 'Clear this page?',
          message: `Its ${page.questions.length} ${page.questions.length === 1 ? 'question' : 'questions'} will be removed too. You can undo this.`,
          confirm: session.survey.pages.length > 1 ? 'Delete page' : 'Clear page',
          danger: true,
        });
        if (!ok) return;
      }
      if (page.questions.some((q) => q.id === state.editingId)) state.editingId = null;
      const at = session.survey.pages.indexOf(page);
      session.apply((s) => edit.removePage(s, pid));
      // On to the page now in its place (or the one before), not the body.
      const pages = session.survey.pages;
      const near = pages[Math.min(at, pages.length - 1)];
      if (near) canvas.node.querySelector(`[data-fk="page-menu:${near.id}"]`)?.focus({ preventScroll: true });
      toast(session.survey.pages.length ? 'Page deleted' : 'Page cleared', { action: undoAction() });
    },
    openPanel,
    async pasteQuestions() {
      const { openPasteQuestions } = await import('./paste.js');
      const questions = await openPasteQuestions();
      if (!questions || !questions.length) return;
      const at = insertionPoint();
      session.apply((s) => questions.reduce((acc, q, k) => edit.addQuestion(acc, at.pageId, at.index + k, q), s));
      // On a narrow screen the panel covers the canvas: close it, and go
      // to what was added.
      if (narrow()) {
        openPanel(null);
        focusCard(questions[0].id);
      }
      toast(`Added ${questions.length} ${questions.length === 1 ? 'question' : 'questions'}`, { action: undoAction() });
    },
  });

  function undo() {
    stepHistory(() => session.undo(), 'Undone');
  }

  /**
   * Undo or redo. What it changes is redrawn, so focus on a card (or in an
   * editor) that went away goes to the card the step brought back, else to
   * the same card, else to the one now in its place, not to the page.
   */
  function stepHistory(step, said) {
    const ids = (s) => s.pages.flatMap((p) => p.questions.map((q) => q.id));
    const was = ids(session.survey);
    const card = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-qid]');
    const from = card && canvas.node.contains(card) ? card.dataset.qid : null;
    if (!step()) return;
    announce(said);
    const active = document.activeElement;
    if (!from || (active && active !== document.body && active.isConnected)) return;
    const now = ids(session.survey);
    const target = now.find((id) => !was.includes(id)) || (now.includes(from) ? from : now[Math.min(was.indexOf(from), now.length - 1)]);
    if (target) focusCard(target);
  }

  /** Display conditions and skip rules in the survey. */
  function ruleCount(s) {
    let n = 0;
    for (const p of s.pages) {
      if (p.logic) n++;
      for (const q of p.questions) n += (q.display ? 1 : 0) + Object.keys(q.logic || {}).length;
    }
    return n;
  }

  /**
   * Apply a move. Conditions and skip rules that would now point backwards
   * are dropped by the edit: say so, with Undo, as deleting does; otherwise
   * announce `done`. False when nothing moved.
   */
  function applyMove(fn, done) {
    const before = session.survey;
    session.apply(fn);
    if (session.survey === before) return false;
    const lost = ruleCount(before) - ruleCount(session.survey);
    if (lost > 0) toast(`Moved. ${lost} logic ${lost === 1 ? 'rule' : 'rules'} that no longer fit ${lost === 1 ? 'was' : 'were'} removed.`, { action: undoAction() });
    else announce(done);
    return true;
  }

  /** A toast's Undo: only while the change it announced is still the last
   *  one, so it never undoes something else the user did since. */
  function undoAction() {
    const after = session.survey;
    return {
      label: 'Undo',
      run: () => {
        if (!alive) return;
        if (session.survey === after) undo();
        else toast('That change can no longer be undone from here. Use Undo in the toolbar.');
      },
    };
  }
  function redo() {
    stepHistory(() => session.redo(), 'Redone');
  }

  /* ---- Keyboard ---- */

  function addMenuAtSelection() {
    const anchor = (selectedId() && canvas.cardNode(selectedId())) || canvas.node.querySelector('.add-q-btn');
    const at = insertionPoint();
    showMenu(anchor, QUESTION_TYPES.map((t) => ({ label: t.label, icon: t.icon, run: () => actions.addQuestion(t.type, at.pageId, at.index) })), { label: 'Add question' });
  }

  function onKey(e) {
    if (document.querySelector('dialog[open]')) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && e.shiftKey && key === 'p') {
      e.preventDefault();
      preview();
      return;
    }
    if (document.querySelector('.menu')) return;
    const sel = selectedId();
    if (mod && key === 'd' && sel) {
      e.preventDefault();
      actions.duplicate(sel);
      return;
    }
    // Not in a list box (Alt+Down opens it) or a multi-line box (Option+Up
    // and Down move by paragraph): those keys belong to the control.
    const native = /^(SELECT|TEXTAREA)$/.test((document.activeElement && document.activeElement.tagName) || '');
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && sel && !native) {
      e.preventDefault();
      actions.nudge(sel, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    const onCard = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('q-card') && !document.activeElement.classList.contains('editing');
    if (onCard) {
      const qid = document.activeElement.dataset.qid;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openEditor(qid);
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        // The card's actions menu (move, new page after it, delete), whose
        // button is for the pointer only.
        e.preventDefault();
        document.activeElement.querySelector('.q-tools [aria-haspopup="menu"]')?.click();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        actions.remove(qid);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        // The card being edited cannot take focus as a card: skip it.
        const all = [...canvas.node.querySelectorAll('.q-card:not(.editing)')];
        const i = all.indexOf(document.activeElement);
        const n = all[i + (e.key === 'ArrowDown' ? 1 : -1)];
        if (n) {
          n.focus({ preventScroll: true });
          n.scrollIntoView({ block: 'nearest', behavior: scrollMotion() });
        }
      }
    }
    if (singleKeysOn() && !isEditable(document.activeElement) && !mod && !e.altKey && key === 'a') {
      e.preventDefault();
      addMenuAtSelection();
    }
  }
  document.addEventListener('keydown', onKey);

  /* ---- App bar actions ---- */

  function preview() {
    session.seal();
    const sel = selectedId();
    const loc = sel && findQuestion(session.survey, sel);
    openPreview(session.survey, { startPage: loc ? loc.pageIndex : 0 });
  }

  frame.setActions([
    h('button', { type: 'button', class: 'btn hide-narrow', title: `Preview (${modKey()}+Shift+P)`, onclick: preview }, icon('eye'), 'Preview'),
    h('button', { type: 'button', class: 'btn btn-ghost btn-icon show-narrow', 'aria-label': 'Preview', onclick: preview }, icon('eye')),
    h('a', { class: 'btn btn-primary hide-narrow', href: `#/s/${sid}/collect` }, 'Collect responses', icon('chevRight', { size: 14 })),
  ]);

  /* ---- Session ---- */

  function syncUndo() {
    undoBtn.disabled = !session.canUndo;
    redoBtn.disabled = !session.canRedo;
  }

  const unsubscribe = session.subscribe((doc, change) => {
    if (change.type === 'save' || change.type === 'meta') return;
    if (state.editingId && !findQuestion(doc, state.editingId)) state.editingId = null;
    canvas.render(change);
    panelHost.refresh(change);
    syncUndo();
  });

  // Escape closes the panel when it covers the canvas, back to its tab.
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !panelKind || !narrow() || e.defaultPrevented) return;
    e.preventDefault();
    const tab = tabs.querySelector(`[data-panel="${panelKind}"]`);
    openPanel(null);
    tab?.focus();
  });

  const onResize = () => {
    if (!narrow()) scrim.hidden = true;
    else if (panelKind) scrim.hidden = false;
    canvas.node.inert = !!(panelKind && narrow());
  };
  window.addEventListener('resize', onResize);

  canvas.render();
  openPanel(panelKind);
  syncUndo();
  const s0 = session.survey;
  if (s0.title === 'Untitled survey' && s0.pages.every((p) => !p.questions.length)) {
    requestAnimationFrame(() => {
      const t = canvas.node.querySelector('[data-fk="survey-title"]');
      if (t) {
        t.focus();
        t.select();
      }
    });
  }

  let alive = true;
  return {
    unmount() {
      alive = false;
      unsubscribe();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    },
  };
}
