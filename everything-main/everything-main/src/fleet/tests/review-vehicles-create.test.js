// @vitest-environment jsdom
/** Quick add. */
import { it, expect } from 'vitest';
import { onRoute, startRouter } from '../src/ui/router.js';
import { createActions } from '../src/views/create.js';

it('opens the same quick add item again while its page is showing', async () => {
  location.hash = '#/meters?new=1';
  const seen = [];
  onRoute((r) => seen.push(`${r.path}?${new URLSearchParams(r.query)}`));
  startRouter();
  await new Promise((r) => setTimeout(r, 20));
  seen.length = 0;
  // The dialog from the first time was closed; the address still ends in ?new=1.
  createActions().find((a) => a.label === 'Meter reading').run();
  await new Promise((r) => setTimeout(r, 20));
  expect(seen).toEqual(['/meters?new=1']);
});
