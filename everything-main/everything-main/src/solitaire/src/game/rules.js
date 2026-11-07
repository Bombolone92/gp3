import { RANK_VAL } from './deck.js';

export function canPlaceOnTableau(card, target) {
  if (!target.length) return card.rank === 'K';
  const top = target[target.length - 1];
  if (!top.faceUp) return false;
  if (top.color === card.color) return false;
  return RANK_VAL[top.rank] === RANK_VAL[card.rank] + 1;
}

export function canPlaceOnFoundation(card, target) {
  if (!target.length) return card.rank === 'A';
  const top = target[target.length - 1];
  if (top.suit !== card.suit) return false;
  return RANK_VAL[card.rank] === RANK_VAL[top.rank] + 1;
}

export function isWon(game) {
  return game.foundations.every(f => f.length === 13);
}
