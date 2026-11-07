/**
 * User preferences, persisted to localStorage (small settings only; files
 * never go here). Reads fall back to defaults when storage is unavailable.
 */
import { Emitter } from './lib/emitter.js';

const KEY = 'vector-studio:prefs';

export const DEFAULT_PREFS = {
  theme: 'system', // system | light | dark
  keyboardIncrement: 1, // pt
  units: 'pt',
  previewBounds: false,
  scaleStrokes: false,
  scaleCorners: false,
  autoAddDelete: true,
  fillNewPencil: false,
  contextualTaskbar: true,
  toolbarColumns: 'auto', // 1 | 2 | 'auto' (two columns when one does not fit)
  undoLevels: 200,
  constrainAngle: 0,
  cornerRadius: 12,
  dockTab: 'properties',
  dockOpen: true,
  openPanels: [],
  recentFiles: [],
  alignmentGuides: true,
  showStartScreen: true,
  lastRect: null,
  lastEllipse: null,
  exportScale: 2,
};

export class Prefs extends Emitter {
  constructor(storage = safeStorage()) {
    super();
    this.storage = storage;
    this.values = { ...DEFAULT_PREFS };
    try {
      const raw = storage?.getItem(KEY);
      if (raw) Object.assign(this.values, JSON.parse(raw));
      if (migrate(this.values)) this.save();
    } catch {
      // Corrupt or unavailable storage: keep defaults.
    }
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.save();
    this.emit('change', { key, value });
  }

  save() {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.values));
    } catch {
      // Quota or privacy mode: preferences just will not persist.
    }
  }
}

// Keys (and the Preferences section id) under the names used by earlier versions.
const RENAMED_KEYS = {
  smartGuides: 'alignmentGuides',
  smartGuideColor: 'alignmentGuideColor',
  smartGuideHighlight: 'alignmentGuideHighlight',
  smartGuideLabels: 'alignmentGuideLabels',
};
const RENAMED_SECTIONS = { smart: 'alignment' };

/** Move stored values to their current names. Returns true when anything changed. */
export function migrate(values) {
  let changed = false;
  for (const [from, to] of Object.entries(RENAMED_KEYS)) {
    if (!(from in values)) continue;
    values[to] = values[from];
    delete values[from];
    changed = true;
  }
  if (values.prefsSection in RENAMED_SECTIONS) {
    values.prefsSection = RENAMED_SECTIONS[values.prefsSection];
    changed = true;
  }
  return changed;
}

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
