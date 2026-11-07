/**
 * Renders the master app icon (icon.png at the repo root) into the full
 * icon set in public/.
 *
 * The master is a square RGBA tile -- an Ace of Spades over a red card back
 * on felt green -- with a squircle silhouette and transparent corners.
 * Every emitted file is a lanczos3 downsample of it and never an upscale,
 * so the master has to stay at least as large as the biggest target.
 *
 * sharp and png-to-ico are only needed to regenerate the pictures, so
 * neither is a project dependency. Unlike the other tools/ renderers, this
 * one needs no browser and no dev server -- the artwork is a file now, not
 * a page to screenshot:
 *
 *   npm i --no-save sharp png-to-ico
 *   node tools/render-icons.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const root = new URL('../', import.meta.url);
const publicDir = new URL('public/', root);

// Transparent corners kept as-is: in a tab strip, a bookmark bar, or a
// desktop install's title bar the tile's own silhouette should show against
// whatever the browser paints behind it.
const PNG_TARGETS = [
  { size: 16, file: 'favicon-16x16.png' },
  { size: 32, file: 'favicon-32x32.png' },
  { size: 128, file: 'icon-128.png' },
  { size: 192, file: 'icon-192.png' },
  { size: 512, file: 'icon-512.png' },
];

// Folded into favicon.ico only -- not kept as standalone files.
const ICO_SIZES = [16, 32, 48];

// iOS paints black behind any alpha in an apple-touch-icon, then applies
// its own squircle mask -- which is squarer than this master's corners and
// so cuts *inside* them, leaving the transparent corners on screen as black
// wedges. Flattened onto felt to avoid that. (The earlier HTML-rendered
// icon needed no flattening: it was a much squarer tile, opaque edge to
// edge.)
const OPAQUE_TARGETS = [{ size: 180, file: 'apple-touch-icon.png' }];

// A maskable icon is cropped by the platform to whatever shape it likes --
// circle, squircle, teardrop -- and only the middle 80% is guaranteed to
// survive. So the tile is inset to that safe zone over a full-bleed felt
// background: the mask then lands on felt instead of slicing the ace.
const MASKABLE = { size: 512, file: 'icon-maskable-512.png', safeZone: 0.8 };

// Sampled from the master's own top and bottom edges, so the full-bleed
// backgrounds above continue the tile's vertical gradient rather than
// butting a flat colour against it.
const FELT_TOP = [4, 110, 28];
const FELT_BOTTOM = [2, 78, 20];

/** A size x size vertical felt gradient: opaque, 3-channel, raw pixels. */
function felt(size) {
  const data = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    const t = size === 1 ? 0 : y / (size - 1);
    const row = FELT_TOP.map((c, i) => Math.round(c + (FELT_BOTTOM[i] - c) * t));
    for (let x = 0; x < size; x++) data.set(row, (y * size + x) * 3);
  }
  return sharp(data, { raw: { width: size, height: size, channels: 3 } });
}

const masterBuffer = await readFile(new URL('icon.png', root));
const meta = await sharp(masterBuffer).metadata();
const largest = Math.max(
  ...PNG_TARGETS.map(t => t.size),
  ...OPAQUE_TARGETS.map(t => t.size),
  ...ICO_SIZES,
  MASKABLE.size
);
if (meta.width !== meta.height) {
  throw new Error(`icon.png must be square, got ${meta.width}x${meta.height}`);
}
if (meta.width < largest) {
  throw new Error(
    `icon.png is ${meta.width}px -- every target is a downsample, so it must be at least ${largest}px`
  );
}

/** The master scaled to size x size, alpha intact. */
function scaled(size) {
  return sharp(masterBuffer)
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png({ effort: 10 })
    .toBuffer();
}

/** The master at artSize, centred on a size x size opaque felt square. */
async function onFelt(size, artSize) {
  return felt(size)
    .composite([{ input: await scaled(artSize), gravity: 'centre' }])
    .png({ effort: 10 })
    .toBuffer();
}

async function emit(file, buffer, note) {
  await writeFile(new URL(file, publicDir), buffer);
  console.log(`wrote public/${file} (${note})`);
}

for (const { size, file } of PNG_TARGETS) {
  await emit(file, await scaled(size), `${size}x${size}`);
}

for (const { size, file } of OPAQUE_TARGETS) {
  await emit(file, await onFelt(size, size), `${size}x${size}, flattened onto felt`);
}

await emit(
  MASKABLE.file,
  await onFelt(MASKABLE.size, Math.round(MASKABLE.size * MASKABLE.safeZone)),
  `${MASKABLE.size}x${MASKABLE.size}, maskable (art inset to ${MASKABLE.safeZone * 100}%)`
);

await emit(
  'favicon.ico',
  await pngToIco(await Promise.all(ICO_SIZES.map(scaled))),
  ICO_SIZES.join('/')
);
