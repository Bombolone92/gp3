import { el } from './dom.js';

const previews = import.meta.glob('../assets/template-thumbnails/*.svg', { eager: true, query: '?url', import: 'default' });

/** Decorative artwork; the containing button supplies the template's name. */
export function templateThumbnail(id) {
  const src = previews[`../assets/template-thumbnails/${id}.svg`];
  return src ? el('img.template-preview', { src, alt: '', width: 480, height: 360, loading: 'lazy', decoding: 'async', draggable: false }) : null;
}
