// A textarea displays fields as text, but its edit ranges still tell us which
// fields were touched. Keep that identity independently of the plain value.
export class TextFieldEdits {
  constructor(text, fields) {
    this.text = text;
    this.fields = fields;
    this.past = [];
    this.future = [];
  }
  replace(start, end, inserted) {
    const removed = this.text.slice(start, end);
    const lost = [],
      kept = [];
    const delta = inserted.length - (end - start);
    for (const f of this.fields) {
      if (
        (start < f.end && end > f.start) ||
        (start === end && start > f.start && start < f.end)
      )
        lost.push(f);
      else
        kept.push(
          f.start >= end
            ? { ...f, start: f.start + delta, end: f.end + delta }
            : f,
        );
    }
    this.fields = kept;
    this.text = this.text.slice(0, start) + inserted + this.text.slice(end);
    return { start, removed, inserted, lost };
  }
  update(value, range = null, inputType = "") {
    if (value === this.text) return;
    if (inputType === "historyUndo" || inputType === "historyRedo") {
      const undo = inputType === "historyUndo",
        stack = undo ? this.past : this.future;
      let candidate = this.text,
        count = 0;
      for (let i = stack.length - 1; i >= 0; i--) {
        const p = stack[i],
          from = undo ? p.inserted : p.removed,
          to = undo ? p.removed : p.inserted;
        if (candidate.slice(p.start, p.start + from.length) !== from) break;
        candidate =
          candidate.slice(0, p.start) +
          to +
          candidate.slice(p.start + from.length);
        count++;
        if (candidate === value) {
          while (count--) {
            const patch = stack.pop();
            if (undo) {
              this.replace(
                patch.start,
                patch.start + patch.inserted.length,
                patch.removed,
              );
              this.fields.push(...patch.lost);
              this.fields.sort((a, b) => a.start - b.start);
              this.future.push(patch);
            } else {
              this.replace(
                patch.start,
                patch.start + patch.removed.length,
                patch.inserted,
              );
              this.past.push(patch);
            }
          }
          return;
        }
      }
    }
    let start = range?.start,
      end = range?.end;
    const length = () => value.length - this.text.length + end - start;
    if (
      start == null ||
      end < start ||
      length() < 0 ||
      this.text.slice(0, start) !== value.slice(0, start) ||
      this.text.slice(end) !== value.slice(start + length())
    ) {
      // Programmatic changes and browser corrections can lack beforeinput.
      // One replacement remains identifiable from the unchanged boundaries.
      start = 0;
      while (
        start < Math.min(this.text.length, value.length) &&
        this.text[start] === value[start]
      )
        start++;
      end = this.text.length;
      let after = value.length;
      while (
        end > start &&
        after > start &&
        this.text[end - 1] === value[after - 1]
      ) {
        end--;
        after--;
      }
    }
    this.past.push(
      this.replace(start, end, value.slice(start, start + length())),
    );
    this.future = [];
  }
}

export function trackTextFields(input, fields) {
  const edits = new TextFieldEdits(input.value, fields);
  let before = null;
  let composition = null;
  input.addEventListener("compositionstart", () => {
    composition = {
      start: input.selectionStart,
      end: input.selectionEnd,
      text: edits.text,
      fields: edits.fields,
      past: edits.past.length,
      future: edits.future,
    };
  });
  input.addEventListener("compositionend", () => {
    // Cancelling a composition restores field identity as well as characters.
    if (composition && input.value === composition.text) {
      edits.text = composition.text;
      edits.fields = composition.fields;
      edits.past.length = composition.past;
      edits.future = composition.future;
    }
    composition = null;
  });
  input.addEventListener("beforeinput", (e) => {
    before = {
      start: input.selectionStart,
      end: input.selectionEnd,
      type: e.inputType,
    };
  });
  input.addEventListener("input", (e) => {
    let range =
      composition && (e.isComposing || e.inputType?.includes("Composition"))
        ? composition
        : before;
    const oldLength = edits.text.length;
    if (
      range &&
      range.start === range.end &&
      e.inputType?.startsWith("delete")
    ) {
      range = e.inputType.endsWith("Backward")
        ? { start: input.selectionStart, end: range.end }
        : {
            start: range.start,
            end: range.end + edits.text.length - input.value.length,
          };
    }
    edits.update(input.value, range, e.inputType || before?.type);
    if (composition) composition.end += input.value.length - oldLength;
    before = null;
  });
  return edits;
}
