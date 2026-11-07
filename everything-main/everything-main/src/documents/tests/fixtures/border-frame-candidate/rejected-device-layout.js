// REJECTED diagnostic. Browser tests route this text at the production module
// URL; its relative import resolves there. Never import it into the app.
import { joinTableBorderCorner, joinTableBorderCrossing } from './table-border-corners.js';

// Display geometry only. Authored widths still decide intersection ownership;
// two unequal declarations can round to the same device-pixel thickness.
export function deviceTableBorders(ctx, borders) {
  const m = ctx.getTransform?.();
  if (!m || m.b || m.c || !(m.a > 0 && m.d > 0)) return borders;
  const sx = v => Number.isFinite(v) ? (Math.round(v * m.a + m.e) - m.e) / m.a : v;
  const sy = v => Number.isFinite(v) ? (Math.round(v * m.d + m.f) - m.f) / m.d : v;
  const preceding=v=>(Math.ceil(v*15-1e-5)-1)/15;
  const px=v=>sx(preceding(v)),py=v=>sy(preceding(v));
  const originKey=s=>[s.tableId,s.pageStory,s.page,s.column??0].join(':');
  const origins=new Map();
  for(const s of borders)if(!s.guide){const k=originKey(s);origins.set(k,Math.min(origins.get(k)??Infinity,s.y));}
  const key = (s, p) => [s.tableId, s.pageStory, s.page, s.column ?? 0,
    Math.round((s.x + p.x) * 1e6), Math.round((s.y + p.y) * 1e6)].join(':');
  const corners = new Map(), caps = [];
  const result = borders.map(s => {
    if (s.guide) return s;
    const r = { ...s, logicalThickness: s.horizontal ? s.height : s.width };
    // Copy mutable join geometry even for compound borders adjoining a single.
    if (s.bandEnds) r.bandEnds = s.bandEnds.map(pair => [...pair]);
    if (s.bandCaps) r.bandCaps = { ...s.bandCaps };
    delete r.crossingCuts;
    if (s.border.style === 'single') {
      r.x = px(s.x); r.y = s.horizontal&&s.side==='bottom'&&s.cellIds.length===1&&Math.floor(s.height*m.d+1e-6)===0 ? (Math.floor(s.y*m.d+m.f+1e-6)-m.f)/m.d : py(s.y);
      if(!s.horizontal && Math.floor(s.width*m.a+1e-6)===0)r.x-=1/m.a;
      r.width = s.horizontal ? px(s.x + s.width) - r.x : Math.max(1, Math.floor(s.width * m.a + 1e-6)) / m.a;
      r.height = s.horizontal ? Math.max(1, Math.floor(s.height * m.d + 1e-6)) / m.d : py(s.y + s.height) - r.y;
      if(s.horizontal&&s.side==='bottom'&&s.cellIds.length===1&&Math.floor(s.height*m.d+1e-6)>1){
        const start=origins.get(originKey(s));
        r.y=py(start)+Math.round((s.y-start)*m.d)/m.d;
        const end=sy(Math.floor((s.y+s.height)/.16+1e-6)*.16);
        r.height=Math.max(1/m.d,Math.min(r.height,end-r.y));
      }
      if(s.horizontal&&s.side==='bottom'&&s.cellIds.length===1&&Math.floor(s.height*m.d+1e-6)===0){
        const start=origins.get(originKey(s));
        const end=py(start)+Math.round((s.y+s.height-start)*m.d)/m.d;
        r.y=Math.min(r.y,end-r.height);
      }
      if (s.bandEnds) r.bandEnds = s.bandEnds.map(pair => pair.map(v => s.horizontal ? px(s.x + v) - r.x : py(s.y + v) - r.y));
      if (s.cellClip) r.cellClip = Object.fromEntries(Object.entries(s.cellClip).map(([k, v]) => [k, ['left', 'right'].includes(k) ? sx(v) : sy(v)]));
    }
    for (const p of s.junctions || []) {
      const k = key(s, p);
      if (!corners.has(k)) corners.set(k, []);
      corners.get(k).push({ stroke: r, first: p.first });
    }
    if (s.junctionCap) caps.push({ stroke: r, key: key(s, s.junctionCap) });
    return r;
  });
  for (const edges of corners.values()) {
    joinTableBorderCorner(edges);
    joinTableBorderCrossing(edges);
  }
  // Hidden merged-cell transitions have a short horizontal cap rather than a
  // full logical edge. Rebuild its subtraction mask using the same painted box.
  for (const { stroke: cap, key } of caps) for (const { stroke } of corners.get(key) || []) if (!stroke.horizontal) {
    (stroke.crossingCuts ||= []).push({ x: cap.x - stroke.x, y: cap.y - stroke.y, width: cap.width, height: cap.height });
  }
  return result;
}
