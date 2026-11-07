/** Allocate a conversion-safe destination only for a usable telephone URI. */
export function telephoneSurrogate(value, destination, telephones) {
  const href = destination.trim();
  if (!/^tel:.+/i.test(href) || /[\u0000-\u001f\u007f]/.test(href)) return null;
  let surrogate;
  do { surrogate = `https://import-telephone.invalid/${crypto.randomUUID()}`; } while (value.includes(surrogate) || telephones.has(surrogate));
  telephones.set(surrogate, href);
  return surrogate;
}

/** Keep supported telephone links identifiable through the rich HTML converter. */
export function prepareHtmlTelephone(value, telephones) {
  if (!telephones || typeof DOMParser === 'undefined' || !/<a\b/i.test(value)) return value;
  const document = new DOMParser().parseFromString(value, 'text/html');
  let changed = false;
  for (const link of document.querySelectorAll('a[href]')) {
    const surrogate = telephoneSurrogate(value, link.getAttribute('href'), telephones);
    if (!surrogate) continue;
    link.setAttribute('href', surrogate);
    changed = true;
  }
  return changed ? document.body.innerHTML : value;
}

/** Count only links the native converter will actually insert. */
export function telephoneTargets(content, telephones) {
  const expected = new Map(), stack = [content];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (value.kind === 'hyperlink' && telephones.has(value.hyperlink?.href)) {
      const href = value.hyperlink.href;
      expected.set(href, (expected.get(href) || 0) + 1);
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
  }
  return expected;
}

/** Restore destinations before pictures replace the text inside their links. */
export async function restoreTelephone(api, telephones, expected) {
  if (!expected.size) return;
  const found = new Map(), targets = [], seen = new Set();
  let offset = 0;
  while (true) {
    const result = await api.hyperlinks.list({ limit: 1000, offset });
    if (!Array.isArray(result?.items)) throw new Error('Could not locate an imported telephone link');
    for (const link of result.items) {
      const href = link.properties?.href;
      if (!expected.has(href) || seen.has(link.id)) continue;
      if (!link.id || !link.address) throw new Error('Could not locate an imported telephone link');
      seen.add(link.id);
      found.set(href, (found.get(href) || 0) + 1);
      targets.push({ target: link.address, patch: { href: telephones.get(href) } });
    }
    offset += result.items.length;
    if (!result.items.length || offset >= result.total) break;
  }
  for (const [href, count] of expected) if (found.get(href) !== count) throw new Error('Could not locate an imported telephone link');
  for (const input of targets) {
    const result = await api.hyperlinks.patch(input);
    if (result == null || result.success === false) throw new Error(result?.failure?.message || 'Could not restore an imported telephone link');
  }
}
