/**
 * Pictures from a description through Puter AI (puter.ai.txt2img). The SDK
 * answers with an <img>; its source (a data URL or a web address) is read
 * into a Blob, cropped to the chosen frame shape and imported as media.
 */
import { errorMessage } from './transcribe.js';

export const PROMPT_MAX = 1000;

export const IMAGE_ASPECTS = [
  { id: '16:9', label: '16:9', w: 16, h: 9 },
  { id: '9:16', label: '9:16', w: 9, h: 16 },
  { id: '1:1', label: '1:1', w: 1, h: 1 },
  { id: '4:3', label: '4:3', w: 4, h: 3 },
  { id: '3:4', label: '3:4', w: 3, h: 4 },
];

export const IMAGE_STYLES = [
  { id: 'none', label: 'Any style', phrase: '' },
  { id: 'photo', label: 'Photo', phrase: 'photorealistic photograph, natural light, high detail' },
  { id: 'cinematic', label: 'Cinematic', phrase: 'cinematic film still, dramatic lighting, shallow depth of field' },
  { id: 'illustration', label: 'Illustration', phrase: 'clean digital illustration, vibrant colors' },
  { id: 'flat', label: 'Flat graphic', phrase: 'flat vector graphic, simple shapes, solid colors' },
  { id: '3d', label: '3D render', phrase: 'soft 3D render, studio lighting' },
  { id: 'watercolor', label: 'Watercolor', phrase: 'watercolor painting on paper' },
  { id: 'backdrop', label: 'Backdrop', phrase: 'abstract background for a video, no text, no people, room for titles' },
];

/** The prompt sent to the model: the description plus the style's phrase. */
export function buildPrompt(text, styleId = 'none') {
  const t = String(text || '').trim().slice(0, PROMPT_MAX);
  if (!t) return '';
  const style = IMAGE_STYLES.find((s) => s.id === styleId);
  return style?.phrase ? `${t}. Style: ${style.phrase}.` : t;
}

/** The aspect closest to a project's width/height. */
export function aspectForSize(width, height) {
  const r = width / height;
  return IMAGE_ASPECTS.reduce((best, a) => (Math.abs(Math.log(a.w / a.h / r)) < Math.abs(Math.log(best.w / best.h / r)) ? a : best), IMAGE_ASPECTS[0]);
}

/**
 * The picture models the AI assistant offers (from Puter's catalog); every
 * one can also change a picture it is given (input_image). 'default' sends
 * no model and lets Puter choose (GPT Image 2). options go with each request.
 */
export const IMAGE_MODELS = [
  { id: 'default', label: 'GPT Image 2', hint: "Puter's default", model: null },
  { id: 'gpt-image-2.5', label: 'GPT Image 2.5', hint: 'Newest from OpenAI', model: 'gpt-image-2.5-sunburst', options: { quality: 'medium' } },
  { id: 'gemini-3-pro', label: 'Gemini 3 Pro Image', hint: 'Detailed, good with text', model: 'gemini-3-pro-image' },
  { id: 'nano-banana-2.1', label: 'Nano Banana 2.1', hint: 'Fast, strong at edits', model: 'gemini-nano-banana-2.1' },
  { id: 'seedream-5-pro', label: 'Seedream 5.0 Pro', hint: 'ByteDance, photoreal', model: 'dola-seedream-5-0-pro-260628' },
];
export const DEFAULT_IMAGE_MODEL = 'default';
export const imageModel = (id) => IMAGE_MODELS.find((m) => m.id === id) || IMAGE_MODELS[0];

/** The model fields of a txt2img request for an IMAGE_MODELS id (none for the default). */
export function imageModelOptions(id) {
  const m = imageModel(id);
  return m.model ? { model: m.model, ...m.options } : {};
}

/** Options for puter.ai.txt2img. */
export function txt2imgOptions(aspectId, { testMode = false, model = DEFAULT_IMAGE_MODEL } = {}) {
  const a = IMAGE_ASPECTS.find((x) => x.id === aspectId) || IMAGE_ASPECTS[0];
  return { ratio: { w: a.w, h: a.h }, ...imageModelOptions(model), ...(testMode ? { test_mode: true } : {}) };
}

/** A user-facing message for a failed request. */
export function imageErrorMessage(err) {
  const code = String(err?.code || err?.error?.code || '');
  if (code === 'moderation_flagged') return 'The request was declined by the content filter. Try a different description.';
  if (code === 'insufficient_funds') return 'Your Puter balance is too low to create a picture.';
  if (code === 'network_error' || code === 'request_timeout' || err instanceof TypeError) return 'The AI service could not be reached. Check your connection and try again.';
  return errorMessage(err, "Couldn't create the picture. Try again.");
}

/** A short file name from the description: "a red fox in snow" -> "a red fox in snow.png". */
export function imageFileName(prompt, ext = 'png') {
  const stem = String(prompt || '').replace(/[\\/:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ').slice(0, 48).trim();
  return `${stem || 'Generated picture'}.${ext}`;
}

/** Decode a data URL into a Blob, or null when src is not one. */
export function dataUrlToBlob(src) {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(String(src || ''));
  if (!m) return null;
  const type = m[1] || 'application/octet-stream';
  let bytes;
  if (m[2]) {
    const bin = atob(m[3].replace(/\s/g, ''));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
  return new Blob([bytes], { type });
}

/** The picture behind what txt2img returned (an <img>, or a source string). */
export async function imageBlobFrom(result, fetchFn = globalThis.fetch) {
  const src = typeof result === 'string' ? result : result?.currentSrc || result?.src || result?.getAttribute?.('src') || '';
  if (!src) throw new Error('No picture came back. Try again.');
  let blob = dataUrlToBlob(src);
  if (!blob) {
    let res;
    try {
      res = await fetchFn(src, { mode: 'cors', credentials: 'omit' });
    } catch {
      throw new Error("The picture couldn't be downloaded.");
    }
    if (!res?.ok) throw new Error("The picture couldn't be downloaded.");
    blob = await res.blob();
  }
  if (!blob.size || (blob.type && !blob.type.startsWith('image/'))) throw new Error('The answer was not a picture.');
  return blob;
}

/**
 * Center-crop a picture to aspect w:h (providers do not always honor the
 * requested shape). Returns the original Blob when it already fits.
 */
export async function cropToAspect(blob, w, h) {
  if (typeof createImageBitmap !== 'function') return blob;
  const bmp = await createImageBitmap(blob);
  try {
    const want = w / h;
    const have = bmp.width / bmp.height;
    if (Math.abs(Math.log(have / want)) < 0.02) return blob;
    const cw = have > want ? Math.round(bmp.height * want) : bmp.width;
    const ch = have > want ? bmp.height : Math.round(bmp.width / want);
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const g = c.getContext('2d');
    if (!g) return blob;
    g.drawImage(bmp, (bmp.width - cw) / 2, (bmp.height - ch) / 2, cw, ch, 0, 0, cw, ch);
    const out = await new Promise((r) => c.toBlob(r, 'image/png'));
    return out || blob;
  } finally {
    bmp.close?.();
  }
}

/** Create a picture: { blob, prompt }. Throws Errors with readable messages. */
export async function generateImage(text, { aspect = '16:9', style = 'none', model = DEFAULT_IMAGE_MODEL, testMode = false } = {}) {
  const prompt = buildPrompt(text, style);
  if (!prompt) throw new Error('Describe the picture first.');
  if (typeof puter === 'undefined' || !puter.ai?.txt2img) throw new Error('Picture generation needs Puter.');
  let result;
  try {
    result = await puter.ai.txt2img(prompt, txt2imgOptions(aspect, { testMode, model }));
  } catch (err) {
    throw new Error(imageErrorMessage(err));
  }
  const a = IMAGE_ASPECTS.find((x) => x.id === aspect) || IMAGE_ASPECTS[0];
  const raw = await imageBlobFrom(result);
  const blob = await cropToAspect(raw, a.w, a.h).catch(() => raw);
  return { blob, prompt: String(text).trim() };
}
