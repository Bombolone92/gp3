import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allFilters } from '../src/features/filters/catalog';
import { filterMenu, filterLabel, GALLERY_ID } from '../src/features/filters/menu';

// The Filter menu is registered at startup from `filterMenu` so the filter
// operations can load on demand; it must list exactly the catalog's operations.
const entries = allFilters.map((op) => ({ id: op.id, label: op.label, category: op.category, ...(op.immediate ? { immediate: true } : {}) }));

describe('filter menu entries', () => {
  it('match the operation catalog', () => {
    if (process.env.UPDATE_FILTER_MENU) {
      const path = new URL('../src/features/filters/menu.ts', import.meta.url);
      const src = readFileSync(path, 'utf8');
      const q = (v: unknown) => (typeof v === 'string' && !/['\\]/.test(v) ? `'${v}'` : JSON.stringify(v));
      const list = entries.map((x) => `  { ${Object.entries(x).map(([k, v]) => `${k}: ${q(v)}`).join(', ')} },`).join('\n');
      writeFileSync(path, src.replace(/export const filterMenu: FilterMenuEntry\[\] = \[[\s\S]*?\n\];/, `export const filterMenu: FilterMenuEntry[] = [\n${list}\n];`));
      return;
    }
    expect(filterMenu).toEqual(entries);
  });
  it('labels operations and the gallery', () => {
    expect(filterLabel(GALLERY_ID)).toBe('Filter Gallery');
    expect(filterLabel('gaussian-blur')).toBe(allFilters.find((f) => f.id === 'gaussian-blur')!.label);
    expect(filterLabel('smart-blur')).toBe(filterLabel('edge-preserving-blur'));
    expect(filterLabel('unknown-op')).toBe('unknown-op');
  });
});
