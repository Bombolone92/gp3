// Crash and tab-close recovery: unsaved documents are written to browser
// storage at the interval in Preferences → History & Autosave; the next
// launch offers to restore documents whose page is no longer running.
// Records are removed when a document is saved or closed.
import type { Editor } from '../../editor';
import type { DocumentSession } from '../../app/session';
import type { PhotoDocument } from '../../model/document';
import { escapeXML } from '../../model/assets';
import { deserialize, serialize } from '../../model/serialization';
import { liveInstances, RecoveryStore, relativeTime, type RecoveryRecord } from '../../persistence/versions';
import { documentThumbnail } from './thumbs';

const store = new RecoveryStore();
const instance = crypto.randomUUID();
const BEATS = 'photo-studio-instances';
const recovered = new WeakMap<DocumentSession, PhotoDocument>();

function readBeats(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(BEATS) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function writeBeats(beats: Record<string, number>) {
  try {
    localStorage.setItem(BEATS, JSON.stringify(beats));
  } catch {
    /* Optional. */
  }
}
/** Mark this page as running (records it writes are not offered elsewhere). */
function heartbeat(alive = true) {
  const beats = liveInstances(readBeats());
  if (alive) beats[instance] = Date.now();
  else delete beats[instance];
  writeBeats(beats);
}

/** Write recovery records for unsaved documents changed since the last write. */
export async function recoveryTick(e: Editor) {
  for (const s of e.sessions) {
    // Embedded object contents recover through their parent document.
    if (!s.hasDocument || s.saveHandler) continue;
    if (!s.dirty) {
      if (recovered.has(s)) {
        recovered.delete(s);
        await store.remove(s.id);
      }
      continue;
    }
    if (recovered.get(s) === s.doc) continue;
    const doc = s.doc;
    const project = await serialize(doc, s.assets);
    const thumb = await documentThumbnail(e, s, 160).catch(() => undefined);
    await store.save({ sessionId: s.id, instance, docId: doc.id, name: doc.name, fileName: s.fileName, path: s.storage.path, time: Date.now(), project, thumb });
    recovered.set(s, doc);
  }
}

let timer = 0;
function schedule(e: Editor, tick: () => Promise<void>) {
  clearInterval(timer);
  const minutes = e.preferences.recoveryMinutes;
  if (!minutes) return;
  timer = window.setInterval(() => void tick().catch((error) => console.error(error)), minutes * 60_000);
}

async function offerRecovery(e: Editor) {
  const records = await store.orphaned(liveInstances(readBeats()));
  if (!records.length) return;
  const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
  const urls = records.map((r) => (r.thumb ? URL.createObjectURL(r.thumb) : ''));
  dialog.innerHTML = `<form method="dialog" class="recovery-dialog"><h2>Restore Unsaved Documents?</h2><p>Photo Studio closed with unsaved changes. These documents were kept in this browser.</p><div class="recovery-list">${records
    .map(
      (r, i) =>
        `<label class="recovery-item"><input type="checkbox" name="keep" value="${i}" checked><span class="recovery-thumb">${urls[i] ? `<img src="${urls[i]}" alt="">` : ''}</span><span class="recovery-meta"><strong>${escapeXML(r.name)}</strong><small>${escapeXML(r.path ?? r.fileName ?? 'Never saved')} · ${relativeTime(r.time)}</small></span></label>`,
    )
    .join('')}</div><div class="dialog-actions"><button type="button" data-discard class="dialog-discard">Discard All</button><button type="button" data-later>Not Now</button><button type="submit" class="primary">Restore</button></div></form>`;
  const done = () => {
    dialog.close();
    for (const u of urls) if (u) URL.revokeObjectURL(u);
  };
  dialog.querySelector('[data-later]')!.addEventListener('click', done);
  dialog.querySelector('[data-discard]')!.addEventListener('click', () => {
    done();
    void Promise.all(records.map((r) => store.remove(r.sessionId))).then(() => e.message('Recovered documents discarded.'));
  });
  dialog.querySelector('form')!.onsubmit = (ev) => {
    ev.preventDefault();
    const chosen = new FormData(ev.currentTarget as HTMLFormElement).getAll('keep').map((v) => records[Number(v)]);
    done();
    void e.run(async () => {
      for (const r of chosen) await restoreRecord(e, r);
      // Unchecked documents are discarded too: the dialog asked once.
      for (const r of records) await store.remove(r.sessionId);
      if (chosen.length) e.message(`Restored ${chosen.length} document${chosen.length === 1 ? '' : 's'}. Save to keep ${chosen.length === 1 ? 'it' : 'them'}.`);
    });
  };
  dialog.showModal();
}
async function restoreRecord(e: Editor, r: RecoveryRecord) {
  const loaded = await deserialize(r.project);
  const s = e.sessionForOpen();
  s.assets = loaded.assets;
  s.history.reset(loaded.document);
  s.hasDocument = true;
  s.fileName = r.fileName;
  if (r.path) s.storage.path = r.path;
  // Restored content is unsaved until the user saves it.
  s.saved = undefined;
  e.session = s;
  e.fit();
  e.update();
}

export function installRecovery(e: Editor, tick: () => Promise<void>) {
  heartbeat();
  window.setInterval(() => heartbeat(), 20_000);
  // A closed page leaves its records for the next launch.
  window.addEventListener('pagehide', () => heartbeat(false));
  schedule(e, tick);
  let minutes = e.preferences.recoveryMinutes;
  e.preferenceHooks.push(() => {
    if (e.preferences.recoveryMinutes === minutes) return;
    minutes = e.preferences.recoveryMinutes;
    schedule(e, tick);
  });
  // Saved or closed documents need no recovery.
  e.saveHooks.push((s) => {
    recovered.delete(s);
    void store.remove(s.id);
  });
  e.closeHooks.push((s) => {
    recovered.delete(s);
    void store.remove(s.id);
  });
  e.whenReady(() => void offerRecovery(e).catch((error) => console.error(error)));
}
