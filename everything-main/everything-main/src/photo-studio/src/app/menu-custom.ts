// Menu customization (Edit → Menus…): commands can be hidden from the menu bar
// or tagged with a color so frequently used items stand out. Keyed by command
// ID; context menus and keyboard shortcuts are unaffected.

export const menuTagColors = ['red', 'orange', 'yellow', 'green', 'blue', 'violet', 'gray'] as const;
export type MenuTag = (typeof menuTagColors)[number];
export type MenuCustomization = { hidden?: string[]; colors?: Record<string, MenuTag> };

export function sanitizeMenuCustomization(v: unknown): MenuCustomization {
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const out: MenuCustomization = {};
  const hidden = Array.isArray(o.hidden) ? [...new Set(o.hidden.filter((s): s is string => typeof s === 'string'))] : [];
  if (hidden.length) out.hidden = hidden;
  const colors: Record<string, MenuTag> = {};
  if (o.colors && typeof o.colors === 'object')
    for (const [id, c] of Object.entries(o.colors as Record<string, unknown>))
      if ((menuTagColors as readonly unknown[]).includes(c)) colors[id] = c as MenuTag;
  if (Object.keys(colors).length) out.colors = colors;
  return out;
}
export const isHiddenInMenus = (custom: MenuCustomization, id: string) => !!custom.hidden?.includes(id);
export const menuTag = (custom: MenuCustomization, id: string): MenuTag | undefined => custom.colors?.[id];
/** Set or clear one command's visibility and color; returns a new customization. */
export function customizeItem(custom: MenuCustomization, id: string, change: { hidden?: boolean; color?: MenuTag | null }): MenuCustomization {
  const hidden = new Set(custom.hidden ?? []);
  const colors = { ...(custom.colors ?? {}) };
  if (change.hidden === true) hidden.add(id);
  if (change.hidden === false) hidden.delete(id);
  if (change.color === null) delete colors[id];
  else if (change.color) colors[id] = change.color;
  return sanitizeMenuCustomization({ hidden: [...hidden], colors });
}

const storageKey = 'photo-studio-menus';
let current: MenuCustomization = (() => {
  try {
    return sanitizeMenuCustomization(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));
  } catch {
    return {};
  }
})();
export const menuCustomization = () => current;
export function setMenuCustomization(custom: MenuCustomization) {
  current = sanitizeMenuCustomization(custom);
  try {
    if (current.hidden || current.colors) localStorage.setItem(storageKey, JSON.stringify(current));
    else localStorage.removeItem(storageKey);
  } catch {
    /* Optional. */
  }
}
