// Deterministic per-card tilt. Must never use Math.random(): render() rebuilds
// the whole board on every move, so a random value would make the entire deck
// twitch on every click.
export function tiltFor(cardId) {
  if (!cardId) return 0;
  let h = 0;
  for (let i = 0; i < cardId.length; i++) {
    h = (h * 31 + cardId.charCodeAt(i)) | 0;
  }
  const normalized = ((h % 100) + 100) % 100;  // 0..99, never negative
  return Number((((normalized / 99) - 0.5) * 1.2).toFixed(3));
}
