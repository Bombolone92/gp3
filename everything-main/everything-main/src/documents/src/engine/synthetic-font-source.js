// Select the face CSS uses for normal text before synthesizing bold. A named
// face may be registered at 300 or 600 rather than 400. Unknown weight ranges
// stay outside this static-font path; the font transformer validates its data.
export function syntheticFontSource(sources, italic) {
  const candidates = sources.filter(face => {
    const weight = Number(face.descriptors?.weight || 400);
    return Number.isFinite(weight) && weight >= 100 && weight < 700;
  });
  const styled = candidates.filter(face => (face.descriptors?.style === 'italic') === italic);
  const available = styled.length ? styled : candidates.filter(face => face.descriptors?.style !== 'italic');
  const order = face => {
    const weight = Number(face.descriptors?.weight || 400);
    return weight >= 400 && weight <= 500 ? weight - 400 : weight < 400 ? 500 - weight : weight + 100;
  };
  return available.reduce((best, face) => !best || order(face) < order(best) ? face : best, undefined);
}
