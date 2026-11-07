import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  recentFiles,
  rememberRecent,
  forgetRecent,
  moveRecent,
  refreshRecent,
} from "../src/recent.js";

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("presentations opened from elsewhere on the drive", () => {
  it("are kept per account, newest first, without the app's own folder or the trash", () => {
    rememberRecent("a", { path: "/a/Desktop/One.pptx", uid: "1" });
    rememberRecent("a", { path: "/a/Docs/Two.pptx", uid: "2" });
    rememberRecent("a", { path: "/a/AppData/x/Presentations/Three.pptx" });
    rememberRecent("a", { path: "/a/Trash/4" });
    rememberRecent("b", { path: "/b/Desktop/Other.pptx" });
    expect(recentFiles("a").map((r) => r.name)).toEqual([
      "Two.pptx",
      "One.pptx",
    ]);
    // Opening one again moves it to the front, once.
    rememberRecent("a", { path: "/a/Desktop/One.pptx", uid: "1" });
    expect(recentFiles("a").map((r) => r.name)).toEqual([
      "One.pptx",
      "Two.pptx",
    ]);
    forgetRecent("a", "/a/Desktop/One.pptx");
    expect(recentFiles("a").map((r) => r.name)).toEqual(["Two.pptx"]);
    expect(recentFiles("b")).toHaveLength(1);
  });
  it("follow a rename made here", () => {
    rememberRecent("a", { path: "/a/Desktop/One.pptx", uid: "1" });
    moveRecent("a", "/a/Desktop/One.pptx", "/a/Desktop/Uno.pptx", "Uno.pptx");
    expect(recentFiles("a")).toMatchObject([
      { path: "/a/Desktop/Uno.pptx", name: "Uno.pptx", uid: "1" },
    ]);
  });
  it("follow their files by id, and drop the ones that are gone", async () => {
    rememberRecent("a", { path: "/a/Desktop/Moved.pptx", uid: "moved" });
    rememberRecent("a", { path: "/a/Desktop/Deleted.pptx", uid: "deleted" });
    rememberRecent("a", { path: "/a/Desktop/Trashed.pptx", uid: "trashed" });
    rememberRecent("a", { path: "/a/Desktop/Unknown.pptx", uid: "flaky" });
    const stat = vi.fn(async ({ uid }) => {
      if (uid === "moved")
        return { path: "/a/Docs/Moved.pptx", name: "Moved.pptx", modified: 5 };
      if (uid === "trashed") return { path: "/a/Trash/trashed" };
      if (uid === "flaky") throw new Error("Network error");
      throw { code: "subject_does_not_exist" };
    });
    vi.stubGlobal("puter", { fs: { stat } });
    expect(await refreshRecent("a")).toMatchObject([
      { path: "/a/Desktop/Unknown.pptx" },
      { path: "/a/Docs/Moved.pptx", modified: 5 },
    ]);
  });
  it("are left as they are where files cannot be looked up", async () => {
    rememberRecent("a", { path: "/a/Desktop/One.pptx", uid: "1" });
    vi.stubGlobal("puter", { fs: {} });
    expect(await refreshRecent("a")).toHaveLength(1);
  });
});
