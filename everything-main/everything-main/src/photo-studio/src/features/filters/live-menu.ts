// Layer → Live Filters: switch the whole stack or its filter mask off and on,
// delete the mask, or clear the stack (the layer keeps its unfiltered pixels).
import type { Editor } from '../../editor';
import { registerCommand } from '../../app/registry';
import { findLayer } from '../../model/document';
import { syncPixelTransform } from '../../model/pixel-layer';
import { lazy } from '../../app/lazy';
import { isLiveLayer } from './state';

const liveFilters = lazy(() => import('./live'));
const updateLive: typeof import('./live').updateLive = async (...args) => (await liveFilters()).updateLive(...args);

const live = (e: Editor) => (e.selectedIds.size === 1 && isLiveLayer(e.layer) ? e.layer : undefined);
const anyEnabled = (e: Editor) => !!live(e)?.liveFilters.some((f) => f.enabled);

export function installLiveMenu() {
  registerCommand(
    {
      id: 'layer.live-toggle-all',
      label: 'Disable Live Filters',
      enabled: (e) => !!live(e)?.liveFilters.length,
      description: 'Show the layer without its Live Filters, or with them again.',
      run: async (e) => {
        const l = live(e);
        if (!l) return;
        const on = !anyEnabled(e);
        await updateLive(e, l.id, on ? 'Enable Live Filters' : 'Disable Live Filters', (fs) => fs.map((f) => ({ ...f, enabled: on })));
      },
    },
    {
      id: 'layer.live-mask-delete',
      label: 'Delete Filter Mask',
      enabled: (e) => !!live(e)?.liveMask,
      run: async (e) => {
        const l = live(e);
        if (l?.liveMask) await updateLive(e, l.id, 'Delete Filter Mask', (f) => f, null);
      },
    },
    {
      id: 'layer.live-mask-disable',
      label: 'Disable Filter Mask',
      enabled: (e) => !!live(e)?.liveMask,
      checked: (e) => !!live(e)?.liveMaskDisabled,
      description: 'Apply the Live Filters to the whole layer while keeping the mask.',
      run: async (e) => {
        const l = live(e);
        if (!l?.liveMask) return;
        const off = !l.liveMaskDisabled;
        await updateLive(e, l.id, off ? 'Disable Filter Mask' : 'Enable Filter Mask', (f) => f, undefined, off);
      },
    },
    {
      id: 'layer.live-clear',
      label: 'Clear Live Filters',
      enabled: (e) => !!live(e),
      description: 'Remove every Live Filter and the filter mask; the layer shows its original pixels.',
      run: (e) => {
        const l = live(e);
        if (!l) return;
        e.command('Clear Live Filters', (d) => {
          const t = findLayer(d.layers, l.id);
          if (!t?.liveSource) return;
          t.pixels = t.liveSource;
          delete t.liveSource;
          delete t.liveFilters;
          delete t.liveMask;
          delete t.liveMaskDisabled;
          syncPixelTransform(t, d);
        });
      },
    },
  );
}

/** Menu label follows the stack's state. */
export function syncLiveMenu(e: Editor, label: (id: string, text: string) => void) {
  label('layer.live-toggle-all', anyEnabled(e) || !live(e)?.liveFilters.length ? 'Disable Live Filters' : 'Enable Live Filters');
}
