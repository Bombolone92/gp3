import { environment } from "../tests/collaboration-helpers.js";
import { adminCall } from "../worker/admin.js";
import { normalizePolicy } from "../worker/org.js";

// The real organization worker with the same in-memory Puter SDK used by
// integration tests. This fixture has no credentials or live cloud connection.
export function scaleOrganization(sample) {
  const env = environment();
  env.now = sample.now;
  const boards = env.service,
    org = boards.org,
    puter = boards.puter;
  puter.auth.getUser = async () => sample.owner;
  // Use realistic KV pages rather than the intentionally tiny test pages.
  puter.kv.list = async ({
    pattern,
    cursor,
    limit = 1000,
    returnValues,
    reverse,
  }) => {
    const keys = [...env.data.keys()]
      .filter((key) => key.startsWith(pattern.replace(/\*$/, "")))
      .sort();
    if (reverse) keys.reverse();
    const start = Number(cursor || 0),
      end = start + limit;
    return {
      items: keys
        .slice(start, end)
        .map((key) =>
          returnValues
            ? { key, value: structuredClone(env.data.get(key)) }
            : key,
        ),
      cursor: end < keys.length ? String(end) : undefined,
    };
  };
  env.data.set("org:meta", {
    policy: normalizePolicy({
      name: "Sample organization",
      domains: ["example.test"],
    }),
  });
  for (const u of sample.users)
    env.data.set("org:user:" + u.uuid, structuredClone(u));
  for (const team of sample.teams)
    env.data.set("org:team:" + team.id, structuredClone(team));
  for (const b of sample.boards)
    env.data.set("org:board:" + b.room, structuredClone(b));
  for (const event of sample.activity) {
    env.data.set("org:audit:" + event.id, structuredClone(event));
    env.data.set(`org:bact:${event.board}:${event.id}`, structuredClone(event));
  }
  for (const entry of sample.library) {
    const file = `sample-library/${entry.id}.json`;
    env.data.set("org:lib:" + entry.id, { ...structuredClone(entry), file });
    env.files.set(
      file,
      JSON.stringify({
        ...sample.workshop,
        title: entry.name,
        items: sample.workshop.items.slice(0, 10),
      }),
    );
  }
  for (let n = 0; n < 180; n++) {
    const day = new Date(sample.now - n * 86400000).toISOString().slice(0, 10);
    env.data.set(
      "org:daycount:" + day,
      Math.min(sample.users.length, 80 + (n % 400)),
    );
    env.data.set("org:peak:" + day, n === 0 ? 500 : 30 + (n % 120));
    env.data.set("org:time:" + day, (80 + (n % 120)) * 3600);
  }
  return {
    env,
    isAdmin: true,
    info: { role: "owner" },
    server: "https://sample.puter.work",
    async request(op, input = {}) {
      return adminCall(org, boards, sample.owner, { ...input, op });
    },
  };
}
