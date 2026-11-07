import { describe, it, expect } from 'vitest';
import { bootAppWithFeatures } from './helpers.js';
import { applyChanges, conflictsFor, shortcutFromEvent, writeSets, activeChanges } from '../src/features/shortcuts/sets.js';

const key = (opts) => ({ key: 'x', code: 'KeyX', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...opts });

describe('keyboard shortcut sets', () => {
  it('reads key combinations from events', () => {
    expect(shortcutFromEvent(key({ key: 'g', code: 'KeyG', metaKey: true, shiftKey: true }), true)).toBe('Mod+Shift+G');
    expect(shortcutFromEvent(key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), true)).toBe(null);
    expect(shortcutFromEvent(key({ key: 'F5', code: 'F5' }), true)).toBe('F5');
    expect(shortcutFromEvent(key({ key: '[', code: 'BracketLeft', ctrlKey: true }), false)).toBe('Mod+[');
  });

  it('applies command and tool changes and restores defaults', async () => {
    const app = await bootAppWithFeatures();
    const group = app.commands.get('object.group');
    expect(group.shortcut).toBe('Mod+G');
    applyChanges(app, { commands: { 'object.group': 'Mod+Alt+Shift+9', 'object.ungroup': '' }, tools: { pen: 'Q' } });
    expect(app.commands.get('object.group').shortcut).toBe('Mod+Alt+Shift+9');
    expect(app.commands.match({ key: '(', code: 'Digit9', metaKey: true, ctrlKey: true, altKey: true, shiftKey: true })).toBe('object.group');
    expect(app.commands.get('object.ungroup').shortcut).toBeUndefined();
    expect(app.toolKeys.get('q')).toBe('pen');
    expect(app.toolKeys.has('p')).toBe(false);
    applyChanges(app, { commands: {}, tools: {} });
    expect(app.commands.get('object.group').shortcut).toBe('Mod+G');
    expect(app.toolKeys.get('p')).toBe('pen');
  });

  it('finds conflicts between commands and with tool keys', async () => {
    const app = await bootAppWithFeatures();
    const c = conflictsFor(app, 'Mod+G', { commands: {}, tools: {} }, { kind: 'commands', id: 'object.ungroup' });
    expect(c).toEqual([{ kind: 'commands', id: 'object.group' }]);
    const t = conflictsFor(app, 'P', { commands: {}, tools: {} }, { kind: 'tools', id: 'rectangle' });
    expect(t.some((x) => x.kind === 'tools' && x.id === 'pen')).toBe(true);
    // A changed shortcut no longer conflicts.
    expect(conflictsFor(app, 'Mod+G', { commands: { 'object.group': '' }, tools: {} }, { kind: 'commands', id: 'object.ungroup' })).toEqual([]);
  });

  it('the active set applies at startup', async () => {
    const { Prefs } = await import('../src/prefs.js');
    const prefs = new Prefs({ getItem: () => null, setItem: () => {} });
    writeSets(prefs, { active: 'Mine', sets: { Mine: { commands: { 'edit.copy': 'Mod+Shift+C' }, tools: {} } } });
    expect(activeChanges(prefs).commands['edit.copy']).toBe('Mod+Shift+C');
  });
});
