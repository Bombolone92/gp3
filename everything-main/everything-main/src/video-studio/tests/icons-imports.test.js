import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('icon imports', () => {
  it('import each Lucide icon once (several blocks are merged from parallel work)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/icons.js'), 'utf8');
    const names = [];
    for (const m of src.matchAll(/import \{([^}]*)\} from 'lucide';/g)) {
      for (const part of m[1].split(',')) {
        const local = part.trim().split(/\s+as\s+/).pop();
        if (local) names.push(local);
      }
    }
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});
