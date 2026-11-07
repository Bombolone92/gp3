import { board as newBoard, uid } from "../model.js";
import { createMiroMigration } from "./migration-ui.js";
import { SharedDocument } from "../collaboration/document.js";
import { CollaborationSession } from "../collaboration/session.js";
import { call } from "../collaboration/api.js";
import { encode } from "../collaboration/protocol.js";

const LOG = "whiteboard/migration/miro-log.json";
// The session that creates a shared board keeps its media in memory while
// uploading. Nothing is stored on this device, where the images and files
// of every migrated board would otherwise stay.
const NO_STORE = {
  collaborationRows: async () => [],
  collaborationPut: async () => {},
  collaborationDelete: async () => {},
};

// Connects the Miro migration dialog to this app: organization
// administrators migrate into shared boards on the organization's worker
// (keeping each board's owner and member roles by email), everyone else into
// boards on this device. The migration log is a file in the person's Puter
// drive.
export function createMigrationHost({
  org,
  puter,
  modal,
  toast,
  download,
  addLocalBoard,
  removeLocalBoard,
  device = () => "",
}) {
  async function sharedBoard(value, server, user, room) {
    const staging = new CollaborationSession({
      puter: puter(),
      server,
      room,
      user,
      store: NO_STORE,
      changed() {},
      activity() {},
      status() {},
    });
    const seed = new SharedDocument();
    try {
      const prepared = await staging.prepare(value);
      seed.commit(prepared);
      await staging.request("create", {
        update: encode(seed.update()),
        source: "miro",
      });
      await staging.uploadAssets();
    } finally {
      seed.destroy();
      staging.shared.destroy();
    }
  }
  return createMiroMigration({
    // Templates go to the organization library, which needs a member.
    canTemplate: () => org.isMember,
    modal,
    toast,
    download: (name, text, type) => download(text, name, type),
    fetch: (url, init) =>
      puter().net?.fetch ? puter().net.fetch(url, init) : fetch(url, init),
    async createBoard(
      value,
      { ownerEmail, members = [], source, asTemplate } = {},
    ) {
      const target = { ...newBoard(value.title), ...value, id: uid() };
      if (asTemplate && !org.isMember)
        throw Error("Templates are saved to an organization library.");
      if (asTemplate) {
        const { item } = await org.request("library.submit", {
          name: target.title,
          description: source?.viewLink || "",
          category: "Migrated from Miro",
          board: JSON.stringify(target),
        });
        return { id: "library:" + item.id };
      }
      // Applying owners and roles to a shared board is an administrator task.
      if (org.server && org.isAdmin) {
        const people = members.map((m) => ({
          email: m.role === "owner" ? m.email || ownerEmail : m.email,
          name: m.name,
          role: m.role,
          guest: !!m.guest,
        }));
        if (ownerEmail && !people.some((m) => m.role === "owner"))
          people.push({ email: ownerEmail, role: "owner", guest: false });
        const user = await puter().auth.getUser();
        const room = uid();
        try {
          await sharedBoard(target, org.server, user, room);
          await org.request("migration.apply", {
            room,
            members: people,
            source,
          });
        } catch (error) {
          // A board the log cannot record must not stay behind.
          await call(puter(), org.server, { op: "delete", room }).catch(
            () => {},
          );
          throw error;
        }
        return { id: "room:" + room };
      }
      await addLocalBoard(target);
      // Boards on this device can only be rolled back here.
      return { id: `local:${device()}:${target.id}` };
    },
    async deleteBoard(id) {
      const [kind, value] = [
        id.slice(0, id.indexOf(":")),
        id.slice(id.indexOf(":") + 1),
      ];
      // A board or template someone already removed counts as removed.
      const gone = (error) => {
        if (error?.status !== 404) throw error;
      };
      if (kind === "library")
        return org.request("library.remove", { id: value }).catch(gone);
      if (kind === "room")
        return call(puter(), org.server, { op: "delete", room: value }).catch(
          gone,
        );
      const [owner, board] = value.includes(":")
        ? value.split(":")
        : [null, value];
      if (owner !== null && owner !== device())
        throw Error(
          "This board was migrated to another device. Roll it back on that device.",
        );
      return removeLocalBoard(board);
    },
    async saveLog(json) {
      await puter().fs.write(LOG, json, {
        overwrite: true,
        createMissingParents: true,
        dedupeName: false,
      });
    },
    // No log yet is a fresh start; any other failure must not be mistaken
    // for one, or saving would replace the earlier log.
    async loadLog() {
      try {
        return await (await puter().fs.read(LOG)).text();
      } catch (error) {
        if (
          ["subject_does_not_exist", "ENOENT", "not_found"].includes(
            error?.code,
          )
        )
          return null;
        throw error;
      }
    },
  });
}
