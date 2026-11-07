import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createTimerUI } from "../src/timer-ui.js";
import { changeTimer } from "../src/timer.js";
function setup(timer) {
  const dom = new JSDOM(
    '<div class="canvas-wrap"><button data-timer-access><span class="timer-badge"></span></button></div>',
  );
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const state = {
    board: { id: "board", timer },
    now: 10000,
    writes: 0,
    writable: true,
    toasts: [],
  };
  Object.defineProperty(state.board, "items", {
    get() {
      throw Error("Timer display must not scan or redraw the canvas");
    },
  });
  const ui = createTimerUI({
    board: () => state.board,
    now: () => state.now,
    canEdit: () => state.writable,
    toast: (s) => state.toasts.push(s),
    save(timer) {
      state.writes++;
      state.board.timer = timer;
    },
  });
  ui.bind();
  const doc = dom.window.document,
    query = (q) => doc.querySelector(q);
  return {
    state,
    ui,
    doc,
    w: dom.window,
    query,
    submit() {
      query("form").dispatchEvent(
        new dom.window.Event("submit", { cancelable: true }),
      );
    },
    close() {
      ui.detach();
      dom.window.close();
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    },
  };
}
test("timer display preserves input and DOM, makes no tick writes, and announces expiry once while minimized", () => {
  const a = setup();
  try {
    a.ui.open();
    const input = a.query("#timer-minutes"),
      output = a.query("#timer-countdown");
    input.value = "2";
    input.dispatchEvent(new a.w.Event("input"));
    for (let n = 0; n < 50; n++) {
      a.state.now += 1000;
      a.ui.render();
    }
    assert.equal(input.value, "2");
    assert.equal(a.state.writes, 0);
    a.submit();
    assert.equal(a.state.writes, 1);
    a.query("#timer-minimize").click();
    a.state.now += 119500;
    a.ui.render();
    assert.equal(a.query(".timer-badge").textContent, "0:01");
    assert.equal(a.query("#workshop-timer").hidden, true);
    a.state.now += 1000;
    a.ui.render();
    a.ui.render();
    assert.equal(a.query("#timer-countdown"), output);
    assert.deepEqual(a.state.toasts, ["Time’s up."]);
    assert.equal(a.state.writes, 1);
    a.ui.bind();
    a.ui.render();
    assert.equal(a.state.toasts.length, 1, "Rebinding does not replay expiry");
    a.state.board.timer = changeTimer(undefined, "start", {
      now: a.state.now,
      duration: 1000,
    });
    a.ui.render();
    a.ui.detach();
    a.state.now += 2000;
    a.ui.bind();
    assert.equal(
      a.state.toasts.length,
      1,
      "A timer that expired while away does not replay an alert",
    );
  } finally {
    a.close();
  }
});
test("viewers cannot force timer mutations, including after demotion, and stale boards detach", () => {
  const a = setup();
  try {
    a.ui.open();
    a.state.writable = false;
    a.ui.render();
    assert.equal(a.query("#timer-start").disabled, true);
    a.submit();
    assert.equal(a.state.writes, 0);
    a.state.board.timer = changeTimer(undefined, "start", { now: a.state.now });
    a.ui.render();
    a.query('[data-timer-command="pause"]').onclick();
    assert.equal(a.state.writes, 0);
    assert.equal(a.query("#timer-sound").disabled, false);
    a.state.board = { id: "another" };
    a.submit();
    assert.equal(a.state.writes, 0);
    a.ui.detach();
    assert.equal(a.query("#workshop-timer"), null);
  } finally {
    a.close();
  }
});
test("losing timer edit access keeps keyboard focus on a usable panel control", () => {
  const a = setup();
  try {
    a.ui.open();
    const input = a.query("#timer-minutes");
    input.value = "12";
    input.dispatchEvent(new a.w.Event("input"));
    input.focus();
    a.state.writable = false;
    a.ui.render();
    assert.equal(input.disabled, true);
    assert.equal(a.doc.activeElement, a.query("#timer-minimize"));
    assert.equal(input.value, "12", "The draft survives demotion");
    a.query("#timer-sound").focus();
    a.state.writable = true;
    a.ui.render();
    assert.equal(a.doc.activeElement, a.query("#timer-sound"));
    input.focus();
    a.ui.render();
    assert.equal(a.doc.activeElement, input);
    assert.equal(a.state.writes, 0);
  } finally {
    a.close();
  }
});

test("timer validates durations and moves into presentation without losing state or leaking controls", () => {
  const a = setup();
  try {
    a.ui.open();
    a.query("#timer-minutes").value = "0";
    a.submit();
    assert.equal(a.state.writes, 0);
    assert.equal(a.query("#timer-error").hidden, false);
    a.query("#timer-seconds").value = "5";
    a.submit();
    const root = a.query("#workshop-timer"),
      dialog = a.doc.createElement("dialog");
    a.doc.body.append(dialog);
    a.ui.present(dialog);
    assert.equal(root.parentElement, dialog);
    a.query("#timer-minimize").click();
    assert.equal(a.doc.activeElement, a.query(".presentation-timer-access"));
    a.query(".presentation-timer-access").click();
    a.query('[data-timer-command="pause"]').click();
    assert.equal(a.state.board.timer.state, "paused");
    dialog.dispatchEvent(new a.w.Event("close"));
    assert.equal(root.parentElement, a.query(".canvas-wrap"));
    assert.equal(a.query(".presentation-timer-access"), null);
  } finally {
    a.close();
  }
});

test("composition Escape leaves the timer setup open and ordinary Escape minimizes it", () => {
  const a = setup();
  try {
    a.ui.open();
    const field = a.query("#timer-minutes");
    field.value = "12";
    field.focus();
    for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = new a.w.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
        ...flags,
      });
      field.dispatchEvent(event);
      assert.equal(a.query("#workshop-timer").hidden, false);
      assert.equal(a.doc.activeElement, field);
      assert.equal(field.value, "12");
      assert.equal(event.defaultPrevented, false);
      assert.equal(a.state.writes, 0);
    }
    field.dispatchEvent(
      new a.w.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(a.query("#workshop-timer").hidden, true);
    assert.equal(a.doc.activeElement, a.query("[data-timer-access]"));
    assert.equal(field.value, "12");
    assert.equal(a.state.writes, 0);
  } finally {
    a.close();
  }
});

test("completion chimes require a gesture, respect local mute, and close their audio context", () => {
  const previous = globalThis.AudioContext;
  let contexts = 0,
    tones = 0,
    closed = 0;
  globalThis.AudioContext = class {
    state = "running";
    currentTime = 0;
    constructor() {
      contexts++;
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      closed++;
      return Promise.resolve();
    }
    createOscillator() {
      tones++;
      return {
        frequency: { value: 0 },
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      };
    }
  };
  const a = setup();
  try {
    a.doc.dispatchEvent(new a.w.Event("pointerdown"));
    assert.equal(contexts, 0, "Idle page gestures do not allocate audio");
    a.ui.open();
    a.query("#timer-minutes").value = "0";
    a.query("#timer-seconds").value = "1";
    a.submit();
    a.state.now += 1001;
    a.ui.render();
    a.ui.render();
    assert.equal(tones, 3);
    a.query("#timer-sound").checked = false;
    a.query("#timer-sound").dispatchEvent(new a.w.Event("change"));
    a.submit();
    a.state.now += 1001;
    a.ui.render();
    assert.equal(tones, 3, "Muted completion is visual only");
  } finally {
    a.close();
    if (previous === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = previous;
  }
  assert.equal(closed, 1);
});
test("the focused timer button is not renamed each second, only when its phase changes", () => {
  const a = setup(
    changeTimer(undefined, "start", { now: 10000, duration: 60000 }),
  );
  try {
    const button = a.query("[data-timer-access]");
    a.ui.render();
    assert.match(button.getAttribute("aria-label"), /1:00/);
    button.focus();
    a.state.now += 5000;
    a.ui.render();
    assert.match(button.getAttribute("aria-label"), /1:00/, "Not renamed");
    a.state.board.timer = changeTimer(a.state.board.timer, "pause", {
      now: a.state.now,
    });
    a.ui.render();
    assert.doesNotMatch(button.getAttribute("aria-label"), /1:00/);
    assert.match(button.getAttribute("aria-label"), /0:55/);
    button.blur();
    a.state.board.timer = changeTimer(a.state.board.timer, "resume", {
      now: a.state.now,
    });
    a.state.now += 5000;
    a.ui.render();
    assert.match(button.getAttribute("aria-label"), /0:50/);
  } finally {
    a.close();
  }
});
