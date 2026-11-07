//! Polygon helpers on the integer boolean engine (nanometre i64 coordinates).

use crate::shape::*;
use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay::{Overlay, ShapeType};
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::i_float::int::angle::Angle;
use i_overlay::i_float::int::point::IntPoint;
use i_overlay::mesh::int::arc::ArcOptions;
use i_overlay::mesh::int::outline::offset::IntOutlineOffset;
use i_overlay::mesh::int::style::{IntLineJoin, IntOutlineStyle};

pub type P = IntPoint<i64>;
pub type Contour = Vec<P>;
pub type Shapes = Vec<Vec<Contour>>;

/// Maximum chord deviation when turning arcs into polygon edges (nm).
pub const ARC_ERR: f64 = 1000.0;

fn p(x: f64, y: f64) -> P {
    IntPoint::new(x.round() as i64, y.round() as i64)
}

pub fn signed_area(c: &[P]) -> f64 {
    let mut a = 0.0;
    let n = c.len();
    for i in 0..n {
        let j = (i + n - 1) % n;
        a += c[j].x as f64 * c[i].y as f64 - c[i].x as f64 * c[j].y as f64;
    }
    a / 2.0
}

pub fn make_ccw(mut c: Contour) -> Contour {
    if signed_area(&c) < 0.0 {
        c.reverse();
    }
    c
}

pub fn make_cw(mut c: Contour) -> Contour {
    if signed_area(&c) > 0.0 {
        c.reverse();
    }
    c
}

/// Segment count for a full circle of radius r within ARC_ERR.
fn circle_steps(r: f64) -> usize {
    if r <= ARC_ERR * 2.0 {
        return 8;
    }
    let half = (1.0 - ARC_ERR / r).acos();
    ((std::f64::consts::PI / half).ceil() as usize).clamp(8, 256)
}

/// Appends a CCW arc around (cx, cy) from a0 sweeping `sweep` radians,
/// circumscribing the true arc so clearances stay conservative.
fn push_arc(out: &mut Contour, cx: f64, cy: f64, r: f64, a0: f64, sweep: f64) {
    let full = circle_steps(r) as f64;
    let n = ((full * sweep / std::f64::consts::TAU).ceil() as usize).max(1);
    let step = sweep / n as f64;
    let rr = r / (step / 2.0).cos();
    // Vertices sit at the middle of each step (outside the circle), plus the
    // exact end points so neighbouring straight edges meet cleanly.
    out.push(p(cx + r * a0.cos(), cy + r * a0.sin()));
    for k in 0..n {
        let a = a0 + step * (k as f64 + 0.5);
        out.push(p(cx + rr * a.cos(), cy + rr * a.sin()));
    }
    let a1 = a0 + sweep;
    out.push(p(cx + r * a1.cos(), cy + r * a1.sin()));
}

pub fn circle(cx: f64, cy: f64, r: f64) -> Contour {
    let n = circle_steps(r);
    let step = std::f64::consts::TAU / n as f64;
    let rr = r / (step / 2.0).cos();
    (0..n).map(|k| {
        let a = step * k as f64;
        p(cx + rr * a.cos(), cy + rr * a.sin())
    }).collect()
}

pub fn capsule(a: [f64; 2], b: [f64; 2], r: f64) -> Contour {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    if dx * dx + dy * dy < 1.0 {
        return circle(a[0], a[1], r);
    }
    let ang = dy.atan2(dx);
    let half = std::f64::consts::FRAC_PI_2;
    let mut out = Vec::new();
    push_arc(&mut out, b[0], b[1], r, ang - half, std::f64::consts::PI);
    push_arc(&mut out, a[0], a[1], r, ang + half, std::f64::consts::PI);
    dedupe(out)
}

pub fn rect(cx: f64, cy: f64, hw: f64, hh: f64, rot_deg: f64) -> Contour {
    let (s, c) = rot_deg.to_radians().sin_cos();
    [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
        .iter()
        .map(|&(x, y)| p(cx + x * c - y * s, cy + x * s + y * c))
        .collect()
}

/// A rounded rectangle: inner rectangle half sizes (ix, iy) grown by r.
fn round_rect(cx: f64, cy: f64, ix: f64, iy: f64, r: f64, rot_deg: f64) -> Contour {
    if r <= 0.5 {
        return rect(cx, cy, ix, iy, rot_deg);
    }
    let rot = rot_deg.to_radians();
    let half = std::f64::consts::FRAC_PI_2;
    let mut out = Vec::new();
    let corners = [(ix, -iy, -half), (ix, iy, 0.0), (-ix, iy, half), (-ix, -iy, std::f64::consts::PI)];
    let (s, c) = rot.sin_cos();
    for (x, y, a) in corners {
        push_arc(&mut out, cx + x * c - y * s, cy + x * s + y * c, r, a + rot, half);
    }
    dedupe(out)
}

fn dedupe(c: Contour) -> Contour {
    let mut out: Contour = Vec::with_capacity(c.len());
    for q in c {
        if out.last().map_or(true, |l| l.x != q.x || l.y != q.y) {
            out.push(q);
        }
    }
    while out.len() > 1 && out[0].x == out[out.len() - 1].x && out[0].y == out[out.len() - 1].y {
        out.pop();
    }
    out
}

pub fn round_join() -> IntLineJoin {
    IntLineJoin::Round(ArcOptions { max_step: Angle::from_bits(1 << 26), rotation_precision: 16 })
}

/// Offsets shapes by d (positive grows) with round joins.
pub fn offset(shapes: &Shapes, d: f64) -> Shapes {
    let d = d.round() as i64;
    if d == 0 || shapes.is_empty() {
        return shapes.clone();
    }
    let style = IntOutlineStyle::new(d).line_join(round_join());
    shapes.outline(&style).unwrap_or_default()
}

/// The shape grown by d, as polygon shapes (outer CCW, holes CW).
pub fn grown(s: &Shape, d: f64) -> Shapes {
    let r = s.r + d;
    match s.kind {
        KIND_CIRCLE => vec![vec![circle(s.pts[0][0], s.pts[0][1], r)]],
        KIND_CAPSULE => vec![vec![capsule(s.pts[0], s.pts[1], r)]],
        KIND_ROUNDRECT => vec![vec![round_rect(s.cx, s.cy, s.hw - s.r, s.hh - s.r, r, s.rot)]],
        _ => {
            let shapes = rings_to_shapes(s);
            if d.abs() < 0.5 { shapes } else { offset(&shapes, d) }
        }
    }
}

/// Converts polygon rings (any orientation, even-odd) to clean shapes.
pub fn rings_to_shapes(s: &Shape) -> Shapes {
    let mut ov = Overlay::<i64>::new(s.pts.len() + 4);
    for &(a, b) in &s.rings {
        let c: Contour = s.pts[a..b].iter().map(|q| p(q[0], q[1])).collect();
        ov.add_contour(&c, ShapeType::Subject);
    }
    ov.overlay(OverlayRule::Subject, FillRule::EvenOdd)
}

pub fn boolean(subj: &Shapes, clip: &[Contour], rule: OverlayRule, fill: FillRule) -> Shapes {
    let n: usize = subj.iter().flatten().map(|c| c.len()).sum::<usize>() + clip.iter().map(|c| c.len()).sum::<usize>();
    let mut ov = Overlay::<i64>::new(n + 8);
    for shape in subj {
        for c in shape {
            ov.add_contour(c, ShapeType::Subject);
        }
    }
    for c in clip {
        ov.add_contour(c, ShapeType::Clip);
    }
    ov.overlay(rule, fill)
}

pub fn point_in_shape(q: [f64; 2], shape: &[Contour]) -> bool {
    let mut inside = false;
    for c in shape {
        let n = c.len();
        let mut j = n - 1;
        for i in 0..n {
            let (xi, yi) = (c[i].x as f64, c[i].y as f64);
            let (xj, yj) = (c[j].x as f64, c[j].y as f64);
            if (yi > q[1]) != (yj > q[1]) && q[0] < (xj - xi) * (q[1] - yi) / (yj - yi) + xi {
                inside = !inside;
            }
            j = i;
        }
    }
    inside
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn circle_circumscribes() {
        let c = circle(0.0, 0.0, 100_000.0);
        for q in &c {
            let d = ((q.x * q.x + q.y * q.y) as f64).sqrt();
            assert!(d >= 99_999.0);
        }
        assert!(signed_area(&c) > 0.0);
    }

    #[test]
    fn capsule_is_ccw() {
        let c = capsule([0.0, 0.0], [1_000_000.0, 0.0], 100_000.0);
        assert!(signed_area(&c) > 0.0);
        let area = signed_area(&c);
        let ideal = 2_000_00.0 * 1_000_000.0 + std::f64::consts::PI * 1e10;
        assert!((area - ideal).abs() / ideal < 0.01);
    }

    #[test]
    fn difference_makes_hole() {
        let outer = vec![vec![rect(0.0, 0.0, 1000.0, 1000.0, 0.0)]];
        let res = boolean(&outer, &[rect(0.0, 0.0, 100.0, 100.0, 0.0)], OverlayRule::Difference, FillRule::NonZero);
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].len(), 2);
        assert!(signed_area(&res[0][1]) < 0.0);
    }
}
