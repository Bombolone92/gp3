//! Geometry operations: shape modes, pathfinders (faces), slicing, erasing,
//! stroke outlining, offsetting and simplification.

use crate::model::*;
use crate::recon::{outline, rebuild};
use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay::ShapeType;
use i_overlay::i_float::adapter::FloatPointAdapter;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::core::solver::Solver;
use i_overlay::float::clip::FloatClip;
use i_overlay::float::overlay::{FloatOverlay, OverlayOptions};
use i_overlay::float::slice::FloatSlice;
use i_overlay::string::clip::ClipRule;
use kurbo::{BezPath, Cap, Join, PathEl, Point, Stroke, StrokeOpts};

pub type Contours = Vec<Vec<Pt>>;
pub type Shapes = Vec<Contours>;

pub const OP_UNITE: u32 = 0;
pub const OP_INTERSECT: u32 = 1;
pub const OP_EXCLUDE: u32 = 2;
pub const OP_MINUS_FRONT: u32 = 3;
pub const OP_MINUS_BACK: u32 = 4;
pub const OP_DIVIDE: u32 = 5;
pub const OP_TRIM: u32 = 6;
pub const OP_MERGE: u32 = 7;
pub const OP_CROP: u32 = 8;
pub const OP_OUTLINE: u32 = 9;
pub const OP_SUBTRACT_EACH: u32 = 10;
pub const OP_DIVIDE_BELOW: u32 = 11;
pub const OP_SLICE_EACH: u32 = 12;
pub const OP_STROKE: u32 = 13;
pub const OP_OFFSET: u32 = 14;
pub const OP_SIMPLIFY: u32 = 15;
pub const OP_NORMALIZE: u32 = 16;
pub const OP_UNITE_GROUPS: u32 = 17;

fn opts() -> OverlayOptions<f64> {
    let mut o = OverlayOptions::<f64>::default();
    o.preserve_output_collinear = false;
    o.preserve_input_collinear = false;
    o.clean_result = true;
    o
}

fn overlay(subj: &Contours, clip: &Contours, rule: OverlayRule, fill: FillRule) -> Shapes {
    if subj.is_empty() && clip.is_empty() {
        return Vec::new();
    }
    FloatOverlay::with_subj_and_clip_custom(subj, clip, opts(), Solver::default()).overlay(rule, fill)
}

fn flat(shapes: &Shapes) -> Contours {
    shapes.iter().flat_map(|s| s.iter().cloned()).collect()
}

fn bbox(c: &Contours) -> Option<[f64; 4]> {
    let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    for p in c.iter().flatten() {
        b[0] = b[0].min(p[0]);
        b[1] = b[1].min(p[1]);
        b[2] = b[2].max(p[0]);
        b[3] = b[3].max(p[1]);
    }
    if b[0].is_finite() {
        Some(b)
    } else {
        None
    }
}

fn boxes_touch(a: &Option<[f64; 4]>, b: &Option<[f64; 4]>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3],
        _ => false,
    }
}

/// Flattened and normalized (non-overlapping, consistently oriented) input shapes.
pub struct Prepared {
    pub reg: Registry,
    pub raw: Vec<Contours>,
    pub norm: Vec<Contours>,
    pub strings: Vec<Vec<Vec<Pt>>>,
    pub boxes: Vec<Option<[f64; 4]>>,
}

pub fn prepare(shapes: &[Shape], tol: f64) -> Prepared {
    let mut reg = Registry::new(tol);
    let mut raw = Vec::with_capacity(shapes.len());
    let mut strings = Vec::with_capacity(shapes.len());
    for (i, s) in shapes.iter().enumerate() {
        let mut contours = Vec::new();
        let mut lines = Vec::new();
        for sp in &s.subpaths {
            if s.string() {
                let pl = reg.add_subpath(sp, i as u32, sp.closed);
                if pl.len() >= 2 {
                    let mut pl = pl;
                    if sp.closed {
                        pl.push(pl[0]);
                    }
                    lines.push(pl);
                }
            } else {
                let c = reg.add_subpath(sp, i as u32, true);
                if c.len() >= 3 {
                    contours.push(c);
                }
            }
        }
        raw.push(contours);
        strings.push(lines);
    }
    reg.build();
    // Normalize every shape on one shared integer grid: per-shape grids round
    // each shape's vertices differently, so edges two shapes share exactly
    // (Divide faces, snapped artwork) would stop coinciding and later unions
    // would keep them as slivers.
    let adapter: FloatPointAdapter<Pt, i32> = FloatPointAdapter::with_iter_conservative(raw.iter().flatten().flatten());
    let norm: Vec<Contours> = shapes
        .iter()
        .zip(raw.iter())
        .map(|(s, c)| {
            if s.string() || c.is_empty() {
                Vec::new()
            } else {
                let fill = if s.evenodd() { FillRule::EvenOdd } else { FillRule::NonZero };
                let cap = c.iter().map(|k| k.len()).sum();
                let shapes = FloatOverlay::new_custom(adapter.clone(), opts(), Solver::default(), cap)
                    .unsafe_add_source(c, ShapeType::Subject)
                    .overlay(OverlayRule::Subject, fill);
                flat(&shapes)
            }
        })
        .collect();
    let boxes = norm.iter().map(bbox).collect();
    Prepared { reg, raw, norm, strings, boxes }
}

fn rebuild_shape(reg: &Registry, shape: &Contours) -> Vec<Subpath> {
    shape.iter().filter_map(|c| rebuild(reg, c, true)).collect()
}

fn out_all(reg: &Registry, shapes: &Shapes, owner: i32) -> OutShape {
    let mut subpaths = Vec::new();
    for s in shapes {
        subpaths.extend(rebuild_shape(reg, s));
    }
    OutShape { owner, flags: 0, cover: Vec::new(), subpaths }
}

fn out_each(reg: &Registry, shapes: &Shapes, owner: i32, out: &mut Vec<OutShape>) {
    for s in shapes {
        let subpaths = rebuild_shape(reg, s);
        if !subpaths.is_empty() {
            out.push(OutShape { owner, flags: 0, cover: Vec::new(), subpaths });
        }
    }
}

fn unchanged(owner: usize) -> OutShape {
    OutShape { owner: owner as i32, flags: R_UNCHANGED, cover: Vec::new(), subpaths: Vec::new() }
}

/// Indices of shapes that take part in area operations.
fn areas(shapes: &[Shape], p: &Prepared) -> Vec<usize> {
    (0..shapes.len()).filter(|&i| !shapes[i].string() && !p.norm[i].is_empty()).collect()
}

pub fn shape_mode(op: u32, shapes: &[Shape], tol: f64) -> Vec<OutShape> {
    let p = prepare(shapes, tol);
    let idx = areas(shapes, &p);
    if idx.is_empty() {
        return Vec::new();
    }
    let nz = FillRule::NonZero;
    let result: Shapes = match op {
        OP_UNITE => {
            let all: Contours = idx.iter().flat_map(|&i| p.norm[i].iter().cloned()).collect();
            overlay(&all, &Vec::new(), OverlayRule::Subject, nz)
        }
        OP_INTERSECT => {
            let mut acc = p.norm[idx[0]].clone();
            for &i in &idx[1..] {
                acc = flat(&overlay(&acc, &p.norm[i], OverlayRule::Intersect, nz));
                if acc.is_empty() {
                    break;
                }
            }
            overlay(&acc, &Vec::new(), OverlayRule::Subject, nz)
        }
        OP_EXCLUDE => {
            let mut acc = p.norm[idx[0]].clone();
            for &i in &idx[1..] {
                acc = flat(&overlay(&acc, &p.norm[i], OverlayRule::Xor, nz));
            }
            overlay(&acc, &Vec::new(), OverlayRule::Subject, nz)
        }
        OP_MINUS_FRONT | OP_MINUS_BACK => {
            let keep = if op == OP_MINUS_FRONT { idx[0] } else { idx[idx.len() - 1] };
            let rest: Contours = idx.iter().filter(|&&i| i != keep).flat_map(|&i| p.norm[i].iter().cloned()).collect();
            overlay(&p.norm[keep], &rest, OverlayRule::Difference, nz)
        }
        _ => Vec::new(),
    };
    let owner = match op {
        OP_MINUS_FRONT => idx[0] as i32,
        _ => idx[idx.len() - 1] as i32,
    };
    let o = out_all(&p.reg, &result, owner);
    if o.subpaths.is_empty() {
        Vec::new()
    } else {
        vec![o]
    }
}

pub struct Face {
    pub contours: Contours,
    pub cover: Vec<u32>,
    pub owner: i32,
}

/// Faces of the planar arrangement of all shapes (and cutting strings).
pub fn faces(shapes: &[Shape], p: &Prepared) -> Vec<Face> {
    let idx = areas(shapes, p);
    if idx.is_empty() {
        return Vec::new();
    }
    let nz = FillRule::NonZero;
    let all: Contours = idx.iter().flat_map(|&i| p.norm[i].iter().cloned()).collect();
    let union = flat(&overlay(&all, &Vec::new(), OverlayRule::Subject, nz));
    let mut lines: Vec<Vec<Pt>> = Vec::new();
    for &i in &idx {
        for c in &p.norm[i] {
            let mut l = c.clone();
            l.push(c[0]);
            lines.push(l);
        }
    }
    for s in &p.strings {
        lines.extend(s.iter().cloned());
    }
    let sliced: Shapes = if lines.is_empty() { overlay(&union, &Vec::new(), OverlayRule::Subject, nz) } else { union.slice_by(&lines, nz) };
    let min_area = (p.reg.tol * p.reg.tol).max(p.reg.eps * p.reg.eps * 100.0);
    let mut out = Vec::new();
    for f in sliced {
        let a: f64 = f.iter().map(|c| area(c)).sum::<f64>().abs();
        if a < min_area {
            continue;
        }
        let ip = match interior_point(&f) {
            Some(q) => q,
            None => continue,
        };
        let mut cover = Vec::new();
        for &i in &idx {
            if let Some(b) = p.boxes[i] {
                if ip[0] < b[0] || ip[0] > b[2] || ip[1] < b[1] || ip[1] > b[3] {
                    continue;
                }
            }
            let w = winding(&p.raw[i], ip);
            let inside = if shapes[i].evenodd() { w % 2 != 0 } else { w != 0 };
            if inside {
                cover.push(i as u32);
            }
        }
        if cover.is_empty() {
            continue;
        }
        let owner = cover.iter().rev().find(|&&i| shapes[i as usize].filled()).or(cover.last()).map(|&i| i as i32).unwrap_or(-1);
        out.push(Face { contours: f, cover, owner });
    }
    out
}

/// Union faces grouped by a key; each group yields one record per resulting shape.
fn union_groups(reg: &Registry, groups: Vec<(i64, i32, Contours)>, out: &mut Vec<OutShape>) {
    for (_, owner, contours) in groups {
        let u = overlay(&contours, &Vec::new(), OverlayRule::Subject, FillRule::NonZero);
        out_each(reg, &u, owner, out);
    }
}

fn group_faces(fs: &[Face], key: impl Fn(&Face) -> Option<(i64, i32)>) -> Vec<(i64, i32, Contours)> {
    let mut groups: Vec<(i64, i32, Contours)> = Vec::new();
    for f in fs {
        if let Some((k, owner)) = key(f) {
            if let Some(g) = groups.iter_mut().find(|g| g.0 == k) {
                g.1 = g.1.max(owner);
                g.2.extend(f.contours.iter().cloned());
            } else {
                groups.push((k, owner, f.contours.clone()));
            }
        }
    }
    groups
}

pub fn pathfinder(op: u32, shapes: &[Shape], tol: f64) -> Vec<OutShape> {
    let p = prepare(shapes, tol);
    let fs = faces(shapes, &p);
    let mut out = Vec::new();
    match op {
        OP_DIVIDE => {
            for f in &fs {
                let subpaths = rebuild_shape(&p.reg, &f.contours);
                if !subpaths.is_empty() {
                    out.push(OutShape { owner: f.owner, flags: 0, cover: f.cover.clone(), subpaths });
                }
            }
        }
        OP_TRIM => {
            let groups = group_faces(&fs, |f| Some((f.owner as i64, f.owner)));
            union_groups(&p.reg, groups, &mut out);
        }
        OP_MERGE => {
            // Same key (solid fill color chosen by the caller) merges; a negative key never merges.
            let groups = group_faces(&fs, |f| {
                let k = shapes[f.owner as usize].key;
                Some(if k >= 0.0 { (k as i64, f.owner) } else { (-1 - f.owner as i64, f.owner) })
            });
            union_groups(&p.reg, groups, &mut out);
        }
        OP_CROP => {
            let top = match areas(shapes, &p).last() {
                Some(&t) => t as u32,
                None => return out,
            };
            let groups = group_faces(&fs, |f| {
                if !f.cover.contains(&top) {
                    return None;
                }
                let o = f.cover.iter().rev().filter(|&&i| i != top).find(|&&i| shapes[i as usize].filled()).copied()?;
                Some((o as i64, o as i32))
            });
            union_groups(&p.reg, groups, &mut out);
        }
        OP_OUTLINE => {
            let input: Vec<(Contours, i32)> = fs.iter().map(|f| (f.contours.clone(), f.owner)).collect();
            for (owner, sp) in outline(&p.reg, &input) {
                out.push(OutShape { owner, flags: 0, cover: Vec::new(), subpaths: vec![sp] });
            }
        }
        _ => {}
    }
    out
}

/// Eraser and similar: subtract the last shape from each of the others.
pub fn subtract_each(shapes: &[Shape], tol: f64, keep_inside: bool) -> Vec<OutShape> {
    let p = prepare(shapes, tol);
    let n = shapes.len();
    if n < 2 {
        return Vec::new();
    }
    let cutter = &p.norm[n - 1];
    let cb = p.boxes[n - 1];
    let nz = FillRule::NonZero;
    let mut out = Vec::new();
    for i in 0..n - 1 {
        if shapes[i].string() {
            // Open paths: keep the parts outside the cutter.
            let lines = &p.strings[i];
            let lb = bbox(lines);
            if !boxes_touch(&lb, &cb) {
                out.push(unchanged(i));
                continue;
            }
            let rule = ClipRule { invert: true, boundary_included: false };
            let kept = lines.clip_by(cutter, nz, rule);
            let total_in: usize = lines.iter().map(|l| l.len()).sum();
            let total_out: usize = kept.iter().map(|l| l.len()).sum();
            if kept.len() == lines.len() && total_in == total_out {
                out.push(unchanged(i));
                continue;
            }
            for l in kept {
                if let Some(sp) = rebuild(&p.reg, &l, false) {
                    out.push(OutShape { owner: i as i32, flags: 0, cover: Vec::new(), subpaths: vec![sp] });
                }
            }
            if out.last().map_or(true, |o| o.owner != i as i32) {
                // Everything erased.
                out.push(OutShape { owner: i as i32, flags: 0, cover: Vec::new(), subpaths: Vec::new() });
            }
            continue;
        }
        if p.norm[i].is_empty() || !boxes_touch(&p.boxes[i], &cb) {
            out.push(unchanged(i));
            continue;
        }
        let hit = overlay(&p.norm[i], cutter, OverlayRule::Intersect, nz);
        if hit.is_empty() {
            out.push(unchanged(i));
            continue;
        }
        let before = out.len();
        if keep_inside {
            out_each(&p.reg, &hit, i as i32, &mut out);
            for o in &mut out[before..] {
                o.cover = vec![1];
            }
            let rest = overlay(&p.norm[i], cutter, OverlayRule::Difference, nz);
            let mid = out.len();
            out_each(&p.reg, &rest, i as i32, &mut out);
            for o in &mut out[mid..] {
                o.cover = vec![0];
            }
        } else {
            let rest = overlay(&p.norm[i], cutter, OverlayRule::Difference, nz);
            out_each(&p.reg, &rest, i as i32, &mut out);
        }
        if out.len() == before {
            out.push(OutShape { owner: i as i32, flags: 0, cover: Vec::new(), subpaths: Vec::new() });
        }
    }
    out
}

/// Knife: slice every area shape by the string shapes.
pub fn slice_each(shapes: &[Shape], tol: f64) -> Vec<OutShape> {
    let p = prepare(shapes, tol);
    let lines: Vec<Vec<Pt>> = p.strings.iter().flat_map(|s| s.iter().cloned()).collect();
    let lb = bbox(&lines);
    let mut out = Vec::new();
    for i in 0..shapes.len() {
        if shapes[i].string() {
            continue;
        }
        if p.norm[i].is_empty() || lines.is_empty() || !boxes_touch(&p.boxes[i], &lb) {
            out.push(unchanged(i));
            continue;
        }
        let pieces = p.norm[i].slice_by(&lines, FillRule::NonZero);
        if pieces.len() <= 1 {
            out.push(unchanged(i));
            continue;
        }
        out_each(&p.reg, &pieces, i as i32, &mut out);
    }
    out
}

/// Union shapes that share a key (Blob Brush, Merge helpers); keys < 0 pass through.
pub fn unite_groups(shapes: &[Shape], tol: f64) -> Vec<OutShape> {
    let p = prepare(shapes, tol);
    let mut groups: Vec<(i64, i32, Contours)> = Vec::new();
    for i in areas(shapes, &p) {
        let k = shapes[i].key;
        let key = if k >= 0.0 { k as i64 } else { -1 - i as i64 };
        if let Some(g) = groups.iter_mut().find(|g| g.0 == key) {
            g.1 = g.1.max(i as i32);
            g.2.extend(p.norm[i].iter().cloned());
        } else {
            groups.push((key, i as i32, p.norm[i].clone()));
        }
    }
    let mut out = Vec::new();
    for (_, owner, contours) in groups {
        let u = overlay(&contours, &Vec::new(), OverlayRule::Subject, FillRule::NonZero);
        let o = out_all(&p.reg, &u, owner);
        if !o.subpaths.is_empty() {
            out.push(o);
        }
    }
    out
}

/// Clean up a shape's own overlaps (normalize with its fill rule).
pub fn normalize(shapes: &[Shape], tol: f64) -> Vec<OutShape> {
    let p = prepare(shapes, tol);
    let mut out = Vec::new();
    for i in areas(shapes, &p) {
        let u = overlay(&p.norm[i], &Vec::new(), OverlayRule::Subject, FillRule::NonZero);
        let o = out_all(&p.reg, &u, i as i32);
        if !o.subpaths.is_empty() {
            out.push(o);
        }
    }
    out
}

// ---- kurbo bridges ----

pub fn to_bez(sp: &Subpath) -> BezPath {
    let mut b = BezPath::new();
    let n = sp.anchors.len();
    if n == 0 {
        return b;
    }
    let a0 = &sp.anchors[0];
    b.move_to((a0.x, a0.y));
    for seg in segments(sp, sp.closed) {
        if is_line(&seg) {
            b.line_to((seg[3][0], seg[3][1]));
        } else {
            b.curve_to((seg[1][0], seg[1][1]), (seg[2][0], seg[2][1]), (seg[3][0], seg[3][1]));
        }
    }
    if sp.closed {
        b.close_path();
    }
    b
}

pub fn from_bez(path: &BezPath) -> Vec<Subpath> {
    let mut out: Vec<Subpath> = Vec::new();
    let mut cur: Option<Subpath> = None;
    let mut last = Point::ZERO;
    let pt = |p: Point| [p.x, p.y];
    let finish = |cur: &mut Option<Subpath>, out: &mut Vec<Subpath>, closed: bool| {
        if let Some(mut sp) = cur.take() {
            if closed {
                let n = sp.anchors.len();
                if n > 1 {
                    let f = sp.anchors[0];
                    let l = sp.anchors[n - 1];
                    if (f.x - l.x).abs() < 1e-9 && (f.y - l.y).abs() < 1e-9 {
                        sp.anchors[0].ix = l.ix;
                        sp.anchors[0].iy = l.iy;
                        sp.anchors.pop();
                    }
                }
                sp.closed = true;
            }
            if sp.anchors.len() > 1 || (sp.anchors.len() == 1 && closed) {
                out.push(sp);
            }
        }
    };
    for el in path.elements() {
        match *el {
            PathEl::MoveTo(p) => {
                finish(&mut cur, &mut out, false);
                cur = Some(Subpath { closed: false, anchors: vec![Anchor::at(pt(p))] });
                last = p;
            }
            PathEl::LineTo(p) => {
                if let Some(sp) = cur.as_mut() {
                    if p != last {
                        sp.anchors.push(Anchor::at(pt(p)));
                    }
                }
                last = p;
            }
            PathEl::QuadTo(c, p) => {
                if let Some(sp) = cur.as_mut() {
                    let c1 = last + (c - last) * (2.0 / 3.0);
                    let c2 = p + (c - p) * (2.0 / 3.0);
                    let l = sp.anchors.last_mut().unwrap();
                    l.ox = c1.x;
                    l.oy = c1.y;
                    let mut a = Anchor::at(pt(p));
                    a.ix = c2.x;
                    a.iy = c2.y;
                    sp.anchors.push(a);
                }
                last = p;
            }
            PathEl::CurveTo(c1, c2, p) => {
                if let Some(sp) = cur.as_mut() {
                    let l = sp.anchors.last_mut().unwrap();
                    l.ox = c1.x;
                    l.oy = c1.y;
                    let mut a = Anchor::at(pt(p));
                    a.ix = c2.x;
                    a.iy = c2.y;
                    sp.anchors.push(a);
                }
                last = p;
            }
            PathEl::ClosePath => {
                finish(&mut cur, &mut out, true);
            }
        }
    }
    finish(&mut cur, &mut out, false);
    out
}

fn join_of(v: f64) -> Join {
    match v as i32 {
        1 => Join::Round,
        2 => Join::Bevel,
        _ => Join::Miter,
    }
}

fn cap_of(v: f64) -> Cap {
    match v as i32 {
        1 => Cap::Round,
        2 => Cap::Square,
        _ => Cap::Butt,
    }
}

fn stroke_shape(sps: &[Subpath], st: &Stroke, tol: f64) -> Shape {
    let mut subpaths = Vec::new();
    for sp in sps {
        if sp.anchors.len() < 2 && !(sp.closed && sp.anchors.len() == 1) {
            continue;
        }
        let out = kurbo::stroke(to_bez(sp).elements().iter().copied(), st, &StrokeOpts::default(), tol);
        subpaths.extend(from_bez(&out));
    }
    Shape { flags: F_FILLED, key: 0.0, subpaths }
}

/// Outline Stroke. params: [width, join, cap, miter, align, dashOffset, dash...]
/// align: 0 center, 1 inside, 2 outside.
pub fn outline_stroke(params: &[f64], shapes: &[Shape], tol: f64) -> Vec<OutShape> {
    let g = |i: usize, d: f64| params.get(i).copied().unwrap_or(d);
    let width = g(0, 1.0).max(0.0);
    let align = g(4, 0.0) as i32;
    let dashes: Vec<f64> = params.iter().skip(6).copied().filter(|d| *d >= 0.0).collect();
    let mut st = Stroke::new(if align == 0 { width } else { width * 2.0 }).with_join(join_of(g(1, 0.0))).with_caps(cap_of(g(2, 0.0))).with_miter_limit(g(3, 10.0).max(1.0));
    if !dashes.is_empty() && dashes.iter().sum::<f64>() > 0.0 {
        st = st.with_dashes(g(5, 0.0), dashes);
    }
    let mut out = Vec::new();
    for (i, s) in shapes.iter().enumerate() {
        let stroked = stroke_shape(&s.subpaths, &st, tol * 0.5);
        if stroked.subpaths.is_empty() {
            continue;
        }
        let all_closed = s.subpaths.iter().all(|sp| sp.closed);
        let mut base = s.clone();
        base.flags = F_FILLED | (s.flags & F_EVENODD);
        let pair = [base, stroked];
        let p = prepare(&pair, tol);
        let nz = FillRule::NonZero;
        let res = if align == 1 && all_closed {
            overlay(&p.norm[1], &p.norm[0], OverlayRule::Intersect, nz)
        } else if align == 2 && all_closed {
            overlay(&p.norm[1], &p.norm[0], OverlayRule::Difference, nz)
        } else {
            overlay(&p.norm[1], &Vec::new(), OverlayRule::Subject, nz)
        };
        let o = out_all(&p.reg, &res, i as i32);
        if !o.subpaths.is_empty() {
            out.push(o);
        }
    }
    out
}

/// Offset Path. params: [delta, join, miter]
pub fn offset_path(params: &[f64], shapes: &[Shape], tol: f64) -> Vec<OutShape> {
    let delta = params.first().copied().unwrap_or(0.0);
    let join = params.get(1).copied().unwrap_or(0.0);
    let miter = params.get(2).copied().unwrap_or(4.0).max(1.0);
    let cap = match join as i32 {
        1 => Cap::Round,
        2 => Cap::Butt,
        _ => Cap::Square,
    };
    let st = Stroke::new(delta.abs() * 2.0).with_join(join_of(join)).with_caps(cap).with_miter_limit(miter);
    let nz = FillRule::NonZero;
    let mut out = Vec::new();
    for (i, s) in shapes.iter().enumerate() {
        let closed: Vec<Subpath> = s.subpaths.iter().filter(|sp| sp.closed && sp.anchors.len() > 1).cloned().collect();
        let open: Vec<Subpath> = s.subpaths.iter().filter(|sp| !sp.closed && sp.anchors.len() > 1).cloned().collect();
        if delta.abs() < 1e-12 {
            out.push(OutShape { owner: i as i32, flags: 0, cover: Vec::new(), subpaths: s.subpaths.clone() });
            continue;
        }
        let base = Shape { flags: F_FILLED | (s.flags & F_EVENODD), key: 0.0, subpaths: closed.clone() };
        let ring = stroke_shape(&closed, &st, tol * 0.5);
        let lines = stroke_shape(&open, &st, tol * 0.5);
        let set = [base, ring, lines];
        let p = prepare(&set, tol);
        let mut res = if closed.is_empty() {
            Vec::new()
        } else if delta > 0.0 {
            flat(&overlay(&p.norm[0], &p.norm[1], OverlayRule::Union, nz))
        } else {
            flat(&overlay(&p.norm[0], &p.norm[1], OverlayRule::Difference, nz))
        };
        if delta > 0.0 && !p.norm[2].is_empty() {
            res = flat(&overlay(&res, &p.norm[2], OverlayRule::Union, nz));
        }
        let shaped = overlay(&res, &Vec::new(), OverlayRule::Subject, nz);
        let o = out_all(&p.reg, &shaped, i as i32);
        out.push(o);
    }
    out
}

/// Simplify. params: [accuracy, angleThresholdTangent]
pub fn simplify(params: &[f64], shapes: &[Shape]) -> Vec<OutShape> {
    let accuracy = params.first().copied().unwrap_or(1.0).max(1e-6);
    let angle = params.get(1).copied().unwrap_or(1e-3).max(1e-6);
    let opts = kurbo::simplify::SimplifyOptions::default().angle_thresh(angle);
    let mut out = Vec::new();
    for (i, s) in shapes.iter().enumerate() {
        let mut subpaths = Vec::new();
        for sp in &s.subpaths {
            if sp.anchors.len() < 3 {
                subpaths.push(sp.clone());
                continue;
            }
            let b = to_bez(sp);
            let r = kurbo::simplify::simplify_bezpath(b.elements().iter().copied(), accuracy, &opts);
            let mut got = from_bez(&r);
            if got.len() == 1 && got[0].anchors.len() >= 2 {
                got[0].closed = sp.closed;
                subpaths.push(got.remove(0));
            } else {
                subpaths.push(sp.clone());
            }
        }
        out.push(OutShape { owner: i as i32, flags: 0, cover: Vec::new(), subpaths });
    }
    out
}
