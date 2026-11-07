//! Geometry kernel for Circuits, compiled to WebAssembly.
//!
//! The interface is a plain C ABI over f64 buffers in linear memory: the host
//! allocates an input buffer with `k_alloc`, fills it, calls an operation,
//! then reads the output through `k_result_ptr` / `k_result_len`.
//!
//! Every input starts with the shared prefix
//!   nShapes, shape records (see shape.rs), nBoardRings, (nPts, x, y, ...)*
//! followed by operation parameters described on each function.

pub mod drc;
pub mod poly;
pub mod pour;
pub mod route;
pub mod shape;

use shape::*;
use std::cell::RefCell;

thread_local! {
    static RESULT: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static ROUTER: RefCell<Option<route::Router>> = const { RefCell::new(None) };
}

fn set_result(v: Vec<f64>) -> i32 {
    let n = v.len() as i32;
    RESULT.with(|r| *r.borrow_mut() = v);
    n
}

#[no_mangle]
pub extern "C" fn k_alloc(n: usize) -> *mut f64 {
    let mut v: Vec<f64> = Vec::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `p` must come from `k_alloc(n)` with the same `n`.
#[no_mangle]
pub unsafe extern "C" fn k_free(p: *mut f64, n: usize) {
    drop(Vec::from_raw_parts(p, 0, n.max(1)));
}

#[no_mangle]
pub extern "C" fn k_result_ptr() -> *const f64 {
    RESULT.with(|r| r.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn k_result_len() -> usize {
    RESULT.with(|r| r.borrow().len())
}

/// Releases the result buffer and router state.
#[no_mangle]
pub extern "C" fn k_reset() {
    RESULT.with(|r| *r.borrow_mut() = Vec::new());
    ROUTER.with(|r| *r.borrow_mut() = None);
}

unsafe fn input<'a>(p: *const f64, n: usize) -> &'a [f64] {
    std::slice::from_raw_parts(p, n)
}

pub struct Prefix {
    pub shapes: Vec<Shape>,
    pub board: Vec<Vec<[f64; 2]>>,
    pub next: usize,
}

pub fn read_prefix(buf: &[f64]) -> Prefix {
    let n = buf[0] as usize;
    let mut i = 1;
    let mut shapes = Vec::with_capacity(n);
    for _ in 0..n {
        let (s, j) = decode(buf, i);
        shapes.push(s);
        i = j;
    }
    let rings = buf[i] as usize;
    i += 1;
    let mut board = Vec::with_capacity(rings);
    for _ in 0..rings {
        let k = buf[i] as usize;
        i += 1;
        board.push((0..k).map(|t| [buf[i + 2 * t], buf[i + 2 * t + 1]]).collect());
        i += 2 * k;
    }
    Prefix { shapes, board, next: i }
}

/// Parameters: edgeClearance, gap, spoke, count, nPours, then per pour:
/// obj, layerBit, net, clearance, minWidth, removeIslands, thermals, nPts, x, y...
/// Output: nPours, then per pour: obj, nPolys, (nRings, (nPts, x, y...)*)*.
pub fn pours_impl(buf: &[f64]) -> Vec<f64> {
    let pre = read_prefix(buf);
    let mut i = pre.next;
    let pp = pour::PourParams { edge_clearance: buf[i], gap: buf[i + 1], spoke: buf[i + 2], count: buf[i + 3] as u32 };
    let n = buf[i + 4] as usize;
    i += 5;
    let mut specs = Vec::with_capacity(n);
    for _ in 0..n {
        let k = buf[i + 7] as usize;
        let outline = (0..k).map(|t| [buf[i + 8 + 2 * t], buf[i + 9 + 2 * t]]).collect();
        specs.push(pour::PourSpec {
            obj: buf[i] as i32,
            layer_bit: 1 << (buf[i + 1] as u32),
            net: buf[i + 2] as i32,
            clearance: buf[i + 3],
            min_width: buf[i + 4],
            remove_islands: buf[i + 5] != 0.0,
            thermals: buf[i + 6] != 0.0,
            outline,
        });
        i += 8 + 2 * k;
    }
    let board = pour::board_area(&pre.board);
    let res = pour::fill_pours(&pre.shapes, &board, &specs, &pp);
    let mut out = vec![res.len() as f64];
    for r in res {
        out.push(r.obj as f64);
        out.push(r.shapes.len() as f64);
        for shape in r.shapes {
            out.push(shape.len() as f64);
            for c in shape {
                out.push(c.len() as f64);
                for q in c {
                    out.push(q.x as f64);
                    out.push(q.y as f64);
                }
            }
        }
    }
    out
}

/// Parameters: edgeClearance, maxViolations.
/// Output: n, then per violation: rule, a, b (-1 when none), x, y, mask, actual, required.
/// a and b are indices into the input shapes.
pub fn drc_impl(buf: &[f64]) -> Vec<f64> {
    let mut pre = read_prefix(buf);
    let i = pre.next;
    let edge = buf[i];
    let max = buf[i + 1] as usize;
    let base = pre.shapes.len();
    for ring in &pre.board {
        for k in 0..ring.len() {
            let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
            let mut s = route::seg_shape(a, b, 0.0);
            s.flags = F_EDGE;
            s.mask = COPPER_MASK;
            pre.shapes.push(s);
        }
    }
    let v = drc::check(&pre.shapes, &pre.board, edge, max);
    let mut out = vec![v.len() as f64];
    for x in v {
        let a = if x.a >= base { -1.0 } else { x.a as f64 };
        let b = match x.b { Some(b) if b < base => b as f64, _ => -1.0 };
        out.extend_from_slice(&[x.rule as f64, a, b, x.x, x.y, x.mask as f64, x.actual, x.required]);
    }
    out
}

/// Parameters: grid, nLayers, layerBits..., allowedMask, clearance, viaRadius,
/// viaCost (in cells), edgeClearance, defaultHalfWidth, nNetHw, halfWidths...,
/// nNets, nets..., maxNodes. Returns the number of connections to route.
pub fn route_init_impl(buf: &[f64]) -> route::Router {
    let pre = read_prefix(buf);
    let mut i = pre.next;
    let grid = buf[i];
    let nl = buf[i + 1] as usize;
    i += 2;
    let layers: Vec<u32> = (0..nl).map(|k| buf[i + k] as u32).collect();
    i += nl;
    let allowed = buf[i] as u32;
    let clearance = buf[i + 1];
    let via_r = buf[i + 2];
    let via_cost = buf[i + 3];
    let edge_clearance = buf[i + 4];
    let default_hw = buf[i + 5];
    let nh = buf[i + 6] as usize;
    i += 7;
    let net_hw = buf[i..i + nh].to_vec();
    i += nh;
    let nn = buf[i] as usize;
    i += 1;
    let nets = buf[i..i + nn].iter().map(|v| *v as i32).collect();
    i += nn;
    let max_nodes = buf[i] as usize;
    let order = if i + 1 < buf.len() { buf[i + 1] as u32 } else { 0 };
    route::Router::new(pre.shapes, &pre.board, route::RouteParams {
        grid, layers, allowed, clearance, via_r, via_cost, edge_clearance, net_hw, default_hw, nets, max_nodes, order,
    })
}

pub fn route_result(r: &route::Router) -> Vec<f64> {
    let mut out = vec![r.initial as f64, r.processed as f64, r.routed as f64, r.grid()];
    out.push(r.tracks.len() as f64);
    for t in &r.tracks {
        out.extend_from_slice(&[t.layer as f64, t.x1, t.y1, t.x2, t.y2, t.w, t.net as f64]);
    }
    out.push(r.vias.len() as f64);
    for (p, net) in &r.vias {
        out.extend_from_slice(&[p[0], p[1], *net as f64]);
    }
    out.push(r.failed.len() as f64);
    for f in &r.failed {
        out.extend_from_slice(&[f.net as f64, f.a[0], f.a[1], f.b[0], f.b[1]]);
    }
    out
}

/// # Safety
/// `p` must point to `n` initialized f64 values.
#[no_mangle]
pub unsafe extern "C" fn k_pours(p: *const f64, n: usize) -> i32 {
    set_result(pours_impl(input(p, n)))
}

/// # Safety
/// `p` must point to `n` initialized f64 values.
#[no_mangle]
pub unsafe extern "C" fn k_drc(p: *const f64, n: usize) -> i32 {
    set_result(drc_impl(input(p, n)))
}

/// # Safety
/// `p` must point to `n` initialized f64 values.
#[no_mangle]
pub unsafe extern "C" fn k_route_init(p: *const f64, n: usize) -> i32 {
    let r = route_init_impl(input(p, n));
    let total = r.total as i32;
    ROUTER.with(|cell| *cell.borrow_mut() = Some(r));
    total
}

/// Routes up to `budget` connections; returns how many remain (0 when done).
#[no_mangle]
pub extern "C" fn k_route_step(budget: i32) -> i32 {
    ROUTER.with(|cell| match cell.borrow_mut().as_mut() {
        Some(r) => r.step(budget.max(1) as usize) as i32,
        None => 0,
    })
}

/// Writes [total, processed, routed] to the result buffer.
#[no_mangle]
pub extern "C" fn k_route_progress() -> i32 {
    let v = ROUTER.with(|cell| {
        cell.borrow().as_ref().map(|r| vec![r.total as f64, r.processed as f64, r.routed as f64]).unwrap_or_default()
    });
    set_result(v)
}

/// Writes routing progress and results to the result buffer.
#[no_mangle]
pub extern "C" fn k_route_result() -> i32 {
    let v = ROUTER.with(|cell| cell.borrow().as_ref().map(route_result).unwrap_or_default());
    set_result(v)
}
