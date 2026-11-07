import { workerURL } from "../collaboration/protocol.js";

// The organization a signed-in person works in is one collaboration worker.
// Its address comes from an organization link, the hosting site's
// configuration, or a previous visit, and is remembered in private app KV.
export const ORG_KEY = "whiteboard-organization-v1";
// Board filters take a plain date from a date field and mean the start of
// that day where the person is, as the dates the app shows.
export const boardFilters = (filters) =>
  filters.updatedAfter
    ? {
        ...filters,
        updatedAfter: new Date(
          `${filters.updatedAfter}T00:00:00`,
        ).toISOString(),
      }
    : filters;
export function readOrganizationLink(href) {
  try {
    const url = new URL(href);
    const params = new URLSearchParams(url.hash.slice(1));
    const server = params.get("org");
    if (!server) return null;
    return {
      server: workerURL(server),
      token: params.get("orgInvite") || undefined,
    };
  } catch {
    return null;
  }
}
export function organizationLink(server, token, base = location.href) {
  const url = new URL(base);
  url.search = "";
  url.hash = new URLSearchParams({
    org: workerURL(server),
    ...(token ? { orgInvite: token } : {}),
  }).toString();
  return url.href;
}
export function createOrganization({
  puter,
  call,
  deploy,
  fetcher = (...args) => fetch(...args),
}) {
  let server = null,
    info = null,
    siteConfig;
  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => fn(info));
  async function site() {
    if (siteConfig !== undefined) return siteConfig;
    try {
      const res = await fetcher("/organization.json", { cache: "no-cache" });
      siteConfig = res.ok ? await res.json() : null;
      if (siteConfig?.server) siteConfig.server = workerURL(siteConfig.server);
    } catch {
      siteConfig = null;
    }
    return siteConfig;
  }
  const api = {
    get server() {
      return server;
    },
    get info() {
      return info;
    },
    get isAdmin() {
      return info?.role === "owner" || info?.role === "admin";
    },
    get isMember() {
      return !!info?.role && info.role !== "guest";
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // Discover the organization without prompting anyone to sign in.
    async discover(href = location.href) {
      const link = readOrganizationLink(href);
      if (link) return link;
      const saved = puter().auth?.isSignedIn?.()
        ? await puter()
            .kv.get(ORG_KEY)
            .catch(() => null)
        : null;
      if (saved?.server) return { server: workerURL(saved.server) };
      const config = await site();
      return config?.server ? { server: config.server, site: true } : null;
    },
    // Switch only once the new organization answers, so a bad link keeps
    // the current organization in use and remembered.
    // What an organization link points to, without switching to it.
    async preview(address) {
      const next = workerURL(address);
      return {
        server: next,
        info: await call(puter(), next, { op: "org.info" }),
      };
    },
    async use(address) {
      const next = workerURL(address);
      const nextInfo = await call(puter(), next, { op: "org.info" });
      server = next;
      info = nextInfo;
      await puter().kv.set(ORG_KEY, { server });
      changed();
      return info;
    },
    // Forgets the organization on this page after signing out, leaving the
    // account's saved choice for its next sign-in.
    reset() {
      server = null;
      info = null;
      changed();
    },
    // Goes back to the organization in use before, as when joining a new
    // one with an invitation fails.
    async restore(previous) {
      server = previous?.server || null;
      info = previous?.info || null;
      if (server) await puter().kv.set(ORG_KEY, { server });
      else
        await puter()
          .kv.del?.(ORG_KEY)
          ?.catch?.(() => {});
      changed();
    },
    async request(op, data = {}) {
      if (!server) throw Error("Join an organization first.");
      return call(puter(), server, { op, ...data });
    },
    async refresh() {
      if (!server) return null;
      info = await api.request("org.info");
      changed();
      return info;
    },
    async setup(name, domains = [], progress = () => {}) {
      // Switch only once the new organization is set up, so a refused name
      // or domain keeps the current organization in use and remembered.
      const next = workerURL(await deploy(puter(), progress));
      const nextInfo = await call(puter(), next, {
        op: "org.setup",
        name,
        domains,
      });
      server = next;
      info = nextInfo;
      await puter().kv.set(ORG_KEY, { server });
      changed();
      return info;
    },
    async join(token) {
      const result = await api.request("org.join", token ? { token } : {});
      info = result.info;
      changed();
      return result;
    },
    async leave() {
      server = null;
      info = null;
      await puter()
        .kv.del?.(ORG_KEY)
        .catch?.(() => {});
      changed();
    },
    policy() {
      return info?.policy || null;
    },
    // Whether an organization feature is allowed. Outside an organization
    // every feature follows the person's own choices.
    allows(feature) {
      const policy = info?.policy;
      if (!policy) return true;
      if (feature === "ai") return policy.ai.enabled;
      if (feature.startsWith("ai."))
        return policy.ai.enabled && policy.ai[feature.slice(3)] !== false;
      return policy.integrations?.[feature]?.enabled !== false;
    },
  };
  return api;
}
