import { store } from './store.js';
import { navigate } from './router.js';

let pending = null;

/** Create and open a fresh demo. Overlapping console calls share one creation. */
export function populateSampleData() {
  if (!pending) {
    pending = store.createSampleWorkspace().then(({ workspace }) => {
      navigate({ ws: workspace.id });
      return workspace;
    }).finally(() => { pending = null; });
  }
  return pending;
}
