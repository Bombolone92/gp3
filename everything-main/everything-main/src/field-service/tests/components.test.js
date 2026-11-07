// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { moneyInput } from '../src/ui/components.js';
import { setMoneyDefaults } from '../src/core/money.js';

afterEach(() => setMoneyDefaults({ currency: 'USD' }));

describe('money input', () => {
  it('hints at cents for currencies that have them', () => {
    expect(moneyInput().placeholder).toBe('0.00');
  });

  it('hints at whole amounts for currencies without cents', () => {
    setMoneyDefaults({ currency: 'JPY' });
    expect(moneyInput().placeholder).toBe('0');
  });

  it('keeps a placeholder the caller chose', () => {
    expect(moneyInput({ placeholder: 'Optional' }).placeholder).toBe('Optional');
  });
});
