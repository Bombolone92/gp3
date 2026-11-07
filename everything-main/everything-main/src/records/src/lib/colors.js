/**
 * Option colors for select fields, kanban stacks and row coloring. Each hue
 * has a light chip (dark text on a pale fill) and a strong chip (white or
 * near-black text on a saturated fill), tuned per theme so text keeps at
 * least 4.5:1 contrast. Canvas painting needs real color values, so they
 * live here rather than in CSS.
 */
export const HUES = ['blue', 'cyan', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'gray'];

const LIGHT = {
  blue: ['#dbe8ff', '#123a7a'],
  cyan: ['#d2f1f8', '#0b4a57'],
  teal: ['#d0f2e7', '#0b4f3e'],
  green: ['#ddf2d6', '#1f4f17'],
  yellow: ['#fcefc0', '#574000'],
  orange: ['#fde2cc', '#6a2f08'],
  red: ['#fcdcdc', '#7a1717'],
  pink: ['#fadaee', '#6b134e'],
  purple: ['#e8defb', '#40198a'],
  gray: ['#e5e7eb', '#363b44'],
};

const DARK = {
  blue: ['#1f3963', '#d2e2ff'],
  cyan: ['#15495a', '#cbf1f9'],
  teal: ['#164c3d', '#c6f2e4'],
  green: ['#254b25', '#d3f0cb'],
  yellow: ['#52440f', '#fbebb3'],
  orange: ['#5a3316', '#fddabf'],
  red: ['#5c2525', '#fdd2d2'],
  pink: ['#56203f', '#f9d2ea'],
  purple: ['#3a2b63', '#e4d8fc'],
  gray: ['#383d46', '#e3e6eb'],
};

const STRONG = {
  blue: ['#2563eb', '#ffffff'],
  cyan: ['#0e7490', '#ffffff'],
  teal: ['#0f766e', '#ffffff'],
  green: ['#2f7a24', '#ffffff'],
  yellow: ['#e2ac00', '#1d1d1d'],
  orange: ['#c2410c', '#ffffff'],
  red: ['#c62828', '#ffffff'],
  pink: ['#be185d', '#ffffff'],
  purple: ['#7c3aed', '#ffffff'],
  gray: ['#4b5563', '#ffffff'],
};

/** Every selectable color name: 'blue', 'blueStrong', ... */
export const COLOR_NAMES = [...HUES, ...HUES.map((h) => `${h}Strong`)];

export function isDark() {
  return typeof document !== 'undefined' && document.documentElement.dataset.themeResolved === 'dark';
}

/** [background, text] for a color name in the current theme. */
export function chipColors(name, dark = isDark()) {
  if (!name) name = 'gray';
  if (name.endsWith('Strong')) {
    const hue = name.slice(0, -6);
    return STRONG[hue] || STRONG.gray;
  }
  return (dark ? DARK : LIGHT)[name] || (dark ? DARK : LIGHT).gray;
}

/** A pale row tint for row coloring, from a color name. */
export function rowTint(name, dark = isDark()) {
  const hue = (name || 'gray').replace(/Strong$/, '');
  return (dark ? DARK : LIGHT)[hue]?.[0] || null;
}

/** The dot/accent color (the strong fill) for a color name. */
export function accentColor(name) {
  const hue = (name || 'gray').replace(/Strong$/, '');
  return (STRONG[hue] || STRONG.gray)[0];
}

/** Colors handed out to new options in turn. */
export function nextColor(used = []) {
  return colorPicker(used)();
}

/** nextColor for many new options: each call hands out the next color, counting the ones before. */
export function colorPicker(used = []) {
  const counts = new Map(HUES.map((h) => [h, 0]));
  for (const c of used) if (counts.has(c)) counts.set(c, counts.get(c) + 1);
  return () => {
    let best = HUES[0];
    for (const h of HUES) if (counts.get(h) < counts.get(best)) best = h;
    counts.set(best, counts.get(best) + 1);
    return best;
  };
}

/** Base (database) accent colors for the home screen and top bar. */
export const BASE_COLORS = ['blue', 'cyan', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'gray'];
