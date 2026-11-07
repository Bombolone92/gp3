/**
 * A tiny route table that both the Puter worker and the in-browser backend
 * dispatch through. Handlers receive a context and return plain data (sent
 * as JSON) or a Response; they signal failure by throwing HttpError.
 */

export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    if (extra) Object.assign(this, extra);
  }
}

export function fail(status, code, message, extra) {
  throw new HttpError(status, code, message, extra);
}

export class Routes {
  constructor() {
    this.list = [];
  }

  add(method, pattern, handler) {
    const names = [];
    const source = pattern
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          names.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.list.push({ method, pattern, re: new RegExp(`^${source}$`), names, handler });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  match(method, path) {
    for (const r of this.list) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      const params = {};
      r.names.forEach((n, i) => {
        try {
          params[n] = decodeURIComponent(m[i + 1]);
        } catch {
          params[n] = '';
        }
      });
      return { route: r, params };
    }
    return null;
  }
}

/** Shape an error for the wire. Unexpected errors never leak their text. */
export function errorBody(e) {
  if (e instanceof HttpError || (e && typeof e.status === 'number' && e.code)) {
    const body = { error: e.code, message: e.message };
    if (e.field) body.field = e.field;
    if (e.current) body.current = e.current;
    return { status: e.status, body };
  }
  if (e && e.code === 'too_many_requests') return { status: 429, body: { error: 'rate_limited', message: 'Too many requests. Try again in a moment.' } };
  if (e && e.code === 'insufficient_funds') return { status: 402, body: { error: 'insufficient_funds', message: 'The help desk owner has run out of Puter usage credit.' } };
  return { status: 500, body: { error: 'server_error', message: 'Something went wrong on the help desk server.' } };
}

/**
 * Read a request body as bytes, giving up once it passes `limit`. A declared
 * length is checked first; without one (a chunked upload) the stream is read
 * only as far as the limit, so an oversized body is never held in memory.
 * Resolves to a Uint8Array, or null when the body is too large.
 */
export async function readBody(request, limit) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > limit) return null;
  const reader = request.body?.getReader?.();
  if (!reader) {
    const buf = new Uint8Array(await request.arrayBuffer());
    return buf.byteLength > limit ? null : buf;
  }
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
