import { build } from 'vite';
import { writeFileSync } from 'node:fs';
const result = await build({ configFile: false, logLevel: 'silent', build: { write: false, lib: { entry: 'tmp/wcag-quick-scroll-entry.js', name: 'QuickScrollFixture', formats: ['iife'] } } });
const out = (Array.isArray(result) ? result[0] : result).output;
const code = out.find(p => p.type === 'chunk' && p.isEntry).code;
const css = out.filter(p => p.type === 'asset' && p.fileName.endsWith('.css')).map(p => String(p.source)).join('\n');
const phase = process.argv[2] || 'before';
for (const spacing of [false, true]) {
  const name = `wcag-quick-scroll-${phase}${spacing ? '-spacing' : ''}`;
  const overrides = spacing ? '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}' : '';
  writeFileSync(`tmp/${name}.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local Quick connect diagnostic</title><style>${css}${overrides}</style><body><div class="editor"><header class="editor-header">Local Quick connect</header><div class="canvas-wrap"><canvas id="canvas" tabindex="0"></canvas><div id="quick-ports"></div></div></div><script>${code.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
  for (const lang of ['en', 'fr']) for (const theme of ['light', 'dark']) for (const height of [300, 400]) writeFileSync(`tmp/${name}-${lang}-${theme}-320-${height}.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Local Quick connect ${phase} ${lang} ${theme} ${height}</title><iframe title="Local Quick connect at 320 by ${height} CSS pixels" style="width:320px;height:${height}px;border:0" src="${name}.html?lang=${lang}&theme=${theme}"></iframe><p id="metrics"></p><script>addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.audit==='quick-scroll')document.querySelector('#metrics').textContent=event.data.description;});</script></html>`);
}
console.log('Built actual Quick connect component, styles and fonts:', phase);
