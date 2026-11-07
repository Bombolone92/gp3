/**
 * Read aloud: the selected text, or the whole document, spoken through
 * Puter's text-to-speech. Speech synthesis takes a few thousand characters
 * at a time, so the text is cut into chunks at paragraph and sentence
 * breaks, each chunk is fetched while the previous one plays, and Stop
 * halts the lot.
 */

/** Puter speaks up to 3000 characters per request; leave room. */
export const SPEECH_CHUNK_MAX = 2800;
/** Reading a whole book at once is a mistake; this many chunks is plenty for one sitting. */
export const SPEECH_CHUNK_LIMIT = 12;

/**
 * Cut text into chunks of at most `max` UTF-16 units, preferring paragraph,
 * sentence, then word breaks. A single Unicode character is never split.
 */
export function splitForSpeech(text, max = SPEECH_CHUNK_MAX) {
  const clean = String(text || '').replace(/￼/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  const out = [];
  let buffer = '';
  const flush = () => { if (buffer.trim()) out.push(buffer.trim()); buffer = ''; };
  const pieces = clean.split(/\n+/).flatMap((para) => para.trim() ? sentences(para.trim()) : []);
  for (const piece of pieces) {
    if (piece.length > max) {
      flush();
      for (const part of hardSplit(piece, max)) out.push(part);
      continue;
    }
    if (buffer && buffer.length + 1 + piece.length > max) flush();
    buffer = buffer ? `${buffer} ${piece}` : piece;
  }
  flush();
  return out;
}

/** Sentences of a paragraph, keeping their punctuation. */
function sentences(para) {
  const parts = [];
  let start = 0;
  // Split only at existing whitespace after punctuation. Matching the text
  // between punctuation marks loses leading dots and breaks decimals/URLs.
  for (const match of para.matchAll(/(?:[.!?…]["'”’)]*\s+|[。！？][」』）]*)/g)) {
    const end = match.index + match[0].length;
    parts.push(para.slice(start, end).trim());
    start = end;
  }
  if (start < para.length) parts.push(para.slice(start).trim());
  return parts;
}

/** Cut an overlong run at word boundaries. */
function hardSplit(text, max) {
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let at = rest.lastIndexOf(' ', max);
    // Text without spaces (Chinese, Japanese) breaks after its punctuation rather than mid-word.
    if (at < max / 2) { const punctuation = rest.slice(0, max).search(/[、，。！？；：」』）][^、，。！？；：」』）]*$/); at = punctuation >= max / 4 ? punctuation + 1 : max; }
    const before = rest.charCodeAt(at - 1), after = rest.charCodeAt(at);
    if (before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF) {
      // Keep the pair together; even a one-unit limit must make progress.
      at += at === 1 ? 1 : -1;
    }
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * A reader: `start(text)` speaks it chunk by chunk and resolves true when it
 * finished on its own (false when stopped); `stop()` halts playback.
 * `speak(chunk)` resolves an HTMLAudioElement (Puter's txt2speech);
 * `onState` hears 'loading', 'playing', and 'idle'.
 */
export function createReader({ speak, onState = () => {}, chunkLimit = SPEECH_CHUNK_LIMIT, chunkMax = SPEECH_CHUNK_MAX }) {
  let run = 0;
  let current = null;
  let finish = null;
  /** The passage being fetched ahead of the one playing; released if reading stops first. */
  let prefetch = null;
  let state = 'idle';
  const set = (s) => { if (state !== s) { state = s; onState(s); } };

  const playToEnd = (audio) => new Promise((resolve, reject) => {
    let settled = false;
    const settle = (error = null) => {
      if (settled) return;
      settled = true;
      audio.removeEventListener?.('ended', done);
      audio.removeEventListener?.('error', failed);
      if (error) reject(error); else resolve();
    };
    const done = () => settle();
    const failed = () => settle(new Error(audio.error?.message || 'The audio could not be played'));
    finish = done;
    audio.addEventListener?.('ended', done);
    audio.addEventListener?.('error', failed);
    Promise.resolve().then(() => { if (!settled) return audio.play?.(); }).catch((error) => settle(error));
  });

  async function start(text) {
    stop();
    const mine = ++run;
    const chunks = splitForSpeech(text, chunkMax).slice(0, chunkLimit);
    if (!chunks.length) return false;
    set('loading');
    let next = Promise.resolve().then(() => speak(chunks[0]));
    prefetch = next;
    for (let i = 0; i < chunks.length; i++) {
      let audio;
      try {
        audio = await next;
        if (prefetch === next) prefetch = null;
      } catch (e) {
        if (prefetch === next) prefetch = null;
        if (mine !== run) return false;
        set('idle');
        throw e;
      }
      // Stopped while this passage was still being fetched: it must not start, and its media is released.
      if (mine !== run) { release(audio); return false; }
      if (i + 1 < chunks.length) { next = Promise.resolve().then(() => speak(chunks[i + 1])); next.catch(() => {}); prefetch = next; }
      current = audio;
      set('playing');
      if (mine !== run) return false;
      try {
        await playToEnd(audio);
      } catch (error) {
        if (mine !== run) return false;
        current = null;
        finish = null;
        set('idle');
        throw error;
      }
      if (mine !== run) return false;
      current = null;
      finish = null;
    }
    set('idle');
    return true;
  }

  /** Pause a passage and drop its media, so a stopped session does not keep every clip alive. */
  function release(audio) {
    try { audio?.pause?.(); audio?.removeAttribute?.('src'); audio?.load?.(); } catch { /* already gone */ }
  }

  function stop() {
    run += 1;
    if (current) { release(current); current = null; }
    if (prefetch) { prefetch.then(release, () => {}); prefetch = null; }
    finish?.();
    finish = null;
    set('idle');
  }

  return { start, stop, get state() { return state; } };
}

/** Whether the text would be cut short by the chunk limit. */
export function speechIsTruncated(text, { max = SPEECH_CHUNK_MAX, limit = SPEECH_CHUNK_LIMIT } = {}) {
  return splitForSpeech(text, max).length > limit;
}
