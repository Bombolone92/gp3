import { plural, t, labelled } from "./i18n.js";

export function createMindCollapse(api) {
  let root,
    pressed,
    blocked = false;
  const buttons = new Map();
  const cancel = () => {
    pressed = null;
    blocked = true;
  };
  function current(id) {
    const s = api.state();
    return (
      s.enabled &&
      s.scene.branches.has(id) &&
      s.scene.visible.find((i) => i.id === id)
    );
  }
  function matches() {
    const node = pressed && current(pressed.id);
    return (
      node &&
      api.state().board === pressed.board &&
      !!node.mindCollapsed === pressed.collapsed &&
      JSON.stringify(node.mindMap) === pressed.metadata
    );
  }
  function buttonFor(id) {
    if (buttons.has(id)) return buttons.get(id);
    const button = root.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "quick-port mind-collapse";
    button.dataset.mindCollapse = id;
    const label = root.ownerDocument.createElement("span");
    label.setAttribute("aria-hidden", "true");
    button.append(label);
    button.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || pressed) return;
      const node = current(id);
      if (!node) return;
      e.preventDefault();
      e.stopPropagation();
      blocked = false;
      pressed = {
        id,
        board: api.state().board,
        collapsed: !!node.mindCollapsed,
        metadata: JSON.stringify(node.mindMap),
        x: e.clientX,
        y: e.clientY,
        pointer: e.pointerId,
        ready: false,
      };
      try {
        button.setPointerCapture?.(e.pointerId);
      } catch {}
    });
    button.addEventListener("pointermove", (e) => {
      if (
        pressed?.pointer === e.pointerId &&
        Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 8
      )
        cancel();
    });
    button.addEventListener("pointerup", (e) => {
      if (pressed?.pointer !== e.pointerId) return;
      if (
        !matches() ||
        Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 8
      )
        return cancel();
      pressed.ready = true;
    });
    button.addEventListener("pointercancel", (e) => {
      if (pressed && pressed.pointer === e.pointerId) cancel();
    });
    button.addEventListener("lostpointercapture", (e) => {
      if (pressed && pressed.pointer === e.pointerId && !pressed.ready)
        cancel();
    });
    button.addEventListener("click", (e) => {
      if (
        !current(id) ||
        (e.detail &&
          (blocked ||
            !pressed?.ready ||
            pressed.id !== id ||
            (e.pointerId != null && e.pointerId !== pressed.pointer) ||
            !matches()))
      )
        return;
      pressed = null;
      api.toggle(id);
      buttons.get(id)?.focus({ preventScroll: true });
    });
    button.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel();
        api.focus();
      } else if (["Enter", " "].includes(e.key)) {
        e.stopPropagation();
        if (e.repeat) e.preventDefault();
      }
    });
    buttons.set(id, button);
    root.append(button);
    return button;
  }
  function render() {
    if (!root?.isConnected) return;
    const s = api.state(),
      keep = new Set();
    root.hidden = !s.enabled;
    if (pressed && !matches()) cancel();
    if (s.enabled) {
      // Always retain the selected/hovered control, and bound the remaining DOM.
      const preferred = new Set([s.selected, s.hovered]);
      // No control marks a branch hidden from this person.
      const candidates = s.scene.visible.filter(
        (i) =>
          s.scene.branches.has(i.id) &&
          !s.concealed?.has(i.id) &&
          (i.mindCollapsed || preferred.has(i.id)),
      );
      candidates.sort(
        (a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)),
      );
      for (const i of candidates) {
        const w = i.w * s.view.z,
          h = i.h * s.view.z;
        const x = s.view.x + i.x * s.view.z + w / 2 + Math.max(w / 2 + 30, 44);
        const y = s.view.y + i.y * s.view.z + h / 2 - Math.max(h / 2 + 30, 44);
        if (x < 22 || y < 22 || x > s.size.width - 22 || y > s.size.height - 22)
          continue;
        if (keep.size >= 400) break;
        keep.add(i.id);
        const button = buttonFor(i.id),
          count = s.scene.counts.get(i.id);
        const label = i.mindCollapsed
          ? `${labelled(t("Expand branch"), "")}${plural(count.nodes, "{count} hidden node", "{count} hidden nodes")}, ${plural(count.comments, "{count} hidden comment", "{count} hidden comments")}`
          : t("Collapse branch");
        button.firstChild.textContent = i.mindCollapsed
          ? String(count.total)
          : "−";
        button.setAttribute("aria-label", label);
        button.setAttribute("aria-expanded", String(!i.mindCollapsed));
        button.title = label;
        button.style.left = `${x}px`;
        button.style.top = `${y}px`;
      }
    }
    for (const [id, button] of buttons)
      if (!keep.has(id)) {
        button.remove();
        buttons.delete(id);
      }
  }
  return {
    cancel,
    render,
    bind(element) {
      root = element;
      buttons.clear();
      cancel();
      root.setAttribute("aria-label", t("Mind map branches"));
    },
  };
}
