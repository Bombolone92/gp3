import { test, expect } from '@playwright/test';

test('selects a local full-face name for canvas instead of silently rendering fallback glyphs', async ({ page }) => {
  await page.goto('/playground.html');
  const result = await page.evaluate(async () => {
    const { checkFontAvailability, fontAvailable } = await import('/src/engine/font-availability.js?local-face-regression');
    const context = document.createElement('canvas').getContext('2d');
    const text = 'LIST OF FIGURES MiW0123';
    const width = name => { context.font = `24px "${name}", "Canvas Noto Sans"`; return context.measureText(text).width; };
    for (const name of ['Franklin Gothic Demi', 'Arial-BoldMT', 'Arial Bold', 'LiberationSans-Bold', 'Liberation Sans Bold', 'DejaVuSans-Bold', 'DejaVu Sans Bold']) {
      // The font menu may already have checked common families. Exercise a fresh
      // registry in this isolated page, without that previously registered alias.
      for (const face of document.fonts) if (face.family.replace(/^["']|["']$/g, '') === name) document.fonts.delete(face);
      let reference;
      try { reference = await new FontFace('Independent local face probe', `local("${name}")`).load(); } catch { continue; }
      document.fonts.add(reference);
      const before = width(name), expected = width('Independent local face probe');
      if (Math.abs(before - expected) < .01) { document.fonts.delete(reference); continue; }
      await Promise.all([checkFontAvailability(name), checkFontAvailability(name)]);
      const after = width(name), matches = [...document.fonts].filter(f => f.family.replace(/^["']|["']$/g, '') === name).length;
      document.fonts.delete(reference);
      return { name, before, after, expected, matches, available: fontAvailable(name) };
    }
    return null;
  });
  test.skip(!result, 'No installed full-face alias distinct from a selectable CSS family on this host.');
  expect(result.available).toBe(true); expect(result.matches).toBe(1);
  expect(result.after).toBe(result.expected); expect(result.before).not.toBe(result.expected);
});
