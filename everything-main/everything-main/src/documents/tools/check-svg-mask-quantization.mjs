// Independent native alpha comparison; exits nonzero while fidelity differs.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const folder = 'tests/fixtures/svg-mask-quantization/';
const cases = JSON.parse(readFileSync(folder+'cases.json'));
const reference = JSON.parse(readFileSync(folder+'metafile-reference.json'));
const bytes = readFileSync('public/fixtures/svg-mask-quantization.docx');
const hash = data => createHash('sha256').update(data).digest('hex');
if (hash(bytes)!==reference.sourceSha256 || hash(readFileSync(folder+'native.emf'))!==reference.nativeSha256
    || cases.length!==36 || reference.images.length!==36
    || reference.images.some(im=>hash(readFileSync(folder+im.path))!==im.sha256)) throw new Error('Native reference integrity mismatch');
const parts = unzipSync(bytes);
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] || 'http://127.0.0.1:5173/playground.html');
  const actual = await page.evaluate(async ({xml,cases}) => {
    const {decodeSvg} = await import('/src/engine/svg-images.js');
    const image = await decodeSvg(new TextEncoder().encode(xml));
    const canvas = document.createElement('canvas'); canvas.width=120; canvas.height=80;
    const context = canvas.getContext('2d'); context.drawImage(image,0,0); image.close();
    return cases.map(({x,y})=>context.getImageData(x,y,1,1).data[3]);
  }, {xml:new TextDecoder().decode(parts['word/media/vector.svg']),cases});
  const rows = cases.map((c,i)=>({...c,native:reference.images[i].middleColumn[Math.floor(reference.images[i].size[1]/2)][3],browser:actual[i]}));
  const failures=rows.filter(r=>r.native!==r.browser).length;
  console.log(JSON.stringify({total:rows.length,failures,rows},null,2));
  process.exitCode=Number(failures>0);
} finally {await browser.close();}
