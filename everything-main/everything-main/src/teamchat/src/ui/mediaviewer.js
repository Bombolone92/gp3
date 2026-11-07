/**
 * The media viewer: an image or a video attachment shown over the app,
 * instead of its object URL opened in a new tab (a
 * blob: address in the bar, the app's own origin, and nothing about where
 * the file came from). A dark layer with the picture fitted to the screen,
 * or the video in the browser's own player, who shared it and when above,
 * download and close beside, and arrows (or the arrow keys, or a swipe)
 * through the other media of the same message or list. An image larger
 * than the screen zooms to its real size on click, around the point clicked.
 *
 * openMediaViewer({ items, index })
 *   items  [{ file, ref, author, ts }]: the attachment record, the
 *          workspace reference its bytes are read through, the member who
 *          shared it, and when. Anything that is not an image or a video
 *          is skipped.
 *   index  which one to open on.
 *
 * Rendering happens inside <img> and <video>, so an SVG is as safe here as
 * any raster image (see canOpenInTab in lib/files.js for why it must never
 * be a tab).
 */
import { el, pressOnce } from './dom.js';
import { icon } from './icons.js';
import { avatar } from './avatar.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { attachmentUrl, downloadAttachment, isImage, isMedia, isVideo } from '../lib/files.js';
import { formatBytes } from '../lib/format.js';
import { fullDateTime } from '../lib/time.js';
import { fileLabel } from './filename.js';

export function openMediaViewer({ items, index = 0 }) {
  const list = (items || []).filter((it) => it?.file && isMedia(it.file.type));
  if (!list.length) return null;
  let i = Math.max(0, Math.min(index, list.length - 1));
  let request = 0;

  const img = el('img.viewer-img', { alt: '', draggable: false, hidden: true });
  const video = el('video.viewer-video', { controls: true, autoplay: true, playsinline: true, preload: 'auto', hidden: true });
  const status = el('div.viewer-status', { 'aria-live': 'polite' });
  const prev = el('button.viewer-nav.prev', { type: 'button', html: icon('chevLeft', 26, 2.2), 'aria-label': 'Previous', onclick: () => show(i - 1) });
  const next = el('button.viewer-nav.next', { type: 'button', html: icon('chevRight', 26, 2.2), 'aria-label': 'Next', onclick: () => show(i + 1) });
  const stage = el('div.viewer-stage', {}, img, video, status, list.length > 1 && prev, list.length > 1 && next);

  const who = el('div.viewer-who');
  const name = el('strong.viewer-name');
  const sub = el('span.viewer-sub');
  const counter = el('span.viewer-count', { hidden: list.length < 2 });
  const head = el('div.viewer-head', {},
    who,
    el('div.viewer-actions', {},
      counter,
      el('button.icon-btn', {
        type: 'button', html: icon('download', 20), 'aria-label': 'Download', title: 'Download',
        onclick: () => downloadAttachment(list[i].ref, list[i].file).catch(() => toast('Could not download the file', { icon: 'alert' })),
      }),
      el('button.icon-btn', { type: 'button', html: icon('x', 22), 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => modal.close() })));

  const content = el('div.viewer', {}, head, stage);

  /** Whether the image at its real size is larger than the room it has. */
  function fitCheck() {
    if (img.hidden || !img.naturalWidth) return;
    const over = img.naturalWidth > stage.clientWidth || img.naturalHeight > stage.clientHeight;
    stage.classList.toggle('can-zoom', over);
    if (!over) stage.classList.remove('zoomed');
  }

  /** Real size on click, scrolled to the point clicked; back to fit on the next. */
  function toggleZoom(e) {
    if (!stage.classList.contains('can-zoom')) return;
    // Where on the fitted image the click landed, as fractions, before the
    // size changes under it.
    const r = img.getBoundingClientRect();
    const fx = r.width ? (e.clientX - r.left) / r.width : 0.5;
    const fy = r.height ? (e.clientY - r.top) / r.height : 0.5;
    const zoomed = stage.classList.toggle('zoomed');
    if (!zoomed) return;
    // Layout has the real size now (unscrolled, with the stage's padding
    // before the image): put the clicked point back under the pointer.
    const z = img.getBoundingClientRect();
    stage.scrollLeft = z.left + fx * img.naturalWidth - e.clientX;
    stage.scrollTop = z.top + fy * img.naturalHeight - e.clientY;
  }

  /**
   * What stands where the picture would when its bytes could not be had:
   * why, a way to ask again, and the download. Asking again is the answer
   * to the passing failures (the server busy, a request timed out, the
   * network away for a moment), which the app forgets within seconds and
   * asks the server about afresh; the line used to offer the download alone,
   * and a reader whose picture failed on a hiccup had only to close the
   * viewer and open it again. The line stays as it is while the answer is
   * out, its button busy (see pressOnce), and the keyboard on it stays with
   * the line: refused once more, on the fresh Try again; the picture come,
   * on Close (see the load listeners), the picture itself taking no focus.
   */
  function failed(what) {
    const had = status.contains(document.activeElement);
    status.hidden = false;
    status.classList.remove('loading');
    const retry = el('button.btn.btn-outline.btn-sm.viewer-fallback', { type: 'button' }, 'Try again');
    retry.addEventListener('click', pressOnce(retry, () => show(i, { again: true })));
    status.replaceChildren(
      el('span', {}, what),
      el('div.viewer-fallbacks', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
        retry,
        el('button.btn.btn-outline.btn-sm.viewer-fallback', {
          type: 'button',
          onclick: () => downloadAttachment(list[i].ref, list[i].file).catch(() => toast('Could not download the file', { icon: 'alert' })),
        }, 'Download')));
    if (had) retry.focus({ preventScroll: true });
  }
  /** The keyboard on the failure line as the picture or the video comes and the line goes: to Close, rather than to the page behind the dialog. */
  const leaveLine = () => {
    if (status.contains(document.activeElement)) head.querySelector('[aria-label="Close"]')?.focus({ preventScroll: true });
  };

  img.addEventListener('click', toggleZoom);
  img.addEventListener('load', () => {
    leaveLine();
    img.hidden = false;
    status.hidden = true;
    fitCheck();
  });
  img.addEventListener('error', () => { if (img.getAttribute('src')) failed('Could not load the image'); });
  video.addEventListener('loadeddata', () => {
    leaveLine();
    video.hidden = false;
    status.hidden = true;
  });
  // A type the browser has no decoder for (QuickTime without H.264) ends here.
  video.addEventListener('error', () => { if (video.getAttribute('src')) failed('This browser cannot play this video'); });
  // The room around the picture is the way out, as on the scrim.
  stage.addEventListener('click', (e) => { if (e.target === stage) modal.close(); });

  /** Let go of what is showing: the picture's bytes, the player's stream. */
  function unload() {
    stage.classList.remove('zoomed', 'can-zoom');
    img.hidden = true;
    img.removeAttribute('src');
    video.hidden = true;
    if (video.getAttribute('src')) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }

  /** `again`: asked once more from the failure line (see failed), which stands, its button busy, until the answer is in. */
  async function show(n, { again = false } = {}) {
    if (n < 0 || n >= list.length) return;
    i = n;
    const it = list[i];
    const token = ++request;
    const isVid = isVideo(it.file.type);
    // The name as shown (see fileLabel); the download keeps the file's own.
    const shown = fileLabel(it.file.name);
    unload();
    img.alt = isVid ? '' : shown;
    video.setAttribute('aria-label', isVid ? shown || 'Video' : '');
    if (!again) {
      status.hidden = false;
      status.classList.add('loading');
      status.textContent = isVid ? 'Loading video' : 'Loading image';
    }
    // An arrow pressed from the keyboard until it has nowhere further to go
    // would take the focus with it as it goes disabled, to the page body
    // behind the dialog: the other arrow takes it instead.
    const active = document.activeElement;
    prev.disabled = i === 0;
    next.disabled = i === list.length - 1;
    if (active === prev && prev.disabled) next.focus({ preventScroll: true });
    else if (active === next && next.disabled) prev.focus({ preventScroll: true });
    counter.textContent = `${i + 1} of ${list.length}`;
    who.replaceChildren(
      it.author && avatar(it.author, { size: 'sm' }),
      el('div.viewer-meta', {}, name, sub));
    name.textContent = it.author?.name || shown || (isVid ? 'Video' : 'Image');
    sub.textContent = [it.author && shown, it.file.size && formatBytes(it.file.size), it.ts && fullDateTime(it.ts)].filter(Boolean).join(' · ');
    modal?.panel.setAttribute('aria-label', list.length > 1 ? `${shown}, ${i + 1} of ${list.length}` : shown || (isVid ? 'Video' : 'Image'));
    try {
      const url = await attachmentUrl(it.ref, it.file.id);
      if (token !== request) return;
      if (isVid) video.src = url;
      else img.src = url;
    } catch {
      if (token !== request) return;
      failed(isVid ? 'Could not load the video' : 'Could not load the image');
    }
    // The neighbouring pictures' bytes, so an arrow press shows at once. A
    // video's are fetched when it is opened: they are large, and may never be.
    for (const j of [i - 1, i + 1]) if (list[j] && isImage(list[j].file.type)) attachmentUrl(list[j].ref, list[j].file.id).catch(() => {});
  }

  /**
   * Arrow keys while this is the dialog on top (Escape and Tab are the
   * modal's). The player's controls own the keys while they have focus:
   * left and right seek there.
   */
  function onKey(e) {
    const open = document.querySelectorAll('.modal-root:not(.closing)');
    if (open[open.length - 1] !== modal.root || e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.target === video) return;
    if (e.key === 'ArrowLeft') show(i - 1);
    else if (e.key === 'ArrowRight') show(i + 1);
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(list.length - 1);
    else return;
    e.preventDefault();
  }

  // A horizontal swipe over a picture, when it is not zoomed (zoomed, the
  // drag scrolls it), moves through the list. Over the player the drag is
  // the scrubber's.
  let touch = null;
  stage.addEventListener('touchstart', (e) => { touch = e.touches.length === 1 && e.target !== video ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (!touch || stage.classList.contains('zoomed')) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) show(dx < 0 ? i + 1 : i - 1);
  }, { passive: true });

  const modal = openModal({
    content,
    bare: true,
    className: 'viewer-root',
    label: 'Media',
    onClose: () => {
      request += 1;
      unload();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', fitCheck);
    },
  });
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', fitCheck);
  show(i);
  return modal;
}
