import {test, expect} from '@playwright/test';
test.setTimeout(180000);

for (const name of ['legacy', 'positioning', 'optional', 'cff']) test(`${name} WOFF paints identically before and after private font preparation`, async ({page}) => {
  await page.goto('/playground.html');
  const results = await page.evaluate(async name => {
    const {normalizeFontBuffer} = await import('/src/engine/font-container.js');
    const {syntheticAdvanceFont} = await import('/src/engine/synthetic-advance-font.js');
    const {withoutLegacyKerning, legacyKerningAsPositioning} = await import('/src/engine/legacy-kerning-font.js');
    const {withoutGposOnlyKerning} = await import('/src/engine/gpos-only-kerning-font.js');
    const {literalSeparatorFont} = await import('/src/engine/literal-separator-font.js');
    const root = '/tests/fixtures/woff-controls/';
    const [packed, sfnt] = await Promise.all([`${name}.woff`, `${name}-decoded.ttf`].map(async file => (await fetch(root+file)).arrayBuffer()));
    const paints = [];
    for (const [i, transform] of [x=>x, normalizeFontBuffer, syntheticAdvanceFont, withoutLegacyKerning,
      legacyKerningAsPositioning, withoutGposOnlyKerning, literalSeparatorFont].entries()) {
      const a = transform(packed), b = transform(sfnt);
      if (!a || !b) {paints.push({skipped: !a && !b}); continue;}
      const paint = async (buffer, suffix) => {
        const alias = `woff control ${i} ${suffix}`, face = await new FontFace(alias,buffer).load();
        document.fonts.add(face);
        try {
          const canvas = document.createElement('canvas'); canvas.width=600; canvas.height=100;
          const ctx=canvas.getContext('2d');ctx.font=`48px "${alias}"`;ctx.fontKerning='normal';
          ctx.fillText('AV AV A\uffffV',10,70);
          return {pixels:canvas.toDataURL(), width:ctx.measureText('AV AV A\uffffV').width};
        } finally {document.fonts.delete(face);}
      };
      const first = await paint(a,'a'), second = await paint(b,'b');
      paints.push({samePixels:first.pixels===second.pixels, sameWidth:first.width===second.width});
    }
    return paints;
  }, name);
  expect(results).toHaveLength(7);
  for (const result of results) if ('skipped' in result) expect(result.skipped).toBe(true);
  else expect(result).toEqual({samePixels:true,sameWidth:true});
});
