import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';

it('binds the shallow-join observations to the original synthetic-bold controls', () => {
  const root = 'tests/fixtures/text-3d-shallow-joins/';
  const ref = JSON.parse(readFileSync(root + 'reference.json'));
  const hash = name => createHash('sha256').update(readFileSync(root + name)).digest('hex');
  expect(hash('control.docx')).toBe(ref.sourceSha256);
  expect(hash('native.pdf')).toBe(ref.pdfSha256);
  const xml = strFromU8(unzipSync(readFileSync(root + 'control.docx'))['word/document.xml']);
  for (let delta = -2; delta <= 2; delta++) expect(xml).toContain('Original shallow join ' + delta);
  expect(xml.match(/Shallow Join Complete 1000/g)).toHaveLength(10);
  expect(ref.records.map(r => r.page)).toEqual([1, 2, 3, 4, 5]);
  expect(ref.records.map(r => r.failures)).toEqual([0, 0, 0, 5, 0]);
  // This verifies retained observations, not current-renderer fidelity.
  expect(ref.records[3].bad).toHaveLength(5);
});
