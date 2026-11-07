import { componentsToColor } from 'pdf-lib';
import { parseContent } from './text-edit.js';

const defaultsCache = new WeakMap();

export function readAppearanceDefaults(object) {
  const appearance = object.getDefaultAppearance() || '';
  const cached = defaultsCache.get(object);
  if (cached?.appearance === appearance) return cached.value;
  const result = {};
  try {
    for (const { op, args } of parseContent(appearance)) {
      if (
        op === 'Tf' &&
        args[1]?.type === 'number' &&
        Number.isFinite(args[1].value) &&
        args[1].value >= 0
      )
        result.fontSize = args[1].value;
      const count = { g: 1, rg: 3, k: 4 }[op];
      if (count && args.length === count && args.every((arg) => arg.type === 'number'))
        result.color = componentsToColor(args.map((arg) => Math.max(0, Math.min(1, arg.value))));
    }
  } catch {
    // A malformed default appearance still gets a usable black, automatically sized label.
  }
  defaultsCache.set(object, { appearance, value: result });
  return result;
}
