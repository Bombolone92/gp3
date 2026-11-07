/**
 * Engine functions the editor's views call once a document is open. They live in the lazily loaded
 * engine chunk (see engine-chunk.js), so the app shell does not download layout, drawing and codec code
 * before a document opens. The editor view provides them when the engine has loaded.
 */
let api = null;
export const engineApi = () => api;
export function provideEngineApi(modules) { api = modules; }
