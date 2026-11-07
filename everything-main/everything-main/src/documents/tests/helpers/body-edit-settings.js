// Shared by the Vitest and Playwright body-edit assertions. Returns the exact
// settings.xml text a body edit may produce from `bytes`: the one proofState tag
// with clean spelling and grammar values flipped to dirty, and nothing else changed.
export function bodyEditSettings(bytes) {
  const before = new TextDecoder().decode(bytes), tags = before.match(/<w:proofState\b[^>]*>/g) || [];
  if (tags.length !== 1) throw new Error('Source must declare one proofState');
  for (const attribute of ['spelling', 'grammar']) {
    if (!new RegExp(`\\sw:${attribute}\\s*=\\s*["']clean["']`).test(tags[0])) throw new Error(`Source ${attribute} must be clean`);
  }
  return before.replace(tags[0], tags[0].replace(/(\sw:(?:spelling|grammar)\s*=\s*)(["'])clean\2/g, '$1$2dirty$2'));
}
