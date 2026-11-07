// File → Scripts → Statistics: combine several images into one embedded
// object whose content is a per-pixel statistic of them (mean, median, …),
// for noise reduction from bursts or removing passers-by from a fixed view.
import './scripting.css';
import type { Editor } from '../../editor';
import type { DocumentSession } from '../../app/session';
import { escapeXML } from '../../model/assets';
import { stackModes, type StackMode } from '../../model/embedded';
import type { RGBA8 } from '../../imaging/types';
import { stackImages, flattenFile, stackLabel } from '../embedded/stack';
import { documentSamples } from '../embedded/render';
import { toRGBA8 } from '../pixels';
import { fileAccept, pickLocalFiles } from '../embedded/convert';

type Source = { name: string; read: () => Promise<RGBA8> };

export function statisticsDialog(e: Editor): Promise<void> {
  const sources: Source[] = [];
  const dialog = document.createElement('dialog');
  dialog.className = 'files-dialog files-processor statistics-dialog';
  dialog.setAttribute('aria-label', 'Statistics');
  const modes = stackModes.filter(([m]) => m !== 'none');
  dialog.innerHTML = `<form method="dialog">
    <h2>Statistics</h2>
    <p class="muted">Each pixel of the result is a statistic of the same pixel across the images. The images stay inside an embedded object, so the mode can be changed later from Layer → Embedded Objects → Stack Mode.</p>
    <section class="processor-step"><h3><span>1</span>Images</h3>
      <div class="processor-buttons"><button type="button" data-act="local" title="Choose image files on this device">Add from this device…</button><button type="button" data-act="cloud" title="Choose image files on Puter">Add from Puter…</button>${e.sessions.some((s) => s.hasDocument) ? '<button type="button" data-act="open" title="Use the documents open in Photo Studio">Add open documents</button>' : ''}<button type="button" data-act="clear" title="Remove every image from the list">Clear</button></div>
      <ul class="processor-list" aria-label="Images to combine"></ul>
    </section>
    <section class="processor-step"><h3><span>2</span>Combine</h3>
      <label class="dialog-field">Stack mode<select name="mode" title="How the images are combined at each pixel">${modes.map(([m, l]) => `<option value="${m}" ${m === 'median' ? 'selected' : ''}>${escapeXML(l)}</option>`).join('')}</select></label>
      <label class="dialog-field checkbox-field" title="Line up the images by their content before combining them (for hand-held series)">Align the images first<input type="checkbox" name="align"></label>
    </section>
    <p class="processor-status" aria-live="polite"></p>
    <div class="dialog-actions"><button type="button" data-act="cancel">Cancel</button><button type="submit" class="primary" disabled>Combine</button></div>
  </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form')!;
  const list = dialog.querySelector<HTMLElement>('.processor-list')!;
  const status = dialog.querySelector<HTMLElement>('.processor-status')!;
  const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const render = () => {
    list.innerHTML = sources.length
      ? sources.map((x, i) => `<li>${escapeXML(x.name)}<button type="button" class="icon-button" data-remove="${i}" aria-label="Remove ${escapeXML(x.name)}" title="Remove from the list">×</button></li>`).join('')
      : '<li class="muted">Add two or more images of the same scene.</li>';
    submit.disabled = sources.length < 2;
    status.textContent = sources.length ? `${sources.length} image${sources.length > 1 ? 's' : ''}` : '';
  };
  render();
  const sessionImage = (s: DocumentSession) => async () => {
    const out = await documentSamples(e, s.doc, s.assets);
    return toRGBA8(out.data, out.width, out.height);
  };
  return new Promise((resolve) => {
    let running = false;
    const close = () => {
      dialog.close();
      dialog.remove();
      resolve();
    };
    dialog.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      if (!running) close();
    });
    dialog.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      const remove = t.closest<HTMLElement>('[data-remove]');
      if (remove) {
        sources.splice(Number(remove.dataset.remove), 1);
        return render();
      }
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'cancel' && !running) close();
      else if (act === 'clear') {
        sources.length = 0;
        render();
      } else if (act === 'local')
        void pickLocalFiles(fileAccept(), true).then((files) => {
          sources.push(...files.map((f) => ({ name: f.name, read: () => flattenFile(e, f, f.name) })));
          render();
        });
      else if (act === 'cloud')
        // The Puter picker never settles when dismissed; nothing waits on it.
        void import('../files/cloud')
          .then(({ pickCloudFiles }) => pickCloudFiles(true))
          .then((items) => {
            sources.push(...items.map((it) => ({ name: it.name, read: async () => flattenFile(e, await it.read(), it.name) })));
            render();
          })
          .catch((error) => (status.textContent = String(error instanceof Error ? error.message : error)));
      else if (act === 'open') {
        for (const s of e.sessions.filter((x) => x.hasDocument)) sources.push({ name: s.doc.name, read: sessionImage(s) });
        render();
      }
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (running || sources.length < 2) return;
      running = true;
      for (const b of dialog.querySelectorAll<HTMLButtonElement>('button')) b.disabled = true;
      const mode = (form.elements.namedItem('mode') as HTMLSelectElement).value as StackMode;
      const align = (form.elements.namedItem('align') as HTMLInputElement).checked;
      void (async () => {
        const images: { name: string; image: RGBA8 }[] = [];
        for (const [i, src] of sources.entries()) {
          status.textContent = `Reading ${i + 1} of ${sources.length}: ${src.name}`;
          images.push({ name: src.name.replace(/\.[^.]+$/, ''), image: await src.read() });
        }
        status.textContent = align ? 'Aligning and combining…' : 'Combining…';
        // The command that opened this window holds the editor until it closes.
        await stackImages(e, images, { embed: true, mode, align, name: `Statistics (${stackLabel(mode)})` });
        close();
        e.message(`Combined ${images.length} images by ${stackLabel(mode).toLowerCase()}.`);
      })().catch((error) => {
        running = false;
        status.textContent = error instanceof Error ? error.message : String(error);
        for (const b of dialog.querySelectorAll<HTMLButtonElement>('button')) b.disabled = false;
        render();
      });
    });
    dialog.showModal();
  });
}
