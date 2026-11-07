// Product analytics through Plausible, loaded by index.html. Only named
// events with a few plain properties are sent, never board content, titles,
// names, or addresses. Without the script, as in tests or when it is
// blocked, every call is a no-op.
export function track(event, props) {
  try {
    const plausible = globalThis.window?.plausible;
    if (typeof plausible !== "function") return;
    plausible(event, props ? { props } : undefined);
  } catch {}
}
