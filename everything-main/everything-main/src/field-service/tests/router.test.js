import { describe, it, expect } from 'vitest';
import { route, parse } from '../src/ui/router.js';

route('/clients/:id', 'client');

describe('router', () => {
  it('decodes route parameters', () => {
    expect(parse('#/clients/a%20b')).toMatchObject({ name: 'client', params: { id: 'a b' } });
  });

  it('treats a malformed escape as an unknown page instead of throwing', () => {
    expect(parse('#/clients/%E0%A4%A').name).toBe('not-found');
  });
});
