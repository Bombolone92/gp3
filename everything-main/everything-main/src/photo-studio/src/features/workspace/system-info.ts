import type { Editor } from '../../editor';
import { escapeXML } from '../../model/assets';
import { svg } from '../../app/icons';

// Help → System Info: what the browser and GPU offer, for support requests.
// Everything is read locally; nothing is sent anywhere.

export type Section = { title: string; rows: [string, string][] };
const yes = (v: unknown) => (v ? 'Yes' : 'No');
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

async function gpuSection(e: Editor): Promise<Section> {
  const rows: [string, string][] = [['Compositor', e.renderer?.name ?? 'Starting'], ['Largest image side', e.renderer ? `${e.renderer.backend.maxSize} px` : '—']];
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter) {
        const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
        if (info) {
          if (info.vendor) rows.push(['GPU vendor', info.vendor]);
          if (info.architecture) rows.push(['GPU architecture', info.architecture]);
          if (info.description) rows.push(['GPU description', info.description]);
        }
        const l = adapter.limits;
        rows.push(
          ['WebGPU max texture size', `${l.maxTextureDimension2D} px`],
          ['WebGPU max buffer size', mb(l.maxBufferSize)],
          ['WebGPU max storage buffer', mb(l.maxStorageBufferBindingSize)],
          ['WebGPU features', [...adapter.features].sort().join(', ') || 'none'],
        );
      } else rows.push(['WebGPU', 'No adapter']);
    } catch {
      rows.push(['WebGPU', 'Unavailable']);
    }
  } else rows.push(['WebGPU', 'Not supported by this browser']);
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      rows.push(
        ['WebGL2 renderer', String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))],
        ['WebGL2 max texture size', `${gl.getParameter(gl.MAX_TEXTURE_SIZE)} px`],
        ['WebGL2 float render targets', yes(gl.getExtension('EXT_color_buffer_float'))],
      );
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } else rows.push(['WebGL2', 'Not supported']);
  } catch {
    rows.push(['WebGL2', 'Unavailable']);
  }
  return { title: 'Graphics', rows };
}
export function memorySection(e: Editor): Section {
  const tiles = e.sessions.reduce((n, s) => n + s.assets.tiles.size, 0);
  const bytes = e.sessions.reduce((n, s) => n + s.assets.tiles.bytes, 0);
  const histories = e.sessions.reduce((n, s) => n + s.history.documents.length, 0);
  const rows: [string, string][] = [
    ['Open documents', String(e.sessions.filter((s) => s.hasDocument).length)],
    ['Pixel tiles in memory', `${tiles} (${mb(bytes)})`],
    ['History states kept', String(histories)],
  ];
  const device = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (device) rows.push(['Device memory (approximate)', `${device} GB`]);
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (heap) rows.push(['Script heap in use', `${mb(heap.usedJSHeapSize)} of ${mb(heap.jsHeapSizeLimit)}`]);
  rows.push(['Processor threads', String(navigator.hardwareConcurrency || 'Unknown')]);
  return { title: 'Memory', rows };
}
function browserSection(): Section {
  const w = window as Window & { showOpenFilePicker?: unknown; queryLocalFonts?: unknown; EyeDropper?: unknown };
  const mq = (q: string) => matchMedia(q).matches;
  return {
    title: 'Browser',
    rows: [
      ['User agent', navigator.userAgent],
      ['Platform', (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || 'Unknown'],
      ['Language', navigator.language],
      ['Screen', `${screen.width} × ${screen.height} at ${devicePixelRatio}× pixel ratio`],
      ['Display color gamut', mq('(color-gamut: rec2020)') ? 'Rec. 2020' : mq('(color-gamut: p3)') ? 'Display P3' : 'sRGB'],
      ['High dynamic range display', yes(mq('(dynamic-range: high)'))],
      ['Secure context', yes(isSecureContext)],
      ['Cross-origin isolated', yes(crossOriginIsolated)],
      ['OffscreenCanvas', yes(typeof OffscreenCanvas !== 'undefined')],
      ['Web Workers', yes(typeof Worker !== 'undefined')],
      ['WebAssembly', yes(typeof WebAssembly !== 'undefined')],
      ['SharedArrayBuffer', yes(typeof SharedArrayBuffer !== 'undefined')],
      ['File System Access', yes(w.showOpenFilePicker)],
      ['Clipboard images', yes(typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write)],
      ['Local fonts', yes(w.queryLocalFonts)],
      ['Screen color picker', yes(w.EyeDropper)],
      ['Pointer pressure (pen)', yes(typeof PointerEvent !== 'undefined' && 'pressure' in PointerEvent.prototype)],
      ['Persistent storage API', yes(navigator.storage?.persist)],
    ],
  };
}
export async function collectSystemInfo(e: Editor): Promise<Section[]> {
  const sections = [
    { title: 'Photo Studio', rows: [['Build', import.meta.env.MODE === 'production' ? 'Production' : 'Development'], ['Date', new Date().toISOString()]] as [string, string][] },
    await gpuSection(e),
    memorySection(e),
    browserSection(),
  ];
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) sections[2].rows.push(['Site storage', `${mb(est.usage ?? 0)} of ${mb(est.quota)}`]);
  } catch {
    /* Optional. */
  }
  return sections;
}
export function systemInfoText(sections: Section[]) {
  return sections.map((s) => `${s.title}\n${s.rows.map(([k, v]) => `  ${k}: ${v}`).join('\n')}`).join('\n\n');
}
export async function showSystemInfo(e: Editor) {
  const sections = await collectSystemInfo(e);
  const text = systemInfoText(sections);
  const d = document.querySelector<HTMLDialogElement>('#dialog')!;
  d.innerHTML = `<form method="dialog" class="system-info"><h2>System Info</h2><div class="system-info-body">${sections
    .map((s) => `<section><h3>${escapeXML(s.title)}</h3><dl>${s.rows.map(([k, v]) => `<dt>${escapeXML(k)}</dt><dd>${escapeXML(v)}</dd>`).join('')}</dl></section>`)
    .join('')}</div><div class="dialog-actions"><span class="system-info-status muted" role="status"></span><button type="button" data-copy-info>${svg('copy', 14)}Copy</button><button class="primary" autofocus>Done</button></div></form>`;
  d.querySelector('[data-copy-info]')!.addEventListener('click', async () => {
    const status = d.querySelector('.system-info-status')!;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Copied to the clipboard.';
    } catch {
      // Clipboard access can be refused; select the text for manual copying instead.
      const area = document.createElement('textarea');
      area.value = text;
      area.className = 'system-info-text';
      area.readOnly = true;
      d.querySelector('.system-info-body')!.replaceChildren(area);
      area.select();
      status.textContent = 'Press ⌘C or Ctrl+C to copy.';
    }
  });
  d.showModal();
}
