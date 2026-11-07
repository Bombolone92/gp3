// Screen-space finishing, applied once per frame on top of the board stack:
// a soft key light, shallow depth of field at the top and bottom of frame (macro lens), out-of-focus motes of
// light in front of the board, the noon window light at the end, and the vignette.
import { camMatrix } from './render.js';
import { mulberry } from '/core/lib.js';

export function makePost(W, H) {
  const blur = new OffscreenCanvas(W, H), bg = blur.getContext('2d');
  const r = mulberry(23), motes = [];
  for (let i = 0; i < 26; i++) motes.push({ x: r() * W, y: r() * H, rad: 14 + r() * 46, a: 0.025 + r() * 0.05, par: 1.25 + r() * 0.9, warm: r() < 0.6 });
  return function post(ctx, o) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none';
    // depth of field: a blurred copy faded in toward the top and bottom edges
    if (o.dof > 0.01) {
      bg.setTransform(1, 0, 0, 1, 0, 0); bg.globalCompositeOperation = 'source-over'; bg.clearRect(0, 0, W, H);
      bg.filter = `blur(${(2 + 7 * o.dof).toFixed(1)}px)`; bg.drawImage(ctx.canvas, 0, 0); bg.filter = 'none';
      bg.globalCompositeOperation = 'destination-in';
      const g = bg.createLinearGradient(0, 0, 0, H), f = 0.12 + 0.12 * o.dof;
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(f * 0.55, 'rgba(0,0,0,0.55)'); g.addColorStop(f, 'rgba(0,0,0,0)');
      g.addColorStop(1 - f, 'rgba(0,0,0,0)'); g.addColorStop(1 - f * 0.55, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,1)');
      bg.fillStyle = g; bg.fillRect(0, 0, W, H); bg.globalCompositeOperation = 'source-over';
      ctx.drawImage(blur, 0, 0);
    }
    // key light: a broad warm pool from the upper left, drifting slowly
    const lx = W * (0.3 + 0.06 * Math.sin(o.t * 0.21)), ly = H * (0.22 + 0.04 * Math.cos(o.t * 0.17));
    let g = ctx.createRadialGradient(lx, ly, 0, lx, ly, W * 0.75);
    g.addColorStop(0, 'rgba(255,246,220,0.10)'); g.addColorStop(0.5, 'rgba(255,246,220,0.035)'); g.addColorStop(1, 'rgba(255,246,220,0)');
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // out-of-focus motes in front of the board: they move faster than the board (parallax)
    if (o.motes > 0.01) {
      for (const m of motes) {
        const x = ((m.x - o.px * m.par) % (W + 200) + W + 200) % (W + 200) - 100, y = ((m.y - o.py * m.par) % (H + 200) + H + 200) % (H + 200) - 100;
        const c = m.warm ? '255,206,130' : '210,240,250', gg = ctx.createRadialGradient(x, y, m.rad * 0.55, x, y, m.rad);
        gg.addColorStop(0, `rgba(${c},${m.a * o.motes})`); gg.addColorStop(0.85, `rgba(${c},${m.a * o.motes * 0.8})`); gg.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, m.rad, 0, 6.2832); ctx.fill();
      }
    }
    // noon window light (board space): a parallelogram of warm light with one mullion shadow
    if (o.window && o.window.a > 0.005) {
      const M = camMatrix(o.window.cam), q = o.window.quad;
      ctx.save(); ctx.setTransform(...M); ctx.filter = `blur(${o.window.soft}px)`;
      ctx.globalCompositeOperation = 'soft-light'; ctx.beginPath(); ctx.moveTo(...q[0]); for (const p of q.slice(1)) ctx.lineTo(...p); ctx.closePath();
      ctx.fillStyle = `rgba(255,232,190,${o.window.a})`; ctx.fill();
      ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = `rgba(255,226,180,${o.window.a * 0.16})`; ctx.fill();
      ctx.globalCompositeOperation = 'multiply'; const mq = o.window.mullion; ctx.beginPath(); ctx.moveTo(...mq[0]); for (const p of mq.slice(1)) ctx.lineTo(...p); ctx.closePath();
      ctx.fillStyle = `rgba(40,50,46,${o.window.a * 0.9})`; ctx.fill();
      ctx.restore(); ctx.filter = 'none';
    }
    ctx.globalCompositeOperation = 'source-over';
    // vignette
    g = ctx.createRadialGradient(W / 2, H * 0.48, H * 0.36, W / 2, H / 2, H * 1.05);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,10,6,0.58)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };
}
