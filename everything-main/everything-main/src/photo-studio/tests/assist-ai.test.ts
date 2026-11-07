// Generate Image, Edit with Prompt and the AI detail pass of Upscale with a
// mocked Puter SDK: what is sent, how many requests, sizes and failures.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rgba8, type RGBA8 } from '../src/imaging/types';
import { aiCodec, aiUpscale, editImage, generateImages, requestSize, UPSCALE_MODEL } from '../src/imaging/ai/puter-ai';

const g = globalThis as unknown as { puter?: unknown };
const codec = { ...aiCodec };
let encoded: { width: number; height: number }[] = [];
beforeEach(() => {
  encoded = [];
  aiCodec.toDataUri = async (img: RGBA8) => {
    encoded.push({ width: img.width, height: img.height });
    return `data:image/png;base64,${img.width}x${img.height}`;
  };
  // The "provider" returns 1024 x 768 images whose red channel tags the call.
  aiCodec.decode = async (res, w, h) => {
    const tag = Number(String((res as { src: string }).src).split('#')[1] ?? 0);
    return rgba8(w ?? 1024, h ?? 768, [tag, 0, 0, 255]);
  };
});
afterEach(() => {
  delete g.puter;
  Object.assign(aiCodec, codec);
});
function mockPuter(fail: (k: number) => unknown = () => undefined) {
  let k = 0;
  const txt2img = vi.fn(async () => {
    const n = ++k, err = fail(n);
    if (err) throw err;
    return { src: `https://example.invalid/img#${n}` };
  });
  g.puter = { ai: { txt2img, chat: vi.fn() } };
  return txt2img;
}

describe('Generate Image', () => {
  it('sends one request per variation with the requested aspect ratio', async () => {
    const txt2img = mockPuter();
    const out = await generateImages('a lighthouse at dusk', { width: 3000, height: 2000, count: 3, model: 'gpt-image-2', quality: 'medium' });
    expect(out).toHaveLength(3);
    expect(txt2img).toHaveBeenCalledTimes(3);
    const [prompt, opts] = txt2img.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(prompt).toBe('a lighthouse at dusk');
    expect(opts).toMatchObject({ model: 'gpt-image-2', quality: 'medium', ratio: { w: 1536, h: 1024 }, test_mode: false });
    expect(opts.input_image).toBeUndefined();
    // Distinct results come back at the provider's size.
    expect(new Set(out.map((i) => i.data[0])).size).toBe(3);
    expect([out[0].width, out[0].height]).toEqual([1024, 768]);
  });
  it('keeps the variations that succeeded and reports when all fail', async () => {
    mockPuter((k) => (k === 2 ? { code: 'upstream_failed', message: 'busy' } : undefined));
    expect(await generateImages('x', { width: 512, height: 512, count: 3 })).toHaveLength(2);
    mockPuter(() => ({ code: 'insufficient_funds' }));
    await expect(generateImages('x', { width: 512, height: 512, count: 2 })).rejects.toMatchObject({ code: 'funds' });
    mockPuter(() => ({ code: 'moderation_flagged' }));
    await expect(generateImages('x', { width: 512, height: 512 })).rejects.toMatchObject({ code: 'moderation' });
  });
  it('never calls Puter without a prompt or after cancelling', async () => {
    const txt2img = mockPuter();
    await expect(generateImages('  ', { width: 64, height: 64 })).rejects.toMatchObject({ code: 'bad-request' });
    const ac = new AbortController();
    ac.abort();
    await expect(generateImages('cat', { width: 64, height: 64, signal: ac.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(txt2img).not.toHaveBeenCalled();
    delete g.puter;
    await expect(generateImages('cat', { width: 64, height: 64 })).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('clamps variation counts and request sizes', async () => {
    const txt2img = mockPuter();
    await generateImages('cat', { width: 100, height: 100, count: 9 });
    expect(txt2img).toHaveBeenCalledTimes(4);
    expect(requestSize(8000, 1000)).toEqual({ w: 1536, h: 192 });
    expect(requestSize(10, 10)).toEqual({ w: 64, h: 64 });
  });
});

describe('Edit with Prompt', () => {
  it('sends the image downscaled with the instruction and returns results at the input size', async () => {
    const txt2img = mockPuter();
    const img = rgba8(2048, 1024, [10, 20, 30, 255]);
    const out = await editImage(img, 'make it snow', { count: 2, model: 'gemini-3.1-flash-image' });
    expect(encoded).toEqual([{ width: 1024, height: 512 }]);
    expect(txt2img).toHaveBeenCalledTimes(2);
    const [prompt, opts] = txt2img.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(prompt).toContain('make it snow');
    expect(opts).toMatchObject({ model: 'gemini-3.1-flash-image', ratio: { w: 1024, h: 512 }, input_image: 'data:image/png;base64,1024x512' });
    expect(out.map((i) => [i.width, i.height])).toEqual([[2048, 1024], [2048, 1024]]);
  });
  it('requires an instruction', async () => {
    const txt2img = mockPuter();
    await expect(editImage(rgba8(8, 8), '')).rejects.toMatchObject({ code: 'bad-request' });
    expect(txt2img).not.toHaveBeenCalled();
  });
});

describe('AI Upscale detail pass', () => {
  it('asks the high-resolution model for the target size and returns the native result', async () => {
    const txt2img = mockPuter();
    const out = await aiUpscale(rgba8(3000, 1500), 6000, 3000);
    expect(encoded).toEqual([{ width: 2048, height: 1024 }]);
    const [prompt, opts] = txt2img.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(prompt).toMatch(/higher resolution/);
    expect(opts).toMatchObject({ model: UPSCALE_MODEL, quality: '4K', ratio: { w: 6000, h: 3000 } });
    expect([out.width, out.height]).toEqual([1024, 768]);
    mockPuter();
    await aiUpscale(rgba8(500, 500), 1000, 1000);
  });
});
