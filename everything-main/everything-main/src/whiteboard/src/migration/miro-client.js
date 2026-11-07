// Paging client for the Miro REST API v2. The host injects a fetch-compatible
// function (puter.net.fetch in production, which bypasses browser CORS) and a
// bearer token. The token is only sent to the Miro API origin and never logged.

export const MIRO_API = "https://api.miro.com";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export class MiroError extends Error {
  constructor(message, { status = 0, code = "", retryable = false } = {}) {
    super(message);
    this.name = "MiroError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const abortError = (signal) =>
  signal?.reason instanceof Error
    ? signal.reason
    : Object.assign(Error("The operation was aborted."), {
        name: "AbortError",
      });
export function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const done = () => {
      signal?.removeEventListener("abort", stop);
      resolve();
    };
    const timer = setTimeout(done, ms);
    function stop() {
      clearTimeout(timer);
      reject(abortError(signal));
    }
    signal?.addEventListener("abort", stop, { once: true });
  });
}
const header = (response, name) =>
  typeof response.headers?.get === "function"
    ? response.headers.get(name)
    : (response.headers?.[name] ?? response.headers?.[name.toLowerCase()]);

// Retry-After is either delta seconds or an HTTP date.
export function retryDelay(value, now = Date.now()) {
  if (value == null || value === "") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  // A date already past on this device, as when its clock runs ahead,
  // says nothing about how long to wait, so the usual backoff applies.
  const date = Date.parse(value);
  return Number.isFinite(date) && date > now ? date - now : null;
}

// Miro announces when its per-minute credits reset as a UNIX time.
export function resetDelay(value, now = Date.now()) {
  const at = Number(value);
  if (!value || !Number.isFinite(at) || at <= 0) return null;
  // Seconds, or milliseconds for a value that large. A reset time already
  // past, as when this device's clock runs ahead, says nothing about how
  // long to wait, so the usual backoff applies.
  const delay = (at > 1e12 ? at : at * 1000) - now;
  return delay > 0 ? delay : null;
}

export function createMiroClient({
  fetch: fetchImpl,
  token,
  baseURL = MIRO_API,
  sleep = abortableSleep,
  maxRetries = 5,
  retryBase = 1000,
  maxDelay = 60_000,
  maxPages = 10_000,
  onRetry,
} = {}) {
  if (typeof fetchImpl !== "function")
    throw Error("A fetch function is required.");
  if (!token || typeof token !== "string")
    throw Error("Enter a Miro access token.");
  // The origin includes the scheme, so the token never goes over plain HTTP.
  const apiOrigin = new URL(baseURL).origin;

  async function send(
    url,
    { signal, auth = true, accept = "application/json" },
  ) {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError(signal);
      let response;
      try {
        const headers = { Accept: accept };
        if (auth && url.origin === apiOrigin)
          headers.Authorization = `Bearer ${token}`;
        response = await fetchImpl(url.href, {
          method: "GET",
          headers,
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw abortError(signal);
        if (attempt >= maxRetries)
          throw new MiroError(
            "Miro could not be reached. Check the connection.",
            {
              code: "network",
              retryable: true,
            },
          );
        const delay = Math.min(maxDelay, retryBase * 2 ** attempt);
        onRetry?.({ status: 0, delay, attempt: attempt + 1 });
        await sleep(delay, signal);
        continue;
      }
      if (RETRY_STATUS.has(response.status) && attempt < maxRetries) {
        const delay = Math.min(
          maxDelay,
          retryDelay(header(response, "retry-after")) ??
            (response.status === 429
              ? resetDelay(header(response, "x-ratelimit-reset"))
              : null) ??
            retryBase * 2 ** attempt,
        );
        onRetry?.({ status: response.status, delay, attempt: attempt + 1 });
        await sleep(delay, signal);
        continue;
      }
      if (!response.ok) {
        let body = null;
        try {
          body = await response.json();
        } catch {}
        const status = response.status;
        const message =
          status === 401
            ? "The Miro access token was rejected. Create a new token and try again."
            : status === 403
              ? "The Miro token does not have permission for this request."
              : status === 404
                ? "The Miro resource was not found."
                : status === 429
                  ? "Miro rate limits were exceeded. Try again later."
                  : `Miro returned an error (${status}).`;
        throw new MiroError(message, {
          status,
          code: typeof body?.code === "string" ? body.code : "",
          retryable: RETRY_STATUS.has(status),
        });
      }
      return response;
    }
  }
  function address(path, params = {}) {
    const url = new URL(path, baseURL);
    for (const [key, value] of Object.entries(params))
      if (value != null && value !== "") url.searchParams.set(key, value);
    return url;
  }
  async function request(path, { params, signal } = {}) {
    const response = await send(address(path, params), { signal });
    return response.json();
  }
  // Cursor lists continue with `cursor` (or links.next); offset lists advance
  // by the page size until `total` is reached. A repeated cursor, an empty
  // page, or maxPages ends the loop so a faulty server cannot spin forever.
  async function paginate(
    path,
    { mode = "cursor", limit = 50, params = {}, signal, onPage } = {},
  ) {
    const all = [];
    let cursor = null,
      offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const query = { ...params, limit };
      if (mode === "offset") query.offset = offset;
      else if (cursor) query.cursor = cursor;
      const body = await request(path, { params: query, signal });
      const data = Array.isArray(body)
        ? body
        : Array.isArray(body?.data)
          ? body.data
          : [];
      all.push(...data);
      onPage?.({ loaded: all.length, total: body?.total ?? null });
      if (!data.length || Array.isArray(body)) break;
      if (mode === "offset") {
        offset = (Number(body.offset) || offset) + data.length;
        if (
          Number.isFinite(body.total)
            ? offset >= body.total
            : data.length < limit
        )
          break;
      } else {
        let nextCursor = body.cursor || null;
        if (!nextCursor && body.links?.next) {
          try {
            nextCursor = new URL(body.links.next, baseURL).searchParams.get(
              "cursor",
            );
          } catch {}
        }
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }
    }
    return all;
  }
  const board = (id) => `/v2/boards/${encodeURIComponent(id)}`;
  const experimental = (id) =>
    `/v2-experimental/boards/${encodeURIComponent(id)}`;
  const org = (id) => `/v2/orgs/${encodeURIComponent(id)}`;
  // Enterprise-only endpoints degrade to { available: false } when the plan
  // or token scopes do not allow them.
  async function optional(fn) {
    try {
      return { available: true, data: await fn() };
    } catch (error) {
      if (error instanceof MiroError && [401, 403, 404].includes(error.status))
        return { available: false, status: error.status, data: [] };
      throw error;
    }
  }
  // Board content Miro may refuse to list, such as experimental mind map
  // nodes, is reported as unavailable instead of failing the whole board.
  // Errors worth retrying, and stopped runs, still fail it.
  async function partial(fn) {
    try {
      return { available: true, data: await fn() };
    } catch (error) {
      if (
        error instanceof MiroError &&
        error.status >= 400 &&
        error.status < 500 &&
        !error.retryable
      )
        return { available: false, status: error.status, data: [] };
      throw error;
    }
  }

  const client = {
    request,
    paginate,
    // Pages are read by offset, so boards are listed in creation order,
    // which edits during a long inventory do not reshuffle. A board created
    // meanwhile can shift one into the next page; it is listed once.
    listBoards: async ({ teamId, query, signal, onPage } = {}) => {
      const boards = await paginate("/v2/boards", {
        mode: "offset",
        params: { team_id: teamId, query, sort: "last_created" },
        signal,
        onPage,
      });
      const seen = new Set();
      return boards.filter((b) => !seen.has(b.id) && seen.add(b.id));
    },
    getBoard: (id, { signal } = {}) => request(board(id), { signal }),
    listItems: (id, { signal, onPage } = {}) =>
      paginate(`${board(id)}/items`, { signal, onPage }),
    // Item lists report a total, so one small page counts a board's items.
    // Miro accepts page sizes from 10 to 50.
    async countItems(id, { signal } = {}) {
      const body = await request(`${board(id)}/items`, {
        params: { limit: 10 },
        signal,
      });
      return Number.isFinite(body?.total) ? body.total : null;
    },
    listConnectors: (id, { signal, onPage } = {}) =>
      paginate(`${board(id)}/connectors`, { signal, onPage }),
    listTags: (id, { signal } = {}) =>
      paginate(`${board(id)}/tags`, { mode: "offset", signal }),
    // Items do not list their tags, so each tag's items are read instead.
    listTaggedItems: (id, tagId, { signal } = {}) =>
      paginate(`${board(id)}/items`, {
        mode: "offset",
        params: { tag_id: tagId },
        signal,
      }),
    // A page holds up to 50 grouped items, so a large group can continue on
    // the next page under the same ID.
    listGroups: (id, { signal } = {}) =>
      paginate(`${board(id)}/groups`, { signal }),
    // The experimental endpoint documents no page size limit. Should it
    // refuse 50, the size its documentation shows is tried before the
    // board's mind maps are given up.
    async listMindmapNodes(id, { signal } = {}) {
      const path = `${experimental(id)}/mindmap_nodes`;
      try {
        return await paginate(path, { signal });
      } catch (error) {
        if (!(error instanceof MiroError) || error.status !== 400) throw error;
        return paginate(path, { limit: 10, signal });
      }
    },
    listMembers: (id, { signal } = {}) =>
      paginate(`${board(id)}/members`, { mode: "offset", signal }),
    listOrgTeams: (orgId, { signal } = {}) =>
      optional(() => paginate(`${org(orgId)}/teams`, { limit: 100, signal })),
    listOrgMembers: (orgId, { signal } = {}) =>
      optional(() => paginate(`${org(orgId)}/members`, { limit: 100, signal })),
    listTeamMembers: (orgId, teamId, { signal } = {}) =>
      optional(() =>
        paginate(`${org(orgId)}/teams/${encodeURIComponent(teamId)}/members`, {
          limit: 100,
          signal,
        }),
      ),
    // Downloads an image or document resource. Miro resource URLs answer with
    // JSON naming a short-lived file URL when redirect=false; that URL is
    // fetched without the token.
    async downloadResource(url, { signal, maxBytes = 10 * 1024 * 1024 } = {}) {
      let target = new URL(url, baseURL);
      for (let hop = 0; hop < 3; hop++) {
        if (!["https:", "http:"].includes(target.protocol))
          throw new MiroError("unsupported resource URL", { code: "url" });
        const miro = target.origin === apiOrigin;
        if (miro && !target.searchParams.has("redirect"))
          target.searchParams.set("redirect", "false");
        const response = await send(target, {
          signal,
          auth: miro,
          accept: "*/*",
        });
        const type = String(
          header(response, "content-type") || "",
        ).toLowerCase();
        // Only Miro's API answers with the file's address; JSON from the
        // file host is the document itself.
        if (miro && type.includes("json")) {
          const body = await response.json();
          if (!body?.url)
            throw new MiroError("missing resource URL", { code: "url" });
          target = new URL(body.url, target);
          continue;
        }
        if (Number(header(response, "content-length")) > maxBytes)
          throw new MiroError("file too large", { code: "size" });
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > maxBytes)
          throw new MiroError("file too large", { code: "size" });
        return { bytes, contentType: type };
      }
      throw new MiroError("too many redirects", { code: "url" });
    },
    // Prefers the original image and falls back to Miro's preview rendition
    // when the original cannot be used: too large, or, as `accept` decides,
    // in a format or size the app does not take. `accept` returns what the
    // caller keeps from a download, or throws.
    async downloadImage(
      url,
      { signal, maxBytes = 5 * 1024 * 1024, accept = (value) => value } = {},
    ) {
      const original = new URL(url, baseURL),
        preview = original.searchParams.get("format") === "preview";
      if (preview) original.searchParams.set("format", "original");
      try {
        return accept(
          await client.downloadResource(original.href, { signal, maxBytes }),
        );
      } catch (error) {
        if (!preview || signal?.aborted) throw error;
        return accept(await client.downloadResource(url, { signal, maxBytes }));
      }
    },
    // Everything the converter needs for one board.
    async fetchBoardContent(id, { signal, onProgress } = {}) {
      const details = await client.getBoard(id, { signal });
      onProgress?.({ stage: "items", loaded: 0 });
      const items = await client.listItems(id, {
        signal,
        onPage: ({ loaded, total }) =>
          onProgress?.({ stage: "items", loaded, total }),
      });
      onProgress?.({ stage: "connectors", loaded: 0 });
      const connectors = await client.listConnectors(id, { signal });
      const tags = await client.listTags(id, { signal });
      // What Miro does not list is named in `unavailable`, so the report
      // can say what was not copied instead of losing it quietly.
      const unavailable = [];
      const read = async (name, fn) => {
        const result = await partial(fn);
        if (!result.available) unavailable.push(name);
        return result.data;
      };
      onProgress?.({ stage: "tags", loaded: 0 });
      const taggedItems = {};
      for (const tag of tags) {
        if (tag?.id == null) continue;
        const tagged = await read("tags", () =>
          client.listTaggedItems(id, tag.id, { signal }),
        );
        taggedItems[tag.id] = tagged.map((i) => i?.id).filter((i) => i != null);
      }
      onProgress?.({ stage: "groups", loaded: 0 });
      const groups = await read("groups", () =>
        client.listGroups(id, { signal }),
      );
      onProgress?.({ stage: "mindmaps", loaded: 0 });
      const mindmapNodes = await read("mindmaps", () =>
        client.listMindmapNodes(id, { signal }),
      );
      return {
        board: details,
        items,
        connectors,
        tags,
        taggedItems,
        groups,
        mindmapNodes,
        unavailable: [...new Set(unavailable)],
      };
    },
  };
  return client;
}
