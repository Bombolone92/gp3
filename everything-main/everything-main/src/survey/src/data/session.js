/**
 * An open survey: its current document, undo/redo history, and autosave.
 * Design, Collect and Analyze share one session per survey, so switching
 * steps never reloads or loses unsaved edits.
 *
 * Edits are pure functions from survey to survey (src/model/edit.js).
 * Consecutive edits with the same `coalesce` key within a second (typing in
 * one field) become a single undo step.
 */
// Index fields that come from the survey document itself.
const DOC_META = ['title', 'createdAt', 'updatedAt', 'questions', 'pages'];

/** Whether two versions of a survey hold the same content (edit time aside). */
function sameContent(a, b) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'updatedAt' || a[k] === b[k]) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

export function createSession({ repo, survey, meta = {}, saveDelay = 700, now = () => Date.now(), onSaved = null, onMeta = null }) {
  let doc = survey;
  let info = { ...meta };
  const undoStack = [];
  const redoStack = [];
  const listeners = new Set();
  let lastCoalesce = null;
  let lastAt = 0;
  let saveTimer = null;
  let saving = null;
  let saveState = 'saved';
  let saveError = null;
  let dirtySince = 0;
  // The last document known to be on disk.
  let lastSaved = survey;

  const emit = (change) => {
    for (const fn of listeners) fn(doc, change);
  };

  function setSaveState(s, err = null) {
    saveState = s;
    saveError = err;
    emit({ type: 'save' });
  }

  /** Save the current document, after any save already under way. Rejects
   *  if this save fails. */
  async function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    while (saving) await saving.catch(() => {});
    if (doc === lastSaved) return;
    const snapshot = doc;
    setSaveState('saving');
    saving = repo
      .saveSurvey(snapshot)
      .then((m) => {
        lastSaved = snapshot;
        if (onSaved) onSaved(snapshot);
        // Only what the document itself decides: status and publish fields
        // in `m` come from the index as it was when this save began, and
        // publishing may have moved on since.
        const fromDoc = {};
        for (const k of DOC_META) if (m && m[k] !== undefined) fromDoc[k] = m[k];
        info = { ...info, ...fromDoc };
        if (doc === snapshot) {
          dirtySince = 0;
          setSaveState('saved');
        } else setSaveState('unsaved');
      })
      .catch((err) => {
        setSaveState('error', err);
        throw err;
      })
      .finally(() => {
        saving = null;
        if (saveState === 'unsaved') schedule();
      });
    return saving;
  }

  function schedule() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save().catch(() => {}), saveDelay);
  }

  function commit(next, { coalesce = null, select = undefined, origin = null } = {}) {
    // An edit that changes nothing (picking the option already picked, a
    // drag dropped where it started) is no edit: no undo step, no save,
    // and no "unpublished changes" from a new edit time.
    if (next === doc || sameContent(next, doc)) return doc;
    const t = now();
    const merge = coalesce && coalesce === lastCoalesce && t - lastAt < 1000 && undoStack.length;
    if (!merge) undoStack.push(doc);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    lastCoalesce = coalesce;
    lastAt = t;
    doc = { ...next, updatedAt: t };
    if (!dirtySince) dirtySince = t;
    saveState = 'unsaved';
    schedule();
    emit({ type: 'edit', select, origin });
    return doc;
  }

  return {
    get survey() {
      return doc;
    },
    get meta() {
      return info;
    },
    get saveState() {
      return saveState;
    },
    get saveError() {
      return saveError;
    },
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
    /** Apply `fn(survey) => survey`. */
    apply(fn, opts) {
      return commit(fn(doc), opts);
    },
    undo() {
      if (!undoStack.length) return false;
      redoStack.push(doc);
      doc = { ...undoStack.pop(), updatedAt: now() };
      lastCoalesce = null;
      schedule();
      saveState = 'unsaved';
      emit({ type: 'undo' });
      return true;
    },
    redo() {
      if (!redoStack.length) return false;
      undoStack.push(doc);
      doc = { ...redoStack.pop(), updatedAt: now() };
      lastCoalesce = null;
      schedule();
      saveState = 'unsaved';
      emit({ type: 'redo' });
      return true;
    },
    /**
     * Take a newer copy saved elsewhere (another tab), so the next edit
     * here builds on it instead of overwriting it. Only with nothing
     * unsaved here: then this tab's own edit, saved next, wins. Undo would
     * bring back the copy replaced, so its history goes.
     */
    adopt(next) {
      if (!next || !((next.updatedAt || 0) > (doc.updatedAt || 0)) || saving || doc !== lastSaved) return false;
      doc = next;
      lastSaved = next;
      undoStack.length = 0;
      redoStack.length = 0;
      lastCoalesce = null;
      info = { ...info, title: next.title, updatedAt: next.updatedAt };
      emit({ type: 'external' });
      return true;
    },
    /** Break coalescing, so the next edit starts a new undo step. */
    seal() {
      lastCoalesce = null;
    },
    /** Update the list fields (publish state, status, count). `remote`: a
     *  patch made in another tab, not to be passed on again. */
    setMeta(patch, { remote = false } = {}) {
      info = { ...info, ...patch };
      emit({ type: 'meta' });
      if (!remote && onMeta) onMeta(patch);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Save now if anything is pending. */
    async flush() {
      // Until the latest document is on disk, retrying a failed save too:
      // publishing must never send edits the draft on disk does not have.
      // A failing save rejects. Bounded, in case edits keep arriving.
      for (let i = 0; i < 10 && (saving || doc !== lastSaved); i++) await save();
      // And the survey list's edit time, which saves write sparingly.
      if (repo.flushMeta) await repo.flushMeta(doc.id).catch(() => {});
    },
    retrySave: () => save().catch(() => {}),
    get dirty() {
      return saveState === 'unsaved' || saveState === 'saving' || saveState === 'error';
    },
  };
}
