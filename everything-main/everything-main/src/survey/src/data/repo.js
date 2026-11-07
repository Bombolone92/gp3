/**
 * The creator's own data, in their Puter account.
 *
 * Storage plan (puter.kv is DynamoDB-backed: billed per KB read and written,
 * no secondary indexes, so every read path is a key):
 *
 *   KV  sv:index            { [surveyId]: SurveyMeta }  one read lists every
 *                           survey for the home screen; edits touch one item
 *                           with update()/remove() paths
 *   KV  sv:folders          { [folderId]: { name, at } }
 *   KV  sv:settings         user preferences (theme, dismissed notices)
 *   KV  sv:collectors:<sid> { [collectorId]: Collector }  per survey, read
 *                           only on that survey's Collect and Analyze screens
 *   FS  surveys/<sid>.json  the survey document. It is always loaded and
 *                           saved whole, can grow past a few dozen KB, and is
 *                           autosaved often, so it is a file: a KV entry would
 *                           bill every autosave by the size of the document.
 *
 * Responses do not live here; they stay in the collector worker's KV and
 * are cached per device (see responses.js).
 */
import { normalizeSurvey, questionCount } from '../model/survey.js';
import { coerce } from './collector-client.js';
import { surveyId as newSurveyId, folderId as newFolderId } from '../lib/ids.js';

export const INDEX_KEY = 'sv:index';
export const FOLDERS_KEY = 'sv:folders';
export const SETTINGS_KEY = 'sv:settings';
export const collectorsKey = (sid) => `sv:collectors:${sid}`;
export const surveyPath = (sid) => `surveys/${sid}.json`;

/** What the home screen shows for a survey, kept in sv:index. */
export function metaFor(survey, prev = {}) {
  return {
    title: survey.title,
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt,
    questions: questionCount(survey),
    pages: survey.pages.length,
    status: prev.status || 'draft',
    folder: prev.folder || '',
    responses: prev.responses || 0,
    publishedAt: prev.publishedAt || 0,
    // The survey's updatedAt when it was last published: a newer updatedAt
    // means respondents still see an older version.
    publishedVersion: prev.publishedVersion || 0,
    collectors: prev.collectors || 0,
  };
}

export function createRepo({ kv, fs }) {
  let index = null;

  async function loadIndex() {
    index = coerce(await kv.get(INDEX_KEY)) || {};
    return index;
  }

  const INDEX_TIME_MS = 60_000;
  const indexWrittenAt = new Map();
  const deferredAt = new Map();

  async function patchMeta(sid, patch) {
    if (!index) await loadIndex();
    const prev = index[sid] || {};
    const next = { ...prev, ...patch };
    index = { ...index, [sid]: next };
    const paths = {};
    for (const [k, v] of Object.entries(patch)) paths[`${sid}.${k}`] = v;
    // A path write into a missing item creates it, but only with the
    // patched fields: write the whole item the first time.
    const known = !!(prev && Object.keys(prev).length);
    const stored = await kv.update(INDEX_KEY, known ? paths : { [sid]: next });
    if (known && (await dropRecreated(sid, stored, Object.keys(patch)))) throw Object.assign(new Error('This survey was deleted'), { code: 'deleted' });
    return next;
  }

  /**
   * The store hands back the list as written. An entry holding only the
   * fields just written means the survey was deleted meanwhile (in another
   * tab or on another device) and the write brought back a bare entry:
   * remove it, and the survey file a save may have written. True if so.
   */
  async function dropRecreated(sid, stored, written) {
    const entry = stored && typeof stored === 'object' ? stored[sid] : null;
    if (!entry || typeof entry !== 'object' || !Object.keys(entry).every((k) => written.includes(k))) return false;
    await kv.remove(INDEX_KEY, sid).catch(() => {});
    await fs.delete(surveyPath(sid)).catch(() => {});
    const rest = { ...index };
    delete rest[sid];
    index = rest;
    return true;
  }

  /**
   * Patch several surveys' entries in one index write: { sid: patch }. The
   * KV bills a write by the whole entry, so one write per survey would cost
   * as many full index writes. Applied here only once stored.
   */
  async function patchMany(patches) {
    if (!index) await loadIndex();
    const update = {};
    const next = { ...index };
    for (const [sid, patch] of Object.entries(patches)) {
      const prev = index[sid] || {};
      next[sid] = { ...prev, ...patch };
      if (Object.keys(prev).length) for (const [k, v] of Object.entries(patch)) update[`${sid}.${k}`] = v;
      else update[sid] = next[sid];
    }
    if (!Object.keys(update).length) return;
    await kv.update(INDEX_KEY, update);
    index = next;
  }

  return {
    get index() {
      return index;
    },
    loadIndex,
    patchMeta,
    patchMany,

    async loadSurvey(sid) {
      const text = await fs.readText(surveyPath(sid));
      return normalizeSurvey(JSON.parse(text));
    },

    async saveSurvey(survey) {
      // A survey this copy of the list has not heard of (created or
      // published in another tab since it loaded): read the list again
      // rather than write its entry over with draft defaults. Gone from
      // the list too, it was deleted (in another tab): saving would bring
      // back half of it.
      if (!index || !index[survey.id]) await loadIndex();
      if (!index[survey.id]) throw Object.assign(new Error('This survey was deleted'), { code: 'deleted' });
      await fs.write(surveyPath(survey.id), JSON.stringify(survey), { createMissingParents: true });
      const prev = index[survey.id] || {};
      const meta = metaFor(survey, prev);
      const changed = {};
      for (const [k, v] of Object.entries(meta)) if (prev[k] !== v) changed[k] = v;
      const keys = Object.keys(changed);
      // Every autosave changes updatedAt, and the store bills a write by
      // the whole survey list: on its own it goes to the list at most once
      // a minute (flushMeta writes what is left), kept current in memory.
      if (keys.length === 1 && keys[0] === 'updatedAt' && Date.now() - (indexWrittenAt.get(survey.id) || 0) < INDEX_TIME_MS) {
        index = { ...index, [survey.id]: { ...prev, updatedAt: changed.updatedAt } };
        deferredAt.set(survey.id, changed.updatedAt);
        return meta;
      }
      if (keys.length) {
        await patchMeta(survey.id, changed);
        indexWrittenAt.set(survey.id, Date.now());
        deferredAt.delete(survey.id);
      }
      return meta;
    },

    /** Write a survey's edit time held back by saveSurvey, if any. */
    async flushMeta(sid) {
      if (!deferredAt.has(sid)) return;
      const updatedAt = deferredAt.get(sid);
      deferredAt.delete(sid);
      try {
        const stored = await kv.update(INDEX_KEY, { [`${sid}.updatedAt`]: updatedAt });
        if (await dropRecreated(sid, stored, ['updatedAt'])) return;
        indexWrittenAt.set(sid, Date.now());
      } catch (err) {
        if (!deferredAt.has(sid)) deferredAt.set(sid, updatedAt);
        throw err;
      }
    },

    async createSurvey(survey, { folder = '' } = {}) {
      const doc = normalizeSurvey({ ...survey, createdAt: Date.now(), updatedAt: Date.now() });
      await fs.write(surveyPath(doc.id), JSON.stringify(doc), { createMissingParents: true });
      await patchMeta(doc.id, { ...metaFor(doc), folder });
      return doc;
    },

    async duplicateSurvey(sid) {
      const src = await this.loadSurvey(sid);
      const copy = { ...structuredClone(src), id: newSurveyId(), title: `Copy of ${src.title}`.slice(0, 300) };
      return this.createSurvey(copy, { folder: (index && index[sid] && index[sid].folder) || '' });
    },

    async deleteSurvey(sid) {
      await fs.delete(surveyPath(sid)).catch(() => {});
      await kv.del(collectorsKey(sid)).catch(() => {});
      if (!index) await loadIndex();
      const next = { ...index };
      delete next[sid];
      index = next;
      await kv.remove(INDEX_KEY, sid);
    },

    /* ---- Folders ---- */
    async loadFolders() {
      return coerce(await kv.get(FOLDERS_KEY)) || {};
    },
    async createFolder(name) {
      const id = newFolderId();
      await kv.update(FOLDERS_KEY, { [id]: { name: String(name).slice(0, 100), at: Date.now() } });
      return id;
    },
    async renameFolder(id, name) {
      await kv.update(FOLDERS_KEY, { [`${id}.name`]: String(name).slice(0, 100) });
    },
    async deleteFolder(id) {
      if (!index) await loadIndex();
      const moved = {};
      for (const [sid, meta] of Object.entries(index)) if (meta.folder === id) moved[sid] = { folder: '' };
      await patchMany(moved);
      await kv.remove(FOLDERS_KEY, id);
    },

    /* ---- Settings ---- */
    async loadSettings() {
      return coerce(await kv.get(SETTINGS_KEY)) || {};
    },
    async updateSettings(patch) {
      return kv.update(SETTINGS_KEY, patch);
    },

    /* ---- Collectors ---- */
    async loadCollectors(sid) {
      return coerce(await kv.get(collectorsKey(sid))) || {};
    },
    async saveCollector(sid, collector) {
      await kv.update(collectorsKey(sid), { [collector.id]: collector });
    },
    async removeCollector(sid, cid) {
      await kv.remove(collectorsKey(sid), cid);
    },
  };
}
