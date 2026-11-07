// Builds the generated CMYK profiles off the main thread (they take seconds
// on slow machines); the result is plain data and clones back intact.
import { builtinProfile, type BuiltinProfileId } from '../../color/color-management';

self.onmessage = (ev: MessageEvent<{ id: BuiltinProfileId }>) => {
  try {
    (self as unknown as Worker).postMessage({ id: ev.data.id, profile: builtinProfile(ev.data.id) });
  } catch (error) {
    (self as unknown as Worker).postMessage({ id: ev.data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
