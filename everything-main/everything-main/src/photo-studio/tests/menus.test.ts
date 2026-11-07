import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { MenuItem } from '../src/app/registry';
import { loadRegistry } from './registry-fixture';

type Registry = Awaited<ReturnType<typeof loadRegistry>>;
type Resolved = import('../src/app/menubar').Resolved;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [readFileSync(p, 'utf8')] : [];
  });
}

describe('menus', () => {
  let r: Registry;
  let skeleton: typeof import('../src/app/menus').menuSkeleton;
  let menubar: typeof import('../src/app/menubar');
  beforeAll(async () => {
    r = await loadRegistry();
    skeleton = (await import('../src/app/menus')).menuSkeleton;
    menubar = await import('../src/app/menubar');
  }, 60_000);

  /** Every items list in the skeleton and the contributions, with where it comes from. */
  const lists = () => {
    const out: { where: string; id?: string; items: MenuItem[] }[] = [];
    const walk = (where: string, id: string | undefined, items: MenuItem[]) => {
      out.push({ where, id, items });
      for (const i of items) if (typeof i === 'object') walk(`${where} > ${i.label}`, i.id, i.items);
    };
    for (const m of skeleton) walk(m.label, m.id, m.items);
    for (const c of r.menuContributions) walk(`contribution to ${c.menu}`, undefined, c.items);
    return out;
  };
  const submenuIds = () => new Set(lists().flatMap((l) => (l.id ? [l.id] : [])));
  it('names only registered commands', () => {
    // Saved workspaces register their commands while they exist.
    const orphans = lists().flatMap(({ where, items }) => items.filter((i): i is string => typeof i === 'string' && i !== '-' && !r.commands.has(i) && !i.startsWith('window.workspace-user-')).map((i) => `${where}: ${i}`));
    expect(orphans).toEqual([]);
  });

  it('places contributions at anchors that exist', () => {
    const bad = r.menuContributions.flatMap((c) => {
      const target = lists().find((l) => l.id === c.menu);
      if (!target) return [`${c.menu} is not a menu`];
      const items = menubar.withContributions(c.menu, target.items);
      const found = !c.after || items.some((i) => i === c.after || (typeof i === 'object' && i.id === c.after));
      return found ? [] : [`${c.menu}: anchor ${c.after} not found`];
    });
    expect(bad).toEqual([]);
  });

  it('keeps separators between groups only', () => {
    const bad = lists().flatMap(({ where, items }) =>
      items.some((i, k) => i === '-' && items[k + 1] === '-') || (items[0] === '-' && !where.startsWith('contribution')) ? [where] : [],
    );
    expect(bad).toEqual([]);
  });

  it('has unique labels, real ellipses and submenus of a usable length', () => {
    const problems: string[] = [];
    const check = (where: string, items: Resolved[]) => {
      const labels = items.flatMap((i) => (i.kind === 'separator' ? [] : [i.label]));
      for (const l of labels.filter((l, k) => labels.indexOf(l) !== k)) problems.push(`${where}: "${l}" appears twice`);
      if (where.includes('>') && labels.length > 32) problems.push(`${where}: ${labels.length} entries`);
      for (const i of items) {
        if (i.kind === 'command' && /\.\.\.$/.test(i.label)) problems.push(`${where}: "${i.label}" uses three dots instead of an ellipsis`);
        if (i.kind === 'submenu') check(`${where} > ${i.label}`, i.items);
      }
    };
    for (const m of skeleton) check(m.label, menubar.resolveMenu(r.editor, menubar.withContributions(m.id, m.items), m.id));
    expect(problems).toEqual([]);
  });

  it('reaches every visible command from a menu, panel or control', () => {
    const text = sources(join(__dirname, '../src')).join('\n');
    const inMenus = new Set(lists().flatMap((l) => l.items.filter((i): i is string => typeof i === 'string')));
    // Panel menus are built on demand.
    const walk = (items: MenuItem[]): void => items.forEach((i) => (typeof i === 'string' ? inMenus.add(i) : walk(i.items)));
    for (const p of r.panels.values()) {
      try {
        walk(p.menu?.(r.editor) ?? []);
      } catch {
        /* A menu that needs a live workspace is checked in the browser smoke test. */
      }
    }
    const menus = submenuIds();
    const quoted = (id: string) => (text.match(new RegExp(`['"\`]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`, 'g')) ?? []).length;
    const unreachable = [...r.commands.values()]
      .filter((c) => !c.hidden && !inMenus.has(c.id))
      // A dynamic submenu lists commands by their `menu` field.
      .filter((c) => !(c.menu && (menus.has(c.menu) || quoted(c.menu) > 0)))
      // Otherwise a panel, context menu or button names the command besides its registration.
      .filter((c) => quoted(c.id) < 2)
      .map((c) => c.id);
    expect(unreachable).toEqual([]);
  });
});
