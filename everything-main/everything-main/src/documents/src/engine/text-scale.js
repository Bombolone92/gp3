export function checkedTextScale(value) {
  if (!Number.isInteger(value) || value < 1 || value > 600) throw new Error('Text width must be a whole percentage from 1 to 600.');
  return value;
}
