// Sample scripts bundled with the app (`samples/*.js`). They are installed
// once, on first start, and can then be edited or removed like any other
// script; Restore Sample Scripts puts back the ones that are missing.
import { listScripts, markSamplesInstalled, newScriptRecord, saveScript, samplesInstalled } from './store';

const sources = import.meta.glob<string>('./samples/*.js', { query: '?raw', import: 'default' });
// Menu order of the samples.
const order = ['watermark', 'border', 'rename-layers', 'color-swatches', 'export-layer-sizes', 'documents-grid'];
const sampleId = (path: string) => path.replace(/^.*\/|\.js$/g, '');

export async function sampleSources(): Promise<{ id: string; source: string }[]> {
  const list = await Promise.all(Object.entries(sources).map(async ([path, load]) => ({ id: sampleId(path), source: await load() })));
  return list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
/** Install the samples that are not installed; returns how many were added. */
export async function installSamples(onlyFirstTime: boolean) {
  if (onlyFirstTime && (await samplesInstalled())) return 0;
  const present = new Set(listScripts().map((s) => s.sample));
  let added = 0;
  for (const { id, source } of await sampleSources()) {
    if (present.has(id)) continue;
    // Bundled with the app, so they run without the first-run question.
    await saveScript(newScriptRecord(source, id, { sample: id, trusted: true, created: Date.now() + added }));
    added++;
  }
  await markSamplesInstalled();
  return added;
}
