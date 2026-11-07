// Files a script may open by name, as bpy.data.images.load(filepath) does on
// a desktop: scripts have no file system in the browser, so whoever holds a
// file (the AI assistant, for the images the user attached to the chat)
// offers it here first. Names are matched without regard to case or folder.

export interface ScriptFile {
  name: string;
  /** Encoded bytes (PNG, JPEG, WebP, GIF). */
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

const files = new Map<string, ScriptFile>();

const key = (path: string) => String(path ?? '').replace(/^.*[\\/]/, '').trim().toLowerCase();

/** Offers a file to scripts under its name, replacing one of the same name. */
export function offerScriptFile(f: ScriptFile) {
  files.set(key(f.name), f);
}

/** The offered file named by `path` (its last part), or null. */
export function scriptFile(path: string): ScriptFile | null {
  return files.get(key(path)) ?? null;
}

export const scriptFileNames = () => [...files.values()].map((f) => f.name);

export function clearScriptFiles() {
  files.clear();
}
