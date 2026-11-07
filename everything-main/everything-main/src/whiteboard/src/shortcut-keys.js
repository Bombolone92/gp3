// The letter a keyboard shortcut names. A key that types a Latin letter is
// named by that letter, so AZERTY's A and Dvorak's keys read as labelled. A
// key that types a letter of another script, such as Cyrillic or Greek, is
// named by its physical place, so Ctrl+Z still undoes and Ctrl+A still
// selects all there. Punctuation, digits and named keys read as themselves,
// so AZERTY's comma on the physical M key never opens the minimap.
export function shortcutLetter(e) {
  const key = (e.key || "").toLowerCase();
  if (/^[a-z]$/.test(key) || !/^\p{L}$/u.test(key)) return key;
  const physical = /^Key([A-Z])$/.exec(e.code || "");
  return physical ? physical[1].toLowerCase() : key;
}
