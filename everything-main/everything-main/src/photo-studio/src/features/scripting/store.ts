// Installed scripts and script event rules, kept in this browser (IndexedDB).
// Small and loaded at startup: the File → Scripts entries and their shortcuts
// are registered from these records. Script sources stay in the records; the
// runner, editor and sandbox load on first use.
import { IndexedDbStore, MemoryStore, type LocalStore } from '../../persistence/local-store';
import type { AppEvent } from '../../app/app-events';

export type ScriptRecord = {
  id: string;
  name: string;
  description: string;
  source: string;
  // Listed under File → Scripts, with its shortcut, and offered to events.
  enabled: boolean;
  shortcut?: string;
  // The user agreed to run it (asked on the first run of an installed script).
  trusted: boolean;
  // The bundled sample it was installed from.
  sample?: string;
  created: number;
  updated: number;
};
/** Run a script or a recorded action when an application event happens. */
export type EventRule = { id: string; event: AppEvent; kind: 'script' | 'action'; target: string; enabled: boolean };
export type EventSettings = { enabled: boolean; rules: EventRule[] };

type Stores = 'scripts' | 'settings';
let backend: LocalStore<Stores> | undefined;
const db = () => (backend ??= typeof indexedDB !== 'undefined' ? new IndexedDbStore<Stores>('photo-studio-scripts', ['scripts', 'settings']) : new MemoryStore<Stores>());
/** Replace the storage backend (tests). */
export function setScriptBackend(store: LocalStore<Stores>) {
  backend = store;
  loaded = undefined;
  scripts = [];
  events = { enabled: true, rules: [] };
}

let scripts: ScriptRecord[] = [];
let events: EventSettings = { enabled: true, rules: [] };
let loaded: Promise<void> | undefined;
const listeners = new Set<() => void>();
/** Called after scripts or event rules change (menus, panel). */
export function onScriptsChanged(fn: () => void) {
  listeners.add(fn);
}
const changed = () => listeners.forEach((fn) => fn());

/** Read the records once; later calls wait for the same load. */
export function loadScripts(): Promise<void> {
  loaded ??= (async () => {
    try {
      const list = await db().all<ScriptRecord>('scripts');
      scripts = list.filter(validRecord).sort((a, b) => a.created - b.created);
      const ev = await db().get<EventSettings>('settings', 'events');
      if (ev && Array.isArray(ev.rules)) events = { enabled: ev.enabled !== false, rules: ev.rules.filter(validRule) };
    } catch {
      // Storage unavailable (private mode): scripts live for this session only.
    }
    changed();
  })();
  return loaded;
}
const validRecord = (r: ScriptRecord) => !!r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.source === 'string';
const validRule = (r: EventRule) => !!r && typeof r.id === 'string' && typeof r.event === 'string' && (r.kind === 'script' || r.kind === 'action') && typeof r.target === 'string';

export const listScripts = () => scripts;
// The script chosen in the Scripts panel (its footer and menu act on it);
// the first script until another is chosen.
export const scriptSelection = {
  chosen: '',
  get id() {
    return findScript(this.chosen) ? this.chosen : (scripts[0]?.id ?? '');
  },
  set id(v: string) {
    this.chosen = v;
  },
};
export const findScript = (id: string) => scripts.find((s) => s.id === id);

/** Add or replace a script record. */
export async function saveScript(record: ScriptRecord) {
  const i = scripts.findIndex((s) => s.id === record.id);
  if (i >= 0) scripts[i] = record;
  else scripts.push(record);
  changed();
  await db().put('scripts', record.id, record).catch(() => undefined);
}
export async function updateScript(id: string, patch: Partial<ScriptRecord>) {
  const s = findScript(id);
  if (!s) return;
  await saveScript({ ...s, ...patch, updated: patch.source !== undefined ? Date.now() : s.updated });
}
export async function deleteScript(id: string) {
  scripts = scripts.filter((s) => s.id !== id);
  // Event rules naming it go with it.
  const rules = events.rules.filter((r) => !(r.kind === 'script' && r.target === id));
  if (rules.length !== events.rules.length) await saveEvents({ ...events, rules });
  changed();
  await db().delete('scripts', id).catch(() => undefined);
}

/** A record for a new script; the name and description come from its header. */
export function newScriptRecord(source: string, fallbackName: string, extra: Partial<ScriptRecord> = {}): ScriptRecord {
  const meta = scriptMetadata(source);
  const now = Date.now();
  return { id: crypto.randomUUID(), name: meta.name || fallbackName, description: meta.description, source, enabled: true, trusted: false, created: now, updated: now, ...extra };
}

export const eventSettings = () => events;
export async function saveEvents(next: EventSettings) {
  events = next;
  changed();
  await db().put('settings', 'events', next).catch(() => undefined);
}
/** Whether the bundled samples were installed once (removing one keeps it removed). */
export async function samplesInstalled() {
  return !!(await db().get<boolean>('settings', 'samples').catch(() => false));
}
export async function markSamplesInstalled() {
  await db().put('settings', 'samples', true).catch(() => undefined);
}

/** Name and description from `// @name …` and `// @description …` lines at
 * the top of a script (before its first statement). */
export function scriptMetadata(source: string): { name: string; description: string; timeout?: number } {
  const out: { name: string; description: string; timeout?: number } = { name: '', description: '' };
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.startsWith('//')) break;
    const m = /^\/\/\s*@(\w+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim();
    if (m[1] === 'name') out.name = value.slice(0, 80);
    else if (m[1] === 'description') out.description = value.slice(0, 300);
    else if (m[1] === 'timeout' && Number(value) > 0) out.timeout = Math.min(3600, Number(value));
  }
  return out;
}
