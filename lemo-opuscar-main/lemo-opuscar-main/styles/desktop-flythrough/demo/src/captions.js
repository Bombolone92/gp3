// Subtitles (DOM, always crisp): one cue per voice-over line, Chinese on the first line, English on the second, in a quiet bar at the bottom.
// The sign-off sits in the same place after the last line. texts() reports what is meant to be read (the sign-off; subtitle cues are timed by the voice).
import { seg, eo } from '/core/lib.js';

export function makeSubs(VO, END) {
  const host = document.getElementById('sub'), zh = host.querySelector('.zh'), en = host.querySelector('.en'), credit = document.getElementById('credit');
  let cur = -2;
  const clean = new URLSearchParams(location.search).has('nosub');
  function render(t) {
    if (clean) { host.style.display = 'none'; credit.style.display = 'none'; return; }
    let i = -1; for (let k = 0; k < VO.length; k++) { const next = VO[k + 1] ? VO[k + 1].t0 - .12 : END.credit - .2; if (t >= VO[k].t0 - .12 && t < Math.min(next, VO[k].t1 + .5)) i = k; }
    if (i !== cur) { cur = i; if (i >= 0) { zh.textContent = VO[i].zh; en.textContent = VO[i].en; } }
    if (i >= 0) { const a = Math.min(eo(seg(t, VO[i].t0 - .12, VO[i].t0 + .05)), 1 - seg(t, VO[i].t1 + .35, VO[i].t1 + .5)); host.style.opacity = a; host.style.display = 'flex'; }
    else host.style.display = 'none';
    const c = t >= END.credit; credit.style.display = c ? 'block' : 'none';
    if (c) { const p = eo(seg(t, END.credit, END.credit + .4)); credit.style.opacity = p; credit.style.transform = `translate(-50%, ${(1 - p) * 20}px)`; }
  }
  function texts(t) {
    const out = [];
    if (t >= END.credit) { const r = credit.getBoundingClientRect(); out.push({ id: 'credit', text: credit.innerText.trim(), x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }); }
    return out;
  }
  return { render, texts };
}
