//! Curve reconstruction: map polygon output edges back onto the source
//! curves they lie on and rebuild exact Bezier sub-curves.

use crate::model::*;

#[derive(Clone, Copy, Debug)]
pub struct Item {
    pub curve: Option<u32>,
    pub t0: f64,
    pub t1: f64,
    pub a: Pt,
    pub b: Pt,
}

/// Project p onto curve c's polyline: (t, distance).
fn project(reg: &Registry, c: u32, p: Pt, hint: Option<u32>) -> (f64, f64) {
    let cur = &reg.curves[c as usize];
    if cur.line {
        let (d, u) = seg_dist(p, cur.p[0], cur.p[3]);
        return (u, d);
    }
    let mut best = (0.0, f64::INFINITY, 0u32);
    for ei in cur.e0..cur.e1 {
        let e = &reg.edges[ei as usize];
        let (d, u) = seg_dist(p, e.a, e.b);
        let better = d < best.1 - 1e-12 || ((d - best.1).abs() <= 1e-12 && hint.map_or(false, |h| (ei as i64 - h as i64).abs() < (best.2 as i64 - h as i64).abs()));
        if better {
            best = (e.ta + (e.tb - e.ta) * u, d, ei);
        }
    }
    (refine_t(&cur.p, p, best.0), best.1)
}

/// Distance from p to the polyline of curve c (cheap check).
fn curve_dist(reg: &Registry, c: u32, p: Pt) -> f64 {
    let cur = &reg.curves[c as usize];
    let mut best = f64::INFINITY;
    for ei in cur.e0..cur.e1 {
        let e = &reg.edges[ei as usize];
        let d = seg_dist(p, e.a, e.b).0;
        if d < best {
            best = d;
        }
    }
    best
}

/// One item per polygon edge.
pub fn items(reg: &Registry, pts: &[Pt], closed: bool) -> Vec<Item> {
    let n = pts.len();
    let m = if closed { n } else { n.saturating_sub(1) };
    let eps = reg.eps;
    let mut out: Vec<Item> = Vec::with_capacity(m);
    let mut prev: Option<u32> = None;
    for k in 0..m {
        let a = pts[k];
        let b = pts[(k + 1) % n];
        let mid = lerp(a, b, 0.5);
        let mut chosen: Option<(u32, u32)> = None;
        if let Some(pc) = prev {
            if curve_dist(reg, pc, mid) <= eps {
                chosen = Some((pc, reg.curves[pc as usize].e0));
            }
        }
        if chosen.is_none() {
            let mut best = f64::INFINITY;
            for &ei in reg.candidates(mid) {
                let e = &reg.edges[ei as usize];
                let d = seg_dist(mid, e.a, e.b).0;
                if d < best {
                    best = d;
                    chosen = Some((e.curve, ei));
                }
            }
            if best > eps {
                chosen = None;
            }
        }
        let item = match chosen {
            Some((c, hint)) => {
                let (t0, d0) = project(reg, c, a, Some(hint));
                let (t1, d1) = project(reg, c, b, Some(hint));
                if d0 <= eps * 4.0 && d1 <= eps * 4.0 {
                    Item { curve: Some(c), t0, t1, a, b }
                } else {
                    Item { curve: None, t0: 0.0, t1: 1.0, a, b }
                }
            }
            None => Item { curve: None, t0: 0.0, t1: 1.0, a, b },
        };
        prev = item.curve;
        out.push(item);
    }
    out
}

fn mergeable(p: &Item, q: &Item) -> bool {
    match (p.curve, q.curve) {
        (Some(a), Some(b)) if a == b => {
            if (p.t1 - q.t0).abs() > 1e-6 {
                return false;
            }
            let d1 = p.t1 - p.t0;
            let d2 = q.t1 - q.t0;
            d1 * d2 >= 0.0
        }
        _ => false,
    }
}

/// Merge consecutive items on the same curve into runs. For closed contours
/// the list is rotated so a run never wraps around the end.
pub fn runs(mut it: Vec<Item>, closed: bool) -> Vec<Item> {
    if it.is_empty() {
        return it;
    }
    if closed {
        let n = it.len();
        if let Some(s) = (0..n).find(|&i| !mergeable(&it[(i + n - 1) % n], &it[i])) {
            it.rotate_left(s);
        }
    }
    let mut out: Vec<Item> = Vec::with_capacity(it.len());
    for i in it {
        if let Some(last) = out.last_mut() {
            if mergeable(last, &i) {
                last.t1 = i.t1;
                last.b = i.b;
                continue;
            }
        }
        out.push(i);
    }
    out
}

/// Control points for a run, with endpoints snapped to the polygon vertices
/// (or to the exact original anchors when the run starts/ends there).
pub fn run_cubic(reg: &Registry, r: &Item) -> ([Pt; 4], bool) {
    let c = match r.curve {
        Some(c) => &reg.curves[c as usize],
        None => return ([r.a, r.a, r.b, r.b], true),
    };
    let snap = |t: f64, v: Pt| -> Pt {
        if t <= 1e-9 && dist(c.p[0], v) <= reg.eps * 8.0 {
            c.p[0]
        } else if t >= 1.0 - 1e-9 && dist(c.p[3], v) <= reg.eps * 8.0 {
            c.p[3]
        } else {
            v
        }
    };
    let a = snap(r.t0, r.a);
    let b = snap(r.t1, r.b);
    if c.line {
        return ([a, a, b, b], true);
    }
    let mut q = if r.t0 <= r.t1 {
        sub_cubic(&c.p, r.t0, r.t1)
    } else {
        let s = sub_cubic(&c.p, r.t1, r.t0);
        [s[3], s[2], s[1], s[0]]
    };
    let da = [a[0] - q[0][0], a[1] - q[0][1]];
    let db = [b[0] - q[3][0], b[1] - q[3][1]];
    q[0] = a;
    q[1] = [q[1][0] + da[0], q[1][1] + da[1]];
    q[3] = b;
    q[2] = [q[2][0] + db[0], q[2][1] + db[1]];
    (q, false)
}

/// Rebuild a subpath from a polygon contour (or open polyline).
pub fn rebuild(reg: &Registry, pts: &[Pt], closed: bool) -> Option<Subpath> {
    let rs = runs(items(reg, pts, closed), closed);
    let cubics: Vec<([Pt; 4], bool)> = rs
        .iter()
        .map(|r| run_cubic(reg, r))
        .filter(|(q, line)| !(*line && dist(q[0], q[3]) <= reg.eps))
        .collect();
    build_subpath(&cubics, closed)
}

pub fn build_subpath(cubics: &[([Pt; 4], bool)], closed: bool) -> Option<Subpath> {
    let n = cubics.len();
    if n == 0 || (closed && n < 2) {
        return None;
    }
    let mut anchors = Vec::with_capacity(n + 1);
    for (i, (q, _)) in cubics.iter().enumerate() {
        let mut a = Anchor::at(q[0]);
        a.ox = q[1][0];
        a.oy = q[1][1];
        if i > 0 {
            let p = &cubics[i - 1].0;
            a.ix = p[2][0];
            a.iy = p[2][1];
        } else if closed {
            let p = &cubics[n - 1].0;
            a.ix = p[2][0];
            a.iy = p[2][1];
        }
        anchors.push(a);
    }
    if !closed {
        let q = &cubics[n - 1].0;
        let mut a = Anchor::at(q[3]);
        a.ix = q[2][0];
        a.iy = q[2][1];
        anchors.push(a);
    }
    Some(Subpath { closed, anchors })
}

/// Outline: every arrangement edge once, split at junctions (points where a
/// face boundary switches source shape), chained per shape between
/// junctions. Each piece takes the topmost owner of the faces beside it.
/// Input: faces as (contours, owner). Output: (owner, subpath) pieces.
pub fn outline(reg: &Registry, faces: &[(Vec<Vec<Pt>>, i32)]) -> Vec<(i32, Subpath)> {
    let shape_of = |r: &Item| r.curve.map(|c| reg.curves[c as usize].shape as i64).unwrap_or(-1);
    // Runs per contour.
    let mut all: Vec<(i32, Vec<Item>)> = Vec::new();
    for (contours, owner) in faces {
        for c in contours {
            let rs = runs(items(reg, c, true), true);
            if !rs.is_empty() {
                all.push((*owner, rs));
            }
        }
    }
    // Junction points.
    let mut junctions: Vec<Pt> = Vec::new();
    for (_, rs) in &all {
        let n = rs.len();
        for i in 0..n {
            let prev = &rs[(i + n - 1) % n];
            if shape_of(prev) != shape_of(&rs[i]) {
                junctions.push(rs[i].a);
            }
        }
    }
    // Junction parameters per curve.
    let mut cuts: Vec<Vec<f64>> = vec![Vec::new(); reg.curves.len()];
    for j in &junctions {
        for &ei in reg.candidates(*j) {
            let e = &reg.edges[ei as usize];
            let (d, u) = seg_dist(*j, e.a, e.b);
            if d <= reg.eps * 4.0 {
                let c = e.curve as usize;
                let cur = &reg.curves[c];
                let t = if cur.line { seg_dist(*j, cur.p[0], cur.p[3]).1 } else { refine_t(&cur.p, *j, e.ta + (e.tb - e.ta) * u) };
                cuts[c].push(t);
            }
        }
    }
    // Split runs at cuts.
    let key = |r: &Item| -> (i64, i64, i64) {
        let c = r.curve.map(|c| c as i64).unwrap_or(-1);
        if c < 0 {
            let q = |v: f64| (v * 1e4).round() as i64;
            let (a, b) = if (r.a[0], r.a[1]) <= (r.b[0], r.b[1]) { (r.a, r.b) } else { (r.b, r.a) };
            return (-1 - q(a[0]) * 31 - q(a[1]), q(b[0]), q(b[1]));
        }
        let (t0, t1) = if r.t0 <= r.t1 { (r.t0, r.t1) } else { (r.t1, r.t0) };
        (c, (t0 * 1e6).round() as i64, (t1 * 1e6).round() as i64)
    };
    let mut seen: Vec<((i64, i64, i64), usize)> = Vec::new();
    let mut pieces: Vec<(i32, Vec<([Pt; 4], bool)>, bool)> = Vec::new();
    for (owner, rs) in &all {
        let mut segs: Vec<(Item, bool)> = Vec::new(); // (item, starts at a junction)
        let n = rs.len();
        for i in 0..n {
            let r = rs[i];
            let at_junction = shape_of(&rs[(i + n - 1) % n]) != shape_of(&r);
            let mut ts: Vec<f64> = match r.curve {
                Some(c) => {
                    let (lo, hi) = if r.t0 <= r.t1 { (r.t0, r.t1) } else { (r.t1, r.t0) };
                    cuts[c as usize].iter().copied().filter(|&t| t > lo + 1e-7 && t < hi - 1e-7).collect()
                }
                None => Vec::new(),
            };
            ts.sort_by(|a, b| a.partial_cmp(b).unwrap());
            if r.t0 > r.t1 {
                ts.reverse();
            }
            let c = r.curve.map(|c| &reg.curves[c as usize]);
            let mut start = r;
            let mut first = true;
            for t in ts {
                let p = cubic_at(&c.unwrap().p, t);
                let mut left = start;
                left.t1 = t;
                left.b = p;
                segs.push((left, if first { at_junction } else { true }));
                first = false;
                start.t0 = t;
                start.a = p;
            }
            segs.push((start, if first { at_junction } else { true }));
        }
        let all_one = !segs.iter().any(|s| s.1);
        let mut cur: Option<usize> = None;
        for (s, junction) in &segs {
            let k = key(s);
            if let Some(&(_, pi)) = seen.iter().find(|(kk, _)| *kk == k) {
                pieces[pi].0 = pieces[pi].0.max(*owner);
                cur = None;
                continue;
            }
            let cq = run_cubic(reg, s);
            if cq.1 && dist(cq.0[0], cq.0[3]) <= reg.eps {
                continue;
            }
            let pi = match cur {
                Some(pi) if !*junction => pi,
                _ => {
                    pieces.push((*owner, Vec::new(), false));
                    pieces.len() - 1
                }
            };
            pieces[pi].1.push(cq);
            seen.push((k, pi));
            cur = Some(pi);
        }
        if all_one {
            if let Some(pi) = cur {
                pieces[pi].2 = true;
            }
        }
        // Join a trailing piece onto the contour's first piece across the start point.
        let firsts: Vec<usize> = segs.iter().filter_map(|s| seen.iter().find(|(kk, _)| *kk == key(&s.0)).map(|x| x.1)).collect();
        if let (Some(&f), Some(&l)) = (firsts.first(), firsts.last()) {
            if f != l && !segs[0].1 && !pieces[f].2 {
                let tail = core::mem::take(&mut pieces[l].1);
                let head = core::mem::take(&mut pieces[f].1);
                pieces[l].1 = tail.into_iter().chain(head).collect();
                for e in seen.iter_mut() {
                    if e.1 == f {
                        e.1 = l;
                    }
                }
            }
        }
    }
    pieces
        .into_iter()
        .filter(|p| !p.1.is_empty())
        .filter_map(|(owner, cubics, closed)| build_subpath(&cubics, closed && cubics.len() > 1).map(|sp| (owner, sp)))
        .collect()
}
