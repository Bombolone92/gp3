/**
 * Custom event tracking (Plausible).
 *
 * index.html installs a queue stub before the analytics script loads, so calls
 * made during startup are replayed once it arrives. When the script never
 * arrives — blocked by an extension, offline, or a self-hosted deploy without
 * analytics — the stub absorbs the call and nothing else happens. Tracking is
 * never worth breaking a game over, so every call here is best-effort.
 */

/** Plausible props must be scalars; unset ones are simply left out. */
function cleanProps(props) {
  const out = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

export function track(event, props) {
  try {
    window.plausible?.(event, { props: cleanProps(props) });
  } catch {
    /* ignore — analytics must never surface to the player */
  }
}
