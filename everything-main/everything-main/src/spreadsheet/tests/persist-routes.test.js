import { expect, it } from 'vitest';
import { parseAppHash } from '../src/lib/links.js';

// "#/edit/" with nothing after it was routed as a file named "", which failed to open with
// "That file no longer exists" and dropped a recent entry for that empty name.
it('lands an edit address that names no file on the list', () => {
  expect(parseAppHash('#/edit/')).toEqual({ route: 'home' });
  expect(parseAppHash('#/edit/?range=Sheet1!A1')).toEqual({ route: 'home' });
  expect(parseAppHash('#/edit/Spreadsheets%2FBudget.xlsx')).toEqual({ route: 'edit', path: 'Spreadsheets/Budget.xlsx', range: null });
});
