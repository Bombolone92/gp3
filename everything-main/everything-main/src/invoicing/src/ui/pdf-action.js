/**
 * Saving paper as a PDF file, loaded on first use.
 *
 * The generator and the spec builder are dynamic imports, so the bytes only
 * arrive for people who actually ask for a PDF and the app's first paint
 * carries none of it.
 */

import { toast } from './toast.js';

let modules = null;

async function load() {
  if (!modules) {
    const [pdf, spec] = await Promise.all([
      import('../lib/pdf.js'),
      import('../lib/pdf-spec.js'),
    ]);
    modules = { ...pdf, ...spec };
  }
  return modules;
}

/**
 * savePdf((mods) => spec) — build the spec once the modules are here, render
 * it, and save it. Reports failure rather than leaving a dead button.
 */
export async function savePdf(build) {
  const pending = toast('Building the PDF…', { icon: 'download', duration: 15000 });
  try {
    const mods = await load();
    const name = await mods.downloadPdf(build(mods));
    pending.dismiss();
    toast(`${name} saved`, { icon: 'circleCheck' });
    return name;
  } catch (err) {
    pending.dismiss();
    console.error(err);
    toast('Could not build the PDF. Print to PDF instead', { icon: 'alert' });
    return null;
  }
}
