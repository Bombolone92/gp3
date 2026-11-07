// Version history. A copy of the project is kept on manual saves and at most
// every ten minutes while autosaving, as ordinary files next to the project
// (in the user's storage or this browser's private storage), never in the
// key-value store. The newest 40 versions are kept.

import { h, clear } from '../ui/dom.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { puter, isMissing, toMs } from './puter.js';
import { parseProject } from '../model/project.js';

const KEEP = 40;
const AUTO_INTERVAL = 10 * 60_000;
const CLOUD_DIR = 'Projects/.versions';
const LOCAL_DIR = 'circuits-versions';

const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-');

async function localDir(projectId, create) {
  if (!navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle(LOCAL_DIR, { create });
    return await base.getDirectoryHandle(projectId, { create });
  } catch { return null; }
}

/** Lists versions, newest first: [{ name, date, size, ref }]. */
export async function listVersions(location, projectId) {
  const out = [];
  if (location?.type === 'cloud') {
    try {
      const items = await puter().fs.readdir(`${CLOUD_DIR}/${projectId}`);
      for (const it of items) if (it.name.endsWith('.circuits')) out.push({ name: it.name, date: toMs(it.modified) || Date.parse(nameToIso(it.name)), size: it.size, ref: it.path });
    } catch (err) { if (!isMissing(err)) throw err; }
  } else {
    const dir = await localDir(projectId, false);
    if (dir) {
      for await (const [name, handle] of dir.entries()) {
        if (!name.endsWith('.circuits')) continue;
        const f = await handle.getFile();
        out.push({ name, date: Date.parse(nameToIso(name)) || f.lastModified, size: f.size, ref: name });
      }
    }
  }
  return out.sort((a, b) => b.date - a.date);
}

function nameToIso(name) {
  // 2026-10-12T19-30-05-123Z.circuits -> 2026-10-12T19:30:05.123Z
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : '';
}

async function readVersion(location, projectId, v) {
  if (location?.type === 'cloud') return (await puter().fs.read(v.ref)).text();
  const dir = await localDir(projectId, false);
  return (await (await dir.getFileHandle(v.ref)).getFile()).text();
}

/**
 * Records a version of the project after a save. Manual saves always keep a
 * version; autosaves keep one at most every ten minutes.
 */
export async function recordVersion(location, projectId, text, { auto = false, lastAt = 0 } = {}) {
  if (!location) return lastAt;
  const now = Date.now();
  if (auto && now - lastAt < AUTO_INTERVAL) return lastAt;
  const name = `${stamp()}.circuits`;
  try {
    if (location.type === 'cloud') {
      await puter().fs.write(`${CLOUD_DIR}/${projectId}/${name}`, text, { createMissingParents: true });
    } else {
      const dir = await localDir(projectId, true);
      if (!dir) return lastAt;
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    }
    await prune(location, projectId);
  } catch (err) {
    console.warn('Could not keep a version', err);
    return lastAt;
  }
  return now;
}

async function prune(location, projectId) {
  const list = await listVersions(location, projectId);
  for (const v of list.slice(KEEP)) {
    try {
      if (location.type === 'cloud') await puter().fs.delete(v.ref);
      else await (await localDir(projectId, false))?.removeEntry(v.ref);
    } catch { /* already gone */ }
  }
}

export async function historyDialog(app) {
  const p = app.project;
  if (!p) return;
  if (!app.location) { app.toast('Save the project first. Versions are kept each time you save.', { kind: 'info' }); return; }
  const host = h('div', h('p.muted', 'Loading versions...'));
  let dlg;
  const render = async () => {
    let list = [];
    try { list = await listVersions(app.location, p.id); } catch (err) { clear(host); host.append(h('p.sev-error', `Could not list versions: ${err.message}`)); return; }
    clear(host);
    if (!list.length) { host.append(h('p.muted', 'No versions yet. A version is kept every time you save, and every ten minutes while autosaving.')); return; }
    const rows = list.map((v) => h('tr',
      h('td', new Date(v.date).toLocaleString()),
      h('td.muted', v.size ? `${Math.max(1, Math.round(v.size / 1024))} KB` : ''),
      h('td', { style: { textAlign: 'right' } },
        h('button.btn.sm', { type: 'button', onClick: async () => {
          if (!(await confirmDialog({ title: 'Restore version', message: `Replace the open project with the version from ${new Date(v.date).toLocaleString()}? The current state is kept as a version first, so you can come back to it.`, confirm: 'Restore' }))) return;
          try {
            const current = JSON.stringify(p.toJSON());
            await recordVersion(app.location, p.id, current);
            const restored = parseProject(await readVersion(app.location, p.id, v));
            restored.id = p.id;
            dlg.close();
            app.setProject(restored, app.location);
            app.saveState = 'dirty';
            for (const d of restored.docs) d.store.revision++;
            await app.save();
            app.toast('Version restored.', { kind: 'success' });
          } catch (err) { app.toast(`Could not restore: ${err.message}`, { kind: 'error' }); }
        } }, 'Restore'))));
    host.append(h('div.table-wrap', h('table.grid', h('thead', h('tr', h('th', 'Saved'), h('th', 'Size'), h('th', h('span.sr-only', 'Actions')))), h('tbody', rows))));
  };
  render();
  dlg = openDialog({ title: `Version history: ${p.name}`, size: 'wide', body: host, actions: [{ label: 'Close', primary: true }] });
  await dlg.result;
}
