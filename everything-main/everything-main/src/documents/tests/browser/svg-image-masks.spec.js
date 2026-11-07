import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

for (const fixture of ['svg-image-masks', 'svg-image-masks-scaled', 'svg-image-masks-step']) {
  for (let index = 2; index < 6; index++) {
    test(`${fixture}: image mask ${index + 1} native alpha`, async ({ page }) => {
      const folder = `tests/fixtures/${fixture}/`;
      const source = readFileSync(`public/fixtures/${fixture}.docx`);
      const refs = JSON.parse(readFileSync(folder + 'metafile-reference.json'));
      const ref = refs.images[index], png = readFileSync(folder + ref.path);
      const hash = bytes => createHash('sha256').update(bytes).digest('hex');
      expect(hash(source)).toBe(refs.sourceSha256);
      expect(hash(readFileSync(folder + 'native.emf'))).toBe(refs.nativeSha256);
      expect(hash(png)).toBe(ref.sha256);
      await page.goto('/playground.html');
      const difference = await page.evaluate(async ({ xml, ref, url, index }) => {
        const { nativeSvgStrokes } = await import('/src/engine/svg-native-strokes.js');
        const root = nativeSvgStrokes(new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement, { width: 120, height: 80 }, true);
        // The extracted PNG is in nested-metafile coordinates. Remove only the
        // outer frame correction to compare the same native pixel grid.
        root.removeAttribute('style'); root.querySelector('#_nativeSvgViewport')?.remove();
        const load = async src => { const im = new Image(); im.src = src; await im.decode(); return im; };
        const canvas = () => { const c = document.createElement('canvas'); c.width = 120; c.height = 80; return c; };
        const actual = canvas(), native = canvas();
        actual.getContext('2d').drawImage(await load('data:image/svg+xml;base64,' + btoa(new XMLSerializer().serializeToString(root))), 0, 0);
        native.getContext('2d').drawImage(await load(url), ref.transform[4], ref.transform[5]);
        const a = actual.getContext('2d').getImageData(0, 0, 120, 80).data;
        const b = native.getContext('2d').getImageData(0, 0, 120, 80).data;
        let max = 0, changed = 0;
        for (let y = 0; y < 80; y++) for (let x = index * 20; x < (index + 1) * 20; x++) {
          const at = (y * 120 + x) * 4 + 3, delta = Math.abs(a[at] - b[at]);
          max = Math.max(max, delta); if (delta) changed++;
        }
        return { max, changed };
      }, { xml: new TextDecoder().decode(unzipSync(source)['word/media/vector.svg']), ref, index, url: 'data:image/png;base64,' + png.toString('base64') });
      if (fixture !== 'svg-image-masks') test.fail(true, 'Native image-mask downsampling differs from browser interpolation; exact native comparison retained.');
      expect(difference).toEqual({ max: 0, changed: 0 });
    });
  }
}
