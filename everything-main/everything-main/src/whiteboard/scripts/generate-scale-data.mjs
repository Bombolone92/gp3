import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { board, item, escape } from "../src/model.js";

// Offline fixtures only: no accounts, cloud requests, or production writes.
export function scaleData(size = 500) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 10000)
    throw new RangeError("Choose between 1 and 10000 users.");
  const now = Date.UTC(2026, 9, 7, 12);
  const owner = {
    uuid: "00000000-0000-4000-8000-000000000000",
    username: "Sample owner",
  };
  const users = Array.from({ length: size }, (_, n) => ({
    uuid: `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
    username: `${["Alex", "Émilie", "李明", "Samira", "O’Connor"][n % 5]} ${String(n + 1).padStart(4, "0")}`,
    email: `person-${n + 1}@example.test`,
    emailVerified: n % 17 !== 0,
    role: n % 29 === 0 ? "admin" : n % 11 === 0 ? "guest" : "member",
    status: n % 23 === 0 ? "deactivated" : n % 19 === 0 ? "pending" : "active",
    teams: [`team-${n % 20}`],
    lastActive: n % 19 === 0 ? null : now - (n % 120) * 86400000,
    license: n % 29 !== 0 && n % 11 === 0 ? "guest" : "full",
    source: n % 3 === 0 ? "scim" : "domain",
  }));
  const teams = Array.from({ length: Math.min(size, 20) }, (_, n) => ({
    id: `team-${n}`,
    name: `Sample team ${n + 1}`,
    members: users
      .filter((u) => u.teams.includes(`team-${n}`))
      .map((u) => u.uuid),
  }));
  const boards = users.flatMap((u, n) =>
    Array.from({ length: 3 }, (_, b) => ({
      room: `sample-room-${n}-${b}`,
      title: `Planning ${n + 1} · ${b + 1}`,
      owner: u.uuid,
      ownerName: u.username,
      created: now - (n + 1) * 86400000,
      lastActivity: u.lastActive,
      objectCount: b === 0 ? 0 : ((n % 50) + 1) * 10,
      visibility: ["private", "organization", "link"][b],
      guestCount: b === 2 ? 3 : 0,
      team: u.teams[0],
      types: { note: b === 0 ? 0 : ((n % 50) + 1) * 10 },
      peakParticipants: n === 1 ? 500 : n % 80,
      peakAt: now - n * 60000,
      archived: n % 13 === 0,
      legalHold: n % 41 === 0,
    })),
  );
  const activity = users.flatMap((u, n) =>
    Array.from({ length: 10 }, (_, a) => ({
      id: `${new Date(now - n * 60000 - a * 1000).toISOString()}:sample-${n}-${a}`,
      at: now - n * 60000 - a * 1000,
      time: new Date(now - n * 60000 - a * 1000).toISOString(),
      category: "content",
      board: boards[n * 3].room,
      actor: { uuid: u.uuid, username: u.username },
      action: "content.changed",
      target: {
        type: "board",
        id: boards[n * 3].room,
        name: boards[n * 3].title,
      },
      details: { added: a % 3, updated: a, removed: 0 },
    })),
  );
  const library = users.map((u, n) => ({
    id: `sample-template-${n}`,
    name: `Workshop template ${n + 1}`,
    description:
      n % 2 ? "Planifier notre prochain atelier." : "Plan the next workshop.",
    descriptionLang: n % 2 ? "fr-CA" : "en",
    category: "General",
    createdBy: u.uuid,
    createdByName: u.username,
    created: now - n * 60000,
    status: n % 10 === 0 ? "pending" : "approved",
    canRemove: true,
  }));
  const workshop = board(`${size}-person sample workshop`);
  workshop.id = "sample-workshop";
  workshop.created = workshop.updated = now;
  workshop.items = users.slice(0, 5000).flatMap((u, n) =>
    Array.from(
      { length: Math.min(10, Math.floor(5000 / Math.min(size, 5000))) },
      (_, a) =>
        item("note", (n % 25) * 2200 + a * 200, Math.floor(n / 25) * 250, {
          id: `sample-note-${n}-${a}`,
          text: `${u.username}: idea ${a + 1}`,
          createdBy: u.uuid,
        }),
    ),
  );
  return { now, owner, users, teams, boards, activity, library, workshop };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const data = scaleData(Number(process.argv[2] || 500));
  const output = resolve(process.argv[3] || "tmp/scale/organization.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(data, null, 2) + "\n");
  await writeFile(
    resolve(dirname(output), "preview.html"),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>500-user offline UI audit</title>
<style>body{overflow:auto!important;padding:20px}#scale-controls{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}#sample-canvas{display:block;width:100%;height:60vh;border:1px solid var(--line);border-radius:12px;touch-action:none}.scale-intro{max-width:70ch}.scale-intro h1{font-size:24px}.scale-intro p{margin:12px 0}</style>
</head><body data-sample="${escape(basename(output))}"><header class="scale-intro"><h1>500-user sample organization</h1><p>${data.users.length} sample members, ${data.boards.length} boards, ${data.activity.length} activity events and ${data.library.length} templates. The panels use the real UI and organization worker with an in-memory SDK. Changes reset on reload.</p><p>The canvas shows the sample workshop; directory boards open that shared sample canvas. Escape closes a panel.</p></header><nav id="scale-controls" aria-label="Sample views"></nav><p id="scale-notice" role="status"></p><h2 id="sample-board-title"></h2><canvas id="sample-canvas" aria-label="Sample workshop canvas"></canvas><script type="module" src="/scripts/scale-preview.js"></script></body></html>`,
  );
  console.log(
    `${output}: ${data.users.length} users, ${data.boards.length} boards, ${data.activity.length} events, ${data.workshop.items.length} notes`,
  );
  console.log(`Preview: ${resolve(dirname(output), "preview.html")}`);
}
