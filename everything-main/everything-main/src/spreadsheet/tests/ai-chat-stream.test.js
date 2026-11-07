// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { aiChat, aiChatStream } from '../src/lib/puter.js';

afterEach(() => { delete window.puter; });

const collect = async (iterable) => { const out = []; for await (const part of iterable) out.push(part); return out; };

it('reads a streamed tool call whose arguments come as JSON text, as a whole reply\'s are read', async () => {
  window.puter = { ai: { chat: async () => (async function* s() {
    yield { type: 'tool_use', id: 'a', name: 'read_range', input: '{"range":"A1:B2"}' };
    yield { type: 'tool_use', id: 'b', name: 'read_range', input: '{"range":' };
    yield { type: 'tool_use', id: 'c', name: 'get_workbook_info', input: '' };
    yield { type: 'tool_use', id: 'd', name: 'find', input: { query: 'x' } };
  })() } };
  expect(await collect(aiChatStream([], { tools: [{}] }))).toEqual([
    { type: 'tool', id: 'a', name: 'read_range', input: { range: 'A1:B2' } },
    { type: 'tool', id: 'b', name: 'read_range', input: { __unreadable: '{"range":' } },
    { type: 'tool', id: 'c', name: 'get_workbook_info', input: {} },
    { type: 'tool', id: 'd', name: 'find', input: { query: 'x' } },
  ]);
});

it('says a reply was cut off when its closing token count reaches the limit', async () => {
  const stream = (usage) => async () => (async function* s() { yield { type: 'text', text: 'Hi' }; yield { type: 'usage', usage }; })();
  window.puter = { ai: { chat: stream({ input_tokens: 900, output_tokens: 32000 }) } };
  expect(await collect(aiChatStream([], { maxTokens: 32000 }))).toEqual([{ type: 'text', text: 'Hi' }, { type: 'cut' }]);
  window.puter = { ai: { chat: stream({ prompt_tokens: 900, completion_tokens: 32000 }) } };
  expect((await collect(aiChatStream([], { maxTokens: 32000 }))).at(-1)).toEqual({ type: 'cut' });
  window.puter = { ai: { chat: stream({ input_tokens: 900, output_tokens: 31999 }) } };
  expect(await collect(aiChatStream([], { maxTokens: 32000 }))).toEqual([{ type: 'text', text: 'Hi' }]);
  // Without a limit asked for, nothing is taken for one.
  window.puter = { ai: { chat: stream({ output_tokens: 32000 }) } };
  expect(await collect(aiChatStream([], {}))).toEqual([{ type: 'text', text: 'Hi' }]);
});

it('says a reply handed back whole was cut off by its finish reason', async () => {
  window.puter = { ai: { chat: async () => ({ message: { content: 'Hi' }, finish_reason: 'length' }) } };
  expect(await collect(aiChatStream([], { maxTokens: 32000 }))).toEqual([{ type: 'text', text: 'Hi' }, { type: 'cut' }]);
  window.puter = { ai: { chat: async () => ({ message: { content: 'Hi' }, finish_reason: 'stop' }) } };
  expect(await collect(aiChatStream([], { maxTokens: 32000 }))).toEqual([{ type: 'text', text: 'Hi' }]);
});

it('asks Puter for the output limit given', async () => {
  let options;
  window.puter = { ai: { chat: async (_m, o) => { options = o; return { message: { content: '' } }; } } };
  await collect(aiChatStream([], { maxTokens: 32000 }));
  expect(options.max_tokens).toBe(32000);
});

// The formula helper's one-shot ask let the SDK's failures through as they came: thrown as a plain object it read
// "unknown error", and handed back as the reply it was shown, and offered to be written into a cell, as "[object Object]".
it('fails a one-shot ask with the service\'s own words, thrown or handed back', async () => {
  window.puter = { ai: { chat: async () => { throw { success: false, error: { code: 'insufficient_funds', message: 'Insufficient funds' } }; } } };
  await expect(aiChat('hi')).rejects.toMatchObject({ message: 'Insufficient funds', code: 'insufficient_funds' });
  window.puter = { ai: { chat: async () => ({ success: false, error: { message: 'Model overloaded' } }) } };
  await expect(aiChat('hi')).rejects.toMatchObject({ message: 'Model overloaded' });
  window.puter = { ai: { chat: async () => ({ message: { content: '=SUM(A1:A3)' } }) } };
  expect(await aiChat('hi')).toBe('=SUM(A1:A3)');
});
