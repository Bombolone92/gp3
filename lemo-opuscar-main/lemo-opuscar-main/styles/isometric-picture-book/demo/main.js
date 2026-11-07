const Q = new URLSearchParams(location.search);
const cv = document.getElementById('c'), g = cv.getContext('2d');
const CJK = '七十二个座位后排先上只有一条过道够人走停面全等挤在同处坐满换顺序靠窗隔开六时放快了三分多钟名乘客登机口';
await Promise.all([
  document.fonts.load('500 40px NotoSerifSC', CJK), document.fonts.load('700 40px NotoSerifSC', CJK),
  document.fonts.load('400 40px Newsreader'), document.fonts.load('500 40px Newsreader'), document.fonts.load('600 40px Newsreader'), document.fonts.load('700 40px Newsreader'),
]);
const film = await import('./film.js');
window.DUR = film.DUR; window.T = film.TIMES; window.SHOTS = film.SHOT_LIST; window.EV = film.events(); window.TEXTS = film.texts;
window.render = t => { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; film.render(g, t, Q); };
window.SUBBOX = () => film.subtitleBoxes(g).map((b, i) => ({ ...b, t0: film.CUE_LIST[i].t0, t1: film.CUE_LIST[i].t1 }));
window.READY = true;
