/** Ephemeral pointer interaction. Presentation content is never changed. */
export function createSlideLaserPointer(frame, { appearance, onError }) {
  const document = frame.ownerDocument;
  const window = document.defaultView;
  const controller = new AbortController();
  const dot = document.createElement("div");
  dot.className = "presenter-laser";
  dot.setAttribute("aria-hidden", "true");
  dot.hidden = true;
  frame.append(dot);
  let enabled = false;
  let pointer = null;
  let temporary = false;
  let suppressClick = false;
  let disposed = false;
  let pointBox = null;

  const listen = (target, name, handler, options = {}) =>
    target.addEventListener(name, handler, {
      ...options,
      signal: controller.signal,
    });
  function release() {
    const id = pointer;
    pointer = null;
    temporary = false;
    if (id !== null && frame.hasPointerCapture(id))
      frame.releasePointerCapture(id);
  }
  function hide() {
    dot.hidden = true;
    frame.classList.remove("laser-pointing");
    release();
  }
  function color() {
    const value = appearance();
    dot.style.backgroundColor = value.color;
    dot.style.color = value.color;
    dot.style.opacity = String(value.opacity);
  }
  function position(event) {
    if (disposed || (!enabled && !temporary)) return;
    const box = frame.getBoundingClientRect();
    pointBox = box;
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    if (
      !box.width ||
      !box.height ||
      x < 0 ||
      y < 0 ||
      x > box.width ||
      y > box.height
    ) {
      dot.hidden = true;
      frame.classList.remove("laser-pointing");
      return;
    }
    dot.style.left = `${(x / box.width) * 100}%`;
    dot.style.top = `${(y / box.height) * 100}%`;
    dot.hidden = false;
    frame.classList.add("laser-pointing");
  }
  listen(
    frame,
    "pointerdown",
    (event) => {
      // A new ordinary gesture cannot inherit suppression from a cancelled one.
      if (!enabled && !(event.ctrlKey && event.button === 0)) {
        suppressClick = false;
        return;
      }
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = true;
      try {
        if (!enabled) color();
      } catch (error) {
        onError(error);
        return;
      }
      release();
      pointer = event.pointerId;
      temporary = !enabled;
      frame.setPointerCapture(pointer);
      position(event);
    },
    { capture: true },
  );
  listen(frame, "pointermove", (event) => {
    if (!event.isPrimary) return;
    if (pointer !== null && event.pointerId !== pointer) return;
    position(event);
  });
  listen(
    frame,
    "pointerup",
    (event) => {
      if (event.pointerId !== pointer) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      release();
      if (!enabled || event.pointerType === "touch") hide();
      else position(event);
    },
    { capture: true },
  );
  listen(frame, "pointercancel", (event) => {
    if (event.pointerId === pointer) hide();
  });
  listen(frame, "lostpointercapture", (event) => {
    if (event.pointerId === pointer) hide();
  });
  listen(frame, "pointerleave", () => {
    dot.hidden = true;
    frame.classList.remove("laser-pointing");
  });
  listen(
    frame,
    "click",
    (event) => {
      if (!enabled && !suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true },
  );
  // Some hosts turn Control-click into a context menu. A pointing gesture
  // must consume that default too, while ordinary context menus stay available.
  listen(
    frame,
    "contextmenu",
    (event) => {
      if (!temporary && !(event.ctrlKey && suppressClick)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true },
  );
  // Compatibility TouchEvents must not feed the presenter's swipe recognizer
  // after the pointing gesture has already been handled as PointerEvents.
  for (const name of ["touchstart", "touchmove", "touchend", "touchcancel"])
    listen(
      frame,
      name,
      (event) => {
        if (!enabled && !temporary && !suppressClick) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      { capture: true, passive: false },
    );
  listen(window, "keyup", (event) => {
    if (event.key === "Control" && temporary) hide();
  });
  listen(window, "blur", hide);
  const resize = new ResizeObserver(() => {
    if (dot.hidden || !pointBox) return;
    const box = frame.getBoundingClientRect();
    if (
      ["left", "top", "width", "height"].some(
        (key) => box[key] !== pointBox[key],
      )
    )
      hide();
  });
  resize.observe(frame);

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(value) {
      if (disposed) return;
      if (value) color();
      enabled = !!value;
      hide();
      frame.classList.toggle("laser-mode", enabled);
    },
    hide,
    dispose() {
      if (disposed) return;
      disposed = true;
      hide();
      controller.abort();
      resize.disconnect();
      frame.classList.remove("laser-mode");
      dot.remove();
    },
  };
}
