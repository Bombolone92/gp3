/**
 * Pure edit operations on a survey. Each returns a new survey and shares
 * every page and question it did not touch, so reference equality tells the
 * builder exactly which cards to redraw. Structural edits run
 * dropDanglingLogic so logic never points at something that moved away.
 */
import { cloneQuestion, dropDanglingLogic, makePage, makeQuestion } from './survey.js';
import { partId } from '../lib/ids.js';

function withPages(survey, pages, structural = false) {
  return { ...survey, pages: structural ? dropDanglingLogic(pages) : pages };
}

export function setSurvey(survey, patch) {
  return { ...survey, ...patch };
}

export function setTheme(survey, patch) {
  return { ...survey, theme: { ...survey.theme, ...patch } };
}

export function setOptions(survey, patch) {
  return { ...survey, options: { ...survey.options, ...patch } };
}

export function updatePage(survey, pageId, patch) {
  return withPages(
    survey,
    survey.pages.map((p) => (p.id === pageId ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p)),
    true,
  );
}

/** `patch` is an object to merge or a function from question to question. */
export function updateQuestion(survey, qid, patch) {
  let structural = false;
  const pages = survey.pages.map((p) => {
    const i = p.questions.findIndex((q) => q.id === qid);
    if (i < 0) return p;
    const old = p.questions[i];
    const next = typeof patch === 'function' ? patch(old) : { ...old, ...patch };
    if (next === old) return p;
    // A type or choice change can orphan logic that points at it.
    structural =
      next.type !== old.type || next.choices !== old.choices || next.other !== old.other || next.none !== old.none || next.scale !== old.scale;
    const questions = p.questions.slice();
    questions[i] = next;
    return { ...p, questions };
  });
  return withPages(survey, pages, structural);
}

export function addQuestion(survey, pageId, index, question) {
  const pages = survey.pages.map((p) => {
    if (p.id !== pageId) return p;
    const questions = p.questions.slice();
    const at = index == null ? questions.length : Math.max(0, Math.min(index, questions.length));
    questions.splice(at, 0, question);
    return { ...p, questions };
  });
  return withPages(survey, pages);
}

export function removeQuestion(survey, qid) {
  const pages = survey.pages.map((p) =>
    p.questions.some((q) => q.id === qid) ? { ...p, questions: p.questions.filter((q) => q.id !== qid) } : p,
  );
  return withPages(survey, pages, true);
}

export function duplicateQuestion(survey, qid) {
  let copy = null;
  const pages = survey.pages.map((p) => {
    const i = p.questions.findIndex((q) => q.id === qid);
    if (i < 0) return p;
    copy = cloneQuestion(p.questions[i]);
    const questions = p.questions.slice();
    questions.splice(i + 1, 0, copy);
    return { ...p, questions };
  });
  return { survey: withPages(survey, pages, true), question: copy };
}

/** Move a question to `toIndex` within page `toPageId` (index counted in
 *  the destination page after the question has been taken out). */
export function moveQuestion(survey, qid, toPageId, toIndex) {
  let moving = null;
  let pages = survey.pages.map((p) => {
    const i = p.questions.findIndex((q) => q.id === qid);
    if (i < 0) return p;
    moving = p.questions[i];
    return { ...p, questions: p.questions.filter((q) => q.id !== qid) };
  });
  if (!moving) return survey;
  pages = pages.map((p) => {
    if (p.id !== toPageId) return p;
    const questions = p.questions.slice();
    questions.splice(Math.max(0, Math.min(toIndex, questions.length)), 0, moving);
    return { ...p, questions };
  });
  return withPages(survey, pages, true);
}

/** Move a question one step up or down, crossing into the neighboring
 *  page at a page boundary. */
export function nudgeQuestion(survey, qid, dir) {
  const pi = survey.pages.findIndex((p) => p.questions.some((q) => q.id === qid));
  if (pi < 0) return survey;
  const page = survey.pages[pi];
  const qi = page.questions.findIndex((q) => q.id === qid);
  const target = qi + dir;
  if (target >= 0 && target < page.questions.length) return moveQuestion(survey, qid, page.id, target);
  const np = survey.pages[pi + dir];
  if (!np) return survey;
  return moveQuestion(survey, qid, np.id, dir < 0 ? np.questions.length : 0);
}

export function addPage(survey, index, page = makePage()) {
  const pages = survey.pages.slice();
  pages.splice(index == null ? pages.length : index, 0, page);
  return { survey: withPages(survey, pages), page };
}

export function removePage(survey, pageId) {
  if (survey.pages.length <= 1) {
    return withPages(survey, [{ ...survey.pages[0], questions: [], title: '', description: '', logic: null }], true);
  }
  return withPages(survey, survey.pages.filter((p) => p.id !== pageId), true);
}

export function movePage(survey, pageId, toIndex) {
  const from = survey.pages.findIndex((p) => p.id === pageId);
  if (from < 0) return survey;
  const pages = survey.pages.slice();
  const [page] = pages.splice(from, 1);
  pages.splice(Math.max(0, Math.min(toIndex, pages.length)), 0, page);
  return withPages(survey, pages, true);
}

export function duplicatePage(survey, pageId) {
  const i = survey.pages.findIndex((p) => p.id === pageId);
  if (i < 0) return { survey, page: null };
  const src = survey.pages[i];
  const copies = src.questions.map(cloneQuestion);
  // A condition on another question of this page follows that question's
  // copy (and its choice ids); one on an earlier page stays as it is.
  const ids = new Map();
  src.questions.forEach((q, k) => {
    ids.set(q.id, copies[k].id);
    (q.choices || []).forEach((c, j) => ids.set(c.id, copies[k].choices[j].id));
  });
  const questions = copies.map((q) =>
    q.display && ids.has(q.display.qid)
      ? { ...q, display: { ...q.display, qid: ids.get(q.display.qid), value: ids.get(q.display.value) ?? q.display.value } }
      : q,
  );
  const page = { ...structuredClone(src), id: partId('p'), questions };
  const pages = survey.pages.slice();
  pages.splice(i + 1, 0, page);
  return { survey: withPages(survey, pages, true), page };
}

/** Start a new page right after question `qid`, carrying the questions that
 *  followed it on the old page. */
export function splitPageAfter(survey, qid) {
  const pi = survey.pages.findIndex((p) => p.questions.some((q) => q.id === qid));
  if (pi < 0) return survey;
  const page = survey.pages[pi];
  const qi = page.questions.findIndex((q) => q.id === qid);
  // "After this page" logic runs after the page's last question, which is
  // now on the new page.
  const head = { ...page, questions: page.questions.slice(0, qi + 1), logic: null };
  const tail = makePage({ questions: page.questions.slice(qi + 1), logic: page.logic || null });
  const pages = survey.pages.slice();
  pages.splice(pi, 1, head, tail);
  return withPages(survey, pages, true);
}

/** Fold page `pageId` into the page before it. */
export function mergeWithPrevious(survey, pageId) {
  const pi = survey.pages.findIndex((p) => p.id === pageId);
  if (pi <= 0) return survey;
  const prev = survey.pages[pi - 1];
  const later = survey.pages[pi];
  // The later page's "after this page" logic ran after the last of these
  // questions, so it wins; otherwise the earlier page's carries over.
  const merged = { ...prev, questions: prev.questions.concat(later.questions), logic: later.logic || prev.logic || null };
  const pages = survey.pages.slice();
  pages.splice(pi - 1, 2, merged);
  return withPages(survey, pages, true);
}

/**
 * Change a question's type, keeping what carries over: text, required, and
 * the answer list between the list-based types (choices <-> grid rows,
 * multiple short answers). Everything type-specific starts fresh.
 */
export function convertQuestion(q, type) {
  if (q.type === type) return q;
  const next = makeQuestion(type, { id: q.id, title: q.title, description: q.description });
  next.required = type === 'statement' ? false : q.required;
  if (q.requiredMessage) next.requiredMessage = q.requiredMessage;
  if (q.display) next.display = q.display;
  const list = q.choices || q.rows || (Array.isArray(q.fields) ? q.fields : null);
  const kept = list ? list.filter((c) => (c.label || '').trim()) : [];
  if (kept.length) {
    // Choice ids carry over between choice questions, whose answers name
    // them. Grid rows and text boxes are new things with the same labels:
    // fresh ids, so earlier answers are not read as answers to them (a
    // grid's column ids shown as if typed into boxes).
    const sameKind = !!(q.choices && next.choices);
    const copy = kept.map((c) => ({ id: sameKind ? c.id : partId(next.rows ? 'r' : 'f'), label: c.label }));
    if (next.choices) next.choices = copy;
    else if (next.rows) next.rows = copy;
    else if (Array.isArray(next.fields)) next.fields = copy;
  }
  if (q.other && next.other) next.other = { ...q.other };
  if (q.randomize != null && next.randomize != null) next.randomize = q.randomize;
  if (q.layout && next.layout) next.layout = q.layout;
  // Skip logic keyed by choice survives between single, checkboxes and
  // dropdown; dropDanglingLogic clears it for any other type.
  if (q.logic && ['single', 'multi', 'dropdown'].includes(type)) next.logic = q.logic;
  return next;
}
