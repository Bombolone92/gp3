// Static preview card for embeds. The canvas, SVG, and vector PDF renderers
// share this layout so exports match the board. Live iframes are a separate
// DOM overlay and never appear in exports.
import { cachedWrapText } from "../text.js";
import { fontStack } from "../fonts.js";
import { t } from "../i18n.js";
import { EMBED_PROVIDERS, providerName as name } from "./providers.js";

const providerName = (provider) => t(name(provider));

const FAMILY = "dm-sans";
const style = (size, weight, color) => ({
  font: `${weight} ${size}px ${fontStack(FAMILY)}`,
  family: FAMILY,
  size,
  bold: weight >= 600,
  italic: false,
  color,
});
const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

// Local coordinates relative to the card's top-left corner; text y values
// are line tops (textBaseline "top").
export function embedCardLayout(i, ctx) {
  const w = Math.abs(i.w),
    h = Math.abs(i.h),
    info = EMBED_PROVIDERS[i.provider] || EMBED_PROVIDERS.web;
  const pad = 16,
    badgeSize = Math.max(0, Math.min(44, h - pad * 2, w - pad * 2));
  const textX = pad + badgeSize + 12,
    textWidth = Math.max(20, w - textX - pad);
  const title = style(18, 600, "#30342f"),
    meta = style(13, 400, "#52624b"),
    small = style(12, 400, "#687169");
  ctx.font = title.font;
  const lines = cachedWrapText(
    ctx,
    i.text || providerName(i.provider),
    textWidth,
  )
    .slice(0, Math.max(1, Math.floor((h - 70) / 24)))
    .map((text, n) => ({ text, x: textX, y: pad + n * 24, style: title }));
  const texts = [...lines];
  const below = pad + lines.length * 24 + 4;
  if (below + 18 <= h - pad)
    texts.push({
      text: providerName(i.provider),
      x: textX,
      y: below,
      style: meta,
    });
  // The address sits on the bottom edge, like link cards.
  if (h >= 90) {
    ctx.font = small.font;
    let text = host(i.url);
    while (text.length > 4 && ctx.measureText(text).width > w - pad * 2)
      text = text.slice(0, -2);
    texts.push({ text, x: pad, y: h - pad - 14, style: small });
  }
  let badge = null;
  if (badgeSize) {
    const label = style(
      Math.round(badgeSize * 0.4),
      600,
      info.dark ? "#30342f" : "#ffffff",
    );
    ctx.font = label.font;
    const width = ctx.measureText(info.badge).width;
    badge = {
      x: pad,
      y: pad,
      size: badgeSize,
      radius: 8,
      fill: info.color,
      label: {
        text: info.badge,
        x: pad + (badgeSize - width) / 2,
        y: pad + (badgeSize - label.size) / 2,
        style: label,
      },
    };
  }
  return {
    w,
    h,
    radius: 8,
    fill: i.color || "#ffffff",
    stroke: "#92998d",
    clip: { x: 4, y: 4, w: Math.max(0, w - 8), h: Math.max(0, h - 8) },
    badge,
    texts,
  };
}

export function drawEmbedCard(ctx, i) {
  const card = embedCardLayout(i, ctx);
  ctx.fillStyle = card.fill;
  ctx.beginPath();
  ctx.roundRect(0, 0, card.w, card.h, card.radius);
  ctx.fill();
  ctx.strokeStyle = card.stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.rect(card.clip.x, card.clip.y, card.clip.w, card.clip.h);
  ctx.clip();
  ctx.textBaseline = "top";
  if (card.badge) {
    const b = card.badge;
    ctx.fillStyle = b.fill;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.size, b.size, b.radius);
    ctx.fill();
  }
  for (const line of [card.badge?.label, ...card.texts].filter(Boolean)) {
    ctx.font = line.style.font;
    ctx.fillStyle = line.style.color;
    ctx.fillText(line.text, line.x, line.y);
  }
  ctx.restore();
}
