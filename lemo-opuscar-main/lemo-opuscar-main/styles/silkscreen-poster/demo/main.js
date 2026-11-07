// Page contract: ?a=&b= renders the [a, b) stretch of the film clock (seconds); &sign=1 prints an optional imprint in the corner; &nocap=1 leaves the subtitles out (stills).
import { setup, render, texts } from './film.js';
const Q = new URLSearchParams(location.search);
await Promise.all(['900 40px BigShoulders', '800 40px BigShoulders', '500 40px Outfit', '600 40px Outfit', '700 40px Outfit', '600 40px NotoSC'].map(f => document.fonts.load(f, f.includes('NotoSC') ? '外公' : 'A')));
const cues = await (await fetch('voice/cues.json')).json();
const TL = setup(document.getElementById('c'), { cues, sign: Q.get('sign') === '1', nocap: Q.get('nocap') === '1' });
const A = +(Q.get('a') ?? 0), Bn = +(Q.get('b') ?? TL.dur);
window.DUR = +(Bn - A).toFixed(3);
window.EV = TL.ev.filter(e => e.t >= A - 1e-6 && e.t < Bn).map(e => ({ ...e, t: +(e.t - A).toFixed(3) }));
window.render = t => render(t + A);
window.TEXTS = t => texts(t + A);
window.READY = true;
