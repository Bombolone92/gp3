/**
 * Lightweight template previews for the home screen: the template's scene
 * (evaluated by engine/scene.js) drawn with Canvas 2D, so cards render
 * without WebGL or stored media. Text, graphics, motion, animations and
 * transitions (as cross-fades) show; shader effects and filters are left to
 * the real renderer once the project is created.
 */
import { evaluate } from '../engine/scene.js';
import { rasterizeText, rasterizeSticker, fontString } from '../engine/text.js';
import { drawArt } from '../engine/template-art.js';
import { templateDraft, artSize } from '../model/templates.js';
import { normalizeAsset } from '../model/project.js';
import { projectDuration } from '../model/timeline.js';

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** A playable 2D preview of a template at the given pixel width. */
export class TemplatePreview {
  constructor(tpl, { width = 320 } = {}) {
    this.tpl = tpl;
    const { project, media } = templateDraft(tpl);
    this.project = project;
    const { width: pw, height: ph } = project.settings;
    this.k = width / pw;
    this.canvas = canvasOf(Math.round(width), Math.round(ph * this.k));
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d');
    this.art = new Map();
    for (const m of media) {
      const size = m.kind === 'image' ? artSize(m.spec, project.settings) : {};
      project.assets[m.id] = normalizeAsset({ id: m.id, kind: m.kind, name: m.name, hash: m.id, ...size, duration: m.duration || 0 });
      if (m.kind === 'image' && this.g) {
        // Art is drawn at the preview's resolution.
        const s = Math.min(1, (this.canvas.width * 1.5) / size.width);
        const c = canvasOf(Math.max(2, Math.round(size.width * s)), Math.max(2, Math.round(size.height * s)));
        const g = c.getContext('2d');
        if (g) drawArt(g, m.spec, c.width, c.height);
        this.art.set(m.id, c);
      }
    }
    this.duration = projectDuration(project);
    this.texts = new Map();
    this.raf = 0;
    this.poster = this.posterTime();
  }

  /** A moment where the most text and graphics are fully on screen. */
  posterTime() {
    let best = 0;
    let bestScore = -1;
    const steps = 48;
    for (let i = 1; i < steps; i++) {
      const t = Math.round((this.duration * i) / steps);
      let score = 0;
      for (const l of evaluate(this.project, t)) {
        if (l.kind === 'transition') score -= 2;
        else if ((l.kind === 'text' || l.kind === 'sticker') && l.opacity > 0.95 && l.reveal >= 1) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  /** Wait for the fonts the template uses, then draw the poster frame. */
  ready() {
    this._ready ||= (async () => {
      if (typeof document !== 'undefined' && document.fonts) {
        const specs = new Set();
        for (const t of this.project.tracks) for (const c of t.clips) if (c.type === 'text') specs.add(fontString(c.style, 32));
        await Promise.all([...specs].map((s) => document.fonts.load(s).catch(() => null)));
        this.texts.clear();
      }
      if (!this.raf) this.draw(this.poster);
    })();
    return this._ready;
  }

  _raster(layer) {
    const clip = layer.clip;
    const bucket = Math.max(0.1, Math.min(2, Math.ceil(this.k * Math.max(0.25, layer.scale) * 8) / 8));
    const reveal = layer.reveal < 1 ? Math.floor(layer.reveal * [...(clip.text || '')].length) : -1;
    const key = `${clip.id}|${bucket}|${reveal}`;
    let r = this.texts.get(key);
    if (!r) {
      try {
        r = clip.type === 'text' ? rasterizeText(clip, layer.reveal, bucket) : rasterizeSticker(clip, bucket);
      } catch {
        r = null;
      }
      this.texts.set(key, r);
    }
    return r;
  }

  _layer(g, l, alpha = 1) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    let src;
    let bw;
    let bh;
    if (l.kind === 'media') {
      src = this.art.get(l.clip.assetId);
      if (!src) return;
      const fit = Math.min(W / l.width, H / l.height);
      bw = l.width * fit;
      bh = l.height * fit;
    } else if (l.kind === 'text' || l.kind === 'sticker') {
      const r = this._raster(l);
      if (!r) return;
      src = r.canvas;
      bw = r.projW * this.k;
      bh = r.projH * this.k;
    } else {
      return;
    }
    g.save();
    g.globalAlpha = Math.max(0, Math.min(1, l.opacity * alpha));
    g.translate(W / 2 + l.x * W, H / 2 + l.y * H);
    g.rotate((l.rotation * Math.PI) / 180);
    g.scale(l.scale * (l.flipH ? -1 : 1), l.scale * (l.flipV ? -1 : 1));
    if (l.blur > 0.01 && 'filter' in g) g.filter = `blur(${(l.blur * 12).toFixed(1)}px)`;
    g.drawImage(src, -bw / 2, -bh / 2, bw, bh);
    g.restore();
  }

  draw(t) {
    const g = this.g;
    if (!g) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = this.project.settings.background.color;
    g.fillRect(0, 0, W, H);
    for (const l of evaluate(this.project, t)) {
      if (l.kind === 'transition') {
        this._layer(g, l.from, 1 - l.progress);
        this._layer(g, l.to, l.progress);
      } else {
        this._layer(g, l);
      }
    }
  }

  /** Play from the start, looping, until stop(). */
  play() {
    if (this.raf || !this.g) return;
    const t0 = performance.now();
    const tick = (now) => {
      const t = ((now - t0) * 1000) % Math.max(1, this.duration);
      this.draw(t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop({ poster = true } = {}) {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (poster) this.draw(this.poster);
  }
}
