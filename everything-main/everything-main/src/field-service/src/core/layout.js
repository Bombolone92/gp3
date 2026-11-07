/** Calendar layout helpers. */
import { timeToMinutes } from './dates.js';

/** Side-by-side columns for overlapping timed items. */
export function layoutOverlaps(list) {
  const sorted = [...list].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const colsEnd = [];
    const placed = cluster.map((it) => {
      const s = timeToMinutes(it.start);
      const e = it.end ? timeToMinutes(it.end) : s + 60;
      let col = colsEnd.findIndex((end) => end <= s);
      if (col < 0) {
        col = colsEnd.length;
        colsEnd.push(e);
      } else colsEnd[col] = e;
      return { it, col };
    });
    const n = colsEnd.length;
    for (const p of placed) out.push({ it: p.it, left: p.col / n, width: 1 / n });
    cluster = [];
  };
  for (const it of sorted) {
    const s = timeToMinutes(it.start);
    const e = it.end ? timeToMinutes(it.end) : s + 60;
    if (cluster.length && s >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, e);
  }
  if (cluster.length) flush();
  return out;
}

