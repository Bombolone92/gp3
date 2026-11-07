/**
 * A formula pasted with Transpose: a reference to a cell inside the copied block
 * follows that cell to its transposed place (absolute or not), and a relative reference outside it keeps
 * its distance with the rows and columns swapped (three right becomes three down). Absolute parts
 * outside the block stay put. Whole-row and whole-column references shift by the cell's own move.
 */
import { mapFormulaRefs, shiftRef, MAX_ROW, MAX_COL } from './refs.js';

/**
 * `src` is the formula's own cell where it was copied, `dest` where it lands; `origin` is the copied
 * block ({ r, c } with `rows`/`cols` listing the lines a filtered copy took) and `h`/`w` its size, and
 * `top` the pasted block's top-left cell.
 */
export function transposeFormula(formula, src, dest, origin, h, w, top) {
  if (formula == null || !origin) return formula;
  const rowIndex = (r) => (origin.rows ? origin.rows.indexOf(r) : r >= origin.r && r < origin.r + h ? r - origin.r : -1);
  const colIndex = (c) => (origin.cols ? origin.cols.indexOf(c) : c >= origin.c && c < origin.c + w ? c - origin.c : -1);
  return mapFormulaRefs(formula, (ref) => {
    if (ref.kind === 'cols' || ref.kind === 'rows') return shiftRef(ref, dest.r - src.r, dest.c - src.c);
    const out = { ...ref };
    for (const e of [1, 2]) {
      const r = ref[`r${e}`], c = ref[`c${e}`];
      // A reference naming a sheet points elsewhere (or is qualified on purpose): it is never inside the block.
      const i = ref.sheet ? -1 : rowIndex(r), j = ref.sheet ? -1 : colIndex(c);
      if (i >= 0 && j >= 0) { out[`r${e}`] = top.r + j; out[`c${e}`] = top.c + i; continue; }
      if (!ref[`absR${e}`]) out[`r${e}`] = dest.r + (c - src.c);
      if (!ref[`absC${e}`]) out[`c${e}`] = dest.c + (r - src.r);
    }
    if (out.r1 > out.r2) [out.r1, out.r2, out.absR1, out.absR2] = [out.r2, out.r1, out.absR2, out.absR1];
    if (out.c1 > out.c2) [out.c1, out.c2, out.absC1, out.absC2] = [out.c2, out.c1, out.absC2, out.absC1];
    if (out.r1 < 0 || out.c1 < 0 || out.r2 > MAX_ROW || out.c2 > MAX_COL) return null;
    return out;
  });
}
