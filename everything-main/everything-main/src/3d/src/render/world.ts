// World node tree → viewport environment description.
import type { DocumentData, WorldData } from '../data/types';
import { imageTexture } from './images';
import type { Texture } from 'three';

export type WorldEval =
  | { kind: 'color'; color: [number, number, number] }
  | { kind: 'texture'; texture: Texture; key: string }
  | { kind: 'sky'; top: number[]; horizon: number[]; ground: number[]; key: string };

/** Optional node-tree baker (registered by the nodes module); returns null to use the fallback. */
export type WorldBaker = (doc: DocumentData, w: WorldData) => WorldEval | null;
let worldBaker: WorldBaker | null = null;
export function setWorldBaker(b: WorldBaker | null) {
  worldBaker = b;
}

export function evaluateWorldForViewport(doc: DocumentData, w: WorldData): WorldEval {
  if (!w.use_nodes) return { kind: 'color', color: [...w.color] as [number, number, number] };
  const baked = worldBaker?.(doc, w);
  if (baked) return baked;
  const tree = w.tree;
  const out = tree.nodes.find((n) => n.type === 'ShaderNodeOutputWorld');
  const link = out && tree.links.find((l) => l.to_node === out.id && l.to_socket === 'Surface');
  const bg = link ? tree.nodes.find((n) => n.id === link.from_node) : undefined;
  if (!bg || bg.type !== 'ShaderNodeBackground') return { kind: 'color', color: [0, 0, 0] };
  const strength = (bg.inputs.Strength as number) ?? 1;
  const colLink = tree.links.find((l) => l.to_node === bg.id && l.to_socket === 'Color');
  const src = colLink ? tree.nodes.find((n) => n.id === colLink.from_node) : undefined;
  if (src?.type === 'ShaderNodeTexEnvironment' && src.props.image && doc.images[src.props.image as string]) {
    const img = doc.images[src.props.image as string];
    return { kind: 'texture', texture: imageTexture(img, 'Linear'), key: `img${img.id}:${img.revision ?? 0}:${strength}` };
  }
  if (src?.type === 'ShaderNodeTexSky') {
    // simple analytic sky: elevation-dependent gradient tinted by sun elevation
    const elev = (src.props.sun_elevation as number) ?? 0.26;
    const k = Math.max(0.05, Math.sin(elev));
    const s = strength;
    return {
      kind: 'sky',
      top: [0.18 * k * s, 0.36 * k * s, 0.85 * k * s],
      horizon: [0.75 * k * s, 0.82 * k * s, 0.95 * k * s],
      ground: [0.12 * k * s, 0.11 * k * s, 0.1 * k * s],
      key: `sky${elev}:${s}`,
    };
  }
  if (src?.type === 'ShaderNodeTexGradient' || src?.type === 'ShaderNodeValToRGB') {
    return { kind: 'sky', top: [0.2 * strength, 0.3 * strength, 0.5 * strength], horizon: [0.6 * strength, 0.6 * strength, 0.6 * strength], ground: [0.1 * strength, 0.1 * strength, 0.1 * strength], key: `grad${strength}` };
  }
  const c = (bg.inputs.Color as number[]) ?? [0.05, 0.05, 0.05, 1];
  return { kind: 'color', color: [c[0] * strength, c[1] * strength, c[2] * strength] };
}
