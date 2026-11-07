import { layoutShapeText } from './shape-text-layout.js';
import { EMU_PER_PX, validateImage } from './images.js';
import { drawingGroupScale } from './drawing-group-scale.js';

export const hasShapeAutofit = node => !!node.text?.autoFit || !!node.children?.some(hasShapeAutofit);

/** Fit immutable drawing scenes in physical font units before body pagination. */
export function fitShapeScene(node, measure, scale = { x: 1, y: 1 }, onApproximation, path = 'shape') {
  if (node.type === 'group') {
    const rx = drawingGroupScale(node.width, node.childWidth), ry = drawingGroupScale(node.height, node.childHeight);
    const children = node.children.map((c, i) => fitShapeScene(c, measure, { x: scale.x * rx, y: scale.y * ry }, onApproximation, onApproximation ? `${path}/${i + 1}` : path));
    if (children.every((c, i) => c === node.children[i])) return node;
    const left = Math.min(...children.map(c => c.x)), top = Math.min(...children.map(c => c.y));
    const right = Math.max(...children.map(c => c.x + c.width)), bottom = Math.max(...children.map(c => c.y + c.height));
    return { ...node, children, x: node.x + (left - node.childX) * rx, y: node.y + (top - node.childY) * ry,
      childX: left, childY: top, childWidth: right - left, childHeight: bottom - top,
      width: (right - left) * rx, height: (bottom - top) * ry };
  }
  if (!node.text?.autoFit) return node;
  if (node.text.paragraphs.some(p => p.runs.some(r => r.field))) {
    const reason = 'Autofit drawings with page-dependent fields require page-specific sizing.';
    if (!onApproximation) throw new Error(reason);
    // Keep this frame's authored extent and live field text. Other shapes in
    // the same group still fit normally; source geometry/XML stays untouched.
    onApproximation({ reason, path });
    return node;
  }
  const text = layoutShapeText(node, measure, scale);
  const fraction = node.textRect ? node.textRect.bottom - node.textRect.top : 1;
  // Autofit runs once using the original geometry's text insets. Recomputing
  // until an ellipse's new inscribed rectangle fits would make it too tall.
  const height = node.height * (1 - fraction) + (text.layout.endY * EMU_PER_PX + node.text.top + node.text.bottom + (node.outline?.declaredWidth ?? node.outline?.width ?? 0)) / scale.y;
  if (!(height > 0) || !Number.isFinite(height)) throw new Error('A fitted drawing text box has no positive height.');
  return { ...node, height };
}

export function prepareShapeAutofit(assets, measure, { bestEffort = false } = {}) {
  let prepared = assets, layouts;
  const autofitApproximations = [];
  for (const [id, asset] of Object.entries(assets || {})) {
    if (!asset.scene || !hasShapeAutofit(asset.scene)) continue;
    if (asset.relativeFrame) {
      const reason = 'Autofit drawings with relative page sizing are not supported yet.';
      if (!bestEffort) throw new Error(reason);
      // Relative frames are resolved at placement time. Fitting their saved
      // scene here would use the wrong width/scale, including inside groups.
      // Keep the complete authored scene; normal relative placement still runs.
      autofitApproximations.push({ reason, message: `Drawing ${id}: automatic sizing with relative page sizing is not supported; this drawing keeps its saved text-box sizes within its page-relative frame in the read-only preview. Text may be clipped and pagination may differ.` });
      continue;
    }
    let fitted = asset;
    if (!asset.fittedFrame) {
      const scale = { x: asset.width * EMU_PER_PX / asset.scene.width, y: asset.height * EMU_PER_PX / asset.scene.height };
      const scene = fitShapeScene(asset.scene, measure, scale, bestEffort ? ({ reason, path }) => {
        autofitApproximations.push({ reason, message: `Drawing ${id}, ${path}: automatic sizing with page-dependent fields is not supported; this text box uses its saved size in the read-only preview. Text may be clipped and pagination may differ.` });
      } : undefined);
      const frame = { sourceWidth: asset.width * EMU_PER_PX, sourceHeight: asset.height * EMU_PER_PX,
        width: Math.round(scene.width * scale.x), height: Math.round(scene.height * scale.y) };
      validateImage({ ...frame, alt: '' });
      fitted = { ...asset, scene, width: frame.width / EMU_PER_PX, height: frame.height / EMU_PER_PX, fittedFrame: frame };
      if (prepared === assets) prepared = { ...assets };
      prepared[id] = fitted;
    }
    (layouts ||= new Map()).set(id, fitted.fittedFrame);
  }
  return { assets: prepared, drawingLayouts: layouts, autofitApproximations };
}

/** Runtime fragments only: never put measured dimensions into edit history/XML. */
export function fittedDrawingParagraphs(paragraphs, layouts) {
  if (!layouts?.size) return paragraphs;
  return paragraphs.map(p => {
    if (!p.runs.some(r => layouts.has(r.image?.assetId))) return p;
    return { ...p, runs: p.runs.map(r => {
      const fit = layouts.get(r.image?.assetId);
      if (!fit) return r;
      if (r.image.anchor?.relativeSize) throw new Error('Autofit drawings with relative page sizing are not supported yet.');
      const image = { ...r.image, width: Math.round(r.image.width * fit.width / fit.sourceWidth), height: Math.round(r.image.height * fit.height / fit.sourceHeight) };
      validateImage(image);
      return { ...r, image };
    }) };
  });
}
