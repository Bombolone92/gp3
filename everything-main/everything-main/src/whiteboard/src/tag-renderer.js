import { graphemes } from "./text.js";
import { tagFooter, tagRow } from "./tags.js";
import { fontStack } from "./fonts.js";
import { clearTaskLayouts } from "./planning/task-renderer.js";
let layouts = new WeakMap();
const catalogs = new WeakMap();
export const clearTagLayouts = () => {
  layouts = new WeakMap();
  clearTaskLayouts();
};
export function tagCatalog(tags) {
  if (!tags?.length) return null;
  if (!catalogs.has(tags))
    catalogs.set(tags, new Map(tags.map((t) => [t.id, t])));
  return catalogs.get(tags);
}
export function tagLayout(ctx, item, tags) {
  const available = (item.tagIds || [])
    .map((id) => tags?.get(id))
    .filter(Boolean);
  const signature = [
    item.w,
    item.h,
    tagFooter(item),
    ...available.flatMap((t) => [t.id, t.name, t.color]),
  ];
  let contexts = layouts.get(item);
  const cached = contexts?.get(ctx);
  if (
    cached &&
    signature.length === cached.signature.length &&
    signature.every((v, n) => v === cached.signature[n])
  )
    return cached.result;
  const footer = tagRow(item),
    scale = Math.min(1, footer / 30, Math.abs(item.w) / 60),
    h = 20 * scale,
    pad = 6 * scale,
    font = `500 ${11 * scale}px ${fontStack("dm-sans")}`;
  ctx.font = font;
  const max = Math.max(0, Math.abs(item.w) - pad * 2),
    y = Math.abs(item.h) - tagFooter(item) + (footer - h) / 2,
    shapes = [];
  let x = pad;
  for (let n = 0; n < available.length; n++) {
    const tag = available[n],
      remaining = available.length - n - 1,
      more = remaining
        ? ctx.measureText(`+${remaining}`).width + 12 * scale
        : 0,
      room = max - (x - pad);
    let text = tag.name,
      w = Math.min(max, ctx.measureText(text).width + 14 * scale);
    if (n > 0 && w + (remaining ? more + 4 * scale : 0) > room) {
      shapes.push({
        text: `+${available.length - n}`,
        x: x + 4 * scale,
        more: true,
      });
      break;
    }
    w = Math.min(w, Math.max(0, room - (remaining ? more + 4 * scale : 0)));
    if (w < 10 * scale) break;
    if (ctx.measureText(text).width > w - 14 * scale) {
      const chars = graphemes(text);
      let lo = 0,
        hi = chars.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (
          ctx.measureText(chars.slice(0, mid).join("") + "…").width <=
          w - 14 * scale
        )
          lo = mid;
        else hi = mid - 1;
      }
      text = chars.slice(0, lo).join("") + "…";
    }
    shapes.push({ text, x, w, color: tag.color });
    x += w + 4 * scale;
  }
  const result = { font, scale, h, y, shapes };
  if (!contexts) layouts.set(item, (contexts = new WeakMap()));
  contexts.set(ctx, { signature, result });
  return result;
}
export function drawTags(ctx, item, tags) {
  if (!tagRow(item) || !tags) return;
  const { font, scale, h, y, shapes } = tagLayout(ctx, item, tags);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, Math.abs(item.w), Math.abs(item.h));
  ctx.clip();
  ctx.font = font;
  ctx.textBaseline = "middle";
  for (const s of shapes) {
    if (!s.more) {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = s.color;
      ctx.lineWidth = scale;
      ctx.beginPath();
      ctx.roundRect(s.x, y, s.w, h, 4 * scale);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "#30342f";
    ctx.fillText(s.text, s.x + (s.more ? 0 : 7 * scale), y + h / 2);
  }
  ctx.restore();
}
