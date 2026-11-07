// Collada (.dae) import through three.js' MIT ColladaLoader, converted with `threeToIR`.
import { LoadingManager, type Object3D, type Texture, type AnimationClip } from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { threeToIR } from './three-to-ir';
import type { IRScene } from './ir';
import { baseName } from './common';

/** Image files referenced by <init_from> in library_images. */
export function colladaImageFiles(text: string): string[] {
  const out = new Set<string>();
  const lib = /<library_images>([\s\S]*?)<\/library_images>/i.exec(text)?.[1] ?? '';
  for (const m of lib.matchAll(/<init_from>\s*(?:<ref>)?\s*([^<\s][^<]*?)\s*(?:<\/ref>)?\s*<\/init_from>/gi)) out.add(baseName(decodeURIComponent(m[1].replace(/^file:\/\//, ''))));
  return [...out];
}

/**
 * Parse a Collada document. Textures are resolved from `resources` (by file name); the promise
 * resolves once three's loaders have finished with them.
 */
export async function readCollada(text: string, resources: Map<string, Uint8Array> = new Map()): Promise<IRScene> {
  const byName = new Map<string, Uint8Array>();
  for (const [k, v] of resources) byName.set(baseName(k).toLowerCase(), v);
  const urlToFile = new Map<string, { bytes: Uint8Array; name: string }>();
  const created: string[] = [];
  let pending = 0;
  let done: () => void = () => {};
  const finished = new Promise<void>((r) => (done = r));
  const manager = new LoadingManager(
    () => done(),
    undefined,
    () => void 0,
  );
  const missing = new Set<string>();
  manager.setURLModifier((url) => {
    const name = baseName(decodeURIComponent(url.split('?')[0])).toLowerCase();
    const bytes = byName.get(name);
    if (!bytes) {
      missing.add(name);
      // an empty image keeps the loader from requesting arbitrary URLs
      return 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
    }
    const blobUrl = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
    created.push(blobUrl);
    urlToFile.set(blobUrl, { bytes, name: baseName(url) });
    pending++;
    return blobUrl;
  });
  const loader = new ColladaLoader(manager);
  const res = loader.parse(text, '') as { scene: Object3D & { animations: AnimationClip[] } } | null;
  if (!res) throw new Error('The file is not a valid Collada document');
  if (pending) await Promise.race([finished, new Promise((r) => setTimeout(r, 15000))]);
  const ir = threeToIR(res.scene, res.scene.animations ?? [], {
    textureBytes: (t: Texture) => {
      const src = (t.image as { src?: string } | undefined)?.src ?? (t.source?.data as { src?: string } | undefined)?.src;
      return src ? (urlToFile.get(src) ?? null) : null;
    },
  });
  for (const u of created) URL.revokeObjectURL(u);
  for (const m of missing) ir.warnings.push(`Texture "${m}" was not provided`);
  return ir;
}
