export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Modifiers and key of a shortcut string; "+" itself can be the key ("Mod++"). */
function splitShortcut(s: string) {
  const plus = s === '+' || s.endsWith('++');
  const parts = (plus ? s.slice(0, -1) : s).split('+').map((p) => p.trim());
  const key = plus ? '+' : parts.pop()!;
  return { mods: new Set(parts.filter(Boolean).map((p) => p.toLowerCase())), key };
}
// Normalized form: modifiers in fixed order then the key, e.g. "Mod+Shift+Z".
export function normalizeShortcut(s: string) {
  const { mods, key } = splitShortcut(s);
  const out: string[] = [];
  if (mods.has('mod')) out.push('Mod');
  if (mods.has('ctrl') || mods.has('control')) out.push('Ctrl');
  if (mods.has('alt') || mods.has('opt') || mods.has('option')) out.push('Alt');
  if (mods.has('shift')) out.push('Shift');
  out.push(key.length === 1 ? key.toUpperCase() : key);
  return out.join('+');
}
/** The form `eventShortcut` produces for a shortcut on a platform: away from
 * macOS, Ctrl is the Mod key, so "Mod+Ctrl+F" cannot be typed there (null). */
export function platformShortcut(s: string, mac = isMac): string | null {
  const n = normalizeShortcut(s);
  if (mac) return n;
  const { mods, key } = splitShortcut(n);
  if (mods.has('ctrl')) {
    if (mods.has('mod')) return null;
    mods.delete('ctrl');
    mods.add('mod');
  }
  return normalizeShortcut([...mods, key].join('+'));
}
/** The next brush size for [ and ]: finer steps for small brushes. */
export function brushSizeStep(size: number, up: boolean) {
  const step = size < 10 ? 1 : size < 100 ? 10 : size < 200 ? 25 : size < 300 ? 50 : 100;
  return Math.max(1, Math.min(5000, size + (up ? step : -step)));
}
type Bound = { id: string; shortcut?: string | string[]; hidden?: boolean };
type Keyed = { id: string; key?: string; group: string };
/** Problems with a set of bindings on one platform: two commands on one
 * shortcut (they share the global context), a shortcut that cannot be typed,
 * a bare-key command that hides a tool key, and one tool key in two toolbar slots. */
export function shortcutConflicts(commands: Iterable<Bound>, tools: Iterable<Keyed> = [], mac = isMac): string[] {
  const problems: string[] = [];
  const owners = new Map<string, string>();
  for (const c of commands) {
    const list = Array.isArray(c.shortcut) ? c.shortcut : c.shortcut ? [c.shortcut] : [];
    // Alternatives for one platform are fine as long as one works everywhere it matters.
    if (list.length && list.every((s) => !platformShortcut(s, mac))) problems.push(`${c.id}: ${list.join(', ')} cannot be typed on ${mac ? 'macOS' : 'Windows/Linux'}`);
    for (const s of list) {
      const typed = platformShortcut(s, mac);
      if (!typed) continue;
      const other = owners.get(typed);
      if (other && other !== c.id) problems.push(`${typed} is bound to both ${other} and ${c.id}`);
      else owners.set(typed, c.id);
    }
  }
  const slots = new Map<string, string>();
  for (const t of tools) {
    if (!t.key) continue;
    const key = t.key.toUpperCase();
    const command = owners.get(key) ?? owners.get(`Shift+${key}`);
    if (command) problems.push(`${t.id}: tool key ${key} is taken by ${command}`);
    const slot = slots.get(key);
    if (slot && slot !== t.group) problems.push(`tool key ${key} is used in the ${slot} and ${t.group} slots`);
    else slots.set(key, t.group);
  }
  return problems;
}
// Keys that change with Shift on US layouts are matched by their unshifted code.
const codeKeys: Record<string, string> = {
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
  Slash: '/', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
};
export function eventShortcut(event: KeyboardEvent) {
  let key = event.key;
  if (event.code in codeKeys) key = codeKeys[event.code];
  else if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit\d$/.test(event.code)) key = event.code.slice(5);
  else if (key === ' ') key = 'Space';
  const out: string[] = [];
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (mod) out.push('Mod');
  if (isMac && event.ctrlKey) out.push('Ctrl');
  if (event.altKey) out.push('Alt');
  if (event.shiftKey) out.push('Shift');
  out.push(key.length === 1 ? key.toUpperCase() : key);
  return out.join('+');
}
export function formatShortcut(s: string | string[] | undefined) {
  if (!s) return '';
  // The first alternative that can be typed on this platform.
  const list = Array.isArray(s) ? s : [s];
  const first = list.find((x) => platformShortcut(x) !== null) ?? list[0];
  const { mods, key } = splitShortcut(normalizeShortcut(first));
  const parts = [...mods].map((m) => m[0].toUpperCase() + m.slice(1));
  const glyph: Record<string, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }
    : { Mod: 'Ctrl+', Ctrl: 'Ctrl+', Alt: 'Alt+', Shift: 'Shift+' };
  const keyGlyph: Record<string, string> = {
    Backspace: '⌫', Delete: 'Del', Escape: 'Esc', Enter: '↵', ArrowUp: '↑', ArrowDown: '↓',
    ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Tab: 'Tab',
  };
  // macOS menus list modifiers as ⌃⌥⇧⌘.
  const order = isMac ? ['Ctrl', 'Alt', 'Shift', 'Mod'] : ['Mod', 'Ctrl', 'Alt', 'Shift'];
  return order.filter((m) => parts.includes(m)).map((m) => glyph[m]).join('') + (keyGlyph[key] ?? key);
}
