import { afterEach, beforeEach, expect, it } from 'vitest';
import { versionsFolder, saveVersion, listVersions, removeVersions } from '../src/lib/versions.js';
import { installMockPuter } from './helpers/mock-puter.js';

beforeEach(() => { installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

// File names may hold characters a folder name is stripped of, so "Q3: Forecast.xlsx"
// and "Q3 Forecast.xlsx" used to share one .versions folder: their histories mixed,
// Restore brought back the other file, and pruning or deleting one wiped both.
it('gives a file whose name the folder cannot carry as it is a folder of its own', () => {
  const clean = versionsFolder('Spreadsheets/Q3 Forecast.xlsx');
  expect(clean).toBe('Spreadsheets/.versions/Q3 Forecast');
  const colon = versionsFolder('Spreadsheets/Q3: Forecast.xlsx');
  expect(colon).not.toBe(clean);
  expect(colon).toMatch(/^Spreadsheets\/\.versions\/Q3 Forecast [a-z0-9]+$/);
  expect(colon).toBe(versionsFolder('Spreadsheets/Q3: Forecast.xlsx'));
  expect(versionsFolder('Spreadsheets/Budget?.xlsx')).not.toBe(versionsFolder('Spreadsheets/Budget.xlsx'));
  expect(versionsFolder('Spreadsheets/Budget .xlsx')).not.toBe(versionsFolder('Spreadsheets/Budget.xlsx'));
  expect(versionsFolder('Spreadsheets/Budget.xlsx')).toBe('Spreadsheets/.versions/Budget');
  // A name that is nothing but such characters is not the same file as one called Untitled.
  expect(versionsFolder('Spreadsheets/???.xlsx')).toMatch(/^Spreadsheets\/\.versions\/Untitled [a-z0-9]+$/);
  expect(versionsFolder('Spreadsheets/Untitled.xlsx')).toBe('Spreadsheets/.versions/Untitled');
  expect(versionsFolder('Spreadsheets/Q3: Forecast.csv')).not.toBe(versionsFolder('Spreadsheets/Q3 Forecast.csv'));
});

it('keeps the histories of two such files apart on the drive', async () => {
  await saveVersion('Spreadsheets/Q3 Forecast.xlsx', new Blob(['clean']), 'clean');
  await saveVersion('Spreadsheets/Q3: Forecast.xlsx', new Blob(['colon']), 'colon');
  expect((await listVersions('Spreadsheets/Q3 Forecast.xlsx')).map((v) => v.label)).toEqual(['clean']);
  expect((await listVersions('Spreadsheets/Q3: Forecast.xlsx')).map((v) => v.label)).toEqual(['colon']);
  expect(await removeVersions('Spreadsheets/Q3: Forecast.xlsx')).toBe(true);
  expect((await listVersions('Spreadsheets/Q3 Forecast.xlsx')).map((v) => v.label)).toEqual(['clean']);
  expect(await listVersions('Spreadsheets/Q3: Forecast.xlsx')).toEqual([]);
});
