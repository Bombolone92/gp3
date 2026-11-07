//! Copper pour filling.

use crate::poly::*;
use crate::shape::*;
use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;

/// Extra growth (nm) so vertex rounding never eats into a clearance.
const SAFETY: f64 = 5.0;

pub struct PourSpec {
    pub obj: i32,
    pub layer_bit: u32,
    pub net: i32,
    pub clearance: f64,
    pub min_width: f64,
    pub remove_islands: bool,
    pub thermals: bool,
    pub outline: Vec<[f64; 2]>,
}

pub struct PourParams {
    pub edge_clearance: f64,
    pub gap: f64,
    pub spoke: f64,
    pub count: u32,
}

pub struct PourResult {
    pub obj: i32,
    pub shapes: Shapes,
}

/// The board area: outline minus cutouts, as one shape set.
pub fn board_area(rings: &[Vec<[f64; 2]>]) -> Shapes {
    if rings.is_empty() || rings[0].len() < 3 {
        return Vec::new();
    }
    let outer = make_ccw(rings[0].iter().map(|q| P::new(q[0].round() as i64, q[1].round() as i64)).collect());
    let mut holes = Vec::new();
    for r in &rings[1..] {
        if r.len() >= 3 {
            holes.push(make_ccw(r.iter().map(|q| P::new(q[0].round() as i64, q[1].round() as i64)).collect()));
        }
    }
    let base = vec![vec![outer]];
    if holes.is_empty() {
        boolean(&base, &[], OverlayRule::Subject, FillRule::NonZero)
    } else {
        boolean(&base, &holes, OverlayRule::Difference, FillRule::NonZero)
    }
}

/// Thermal relief obstacle for a same-net pad: the pad grown by the gap,
/// minus spokes that tie the pad to the surrounding pour.
fn thermal(s: &Shape, pp: &PourParams) -> Shapes {
    let ring = grown(s, pp.gap + SAFETY);
    let reach = (s.hw * s.hw + s.hh * s.hh).sqrt() + pp.gap + pp.spoke;
    let base = if s.kind == KIND_CIRCLE { 45.0 } else { s.rot };
    let count = pp.count.max(1);
    let mut spokes = Vec::new();
    for k in 0..count {
        let a = (base + 360.0 * k as f64 / count as f64).to_radians();
        let (sn, cs) = a.sin_cos();
        let mx = s.cx + cs * reach / 2.0;
        let my = s.cy + sn * reach / 2.0;
        spokes.push(rect(mx, my, reach / 2.0, pp.spoke / 2.0, a.to_degrees()));
    }
    boolean(&ring, &spokes, OverlayRule::Difference, FillRule::NonZero)
}

pub fn fill_pours(shapes: &[Shape], board: &Shapes, pours: &[PourSpec], pp: &PourParams) -> Vec<PourResult> {
    let area = if board.is_empty() { Vec::new() } else { offset(board, -(pp.edge_clearance + SAFETY)) };
    let mut done: Vec<(u32, i32, f64, Shapes)> = Vec::new();
    let mut out = Vec::new();
    for pour in pours {
        let outline: Contour = make_ccw(pour.outline.iter().map(|q| P::new(q[0].round() as i64, q[1].round() as i64)).collect());
        if outline.len() < 3 {
            out.push(PourResult { obj: pour.obj, shapes: Vec::new() });
            continue;
        }
        let region = if area.is_empty() {
            boolean(&vec![vec![outline]], &[], OverlayRule::Subject, FillRule::NonZero)
        } else {
            boolean(&area, &[outline], OverlayRule::Intersect, FillRule::NonZero)
        };
        let mut clip: Vec<Contour> = Vec::new();
        let mut anchors: Vec<[f64; 2]> = Vec::new();
        let rb = region_box(&region);
        for s in shapes {
            if s.mask & pour.layer_bit == 0 || s.flags & (F_COURTYARD | F_EDGE) != 0 {
                continue;
            }
            let clr = pour.clearance.max(s.clr);
            if !boxes_overlap(&s.bbox, &rb, clr + pp.gap + pp.spoke) {
                continue;
            }
            let push_all = |clip: &mut Vec<Contour>, sh: Shapes| {
                for shape in sh {
                    clip.extend(shape);
                }
            };
            if s.flags & F_KEEPOUT != 0 {
                push_all(&mut clip, grown(s, 0.0));
            } else if pour.net >= 0 && s.net == pour.net {
                anchors.extend(s.anchors());
                if s.flags & F_PAD != 0 && pour.thermals {
                    push_all(&mut clip, thermal(s, pp));
                }
            } else {
                push_all(&mut clip, grown(s, clr + SAFETY));
            }
        }
        // Fills of earlier (higher priority) pours on this layer.
        for (bit, net, clr, fill) in &done {
            if *bit != pour.layer_bit || (pour.net >= 0 && *net == pour.net) || fill.is_empty() {
                continue;
            }
            for shape in offset(fill, pour.clearance.max(*clr) + SAFETY) {
                clip.extend(shape);
            }
        }
        let mut fill = if clip.is_empty() { region } else { boolean(&region, &clip, OverlayRule::Difference, FillRule::NonZero) };
        if pour.min_width > 0.0 && !fill.is_empty() {
            let shrunk = offset(&fill, -pour.min_width / 2.0);
            fill = offset(&shrunk, pour.min_width / 2.0);
        }
        if pour.remove_islands && pour.net >= 0 {
            fill.retain(|shape| anchors.iter().any(|a| point_in_shape(*a, shape)));
        }
        done.push((pour.layer_bit, pour.net, pour.clearance, fill.clone()));
        out.push(PourResult { obj: pour.obj, shapes: fill });
    }
    out
}

fn region_box(sh: &Shapes) -> [f64; 4] {
    let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    for s in sh {
        for c in s {
            for q in c {
                b[0] = b[0].min(q.x as f64);
                b[1] = b[1].min(q.y as f64);
                b[2] = b[2].max(q.x as f64);
                b[3] = b[3].max(q.y as f64);
            }
        }
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(kind: f64, mask: f64, net: f64, flags: f64, geom: &[f64]) -> Shape {
        let mut v = vec![kind, mask, net, 0.0, flags, 200_000.0];
        v.extend_from_slice(geom);
        decode(&v, 0).0
    }

    fn square(h: f64) -> Vec<[f64; 2]> {
        vec![[-h, -h], [h, -h], [h, h], [-h, h]]
    }

    fn params() -> PourParams {
        PourParams { edge_clearance: 0.0, gap: 250_000.0, spoke: 300_000.0, count: 4 }
    }

    fn spec(net: i32) -> PourSpec {
        PourSpec { obj: 7, layer_bit: 1, net, clearance: 300_000.0, min_width: 0.0, remove_islands: true, thermals: true, outline: square(5_000_000.0) }
    }

    #[test]
    fn other_net_via_makes_hole() {
        let via = rec(1.0, 1.0, 2.0, (F_VIA | F_THRU) as f64, &[0.0, 0.0, 300_000.0]);
        let gnd = rec(1.0, 1.0, 1.0, F_PAD as f64, &[3_000_000.0, 0.0, 400_000.0]);
        let board = board_area(&[square(10_000_000.0)]);
        let res = fill_pours(&[via, gnd], &board, &[spec(1)], &params());
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].shapes.len(), 1);
        // outer + hole around the via + thermal holes around the GND pad (4 quadrants)
        assert!(res[0].shapes[0].len() >= 2);
        assert!(!point_in_shape([0.0, 0.0], &res[0].shapes[0]));
        assert!(!point_in_shape([0.0, 550_000.0], &res[0].shapes[0]));
        assert!(point_in_shape([0.0, 700_000.0], &res[0].shapes[0]));
    }

    #[test]
    fn islands_without_same_net_copper_are_removed() {
        // A wall of other-net copper splits the pour; only the side with the pad stays.
        let wall = rec(2.0, 1.0, 2.0, F_TRACK as f64, &[0.0, -6_000_000.0, 0.0, 6_000_000.0, 200_000.0]);
        let pad = rec(1.0, 1.0, 1.0, F_PAD as f64, &[3_000_000.0, 0.0, 400_000.0]);
        let board = board_area(&[square(10_000_000.0)]);
        let res = fill_pours(&[wall, pad], &board, &[spec(1)], &params());
        assert_eq!(res[0].shapes.len(), 1);
        assert!(point_in_shape([4_000_000.0, 2_000_000.0], &res[0].shapes[0]));
        let mut keep = spec(1);
        keep.remove_islands = false;
        let wall2 = rec(2.0, 1.0, 2.0, F_TRACK as f64, &[0.0, -6_000_000.0, 0.0, 6_000_000.0, 200_000.0]);
        let pad2 = rec(1.0, 1.0, 1.0, F_PAD as f64, &[3_000_000.0, 0.0, 400_000.0]);
        let res2 = fill_pours(&[wall2, pad2], &board, &[keep], &params());
        assert_eq!(res2[0].shapes.len(), 2);
    }

    #[test]
    fn edge_clearance_shrinks_area() {
        let board = board_area(&[square(1_000_000.0)]);
        let mut p = params();
        p.edge_clearance = 100_000.0;
        let mut s = spec(-1);
        s.outline = square(5_000_000.0);
        let res = fill_pours(&[], &board, &[s], &p);
        assert!(point_in_shape([850_000.0, 0.0], &res[0].shapes[0]));
        assert!(!point_in_shape([950_000.0, 0.0], &res[0].shapes[0]));
    }
}
