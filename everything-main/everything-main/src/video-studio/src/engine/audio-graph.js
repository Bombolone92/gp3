/**
 * Live preview routing for clip sound effects. Each media element's sound
 * normally goes source -> gain -> master (engine/media-pool.js). When the
 * clip it plays has effects, an AudioWorkletNode running the clip's
 * ClipChain (engine/fx-worklet.js) is put between source and gain, so the
 * preview runs the same DSP as the export. Elements without effects stay
 * on the direct path, so many plain clips cost nothing extra.
 */
import workletUrl from './fx-worklet.js?worker&url';
import { chainSettings } from '../model/audio.js';

export const FX_PROCESSOR = 'vs-clip-fx';

export class AudioGraph {
  constructor(pool, { onReady } = {}) {
    this.pool = pool;
    this.onReady = onReady;
    this.loading = null;
    this.loaded = false;
    this.failed = false;
  }

  /** Load the worklet module once the audio context exists. */
  prepare() {
    const ctx = this.pool.audioCtx;
    if (!ctx || this.loading || !ctx.audioWorklet) return this.loading;
    this.loading = ctx.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        this.loaded = true;
        this.onReady?.();
      })
      .catch((err) => {
        this.failed = true;
        console.warn('Audio effects preview unavailable', err);
      });
    return this.loading;
  }

  /** Route an element entry for the clip it plays now. */
  apply(entry, clip) {
    const ctx = this.pool.audioCtx;
    if (!ctx || !entry.src || !entry.gain) return;
    const settings = chainSettings(clip);
    if (settings && !this.loaded) {
      this.prepare();
      return;
    }
    const fx = entry.fx;
    if (!settings) {
      if (fx?.routed) this._direct(entry);
      return;
    }
    const key = JSON.stringify(settings);
    if (!fx) {
      const node = new AudioWorkletNode(ctx, FX_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { settings },
      });
      entry.fx = { node, key, clipId: clip.id, routed: false };
    } else if (fx.key !== key || fx.clipId !== clip.id) {
      fx.node.port.postMessage({ settings, reset: fx.clipId !== clip.id });
      fx.key = key;
      fx.clipId = clip.id;
    }
    if (!entry.fx.routed) {
      entry.src.disconnect();
      entry.src.connect(entry.fx.node);
      entry.fx.node.connect(entry.gain);
      entry.fx.routed = true;
    }
  }

  /** Clear effect state after a jump (seek) so old echoes do not ring on. */
  reset(entry) {
    entry.fx?.node.port.postMessage({ reset: true });
  }

  _direct(entry) {
    const fx = entry.fx;
    try {
      entry.src.disconnect();
      fx.node.disconnect();
    } catch {
      /* already disconnected */
    }
    entry.src.connect(entry.gain);
    fx.routed = false;
    // Idle the processor until it is needed again.
    fx.node.port.postMessage({ settings: null });
    fx.key = '';
  }

  /** Effect routing state per element (for checks from the console and tests). */
  describe() {
    return this.pool.elements.map((e) => ({ id: e.id, clipId: e.clipId, fx: e.fx ? { routed: e.fx.routed, settings: e.fx.key ? JSON.parse(e.fx.key) : null } : null }));
  }
}
