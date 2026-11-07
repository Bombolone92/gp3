// Profile-based conversions for the Info panel readouts (loaded on first
// use with the color engine): CMYK, Lab, grayscale, total ink, proof values
// and the document profile name.
import type { DocumentSession } from '../../app/session';
import type { PhotoDocument } from '../../model/document';
import { builtinProfile, cachedTransform, decodeLab } from '../../color/color-management';
import { docCmykProfile, docCmykRef, docGrayProfile, docProfile, docProfileName, ensureProfile, profileFromRef, profileReady } from '../color/profiles';
import { proofState } from '../color/proof';

/** Profiles still being built for these conversions (await before reading). */
export function pending(doc: PhotoDocument, session: DocumentSession): Promise<unknown> | null {
  const refs = [docCmykRef(doc)];
  const setup = proofState(session).setup;
  if (setup.kind !== 'monitor') refs.push(setup.ref);
  const missing = refs.filter((r) => !profileReady(r));
  return missing.length ? Promise.all(missing.map((r) => ensureProfile(r))) : null;
}

const unit = (rgb: ArrayLike<number>) => [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
export function cmyk(doc: PhotoDocument, rgb: ArrayLike<number>): number[] {
  return cachedTransform(docProfile(doc), docCmykProfile(doc), 'relative', { bpc: true }).one(unit(rgb)).map((v) => v * 100);
}
export function lab(doc: PhotoDocument, rgb: ArrayLike<number>): number[] {
  return Array.from(decodeLab(cachedTransform(docProfile(doc), builtinProfile('lab-d50'), 'relative').one(unit(rgb)), 'v4'));
}
/** Gray ink coverage (K %) in the document's grayscale profile. */
export function gray(doc: PhotoDocument, rgb: ArrayLike<number>): number {
  const [g] = cachedTransform(docProfile(doc), docGrayProfile(doc), 'relative', { bpc: true }).one(unit(rgb));
  return (1 - g) * 100;
}
/** Device values of the proof setup's profile for a document color. */
export function proof(doc: PhotoDocument, session: DocumentSession, rgb: ArrayLike<number>): { space: 'RGB' | 'CMYK' | 'GRAY'; values: number[] } {
  const setup = proofState(session).setup;
  if (setup.kind === 'monitor') return { space: 'RGB', values: [rgb[0], rgb[1], rgb[2]] };
  const p = profileFromRef(setup.ref);
  const out = cachedTransform(docProfile(doc), p, setup.intent, { bpc: setup.bpc }).one(unit(rgb));
  if (p.colorSpace === 'CMYK') return { space: 'CMYK', values: out.map((v) => v * 100) };
  if (p.colorSpace === 'GRAY') return { space: 'GRAY', values: [(1 - out[0]) * 100] };
  return { space: 'RGB', values: out.slice(0, 3).map((v) => v * 255) };
}
export const profileName = (doc: PhotoDocument) => docProfileName(doc);
