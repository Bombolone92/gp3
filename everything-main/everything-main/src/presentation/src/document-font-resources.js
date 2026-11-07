import { getEmbeddedFonts, _internalPackageOf } from "../lib/pptx/src/index.ts";
import {
  readEotFont,
  readOpenTypeFont,
  unmaskEotFontData,
  decodeMtxFont,
} from "../lib/pptx/src/internal/fonts/index.ts";
import {
  relsPartNameFor,
  resolveTarget,
} from "../lib/pptx/src/internal/opc/index.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";

const states = new WeakMap(),
  aliases = new Map();
let nextAlias = 0;
const key = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
const styles = {
  regular: { style: "normal", weight: "400" },
  bold: { style: "normal", weight: "700" },
  italic: { style: "italic", weight: "400" },
  boldItalic: { style: "italic", weight: "700" },
};
const bytesEqual = (a, b) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const base64 = (bytes) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
function retain(group) {
  group.users++;
  return group;
}
function release(group) {
  if (--group.users) return;
  if (group.installed)
    for (const item of group.faces) document.fonts.delete(item.face);
  aliases.delete(key(group.alias));
  group.faces = [];
  group.input = null;
}
function snapshot(pres, names = new Set()) {
  const pkg = _internalPackageOf(pres);
  const rel = pkg
    .rootRels()
    ?.items.find(
      (r) => r.type === REL_TYPES.officeDocument && r.targetMode === "Internal",
    );
  const main = rel && resolveTarget("/", rel.target);
  const important = new Set(
    [...names, relsPartNameFor("/"), main, main && relsPartNameFor(main)]
      .filter(Boolean)
      .map(key),
  );
  return pkg.parts
    .filter(
      (p) =>
        important.has(key(p.name)) ||
        p.contentType === "application/x-fontdata" ||
        p.contentType === "application/x-font-ttf",
    )
    .map((p) => [p.name, p.contentType, p.data]);
}
const sameSnapshot = (a, b) =>
  a?.length === b.length &&
  b.every(
    ([name, type, data], i) =>
      a[i][0] === name && a[i][1] === type && a[i][2] === data,
  );
const sameFamily = (a, b) =>
  a.typeface === b.typeface &&
  a.panose === b.panose &&
  a.pitchFamily === b.pitchFamily &&
  a.charset === b.charset &&
  Object.keys(a.faces).length === Object.keys(b.faces).length &&
  Object.entries(a.faces).every(
    ([style, face]) =>
      b.faces[style]?.contentType === face.contentType &&
      bytesEqual(b.faces[style].data, face.data),
  );

async function family(row, state) {
  const faces = [];
  let readOnly = false;
  for (const [slot, input] of Object.entries(row.faces)) {
    let bytes, header;
    if (input.contentType === "application/x-fontdata") {
      header = readEotFont(input.data);
      if (!header.permissions.canEdit) state.readOnly = readOnly = true;
      if (!header.permissions.canEmbed)
        throw Error("The embedded font does not permit embedding.");
      if (header.eudc)
        throw Error(
          "Embedded private-character font decoding is not yet supported.",
        );
      if (header.font.subset && header.permissions.noSubsetting)
        throw Error("This font does not permit its embedded subset.");
      bytes = unmaskEotFontData(header.font);
      if (header.font.compressed) bytes = decodeMtxFont(bytes);
    } else if (input.contentType === "application/x-font-ttf")
      bytes = input.data;
    else throw Error("Unsupported embedded font format.");
    const info = readOpenTypeFont(bytes);
    if (!info.permissions.canEdit) state.readOnly = readOnly = true;
    if (!info.permissions.canEmbed)
      throw Error("The embedded font does not permit embedding.");
    if (info.permissions.bitmapOnly && info.hasOutlines)
      throw Error("This font permits bitmap embedding only.");
    const descriptors = {
      ...styles[slot],
      featureSettings:
        !info.variable && !info.legacyKerning ? '"kern" 0' : "normal",
    };
    faces.push({ bytes, info, ...descriptors, face: null, data: null });
  }
  if (!faces.length) throw Error("The embedded font has no available face.");
  const alias =
    `Presentation document font ${++nextAlias} ${globalThis.crypto?.randomUUID?.() ?? ""}`.trim();
  // All declared faces must load before any is published. Independent families
  // may still load when another family is damaged or has an unsupported codec.
  await Promise.all(
    faces.map(async (item) => {
      const { style, weight, featureSettings } = item;
      item.face = await new FontFace(alias, item.bytes, {
        style,
        weight,
        featureSettings,
      }).load();
      item.data = base64(item.bytes);
      delete item.bytes;
    }),
  );
  return { input: row, alias, faces, users: 0, installed: false, readOnly };
}

/** Load only this document's embedded data; never publish authored names globally.
 * reuseFrom is for snapshots of the same open document, not unrelated documents.
 */
export function prepareDocumentFonts(pres, { reuseFrom = null } = {}) {
  if (!globalThis.document?.fonts || typeof globalThis.FontFace !== "function")
    return Promise.resolve(false);
  let state = states.get(pres);
  if (state?.closed) return Promise.resolve(false);
  if (state?.job) return state.job;
  if (state && sameSnapshot(state.snapshot, snapshot(pres, state.names)))
    return Promise.resolve(false);
  state ??= {
    families: new Map(),
    declared: new Set(),
    errors: [],
    readOnly: false,
    names: new Set(),
    closed: false,
    leases: 0,
  };
  states.set(pres, state);
  // One promise includes retries: concurrent callers cannot observe a stale
  // load finishing while the replacement font is still being prepared.
  state.job = (async () => {
    let changed = false;
    while (!state.closed) {
      const previous = state.families,
        reusable = states.get(reuseFrom)?.families ?? previous;
      const attempt = { readOnly: false },
        errors = [],
        declared = new Set();
      let rows = [];
      try {
        rows = getEmbeddedFonts(pres, {
          onError: (error, name) => {
            if (name) declared.add(key(name));
            errors.push({ family: name, message: error.message });
          },
        });
      } catch (error) {
        errors.push({ family: null, message: error.message });
      }
      for (const row of rows) declared.add(key(row.typeface));
      const counts = new Map();
      for (const row of rows)
        counts.set(key(row.typeface), (counts.get(key(row.typeface)) ?? 0) + 1);
      rows = rows.filter((row) => {
        if (counts.get(key(row.typeface)) === 1) return true;
        errors.push({
          family: row.typeface,
          message: "Ambiguous embedded font family names.",
        });
        return false;
      });
      const names = new Set(
        rows.flatMap((row) =>
          Object.values(row.faces).map((face) => face.partName),
        ),
      );
      const revision = snapshot(pres, names);
      const loaded = await Promise.all(
        rows.map(async (row) => {
          const old = reusable.get(key(row.typeface));
          // Pin shared resources before the first await. Closing the old
          // snapshot while another family loads must not invalidate this one.
          if (old?.input && sameFamily(old.input, row)) return retain(old);
          try {
            return retain(await family(row, attempt));
          } catch (error) {
            errors.push({ family: row.typeface, message: error.message });
            return null;
          }
        }),
      );
      const groups = loaded.filter(Boolean);
      if (state.closed || !sameSnapshot(revision, snapshot(pres, names))) {
        for (const group of groups) release(group);
        if (state.closed) return changed;
        continue;
      }
      const next = new Map();
      for (const group of groups) {
        if (!group.installed) {
          for (const item of group.faces) document.fonts.add(item.face);
          aliases.set(key(group.alias), group);
          group.installed = true;
        }
        next.set(key(group.input.typeface), group);
        attempt.readOnly ||= group.readOnly;
      }
      changed ||=
        next.size !== previous.size ||
        [...next].some(([name, group]) => previous.get(name) !== group);
      for (const group of previous.values()) release(group);
      Object.assign(state, {
        families: next,
        snapshot: revision,
        names,
        declared,
        errors,
        readOnly: attempt.readOnly,
      });
      return changed;
    }
    return changed;
  })().finally(() => {
    state.job = null;
  });
  return state.job;
}
function clearOwnedFonts(state) {
  for (const group of state.families.values()) release(group);
  state.families.clear();
  state.declared.clear();
  state.errors = [];
  state.names.clear();
  state.snapshot = null;
}
/** A slideshow may outlive the editor document it captured. */
export function retainDocumentFonts(pres) {
  const state = states.get(pres);
  if (!state || state.closed) return () => {};
  state.leases++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (!--state.leases && state.closed) clearOwnedFonts(state);
  };
}
export function disposeDocumentFonts(pres) {
  const state = states.get(pres);
  if (!state || state.closed) return;
  state.closed = true;
  if (!state.leases) clearOwnedFonts(state);
}
export const documentFontStatus = (pres) => {
  const state = states.get(pres);
  return state?.closed
    ? { readOnly: false, errors: [] }
    : { readOnly: !!state?.readOnly, errors: state?.errors ?? [] };
};
export const documentFontStamp = (pres) =>
  [...(states.get(pres)?.families.values() ?? [])]
    .map((group) => group.alias)
    .sort()
    .join("|");
export const hasDocumentFonts = (pres) => !!states.get(pres)?.families.size;
export const declaresDocumentFont = (pres, name) =>
  !!states.get(pres)?.declared.has(key(name));
export const documentFontAlias = (pres, name) =>
  states.get(pres)?.families.get(key(name))?.alias ?? null;
export const documentFontDescriptor = (pres, name) => {
  const group = states.get(pres)?.families.get(key(name));
  if (!group) return null;
  return {
    panose:
      group.input.panose ??
      [...group.faces[0].info.panose]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join(""),
    pitchFamily: group.input.pitchFamily,
  };
};
function resourceForCss(pres, family) {
  const value = key(family);
  for (const group of states.get(pres)?.families.values() ?? [])
    if (
      value === key(group.alias) ||
      value === key(group.input.typeface) ||
      value.startsWith(`${JSON.stringify(group.alias).toLowerCase()},`)
    )
      return group;
  return null;
}
export const documentFontFamilyForCss = (pres, family) =>
  resourceForCss(pres, family)?.input.typeface ?? null;
// FontFaceSet matches the requested style first, then the available weight.
// Native embedded slots have only 400/700 and normal/italic descriptors. The
// matching face can be synthesized by the browser when a slot is absent;
// standalone SVGs must carry that face too, and use its kerning capabilities.
function matchingFace(group, style, weight) {
  if (!group) return null;
  const sameStyle = group.faces.filter((face) => face.style === style);
  const candidates = sameStyle.length ? sameStyle : group.faces;
  return (
    candidates.find((face) => face.weight === weight) ?? candidates[0] ?? null
  );
}
export function documentFontStyles(used, pres) {
  const grouped = new Map(),
    rules = [];
  for (const [name, styles] of used) {
    const group = resourceForCss(pres, name);
    if (!group) continue;
    let included = grouped.get(group);
    if (!included) grouped.set(group, (included = new Set()));
    for (const style of styles) included.add(style);
  }
  for (const [group, styles] of grouped) {
    const included = new Set();
    for (const style of styles) {
      if (style.includes("/")) {
        const [kind, weight] = style.split("/");
        const face = matchingFace(group, kind, weight);
        if (face) included.add(face);
      } else if (![...styles].some((value) => value.startsWith(`${style}/`))) {
        for (const weight of ["400", "700"]) {
          const face = matchingFace(group, style, weight);
          if (face) included.add(face);
        }
      }
    }
    for (const face of included)
      rules.push(
        `@font-face{font-family:${JSON.stringify(group.alias)};font-style:${face.style};font-weight:${face.weight};font-feature-settings:${face.featureSettings};src:url(data:${face.info.format === "opentype" ? "font/otf" : "font/ttf"};base64,${face.data}) format("${face.info.format === "opentype" ? "opentype" : "truetype"}")}`,
      );
  }
  return rules.join("");
}
export function documentFontKerning(spec) {
  const value = key(spec.family);
  const alias = [...aliases.keys()].find(
    (name) => value === name || value.startsWith(`${JSON.stringify(name)},`),
  );
  const face = matchingFace(
    aliases.get(alias),
    spec.italic ? "italic" : "normal",
    spec.bold ? "700" : "400",
  );
  return face?.featureSettings === '\"kern\" 0' ? "none" : undefined;
}
