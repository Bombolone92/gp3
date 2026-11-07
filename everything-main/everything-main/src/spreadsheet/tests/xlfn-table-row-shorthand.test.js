import { expect, it } from 'vitest';
import { toFileFormula } from '../src/core/xlfn.js';

// Implemented from MS-OE376 3.2.3.1.1. Native Excel opened the
// corresponding synthetic fixture with #REF! before this conversion, and
// calculated the same fixture correctly with #This Row after it.
it.each([
 ['[@Quantity]*[@Price]', '[[#This Row],[Quantity]]*[[#This Row],[Price]]'],
 ['Sales[@Amount]', 'Sales[[#This Row],[Amount]]'],
 ['Sales[@[Unit price]]', 'Sales[[#This Row],[Unit price]]'],
 ['SUM(Sales[@[Qty]:[Price]])', 'SUM(Sales[[#This Row],[Qty]:[Price]])'],
 ['SUM(Sales[@])', 'SUM(Sales[#This Row])'],
 ['SUM([ @ [Qty]:[Price] ])', 'SUM([[#This Row],[Qty]:[Price]])'],
 ['@Sales[@Amount]', '_xlfn.SINGLE(Sales[[#This Row],[Amount]])'],
 ['XLOOKUP([@Qty],A1:A3,B1:B3)', '_xlfn.XLOOKUP([[#This Row],[Qty]],A1:A3,B1:B3)'],
 ['LET(n,[@Qty],n+1)', '_xlfn.LET(_xlpm.n,[[#This Row],[Qty]],_xlpm.n+1)'],
 ["Sales['@Amount]", "Sales['@Amount]"],
 ['Sales[[#This Row],[Qty]]', 'Sales[[#This Row],[Qty]]'],
 ['Sales[Amount]', 'Sales[Amount]'],
 ['"[@Quantity]"&"user@example.test"', '"[@Quantity]"&"user@example.test"'],
 ['LAMBDA([Qty],Qty)(3)', '_xlfn.LAMBDA([_xlpm.Qty],_xlpm.Qty)(3)'],
])('serializes table row references without altering other formula tokens: %s', (ours, native) => {
 expect(toFileFormula(ours)).toBe(native);
 expect(toFileFormula(native)).toBe(native);
});
