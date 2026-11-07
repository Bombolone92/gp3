//! Pairwise geometric design rule checks with a uniform grid broadphase.

use crate::shape::*;

pub const R_CLEARANCE: u32 = 1;
pub const R_SHORT: u32 = 2;
pub const R_EDGE: u32 = 3;
pub const R_KEEPOUT: u32 = 4;
pub const R_COURTYARD: u32 = 5;
pub const R_OUTSIDE: u32 = 6;

#[derive(Debug, Clone)]
pub struct Violation {
    pub rule: u32,
    pub a: usize,
    pub b: Option<usize>,
    pub x: f64,
    pub y: f64,
    pub mask: u32,
    pub actual: f64,
    pub required: f64,
}

/// Uniform grid over shape boxes. Each shape is listed in every cell its
/// (inflated) box touches; a pair is tested only in the cell containing the
/// lower corner of the two boxes' overlap, so each pair is tested once.
pub struct Grid {
    pub x0: f64,
    pub y0: f64,
    pub cell: f64,
    pub nx: usize,
    pub ny: usize,
    pub cells: Vec<Vec<u32>>,
}

impl Grid {
    pub fn build(boxes: &[[f64; 4]]) -> Grid {
        let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
        let mut sizes: Vec<f64> = Vec::with_capacity(boxes.len());
        for r in boxes {
            b[0] = b[0].min(r[0]);
            b[1] = b[1].min(r[1]);
            b[2] = b[2].max(r[2]);
            b[3] = b[3].max(r[3]);
            sizes.push((r[2] - r[0]).max(r[3] - r[1]));
        }
        if boxes.is_empty() {
            return Grid { x0: 0.0, y0: 0.0, cell: 1.0, nx: 1, ny: 1, cells: vec![Vec::new()] };
        }
        sizes.sort_by(|a, c| a.partial_cmp(c).unwrap());
        // Cells about twice the median object size keep lists short; cap the
        // grid so huge boards stay within memory.
        let median = sizes[sizes.len() / 2].max(1.0);
        let w = (b[2] - b[0]).max(1.0);
        let h = (b[3] - b[1]).max(1.0);
        let mut cell = median * 2.0;
        let max_cells = 512.0 * 512.0;
        if (w / cell) * (h / cell) > max_cells {
            cell = ((w * h) / max_cells).sqrt();
        }
        let nx = ((w / cell).ceil() as usize).max(1);
        let ny = ((h / cell).ceil() as usize).max(1);
        let mut g = Grid { x0: b[0], y0: b[1], cell, nx, ny, cells: vec![Vec::new(); nx * ny] };
        for (i, r) in boxes.iter().enumerate() {
            let (cx0, cy0, cx1, cy1) = g.range(r);
            for cy in cy0..=cy1 {
                for cx in cx0..=cx1 {
                    g.cells[cy * nx + cx].push(i as u32);
                }
            }
        }
        g
    }

    pub fn range(&self, r: &[f64; 4]) -> (usize, usize, usize, usize) {
        let f = |v: f64, o: f64, n: usize| (((v - o) / self.cell).floor().max(0.0) as usize).min(n - 1);
        (f(r[0], self.x0, self.nx), f(r[1], self.y0, self.ny), f(r[2], self.x0, self.nx), f(r[3], self.y0, self.ny))
    }

    pub fn cell_of(&self, x: f64, y: f64) -> usize {
        let cx = (((x - self.x0) / self.cell).floor().max(0.0) as usize).min(self.nx - 1);
        let cy = (((y - self.y0) / self.cell).floor().max(0.0) as usize).min(self.ny - 1);
        cy * self.nx + cx
    }
}

fn pair_kind(a: &Shape, b: &Shape) -> u32 {
    let ca = a.flags & F_COURTYARD != 0;
    let cb = b.flags & F_COURTYARD != 0;
    if ca || cb {
        return if ca && cb && a.mask & b.mask != 0 && a.obj != b.obj { R_COURTYARD } else { 0 };
    }
    if a.mask & b.mask & COPPER_MASK == 0 {
        return 0;
    }
    let ea = a.flags & F_EDGE != 0;
    let eb = b.flags & F_EDGE != 0;
    let ka = a.flags & F_KEEPOUT != 0;
    let kb = b.flags & F_KEEPOUT != 0;
    if ea || eb {
        return if ea != eb && !ka && !kb { R_EDGE } else { 0 };
    }
    if ka || kb {
        return if ka != kb { R_KEEPOUT } else { 0 };
    }
    if a.net >= 0 && a.net == b.net {
        return 0;
    }
    R_CLEARANCE
}

pub fn check(shapes: &[Shape], board: &[Vec<[f64; 2]>], edge_clearance: f64, max: usize) -> Vec<Violation> {
    let mut out = Vec::new();
    let pads: Vec<f64> = shapes.iter().map(|s| if s.flags & F_EDGE != 0 { edge_clearance } else { s.clr.max(0.0) }).collect();
    let boxes: Vec<[f64; 4]> = shapes
        .iter()
        .zip(&pads)
        .map(|(s, p)| [s.bbox[0] - p, s.bbox[1] - p, s.bbox[2] + p, s.bbox[3] + p])
        .collect();
    let grid = Grid::build(&boxes);
    for (ci, list) in grid.cells.iter().enumerate() {
        for x in 0..list.len() {
            let i = list[x] as usize;
            for y in (x + 1)..list.len() {
                let j = list[y] as usize;
                let (bi, bj) = (&boxes[i], &boxes[j]);
                if !boxes_overlap(bi, bj, 0.0) {
                    continue;
                }
                if grid.cell_of(bi[0].max(bj[0]), bi[1].max(bj[1])) != ci {
                    continue;
                }
                let (a, b) = (&shapes[i], &shapes[j]);
                let kind = pair_kind(a, b);
                if kind == 0 {
                    continue;
                }
                let required = match kind {
                    R_EDGE => edge_clearance,
                    R_KEEPOUT | R_COURTYARD => 0.0,
                    _ => a.clr.max(b.clr),
                };
                let (g, at) = gap(a, b, required + 1.0);
                let touching = g <= 0.0;
                let hit = match kind {
                    R_KEEPOUT | R_COURTYARD => {
                        // Touching edges are fine; require real overlap.
                        touching && overlap_depth(a, b)
                    }
                    R_CLEARANCE => {
                        // Two unconnected objects with no net that touch are treated as joined.
                        if a.net < 0 && b.net < 0 && touching { false } else { g < required - 0.5 }
                    }
                    _ => g < required - 0.5,
                };
                if !hit {
                    continue;
                }
                let rule = if kind == R_CLEARANCE && touching { R_SHORT } else { kind };
                let (ai, bi2) = if shapes[i].flags & F_EDGE != 0 { (j, i) } else { (i, j) };
                out.push(Violation {
                    rule, a: ai, b: if rule == R_EDGE { None } else { Some(bi2) },
                    x: at[0], y: at[1], mask: a.mask & b.mask, actual: g, required,
                });
                if out.len() >= max {
                    return out;
                }
            }
        }
    }
    // Copper outside the board.
    if !board.is_empty() && board[0].len() >= 3 {
        let mut pts = Vec::new();
        let mut rings = Vec::new();
        for r in board {
            let s = pts.len();
            pts.extend_from_slice(r);
            rings.push((s, pts.len()));
        }
        for (i, s) in shapes.iter().enumerate() {
            if !s.is_copper() || s.flags & F_POURFILL != 0 {
                continue;
            }
            let c = [s.cx, s.cy];
            if !point_in_rings(c, &pts, &rings) {
                out.push(Violation { rule: R_OUTSIDE, a: i, b: None, x: c[0], y: c[1], mask: s.mask, actual: 0.0, required: edge_clearance });
                if out.len() >= max {
                    break;
                }
            }
        }
    }
    out
}

/// True when the shapes overlap by more than a hair (shared edges do not count).
fn overlap_depth(a: &Shape, b: &Shape) -> bool {
    // Shrink the smaller shape slightly and test again.
    let (small, big) = if (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) < (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]) { (a, b) } else { (b, a) };
    for (s, other) in [(small, big), (big, small)] {
        if s.r > 2.0 {
            let mut t = s.clone();
            t.r -= 2.0;
            return gap(&t, other, 1.0).0 <= 0.0;
        }
    }
    // Two polygons: a vertex strictly inside the other, or edges that cross.
    let inside = |p: &Shape, q: &Shape| p.pts.iter().any(|v| point_in_rings(*v, &q.pts, &q.rings) && inset(q, *v));
    if (b.closed && inside(a, b)) || (a.closed && inside(b, a)) {
        return true;
    }
    let ea = ring_edges(a);
    let eb = ring_edges(b);
    ea.iter().any(|(p, q)| eb.iter().any(|(r, t)| segs_cross(*p, *q, *r, *t)))
}

fn ring_edges(s: &Shape) -> Vec<([f64; 2], [f64; 2])> {
    if !s.closed {
        return if s.pts.len() == 2 { vec![(s.pts[0], s.pts[1])] } else { Vec::new() };
    }
    let mut out = Vec::new();
    for &(a, b) in &s.rings {
        let mut j = b - 1;
        for k in a..b {
            out.push((s.pts[j], s.pts[k]));
            j = k;
        }
    }
    out
}

fn inset(s: &Shape, p: [f64; 2]) -> bool {
    // The point is inside s by at least a couple of nanometres.
    if !s.closed {
        return true;
    }
    let mut best = f64::INFINITY;
    for &(a, b) in &s.rings {
        let mut j = b - 1;
        for k in a..b {
            let q = closest_on_seg(p, s.pts[j], s.pts[k]);
            best = best.min(((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2)).sqrt());
            j = k;
        }
    }
    best > 2.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(kind: f64, mask: f64, net: f64, obj: f64, flags: f64, clr: f64, geom: &[f64]) -> Shape {
        let mut v = vec![kind, mask, net, obj, flags, clr];
        v.extend_from_slice(geom);
        decode(&v, 0).0
    }

    #[test]
    fn finds_clearance_and_shorts() {
        let a = rec(2.0, 1.0, 0.0, 0.0, 8.0, 200.0, &[0.0, 0.0, 1000.0, 0.0, 50.0]);
        let b = rec(2.0, 1.0, 1.0, 1.0, 8.0, 200.0, &[0.0, 250.0, 1000.0, 250.0, 50.0]);
        let c = rec(2.0, 1.0, 2.0, 2.0, 8.0, 200.0, &[500.0, -500.0, 500.0, 500.0, 50.0]);
        let v = check(&[a, b, c], &[], 0.0, 100);
        assert!(v.iter().any(|x| x.rule == R_CLEARANCE && (x.actual - 150.0).abs() < 1e-6));
        assert_eq!(v.iter().filter(|x| x.rule == R_SHORT).count(), 2);
    }

    #[test]
    fn same_net_and_other_layers_are_ignored() {
        let a = rec(1.0, 1.0, 0.0, 0.0, 0.0, 200.0, &[0.0, 0.0, 100.0]);
        let b = rec(1.0, 1.0, 0.0, 1.0, 0.0, 200.0, &[150.0, 0.0, 100.0]);
        let c = rec(1.0, 32.0, 1.0, 2.0, 0.0, 200.0, &[0.0, 0.0, 100.0]);
        assert!(check(&[a, b, c], &[], 0.0, 100).is_empty());
    }

    #[test]
    fn edge_and_outside() {
        let board = vec![vec![[0.0, 0.0], [10_000.0, 0.0], [10_000.0, 10_000.0], [0.0, 10_000.0]]];
        let mut shapes = vec![
            rec(1.0, 1.0, 0.0, 0.0, 0.0, 200.0, &[5_000.0, 300.0, 100.0]),
            rec(1.0, 1.0, 0.0, 1.0, 0.0, 200.0, &[20_000.0, 300.0, 100.0]),
        ];
        let ring = &board[0];
        for k in 0..ring.len() {
            let p = ring[k];
            let q = ring[(k + 1) % ring.len()];
            shapes.push(rec(2.0, 63.0, -1.0, -1.0, F_EDGE as f64, 0.0, &[p[0], p[1], q[0], q[1], 0.0]));
        }
        let v = check(&shapes, &board, 500.0, 100);
        assert!(v.iter().any(|x| x.rule == R_EDGE && x.a == 0));
        assert!(v.iter().any(|x| x.rule == R_OUTSIDE && x.a == 1));
    }

    #[test]
    fn courtyards_overlap_but_may_touch() {
        let sq = |x: f64, y: f64, obj: f64| {
            rec(4.0, 1024.0, -1.0, obj, F_COURTYARD as f64, 0.0, &[1.0, 4.0, x, y, x + 10.0, y, x + 10.0, y + 10.0, x, y + 10.0])
        };
        assert_eq!(check(&[sq(0.0, 0.0, 0.0), sq(8.0, 5.0, 1.0)], &[], 0.0, 10).len(), 1);
        assert!(check(&[sq(0.0, 0.0, 0.0), sq(10.0, 0.0, 1.0)], &[], 0.0, 10).is_empty());
        // A cross where no corner lies inside the other rectangle.
        let wide = rec(4.0, 1024.0, -1.0, 0.0, F_COURTYARD as f64, 0.0, &[1.0, 4.0, -10.0, -1.0, 10.0, -1.0, 10.0, 1.0, -10.0, 1.0]);
        let tall = rec(4.0, 1024.0, -1.0, 1.0, F_COURTYARD as f64, 0.0, &[1.0, 4.0, -1.0, -10.0, 1.0, -10.0, 1.0, 10.0, -1.0, 10.0]);
        assert_eq!(check(&[wide, tall], &[], 0.0, 10).len(), 1);
    }

    #[test]
    fn many_objects_run_fast() {
        let mut shapes = Vec::new();
        for i in 0..20_000 {
            let x = (i % 200) as f64 * 1000.0;
            let y = (i / 200) as f64 * 1000.0;
            shapes.push(rec(2.0, 1.0, i as f64, i as f64, 8.0, 200.0, &[x, y, x + 500.0, y, 100.0]));
        }
        let v = check(&shapes, &[], 0.0, 100_000);
        assert!(v.is_empty());
    }
}
