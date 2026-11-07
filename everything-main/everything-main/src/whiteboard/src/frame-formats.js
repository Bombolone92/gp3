// Frame sizes for slides, printed pages, and screens, as Miro offers them.
// A format is only a size: the frame keeps its width and height and nothing
// else, so boards stay readable by every version of the app. A 16:9 frame
// fills a PowerPoint slide; A4 and Letter frames fill a PDF page.
export const FRAME_FORMATS = [
  { id: "custom", name: "Custom", w: 420, h: 320 },
  { id: "16:9", name: "Slide 16:9", w: 1280, h: 720 },
  { id: "4:3", name: "Slide 4:3", w: 1024, h: 768 },
  { id: "1:1", name: "Square 1:1", w: 800, h: 800 },
  { id: "a4", name: "A4", w: 794, h: 1123 },
  { id: "letter", name: "Letter", w: 816, h: 1056 },
  { id: "phone", name: "Phone", w: 390, h: 844 },
  { id: "tablet", name: "Tablet", w: 820, h: 1180 },
  { id: "desktop", name: "Desktop", w: 1440, h: 900 },
];
const byId = new Map(FRAME_FORMATS.map((f) => [f.id, f]));
export const frameFormatById = (id) => byId.get(id) || FRAME_FORMATS[0];
// The format a frame's size matches, or Custom. Scaling by hand rounds to
// fractions, so half a unit either way still counts.
export function frameFormatOf(frame) {
  return (
    FRAME_FORMATS.find(
      (f) =>
        f.id !== "custom" &&
        Math.abs(frame.w - f.w) < 0.5 &&
        Math.abs(frame.h - f.h) < 0.5,
    )?.id || "custom"
  );
}
// Where the next slide goes: to the right of the last one, at its top, past
// anything already there, so a deck reads from left to right. Connectors
// only cross the space between slides and never count as covering it.
export function nextSlideSpot(items, last, gap = 100) {
  const box = { x: last.x + last.w + gap, y: last.y, w: last.w, h: last.h };
  const solid = items.filter((i) => i.type !== "arrow");
  for (let step = 0; step < 1000; step++) {
    const covering = solid.filter(
      (i) =>
        Math.min(i.x, i.x + i.w) < box.x + box.w &&
        Math.max(i.x, i.x + i.w) > box.x &&
        Math.min(i.y, i.y + i.h) < box.y + box.h &&
        Math.max(i.y, i.y + i.h) > box.y,
    );
    if (!covering.length) break;
    box.x = Math.max(...covering.map((i) => Math.max(i.x, i.x + i.w))) + gap;
  }
  return { x: box.x, y: box.y };
}
