/**
 * A customer's copy of a receipt, as a shareable image.
 *
 * The target shop has a tablet and often no printer at all, so the answer to
 * "can I get a receipt?" shouldn't be "photograph my screen". Where the Web
 * Share API can carry files, the customer picks their own channel - AirDrop,
 * mail, messaging - and the app needs no integrations; everywhere else the
 * file downloads.
 *
 * Painted on a canvas from the same receiptDoc the on-screen and printed
 * copies render, at 3× for phone screens, always on white: a receipt is a
 * receipt whichever theme the register happens to be wearing. PNG rather than
 * a hand-rolled PDF so that any script the browser can draw - Japanese, Thai,
 * Arabic store names - comes out right.
 */

import { receiptDoc } from '../lib/receipt-doc.js';
import { downloadBlob } from './download.js';

const SCALE = 3;                  // device-independent → crisp on phones
const WIDTH = 360;                // logical points, matching the paper slip
const PAD = 22;
const INK = '#111111';
const INK_SOFT = '#5a5a5a';
const RULE = '#c8c8c8';
const DANGER = '#b02a2a';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const font = (weight, size) => `${weight} ${size}px ${FONT}`;

/** Whether this browser can hand a file to another app. */
export function canShareFiles() {
  try {
    if (typeof navigator === 'undefined' || !navigator.canShare || !navigator.share) return false;
    const probe = new File(['x'], 'probe.png', { type: 'image/png' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** 'Share' where a file can be handed off, 'Download' otherwise. */
export function shareActionLabel() {
  return canShareFiles() ? 'Share' : 'Download';
}

export function receiptFilename(receipt) {
  return `receipt-${receipt.number}.png`;
}

/**
 * Two-pass paint: the first pass measures (so the canvas is exactly as tall as
 * the content), the second draws. Both walk the same script, so nothing can be
 * measured but not drawn.
 */
function paint(doc, ctx, { measureOnly, logo = null }) {
  const right = WIDTH - PAD;
  const inner = WIDTH - PAD * 2;
  let y = PAD;

  const text = (str, x, align, f, color, maxWidth) => {
    if (!measureOnly) {
      ctx.font = f;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(str, x, y, maxWidth);
    }
  };

  /** Split a string to fit `maxWidth`, honouring existing newlines. A token
      wider than the whole line - a CJK store name with no spaces to break
      on, a URL in the footer - wraps by character rather than running off
      both edges of the slip. */
  const wrap = (str, f, maxWidth) => {
    ctx.font = f;
    const fits = (s) => ctx.measureText(s).width <= maxWidth;
    const out = [];
    for (const paragraph of String(str).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (fits(next)) { line = next; continue; }
        if (line) out.push(line);
        line = word;
        if (fits(word)) continue;
        line = '';
        for (const ch of word) {
          if (line && !fits(line + ch)) { out.push(line); line = ch; }
          else line += ch;
        }
      }
      out.push(line);
    }
    return out;
  };

  const block = (str, f, color, align = 'center', maxWidth = inner, lineHeight = 17) => {
    const x = align === 'center' ? WIDTH / 2 : align === 'right' ? right : PAD;
    for (const line of wrap(str, f, maxWidth)) {
      y += lineHeight;
      // maxWidth again as fillText's clamp: belt and braces for the odd
      // glyph run the measurer and the rasterizer disagree about.
      text(line, x, align, f, color, maxWidth);
    }
  };

  const dashed = (gap = 12) => {
    y += gap;
    if (!measureOnly) {
      ctx.save();
      ctx.strokeStyle = RULE;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD, y + 0.5);
      ctx.lineTo(right, y + 0.5);
      ctx.stroke();
      ctx.restore();
    }
  };

  /* ---- Logo (pre-loaded by receiptPng; skipped if it failed to load) ---- */
  if (logo) {
    const scale = Math.min(140 / logo.naturalWidth, 64 / logo.naturalHeight, 1);
    const w = Math.max(1, logo.naturalWidth * scale);
    const h = Math.max(1, logo.naturalHeight * scale);
    if (!measureOnly) ctx.drawImage(logo, (WIDTH - w) / 2, y - 8, w, h);
    y += h - 2;
  }

  /* ---- Store ---- */
  block(doc.storeName, font(750, 17), INK);
  if (doc.address) block(doc.address, font(400, 12), INK_SOFT, 'center', inner, 15);
  for (const line of doc.registrations || []) block(line, font(400, 12), INK_SOFT, 'center', inner, 15);

  /* ---- REFUND badge ---- */
  if (doc.kind) {
    // Enough clearance that the box can't graze the address above it.
    y += 26;
    if (!measureOnly) {
      const w = 150;
      const h = 22;
      const x = (WIDTH - w) / 2;
      ctx.save();
      ctx.strokeStyle = DANGER;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y - h + 6, w, h);
      ctx.font = font(800, 13);
      ctx.fillStyle = DANGER;
      ctx.textAlign = 'center';
      ctx.fillText(spaced(doc.kind), WIDTH / 2, y);
      ctx.restore();
    }
    y += 8;
  }

  /* ---- Voided stamp ---- */
  if (doc.voided && !measureOnly) {
    ctx.save();
    ctx.translate(right - 30, PAD + 6);
    ctx.rotate((8 * Math.PI) / 180);
    ctx.strokeStyle = DANGER;
    ctx.lineWidth = 2;
    ctx.strokeRect(-32, -13, 64, 22);
    ctx.font = font(800, 12);
    ctx.fillStyle = DANGER;
    ctx.textAlign = 'center';
    ctx.fillText(spaced('VOID'), 0, 3);
    ctx.restore();
  }

  /* ---- Meta ---- */
  y += 4;
  for (const line of doc.meta) block(line, font(400, 12), INK_SOFT, 'center', inner, 15);
  dashed();

  /* ---- Items ---- */
  // Wide enough for the widest quantity - '0.735 kg' needs more than '2×'.
  ctx.font = font(400, 13);
  const qtyW = Math.min(96, Math.max(30, ...doc.items.map((l) => ctx.measureText(l.qty).width + 10)));
  const amountW = 74;
  const nameMax = inner - qtyW - amountW - 8;
  for (const line of doc.items) {
    y += 6;
    wrap(line.name, font(500, 13.5), nameMax).forEach((part, i) => {
      y += 17;
      // Quantity and amount ride the item's first line; the name wraps under
      // itself, clear of both columns.
      if (i === 0) {
        text(line.qty, PAD, 'left', font(400, 13), INK_SOFT);
        text(line.amount, right, 'right', font(500, 13.5), INK);
      }
      text(part, PAD + qtyW, 'left', font(500, 13.5), INK, nameMax);
    });
    for (const sub of line.subs) {
      y += 15;
      // A note is the instruction the line was made to; on the customer's own
      // copy it has to be as readable as the item above it.
      const isNote = sub.kind === 'note';
      text(sub.text, PAD + qtyW, 'left', font(isNote ? 600 : 400, 11.5),
        isNote ? INK : INK_SOFT, nameMax + amountW);
    }
  }
  dashed();

  /* ---- Totals ---- */
  for (const t of doc.totals) {
    y += t.strong ? 20 : 17;
    const f = t.strong ? font(750, 15) : font(400, 13);
    text(t.label, PAD, 'left', f, t.strong ? INK : INK_SOFT, inner - amountW);
    text(t.value, right, 'right', f, t.strong ? INK : INK_SOFT);
  }
  dashed();

  /* ---- Payments ---- */
  for (const p of doc.payments) {
    y += p.strong ? 19 : 17;
    // A store-credit balance is what the customer keeps this copy for; it
    // reads like a total rather than like one more tender.
    const f = p.strong ? font(700, 13.5) : font(400, 13);
    text(p.label, PAD, 'left', f, p.strong ? INK : INK_SOFT, inner - amountW);
    text(p.value, right, 'right', f, p.strong ? INK : INK_SOFT);
  }

  if (doc.note) {
    y += 6;
    block(doc.note, font(400, 12), INK_SOFT, 'left', inner, 15);
  }

  /* ---- Loyalty: the reward taken, and the card as it stands ---- */
  if (doc.reward || doc.loyalty) {
    y += 8;
    if (doc.reward) block(doc.reward, font(600, 12), INK, 'center', inner, 15);
    if (doc.loyalty) block(doc.loyalty, font(600, 12.5), INK, 'center', inner, 16);
  }

  if (doc.footer) {
    dashed();
    block(doc.footer, font(400, 12), INK_SOFT, 'center', inner, 15);
  }

  return y + PAD;
}

/** 'V O I D' - letter-spacing isn't a canvas property. */
function spaced(str) {
  return [...str].join(' ');
}

/** Resolve an <img> once it can be drawn, or reject. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('logo failed to load'));
    img.src = src;
  });
}

/**
 * Render a receipt to a PNG blob. The quantity column is drawn in the same
 * pass as the name so both stay on one baseline.
 */
export async function receiptPng(receipt, store) {
  const doc = receiptDoc(receipt, store.settings);
  // The logo can't stop the customer getting their copy - a broken data URL
  // just leaves the mark off, exactly like having none.
  const logo = doc.logo ? await loadImage(doc.logo).catch(() => null) : null;

  // Measure with an offscreen 1×1 context, then draw for real.
  const probe = document.createElement('canvas');
  const probeCtx = probe.getContext('2d');
  const height = paint(doc, probeCtx, { measureOnly: true, logo });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(WIDTH * SCALE);
  canvas.height = Math.round(height * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, height);
  paint(doc, ctx, { measureOnly: false, logo });

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Couldn’t render the receipt.');
  return blob;
}

/**
 * Hand the customer their copy: the share sheet where files can be shared,
 * a download everywhere else (and as the fallback when a share is refused).
 *
 * Resolves 'shared' | 'downloaded' | 'cancelled'.
 */
export async function shareReceipt(receipt, store) {
  const blob = await receiptPng(receipt, store);
  const filename = receiptFilename(receipt);
  const file = new File([blob], filename, { type: 'image/png' });

  if (canShareFiles()) {
    try {
      await navigator.share({
        files: [file],
        title: `${receipt.number ? `Receipt #${receipt.number}` : 'Receipt'}`,
      });
      return 'shared';
    } catch (err) {
      // Dismissing the sheet isn't a failure; anything else falls through to
      // a download so the customer still gets their copy.
      if (err?.name === 'AbortError') return 'cancelled';
      console.error(err);
    }
  }

  downloadBlob(blob, filename);
  return 'downloaded';
}
