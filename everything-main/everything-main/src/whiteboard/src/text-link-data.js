// Inline links share the board's web-only URL policy. Keep this module free of
// model/render imports so validation and clipboard parsing can use it safely.
export function textLinkURL(value, allowBare = false) {
  if (typeof value !== "string") return null;
  value = value.trim();
  if (!value || value.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(value))
    return null;
  // A host with a port, such as localhost:5173, has no scheme yet.
  if (allowBare && !/^[a-z][a-z\d+.-]*:(?!\d)/i.test(value))
    value = `https://${value}`;
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      url.hostname &&
      url.href.length <= 2048
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function textLinks(text = "", runs = []) {
  const links = [];
  for (const run of runs) {
    const url = textLinkURL(run.style.link);
    if (!url) continue;
    const previous = links.at(-1);
    if (previous?.end === run.start && previous.url === url) {
      previous.end = run.end;
      previous.text += text.slice(run.start, run.end);
    } else
      links.push({
        start: run.start,
        end: run.end,
        url,
        text: text.slice(run.start, run.end),
      });
  }
  return links;
}
export function textLinkRange(text, runs, start, end = start) {
  const links = textLinks(text, runs);
  if (start === end) {
    const link =
      links.find((l) => l.start <= start && l.end > start) ||
      links.find(
        (l) => l.end === start && !/[\n\u2028]/.test(text[start - 1] || ""),
      );
    return link ? { ...link } : { start, end, url: "" };
  }
  const containing = links.find((l) => l.start <= start && l.end >= end);
  return { start, end, url: containing?.url || "" };
}
const lightColor = (color) => {
  const rgb = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  return (
    rgb &&
    Number.parseInt(rgb[1], 16) * 0.2126 +
      Number.parseInt(rgb[2], 16) * 0.7152 +
      Number.parseInt(rgb[3], 16) * 0.0722 >
      160
  );
};
export function linkColor(defaultColor = "#30342f") {
  return lightColor(defaultColor) ? "#8ab4f8" : "#155db1";
}
// The ink for text in the theme's colour over a highlight: a light highlight
// takes dark ink whatever the theme, as the dark theme's light ink would
// vanish on it, and a dark highlight takes light ink.
export function inkOn(highlight, defaultColor = "#30342f") {
  if (!highlight) return defaultColor;
  return lightColor(highlight) ? "#30342f" : "#f4f7fb";
}
// The colour of text in `style` over a highlight. Text or a link in the
// theme's colour takes the ink the highlight's own lightness asks for;
// a colour chosen for the text is kept.
export function inkOver(highlight, style, defaultColor = "#30342f") {
  if (!highlight || !(style.autoColor || style.autoLinkColor))
    return style.color;
  return style.autoLinkColor
    ? linkColor(inkOn(highlight, defaultColor))
    : inkOn(highlight, defaultColor);
}
