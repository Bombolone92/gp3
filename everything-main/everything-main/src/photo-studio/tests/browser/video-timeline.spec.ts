import { expect, test, type Page } from '@playwright/test';
import { boot, canvasDrag, compositePixel, downloadFrom, idle, openImage, run, tool } from './helpers';
import { demuxWebm } from '../../src/imaging/codecs/webm-demux';

// Six solid-color frames at 10 fps, encoded in the page with WebCodecs and
// written with the app's own WebM writer.
const colors = [[230, 30, 30], [30, 200, 30], [30, 30, 230], [230, 220, 30], [220, 30, 220], [30, 220, 220]];

/** Encode the fixture video in the page and keep it as `window.__video`. */
async function makeVideo(page: Page, width = 64, height = 48) {
  await page.evaluate(async ({ colors, width, height }) => {
    const { muxWebm } = await import('/src/imaging/codecs/webm.ts');
    const fps = 10;
    const chunks: { data: Uint8Array; timestampMs: number; key: boolean }[] = [];
    const encoder = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push({ data, timestampMs: chunk.timestamp / 1000, key: chunk.type === 'key' });
      },
      error: (e) => console.warn(e),
    });
    encoder.configure({ codec: 'vp8', width, height, bitrate: 400_000, framerate: fps });
    colors.forEach((c, k) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i += 4) data.set([...c, 255], i);
      const frame = new VideoFrame(data, { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: k * 100_000, duration: 100_000 });
      encoder.encode(frame, { keyFrame: k % 3 === 0 });
      frame.close();
    });
    await encoder.flush();
    const bytes = muxWebm(chunks, { width, height, codec: 'V_VP8', frameRate: fps });
    (window as unknown as { __video: File }).__video = new File([bytes], 'colors.webm', { type: 'video/webm' });
  }, { colors, width, height });
}
const near = (a: number[], b: number[], tol = 40) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);
const timeline = (page: Page) => page.evaluate(() => window.photoStudio.doc.timeline!);
const videoLayer = (page: Page) => page.evaluate(() => window.photoStudio.doc.layers.find((l) => l.video)!);

test.describe('video timeline', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await page.evaluate(() => localStorage.removeItem('photo-studio-bottom-dock'));
  });

  test('imports video, scrubs, paints a frame, keyframes opacity and renders WebM and PNG frames', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await openImage(page, 64, 48, '#ffffff', 'canvas.png');
    await makeVideo(page);
    await page.evaluate(() => window.photoStudio.runCommand('layer.video-new-file', (window as unknown as { __video: File }).__video));
    await idle(page);
    // The footage keeps its frame count and rate; a new timeline fits it.
    const v = await videoLayer(page);
    expect(v.video).toMatchObject({ frames: 6, fps: 10, width: 64, height: 48, x: 0, y: 0 });
    expect(await timeline(page)).toMatchObject({ fps: 10, duration: 6, current: 0 });
    const panel = page.locator('.panel-body[aria-label="Timeline"]');
    await expect(panel.locator('.vt-clip.video')).toHaveCount(1);
    expect(near(await compositePixel(page, 32, 24), colors[0])).toBe(true);

    // Scrub on the ruler to frame 3.
    const ruler = panel.locator('.vt-ruler');
    const box = (await ruler.boundingBox())!;
    const zoom = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.vt-grid')!).getPropertyValue('--zoom').replace('px', '')));
    await page.mouse.click(box.x + 3.5 * zoom, box.y + box.height / 2);
    await expect.poll(async () => (await timeline(page)).current).toBe(3);
    await idle(page);
    expect(near(await compositePixel(page, 32, 24), colors[3])).toBe(true);
    await expect(panel.locator('.vt-corner-time')).toHaveText('0:00:3');

    // Paint on frame 3: only that frame changes.
    await page.evaluate(() => {
      const e = window.photoStudio;
      e.selected = e.doc.layers.find((l) => l.video)!.id;
      e.setForeground('#000000');
      e.brushSize = 12;
      e.update();
    });
    await tool(page, 'Brush Tool');
    await canvasDrag(page, [[10, 10], [20, 12], [30, 14]]);
    expect(Object.keys((await videoLayer(page)).video!.altered ?? {})).toEqual(['3']);
    expect((await compositePixel(page, 20, 12))[0]).toBeLessThan(80);
    await run(page, 'timeline.go-to', 2);
    expect(near(await compositePixel(page, 20, 12), colors[2])).toBe(true);
    await run(page, 'timeline.go-to', 3);
    expect((await compositePixel(page, 20, 12))[0]).toBeLessThan(80);
    // Show Altered Video off shows the footage; Restore Frame drops the paint.
    await run(page, 'layer.video-show-altered');
    expect(near(await compositePixel(page, 20, 12), colors[3])).toBe(true);
    await run(page, 'layer.video-show-altered');
    expect((await compositePixel(page, 20, 12))[0]).toBeLessThan(80);

    // Video filters apply to the frame shown.
    await run(page, 'timeline.go-to', 1);
    await run(page, 'filter.apply.deinterlace', { params: { remove: 'odd', fill: 'duplicate' } });
    expect(Object.keys((await videoLayer(page)).video!.altered ?? {}).sort()).toEqual(['1', '3']);
    // Onion skins draw the neighboring times.
    await run(page, 'animation.onion');
    await expect(page.locator('.onion-skins image')).toHaveCount(2, { timeout: 30_000 });
    await run(page, 'animation.onion');

    // Keyframe opacity: 100 % at frame 0, 20 % at frame 5.
    await run(page, 'timeline.go-to', 0);
    await run(page, 'timeline.animate-opacity');
    await run(page, 'timeline.go-to', 5);
    await page.evaluate(() => window.photoStudio.editLayer('Opacity', (l) => (l.opacity = 0.2)));
    await idle(page);
    const clip = (await timeline(page)).clips[v.id];
    expect(clip.keys!.opacity).toEqual([{ t: 0, v: 1 }, { t: 5, v: 0.2 }]);
    await run(page, 'timeline.go-to', 2);
    expect((await videoLayer(page)).opacity).toBeCloseTo(0.68, 5);
    // Over white, 68 % blue.
    const px = await compositePixel(page, 32, 40);
    expect(Math.abs(px[0] - Math.round(255 - 0.68 * (255 - colors[2][0])))).toBeLessThan(30);
    // The keyframe lane shows both keys.
    await panel.locator(`[data-expand="${v.id}"]`).click();
    await expect(panel.locator('.vt-key')).toHaveCount(2);

    // Playback advances in real time; stopping keeps the frame shown.
    await run(page, 'timeline.go-to', 0);
    await page.evaluate(() => window.photoStudio.runCommand('animation.play'));
    await expect.poll(() => page.evaluate(async () => (await import('/src/features/animation/video-state.ts')).videoPlayback.frame), { timeout: 10_000 }).toBeGreaterThan(1);
    await page.evaluate(() => window.photoStudio.runCommand('animation.play'));
    await idle(page);
    expect(await page.evaluate(async () => (await import('/src/features/animation/video-state.ts')).isVideoPlaying())).toBe(false);
    expect((await timeline(page)).current).toBeGreaterThan(1);

    // Render the timeline to WebM: six frames over 0.6 s.
    await page.evaluate(() => void window.photoStudio.runCommand('file.render-video'));
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toContainText('Render Video');
    await dialog.locator('select[name="output"]').selectOption('webm');
    await dialog.locator('select[name="fps"]').selectOption('10');
    const webm = await downloadFrom(page, () => dialog.getByRole('button', { name: 'Render' }).click());
    expect(webm.name).toMatch(/\.webm$/);
    const file = demuxWebm(new Uint8Array(webm.bytes));
    expect(file.frames).toHaveLength(6);
    expect(file.durationMs).toBeCloseTo(600);
    expect(file.track).toMatchObject({ width: 64, height: 48 });
    await idle(page);

    // The same as a PNG image sequence in a ZIP.
    await page.evaluate(() => void window.photoStudio.runCommand('file.render-video'));
    await expect(dialog).toContainText('Render Video');
    await dialog.locator('select[name="output"]').selectOption('png');
    const zip = await downloadFrom(page, () => dialog.getByRole('button', { name: 'Render' }).click());
    expect(zip.name).toMatch(/\.zip$/);
    const names = [...zip.bytes.toString('latin1').matchAll(/PK\x01\x02[\s\S]{42}([^\x00]*?\.png)/g)].map((m) => m[1]);
    expect(names).toEqual(['canvas_0001.png', 'canvas_0002.png', 'canvas_0003.png', 'canvas_0004.png', 'canvas_0005.png', 'canvas_0006.png']);
    await idle(page);

    // The project keeps the footage, the painted frame and the keyframes.
    const reopened = await page.evaluate(async () => {
      const e = window.photoStudio;
      const { serialize, deserialize } = await import('/src/model/serialization.ts');
      const { document } = await deserialize(await serialize(e.doc, e.assets));
      const l = document.layers.find((x) => x.video)!;
      return { altered: Object.keys(l.video!.altered ?? {}), keys: document.timeline!.clips[l.id].keys, footage: !!l.video!.footage };
    });
    expect(reopened).toEqual({ altered: ['1', '3'], keys: { opacity: [{ t: 0, v: 1 }, { t: 5, v: 0.2 }] }, footage: true });
    expect(errors).toEqual([]);
  });

  test('moves, trims and splits clips in the panel; converts to frames and back', async ({ page }) => {
    await openImage(page, 80, 60, '#ffffff', 'clips.png');
    await page.evaluate(async () => {
      const e = window.photoStudio;
      const { newPixelLayer } = await import('/src/model/pixel-layer.ts');
      const { gridFromImage } = await import('/src/model/tiles.ts');
      const data = new Uint8ClampedArray(20 * 20 * 4);
      for (let i = 0; i < data.length; i += 4) data.set([200, 0, 0, 255], i);
      e.command('Square', (d) => d.layers.push(newPixelLayer('Square', d, gridFromImage(e.assets.tiles, { width: 20, height: 20, data }, 10, 10))));
      e.selected = e.doc.layers.at(-1)!.id;
      e.dock.show('timeline');
      e.update();
    });
    await run(page, 'timeline.create');
    const panel = page.locator('.panel-body[aria-label="Timeline"]');
    const id = await page.evaluate(() => window.photoStudio.selected);
    const clip = panel.locator(`[data-clip="${id}"]`);
    await expect(clip).toBeVisible();
    expect(await timeline(page)).toMatchObject({ fps: 30, duration: 150 });
    const zoom = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.vt-grid')!).getPropertyValue('--zoom').replace('px', '')));

    // Trim the end by dragging its handle 50 frames to the left.
    const end = (await clip.locator('[data-trim="end"]').boundingBox())!;
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2 - 50 * zoom, end.y + end.height / 2, { steps: 5 });
    await page.mouse.up();
    await idle(page);
    expect((await timeline(page)).clips[id]).toEqual({ start: 0, in: 0, length: 100 });

    // Move the clip 20 frames to the right.
    const body = (await clip.boundingBox())!;
    await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
    await page.mouse.down();
    await page.mouse.move(body.x + body.width / 2 + 20 * zoom, body.y + body.height / 2, { steps: 5 });
    await page.mouse.up();
    await idle(page);
    expect((await timeline(page)).clips[id]).toEqual({ start: 20, in: 0, length: 100 });
    // Outside the clip the layer is not drawn.
    await run(page, 'timeline.go-to', 10);
    expect(await compositePixel(page, 20, 20)).toEqual([255, 255, 255, 255]);
    await run(page, 'timeline.go-to', 60);
    expect((await compositePixel(page, 20, 20)).slice(0, 3)).toEqual([200, 0, 0]);

    // Split at the playhead: two layers, two clips.
    await run(page, 'timeline.split');
    const clips = await page.evaluate(() => {
      const e = window.photoStudio;
      return e.doc.layers.map((l) => e.doc.timeline!.clips[l.id] ?? null);
    });
    expect(clips.slice(1)).toEqual([{ start: 20, in: 0, length: 40 }, { start: 60, in: 40, length: 60 }]);
    await expect(panel.locator('.vt-clip')).toHaveCount(3);

    // A cross fade from the first part into the second.
    await page.evaluate(async () => {
      const e = window.photoStudio;
      const { changeClip } = await import('/src/features/animation/video-commands.ts');
      await changeClip(e, e.selected, 'Transitions', (c) => ({ ...c, fadeIn: { kind: 'cross-fade', duration: 10 } }));
    });
    await expect(panel.locator('.vt-fade.cross-fade')).toHaveCount(1);

    // Convert to frames at 5 fps and back to a timeline.
    await page.evaluate(() => void window.photoStudio.runCommand('timeline.convert-to-frames'));
    const dialog = page.locator('dialog[open]');
    await dialog.locator('input[name="fps"]').fill('5');
    await dialog.getByRole('button', { name: 'Convert' }).click();
    await idle(page);
    const anim = await page.evaluate(() => window.photoStudio.doc.animation!);
    expect(anim.frames).toHaveLength(25);
    expect(await page.evaluate(() => window.photoStudio.doc.timeline)).toBeUndefined();
    await expect(panel.locator('.frame-cell')).toHaveCount(25);
    await run(page, 'timeline.convert-to-video');
    expect(await timeline(page)).toMatchObject({ fps: 30, duration: 150 });
    await expect(panel.locator('.vt-clip')).toHaveCount(3);
  });

  test('blank video layers, frame edits and artboards', async ({ page }) => {
    await openImage(page, 40, 30, '#ffffff', 'blank.png');
    await run(page, 'layer.video-new-blank');
    const v = await videoLayer(page);
    expect(v.video).toMatchObject({ frames: 150, fps: 30 });
    await run(page, 'timeline.go-to', 4);
    await run(page, 'layer.video-insert-frame');
    expect((await videoLayer(page)).video).toMatchObject({ frames: 151 });
    await run(page, 'layer.video-delete-frame');
    await run(page, 'layer.video-duplicate-frame');
    expect((await videoLayer(page)).video!.frames).toBe(151);
    await run(page, 'layer.video-rasterize');
    expect((await videoLayer(page))).toBeUndefined();
    // Artboards and a video timeline do not mix.
    await run(page, 'layer.new-artboard');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    expect(await page.evaluate(() => window.photoStudio.doc.layers.some((l) => l.artboard))).toBe(false);
    await expect(page.locator('#status')).toContainText(/Artboards and a video timeline/);
  });
});

test.describe('video layer placement', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test('Image Size, canvas rotation and Free Transform carry every frame; undo restores them', async ({ page }) => {
    await openImage(page, 96, 64, '#ffffff', 'place.png');
    await makeVideo(page, 32, 16);
    await page.evaluate(() => window.photoStudio.runCommand('layer.video-new-file', (window as unknown as { __video: File }).__video));
    await idle(page);
    expect((await videoLayer(page)).video).toMatchObject({ x: 32, y: 24, width: 32, height: 16 });
    // Alter frame 2: a dark block in the frame's top-left corner.
    await run(page, 'timeline.go-to', 2);
    await page.evaluate(async () => {
      const e = window.photoStudio;
      const { writeRect } = await import('/src/model/tiles.ts');
      const id = e.doc.layers.find((l) => l.video)!.id;
      e.selected = id;
      e.command('Paint', (d) => {
        const l = d.layers.find((x) => x.id === id)!;
        const data = new Uint8ClampedArray(8 * 4 * 4);
        for (let i = 0; i < data.length; i += 4) data.set([20, 20, 20, 255], i);
        l.pixels = writeRect(e.assets.tiles, l.pixels!, 32, 24, { width: 8, height: 4, data });
      });
    });
    await idle(page);
    expect(Object.keys((await videoLayer(page)).video!.altered!)).toEqual(['2']);
    const steps = await page.evaluate(() => window.photoStudio.history.position);

    // Image Size 50 %, rotate the canvas 90° clockwise, then scale the layer with Free Transform.
    await page.evaluate(async () => {
      const { resampleDocument } = await import('/src/features/transform/image-size.ts');
      resampleDocument(window.photoStudio, 48, 32, 'bicubic');
    });
    await idle(page);
    await run(page, 'image.rotate-cw');
    expect(await page.evaluate(() => [window.photoStudio.doc.width, window.photoStudio.doc.height])).toEqual([32, 48]);
    await page.evaluate(() => void window.photoStudio.runCommand('edit.free-transform'));
    await idle(page);
    // 150 % wide and tall through the options bar.
    for (const id of ['#ts-w', '#ts-h']) {
      await page.locator(id).fill('150');
      await page.locator(id).press('Tab');
    }
    await page.locator('#viewport').focus();
    await page.keyboard.press('Enter');
    await idle(page);
    const v = (await videoLayer(page)).video!;
    expect(v.matrix).toBeDefined();
    expect(Object.keys(v.alteredMatrix ?? {})).toEqual(['2']);

    // Every frame lands on the same area; frame 2 keeps its block in the corner that turned to the top right.
    const frameAt = (t: number) =>
      page.evaluate(async (t) => {
        const e = window.photoStudio;
        await e.runCommand('timeline.go-to', t);
        await e.renderer.settle();
        const { gridDocBounds, readRGBA } = await import('/src/model/tiles.ts');
        const l = e.doc.layers.find((x) => x.video)!;
        const b = gridDocBounds(l.pixels!)!;
        const at = (x: number, y: number) => Array.from(readRGBA(e.assets.tiles, l.pixels!, { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 }).data);
        return { b, center: at(b.x + b.width / 2, b.y + b.height / 2), corner: at(b.x + b.width - 2, b.y + 1) };
      }, t);
    const f0 = await frameAt(0),
      f2 = await frameAt(2),
      f4 = await frameAt(4);
    expect(f2.b).toEqual(f0.b);
    expect(f4.b).toEqual(f0.b);
    // Scaled by Free Transform: wider and taller than the 8 x 16 the canvas edits left.
    expect(f0.b.width).toBeGreaterThan(10);
    expect(f0.b.height).toBeGreaterThan(20);
    expect(near(f0.center, colors[0])).toBe(true);
    expect(near(f2.center, colors[2])).toBe(true);
    expect(near(f4.center, colors[4])).toBe(true);
    expect(f2.corner.slice(0, 3).every((c) => c < 80)).toBe(true);
    expect(near(f0.corner, colors[0])).toBe(true);
    expect(near(f4.corner, colors[4])).toBe(true);

    // Undo back to the painted state restores the original placement of every frame.
    await page.evaluate((steps) => window.photoStudio.history.goto(steps), steps);
    await idle(page);
    const restored = (await videoLayer(page)).video!;
    expect(restored).toMatchObject({ x: 32, y: 24 });
    expect(restored.matrix).toBeUndefined();
    expect(restored.alteredMatrix).toBeUndefined();
    const g0 = await frameAt(0),
      g2 = await frameAt(2);
    expect(g0.b).toEqual({ x: 32, y: 24, width: 32, height: 16 });
    expect(g2.b).toEqual(g0.b);
    expect(near(g2.corner, colors[2])).toBe(true);
    expect(Array.from(await compositePixel(page, 33, 25)).slice(0, 3).every((c) => c < 80)).toBe(true);

    // A mode conversion converts every frame, not only the one shown.
    const beforeMode = await page.evaluate(() => window.photoStudio.history.position);
    await run(page, 'image.mode-grayscale');
    for (const t of [0, 4]) {
      const f = await frameAt(t);
      expect(Math.max(...f.center.slice(0, 3)) - Math.min(...f.center.slice(0, 3))).toBeLessThan(4);
    }
    await page.evaluate((p) => window.photoStudio.history.goto(p), beforeMode);
    await idle(page);
    const colored = await frameAt(4);
    expect(near(colored.center, colors[4])).toBe(true);
  });
});
