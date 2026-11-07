import { readRangeFlags } from './range-flags.js';

/** SpreadsheetML CT_IgnoredError: independent, explicitly acknowledged checks.
 * These do not change formula values or suppress errors in the calculation engine. */
export const IGNORED_ERROR_KEYS = ['calculatedColumn', 'emptyCellReference', 'evalError', 'formula', 'formulaRange', 'listDataValidation', 'numberStoredAsText', 'twoDigitTextYear', 'unlockedFormula'];
export const normalizeIgnoredErrors = value => readRangeFlags(value, IGNORED_ERROR_KEYS);
