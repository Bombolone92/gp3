/**
 * Opening attachments safely. A blob URL runs with the app's own origin, so
 * only types a browser cannot execute (raster images and PDF) are opened in
 * a tab; everything else, including SVG and HTML, is downloaded as plain
 * bytes. The decision uses the blob's own type, never a name or label.
 */
const VIEWABLE = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/;

export function isViewable(type) {
  return VIEWABLE.test(String(type || '').split(';')[0].trim().toLowerCase());
}

export function openBlob(blob, name = 'file') {
  const viewable = isViewable(blob.type);
  const safe = viewable ? blob : new Blob([blob], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(safe);
  if (viewable) {
    window.open(url, '_blank', 'noopener');
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
