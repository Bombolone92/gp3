/**
 * Where Puter.js is running: 'app' (inside a Puter app window), 'web', or
 * 'gui'. Inside a Puter app the platform owns the session, so the app never
 * offers sign-out there.
 */
export function puterEnv() {
  return typeof puter !== 'undefined' ? puter.env : 'web';
}

export function isPuterApp() {
  return puterEnv() === 'app';
}
