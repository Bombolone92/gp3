import { expect } from '@playwright/test';
import { bodyEditSettings } from '../../helpers/body-edit-settings.js';
// Body edits invalidate saved clean proofing completion. Require precisely that
// change: settings.xml keeps every byte except the clean-to-dirty proofState
// values, and every other package part outside `skip` keeps its exact bytes.
// No-edit/undo assertions still require exact bytes.
export function expectBodyEditParts(edited, original, skip = ['word/document.xml']) {
  expect(Object.keys(edited).sort()).toEqual(Object.keys(original).sort());
  for (const [name, part] of Object.entries(original)) {
    if (skip.includes(name)) continue;
    if (name === 'word/settings.xml') expect(new TextDecoder().decode(edited[name]), 'Only clean-to-dirty proofState may change').toBe(bodyEditSettings(part));
    else expect(Buffer.from(edited[name]).equals(Buffer.from(part)), name).toBe(true);
  }
}
