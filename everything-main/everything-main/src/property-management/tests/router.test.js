import { describe, it, expect } from 'vitest';
import { route, parse } from '../src/ui/router.js';

route('/tenants/:id', 'tenant');

describe('router', () => {
  it('reads encoded ids', () => {
    expect(parse('#/tenants/a%20b')).toMatchObject({ name: 'tenant', params: { id: 'a b' } });
  });

  it('treats a malformed escape as a page that does not exist', () => {
    expect(() => parse('#/tenants/%E0%A4%A')).not.toThrow();
    expect(parse('#/tenants/%E0%A4%A').name).toBe('not-found');
  });
});
