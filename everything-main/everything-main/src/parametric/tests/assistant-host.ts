// The assistant's host without the interface: the document store and the
// real kernel in Node, rebuilt on every settle().

import type { EdgeInfo, FaceInfo, FeatureStatus, MeasureTarget } from '../src/kernel/protocol';
import { ModelBuilder } from '../src/kernel/build';
import type { Frame, Vec3 } from '../src/math/vec';
import { DocStore } from '../src/model/document';
import type { Id } from '../src/model/types';
import type { AssistantHost } from '../src/assistant/host';
import { runTool } from '../src/assistant/tools';

export class TestHost implements AssistantHost {
  readonly store = new DocStore();
  faces: FaceInfo[] = [];
  edges: EdgeInfo[] = [];
  frames: Record<Id, Frame> = {};
  bbox: { min: Vec3; max: Vec3 } | null = null;
  private statuses = new Map<Id, FeatureStatus>();
  private builder = new ModelBuilder();

  featureStatus(id: Id) {
    return this.statuses.get(id) ?? null;
  }

  async settle() {
    const r = this.store.resolve();
    const res = await this.builder.build({ features: r.features, upTo: this.store.builtCount, blobs: this.store.doc.blobs, quality: 0 });
    this.faces = res.faces;
    this.edges = res.edges;
    this.frames = res.frames;
    this.bbox = res.bbox;
    this.statuses = new Map(res.status.map((s) => [s.id, s]));
    for (const [id, error] of r.errors) this.statuses.set(id, { id, ok: false, error });
  }

  async massProperties() {
    return this.builder.massProperties();
  }

  async measure(a: MeasureTarget, b: MeasureTarget) {
    return this.builder.measure(a, b);
  }

  prepareForEdit() {}

  /** Runs a tool; fails the test with the tool's message when it errors and `ok` is expected. */
  async call(name: string, args: Record<string, unknown>, expectOk = true) {
    const r = await runTool(this, name, args);
    if (expectOk && !r.ok) throw new Error(`${name} failed: ${r.content}`);
    return r;
  }

  async volume() {
    return this.builder.massProperties()?.volume ?? 0;
  }
}
