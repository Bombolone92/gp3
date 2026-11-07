import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
for (const kind of ['text', 'dropdown', 'checkbox', 'radio', 'button'])
  for (const location of ['field', 'widget'])
    it(`regenerates ${kind} with an overflowing ${location} appearance without stalling`, async () => {
      // A synchronous parser stall cannot be interrupted by Vitest's in-process timeout.
      const result = await execute(
        process.execPath,
        [
          new URL('./helpers/appearance-worker.js', import.meta.url).pathname,
          JSON.stringify({ kind, location }),
        ],
        { timeout: 2000 },
      );
      expect(result.stdout).toBe('completed');
    });

for (const input of ['invalid-token', 'precise-color'])
  for (const location of ['field', 'widget'])
    it(`handles a long ${input} in the ${location} appearance`, async () => {
      const result = await execute(
        process.execPath,
        [
          new URL('./helpers/appearance-worker.js', import.meta.url).pathname,
          JSON.stringify({ kind: 'text', location, input }),
        ],
        { timeout: 2000 },
      );
      expect(result.stdout).toBe('completed');
    });
