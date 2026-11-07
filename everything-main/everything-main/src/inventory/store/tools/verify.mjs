import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const sizes = [[1920,1080],[1024,768],[1080,2280]];
const manifest = JSON.parse(await readFile(`${root}source/asset-manifest.json`, 'utf8'));
const checks = [];
const hashes = new Set();
for (const [width, height] of sizes) {
  const dir = `${width}x${height}`;
  const files = (await readdir(`${root}screenshots/${dir}`)).filter(name=>name.endsWith('.png')).sort();
  assert.equal(files.length, 5, `${dir}: five slides required`);
  for (const [index, name] of files.entries()) {
    assert.match(name, new RegExp(`^0${index + 1}-[a-z0-9-]+\\.png$`));
    const bytes = await readFile(`${root}screenshots/${dir}/${name}`);
    assert.equal(bytes.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), width);
    assert.equal(bytes.readUInt32BE(20), height);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert(!hashes.has(hash), `Duplicate asset: ${name}`);
    hashes.add(hash);
    const entry = manifest.find(e=>e.file===`screenshots/${dir}/${name}`);
    assert(entry, `No manifest entry: ${name}`);
    assert.equal(entry.outsideCanvas.length, 0, `Canvas overflow: ${name}`);
    const headlineWords = entry.headline.trim().split(/\s+/).length;
    assert(headlineWords >= 3 && headlineWords <= 7, `Headline length: ${entry.headline}`);
    assert(!/[\u2014]|https?:|www\./i.test(`${entry.headline} ${entry.subhead}`));
    checks.push({ file: entry.file, width, height, bytes: bytes.length, sha256: hash, headlineWords });
  }
}
const listing = await readFile(new URL('../../STORE_LISTING.md', import.meta.url), 'utf8');
const short = listing.split('## Short description\n\n')[1].split('\n\n')[0];
const tagline = listing.split('\n')[2];
assert(short.length < 170);
assert(tagline.length < 30);
assert(!listing.includes('\u2014'));
const paragraphs = listing.split('## Long description\n\n')[1].split('\n\n## Key features')[0].split('\n\n');
assert(paragraphs.length >= 2 && paragraphs.length <= 4);
const features = listing.split('## Key features\n\n')[1].split('\n\n## Who')[0].split('\n').filter(l=>l.startsWith('- '));
assert(features.length >= 5 && features.length <= 8);
const report = { finalAssets: checks.length, sizes: sizes.map(([w,h])=>`${w}x${h}`),
  shortDescriptionCharacters: short.length, taglineCharacters: tagline.length,
  longDescriptionParagraphs: paragraphs.length, featureCount: features.length, assets: checks };
await writeFile(`${root}source/verification.json`, JSON.stringify(report,null,2) + '\n');
console.log(`Verified ${checks.length} unique PNGs: exact sizes, filenames, layout bounds, headline lengths, and listing limits.`);
