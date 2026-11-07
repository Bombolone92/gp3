import { describe, expect, it } from 'vitest';
import { completionContext } from '../src/core/formula/hints.js';

// The signature hint counted every comma before the caret as an argument separator, including
// those inside an array constant or a structured reference, so it highlighted the wrong parameter.
describe('the argument index behind array constants and structured references', () => {
  it('does not count the separators inside {…} or [[…],[…]]', () => {
    expect(completionContext('=SUM({1,2},')).toMatchObject({ kind: 'call', name: 'SUM', argIndex: 1 });
    expect(completionContext('=IF(A1,{1,2;3,4},')).toMatchObject({ kind: 'call', name: 'IF', argIndex: 2 });
    expect(completionContext('=SUM(Table1[[#All],[Col]],')).toMatchObject({ kind: 'call', name: 'SUM', argIndex: 1 });
    expect(completionContext('=INDEX(Table1[[#Headers],[Col]],{1,2},')).toMatchObject({ kind: 'call', name: 'INDEX', argIndex: 2 });
  });

  it('places the caret inside an unfinished array constant in the argument that holds it', () => {
    expect(completionContext('=SUM({1,2')).toMatchObject({ kind: 'call', name: 'SUM', argIndex: 0 });
    expect(completionContext('=IF(A1,{1,2')).toMatchObject({ kind: 'call', name: 'IF', argIndex: 1 });
  });

  it('still counts ordinary separators and nested calls', () => {
    expect(completionContext('=IF(SUM(A1,A2), ')).toMatchObject({ kind: 'call', name: 'IF', argIndex: 1 });
    expect(completionContext('=TEXT(A1, "a,b", ')).toMatchObject({ kind: 'call', name: 'TEXT', argIndex: 2 });
  });
});
