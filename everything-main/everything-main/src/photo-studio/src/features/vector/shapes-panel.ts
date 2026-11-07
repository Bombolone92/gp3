// Shapes panel: the custom shape library in groups. Drag a shape onto the
// canvas to add a shape layer there, double-click to add one in the middle,
// or click to make it the Custom Shape tool's shape.
import type { Editor } from '../../editor';
import { registerPanel, type Panel } from '../../app/registry';
import { escapeXML } from '../../model/assets';
import { shapeGroups } from '../../model/shape-library';
import { allShapes, shapeAspect } from './custom-shapes';
import { shapeOpts } from './shape-options';
import './shapes-panel.css';

const MIME = 'application/x-photo-studio-shape';
const collapsed = new Set<string>();

/** Rectangle for a shape dropped at a document point, sized to the document. */
export function dropRect(docW: number, docH: number, aspect: number, x: number, y: number) {
  const size = Math.max(8, Math.round(Math.min(docW, docH) * 0.25));
  const w = aspect >= 1 ? size : Math.max(1, Math.round(size * aspect)),
    h = aspect >= 1 ? Math.max(1, Math.round(size / aspect)) : size;
  return { x: Math.round(x - w / 2), y: Math.round(y - h / 2), width: w, height: h };
}
function add(e: Editor, id: string, x: number, y: number) {
  const shape = allShapes().find((s) => s.id === id);
  if (!shape || !e.hasDocument) return;
  const r = dropRect(e.doc.width, e.doc.height, shapeAspect(shape), x, y);
  // The shape tools load on first use.
  void import('./shape-tools').then((m) => m.addCustomShapeLayer(e, id, r));
}

const shapesPanel: Panel = {
  id: 'shapes',
  title: 'Shapes',
  icon: 'shapes',
  location: 'strip',
  hidden: true,
  mount: (e, el) => {
    el.classList.add('shapes-panel');
    el.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      const head = t.closest<HTMLElement>('[data-group-toggle]');
      if (head) {
        const g = head.dataset.groupToggle!;
        if (collapsed.has(g)) collapsed.delete(g);
        else collapsed.add(g);
        render(el);
        return;
      }
      const b = t.closest<HTMLElement>('[data-shape]');
      if (!b) return;
      shapeOpts.custom = b.dataset.shape!;
      for (const x of el.querySelectorAll('[data-shape]')) x.setAttribute('aria-selected', String(x === b));
      if (e.tool !== 'custom-shape') e.setTool('custom-shape');
      e.options();
    });
    el.addEventListener('dblclick', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-shape]');
      if (b) add(e, b.dataset.shape!, e.doc.width / 2, e.doc.height / 2);
    });
    el.addEventListener('dragstart', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-shape]');
      if (!b || !ev.dataTransfer) return;
      ev.dataTransfer.setData(MIME, b.dataset.shape!);
      ev.dataTransfer.effectAllowed = 'copy';
    });
    const viewport = e.el('#viewport');
    viewport.addEventListener('dragover', (ev) => {
      if (!ev.dataTransfer?.types.includes(MIME) || !e.hasDocument) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    });
    viewport.addEventListener('drop', (ev) => {
      const id = ev.dataTransfer?.getData(MIME);
      if (!id) return;
      ev.preventDefault();
      const [x, y] = e.docPoint(ev.clientX, ev.clientY);
      add(e, id, x, y);
    });
  },
  update: (_e, el) => render(el),
};

function render(el: HTMLElement) {
  const shapes = allShapes();
  const groups: [string, typeof shapes][] = [...shapeGroups.map((g) => [g, shapes.filter((s) => (s.group ?? 'Symbols') === g && !s.user)] as [string, typeof shapes]), ['Defined Shapes', shapes.filter((s) => s.user)]];
  el.innerHTML = `${groups
    .filter(([, list]) => list.length)
    .map(([g, list]) => {
      const open = !collapsed.has(g);
      return `<section class="sh-group"><button type="button" class="sh-head" data-group-toggle="${escapeXML(g)}" aria-expanded="${open}"><span class="sh-caret">${open ? '▾' : '▸'}</span>${escapeXML(g)}<span class="sh-count">${list.length}</span></button>${
        open ? `<div class="sh-grid" role="listbox" aria-label="${escapeXML(g)}">${list.map((s) => `<button type="button" role="option" draggable="true" data-shape="${escapeXML(s.id)}" aria-selected="${s.id === shapeOpts.custom}" title="${escapeXML(s.name)} — drag onto the canvas" aria-label="${escapeXML(s.name)}"><svg viewBox="-4 -4 108 108" aria-hidden="true"><path d="${escapeXML(s.d)}" fill="currentColor" fill-rule="evenodd"/></svg></button>`).join('')}</div>` : ''
      }</section>`;
    })
    .join('')}<p class="hint">Drag a shape onto the canvas, or double-click to add it in the middle. Edit → Define Custom Shape adds your own.</p>`;
}

export function installShapesPanel(e: Editor) {
  registerPanel(shapesPanel);
  void e;
}
