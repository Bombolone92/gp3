/**
 * What belongs to the user rather than to a workspace, kept in the user's
 * own Puter account through `puter.kv` (scoped to this app): their profile
 * card, preferences, the list of workspaces they are in (each on someone's
 * worker), and the worker they deployed themselves, if any. One document,
 * one read at boot.
 *
 *   tcu:me  { v, profile: { name, title, color }, prefs: { theme, notify, enterSends,
 *             evConsent: 'declined' | undefined }, workspaces: [{ ref, name, sample }],
 *             worker: { name, url, path, build } | null }
 *
 * `prefs.evConsent` remembers a workspace owner declining the one-time
 * events consent toast (see src/ui/shell.js), so it is never offered again;
 * absent means "not asked, or asked and granted" — granting is recorded on
 * the worker itself (GET /api/server's `delegated`), not here.
 *
 * The `tcu:` prefix keeps clear of the `tc:` keys a worker writes, in case a
 * worker deployed from this app shares the account's app-scoped namespace.
 */

export const USER_DOC_KEY = 'tcu:me';

const empty = () => ({ v: 1, profile: {}, prefs: {}, workspaces: [], worker: null });

export async function loadUserDoc() {
  let doc = null;
  try {
    doc = await puter.kv.get(USER_DOC_KEY);
  } catch (e) {
    throw new Error(`Could not read your Teamchat settings from Puter: ${e?.message || e}`);
  }
  const d = { ...empty(), ...(doc && typeof doc === 'object' ? doc : {}) };
  d.profile = d.profile && typeof d.profile === 'object' ? d.profile : {};
  d.prefs = d.prefs && typeof d.prefs === 'object' ? d.prefs : {};
  d.workspaces = Array.isArray(d.workspaces) ? d.workspaces.filter((w) => w && typeof w.ref === 'string') : [];
  d.worker = d.worker && typeof d.worker === 'object' && d.worker.url ? d.worker : null;
  return d;
}

export async function saveUserDoc(doc) {
  await puter.kv.set(USER_DOC_KEY, doc);
  return doc;
}
