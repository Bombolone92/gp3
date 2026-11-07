// Append an imported .blend scene into an existing document (File ▸ Import).
import type { DocumentData, ID } from '../../data/types';
import type { BlendImport } from './convert';

const TABLES = ['objects', 'meshes', 'curves', 'lights', 'cameras', 'armatures', 'lattices', 'materials', 'images', 'actions', 'node_groups', 'collections'] as const;

function uniqueName(name: string, taken: Set<string>) {
  if (!taken.has(name)) return name;
  const base = name.replace(/\.\d{3}$/, '');
  let i = 1;
  while (taken.has(`${base}.${String(i).padStart(3, '0')}`)) i++;
  return `${base}.${String(i).padStart(3, '0')}`;
}

/** Merge data-blocks of `imp` into `target`; returns the ids of the appended objects. */
export function appendBlend(target: DocumentData, imp: BlendImport): ID[] {
  const src = imp.doc;
  const srcMaster = src.scene.collection;
  for (const table of TABLES) {
    const dst = target[table] as Record<ID, { name: string }>;
    const taken = new Set(Object.values(dst).map((x) => x.name));
    for (const [id, item] of Object.entries(src[table] as Record<ID, { name: string }>)) {
      if (table === 'collections' && id === srcMaster) continue;
      item.name = uniqueName(item.name, taken);
      taken.add(item.name);
      dst[id] = item;
    }
  }
  const master = target.collections[target.scene.collection];
  for (const c of imp.topCollections) if (!master.children.includes(c)) master.children.push(c);
  for (const o of imp.topObjects) if (!master.objects.includes(o)) master.objects.push(o);
  for (const ob of Object.values(target.objects)) ob.select = false;
  const added = src.object_order.filter((id) => target.objects[id]);
  target.object_order.push(...added);
  for (const id of added) target.objects[id].select = true;
  target.scene.active_object = src.scene.active_object && target.objects[src.scene.active_object] ? src.scene.active_object : added[0] ?? target.scene.active_object;
  if (!target.scene.camera && src.scene.camera) target.scene.camera = src.scene.camera;
  return added;
}
