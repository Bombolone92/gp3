import type { Editor } from '../../editor';
import { escapeXML } from '../../model/assets';
import { blendModes, type BlendMode } from '../../imaging/blend/modes';
import { contourPresets, type Contour } from '../../imaging/effects/contour';
import type { RGB } from '../../imaging/effects/types';
import type { Gradient } from '../../imaging/gradient/gradient';
import { gradientToCss } from '../../imaging/gradient/edit';
import { allGradientFolders, availablePatterns, colors, patternThumb } from './state';
import { rgbHex, hexRgb } from '../pixels';
import { moveRangeHandle, type BlendRange } from '../../model/blending';

// Declarative controls shared by the Layer Style dialog, the fill layer
// Properties editor and the gradient options. Each field reads and writes a
// value through get/set; `onChange` runs after every edit (live preview),
// with `structural` set when the set of visible fields may change.
export type Field =
  | { kind: 'heading'; label: string }
  | { kind: 'slider'; label: string; get: () => number; set: (v: number) => void; min: number; max: number; step?: number; unit?: string; display?: number }
  | { kind: 'select'; label: string; options: [string, string][]; get: () => string; set: (v: string) => void; structural?: boolean }
  | { kind: 'check'; label: string; get: () => boolean; set: (v: boolean) => void; structural?: boolean }
  | { kind: 'color'; label: string; get: () => RGB; set: (v: RGB) => void }
  | { kind: 'blend'; label: string; get: () => BlendMode; set: (v: BlendMode) => void }
  | { kind: 'angle'; label: string; get: () => number; set: (v: number) => void; global?: { get: () => boolean; set: (v: boolean) => void } }
  | { kind: 'contour'; label: string; get: () => Contour | undefined; set: (c: Contour | undefined) => void; aa?: { get: () => boolean; set: (v: boolean) => void } }
  | { kind: 'gradient'; label: string; get: () => Gradient; set: (g: Gradient) => void }
  | { kind: 'pattern'; label: string; get: () => string; set: (id: string) => void }
  | { kind: 'buttons'; items: { label: string; run: () => void }[] }
  // Inline checkboxes sharing one label.
  | { kind: 'checks'; label: string; items: { label: string; get: () => boolean; set: (v: boolean) => void }[] }
  // Blend If range: black and white handle pairs on a 0..255 track; a pair
  // is split by Alt-dragging (or dragging one half once split).
  | { kind: 'range'; label: string; get: () => BlendRange; set: (r: BlendRange) => void; track: string };

const round = (v: number, step = 1) => Math.round(v / step) * step;
export function blendOptions(selected: string) {
  let html = '';
  let group = 0;
  for (const m of blendModes) {
    if (m.group !== group) {
      html += '<option disabled>──────────</option>';
      group = m.group;
    }
    html += `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${m.label}</option>`;
  }
  return html;
}
export function contourSvg(c: Contour | undefined, size = 28) {
  const pts = [...(c ?? contourPresets[0]).points].sort((a, b) => a.x - b.x);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p.x * size).toFixed(1)} ${(size - p.y * size).toFixed(1)}`).join('');
  return `<svg class="contour-preview" width="${size}" height="${size}" viewBox="-1 -1 ${size + 2} ${size + 2}" aria-hidden="true"><rect x="0" y="0" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-opacity=".25"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
}
function fieldHtml(e: Editor, f: Field, i: number): string {
  const label = 'label' in f ? `<span class="fx-label">${escapeXML(f.label)}</span>` : '';
  switch (f.kind) {
    case 'heading':
      return `<h4 class="fx-heading">${escapeXML(f.label)}</h4>`;
    case 'slider': {
      const k = f.display ?? 1;
      const v = round(f.get() * k, f.step ?? 1);
      return `<label class="fx-row" data-i="${i}">${label}<input type="range" min="${f.min}" max="${f.max}" step="${f.step ?? 1}" value="${v}" aria-label="${escapeXML(f.label)}"><input type="number" min="${f.min}" max="${f.max}" step="${f.step ?? 1}" value="${v}" aria-label="${escapeXML(f.label)} value"><span class="fx-unit">${f.unit ?? ''}</span></label>`;
    }
    case 'select':
      return `<label class="fx-row" data-i="${i}">${label}<select aria-label="${escapeXML(f.label)}">${f.options.map(([v, l]) => `<option value="${escapeXML(v)}" ${f.get() === v ? 'selected' : ''}>${escapeXML(l)}</option>`).join('')}</select></label>`;
    case 'blend':
      return `<label class="fx-row" data-i="${i}">${label}<select aria-label="${escapeXML(f.label)}">${blendOptions(f.get())}</select></label>`;
    case 'check':
      return `<label class="fx-row fx-check" data-i="${i}"><input type="checkbox" ${f.get() ? 'checked' : ''}><span>${escapeXML(f.label)}</span></label>`;
    case 'color':
      return `<label class="fx-row" data-i="${i}">${label}<input type="color" class="fx-swatch" value="${rgbHex(...f.get())}" aria-label="${escapeXML(f.label)}"></label>`;
    case 'angle': {
      const a = f.get();
      const r = (a * Math.PI) / 180;
      return `<div class="fx-row" data-i="${i}">${label}<svg class="fx-dial" width="34" height="34" viewBox="-17 -17 34 34" role="slider" tabindex="0" aria-label="${escapeXML(f.label)}" aria-valuenow="${Math.round(a)}" aria-valuemin="-180" aria-valuemax="180"><circle r="15" fill="var(--input)" stroke="var(--input-line)"/><line x1="0" y1="0" x2="${(Math.cos(r) * 13).toFixed(2)}" y2="${(-Math.sin(r) * 13).toFixed(2)}" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle r="2" fill="currentColor"/></svg><input type="number" min="-180" max="180" step="1" value="${Math.round(a)}" aria-label="${escapeXML(f.label)} degrees"><span class="fx-unit">°</span>${f.global ? `<label class="fx-inline"><input type="checkbox" data-global ${f.global.get() ? 'checked' : ''}>Use Global Light</label>` : ''}</div>`;
    }
    case 'contour': {
      const c = f.get();
      return `<div class="fx-row" data-i="${i}">${label}<div class="fx-contour">${contourSvg(c)}<select aria-label="${escapeXML(f.label)}">${contourPresets.map((p) => `<option ${(c?.name ?? 'Linear') === p.name ? 'selected' : ''}>${escapeXML(p.name!)}</option>`).join('')}</select>${f.aa ? `<label class="fx-inline"><input type="checkbox" data-aa ${f.aa.get() ? 'checked' : ''}>Anti-aliased</label>` : ''}</div></div>`;
    }
    case 'gradient':
      return `<div class="fx-row" data-i="${i}">${label}<button type="button" class="gradient-swatch" style="background:${gradientToCss(f.get(), colors(e))}, var(--fx-checker)" aria-label="Choose gradient" title="Choose or edit the gradient"></button></div>`;
    case 'pattern': {
      const p = availablePatterns(e).find((x) => x.id === f.get());
      return `<div class="fx-row" data-i="${i}">${label}<button type="button" class="pattern-swatch" aria-label="Choose pattern" title="${escapeXML(p?.name ?? 'Missing pattern')}">${p ? `<img src="${patternThumb(p, 32)}" alt="">` : '?'}</button><span class="muted">${escapeXML(p?.name ?? 'Missing pattern')}</span></div>`;
    }
    case 'buttons':
      return `<div class="fx-row fx-buttons" data-i="${i}">${f.items.map((b, j) => `<button type="button" data-b="${j}">${escapeXML(b.label)}</button>`).join('')}</div>`;
    case 'checks':
      return `<div class="fx-row" data-i="${i}">${label}<div class="fx-checks">${f.items.map((c, j) => `<label class="fx-inline"><input type="checkbox" data-c="${j}" ${c.get() ? 'checked' : ''}>${escapeXML(c.label)}</label>`).join('')}</div></div>`;
    case 'range': {
      const names = ['black, low', 'black, high', 'white, low', 'white, high'];
      // Each handle is half of a triangle: a joined pair reads as one marker.
      const handles = names.map((n, h) => `<span class="fx-range-handle ${h % 2 ? 'high' : 'low'}" data-h="${h}" role="slider" tabindex="0" aria-label="${escapeXML(f.label)} ${n}" aria-valuemin="0" aria-valuemax="255"></span>`).join('');
      return `<div class="fx-row fx-range-row" data-i="${i}">${label}<div class="fx-range"><div class="fx-range-track" style="background:${f.track}"></div><div class="fx-range-handles">${handles}</div><div class="fx-range-readout"><span data-side="black"></span><span data-side="white"></span></div></div></div>`;
    }
  }
}
// Positions the handles and readouts of a range control.
function layoutRange(row: HTMLElement, r: BlendRange) {
  row.querySelectorAll<HTMLElement>('.fx-range-handle').forEach((h) => {
    const v = r[Number(h.dataset.h)];
    h.style.left = `${(v / 255) * 100}%`;
    h.setAttribute('aria-valuenow', String(v));
  });
  const side = (a: number, b: number) => (a === b ? String(a) : `${a} / ${b}`);
  row.querySelector('[data-side=black]')!.textContent = side(r[0], r[1]);
  row.querySelector('[data-side=white]')!.textContent = side(r[2], r[3]);
}

/** Renders fields into `el` and wires them; returns a re-render function. */
export function mountFields(e: Editor, el: HTMLElement, fields: () => Field[], onChange: (structural: boolean, final: boolean) => void) {
  let list: Field[] = [];
  const render = () => {
    list = fields();
    el.innerHTML = list.map((f, i) => fieldHtml(e, f, i)).join('');
    list.forEach((f, i) => {
      if (f.kind === 'range') layoutRange(el.querySelector<HTMLElement>(`[data-i="${i}"]`)!, f.get());
    });
  };
  const fieldOf = (t: Element) => {
    const row = t.closest<HTMLElement>('[data-i]');
    return row ? { row, f: list[Number(row.dataset.i)] } : undefined;
  };
  const changed = (f: Field, final: boolean) => {
    const structural = ('structural' in f && !!f.structural) || f.kind === 'gradient' || f.kind === 'pattern' || f.kind === 'contour' || f.kind === 'angle' || f.kind === 'buttons';
    onChange(structural, final);
    if (structural) render();
  };
  const handle = (ev: Event, final: boolean) => {
    const t = ev.target as HTMLInputElement;
    const hit = fieldOf(t);
    if (!hit) return;
    const { row, f } = hit;
    if (f.kind === 'slider') {
      const v = Number(t.value);
      if (!Number.isFinite(v)) return;
      const clamped = Math.min(f.max, Math.max(f.min, v));
      f.set(clamped / (f.display ?? 1));
      row.querySelectorAll<HTMLInputElement>('input').forEach((x) => x !== t && (x.value = String(clamped)));
      if (final && t.type === 'number') t.value = String(clamped);
      changed(f, final);
    } else if (f.kind === 'select' || f.kind === 'blend') {
      if (!final) return;
      f.set(t.value as never);
      changed(f, final);
    } else if (f.kind === 'check') {
      if (!final) return;
      f.set(t.checked);
      changed(f, final);
    } else if (f.kind === 'color') {
      f.set(hexRgb(t.value));
      changed(f, final);
    } else if (f.kind === 'angle') {
      if (t.matches('[data-global]')) {
        if (final) {
          f.global!.set(t.checked);
          changed(f, true);
        }
        return;
      }
      const v = Number(t.value);
      if (!Number.isFinite(v) || !final) return;
      f.set(((((v + 180) % 360) + 360) % 360) - 180);
      changed(f, true);
    } else if (f.kind === 'checks') {
      if (!final || t.dataset.c === undefined) return;
      f.items[Number(t.dataset.c)].set(t.checked);
      changed(f, true);
    } else if (f.kind === 'contour') {
      if (!final) return;
      if (t.matches('[data-aa]')) f.aa!.set(t.checked);
      else {
        const c = contourPresets.find((p) => p.name === t.value);
        f.set(c && c.name !== 'Linear' ? structuredClone(c) : undefined);
      }
      changed(f, true);
    }
  };
  el.addEventListener('input', (ev) => handle(ev, false));
  el.addEventListener('change', (ev) => handle(ev, true));
  el.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const hit = fieldOf(t);
    if (!hit) return;
    const { f } = hit;
    if (f.kind === 'buttons') {
      const b = t.closest<HTMLElement>('[data-b]');
      if (b) {
        f.items[Number(b.dataset.b)].run();
        changed(f, true);
      }
    } else if (f.kind === 'gradient' && t.closest('.gradient-swatch')) {
      openGradientPicker(e, t.closest<HTMLElement>('.gradient-swatch')!, f.get(), (g) => {
        f.set(g);
        changed(f, true);
      });
    } else if (f.kind === 'pattern' && t.closest('.pattern-swatch')) {
      openPatternPicker(e, t.closest<HTMLElement>('.pattern-swatch')!, f.get(), (id) => {
        f.set(id);
        changed(f, true);
      });
    }
  });
  // Range handles follow the pointer; Alt splits a joined pair.
  el.addEventListener('pointerdown', (ev) => {
    const handle = (ev.target as Element).closest<HTMLElement>('.fx-range-handle');
    if (!handle) return;
    const hit = fieldOf(handle);
    if (!hit || hit.f.kind !== 'range') return;
    const f = hit.f;
    const row = hit.row;
    const track = row.querySelector<HTMLElement>('.fx-range-track')!;
    const h = Number(handle.dataset.h);
    const split = ev.altKey;
    ev.preventDefault();
    handle.focus();
    handle.setPointerCapture(ev.pointerId);
    const update = (p: PointerEvent, final: boolean) => {
      const r = track.getBoundingClientRect();
      const next = moveRangeHandle(f.get(), h, ((p.clientX - r.left) / Math.max(1, r.width)) * 255, split);
      f.set(next);
      layoutRange(row, next);
      onChange(false, final);
    };
    const move = (p: PointerEvent) => update(p, false);
    const up = (p: PointerEvent) => {
      update(p, true);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  // Angle dials follow the pointer while dragged.
  el.addEventListener('pointerdown', (ev) => {
    const dial = (ev.target as Element).closest<SVGSVGElement>('.fx-dial');
    if (!dial) return;
    const hit = fieldOf(dial);
    if (!hit || hit.f.kind !== 'angle') return;
    const f = hit.f;
    const number = hit.row.querySelector<HTMLInputElement>('input[type=number]')!;
    const line = dial.querySelector('line')!;
    const update = (p: PointerEvent, final: boolean) => {
      const r = dial.getBoundingClientRect();
      const a = Math.round((Math.atan2(-(p.clientY - r.top - r.height / 2), p.clientX - r.left - r.width / 2) * 180) / Math.PI);
      f.set(a);
      number.value = String(a);
      const rad = (a * Math.PI) / 180;
      line.setAttribute('x2', (Math.cos(rad) * 13).toFixed(2));
      line.setAttribute('y2', (-Math.sin(rad) * 13).toFixed(2));
      onChange(false, final);
    };
    dial.setPointerCapture(ev.pointerId);
    update(ev, false);
    const move = (p: PointerEvent) => update(p, false);
    const up = (p: PointerEvent) => {
      update(p, true);
      dial.removeEventListener('pointermove', move);
      dial.removeEventListener('pointerup', up);
    };
    dial.addEventListener('pointermove', move);
    dial.addEventListener('pointerup', up);
  });
  el.addEventListener('keydown', (ev) => {
    const handle = (ev.target as Element).closest<HTMLElement>('.fx-range-handle');
    if (handle && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(ev.key)) {
      const hit = fieldOf(handle);
      if (!hit || hit.f.kind !== 'range') return;
      ev.preventDefault();
      const h = Number(handle.dataset.h), r = hit.f.get();
      const step = ev.shiftKey ? 10 : 1;
      const v = ev.key === 'Home' ? 0 : ev.key === 'End' ? 255 : r[h] + (ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? step : -step);
      const next = moveRangeHandle(r, h, v, ev.altKey);
      hit.f.set(next);
      layoutRange(hit.row, next);
      onChange(false, true);
      return;
    }
    const dial = (ev.target as Element).closest<SVGSVGElement>('.fx-dial');
    if (!dial || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    const hit = fieldOf(dial);
    if (!hit || hit.f.kind !== 'angle') return;
    ev.preventDefault();
    const step = ev.shiftKey ? 15 : 1;
    const v = hit.f.get() + (ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? step : -step);
    hit.f.set(((((v + 180) % 360) + 360) % 360) - 180);
    changed(hit.f, true);
    el.querySelector<HTMLElement>(`[data-i="${hit.row.dataset.i}"] .fx-dial`)?.focus();
  });
  render();
  return render;
}

function popover(anchor: HTMLElement, cls: string, html: string) {
  document.querySelector('.fx-popover')?.remove();
  const pop = document.createElement('div');
  pop.className = `popover fx-popover ${cls}`;
  pop.innerHTML = html;
  // Inside a modal dialog the popover must live in the top layer with it.
  (anchor.closest('dialog') ?? document.body).append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left))}px`;
  pop.style.top = `${Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 4)}px`;
  const close = (ev: Event) => {
    if (!pop.contains(ev.target as Node)) {
      pop.remove();
      document.removeEventListener('pointerdown', close, true);
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', close, true));
  pop.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      ev.preventDefault();
      pop.remove();
      anchor.focus();
    }
  });
  return pop;
}
export function openGradientPicker(e: Editor, anchor: HTMLElement, current: Gradient, pick: (g: Gradient) => void) {
  const folders = allGradientFolders();
  const ctx = colors(e);
  const pop = popover(anchor, 'gradient-picker', `${folders.map((f, fi) => `<div class="picker-folder"><span>${escapeXML(f.name)}</span><div class="picker-grid">${f.gradients.map((g, gi) => `<button type="button" data-g="${fi}:${gi}" title="${escapeXML(g.name ?? 'Gradient')}" aria-label="${escapeXML(g.name ?? 'Gradient')}" style="background:${gradientToCss(g, ctx)}, var(--fx-checker)"></button>`).join('')}</div></div>`).join('')}<button type="button" class="picker-edit">Edit Gradient…</button>`);
  pop.addEventListener('click', async (ev) => {
    const t = ev.target as HTMLElement;
    const b = t.closest<HTMLElement>('[data-g]');
    if (b) {
      const [fi, gi] = b.dataset.g!.split(':').map(Number);
      pick(structuredClone(folders[fi].gradients[gi]));
      pop.remove();
      return;
    }
    if (t.closest('.picker-edit')) {
      pop.remove();
      const { gradientEditor } = await import('./gradient-editor');
      const g = await gradientEditor(e, current);
      if (g) pick(g);
    }
  });
  pop.querySelector<HTMLElement>('button')?.focus();
}
export function openPatternPicker(e: Editor, anchor: HTMLElement, current: string, pick: (id: string) => void) {
  const list = availablePatterns(e);
  const pop = popover(anchor, 'pattern-picker', `<div class="picker-grid">${list.map((p) => `<button type="button" data-p="${escapeXML(p.id)}" aria-pressed="${p.id === current}" title="${escapeXML(p.name)}" aria-label="${escapeXML(p.name)}"><img src="${patternThumb(p, 36)}" alt=""></button>`).join('')}</div>`);
  pop.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-p]');
    if (!b) return;
    pick(b.dataset.p!);
    pop.remove();
  });
  pop.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
}
