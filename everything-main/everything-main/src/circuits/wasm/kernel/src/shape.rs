//! Shapes exchanged with JavaScript and the distance queries between them.
//!
//! Every shape is a "core" (a point, a segment, or filled polygon rings)
//! grown by a radius `r`. A via is a point core with radius, a track is a
//! segment core, a rounded rectangle pad is its inner rectangle grown by the
//! corner radius, and a fill or pour is polygon rings with r = 0. The distance
//! between two shapes is the distance between their cores minus both radii.

pub const KIND_CIRCLE: u32 = 1;
pub const KIND_CAPSULE: u32 = 2;
pub const KIND_ROUNDRECT: u32 = 3;
pub const KIND_POLY: u32 = 4;

pub const F_PAD: u32 = 1;
pub const F_THRU: u32 = 2;
pub const F_VIA: u32 = 4;
pub const F_TRACK: u32 = 8;
pub const F_FILL: u32 = 16;
pub const F_POURFILL: u32 = 32;
pub const F_KEEPOUT: u32 = 64;
pub const F_COURTYARD: u32 = 128;
pub const F_EDGE: u32 = 256;

/// Copper layer bits 0..=5; courtyards use bits 10 (top) and 11 (bottom).
pub const COPPER_MASK: u32 = 0x3f;

#[derive(Clone, Debug)]
pub struct Shape {
    pub kind: u32,
    pub mask: u32,
    pub net: i32,
    pub obj: i32,
    pub flags: u32,
    pub clr: f64,
    pub r: f64,
    /// Core points. Point: 1, segment: 2, polygon rings: concatenated.
    pub pts: Vec<[f64; 2]>,
    /// Ring ranges into pts (closed cores only).
    pub rings: Vec<(usize, usize)>,
    pub closed: bool,
    /// Bounding box of the whole shape: [minx, miny, maxx, maxy].
    pub bbox: [f64; 4],
    /// Pad frame for thermal spokes: center, half sizes, rotation (deg).
    pub cx: f64,
    pub cy: f64,
    pub hw: f64,
    pub hh: f64,
    pub rot: f64,
}

impl Shape {
    pub fn is_copper(&self) -> bool {
        self.mask & COPPER_MASK != 0 && self.flags & (F_KEEPOUT | F_COURTYARD | F_EDGE) == 0
    }

    /// Representative points that lie on the shape's copper.
    pub fn anchors(&self) -> Vec<[f64; 2]> {
        match self.kind {
            KIND_CAPSULE => {
                let a = self.pts[0];
                let b = self.pts[1];
                vec![a, b, [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]]
            }
            KIND_POLY => {
                let c = [(self.bbox[0] + self.bbox[2]) / 2.0, (self.bbox[1] + self.bbox[3]) / 2.0];
                if point_in_rings(c, &self.pts, &self.rings) {
                    vec![c]
                } else if let Some(p) = self.pts.first() {
                    vec![*p]
                } else {
                    vec![]
                }
            }
            _ => vec![[self.cx, self.cy]],
        }
    }
}

fn rot_pt(x: f64, y: f64, deg: f64) -> [f64; 2] {
    let a = deg.to_radians();
    let (s, c) = a.sin_cos();
    [x * c - y * s, x * s + y * c]
}

/// Decodes one shape record starting at `i`; returns the shape and the next index.
/// Record: kind, mask, net, obj, flags, clr, then geometry by kind.
pub fn decode(buf: &[f64], mut i: usize) -> (Shape, usize) {
    let kind = buf[i] as u32;
    let mask = buf[i + 1] as u32;
    let net = buf[i + 2] as i32;
    let obj = buf[i + 3] as i32;
    let flags = buf[i + 4] as u32;
    let clr = buf[i + 5];
    i += 6;
    let mut s = Shape {
        kind, mask, net, obj, flags, clr, r: 0.0, pts: Vec::new(), rings: Vec::new(), closed: false,
        bbox: [0.0; 4], cx: 0.0, cy: 0.0, hw: 0.0, hh: 0.0, rot: 0.0,
    };
    match kind {
        KIND_CIRCLE => {
            let (x, y, r) = (buf[i], buf[i + 1], buf[i + 2]);
            i += 3;
            s.pts.push([x, y]);
            s.r = r;
            s.cx = x;
            s.cy = y;
            s.hw = r;
            s.hh = r;
        }
        KIND_CAPSULE => {
            let (x1, y1, x2, y2, r) = (buf[i], buf[i + 1], buf[i + 2], buf[i + 3], buf[i + 4]);
            i += 5;
            s.pts.push([x1, y1]);
            s.pts.push([x2, y2]);
            s.r = r;
            s.cx = (x1 + x2) / 2.0;
            s.cy = (y1 + y2) / 2.0;
            let len = ((x2 - x1).powi(2) + (y2 - y1).powi(2)).sqrt();
            s.hw = len / 2.0 + r;
            s.hh = r;
            s.rot = (y2 - y1).atan2(x2 - x1).to_degrees();
        }
        KIND_ROUNDRECT => {
            let (cx, cy, hw, hh, rot, rad) = (buf[i], buf[i + 1], buf[i + 2], buf[i + 3], buf[i + 4], buf[i + 5]);
            i += 6;
            let rad = rad.max(0.0).min(hw.min(hh));
            let (ix, iy) = (hw - rad, hh - rad);
            for (x, y) in [(-ix, -iy), (ix, -iy), (ix, iy), (-ix, iy)] {
                let p = rot_pt(x, y, rot);
                s.pts.push([cx + p[0], cy + p[1]]);
            }
            s.rings.push((0, 4));
            s.closed = true;
            s.r = rad;
            s.cx = cx;
            s.cy = cy;
            s.hw = hw;
            s.hh = hh;
            s.rot = rot;
        }
        _ => {
            let n_rings = buf[i] as usize;
            i += 1;
            for _ in 0..n_rings {
                let n = buf[i] as usize;
                i += 1;
                let start = s.pts.len();
                for k in 0..n {
                    s.pts.push([buf[i + 2 * k], buf[i + 2 * k + 1]]);
                }
                i += 2 * n;
                if n >= 3 {
                    s.rings.push((start, start + n));
                }
            }
            s.closed = true;
        }
    }
    let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    for p in &s.pts {
        b[0] = b[0].min(p[0]);
        b[1] = b[1].min(p[1]);
        b[2] = b[2].max(p[0]);
        b[3] = b[3].max(p[1]);
    }
    s.bbox = [b[0] - s.r, b[1] - s.r, b[2] + s.r, b[3] + s.r];
    if kind == KIND_POLY {
        s.cx = (s.bbox[0] + s.bbox[2]) / 2.0;
        s.cy = (s.bbox[1] + s.bbox[3]) / 2.0;
        s.hw = (s.bbox[2] - s.bbox[0]) / 2.0;
        s.hh = (s.bbox[3] - s.bbox[1]) / 2.0;
    }
    (s, i)
}

pub fn point_in_rings(p: [f64; 2], pts: &[[f64; 2]], rings: &[(usize, usize)]) -> bool {
    let mut inside = false;
    for &(a, b) in rings {
        let mut j = b - 1;
        for k in a..b {
            let (xi, yi) = (pts[k][0], pts[k][1]);
            let (xj, yj) = (pts[j][0], pts[j][1]);
            if (yi > p[1]) != (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi {
                inside = !inside;
            }
            j = k;
        }
    }
    inside
}

/// Closest points between segments ab and cd; returns (dist, pa, pc).
pub fn seg_seg(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> (f64, [f64; 2], [f64; 2]) {
    if segs_cross(a, b, c, d) {
        let p = intersection(a, b, c, d).unwrap_or(a);
        return (0.0, p, p);
    }
    let mut best = (f64::INFINITY, a, c);
    for (p, s0, s1, flip) in [(a, c, d, false), (b, c, d, false), (c, a, b, true), (d, a, b, true)] {
        let q = closest_on_seg(p, s0, s1);
        let dd = ((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2)).sqrt();
        if dd < best.0 {
            best = if flip { (dd, q, p) } else { (dd, p, q) };
        }
    }
    best
}

pub fn closest_on_seg(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let l2 = dx * dx + dy * dy;
    if l2 <= 0.0 {
        return a;
    }
    let t = (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2).clamp(0.0, 1.0);
    [a[0] + t * dx, a[1] + t * dy]
}

fn orient(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/// Proper crossing (interiors intersect at a single point; no touching).
pub fn segs_cross(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> bool {
    let (o1, o2, o3, o4) = (orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b));
    (o1 > 0.0) != (o2 > 0.0) && (o3 > 0.0) != (o4 > 0.0) && o1 != 0.0 && o2 != 0.0 && o3 != 0.0 && o4 != 0.0
}

fn intersection(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> Option<[f64; 2]> {
    let r = [b[0] - a[0], b[1] - a[1]];
    let s = [d[0] - c[0], d[1] - c[1]];
    let den = r[0] * s[1] - r[1] * s[0];
    if den == 0.0 {
        return None;
    }
    let t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
    Some([a[0] + t * r[0], a[1] + t * r[1]])
}

/// Iterates the edges of a core as (start, end) pairs. Points yield one
/// degenerate edge, segments one edge, closed rings every ring edge.
fn edges(s: &Shape) -> Vec<([f64; 2], [f64; 2])> {
    if !s.closed {
        return if s.pts.len() == 1 { vec![(s.pts[0], s.pts[0])] } else { vec![(s.pts[0], s.pts[1])] };
    }
    let mut out = Vec::with_capacity(s.pts.len());
    for &(a, b) in &s.rings {
        let mut j = b - 1;
        for k in a..b {
            out.push((s.pts[j], s.pts[k]));
            j = k;
        }
    }
    out
}

/// Distance between the cores of two shapes (0 when they overlap) with the
/// closest points. `limit` lets callers skip far edges early.
pub fn core_distance(a: &Shape, b: &Shape, limit: f64) -> (f64, [f64; 2], [f64; 2]) {
    if b.closed && !a.pts.is_empty() && point_in_rings(a.pts[0], &b.pts, &b.rings) {
        return (0.0, a.pts[0], a.pts[0]);
    }
    if a.closed && !b.pts.is_empty() && point_in_rings(b.pts[0], &a.pts, &a.rings) {
        return (0.0, b.pts[0], b.pts[0]);
    }
    let ea = edges(a);
    let eb = edges(b);
    let mut best = (f64::INFINITY, [0.0, 0.0], [0.0, 0.0]);
    // Prune edges by bounding box against the other shape's core box.
    let bb = core_box(b, limit);
    let ab = core_box(a, limit);
    let eb: Vec<_> = eb.into_iter().filter(|(p, q)| box_hit(p, q, &ab)).collect();
    for (p, q) in ea {
        if !box_hit(&p, &q, &bb) {
            continue;
        }
        for (r, t) in &eb {
            let res = seg_seg(p, q, *r, *t);
            if res.0 < best.0 {
                best = res;
                if best.0 == 0.0 {
                    return best;
                }
            }
        }
    }
    if best.0.is_infinite() {
        // Nothing within the limit: report the limit so callers treat it as far.
        best.0 = limit.max(0.0) + 1.0;
    }
    best
}

fn core_box(s: &Shape, pad: f64) -> [f64; 4] {
    [s.bbox[0] + s.r - pad, s.bbox[1] + s.r - pad, s.bbox[2] - s.r + pad, s.bbox[3] - s.r + pad]
}

fn box_hit(p: &[f64; 2], q: &[f64; 2], b: &[f64; 4]) -> bool {
    p[0].min(q[0]) <= b[2] && p[0].max(q[0]) >= b[0] && p[1].min(q[1]) <= b[3] && p[1].max(q[1]) >= b[1]
}

/// Gap between two shapes (negative values are clamped to 0) and the point
/// midway between their closest points. `limit` bounds the search.
pub fn gap(a: &Shape, b: &Shape, limit: f64) -> (f64, [f64; 2]) {
    let (d, p, q) = core_distance(a, b, limit + a.r + b.r);
    let g = (d - a.r - b.r).max(0.0);
    (g, [(p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0])
}

/// Distance from a point to the shape surface (0 inside).
pub fn point_distance(s: &Shape, p: [f64; 2]) -> f64 {
    if s.closed && point_in_rings(p, &s.pts, &s.rings) {
        return 0.0;
    }
    let mut best = f64::INFINITY;
    if !s.closed {
        let q = if s.pts.len() == 1 { s.pts[0] } else { closest_on_seg(p, s.pts[0], s.pts[1]) };
        best = ((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2)).sqrt();
    } else {
        for &(a, b) in &s.rings {
            let mut j = b - 1;
            for k in a..b {
                let q = closest_on_seg(p, s.pts[j], s.pts[k]);
                let d = ((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2)).sqrt();
                if d < best {
                    best = d;
                }
                j = k;
            }
        }
    }
    (best - s.r).max(0.0)
}

pub fn boxes_overlap(a: &[f64; 4], b: &[f64; 4], pad: f64) -> bool {
    a[0] - pad <= b[2] && a[2] + pad >= b[0] && a[1] - pad <= b[3] && a[3] + pad >= b[1]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn circle(x: f64, y: f64, r: f64) -> Shape {
        decode(&[1.0, 1.0, 0.0, 0.0, 0.0, 0.0, x, y, r], 0).0
    }

    #[test]
    fn circle_gap() {
        let a = circle(0.0, 0.0, 10.0);
        let b = circle(30.0, 0.0, 5.0);
        let (g, _) = gap(&a, &b, 100.0);
        assert!((g - 15.0).abs() < 1e-9);
    }

    #[test]
    fn rect_contains_point() {
        let r = decode(&[3.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 10.0, 5.0, 0.0, 0.0], 0).0;
        let c = circle(2.0, 1.0, 1.0);
        assert_eq!(gap(&r, &c, 100.0).0, 0.0);
        let far = circle(20.0, 0.0, 1.0);
        assert!((gap(&r, &far, 100.0).0 - 9.0).abs() < 1e-9);
    }

    #[test]
    fn rotated_rect() {
        let r = decode(&[3.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 10.0, 2.0, 90.0, 0.0], 0).0;
        assert!((point_distance(&r, [0.0, 11.0]) - 1.0).abs() < 1e-6);
        assert!((point_distance(&r, [3.0, 0.0]) - 1.0).abs() < 1e-6);
    }
}
