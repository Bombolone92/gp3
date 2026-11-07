import { describe, expect, it } from 'vitest';
import { outlinePort, packOutline, unpackOutline } from '../src/core/outline-transport.js';

describe('outline transport', () => {
  it('clones a deep outline without losing hierarchy, destinations or formatting', () => {
    const root = [],
      depth = 12000;
    let children = root;
    for (let i = 0; i < depth; i++) {
      const item = {
        title: `Level ${i}`,
        dest: [{ num: i + 1, gen: 0 }, { name: 'Fit' }],
        bold: i % 2 === 0,
        color: new Uint8ClampedArray([10, 20, 30]),
        items: [],
      };
      children.push(item);
      children = item.items;
    }
    root.push({ title: 'Sibling', dest: 'named-target', url: 'https://example.com/', items: [] });
    const unpacked = unpackOutline(structuredClone(packOutline(root)));
    expect(unpacked[1]).toEqual(root[1]);
    children = unpacked;
    for (let i = 0; i < depth; i++) {
      const item = children[0];
      expect(item.title).toBe(`Level ${i}`);
      expect(item.dest).toEqual([{ num: i + 1, gen: 0 }, { name: 'Fit' }]);
      expect(item.bold).toBe(i % 2 === 0);
      expect(item.color).toEqual(new Uint8ClampedArray([10, 20, 30]));
      children = item.items;
    }
    expect(children).toEqual([]);
    expect(unpackOutline(null)).toBeNull();
    expect(unpackOutline(root)).toBe(root);
  });

  it('retries only an outline clone overflow and preserves unrelated messages and transfer lists', () => {
    const listeners = [],
      delivered = [],
      calls = [];
    let overflow = false;
    const port = outlinePort(
      {
        addEventListener: (...args) => listeners.push(args),
        postMessage: (...args) => {
          calls.push(args);
          if (overflow && Array.isArray(args[0].data)) throw new RangeError('Too deep');
          delivered.push(args);
        },
      },
      'doc',
    );
    const signal = new AbortController().signal;
    const received = [];
    port.addEventListener('message', (event) => received.push(event), { signal });
    expect(listeners[0][2]).toEqual({ signal });
    const request = (action, callbackId, targetName = 'doc_worker') => {
      const event = { data: { action, callbackId, targetName } };
      listeners[0][1](event);
      expect(received.at(-1)).toBe(event);
    };
    const data = [{ title: 'A', items: [] }];
    const message = { callback: 1, callbackId: 1, data };
    const transfers = [new ArrayBuffer(1)];
    request('GetOutline', 1);
    port.postMessage(message, transfers);
    expect(delivered[0]).toEqual([message, transfers]);
    expect(delivered[0][0]).toBe(message);
    expect(calls).toHaveLength(1);
    overflow = true;
    request('GetOutline', 2);
    port.postMessage({ ...message, callbackId: 2 });
    expect(unpackOutline(delivered[1][0].data)).toEqual(data);
    expect(calls).toHaveLength(3);
    request('OtherAction', 3);
    expect(() => port.postMessage({ ...message, callbackId: 3 })).toThrow(RangeError);
    request('GetOutline', 4, 'other_worker');
    expect(() => port.postMessage({ ...message, callbackId: 4 })).toThrow(RangeError);
    request('GetOutline', 5);
    request('Terminate', 6);
    expect(() => port.postMessage({ ...message, callbackId: 5 })).toThrow(RangeError);
    request('GetOutline', 7);
    const error = { callback: 2, callbackId: 7, reason: { name: 'Error', message: 'Unavailable' } };
    port.postMessage(error);
    expect(delivered.at(-1)[0]).toBe(error);
  });
});
