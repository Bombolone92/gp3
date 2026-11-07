import type { DocumentData } from '../data/types';
import { cloneShared, sealArrays } from '../data/cow';

interface Step {
  label: string;
  doc: DocumentData;
}

/** Global undo history of whole-document snapshots with shared immutable buffers. */
export class UndoStack {
  private steps: Step[] = [];
  private index = -1;
  limit = 64;

  reset(doc: DocumentData, label = 'Original') {
    this.steps = [{ label, doc: cloneShared(doc) }];
    this.index = 0;
    sealArrays();
  }

  push(doc: DocumentData, label: string) {
    this.steps.length = this.index + 1;
    this.steps.push({ label, doc: cloneShared(doc) });
    if (this.steps.length > this.limit + 1) this.steps.splice(0, this.steps.length - this.limit - 1);
    this.index = this.steps.length - 1;
    sealArrays();
  }

  /** Replace the latest step (used by "Adjust Last Operation"). */
  replaceTop(doc: DocumentData, label: string) {
    if (this.index < 0) return this.push(doc, label);
    this.steps[this.index] = { label, doc: cloneShared(doc) };
    sealArrays();
  }

  get canUndo() {
    return this.index > 0;
  }
  get canRedo() {
    return this.index < this.steps.length - 1;
  }

  undo(): DocumentData | null {
    if (!this.canUndo) return null;
    this.index--;
    sealArrays();
    return cloneShared(this.steps[this.index].doc);
  }

  redo(): DocumentData | null {
    if (!this.canRedo) return null;
    this.index++;
    sealArrays();
    return cloneShared(this.steps[this.index].doc);
  }

  /** Restore the state before the current step (without moving), for redo-last. */
  previous(): DocumentData | null {
    if (this.index < 1) return null;
    return cloneShared(this.steps[this.index - 1].doc);
  }

  current(): DocumentData | null {
    return this.index >= 0 ? cloneShared(this.steps[this.index].doc) : null;
  }

  jump(i: number): DocumentData | null {
    if (i < 0 || i >= this.steps.length) return null;
    this.index = i;
    sealArrays();
    return cloneShared(this.steps[i].doc);
  }

  /** A handle on the current step, to return to or merge from later (it survives steps trimmed off the start). */
  mark(): object | null {
    return this.steps[this.index] ?? null;
  }

  /** Whether `mark` is the current step. */
  isCurrent(mark: object | null) {
    return !!mark && this.steps[this.index] === mark;
  }

  /** Make `mark` current again and drop the steps after it; its document, or null when it is gone. */
  revertTo(mark: object | null): DocumentData | null {
    const i = this.steps.indexOf(mark as Step);
    if (i < 0) return null;
    this.steps.length = i + 1;
    this.index = i;
    sealArrays();
    return cloneShared(this.steps[i].doc);
  }

  /** Merge the steps after `mark` up to the current one into a single step named `label`. */
  squash(mark: object | null, label: string): boolean {
    const i = this.steps.indexOf(mark as Step);
    if (i < 0 || i >= this.index) return false;
    const top = this.steps[this.index];
    this.steps.splice(i + 1, this.index - i, { label, doc: top.doc });
    this.index = i + 1;
    return true;
  }

  get history() {
    return this.steps.map((s, i) => ({ label: s.label, active: i === this.index }));
  }

  get topLabel() {
    return this.steps[this.index]?.label ?? '';
  }
}
