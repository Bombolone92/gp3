/**
 * Normalize a user-entered link into something safe to use as an href.
 * Only http(s) survives; anything else (javascript:, data:, malformed
 * input) returns null, so a stored link can never execute script when
 * clicked. Scheme-less input like "linkedin.com/in/ada" is treated as
 * https.
 */
export function safeHttpUrl(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  let candidate = text;
  if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`;
  } else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:(?!\d)/.test(candidate)) {
    // Dots are legal in scheme names, so "example.com:8080/x" would read
    // as a scheme without the lookahead — no real scheme is followed by
    // digits, but every host:port is.
    candidate = `https://${candidate}`;
  }
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // Userinfo is the spoof shape: a pasted email ("ada@example.com")
  // becomes a link that displays one thing and navigates to example.com.
  // No stored candidate link legitimately carries credentials.
  if (url.username || url.password) return null;
  // A host without a dot is almost always a typo rather than a real site.
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  return url.href;
}
