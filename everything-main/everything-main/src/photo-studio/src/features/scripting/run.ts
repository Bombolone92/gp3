// Running a script: first-run confirmation, the sandbox, the API host, the
// run indicator with progress and Stop, one undo step per document, and the
// output log shown in the Scripts panel.
import type { Editor } from '../../editor';
import { escapeXML } from '../../model/assets';
import { modal, fieldChecked } from '../files/ui';
import { ScriptHost } from './host';
import { ScriptSandbox, type SandboxOutcome } from './sandbox';
import { runIndicator, scriptUI } from './dialogs';
import { findScript, newScriptRecord, saveScript, scriptMetadata, updateScript } from './store';

export type ScriptRun = {
  name: string;
  source: string;
  // Installed record, when the script is installed.
  id?: string;
  trusted?: boolean;
  // Set for runs started by the Script Events Manager.
  event?: { name: string; documentId: string | null; documentName: string | null };
};
export type LogLine = { time: number; script: string; level: string; text: string };

const LOG_LIMIT = 500;
export const scriptLog: LogLine[] = [];
const logListeners = new Set<() => void>();
export function onScriptLog(fn: () => void) {
  logListeners.add(fn);
  return () => logListeners.delete(fn);
}
function log(script: string, level: string, text: string) {
  scriptLog.push({ time: Date.now(), script, level, text });
  if (scriptLog.length > LOG_LIMIT) scriptLog.splice(0, scriptLog.length - LOG_LIMIT);
  logListeners.forEach((fn) => fn());
}
export function clearScriptLog() {
  scriptLog.length = 0;
  logListeners.forEach((fn) => fn());
}

let active: ScriptSandbox | undefined;
export const scriptRunning = () => !!active;

/** Ask before a script runs for the first time. Resolves with whether to
 * run and, for scripts that are not installed, whether to install it. */
export async function confirmScript(name: string, opts: { offerInstall: boolean }) {
  const r = await modal({
    title: 'Run Script?',
    className: 'script-confirm',
    body: `<p>“${escapeXML(name)}” is a script: a small program that can change your open documents, create and close documents, and ask you to open or save files.</p><p class="muted">It runs separately from Photo Studio, without network access and without access to your Puter account or this site's storage. Run it only if you trust where it came from.</p>${opts.offerInstall ? '<label class="dialog-field checkbox-field">Add it to File → Scripts<input type="checkbox" name="install"></label>' : ''}`,
    submit: 'Run Script',
  });
  if (!r) return null;
  const install = opts.offerInstall && fieldChecked(r.form, 'install');
  r.close();
  return { install };
}

/** Run a script; returns false when it did not run (declined, busy, untrusted event). */
export async function runScript(e: Editor, run: ScriptRun): Promise<boolean> {
  if (active) {
    e.message('Another script is running. Stop it first.');
    return false;
  }
  let trusted = run.trusted ?? (run.id ? !!findScript(run.id)?.trusted : false);
  if (!trusted) {
    // Events never run a script the user has not agreed to run.
    if (run.event) {
      e.message(`“${run.name}” was not run for ${run.event.name}: run it once from File → Scripts first.`);
      return false;
    }
    const answer = await confirmScript(run.name, { offerInstall: !run.id });
    if (!answer) return false;
    trusted = true;
    if (run.id) await updateScript(run.id, { trusted: true });
    else if (answer.install) {
      const record = newScriptRecord(run.source, run.name, { trusted: true });
      await saveScript(record);
      run = { ...run, id: record.id };
    }
  }
  const label = `${run.name} (script)`;
  let indicator: ReturnType<typeof runIndicator> | undefined;
  const sandbox = new ScriptSandbox(
    run.source,
    { script: { id: run.id ?? '', name: run.name }, event: run.event ?? null },
    {
      call: (method, args) => host.call(method, args),
      log: (level, text) => log(run.name, level, text),
    },
    scriptMetadata(run.source).timeout ?? 30,
  );
  indicator = runIndicator(e, run.name, () => {
    indicator?.stopping();
    sandbox.cancel();
  });
  const host = new ScriptHost(e, scriptUI(e, run.name, (f, m) => indicator?.progress(f, m)), label);
  active = sandbox;
  let outcome: SandboxOutcome;
  try {
    outcome = await sandbox.run();
  } finally {
    active = undefined;
    indicator.remove();
    host.finish();
  }
  report(e, run.name, outcome);
  return true;
}

function report(e: Editor, name: string, o: SandboxOutcome) {
  if (o.status === 'done') {
    log(name, 'info', 'Finished.');
    return;
  }
  const text =
    o.status === 'cancelled'
      ? `Stopped “${name}”. Changes it made so far can be undone in one step.`
      : o.status === 'timeout'
        ? `Stopped “${name}”: it did not respond for ${o.seconds} seconds.`
        : `“${name}” failed${o.line ? ` at line ${o.line}` : ''}: ${o.message}`;
  log(name, o.status === 'cancelled' ? 'info' : 'error', text);
  e.message(text);
}
