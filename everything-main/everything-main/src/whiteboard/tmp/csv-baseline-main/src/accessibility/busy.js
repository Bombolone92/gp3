// Disables a control while its action runs and returns a function that
// enables it again. Browsers move keyboard focus to the page when the
// focused control is disabled, so focus comes back to it afterwards, unless
// the action moved focus on purpose or the control is no longer shown.
export function busy(control) {
  if (!control) return () => {};
  const doc = control.ownerDocument,
    focused = doc.activeElement === control;
  control.disabled = true;
  return () => {
    control.disabled = false;
    const active = doc.activeElement;
    if (
      focused &&
      (!active || active === doc.body) &&
      control.isConnected &&
      !control.closest("dialog:not([open])")
    )
      control.focus();
  };
}
