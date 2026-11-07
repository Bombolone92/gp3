import { zoomAt } from "./model.js";

export const NAVIGATION_MODES = ["auto", "mouse", "trackpad"];
export const navigationMode = (value) =>
  NAVIGATION_MODES.includes(value) ? value : "auto";

// Wheel events do not identify their device. Auto mode recognizes discrete
// wheel steps and keeps a whole scroll burst consistent; users can override it.
export function createWheelNavigation() {
  let detected = "trackpad",
    last = -Infinity;
  return (view, event, size, mode = "auto", now = performance.now()) => {
    const unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
    let dx = event.deltaX * unit,
      dy = event.deltaY * unit;
    if (![dx, dy].every(Number.isFinite)) return view;
    const modified = event.ctrlKey || event.metaKey;
    if (!modified && (now - last > 180 || event.deltaMode || event.deltaX)) {
      detected =
        event.deltaMode ||
        (!event.deltaX &&
          Math.abs(event.deltaY) >= 40 &&
          (event.deltaY % 100 === 0 || event.deltaY % 120 === 0))
          ? "mouse"
          : "trackpad";
    }
    last = now;
    const device = mode === "auto" ? detected : mode;
    if (modified || (device === "mouse" && !event.shiftKey && dy))
      return zoomAt(
        view,
        size.point,
        view.z * Math.exp(-dy * (modified ? 0.008 : 0.002)),
      );
    if (event.shiftKey && !dx) [dx, dy] = [dy, 0];
    return { ...view, x: view.x - dx, y: view.y - dy };
  };
}

// Zooming with the wheel about a point, at the canvas's rates: wheel steps
// in lines or pages count as pixels, and a pinch (Ctrl or Cmd) zooms faster
// than a mouse wheel.
export function wheelZoom(view, event, point, height) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1,
    dy = event.deltaY * unit;
  if (!Number.isFinite(dy) || !dy) return view;
  return zoomAt(
    view,
    point,
    view.z * Math.exp(-dy * (event.ctrlKey || event.metaKey ? 0.008 : 0.002)),
  );
}
export function pinchView(view, start, next) {
  const zoomed = zoomAt(
    view,
    start.center,
    (view.z * next.distance) / Math.max(1, start.distance),
  );
  return {
    ...zoomed,
    x: zoomed.x + next.center.x - start.center.x,
    y: zoomed.y + next.center.y - start.center.y,
  };
}

// Only active pointers are retained. Camera gestures never inspect board data.
export function createCanvasNavigation(api) {
  let canvas, session, timer, safariGesture;
  const touches = new Map();
  const wheel = createWheelNavigation();
  let mode = "auto";
  try {
    mode = navigationMode(localStorage.getItem("whiteboard-navigation"));
  } catch {}
  const state = () => api.state();
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Number.isFinite(e.clientX) ? e.clientX - r.left : r.width / 2,
      y: Number.isFinite(e.clientY) ? e.clientY - r.top : r.height / 2,
    };
  };
  const eventCopy = (e) => ({
    clientX: e.clientX,
    clientY: e.clientY,
    button: e.button,
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    currentTarget: canvas,
    preventDefault() {},
  });
  const clearTimer = () => {
    clearTimeout(timer);
    timer = null;
  };
  const capture = (id) => {
    try {
      canvas.setPointerCapture?.(id);
    } catch {}
  };
  const release = (id) => {
    try {
      if (canvas?.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    } catch {}
  };
  function clear() {
    clearTimer();
    const ids = [...touches.keys(), ...(session ? [session.pointer] : [])];
    session = safariGesture = null;
    touches.clear();
    ids.forEach(release);
  }
  function stop(cancel = false) {
    const s = session,
      g = safariGesture;
    clear();
    if (s && s.board === state().board) {
      if (s.kind === "direct") {
        if (cancel) api.cancel();
        else api.end();
      }
      if (cancel && s.touch) api.restoreSelection(s.selection);
      if (cancel && ["pan", "pinch"].includes(s.kind))
        api.navigate(s.originalView);
    }
    if (g && cancel && g.board === state().board) api.navigate(g.view);
    return !!(s || g);
  }
  const valid = () => session && session.board === state().board;
  function pair() {
    const [a, b] = [...touches.values()].slice(0, 2).map(local);
    return {
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  }
  function beginPinch() {
    clearTimer();
    if (session.kind === "direct") api.cancel();
    api.restoreSelection(session.selection);
    api.resetTap();
    session.kind = "pinch";
    session.view = { ...state().view };
    session.pair = pair();
  }
  function down(e) {
    if (e.currentTarget !== canvas) return;
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    if (safariGesture) stop();
    const touch = e.pointerType === "touch";
    // Ignore palms while the pen/mouse is in use and foreign mouse pointers.
    if (session && !session.touch) {
      if (touch || session.pointer !== e.pointerId) return;
      stop();
    }
    if (!touch && touches.size) return;
    e.preventDefault();
    if (touch && touches.has(e.pointerId)) return;
    if (touch && touches.size >= 3) return;
    capture(e.pointerId);
    if (touch) touches.set(e.pointerId, eventCopy(e));
    if (touch && touches.size > 1) {
      if (touches.size === 2) beginPinch();
      return;
    }
    api.prepare();
    const current = state();
    session = {
      board: current.board,
      tool: current.tool,
      pointer: e.pointerId,
      touch,
      kind: touch ? "pending" : "direct",
      event: eventCopy(e),
      originalView: { ...current.view },
      view: { ...current.view },
      selection: api.selection(),
    };
    if (!touch) {
      // Point tools complete on release. Beginning them here can save an
      // object or move focus before a cancelled mouse/pen press ends.
      if (e.button === 0 && api.deferTap?.(e)) {
        session.kind = "tap";
        return;
      }
      const canHold = e.button === 0 && !e.altKey && api.canMarquee?.();
      api.begin(e);
      if (canHold && api.canMarquee?.())
        timer = setTimeout(() => {
          if (!valid() || session.kind !== "direct" || !api.canMarquee?.())
            return;
          api.restoreSelection(session.selection);
          api.resetTap();
          api.begin(session.event, { marquee: true, precise: true });
        }, 500);
      return;
    }
    if (["pen", "arrow", "region"].includes(current.tool)) {
      session.kind = "direct";
      api.begin(e);
    } else if (current.tool === "hand") {
      session.kind = "pan";
    } else if (current.tool === "select") {
      // Selected objects/handles can be dragged; unselected content is safe to pan over.
      session.edit = api.touchEdit(e);
      timer = setTimeout(() => {
        if (!valid() || session.kind !== "pending" || touches.size !== 1)
          return;
        session.kind = "direct";
        api.resetTap();
        api.begin(session.event, { marquee: true, precise: true });
      }, 500);
    }
  }
  function move(e) {
    if (e.currentTarget !== canvas) return;
    if (!session) {
      if (e.pointerType !== "touch") api.hover?.(e);
      return;
    }
    if (!valid()) {
      clear();
      return;
    }
    if (session.touch) {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, eventCopy(e));
      e.preventDefault();
      if (session.kind === "pinch") {
        if (touches.size >= 2)
          api.navigate(pinchView(session.view, session.pair, pair()));
        return;
      }
    } else if (session.pointer !== e.pointerId) return;
    if (session.pointer !== e.pointerId) return;
    const dx = e.clientX - session.event.clientX,
      dy = e.clientY - session.event.clientY;
    if (!session.touch && Math.hypot(dx, dy) > 3) clearTimer();
    if (session.kind === "pending" && Math.hypot(dx, dy) > 6) {
      clearTimer();
      api.resetTap();
      if (session.edit) {
        session.kind = "direct";
        api.begin(session.event);
      } else session.kind = "pan";
    }
    if (session.kind === "pan") {
      api.navigate({
        ...session.view,
        x: session.view.x + dx,
        y: session.view.y + dy,
      });
    } else if (session.kind === "direct") api.move(e);
  }
  function up(e, cancelled = false) {
    if (e.currentTarget !== canvas) return;
    if (!valid()) {
      clear();
      return;
    }
    if (
      session.touch
        ? !touches.has(e.pointerId)
        : session.pointer !== e.pointerId
    )
      return;
    e.preventDefault();
    if (cancelled) {
      stop(true);
      return;
    }
    clearTimer();
    if (session.kind === "pinch") {
      // Rebase after a finger leaves, so lifting/replacing fingers never jumps
      // the camera and the remaining finger never starts editing an object.
      touches.delete(e.pointerId);
      release(e.pointerId);
      if (touches.size >= 2) {
        session.view = { ...state().view };
        session.pair = pair();
      } else if (touches.size === 1) {
        const [id, event] = touches.entries().next().value;
        session.pointer = id;
        session.event = event;
        session.kind = "pan";
        session.view = { ...state().view };
      } else clear();
      return;
    }
    const s = session;
    clear();
    if (s.kind === "tap" || s.kind === "pending") {
      if (s.kind === "tap") {
        if (state().tool !== s.tool || !api.deferTap?.(s.event)) return;
      }
      if (s.kind === "tap" || api.deferTap?.(s.event)) {
        const r = canvas.getBoundingClientRect();
        // Only use bounds when layout is available. Pointer capture also
        // delivers release events outside the originating canvas.
        if (
          r.width > 0 &&
          r.height > 0 &&
          !(
            e.clientX >= r.left &&
            e.clientX < r.left + r.width &&
            e.clientY >= r.top &&
            e.clientY < r.top + r.height
          )
        )
          return;
      }
      api.begin(s.event);
      api.end(e);
    } else if (s.kind === "direct") api.end(e);
  }
  function onWheel(e) {
    if (!canvas || !state().board) return;
    e.preventDefault();
    if (touches.size || safariGesture) return;
    stop();
    api.end();
    const r = canvas.getBoundingClientRect();
    api.navigate(
      wheel(
        state().view,
        e,
        { width: r.width, height: r.height || 150, point: local(e) },
        mode,
      ),
    );
  }
  function gesture(e) {
    if (e.currentTarget !== canvas) return;
    e.preventDefault();
    if (touches.size) return; // Pointer Events own touchscreen pinches.
    if (e.type === "gesturestart") {
      stop();
      api.end();
      safariGesture = {
        view: { ...state().view },
        board: state().board,
        point: local(e),
      };
    } else if (safariGesture && safariGesture.board === state().board) {
      if (Number.isFinite(e.scale) && e.scale > 0)
        api.navigate(
          zoomAt(
            safariGesture.view,
            safariGesture.point,
            safariGesture.view.z * e.scale,
          ),
        );
      if (e.type === "gestureend") safariGesture = null;
    }
  }
  return {
    wheel: onWheel,
    mode: () => mode,
    setMode(value) {
      mode = navigationMode(value);
      try {
        localStorage.setItem("whiteboard-navigation", mode);
      } catch {}
    },
    storage(e) {
      if (e.key === "whiteboard-navigation" || e.key === null)
        mode = navigationMode(e.newValue);
    },
    finish: () => stop(),
    cancel: () => stop(true),
    detach() {
      clear();
      canvas = null;
    },
    bind(element) {
      clear();
      canvas = element;
      element.addEventListener("pointerdown", down);
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", (e) => up(e));
      element.addEventListener("pointercancel", (e) => up(e, true));
      element.addEventListener("lostpointercapture", (e) => up(e, true));
      element.addEventListener("contextmenu", (e) => e.preventDefault());
      element.addEventListener(
        "wheel",
        (e) => {
          if (e.currentTarget === canvas) onWheel(e);
        },
        { passive: false },
      );
      for (const type of ["gesturestart", "gesturechange", "gestureend"])
        element.addEventListener(type, gesture, { passive: false });
    },
  };
}
