import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Requires ImageMagick (`magick`). Keep icon.png as the original artwork.
const cwd = fileURLToPath(new URL('../', import.meta.url));
const background = '#2586ed';
const convert = (...args) => execFileSync('magick', ['icon.png', ...args], { cwd, stdio: 'inherit' });

for (const size of [192, 512]) {
  convert('-resize', `${size}x${size}`, `public/icons/icon-${size}.png`);
}
convert('-define', 'icon:auto-resize=48,32,16', 'public/favicon.ico');
convert('-resize', '180x180', '-background', background, '-alpha', 'remove', '-alpha', 'off',
  'public/icons/apple-touch-icon.png');
// Inset the artwork so the speech bubbles survive circular launcher masks.
convert('-resize', '384x384', '-background', background, '-alpha', 'remove', '-alpha', 'off',
  '-gravity', 'center', '-extent', '512x512', 'public/icons/icon-maskable-512.png');
