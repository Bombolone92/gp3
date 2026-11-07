// Presentations opened from elsewhere on the Puter drive (a double-click on
// the desktop, "Open with", the Open dialog) are remembered on this device,
// per account, so the library can list them beside the Presentations folder.
// Each record keeps the file's id as well as its address: a file keeps its id
// when it is moved or renamed, so the record can follow it there.
import {
  canStat,
  statByUid,
  inAppFolder,
  inTrash,
  isPptxName,
} from "./cloud.js";

const KEY = "presentation:recent:";
const LIMIT = 8;
const storage = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};
function read(owner) {
  try {
    const list = JSON.parse(storage()?.getItem(KEY + owner) || "[]");
    return Array.isArray(list)
      ? list.filter((r) => r && typeof r.path === "string")
      : [];
  } catch {
    return [];
  }
}
function write(owner, list) {
  try {
    storage()?.setItem(KEY + owner, JSON.stringify(list.slice(0, LIMIT)));
  } catch {}
}
// Files in the app folder are listed from the folder itself.
export function recentFiles(owner) {
  return read(owner).filter((r) => !inAppFolder(r.path));
}
export function rememberRecent(owner, { path, name, uid = null }) {
  if (!path || inAppFolder(path) || inTrash(path)) return;
  const list = read(owner).filter(
    (r) => r.path !== path && !(uid && r.uid === uid),
  );
  list.unshift({
    path,
    name: name || path.split("/").pop(),
    uid,
    at: Date.now(),
  });
  write(owner, list);
}
export function forgetRecent(owner, path) {
  write(
    owner,
    read(owner).filter((r) => r.path !== path),
  );
}
// The file was renamed or moved; its record follows it.
export function moveRecent(owner, from, to, name) {
  const list = read(owner);
  const record = list.find((r) => r.path === from);
  if (!record) return;
  if (inAppFolder(to) || inTrash(to)) {
    write(
      owner,
      list.filter((r) => r !== record),
    );
    return;
  }
  Object.assign(record, { path: to, name: name || to.split("/").pop() });
  write(owner, list);
}
// Each record is looked up by its file's id: one moved or renamed elsewhere
// follows the file, and one whose file is gone (deleted, in the trash, or no
// longer a presentation) is dropped. A lookup that fails says nothing about
// the file, so its record stays.
export async function refreshRecent(owner) {
  if (!canStat()) return recentFiles(owner);
  const list = read(owner);
  const listed = new Set(list.map((r) => r.path));
  const looked = await Promise.all(
    list.map((record) =>
      record.uid
        ? statByUid(record.uid).then(
            (found) => ({ record, found }),
            () => ({ record, found: undefined }),
          )
        : { record, found: undefined },
    ),
  );
  let changed = false;
  const kept = [];
  for (const { record, found } of looked) {
    if (found === undefined) {
      kept.push(record);
      continue;
    }
    if (
      !found?.path ||
      inTrash(found.path) ||
      !isPptxName(found.path) ||
      found.is_dir
    ) {
      changed = true;
      continue;
    }
    if (found.path !== record.path) {
      changed = true;
      record.path = found.path;
      record.name = found.name || found.path.split("/").pop();
    }
    if (found.modified != null && found.modified !== record.modified) {
      changed = true;
      record.modified = found.modified;
    }
    kept.push(record);
  }
  // Files opened while this looked up are kept ahead of what it learned.
  if (changed) {
    const opened = read(owner).filter((r) => !listed.has(r.path));
    write(owner, [...opened, ...kept]);
  }
  return recentFiles(owner);
}
