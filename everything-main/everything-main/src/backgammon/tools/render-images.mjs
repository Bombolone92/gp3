/**
 * Renders every image the site ships.
 *
 * There are two sources, and only two: `src/icon.png` is the app mark, and
 * `tools/og-image.svg` is the social card the mark is dropped into. Both are
 * turned into PNGs here with command-line tools rather than a browser, which
 * is why this is a committed script rather than a note in the README. It
 * needs, once:
 *
 *   brew install librsvg imagemagick
 *
 * Then:  node tools/render-images.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const icon = `${root}src/icon.png`;
const out = `${root}public`;
const tmp = `${root}.render-tmp`;

/** The frame at the very edge of the squircle — see the touch icon below. */
const EDGE = '#271709';

function run(command, args) {
  try {
    execFileSync(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error(`${command} failed: ${detail}`);
  }
}

/**
 * The mark at a given size. Trimmed first: the source carries a few
 * transparent pixels of slack around the squircle, and at 16px they cost real
 * area. `-strip` and the maximum compression level matter more than they look
 * — a favicon is fetched on every cold visit.
 */
function mark(size, target, extra = []) {
  run('magick', [
    icon,
    '-trim',
    '+repage',
    '-filter',
    'Lanczos',
    '-resize',
    `${size}x${size}`,
    ...extra,
    '-strip',
    '-define',
    'png:compression-level=9',
    target,
  ]);
  console.log(`wrote ${target.replace(root, '')}`);
}

mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });

for (const size of [16, 32, 128, 192, 512]) {
  mark(size, `${out}/${size <= 32 ? `favicon-${size}x${size}` : `icon-${size}`}.png`);
}

// iOS paints black behind transparency and lays its own mask over the square,
// so the touch icon is flattened onto the frame colour at the squircle's edge.
// That mask lands within a pixel or two of the icon's own corner radius, which
// is what makes the fill all but invisible.
mark(180, `${out}/apple-touch-icon.png`, ['-background', EDGE, '-flatten']);

// The .ico carries three sizes; 48 is the one Windows and some browsers pick
// for a tab strip, and it is missing from the PNG set above.
for (const size of [16, 32, 48]) mark(size, `${tmp}/ico-${size}.png`);
run('magick', [`${tmp}/ico-16.png`, `${tmp}/ico-32.png`, `${tmp}/ico-48.png`, `${out}/favicon.ico`]);
console.log('wrote public/favicon.ico');

// 1200x630 (1.91:1) is the ratio Facebook, LinkedIn, Slack, and X's large
// card all render. Built at 2x and reduced, which antialiases the type and the
// board's edges better than rendering at 1x does. The card's SVG leaves a hole
// where the mark goes and the mark is composited in, rather than the mark
// being redrawn in SVG — one source for it, not two.
run('rsvg-convert', ['-w', '2400', '-h', '1260', '-o', `${tmp}/card.png`, `${root}tools/og-image.svg`]);
mark(192, `${tmp}/mark.png`);
run('magick', [
  `${tmp}/card.png`,
  `${tmp}/mark.png`,
  '-geometry',
  '+144+148',
  '-composite',
  '-resize',
  '1200x630',
  '-strip',
  '-define',
  'png:compression-level=9',
  `${out}/og-image.png`,
]);
console.log('wrote public/og-image.png');

rmSync(tmp, { recursive: true, force: true });
