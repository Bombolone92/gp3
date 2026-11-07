// Installing, browsing, exporting and deleting scripts, and assigning their
// keyboard shortcuts.
import type { Editor } from '../../editor';
import { commands } from '../../app/registry';
import { eventShortcut, formatShortcut, platformShortcut } from '../../app/shortcuts';
import { escapeXML } from '../../model/assets';
import { download } from '../../persistence/puter';
import { modal } from '../files/ui';
import { askChoice } from '../preferences/warnings';
import { deleteScript, findScript, newScriptRecord, saveScript, scriptMetadata, updateScript } from './store';
import { runScript } from './run';

const MAX_SOURCE = 2 * 1024 * 1024;
const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || 'Script';

function pickScriptFile(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.js,.mjs,text/javascript';
    input.onchange = () => resolve(input.files?.[0]);
    input.addEventListener('cancel', () => resolve(undefined));
    input.click();
  });
}
async function readSource(blob: Blob) {
  if (blob.size > MAX_SOURCE) throw new Error('Scripts can be at most 2 MB.');
  return blob.text();
}

/** File → Scripts → Browse…: run a script file once (offering to install it). */
export async function browse(e: Editor, from: 'device' | 'puter') {
  let name: string, source: string;
  if (from === 'device') {
    const file = await pickScriptFile();
    if (!file) return;
    name = file.name;
    source = await readSource(file);
  } else {
    // The Puter picker never settles when dismissed: do not hold the editor busy.
    e.release();
    const { pickCloudFiles } = await import('../files/cloud');
    const [item] = await pickCloudFiles(false, '.js,.mjs');
    if (!item) return;
    name = item.name;
    source = await readSource(await item.read());
    return e.run(async () => void (await runScript(e, { name: scriptMetadata(source).name || baseName(name), source })));
  }
  await runScript(e, { name: scriptMetadata(source).name || baseName(name), source });
}

/** Install a script file into the Scripts panel (asked before its first run). */
export async function installFromFile(e: Editor) {
  const file = await pickScriptFile();
  if (!file) return;
  const record = newScriptRecord(await readSource(file), baseName(file.name));
  await saveScript(record);
  e.dock.show('scripts');
  e.message(`Installed “${record.name}”. It asks for confirmation the first time it runs.`);
}

export function exportScript(id: string) {
  const s = findScript(id);
  if (!s) return;
  download(new Blob([s.source], { type: 'text/javascript' }), `${s.name.replace(/[\\/:*?"<>|]+/g, '_')}.js`);
}

export async function removeScript(e: Editor, id: string) {
  const s = findScript(id);
  if (!s) return;
  if (!(await askChoice('Delete Script', `Delete “${s.name}”? Its event rules are removed too.`, [['delete', 'Delete']]))) return;
  await deleteScript(id);
  e.message(`Deleted “${s.name}”.`);
}

/** Who already uses a shortcut on this platform (a command name), if anyone. */
export function shortcutOwner(shortcut: string, except: string): string | undefined {
  const typed = platformShortcut(shortcut);
  if (!typed) return 'nothing on this platform (it cannot be typed)';
  for (const c of commands.values()) {
    if (c.id === except) continue;
    const list = Array.isArray(c.shortcut) ? c.shortcut : c.shortcut ? [c.shortcut] : [];
    if (list.some((s) => platformShortcut(s) === typed)) return c.label;
  }
}

/** Assign or clear a script's shortcut; conflicts with other commands are refused. */
export async function assignShortcut(e: Editor, id: string) {
  const s = findScript(id);
  if (!s) return;
  let value = s.shortcut ?? '';
  const r = await modal({
    title: 'Script Shortcut',
    className: 'script-shortcut',
    body: `<p>Press the keys for “${escapeXML(s.name)}”. Use Command or Ctrl, Alt or a function key so the shortcut does not replace a tool key. Backspace clears it.</p><label class="dialog-field">Shortcut<input name="shortcut" readonly value="${escapeXML(formatShortcut(value))}" aria-label="Shortcut" title="Click here and press the keys"></label><p class="shortcut-problem" aria-live="polite"></p>`,
    submit: 'OK',
    bind: (d) => {
      const input = d.querySelector<HTMLInputElement>('input[name="shortcut"]')!;
      const problem = d.querySelector<HTMLElement>('.shortcut-problem')!;
      const ok = d.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      input.addEventListener('keydown', (ev) => {
        if (['Meta', 'Control', 'Alt', 'Shift', 'Tab', 'Escape'].includes(ev.key)) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.key === 'Backspace' && !ev.metaKey && !ev.ctrlKey) value = '';
        else value = eventShortcut(ev);
        input.value = formatShortcut(value);
        const bare = value && !/^F\d+$/.test(value.split('+').pop()!) && !/(Mod|Ctrl|Alt)\+/.test(value);
        const owner = value ? shortcutOwner(value, `script.run.${id}`) : undefined;
        problem.textContent = bare ? 'Add Command/Ctrl or Alt: single keys choose tools.' : owner ? `Already used by “${owner}”.` : '';
        ok.disabled = !!bare || !!owner;
      });
    },
  });
  if (!r) return;
  r.close();
  await updateScript(id, { shortcut: value || undefined });
  e.message(value ? `“${s.name}” runs with ${formatShortcut(value)}.` : `Removed the shortcut of “${s.name}”.`);
}
