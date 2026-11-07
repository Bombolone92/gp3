/**
 * Extract audio: the sound of a video clip as a WAV file of its own, for
 * the media library. The timeline is not touched.
 */
import { decodeClipSound } from './audio-analysis.js';
import { encodeWav } from './wav.js';

/** File name for a clip's extracted sound: "<name> audio.wav", without the video's extension. */
export function extractedName(name) {
  const base = String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '').trim() || 'Clip';
  return `${base.slice(0, 100)} audio.wav`;
}

/**
 * Decode the source range the clip plays and encode it as 16-bit WAV.
 * Returns { file, seconds } or null when there is no sound. The range is
 * read at normal speed: a sped-up or slowed-down clip gives the sound of
 * the source it covers, not retimed, and volume, fades and audio effects
 * are not applied (the file is the clean source sound).
 * open: asset => source (audio-mix mediabunnyOpener(library) or a test stub).
 */
export async function extractClipAudio(open, asset, clip, { name, signal, onProgress, maxSeconds = 3 * 3600 } = {}) {
  const sound = await decodeClipSound(open, asset, clip, { maxSeconds, signal, onProgress });
  const frames = sound?.channels[0]?.length || 0;
  if (!frames) return null;
  const blob = encodeWav(sound.channels, sound.sampleRate);
  const file = new File([blob], extractedName(name ?? clip.name ?? asset.name), { type: 'audio/wav' });
  return { file, seconds: frames / sound.sampleRate };
}
