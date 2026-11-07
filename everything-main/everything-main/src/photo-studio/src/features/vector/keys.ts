// Space is tracked globally so tools can reposition a shape while dragging.
let space = false;
let installed = false;
export function installKeys() {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', (ev) => {
    if (ev.code === 'Space') space = true;
  });
  document.addEventListener('keyup', (ev) => {
    if (ev.code === 'Space') space = false;
  });
  window.addEventListener('blur', () => (space = false));
}
export const spaceHeld = () => space;
