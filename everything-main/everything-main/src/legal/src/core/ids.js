/** Short, sortable, collision-resistant ids: time prefix plus random suffix. */
export function newId() {
  const t = Date.now().toString(36).padStart(9, '0');
  const r = new Uint8Array(8);
  crypto.getRandomValues(r);
  let s = '';
  for (const b of r) s += (b % 36).toString(36);
  return t + s;
}
