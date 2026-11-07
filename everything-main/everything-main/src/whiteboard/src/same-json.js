// Whether two values serialize to the same JSON. Successive projections of
// a board copy each unchanged object with the same values under the same
// keys, so comparing a large board with its previous projection finds those
// equal without serializing every object; anything else is serialized.
export function sameJSON(a, b) {
  if (a === b) return true;
  if (plain(a) && plain(b) && Array.isArray(a) === Array.isArray(b)) {
    const keys = Object.keys(a),
      others = Object.keys(b);
    if (
      keys.length === others.length &&
      keys.every((key, n) => key === others[n] && a[key] === b[key])
    )
      return true;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}
// Objects and arrays without a toJSON of their own, which serialize as
// their keys and values say.
function plain(value) {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return (
    (proto === Object.prototype || proto === Array.prototype) &&
    typeof value.toJSON !== "function"
  );
}
// Whether two plain data values hold the same data, whatever order their
// keys are in, without serializing them.
export function sameData(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    for (let n = 0; n < a.length; n++) if (!sameData(a[n], b[n])) return false;
    return true;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys)
    if (!Object.hasOwn(b, key) || !sameData(a[key], b[key])) return false;
  return true;
}
