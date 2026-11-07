// "My library": components the user created, available in every project.
// Kept as one library file in the user's Puter storage, or in this browser's
// private storage when signed out.

import { Emitter } from '../core/emitter.js';
import { puter, cloudAvailable, isMissing } from './puter.js';
import { LIBRARY_FORMAT } from '../model/schema.js';

const CLOUD_PATH = 'Libraries/My components.circuitslib';
const LOCAL_FILE = 'my-components.circuitslib';

async function localDir() {
  if (!navigator.storage?.getDirectory) return null;
  try { return await navigator.storage.getDirectory(); } catch { return null; }
}

export class UserLibrary extends Emitter {
  constructor() {
    super();
    this.defs = new Map();
    this.loaded = false;
  }

  all() { return [...this.defs.values()]; }

  async load() {
    let text = null;
    try {
      if (cloudAvailable()) text = await (await puter().fs.read(CLOUD_PATH)).text();
      else {
        const dir = await localDir();
        if (dir) text = await (await (await dir.getFileHandle(LOCAL_FILE)).getFile()).text();
      }
    } catch (err) {
      if (!isMissing(err) && err?.name !== 'NotFoundError') console.warn('Could not load My library', err);
    }
    this.defs.clear();
    if (text) {
      try {
        const data = JSON.parse(text);
        if (data.format === LIBRARY_FORMAT) for (const d of data.components || []) if (d?.id && d.symbol) this.defs.set(d.id, d);
      } catch { /* ignore a damaged file */ }
    }
    this.loaded = true;
    this.emit('change');
  }

  async put(def) {
    this.defs.set(def.id, structuredClone(def));
    this.emit('change');
    await this._save();
  }

  async remove(id) {
    if (!this.defs.delete(id)) return;
    this.emit('change');
    await this._save();
  }

  async _save() {
    const text = JSON.stringify({ format: LIBRARY_FORMAT, version: 1, name: 'My components', components: this.all() });
    try {
      if (cloudAvailable()) await puter().fs.write(CLOUD_PATH, text, { overwrite: true, createMissingParents: true });
      else {
        const dir = await localDir();
        if (!dir) return;
        const w = await (await dir.getFileHandle(LOCAL_FILE, { create: true })).createWritable();
        await w.write(text);
        await w.close();
      }
    } catch (err) { console.warn('Could not save My library', err); }
  }
}
