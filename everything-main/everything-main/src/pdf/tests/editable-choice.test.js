import { expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { listFields } from '../src/core/document.js';
import { choiceInputOptions } from '../src/core/form-draft.js';
import { editableChoicePdf } from './fixtures/editable-choice.js';

it('distinguishes ambiguous labels, blank exports, and generated-label collisions', () => {
  const choices = [
    { value: 'A', label: 'Shared' },
    { value: 'B', label: 'Shared' },
    { value: 'C', label: 'Shared (A)' },
    { value: 'D', label: '' },
    { value: '', label: '' },
    { value: 'E', label: '(Empty option)' },
  ];
  const before = structuredClone(choices);
  const options = choiceInputOptions(choices);
  expect(options.map(({ label }) => label)).toEqual([
    'Shared (A)',
    'Shared (B)',
    'Shared (A) (2)',
    'D',
    '(Empty option) (empty)',
    '(Empty option) (E)',
  ]);
  for (const option of options)
    expect(options.find(({ label }) => label === option.label)?.value).toBe(option.value);
  expect(choices).toEqual(before);
});

it('preserves ordinary labels and harmless repeated options', () => {
  const choices = [
    { value: 'CA', label: 'Canada' },
    { value: 'CA', label: 'Canada' },
    { value: 'Custom', label: 'Custom' },
  ];
  expect(choiceInputOptions(choices)).toEqual(choices);
  expect(choiceInputOptions([])).toEqual([]);
});

it('keeps exports intact when native-input line break normalization would merge labels', () => {
  const choices = [
    { value: 'NZ', label: 'New\nZealand' },
    { value: 'NZ2', label: 'New Zealand' },
    { value: 'Line\r\ncode', label: '' },
    { value: 'Line\ncode', label: '' },
  ];
  const options = choiceInputOptions(choices);
  expect(options.map(({ value }) => value)).toEqual(choices.map(({ value }) => value));
  expect(new Set(options.map(({ label }) => label)).size).toBe(choices.length);
  for (const option of options) {
    expect(option.label).not.toMatch(/[\r\n]/);
    expect(options.find(({ label }) => label === option.label)?.value).toBe(option.value);
  }
});

for (const inherited of [false, true])
  for (const defaultOnly of [false, true])
    for (const readOnly of [false, true])
      it(`identifies editable single choices without modifying their flags (inherited=${inherited}, default=${defaultOnly}, readOnly=${readOnly})`, async () => {
        const { doc: source } = await editableChoicePdf({ inherited, defaultOnly, readOnly });
        const doc = await PDFDocument.load(await source.save());
        const snapshot = () =>
          doc.context.enumerateIndirectObjects().map(([ref, value]) => [ref, value.toString()]);
        const before = snapshot();
        expect(listFields(doc)).toMatchObject([
          {
            name: 'Destination.Country',
            editableChoice: true,
            multiple: false,
            readOnly,
            value: ['CA'],
            choices: [
              { value: 'CA', label: 'Canada' },
              { value: 'FR', label: 'France' },
              { value: '', label: '' },
            ],
          },
          { name: 'Fixed', editableChoice: false, multiple: false },
          { name: 'Multiple', editableChoice: false, multiple: true, value: ['First', 'Second'] },
        ]);
        expect(snapshot()).toEqual(before);
      });
