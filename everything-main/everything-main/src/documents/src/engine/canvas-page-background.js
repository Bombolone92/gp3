const patterns = new WeakMap();
/** Paint the resolved physical tile at each page origin without changing layout. */
export function paintPagePictureBackground(ctx, page, images, { bestEffort = false } = {}) {
  if (!page.backgroundPicture) return;
  const image = images.get(page.backgroundPicture.assetId);
  if (!image || image.previewPlaceholder) {
    // The caller already painted the solid page color. A read-only preview
    // can keep it when decoding reported an unavailable background asset.
    if (bestEffort) return;
    throw new Error('The page background image could not be decoded.');
  }
  const { width, height } = page.backgroundPicture, key = `${width}/${height}`;
  let variants = patterns.get(image);
  if (!variants) { variants = new Map(); patterns.set(image, variants); }
  let pattern = variants.get(key);
  if (!pattern) {
    pattern = ctx.createPattern(image, 'repeat');
    if (!pattern) throw new Error('The page background pattern could not be created.');
    pattern.setTransform(new DOMMatrix().scale(width / image.width, height / image.height));
    variants.set(key, pattern);
  }
  ctx.save(); ctx.fillStyle = pattern; ctx.imageSmoothingQuality = 'high';
  ctx.fillRect(0, 0, page.width, page.height); ctx.restore();
}
