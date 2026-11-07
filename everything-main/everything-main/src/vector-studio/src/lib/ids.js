/** Short unique ids: a random prefix per session plus a counter. */
const prefix = Math.random().toString(36).slice(2, 6);
let counter = 0;

export function uid(kind = 'n') {
  counter++;
  return `${kind}${prefix}${counter.toString(36)}`;
}
