import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

for (const name of ['svg-image-mask-kernel', 'svg-image-mask-phase', 'svg-image-mask-scales', 'svg-image-mask-fractional', 'svg-image-mask-kernel-three', 'svg-image-mask-amplitudes', 'svg-image-mask-fractional-impulses', 'svg-image-mask-placement', 'svg-image-mask-placement-sweep']) {
  it(`${name}: binds the original controls and native rasters to their capture`, () => {
    const folder = `tests/fixtures/${name}/`;
    const reference = JSON.parse(readFileSync(folder + 'metafile-reference.json'));
    const hash = file => createHash('sha256').update(readFileSync(folder + file)).digest('hex');
    for (const [file, key] of [['control.docx', 'sourceSha256'], ['cases.json', 'casesSha256'], ['capture.emf', 'captureSha256'], ['native.emf', 'nativeSha256']]) {
      expect(hash(file), file).toBe(reference[key]);
    }
    expect(reference.referenceBuild).toBe('16.0.20326');
    expect(reference.images).toHaveLength(6);
    for (const [i, image] of reference.images.entries()) {
      expect(hash(image.path)).toBe(image.sha256);
      expect(image.size).toEqual([18, 62]);
      expect(image.transform).toEqual([1, 0, 0, 1, 1 + i * 20, 9]);
    }
  });
}

it('distinguishes native kernel amplitudes that the gray-128 band alone cannot resolve', () => {
  const reference = JSON.parse(readFileSync('tests/fixtures/svg-image-mask-amplitudes/metafile-reference.json'));
  expect(reference.images.map(image => image.middleColumn[31][3])).toEqual([222, 224, 233, 238, 247, 255]);
});

it('records native fractional impulse weights independently of the portable hypotheses', () => {
  const reference = JSON.parse(readFileSync('tests/fixtures/svg-image-mask-fractional-impulses/metafile-reference.json'));
  expect(reference.images.map(image => image.middleColumn[31][3])).toEqual([5, 146, 204, 179, 17, 0]);
});

it('records native four-source-pixel phase groups without certifying browser rendering', () => {
  const reference = JSON.parse(readFileSync('tests/fixtures/svg-image-mask-phase/metafile-reference.json'));
  const hashes = reference.images.map(image => image.sha256);
  expect(new Set(hashes.slice(0, 4)).size).toBe(1);
  expect(hashes[4]).toBe(hashes[5]);
  expect(hashes[4]).not.toBe(hashes[0]);
});
