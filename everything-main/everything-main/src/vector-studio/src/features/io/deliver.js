/**
 * Delivering exported files: download to the device (always available) or
 * save to the user's Puter cloud through Puter's own file pickers when the
 * app runs with Puter and the user is signed in. Files always go to
 * puter.fs (never key-value storage).
 */
import { createZip } from './zip.js';

export function canSaveToPuter(app) {
  return Boolean(app?.puter?.ui?.showSaveFilePicker && app.user);
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A Puter picker promise that resolves undefined on cancel where the SDK supports it (otherwise it never settles). */
const cancellable = (p) => (p && p.undefinedOnCancel ? p.undefinedOnCancel : p);

/** Strip characters that file systems reject. */
export function safeFileName(name, fallback = 'Untitled') {
  const s = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return s.slice(0, 180) || fallback;
}

/**
 * Deliver files [{ name, blob }] to 'device' or 'puter'. Several files go
 * to the device as separate downloads (or one zip with `zip: true`), and to
 * Puter into a folder the user picks.
 * Resolves to a short status message (or null when the user cancelled).
 */
export async function deliverFiles(app, files, { dest = 'device', zip = false, zipName = 'Export.zip' } = {}) {
  if (!files.length) return null;
  if (zip && files.length > 1) {
    const blob = await createZip(files.map((f) => ({ name: f.name, data: f.blob })));
    files = [{ name: zipName, blob }];
  }
  if (dest === 'puter' && canSaveToPuter(app)) {
    const ui = app.puter.ui;
    if (files.length === 1) {
      const item = await cancellable(ui.showSaveFilePicker(files[0].blob, files[0].name));
      return item ? `Saved ${item.name || files[0].name} to Puter.` : null;
    }
    if (ui.showDirectoryPicker && app.puter.fs?.write) {
      let dir = await cancellable(ui.showDirectoryPicker());
      if (Array.isArray(dir)) dir = dir[0];
      if (!dir?.path) return null;
      for (const f of files) await app.puter.fs.write(`${dir.path}/${f.name}`, f.blob, { dedupeName: true });
      return `Saved ${files.length} files to ${dir.name || 'Puter'}.`;
    }
    const blob = await createZip(files.map((f) => ({ name: f.name, data: f.blob })));
    const item = await cancellable(ui.showSaveFilePicker(blob, zipName));
    return item ? `Saved ${item.name || zipName} to Puter.` : null;
  }
  for (let i = 0; i < files.length; i++) {
    downloadBlob(files[i].blob, files[i].name);
    // Browsers drop rapid successive downloads; space them out a little.
    if (i < files.length - 1) await wait(250);
  }
  return files.length === 1 ? `Downloaded ${files[0].name}.` : `Downloaded ${files.length} files.`;
}
