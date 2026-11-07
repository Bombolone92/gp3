import { build } from 'vite';
import { writeFileSync } from 'node:fs';
const result = await build({ configFile: false, logLevel: 'silent', build: { write: false, lib: { entry: 'tmp/wcag-summary-keyboard-entry.js', name: 'SummaryKeyboardFixture', formats: ['iife'] } } });
const out = (Array.isArray(result) ? result[0] : result).output;
const code = out.find(p => p.type === 'chunk' && p.isEntry).code;
const css = out.filter(p => p.type === 'asset' && p.fileName.endsWith('.css')).map(p => String(p.source)).join('\n');
const phase = process.argv[2] || 'before';
for (const spacing of [false, true]) {
  const name = `wcag-summary-keyboard-${phase}${spacing ? '-spacing' : ''}`;
  const overrides = spacing ? '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}' : '';
  writeFileSync(`tmp/${name}.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local summary keyboard diagnostic</title><style>${css}${overrides}</style><body><div class="editor" style="height:100vh"><header class="editor-header">Local summary</header><div class="canvas-wrap"><canvas></canvas><div class="canvas-navigation"><button data-action="facilitation">Facilitation</button></div></div></div><pre id="csv"></pre><script>${code.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
  for (const lang of ['en', 'fr']) for (const theme of ['light', 'dark']) writeFileSync(`tmp/${name}-${lang}-${theme}-320.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Local summary keyboard ${phase} ${lang} ${theme}</title><iframe title="Local summary at 320 by 400 CSS pixels" style="width:320px;height:400px;border:0" src="${name}.html?lang=${lang}&theme=${theme}"></iframe><p id="metrics"></p><script>addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.audit==='summary-keyboard')document.querySelector('#metrics').textContent=event.data.description;});</script></html>`);
}
console.log('Built actual facilitation component, styles and fonts:', phase);
