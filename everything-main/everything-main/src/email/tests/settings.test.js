import { describe, it, expect } from 'vitest';
import { createSettings } from '../src/lib/settings.js';
import { memoryStorage } from '../src/lib/readstate.js';

describe('createSettings', () => {
  it('answers the fallback for a setting never stored', () => {
    const settings = createSettings('me', memoryStorage());
    expect(settings.get('signature', '')).toBe('');
    expect(settings.get('signature')).toBeUndefined();
  });

  it('stores a value and reads it back, in a fresh store over the same storage', () => {
    const storage = memoryStorage();
    createSettings('me', storage).set('signature', 'Ana');
    expect(createSettings('me', storage).get('signature', '')).toBe('Ana');
  });

  it('keeps one account\'s settings apart from another\'s', () => {
    const storage = memoryStorage();
    createSettings('me', storage).set('signature', 'Ana');
    expect(createSettings('you', storage).get('signature', '')).toBe('');
  });

  it('answers the fallback for a stored value of the wrong type', () => {
    const storage = memoryStorage();
    storage.setItem('puter-mail:settings:me', JSON.stringify({ signature: 42 }));
    expect(createSettings('me', storage).get('signature', '')).toBe('');
  });

  it('shrugs off a storage holding something that is not settings', () => {
    const storage = memoryStorage();
    storage.setItem('puter-mail:settings:me', '[1, 2');
    const settings = createSettings('me', storage);
    expect(settings.get('signature', '')).toBe('');
    expect(settings.set('signature', 'Ana')).toBe(true);
    expect(settings.get('signature', '')).toBe('Ana');
  });

  it('forgets a setting set to null', () => {
    const storage = memoryStorage();
    const settings = createSettings('me', storage);
    settings.set('signature', 'Ana');
    settings.set('signature', null);
    expect(settings.get('signature', 'none')).toBe('none');
    expect(createSettings('me', storage).get('signature', 'none')).toBe('none');
  });

  it('keeps the value for the session when the storage refuses the write', () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new Error('quota'); };
    const settings = createSettings('me', storage);
    expect(settings.set('signature', 'Ana')).toBe(false);
    expect(settings.get('signature', '')).toBe('Ana');
  });

  it('preserves unrelated preferences saved by another open window', () => {
    const storage = memoryStorage();
    const first = createSettings('me', storage);
    const second = createSettings('me', storage);
    first.set('signature', 'Ana');
    second.set('density', 'compact');
    const reopened = createSettings('me', storage);
    expect(reopened.get('signature', '')).toBe('Ana');
    expect(reopened.get('density', '')).toBe('compact');
    expect(second.get('signature', '')).toBe('Ana');
  });

  it('does not restore a preference removed by another open window', () => {
    const storage = memoryStorage();
    const first = createSettings('me', storage);
    first.set('signature', 'Ana');
    const second = createSettings('me', storage);
    first.set('signature', null);
    second.set('density', 'compact');
    expect(createSettings('me', storage).get('signature', 'none')).toBe('none');
  });

  it('retries unsaved preferences without losing another window\'s edits', () => {
    const storage = memoryStorage();
    let blocked = true;
    const settings = createSettings('me', {
      getItem: key => storage.getItem(key),
      setItem: (key, value) => {
        if (blocked) throw new Error('quota');
        storage.setItem(key, value);
      },
    });
    expect(settings.set('signature', 'Ana')).toBe(false);
    expect(settings.set('undoSend', 10)).toBe(false);
    expect(settings.get('signature', '')).toBe('Ana');
    createSettings('me', storage).set('density', 'compact');
    blocked = false;
    expect(settings.set('autoAdvance', true)).toBe(true);
    const reopened = createSettings('me', storage);
    expect(reopened.get('signature', '')).toBe('Ana');
    expect(reopened.get('undoSend', 0)).toBe(10);
    expect(reopened.get('density', '')).toBe('compact');
    expect(reopened.get('autoAdvance', false)).toBe(true);
  });

  it('retries an unsaved deletion while preserving unrelated edits', () => {
    const storage = memoryStorage();
    createSettings('me', storage).set('signature', 'Ana');
    let blocked = true;
    const settings = createSettings('me', {
      getItem: key => storage.getItem(key),
      setItem: (key, value) => {
        if (blocked) throw new Error('quota');
        storage.setItem(key, value);
      },
    });
    expect(settings.set('signature', null)).toBe(false);
    createSettings('me', storage).set('density', 'compact');
    blocked = false;
    expect(settings.set('undoSend', 10)).toBe(true);
    const reopened = createSettings('me', storage);
    expect(reopened.get('signature', 'none')).toBe('none');
    expect(reopened.get('density', '')).toBe('compact');
  });

  it('retains session preferences when storage reads and writes fail', () => {
    const settings = createSettings('me', {
      getItem: () => { throw new Error('unavailable'); },
      setItem: () => { throw new Error('unavailable'); },
    });
    expect(settings.set('signature', 'Ana')).toBe(false);
    expect(settings.set('density', 'compact')).toBe(false);
    expect(settings.get('signature', '')).toBe('Ana');
    expect(settings.get('density', '')).toBe('compact');
  });
});
